/**
 * Claude 流式 block 状态管理器
 *
 * 将 `api-client` 中与 block index、text block 生命周期、
 * 普通 tool_use / web search block 构造相关的逻辑抽离出来，
 * 以降低主流式函数的复杂度。
 *
 * @module kiro/stream-block-manager
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../lib/logger.js';
import { CC_TO_KIRO_TOOL_MAPPING, KIRO_ONLY_PARAMS, mapToolNameToCC, reverseMapToolInput } from './tools.js';
import { repairJson } from './utils.js';

const logger = createLogger('kiro:stream-block-manager');

function parseToolInputBestEffort(rawInput, toolName) {
    if (typeof rawInput !== 'string') {
        return rawInput;
    }

    try {
        return JSON.parse(rawInput);
    } catch (error) {
        const trimmedInput = rawInput.trim();
        const looksLikeJson = trimmedInput.startsWith('{') || trimmedInput.startsWith('[');

        if (looksLikeJson) {
            try {
                return JSON.parse(repairJson(rawInput));
            } catch (repairError) {
                logger.warn(`Failed to repair tool input JSON for ${toolName}:`, trimmedInput.substring(0, 100));
            }
        } else {
            logger.warn(`Tool input is not valid JSON for ${toolName}, keeping raw string:`, trimmedInput.substring(0, 100));
        }

        return rawInput;
    }
}

/**
 * 创建 Claude 流式 block 状态
 *
 * @returns {Object} 状态对象
 */
export function createClaudeStreamBlockState() {
    let totalContent = '';
    let nextBlockIndex = 0;
    let activeTextBlockIndex = null;

    return {
        allocateBlockIndex() {
            return nextBlockIndex++;
        },

        getNextBlockIndex() {
            return nextBlockIndex;
        },

        setNextBlockIndex(index) {
            nextBlockIndex = index;
        },

        hasOpenTextBlock() {
            return activeTextBlockIndex !== null;
        },

        startTextBlock() {
            if (activeTextBlockIndex !== null) {
                return [];
            }

            activeTextBlockIndex = nextBlockIndex++;
            return [{
                type: 'content_block_start',
                index: activeTextBlockIndex,
                content_block: { type: 'text', text: '' }
            }];
        },

        closeTextBlock() {
            if (activeTextBlockIndex === null) {
                return [];
            }

            const closingIndex = activeTextBlockIndex;
            activeTextBlockIndex = null;
            return [{
                type: 'content_block_stop',
                index: closingIndex
            }];
        },

        emitTextDelta(text) {
            if (!text) {
                return [];
            }

            const events = [];
            if (activeTextBlockIndex === null) {
                events.push(...this.startTextBlock());
            }

            totalContent += text;
            events.push({
                type: 'content_block_delta',
                index: activeTextBlockIndex,
                delta: { type: 'text_delta', text }
            });
            return events;
        },

        appendText(text) {
            if (text) {
                totalContent += text;
            }
        },

        getTotalContent() {
            return totalContent;
        }
    };
}

/**
 * 构造 server-side web search 的 Claude stream blocks
 *
 * @param {Array} serverSideExecutions - 已解析的搜索执行结果
 * @param {number} [startIndex=0] - 起始 block index
 * @returns {{events:Array,nextIndex:number,emittedSummaryText:string}} block 结果
 */
export function buildServerSideWebSearchStreamBlocks(serverSideExecutions, startIndex = 0) {
    const events = [];
    let nextIndex = startIndex;
    let emittedSummaryText = '';

    for (const execution of serverSideExecutions || []) {
        events.push({
            type: 'content_block_start',
            index: nextIndex,
            content_block: {
                id: execution.toolUseId,
                type: 'server_tool_use',
                name: 'web_search',
                input: { query: execution.query }
            }
        });
        events.push({
            type: 'content_block_stop',
            index: nextIndex
        });
        nextIndex++;

        events.push({
            type: 'content_block_start',
            index: nextIndex,
            content_block: {
                type: 'web_search_tool_result',
                content: execution.resultBlocks
            }
        });
        events.push({
            type: 'content_block_stop',
            index: nextIndex
        });
        nextIndex++;

        if (execution.summaryText) {
            events.push({
                type: 'content_block_start',
                index: nextIndex,
                content_block: {
                    type: 'text',
                    text: ''
                }
            });
            events.push({
                type: 'content_block_delta',
                index: nextIndex,
                delta: {
                    type: 'text_delta',
                    text: execution.summaryText
                }
            });
            events.push({
                type: 'content_block_stop',
                index: nextIndex
            });
            emittedSummaryText += execution.summaryText;
            nextIndex++;
        }
    }

    return {
        events,
        nextIndex,
        emittedSummaryText
    };
}

