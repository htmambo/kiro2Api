/**
 * Claude 流式 thinking 解析器
 *
 * 负责处理：
 * - 原生 `thinking` 增量事件
 * - prompt injection 风格的 `<thinking>...</thinking>` 标签解析
 * - thinking block 的开启 / 关闭时序
 *
 * @module kiro/thinking-stream-parser
 */

const THINKING_START_TAG = '<thinking>';
const THINKING_END_TAG = '</thinking>';
const THINKING_END_TAG_WITH_GAP = '</thinking>\n\n';
const QUOTE_CHARS = new Set([
    '`', '"', '\'', '\\', '#', '!', '@', '$', '%', '^', '&', '*', '(', ')', '-', '_', '=', '+',
    '[', ']', '{', '}', ';', ':', '<', '>', ',', '.', '?', '/'
]);

function isQuoteChar(buffer, pos) {
    const char = buffer[pos];
    return char ? QUOTE_CHARS.has(char) : false;
}

function findRealThinkingStartTag(buffer) {
    let searchStart = 0;

    while (searchStart < buffer.length) {
        const relativePos = buffer.slice(searchStart).indexOf(THINKING_START_TAG);
        if (relativePos === -1) {
            return null;
        }

        const absolutePos = searchStart + relativePos;
        const afterPos = absolutePos + THINKING_START_TAG.length;
        const hasQuoteBefore = absolutePos > 0 && isQuoteChar(buffer, absolutePos - 1);
        const hasQuoteAfter = isQuoteChar(buffer, afterPos);

        if (!hasQuoteBefore && !hasQuoteAfter) {
            return absolutePos;
        }

        searchStart = absolutePos + 1;
    }

    return null;
}

function findRealThinkingEndTag(buffer) {
    let searchStart = 0;

    while (searchStart < buffer.length) {
        const relativePos = buffer.slice(searchStart).indexOf(THINKING_END_TAG);
        if (relativePos === -1) {
            return null;
        }

        const absolutePos = searchStart + relativePos;
        const afterPos = absolutePos + THINKING_END_TAG.length;
        const hasQuoteBefore = absolutePos > 0 && isQuoteChar(buffer, absolutePos - 1);
        const hasQuoteAfter = isQuoteChar(buffer, afterPos);

        if (hasQuoteBefore || hasQuoteAfter) {
            searchStart = absolutePos + 1;
            continue;
        }

        const afterContent = buffer.slice(afterPos);
        if (afterContent.length < 2) {
            return null;
        }

        if (afterContent.startsWith('\n\n')) {
            return absolutePos;
        }

        searchStart = absolutePos + 1;
    }

    return null;
}

function findRealThinkingEndTagAtBufferEnd(buffer) {
    let searchStart = 0;

    while (searchStart < buffer.length) {
        const relativePos = buffer.slice(searchStart).indexOf(THINKING_END_TAG);
        if (relativePos === -1) {
            return null;
        }

        const absolutePos = searchStart + relativePos;
        const afterPos = absolutePos + THINKING_END_TAG.length;
        const hasQuoteBefore = absolutePos > 0 && isQuoteChar(buffer, absolutePos - 1);
        const hasQuoteAfter = isQuoteChar(buffer, afterPos);

        if (hasQuoteBefore || hasQuoteAfter) {
            searchStart = absolutePos + 1;
            continue;
        }

        if (buffer.slice(afterPos).trim().length === 0) {
            return absolutePos;
        }

        searchStart = absolutePos + 1;
    }

    return null;
}

/**
 * 创建 thinking 流解析器
 *
 * @param {Object} options - 配置项
 * @param {boolean} options.enableThinking - 是否启用 thinking 标签解析
 * @param {Object} options.streamBlockState - block 状态管理器
 * @returns {Object} parser 实例
 */
