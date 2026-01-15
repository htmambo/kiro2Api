import { v4 as uuidv4 } from 'uuid';
import { findMatchingBracket, repairJson } from './utils.js';
import { createLogger } from '../lib/logger.js';
import { KIRO_CONSTANTS } from './constants.js';

const logger = createLogger('kiro:tools');

export const CC_TO_KIRO_TOOL_MAPPING = {
    Read: {
        kiroTool: 'readFile',
        paramMap: { file_path: 'path', offset: 'start_line', limit: 'end_line' },
        description: 'Read file content'
    },
    Write: {
        kiroTool: 'fsWrite',
        paramMap: { file_path: 'path', content: 'text' },
        description: 'Write file'
    },
    Edit: {
        kiroTool: 'strReplace',
        paramMap: { file_path: 'path', old_string: 'oldStr', new_string: 'newStr' },
        description: 'Replace text in file'
    },
    Bash: {
        kiroTool: 'executeBash',
        paramMap: { command: 'command', timeout: 'timeout' },
        description: 'Execute shell command'
    },
    Glob: {
        kiroTool: 'fileSearch',
        paramMap: { pattern: 'query' },
        description: 'Search files by pattern'
    },
    Grep: {
        kiroTool: 'grepSearch',
        paramMap: { pattern: 'query', path: 'includePattern' },
        description: 'Search content in files'
    },
    LS: {
        kiroTool: 'listDirectory',
        paramMap: { path: 'path' },
        description: 'List directory'
    },
    AskUserQuestion: {
        kiroTool: 'userInput',
        paramMap: { question: 'question' },
        description: 'Ask user for input'
    },
    Task: {
        kiroTool: 'invokeSubAgent',
        paramMap: { subagent_type: 'name', prompt: 'prompt', description: 'explanation' },
        description: 'Invoke sub-agent for complex tasks'
    },
    LSP: { remove: true, reason: 'Kiro getDiagnostics is not equivalent to CC LSP operations' },
    KillShell: {
        kiroTool: 'controlProcess',
        paramMap: { shell_id: 'processId' },
        fixedParams: { action: 'stop' },
        description: 'Stop background process'
    },
    TaskOutput: {
        kiroTool: 'getProcessOutput',
        paramMap: { task_id: 'processId' },
        description: 'Get process output'
    },
    WebSearch: {
        kiroTool: 'webSearch',
        paramMap: { query: 'query' },
        description: 'Search the web for information (server-side implementation)',
        serverSideExecute: true
    },
    WebFetch: { remove: true, reason: 'AWS CodeWhisperer does not support builtin tools' },
    TodoWrite: { remove: true, reason: 'Not supported by Kiro' },
    TodoRead: { remove: true, reason: 'Not supported by Kiro' },
    EnterPlanMode: { remove: true, reason: 'Not supported by Kiro' },
    ExitPlanMode: { remove: true, reason: 'Not supported by Kiro' },
    NotebookEdit: { remove: true, reason: 'Not supported by Kiro' },
    Skill: { remove: true, reason: 'CC internal only' },
    NotebookRead: {
        kiroTool: 'readFile',
        paramMap: { notebook_path: 'path' },
        description: 'Read notebook as file'
    }
};

export const KIRO_TOOL_SCHEMAS = {
    readFile: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            start_line: { type: 'number' },
            end_line: { type: 'number' }
        },
        required: ['path']
    },
    fsWrite: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            text: { type: 'string' }
        },
        required: ['path', 'text']
    },
    strReplace: {
        type: 'object',
        properties: {
            path: { type: 'string' },
            oldStr: { type: 'string' },
            newStr: { type: 'string' }
        },
        required: ['path', 'oldStr', 'newStr']
    },
    grepSearch: {
        type: 'object',
        properties: {
            query: { type: 'string' },
            includePattern: { type: 'string' }
        },
        required: ['query']
    },
    fileSearch: {
        type: 'object',
        properties: {
            query: { type: 'string' }
        },
        required: ['query']
    },
    executeBash: {
        type: 'object',
        properties: {
            command: { type: 'string' },
            timeout: { type: 'number' }
        },
        required: ['command']
    },
    listDirectory: {
        type: 'object',
        properties: {
            path: { type: 'string' }
        },
        required: ['path']
    },
    userInput: {
        type: 'object',
        properties: {
            question: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } }
        },
        required: ['question']
    },
    getDiagnostics: {
        type: 'object',
        properties: {
            paths: { type: 'array', items: { type: 'string' } }
        },
        required: ['paths']
    },
    controlProcess: {
        type: 'object',
        properties: {
            action: { type: 'string', enum: ['start', 'stop', 'restart'] },
            command: { type: 'string' },
            processId: { type: 'string' }
        },
        required: ['action']
    },
    getProcessOutput: {
        type: 'object',
        properties: {
            processId: { type: 'string' },
            lines: { type: 'number' }
        },
        required: ['processId']
    },
    invokeSubAgent: {
        type: 'object',
        properties: {
            name: { type: 'string' },
            prompt: { type: 'string' },
            explanation: { type: 'string' }
        },
        required: ['name', 'prompt', 'explanation']
    },
    webSearch: {
        type: 'object',
        properties: {
            query: { type: 'string' }
        },
        required: ['query']
    }
};