function createToolInputJsonStreamTransformer(toolName) {
    const mapping = CC_TO_KIRO_TOOL_MAPPING[toolName];
    const reverseParamMap = new Map(
        Object.entries(mapping?.paramMap || {}).map(([ccParam, kiroParam]) => [kiroParam, ccParam])
    );
    const kiroOnlyParams = new Set(KIRO_ONLY_PARAMS);

    const stack = [];
    let insideString = false;
    let escapeNext = false;
    let currentStringRole = null;
    let currentStringBuffer = '';
    let primitiveActive = false;
    let currentRootPropertyIncluded = null;
    let emittedRootPropertyCount = 0;

    const updateCurrentContextState = (nextState) => {
        const current = stack[stack.length - 1];
        if (current) {
            current.state = nextState;
        }
    };

    const isAtRootObject = () => stack.length === 1 && stack[0]?.type === 'object';
    const isAtRootObjectKey = () => isAtRootObject() && stack[0]?.state === 'expectKeyOrEnd';
    const isSkippingCurrentRootProperty = () => currentRootPropertyIncluded === false;

    const startValue = () => {
        const current = stack[stack.length - 1];
        if (!current) {
            return;
        }

        if (
            (current.type === 'object' && current.state === 'expectValue') ||
            (current.type === 'array' && current.state === 'expectValueOrEnd')
        ) {
            current.state = 'afterValue';
        }
    };

    return {
        append(chunk) {
            if (!chunk) {
                return '';
            }

            let output = '';

            for (const char of chunk) {
                if (insideString) {
                    if (currentStringRole === 'key') {
                        if (escapeNext) {
                            currentStringBuffer += char;
                            escapeNext = false;
                            continue;
                        }

                        if (char === '\\') {
                            currentStringBuffer += char;
                            escapeNext = true;
                            continue;
                        }

                        if (char === '"') {
                            const isRootKey = isAtRootObjectKey();
                            if (isRootKey) {
                                const shouldInclude = reverseParamMap.has(currentStringBuffer) || !kiroOnlyParams.has(currentStringBuffer);
                                currentRootPropertyIncluded = shouldInclude;

                                if (shouldInclude) {
                                    const mappedKey = reverseParamMap.get(currentStringBuffer) || currentStringBuffer;
                                    if (emittedRootPropertyCount > 0) {
                                        output += ',';
                                    }
                                    output += `"${mappedKey}"`;
                                    emittedRootPropertyCount += 1;
                                }
                            } else if (!isSkippingCurrentRootProperty()) {
                                output += `"${currentStringBuffer}"`;
                            }

                            insideString = false;
                            currentStringRole = null;
                            currentStringBuffer = '';
                            escapeNext = false;
                            updateCurrentContextState('afterKey');
                            continue;
                        }

                        currentStringBuffer += char;
                        continue;
                    }

                    if (!isSkippingCurrentRootProperty()) {
                        output += char;
                    }

                    if (escapeNext) {
                        escapeNext = false;
                        continue;
                    }

                    if (char === '\\') {
                        escapeNext = true;
                        continue;
                    }

                    if (char === '"') {
                        insideString = false;
                        currentStringRole = null;
                        escapeNext = false;
                        startValue();
                    }
                    continue;
                }

                if (primitiveActive) {
                    if (char === ',' || char === '}' || char === ']') {
                        primitiveActive = false;
                    } else {
                        if (!isSkippingCurrentRootProperty()) {
                            output += char;
                        }
                        continue;
                    }
                }

                if (char === '"') {
                    const current = stack[stack.length - 1];
                    const isObjectKey = current?.type === 'object' && current.state === 'expectKeyOrEnd';

                    insideString = true;
                    currentStringRole = isObjectKey ? 'key' : 'value';
                    currentStringBuffer = '';
                    escapeNext = false;

                    if (!isObjectKey && !isSkippingCurrentRootProperty()) {
                        output += char;
                        startValue();
                    } else if (!isObjectKey) {
                        startValue();
                    }
                    continue;
                }

                if (char === '{') {
                    if (!isSkippingCurrentRootProperty()) {
                        output += char;
                    }
                    startValue();
                    stack.push({ type: 'object', state: 'expectKeyOrEnd' });
                    continue;
                }

                if (char === '[') {
                    if (!isSkippingCurrentRootProperty()) {
                        output += char;
                    }
                    startValue();
                    stack.push({ type: 'array', state: 'expectValueOrEnd' });
                    continue;
                }

                if (char === '}') {
                    const wasRootObject = isAtRootObject();
                    if (!isSkippingCurrentRootProperty() || wasRootObject) {
                        output += char;
                    }
                    stack.pop();
                    if (wasRootObject) {
                        currentRootPropertyIncluded = null;
                    }
                    continue;
                }

                if (char === ']') {
                    if (!isSkippingCurrentRootProperty()) {
                        output += char;
                    }
                    stack.pop();
                    continue;
                }

                if (char === ':') {
                    if (!isSkippingCurrentRootProperty()) {
                        output += char;
                    }
                    updateCurrentContextState('expectValue');
                    continue;
                }

                if (char === ',') {
                    const current = stack[stack.length - 1];
                    const isRootObjectSeparator = isAtRootObject() && current?.type === 'object';
                    if (!isRootObjectSeparator && !isSkippingCurrentRootProperty()) {
                        output += char;
                    }
                    if (current?.type === 'object') {
                        current.state = 'expectKeyOrEnd';
                    } else if (current?.type === 'array') {
                        current.state = 'expectValueOrEnd';
                    }
                    if (isRootObjectSeparator) {
                        currentRootPropertyIncluded = null;
                    }
                    continue;
                }

                if (!/\s/.test(char)) {
                    if (!isSkippingCurrentRootProperty()) {
                        output += char;
                    }
                    startValue();
                    primitiveActive = true;
                    continue;
                }
            }

            return output;
        }
    };
}

