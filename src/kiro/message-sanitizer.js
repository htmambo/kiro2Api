/**
 * Message Sanitizer Module
 * 处理消息验证和自动修复，确保消息符合 Kiro API 规则
 *
 * 完全匹配官方 Kiro 源码的 message-history-sanitizer (extension.js:706680-706688)
 *
 * 官方处理流程：
 * 1. ensureStartsWithUserMessage - 确保以 user 消息开始
 * 2. removeEmptyUserMessages - 移除空的 user 消息
 * 3. reorderToolResultMessages - 重新排序工具结果
 * 4. ensureValidToolUsesAndResults - 确保工具调用有对应结果
 * 5. ensureAlternatingMessages - 确保消息交替
 * 6. ensureEndsWithUserMessage - 确保以 user 消息结束
 */

import { createLogger } from '../lib/logger.js';

const logger = createLogger('kiro:message-sanitizer');

/**
 * 提取消息的文本内容
 * @param {Object|Array|string} message - 消息对象、内容数组或字符串
 * @returns {string} 提取的文本内容
 */
export function getContentText(message) {
    if (message == null) {
        return "";
    }
    if (Array.isArray(message)) {
        return message
            .filter(part => part.type === 'text' && part.text)
            .map(part => part.text)
            .join('');
    } else if (typeof message.content === 'string') {
        return message.content;
    } else if (Array.isArray(message.content)) {
        return message.content
            .filter(part => part.type === 'text' && part.text)
            .map(part => part.text)
            .join('');
    }
    return String(message.content || message);
}

/**
 * 重新排序工具结果消息（官方 Kiro: reorderToolResultMessages）
 * 确保 tool_result 紧跟在对应的 tool_use 之后
 * @param {Array} messages - 消息数组
 * @returns {Array} 重新排序后的消息数组
 * @private
 */
function reorderToolResultMessages(messages) {
    // 收集所有 tool_use 的位置和 ID
    const toolUseMap = new Map(); // toolUseId -> messageIndex
    const toolResultMap = new Map(); // toolUseId -> messageIndex

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        if (message.role === 'assistant' && Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'tool_use' && part.id) {
                    toolUseMap.set(part.id, i);
                }
            }
        } else if (message.role === 'user' && Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'tool_result' && part.tool_use_id) {
                    if (!toolResultMap.has(part.tool_use_id)) {
                        toolResultMap.set(part.tool_use_id, i);
                    }
                }
            }
        }
    }

    // 如果没有 tool_use，直接返回
    if (toolUseMap.size === 0) {
        return messages;
    }

    // 重新排序：确保 tool_result 紧跟在 tool_use 之后
    const result = [];
    const processed = new Set();

    for (let i = 0; i < messages.length; i++) {
        if (processed.has(i)) continue;

        const message = messages[i];
        result.push(message);
        processed.add(i);

        // 如果是包含 tool_use 的 assistant 消息，找到对应的 tool_result
        if (message.role === 'assistant' && Array.isArray(message.content)) {
            for (const part of message.content) {
                if (part.type === 'tool_use' && part.id) {
                    const resultIndex = toolResultMap.get(part.id);
                    if (resultIndex !== undefined && resultIndex !== i + 1 && !processed.has(resultIndex)) {
                        result.push(messages[resultIndex]);
                        processed.add(resultIndex);
                    }
                }
            }
        }
    }

    return result;
}

/**
 * 确保工具调用有对应结果（官方 Kiro: ensureValidToolUsesAndResults）
 * 如果 tool_use 没有对应的 tool_result，添加失败的结果
 * @param {Array} messages - 消息数组
 * @returns {Array} 修复后的消息数组
 * @private
 */