export function createThinkingStreamParser({ enableThinking, streamBlockState }) {
    let thinkingContent = '';
    let thinkingBlockIndex = null;
    let contentBuffer = '';
    let insideThinkingTag = false;
    let thinkingExtracted = false;
    let thinkingBlockClosed = false;
    let stripThinkingLeadingNewline = false;

    const ensureThinkingBlockStarted = () => {
        if (thinkingBlockIndex !== null) {
            return [];
        }

        thinkingBlockIndex = streamBlockState.allocateBlockIndex();
        return [{
            type: 'content_block_start',
            index: thinkingBlockIndex,
            content_block: { type: 'thinking', thinking: '' }
        }];
    };

    const emitThinkingDelta = (text, options = {}) => {
        const { allowEmpty = false } = options;
        if (!allowEmpty && !text) {
            return [];
        }

        if (text) {
            thinkingContent += text;
        }

        return [{
            type: 'content_block_delta',
            index: thinkingBlockIndex,
            delta: { type: 'thinking_delta', thinking: text }
        }];
    };

    const closeThinkingBlock = () => {
        if (thinkingBlockIndex === null || thinkingBlockClosed) {
            return [];
        }

        thinkingBlockClosed = true;
        return [
            ...emitThinkingDelta('', { allowEmpty: true }),
            {
                type: 'content_block_stop',
                index: thinkingBlockIndex
            }
        ];
    };

    const flushToolBoundaryThinkingIfNeeded = () => {
        if (!enableThinking || !insideThinkingTag) {
            return [];
        }

        const endPos = findRealThinkingEndTagAtBufferEnd(contentBuffer);
        if (endPos === null) {
            return [];
        }

        const events = [];
        const thinkingBeforeEnd = contentBuffer.slice(0, endPos);
        if (thinkingBeforeEnd) {
            events.push(...emitThinkingDelta(thinkingBeforeEnd));
        }

        insideThinkingTag = false;
        thinkingExtracted = true;
        events.push(...closeThinkingBlock());

        const afterPos = endPos + THINKING_END_TAG.length;
        const remaining = contentBuffer.slice(afterPos).trimStart();
        contentBuffer = '';
        if (remaining) {
            events.push(...streamBlockState.emitTextDelta(remaining));
        }

        return events;
    };

    return {
        processNativeThinkingDelta(text) {
            return [
                ...ensureThinkingBlockStarted(),
                ...emitThinkingDelta(text)
            ];
        },

        processContentChunk(unescapedContent) {
            if (!enableThinking) {
                const events = [];
                if (thinkingBlockIndex !== null && !thinkingBlockClosed && !streamBlockState.hasOpenTextBlock()) {
                    events.push(...closeThinkingBlock());
                }
                events.push(...streamBlockState.emitTextDelta(unescapedContent));
                return events;
            }

            const events = [];
            contentBuffer += unescapedContent;

            while (true) {
                if (!insideThinkingTag && !thinkingExtracted) {
                    const thinkingStartIdx = findRealThinkingStartTag(contentBuffer);

                    if (thinkingStartIdx === null) {
                        const safeLen = Math.max(0, contentBuffer.length - THINKING_START_TAG.length);
                        if (safeLen > 0) {
                            const safeContent = contentBuffer.slice(0, safeLen);
                            if (safeContent && safeContent.trim()) {
                                events.push(...streamBlockState.emitTextDelta(safeContent));
                                contentBuffer = contentBuffer.slice(safeLen);
                            }
                        }
                        break;
                    }

                    const textBeforeThinking = contentBuffer.slice(0, thinkingStartIdx);
                    if (textBeforeThinking && textBeforeThinking.trim()) {
                        events.push(...streamBlockState.emitTextDelta(textBeforeThinking));
                    }

                    contentBuffer = contentBuffer.slice(thinkingStartIdx + THINKING_START_TAG.length);
                    insideThinkingTag = true;
                    stripThinkingLeadingNewline = true;
                    events.push(...ensureThinkingBlockStarted());
                    continue;
                }

                if (insideThinkingTag) {
                    if (stripThinkingLeadingNewline) {
                        if (contentBuffer.startsWith('\n')) {
                            contentBuffer = contentBuffer.slice(1);
                            stripThinkingLeadingNewline = false;
                        } else if (contentBuffer.length > 0) {
                            stripThinkingLeadingNewline = false;
                        }
                    }

                    const thinkingEndIdx = findRealThinkingEndTag(contentBuffer);

                    if (thinkingEndIdx === null) {
                        const safeLen = Math.max(0, contentBuffer.length - THINKING_END_TAG_WITH_GAP.length);
                        if (safeLen > 0) {
                            const safeContent = contentBuffer.slice(0, safeLen);
                            if (safeContent) {
                                events.push(...emitThinkingDelta(safeContent));
                                contentBuffer = contentBuffer.slice(safeLen);
                            }
                        }
                        break;
                    }

                    const thinkingBeforeEnd = contentBuffer.slice(0, thinkingEndIdx);
                    if (thinkingBeforeEnd) {
                        events.push(...emitThinkingDelta(thinkingBeforeEnd));
                    }

                    insideThinkingTag = false;
                    thinkingExtracted = true;
                    events.push(...closeThinkingBlock());
                    contentBuffer = contentBuffer.slice(thinkingEndIdx + THINKING_END_TAG_WITH_GAP.length);
                    continue;
                }

                if (contentBuffer) {
                    const remaining = contentBuffer;
                    contentBuffer = '';
                    events.push(...streamBlockState.emitTextDelta(remaining));
                }
                break;
            }

            return events;
        },

        flushBufferedPlainTextBeforeToolUse() {
            const events = [...flushToolBoundaryThinkingIfNeeded()];

            if (!enableThinking) {
                return events;
            }

            if (!insideThinkingTag && !thinkingExtracted && contentBuffer) {
                const bufferedText = contentBuffer;
                contentBuffer = '';
                events.push(...streamBlockState.emitTextDelta(bufferedText));
            }

            return events;
        },

        flushRemainingBuffer() {
            if (!enableThinking || contentBuffer.length === 0) {
                return [];
            }

            const events = [];
            if (insideThinkingTag) {
                const boundaryEvents = flushToolBoundaryThinkingIfNeeded();
                if (boundaryEvents.length > 0) {
                    return boundaryEvents;
                }

                events.push(...emitThinkingDelta(contentBuffer));
                insideThinkingTag = false;
                thinkingExtracted = true;
                events.push(...closeThinkingBlock());
            } else {
                events.push(...streamBlockState.emitTextDelta(contentBuffer));
            }

            contentBuffer = '';
            return events;
        },

        closeThinkingBlockIfNeeded() {
            if (thinkingBlockIndex !== null && !thinkingBlockClosed && !streamBlockState.hasOpenTextBlock()) {
                return closeThinkingBlock();
            }
            return [];
        },

        getThinkingContent() {
            return thinkingContent;
        },

        hasThinkingBlock() {
            return thinkingBlockIndex !== null;
        }
    };
}