export function mapToolUseParams(toolName, input, verboseLogging = false) {
    if (input === undefined || input === null) {
        return {};
    }

    if (typeof input !== 'object') {
        if (verboseLogging) {
            logger.debug(`ParamMap ${toolName}: input is not object (${typeof input}), wrapping in object`);
        }
        return { value: input };
    }

    const mapping = CC_TO_KIRO_TOOL_MAPPING[toolName];
    if (!mapping) {
        if (verboseLogging) {
            logger.debug(`ParamMap ${toolName}: no mapping found, using original input`);
        }
        return input;
    }

    const mappedInput = {};

    if (mapping.paramMap) {
        for (const [ccParam, kiroParam] of Object.entries(mapping.paramMap)) {
            if (input[ccParam] !== undefined) {
                mappedInput[kiroParam] = input[ccParam];
                if (verboseLogging || toolName === 'Task') {
                    logger.debug(
                        `ParamMap ${toolName}: mapped ${ccParam} → ${kiroParam} = ${JSON.stringify(input[ccParam])}`
                    );
                }
            }
        }
    }

    for (const [key, value] of Object.entries(input)) {
        if (!mapping.paramMap || !mapping.paramMap[key]) {
            mappedInput[key] = value;
        }
    }

    if (mapping.fixedParams) {
        Object.assign(mappedInput, mapping.fixedParams);
    }

    return mappedInput;
}

export function reverseMapToolInput(toolName, input, verboseLogging = false) {
    if (!input || typeof input !== 'object') {
        return input;
    }

    const mapping = CC_TO_KIRO_TOOL_MAPPING[toolName];
    if (!mapping || !mapping.paramMap) {
        return input;
    }

    const reverseMap = {};
    for (const [ccParam, kiroParam] of Object.entries(mapping.paramMap)) {
        reverseMap[kiroParam] = ccParam;
    }

    const kiroOnlyParams = [
        'explanation', 'ignoreWarning', 'depth', 'reason',
        'caseSensitive', 'excludePattern', 'includeIgnoredFiles',
        'raw', 'raw_arguments', 'value'
    ];

    const reversedInput = {};

    for (const [key, value] of Object.entries(input)) {
        if (reverseMap[key]) {
            reversedInput[reverseMap[key]] = value;
            if (verboseLogging) {
                logger.debug(`ReverseMap ${toolName}: reversed ${key} → ${reverseMap[key]}`);
            }
        } else if (!kiroOnlyParams.includes(key)) {
            reversedInput[key] = value;
        }
    }

    return reversedInput;
}