export function createInlineClientToolUseStreamState(toolCall, startIndex = 0) {
    const toolUseId = toolCall?.toolUseId || `tool_${uuidv4()}`;
    const rawToolName = toolCall?.function?.name || toolCall?.name;
    const mappedToolName = mapToolNameToCC(rawToolName);
    const inputTransformer = createToolInputJsonStreamTransformer(mappedToolName);
    let rawInput = '';
    let started = false;
    let stopped = false;

    return {
        toolUseId,
        toolName: mappedToolName,
        index: startIndex,

        startEvents() {
            if (started) {
                return [];
            }

            started = true;
            return [{
                type: 'content_block_start',
                index: startIndex,
                content_block: {
                    type: 'tool_use',
                    id: toolUseId,
                    name: mappedToolName,
                    input: {}
                }
            }];
        },

        appendInputChunk(inputChunk) {
            if (!inputChunk) {
                return [];
            }

            rawInput += inputChunk;
            const transformedChunk = inputTransformer.append(inputChunk);
            if (!transformedChunk) {
                return [];
            }

            return [{
                type: 'content_block_delta',
                index: startIndex,
                delta: {
                    type: 'input_json_delta',
                    partial_json: transformedChunk
                }
            }];
        },

        stopEvents() {
            if (stopped) {
                return [];
            }

            stopped = true;
            return [{
                type: 'content_block_stop',
                index: startIndex
            }];
        },

        finalizeEmittedToolCall() {
            const parsedInput = parseToolInputBestEffort(rawInput || {}, mappedToolName);

            if (typeof parsedInput === 'string') {
                return {
                    toolUseId,
                    name: mappedToolName,
                    input: parsedInput
                };
            }

            if (mappedToolName === 'Write' || mappedToolName === 'write_file') {
                const reversedInput = reverseMapToolInput(mappedToolName, parsedInput);
                const hasFilePath = reversedInput?.file_path || reversedInput?.path;
                const hasContent = reversedInput?.content !== undefined;
                if (!hasFilePath || !hasContent) {
                    logger.warn(`Incomplete Write tool call - missing required params. file_path: ${!!hasFilePath}, content: ${!!hasContent}`);
                    return null;
                }
            }

            return {
                toolUseId,
                name: mappedToolName,
                input: reverseMapToolInput(mappedToolName, parsedInput)
            };
        }
    };
}

/**
 * 构造普通 client-side tool_use 的 Claude stream blocks
 *
 * @param {Object} toolCall - 工具调用
 * @param {number} [startIndex=0] - 起始 block index
 * @returns {{events:Array,nextIndex:number,emittedToolCall:Object|null}} block 结果
 */
export function buildInlineClientToolUseStreamBlocks(toolCall, startIndex = 0) {
    const streamState = createInlineClientToolUseStreamState(toolCall, startIndex);
    const rawInput = toolCall?.function?.arguments ?? toolCall?.input ?? {};
    const inputChunk = typeof rawInput === 'string'
        ? rawInput
        : JSON.stringify(reverseMapToolInput(streamState.toolName, rawInput));

    return {
        events: [
            ...streamState.startEvents(),
            ...streamState.appendInputChunk(inputChunk),
            ...streamState.stopEvents()
        ],
        nextIndex: startIndex + 1,
        emittedToolCall: streamState.finalizeEmittedToolCall()
    };
}