function ensureValidToolUsesAndResults(messages) {
    const result = [];

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        result.push(message);

        // 检查 assistant 消息中的 tool_use
        if (message.role === 'assistant' && Array.isArray(message.content)) {
            const toolUses = message.content.filter(p => p.type === 'tool_use');

            if (toolUses.length > 0) {
                // 检查下一条消息是否有对应的 tool_result
                const nextMessage = i + 1 < messages.length ? messages[i + 1] : null;
                const hasToolResults = nextMessage &&
                    nextMessage.role === 'user' &&
                    Array.isArray(nextMessage.content) &&
                    nextMessage.content.some(p => p.type === 'tool_result');

                if (!hasToolResults) {
                    // 没有 tool_result，添加失败的结果（官方: FAILED_TOOL_USE_MESSAGE）
                    const failedToolResults = toolUses.map(tu => ({
                        type: 'tool_result',
                        tool_use_id: tu.id || `toolUse_${Math.random().toString(36).substr(2, 9)}`,
                        content: 'Tool execution failed',
                        is_error: true
                    }));

                    result.push({
                        role: 'user',
                        content: failedToolResults
                    });
                }
            }
        }
    }

    return result;
}

/**
 * Kiro 优化：消息验证和自动修复
 * 完全匹配官方 Kiro 源码的 message-history-sanitizer (extension.js:706680-706688)
 *
 * @param {Array} messages - 消息数组
 * @param {boolean} verboseLogging - 是否启用详细日志
 * @returns {Array} 修复后的消息数组
 */
export function sanitizeMessages(messages, verboseLogging = false) {
    if (!messages || messages.length === 0) {
        return [{
            role: 'user',
            content: 'Hello'
        }];
    }

    let result = [...messages];
    let sanitizeActions = [];  // 收集所有的格式化操作,最后统一输出

    // Step 1: 确保以 user 消息开始（官方: ensureStartsWithUserMessage）
    if (result[0].role !== 'user') {
        sanitizeActions.push('prepend_hello');
        result.unshift({
            role: 'user',
            content: 'Hello'
        });
    }

    // Step 2: 移除空的 user 消息（官方: removeEmptyUserMessages）
    // 保留第一个 user 消息，即使为空
    const firstUserIndex = result.findIndex(m => m.role === 'user');
    const beforeEmpty = result.length;
    result = result.filter((message, index) => {
        if (message.role === 'assistant') return true;
        if (message.role === 'user' && index === firstUserIndex) return true;
        if (message.role === 'user') {
            const content = getContentText(message);
            const hasToolResults = Array.isArray(message.content) &&
                message.content.some(p => p.type === 'tool_result');
            return (content && content.trim() !== '') || hasToolResults;
        }
        return true;
    });
    if (result.length < beforeEmpty) {
        sanitizeActions.push(`removed ${beforeEmpty - result.length} empty messages`);
    }

    // Step 2.5: 过滤格式错误/不完整的 assistant 消息内容
    const beforeInvalid = result.length;
    result = result.filter((message, index) => {
        // 只检查 assistant 消息
        if (message.role !== 'assistant') {
            return true;
        }

        // 如果是数组内容，保留（可能包含 tool_use 等）
        if (Array.isArray(message.content)) {
            return true;
        }

        // 检查字符串内容
        if (typeof message.content === 'string') {
            const content = message.content.trim();

            // 空内容已经在 Step 2 中过滤，这里再检查一次
            if (content === '') {
                return false;
            }

            // 检查是否是不完整的 JSON（以 { 或 [ 开头但无法解析）
            if ((content.startsWith('{') || content.startsWith('['))) {
                try {
                    JSON.parse(content);
                    // 能解析，说明是完整的 JSON，保留
                    return true;
                } catch (e) {
                    // 无法解析，说明是不完整的 JSON，过滤掉
                    logger.info(
                        `[Kiro] Filtered invalid JSON content at message ${index}: ${content.substring(0, 50)}...`
                    );
                    return false;
                }
            }

            // 其他普通文本内容，保留
            return true;
        }

        return true;
    });
    if (result.length < beforeInvalid) {
        sanitizeActions.push(`removed ${beforeInvalid - result.length} invalid messages`);
    }

    // Step 3: 重新排序工具结果（官方: reorderToolResultMessages）
    // 确保 tool_result 紧跟在对应的 tool_use 之后
    result = reorderToolResultMessages(result);

    // Step 4: 确保工具调用有对应结果（官方: ensureValidToolUsesAndResults）
    result = ensureValidToolUsesAndResults(result);

    // Step 5: 确保消息交替（官方: ensureAlternatingMessages）
    const alternating = [result[0]];
    let insertedCount = 0;
    for (let i = 1; i < result.length; i++) {
        const prev = alternating[alternating.length - 1];
        const curr = result[i];

        if (prev.role === curr.role) {
            insertedCount++;
            // 相同 role 连续出现，插入对应消息（官方: UNDERSTOOD_MESSAGE / CONTINUE_MESSAGE）
            if (prev.role === 'user') {
                alternating.push({
                    role: 'assistant',
                    content: 'understood'  // 官方 Kiro 用 "understood"
                });
            } else {
                alternating.push({
                    role: 'user',
                    content: 'Continue'  // 官方 Kiro 用 "Continue"
                });
            }
        }
        alternating.push(curr);
    }
    if (insertedCount > 0) {
        sanitizeActions.push(`inserted ${insertedCount} alternating messages`);
    }

    // Step 6: 确保以 user 消息结束（官方: ensureEndsWithUserMessage）
    if (alternating[alternating.length - 1].role !== 'user') {
        sanitizeActions.push('append_continue');
        alternating.push({
            role: 'user',
            content: 'Continue'
        });
    }

    // 额外步骤：过滤掉不完整的 thinking 块（避免 signature 缺失错误）
    for (const message of alternating) {
        if (Array.isArray(message.content)) {
            message.content = message.content.filter(part => {
                if (part.type !== 'thinking') {
                    return true;
                }
                return false;
            });
        }
    }

    // 只在有实际修改时输出一次汇总信息(减少日志噪音)
    if (sanitizeActions.length > 0 && verboseLogging) {
        logger.info(`[Kiro] Message sanitization: ${sanitizeActions.join(', ')}`);
    }

    return alternating;
}