export function parseSingleToolCall(toolCallText) {
    const namePattern = /\[Called\s+(\w+)\s+with\s+args:/i;
    const nameMatch = toolCallText.match(namePattern);

    if (!nameMatch) {
        return null;
    }

    const functionName = nameMatch[1].trim();
    const argsStartMarker = "with args:";
    const argsStartPos = toolCallText.toLowerCase().indexOf(argsStartMarker.toLowerCase());

    if (argsStartPos === -1) {
        return null;
    }

    const argsStart = argsStartPos + argsStartMarker.length;
    const argsEnd = toolCallText.lastIndexOf(']');

    if (argsEnd <= argsStart) {
        return null;
    }

    const jsonCandidate = toolCallText.substring(argsStart, argsEnd).trim();

    try {
        const repairedJson = repairJson(jsonCandidate);
        const argumentsObj = JSON.parse(repairedJson);

        if (typeof argumentsObj !== 'object' || argumentsObj === null) {
            return null;
        }

        const toolCallId = `call_${uuidv4().replace(/-/g, '').substring(0, 8)}`;
        return {
            id: toolCallId,
            type: "function",
            function: {
                name: functionName,
                arguments: JSON.stringify(argumentsObj)
            }
        };
    } catch (e) {
        logger.error(`Failed to parse tool call arguments: ${e.message}`, { jsonCandidate });
        return null;
    }
}

export function parseBracketToolCalls(responseText) {
    if (!responseText || !responseText.includes("[Called")) {
        return null;
    }

    const toolCalls = [];
    const callPositions = [];
    let start = 0;
    while (true) {
        const pos = responseText.indexOf("[Called", start);
        if (pos === -1) {
            break;
        }
        callPositions.push(pos);
        start = pos + 1;
    }

    for (let i = 0; i < callPositions.length; i++) {
        const startPos = callPositions[i];
        let endSearchLimit;
        if (i + 1 < callPositions.length) {
            endSearchLimit = callPositions[i + 1];
        } else {
            endSearchLimit = responseText.length;
        }

        const segment = responseText.substring(startPos, endSearchLimit);
        const bracketEnd = findMatchingBracket(segment, 0);

        let toolCallText;
        if (bracketEnd !== -1) {
            toolCallText = segment.substring(0, bracketEnd + 1);
        } else {
            const lastBracket = segment.lastIndexOf(']');
            if (lastBracket !== -1) {
                toolCallText = segment.substring(0, lastBracket + 1);
            } else {
                continue;
            }
        }

        const parsedCall = parseSingleToolCall(toolCallText);
        if (parsedCall) {
            toolCalls.push(parsedCall);
        }
    }
    return toolCalls.length > 0 ? toolCalls : null;
}

// ============================================================================
// 自适应超时函数（借鉴 KiroGate）
// ============================================================================

/**
 * 根据模型类型获取自适应超时时间
 * 对于 Opus 等慢模型，自动增加超时时间
 */
export function getAdaptiveTimeout(model, baseTimeout) {
    if (!model) return baseTimeout;

    const modelLower = model.toLowerCase();
    for (const slowModel of KIRO_CONSTANTS.SLOW_MODELS) {
        if (modelLower.includes(slowModel.toLowerCase())) {
            const adaptiveTimeout = baseTimeout * KIRO_CONSTANTS.SLOW_MODEL_TIMEOUT_MULTIPLIER;
            logger.info(`Slow model detected (${model}), timeout: ${baseTimeout}ms -> ${adaptiveTimeout}ms`);
            return adaptiveTimeout;
        }
    }
    return baseTimeout;
}

// ============================================================================
// 长文档分段处理（借鉴 KiroGate）
// ============================================================================

/**
 * 检查文本是否需要分段
 */
export function needsChunking(text) {
    return KIRO_CONSTANTS.AUTO_CHUNKING_ENABLED &&
           text &&
           text.length > KIRO_CONSTANTS.AUTO_CHUNK_THRESHOLD;
}

/**
 * 在目标位置附近找到合适的分割点（优先在段落/句子边界）
 */
function findSplitPoint(text, targetPos) {
    if (targetPos >= text.length) return text.length;

    const searchStart = Math.max(0, targetPos - 500);
    const searchEnd = Math.min(text.length, targetPos + 500);
    const searchText = text.substring(searchStart, searchEnd);

    // 优先级 1：段落边界（双换行）
    const paragraphBreaks = [...searchText.matchAll(/\n\n+/g)];
    if (paragraphBreaks.length > 0) {
        const best = paragraphBreaks.reduce((a, b) =>
            Math.abs((searchStart + a.index + a[0].length) - targetPos) <
            Math.abs((searchStart + b.index + b[0].length) - targetPos) ? a : b
        );
        return searchStart + best.index + best[0].length;
    }

    // 优先级 2：句子边界
    const sentenceBreaks = [...searchText.matchAll(/[.!?。！？]\s+/g)];
    if (sentenceBreaks.length > 0) {
        const best = sentenceBreaks.reduce((a, b) =>
            Math.abs((searchStart + a.index + a[0].length) - targetPos) <
            Math.abs((searchStart + b.index + b[0].length) - targetPos) ? a : b
        );
        return searchStart + best.index + best[0].length;
    }

    // 优先级 3：单换行
    const lineBreaks = [...searchText.matchAll(/\n/g)];
    if (lineBreaks.length > 0) {
        const best = lineBreaks.reduce((a, b) =>
            Math.abs((searchStart + a.index + 1) - targetPos) <
            Math.abs((searchStart + b.index + 1) - targetPos) ? a : b
        );
        return searchStart + best.index + 1;
    }

    return targetPos;
}

/**
 * 将长文本分割成多个片段
 */
function splitLongText(text) {
    if (!needsChunking(text)) {
        return [text];
    }

    const chunks = [];
    let currentPos = 0;
    const maxChars = KIRO_CONSTANTS.CHUNK_MAX_CHARS;
    const overlap = KIRO_CONSTANTS.CHUNK_OVERLAP_CHARS;

    while (currentPos < text.length) {
        let chunkEnd = currentPos + maxChars;

        if (chunkEnd >= text.length) {
            chunks.push(text.substring(currentPos));
            break;
        }

        // 找到合适的分割点
        const splitPos = findSplitPoint(text, chunkEnd);
        chunks.push(text.substring(currentPos, splitPos));

        // 移动到下一个位置（考虑重叠）
        currentPos = splitPos - overlap;
        if (currentPos <= 0 || currentPos >= splitPos) {
            currentPos = splitPos;
        }
    }

    logger.info(`Split long document into ${chunks.length} chunks (total: ${text.length} chars)`);
    return chunks;
}

/**
 * 为分段创建带上下文的提示词
 */
function createChunkPrompt(chunk, chunkIndex, totalChunks, originalPrompt) {
    if (totalChunks === 1) {
        return `${originalPrompt}\n\n${chunk}`;
    }

    const contextInfo = `[文档片段 ${chunkIndex + 1}/${totalChunks}]`;
    let instruction;

    if (chunkIndex === 0) {
        instruction = '这是一个长文档的第一部分。请处理这部分内容，后续会提供剩余部分。';
    } else if (chunkIndex === totalChunks - 1) {
        instruction = '这是文档的最后一部分。请结合之前的内容完成处理。';
    } else {
        instruction = `这是文档的第 ${chunkIndex + 1} 部分。请继续处理。`;
    }

    return `${contextInfo}\n${instruction}\n\n${originalPrompt}\n\n---\n${chunk}\n---`;
}

/**
 * 处理长文档分段并生成提示词列表
 */
export function processLongDocument(text, originalPrompt) {
    const chunks = splitLongText(text);
    const prompts = chunks.map((chunk, index) =>
        createChunkPrompt(chunk, index, chunks.length, originalPrompt)
    );
    return prompts;
}
export function deduplicateToolCalls(toolCalls) {
   if (!toolCalls || toolCalls.length === 0) {
        return [];
    }

    // 第一步：按 id 去重，保留参数更完整的（借鉴 KiroGate）
    const byId = new Map();

    for (const tc of toolCalls) {
        const tcId = tc.id || tc.toolUseId;
        if (!tcId) {
            // 没有 id 的直接加入
            byId.set(`no-id-${byId.size}`, tc);
            continue;
        }

        const existing = byId.get(tcId);
        if (!existing) {
            byId.set(tcId, tc);
        } else {
            // 有重复 id，保留参数更完整的
            const existingArgs = existing.function?.arguments || existing.input || '{}';
            const currentArgs = tc.function?.arguments || tc.input || '{}';

            if (currentArgs !== '{}' && (existingArgs === '{}' || currentArgs.length > existingArgs.length)) {
                logger.info(`Replacing tool call ${tcId} with better arguments: ${existingArgs.length} -> ${currentArgs.length} chars`);
                byId.set(tcId, tc);
            }
        }
    }

    // 第二步：按 name+arguments 去重
    const seen = new Set();
    const uniqueToolCalls = [];

    for (const tc of byId.values()) {
        const name = tc.function?.name || tc.name || '';
        const args = tc.function?.arguments || tc.input || '{}';
        const key = `${name}-${args}`;

        if (!seen.has(key)) {
            seen.add(key);
            uniqueToolCalls.push(tc);
        } else {
            logger.info(`Skipping duplicate tool call: ${name}`);
        }
    }

    if (toolCalls.length !== uniqueToolCalls.length) {
        logger.info(`Deduplicated tool calls: ${toolCalls.length} -> ${uniqueToolCalls.length}`);
    }
    return uniqueToolCalls;
}

export function copyToolMapping(toolName) {
    const base = CC_TO_KIRO_TOOL_MAPPING[toolName];
    if (!base) return null;
    return JSON.parse(JSON.stringify(base));
}