/**
 * 清理消息历史，确保符合 Kiro API 规则
 * 规则来自官方 Kiro 扩展的 message-history-sanitizer
 * 不仅验证，还会自动修复问题
 *
 * @param {Array} history - 消息历史（会被原地修改）
 * @param {Array} currentToolResults - 当前消息的 toolResults
 */
export function sanitizeMessageHistory(history, currentToolResults) {
    if (!history || history.length === 0) {
        return;
    }

    let fixCount = 0;

    // 规则 1: 如果 assistant 消息有 toolUses，下一条消息必须有匹配的 toolResults
    // 如果没有，移除 toolUses（因为没有对应的结果，继续保留会导致 400 错误）
    for (let i = 0; i < history.length; i++) {
        const message = history[i];

        if (message.assistantResponseMessage?.toolUses?.length > 0) {
            const toolUses = message.assistantResponseMessage.toolUses;
            let toolResults = [];

            // 检查是否是最后一条 history 消息
            if (i === history.length - 1) {
                // toolResults 在 currentMessage 中
                toolResults = currentToolResults || [];
            } else {
                // toolResults 在下一条消息中
                const nextMessage = history[i + 1];
                if (nextMessage?.userInputMessage?.userInputMessageContext?.toolResults) {
                    toolResults = nextMessage.userInputMessage.userInputMessageContext.toolResults;
                }
            }

            // 创建 toolResult IDs 集合
            const toolResultIds = new Set(toolResults.map(tr => tr.toolUseId));

            // 过滤掉没有对应 toolResult 的 toolUses
            const validToolUses = toolUses.filter(tu => toolResultIds.has(tu.toolUseId));

            if (validToolUses.length !== toolUses.length) {
                const removedCount = toolUses.length - validToolUses.length;
                logger.warn(
                    `[Kiro Sanitize] History[${i}]: Removed ${removedCount} orphan toolUses without matching toolResults`
                );
                fixCount++;

                if (validToolUses.length === 0) {
                    // 全部移除，删除 toolUses 字段
                    delete message.assistantResponseMessage.toolUses;
                } else {
                    message.assistantResponseMessage.toolUses = validToolUses;
                }
            }
        }
    }

    // 规则 2: user 消息必须有 content 或 toolResults，否则添加默认内容
    for (let i = 0; i < history.length; i++) {
        const message = history[i];
        if (message.userInputMessage) {
            const hasContent = message.userInputMessage.content && message.userInputMessage.content.trim() !== '';
            const hasToolResults = message.userInputMessage.userInputMessageContext?.toolResults?.length > 0;

            if (!hasContent && !hasToolResults) {
                message.userInputMessage.content = 'Continue';
                logger.warn(`[Kiro Sanitize] History[${i}]: Added default content to empty user message`);
                fixCount++;
            }
        }
    }

    // 规则 3: assistant 消息必须有 content
    for (let i = 0; i < history.length; i++) {
        const message = history[i];
        if (message.assistantResponseMessage) {
            const hasContent = message.assistantResponseMessage.content && message.assistantResponseMessage.content.trim() !== '';
            if (!hasContent) {
                message.assistantResponseMessage.content = message.assistantResponseMessage.toolUses ? 'Calling tools...' : '...';
                logger.warn(`[Kiro Sanitize] History[${i}]: Added default content to empty assistant message`);
                fixCount++;
            }
        }
    }

    // 规则 4: toolUse 必须有 input 字段
    for (let i = 0; i < history.length; i++) {
        const message = history[i];
        if (message.assistantResponseMessage?.toolUses) {
            for (const toolUse of message.assistantResponseMessage.toolUses) {
                if (toolUse.input === undefined) {
                    toolUse.input = {};
                    logger.warn(`[Kiro Sanitize] History[${i}]: Added empty input to toolUse '${toolUse.name}'`);
                    fixCount++;
                }
            }
        }
    }

    // 规则 5: 如果有孤立的 toolResults（没有对应的 toolUses），移除它们
    for (let i = 0; i < history.length; i++) {
        const message = history[i];
        if (message.userInputMessage?.userInputMessageContext?.toolResults?.length > 0) {
            const toolResults = message.userInputMessage.userInputMessageContext.toolResults;

            // 找到前一条 assistant 消息的 toolUseIds
            let prevToolUseIds = new Set();
            if (i > 0 && history[i - 1].assistantResponseMessage?.toolUses) {
                prevToolUseIds = new Set(history[i - 1].assistantResponseMessage.toolUses.map(tu => tu.toolUseId));
            }

            // 过滤掉没有对应 toolUse 的 toolResults
            const validToolResults = toolResults.filter(tr => prevToolUseIds.has(tr.toolUseId));

            if (validToolResults.length !== toolResults.length) {
                const removedCount = toolResults.length - validToolResults.length;
                logger.warn(
                    `[Kiro Sanitize] History[${i}]: Removed ${removedCount} orphan toolResults without matching toolUses`
                );
                fixCount++;

                if (validToolResults.length === 0) {
                    // 全部移除，删除 toolResults
                    delete message.userInputMessage.userInputMessageContext.toolResults;
                    // 如果 context 为空，也删除
                    if (Object.keys(message.userInputMessage.userInputMessageContext).length === 0) {
                        delete message.userInputMessage.userInputMessageContext;
                    }
                } else {
                    message.userInputMessage.userInputMessageContext.toolResults = validToolResults;
                }
            }
        }
    }

    // 规则 6: 截断过长的单条消息内容（防止单条消息超过 AWS 限制）
    // AWS 实际限制 ~223K tokens (~710K chars)，我们设置 200K chars 的单条消息限制
    // 这样多条消息加起来才不会超限
    const MAX_SINGLE_MESSAGE_LENGTH = 200000;  // 200KB 限制（之前太保守只有 64KB）
    for (let i = 0; i < history.length; i++) {
        const message = history[i];

        // 截断 user 消息
        if (message.userInputMessage?.content && message.userInputMessage.content.length > MAX_SINGLE_MESSAGE_LENGTH) {
            const originalLength = message.userInputMessage.content.length;
            const keepStart = Math.floor(MAX_SINGLE_MESSAGE_LENGTH * 0.7);
            const keepEnd = MAX_SINGLE_MESSAGE_LENGTH - keepStart - 100;
            message.userInputMessage.content =
                message.userInputMessage.content.substring(0, keepStart) +
                '\n\n[... content truncated ...]\n\n' +
                message.userInputMessage.content.substring(originalLength - keepEnd);
            logger.warn(
                `[Kiro Sanitize] History[${i}]: Truncated user content from ${originalLength} to ${message.userInputMessage.content.length} chars`
            );
            fixCount++;
        }

        // 截断 assistant 消息
        if (message.assistantResponseMessage?.content && message.assistantResponseMessage.content.length > MAX_SINGLE_MESSAGE_LENGTH) {
            const originalLength = message.assistantResponseMessage.content.length;
            const keepStart = Math.floor(MAX_SINGLE_MESSAGE_LENGTH * 0.7);
            const keepEnd = MAX_SINGLE_MESSAGE_LENGTH - keepStart - 100;
            message.assistantResponseMessage.content =
                message.assistantResponseMessage.content.substring(0, keepStart) +
                '\n\n[... content truncated ...]\n\n' +
                message.assistantResponseMessage.content.substring(originalLength - keepEnd);
            logger.warn(
                `[Kiro Sanitize] History[${i}]: Truncated assistant content from ${originalLength} to ${message.assistantResponseMessage.content.length} chars`
            );
            fixCount++;
        }
    }

    // 规则 7: 确保消息交替 (user → assistant → user)
    // 如果有连续的 user 消息，在它们之间插入占位的 assistant 消息
    // 需要从后往前遍历，避免插入操作影响索引
    for (let i = history.length - 1; i > 0; i--) {
        const prevMessage = history[i - 1];
        const currMessage = history[i];

        // 检查是否有连续的 user 消息（两条都只有 userInputMessage）
        const prevIsUser = prevMessage.userInputMessage && !prevMessage.assistantResponseMessage;
        const currIsUser = currMessage.userInputMessage && !currMessage.assistantResponseMessage;

        if (prevIsUser && currIsUser) {
            // 在 prevMessage 和 currMessage 之间插入一个 assistant 占位消息
            const placeholderAssistant = {
                assistantResponseMessage: {
                    content: 'Continue.',
                    messageId: `placeholder-${Date.now()}-${i}`
                }
            };
            history.splice(i, 0, placeholderAssistant);
            logger.warn(
                `[Kiro Sanitize] Inserted placeholder assistant message between History[${i - 1}] and History[${i}] to fix consecutive user messages`
            );
            fixCount++;
        }
    }

    // 规则 8: 确保消息交替 - 连续的 assistant 消息也需要处理
    // 如果有连续的 assistant 消息，在它们之间插入占位的 user 消息
    for (let i = history.length - 1; i > 0; i--) {
        const prevMessage = history[i - 1];
        const currMessage = history[i];

        // 检查是否有连续的 assistant 消息
        const prevIsAssistant = prevMessage.assistantResponseMessage && !prevMessage.userInputMessage;
        const currIsAssistant = currMessage.assistantResponseMessage && !currMessage.userInputMessage;

        if (prevIsAssistant && currIsAssistant) {
            // 在 prevMessage 和 currMessage 之间插入一个 user 占位消息
            const placeholderUser = {
                userInputMessage: {
                    content: 'Continue',
                    messageId: `placeholder-user-${Date.now()}-${i}`
                }
            };
            history.splice(i, 0, placeholderUser);
            logger.warn(
                `[Kiro Sanitize] Inserted placeholder user message between History[${i - 1}] and History[${i}] to fix consecutive assistant messages`
            );
            fixCount++;
        }
    }

    if (fixCount > 0) {
        logger.info(`[Kiro Sanitize] Applied ${fixCount} fixes to message history`);
    }
}
