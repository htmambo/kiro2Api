/**
 * Kiro API Client Module
 *
 * 提取自 core.js 的 API 调用相关函数
 * 包含：请求发送、响应处理、流式传输、token 计数等功能
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { countTokens } from '@anthropic-ai/tokenizer';
import { streamApiReal } from './streaming.js';
import { parseBracketToolCalls, deduplicateToolCalls } from './tools.js';
import { executeWebSearch, formatSearchResults } from './search.js';
import { MODEL_MAPPING } from './adapter.js';
import { KIRO_CONSTANTS, refreshAccessTokenIfNeeded } from './auth.js';
import { unescapeHTML } from './utils.js';

/**
 * 解析事件流数据块（SSE 格式）
 * 参考 Kiro 官方实现：extension.js:708090
 *
 * @param {Buffer|string} rawData - 原始数据块
 * @returns {Object} 解析后的事件对象 { type, data }
 */
function parseEventStreamChunk(rawData) {
    const rawStr = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData);
    let fullContent = '';
    const toolCalls = [];
    let currentToolCall = null;
    const seenToolUseIds = new Set();

    // 按行分割并解析
    const lines = rawStr.split('\n');
    let eventType = null;
    let eventData = '';

    for (const line of lines) {
        if (line.startsWith('event:')) {
            eventType = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
            eventData = line.substring(5).trim();
        } else if (line === '' && eventType && eventData) {
            // 完整事件，解析 JSON
            try {
                const parsed = JSON.parse(eventData);

                if (eventType === 'assistantMessage') {
                    fullContent += parsed.content || '';
                } else if (eventType === 'toolUse') {
                    const tc = parsed;

                    // 官方逻辑：第一次遇到 toolUseId 时设置 id/name，后续只累积 input
                    if (!seenToolUseIds.has(tc.toolUseId)) {
                        seenToolUseIds.add(tc.toolUseId);

                        if (currentToolCall) {
                            try {
                                currentToolCall.input = JSON.parse(currentToolCall.input);
                            } catch (e) {}
                            toolCalls.push(currentToolCall);
                        }

                        currentToolCall = {
                            toolUseId: tc.toolUseId,
                            name: tc.name || 'unknown',
                            input: ''
                        };
                    }

                    if (currentToolCall && tc.input) {
                        currentToolCall.input += tc.input;
                    }

                    if (tc.stop && currentToolCall) {
                        try {
                            currentToolCall.input = JSON.parse(currentToolCall.input);
                        } catch (e) {}
                        toolCalls.push(currentToolCall);
                        currentToolCall = null;
                    }
                }
            } catch (e) {
                console.warn('[Kiro] Failed to parse event data:', e.message);
            }

            // 重置状态
            eventType = null;
            eventData = '';
        }
    }

    // 处理未完成的工具调用
    if (currentToolCall) {
        try {
            currentToolCall.input = JSON.parse(currentToolCall.input);
        } catch (e) {}
        toolCalls.push(currentToolCall);
    }

    return {
        type: 'chunk',
        content: fullContent,
        toolCalls: toolCalls
    };
}

/**
 * 调用 Kiro API（带重试和错误处理）
 *
 * @param {KiroService} service - KiroService 实例
 * @param {string} conversationId - 对话 ID
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @param {boolean} isStreaming - 是否流式请求
 * @returns {Promise<Object>} API 响应
 */
export async function callApi(service, method, model, body, isRetry = false, retryCount = 0) {
        if (!service.isInitialized) await service.initialize();
        const maxRetries = service.config.REQUEST_MAX_RETRIES || 3;
        const baseDelay = service.config.REQUEST_BASE_DELAY || 1000; // 1 second base delay

        // 检查是否启用 thinking（从 body 或配置中读取）
        const enableThinking = body.thinking?.type === 'enabled' ||
                             body.extended_thinking === true ||
                             service.config.ENABLE_THINKING_BY_DEFAULT === true;

        // 🔍 性能诊断：记录请求构建时间
        const buildStartTime = Date.now();
        const requestData = await service.buildCodewhispererRequest(body.messages, model, body.tools, body.system, enableThinking);
        const buildDuration = Date.now() - buildStartTime;
        if (buildDuration > 100) {
            console.log(`[Kiro Perf] buildCodewhispererRequest took ${buildDuration}ms (messages: ${body.messages?.length || 0})`);
        }

        // ========================================
        // 📤 请求日志
        // ========================================
        const requestStartTime = Date.now();
        const requestJson = JSON.stringify(requestData);
        const requestSizeKB = (requestJson.length / 1024).toFixed(2);
        const conversationState = requestData?.conversationState;

        // 提取当前消息内容预览
        const currentContent = conversationState?.currentMessage?.userInputMessage?.content || '';
        const contentPreview = currentContent.length > 60
            ? currentContent.substring(0, 60) + '...'
            : currentContent;

        // 简洁模式：只显示关键信息
        if (!service.verboseLogging) {
            console.log(`[Kiro] 📤 REQUEST [${model}] - ${new Date().toISOString()}`);
        } else {
            // 详细模式：显示所有信息
            console.log('\n' + '='.repeat(60));
            console.log(`📤 REQUEST [${model}]${isRetry ? ' (retry ' + retryCount + ')' : ''}`);
            console.log('='.repeat(60));
            console.log(`Timestamp: ${new Date().toISOString()}`);
            console.log(`URL: ${model.startsWith('amazonq') ? service.amazonQUrl : service.baseUrl}`);
            console.log(`Messages: ${(conversationState?.history?.length || 0) + 1} | Tools: ${conversationState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools?.length || 0} | System: ${body.system ? 'yes' : 'no'}`);
            console.log(`Request Size: ${requestSizeKB} KB | Thinking: ${enableThinking ? 'enabled' : 'disabled'}`);
            if (conversationState?.conversationId) {
                console.log(`Conversation ID: ${conversationState.conversationId}`);
            }
            console.log(`Message Preview: ${contentPreview}`);
            console.log('='.repeat(60));
        }

        try {
            const token = service.accessToken; // Use the already initialized token
            const headers = {
                'Authorization': `Bearer ${token}`,
                'amz-sdk-invocation-id': `${uuidv4()}`,
            };

            // 当 model 以 kiro-amazonq 开头时，使用 amazonQUrl，否则使用 baseUrl
            const requestUrl = model.startsWith('amazonq') ? service.amazonQUrl : service.baseUrl;
            const response = await service.axiosInstance.post(requestUrl, requestData, { headers });

            // ========================================
            // 📥 响应日志
            // ========================================
            const requestDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
            const responseSize = response.data ? Buffer.byteLength(JSON.stringify(response.data)) : 0;
            const responseSizeKB = (responseSize / 1024).toFixed(2);

            // 简洁模式：只显示关键信息
            if (!service.verboseLogging) {
                console.log(`[Kiro] 📥 RESPONSE [${response.status}] [${requestDuration}s]`);
            } else {
                // 详细模式：显示所有信息
                console.log('\n' + '='.repeat(60));
                console.log(`📥 RESPONSE [${response.status} ${response.statusText}] [${requestDuration}s]`);
                console.log('='.repeat(60));
                console.log(`Response Size: ${responseSizeKB} KB`);
                console.log('='.repeat(60) + '\n');
            }

            return response;
        } catch (error) {
            // ⚠️ Socket 错误处理（UND_ERR_SOCKET, ECONNRESET 等）
            // 这些错误通常是连接池中的连接失效导致的
            const isSocketError = !error.response && (
                error.code === 'ECONNRESET' ||
                error.code === 'ETIMEDOUT' ||
                error.code === 'ENOTFOUND' ||
                error.code === 'UND_ERR_SOCKET' ||
                error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                error.message?.includes('socket') ||
                error.message?.includes('ECONNRESET')
            );

            if (isSocketError && retryCount < maxRetries) {
                console.log(`[Kiro] Socket error detected: ${error.code || error.message}`);
                console.log(`[Kiro] Resetting connection pool and retrying... (attempt ${retryCount + 1}/${maxRetries})`);

                // 重置连接池
                await service.resetConnectionPool();

                // 短暂延迟后重试
                const delay = 1000;
                await new Promise(resolve => setTimeout(resolve, delay));

                return callApi(service, method, model, body, isRetry, retryCount + 1);
            } else if (isSocketError) {
                console.error('[Kiro] Socket error after max retries:', error.code || error.message);
                throw new Error(`Connection failed: ${error.message}. Please check your network or try restarting the service.`);
            }

            // 403 错误处理
            if (error.response?.status === 403 && !isRetry) {
                console.log('[Kiro] Received 403. Attempting token refresh and retrying...');
                try {
                    await initializeAuth(service, true); // Force refresh token
                    return callApi(service, method, model, body, true, retryCount);
                } catch (refreshError) {
                    console.error('[Kiro] Token refresh failed during 403 retry:', refreshError.message);
                    throw refreshError;
                }
            }

            // 400 错误详细日志(帮助调试请求格式问题)
            if (error.response?.status === 400) {
                console.error('[Kiro] ❌ 400 Bad Request Error - Request format issue detected');
                console.error('[Kiro] Error details:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: JSON.stringify(error.response.data).substring(0, 500),
                    headers: error.response.headers
                });
                // 打印请求体的关键信息帮助调试
                try {
                    const reqState = requestData?.conversationState;
                    console.error('[Kiro] Request debug info:', {
                        historyLength: reqState?.history?.length || 0,
                        hasCurrentMessage: !!reqState?.currentMessage,
                        currentMsgType: reqState?.currentMessage?.userInputMessage ? 'userInputMessage' : 'unknown',
                        currentMsgContentLen: reqState?.currentMessage?.userInputMessage?.content?.length || 0,
                        hasTools: !!(reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools),
                        toolsCount: reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools?.length || 0,
                        hasToolResults: !!(reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.toolResults),
                        toolResultsCount: reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.toolResults?.length || 0,
                    });

                    // ⚠️ 关键调试：打印 toolResults 结构
                    const toolResults = reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.toolResults;
                    if (toolResults && toolResults.length > 0) {
                        console.error('[Kiro] ToolResults structure:', JSON.stringify(toolResults.map(tr => ({
                            toolUseId: tr.toolUseId,
                            status: tr.status,
                            hasContent: !!tr.content,
                            contentType: Array.isArray(tr.content) ? 'array' : typeof tr.content,
                            contentLength: tr.content ? (Array.isArray(tr.content) ? tr.content.length : String(tr.content).length) : 0,
                            // 新增：打印 content 详细结构
                            contentDetail: Array.isArray(tr.content) ? tr.content.map(c => ({
                                type: typeof c,
                                hasText: !!c?.text,
                                textLen: c?.text?.length || 0,
                                textPreview: c?.text?.substring(0, 100) || ''
                            })) : null
                        })), null, 2));
                    }

                    // ⚠️ 关键调试：打印 history 中的 toolUses
                    if (reqState?.history) {
                        for (let idx = 0; idx < reqState.history.length; idx++) {
                            const h = reqState.history[idx];
                            if (h.userInputMessage) {
                                console.error(`[Kiro] History[${idx}] userInputMessage.content length:`, h.userInputMessage.content?.length || 0);
                            }
                            if (h.assistantResponseMessage) {
                                console.error(`[Kiro] History[${idx}] assistantResponseMessage.content length:`, h.assistantResponseMessage.content?.length || 0);
                                if (h.assistantResponseMessage.toolUses) {
                                    // ⚠️ 增强调试：打印完整的 toolUse 结构，检查是否有 input 字段
                                    console.error(`[Kiro] History[${idx}] toolUses:`, JSON.stringify(h.assistantResponseMessage.toolUses.map(tu => ({
                                        toolUseId: tu.toolUseId,
                                        name: tu.name,
                                        hasInput: tu.input !== undefined,
                                        inputType: typeof tu.input,
                                        inputKeys: tu.input && typeof tu.input === 'object' ? Object.keys(tu.input) : null
                                    }))));
                                }
                            }
                        }
                    }
                } catch (debugErr) {
                    console.error('[Kiro] Failed to log request debug info:', debugErr.message);
                }
                // 400 错误是请求格式问题,属于致命错误,直接抛出(会被health check捕获)
                throw error;
            }

            // 429 限流错误处理(暂时性错误,不应标记为不健康)
            if (error.response?.status === 429) {
                if (retryCount < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retryCount);
                    console.log(`[Kiro] Received 429 (Rate Limit). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return callApi(service, method, model, body, isRetry, retryCount + 1);
                } else {
                    // 429 重试次数用尽,包装成特殊错误类型
                    const rateLimitError = new Error('RATE_LIMIT_EXCEEDED');
                    rateLimitError.isRateLimitError = true;  // 标记为限流错误
                    rateLimitError.retryable = true;  // 标记为可重试(不应标记账号不健康)
                    throw rateLimitError;
                }
            }

            // 5xx 服务器错误处理(可重试)
            if (error.response?.status >= 500 && error.response?.status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[Kiro] Received ${error.response.status} server error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return callApi(service, method, model, body, isRetry, retryCount + 1);
            }

            // 其他错误
            console.error('[Kiro] API call failed:', error.message);
            if (error.response) {
                console.error('[Kiro] Response status:', error.response.status);
                console.error('[Kiro] Response data:', JSON.stringify(error.response.data).substring(0, 300));
            }
            throw error;
        }
    }

/**
 * 处理 API 响应（非流式）
 *
 * @param {Object} response - Axios 响应对象
 * @param {KiroService} service - KiroService 实例
 * @returns {Object} 处理后的响应数据
 */

function processApiResponse(response) {
        const rawResponseText = Buffer.isBuffer(response.data) ? response.data.toString('utf8') : String(response.data);
        //console.log(`[Kiro] Raw response length: ${rawResponseText.length}`);
        if (rawResponseText.includes("[Called")) {
            console.log("[Kiro] Raw response contains [Called marker.");
        }

        // 1. Parse structured events and bracket calls from parsed content
        const parsedFromEvents = parseEventStreamChunk(rawResponseText);
        let fullResponseText = parsedFromEvents.content;
        let allToolCalls = [...parsedFromEvents.toolCalls]; // clone
        //console.log(`[Kiro] Found ${allToolCalls.length} tool calls from event stream parsing.`);

        // 2. Crucial fix from Python example: Parse bracket tool calls from the original raw response
        const rawBracketToolCalls = parseBracketToolCalls(rawResponseText);
        if (rawBracketToolCalls) {
            //console.log(`[Kiro] Found ${rawBracketToolCalls.length} bracket tool calls in raw response.`);
            allToolCalls.push(...rawBracketToolCalls);
        }

        // 3. Deduplicate all collected tool calls
        const uniqueToolCalls = deduplicateToolCalls(allToolCalls);
        //console.log(`[Kiro] Total unique tool calls after deduplication: ${uniqueToolCalls.length}`);

        // 4. Clean up response text by removing all tool call syntax from the final text.
        // The text from parseEventStreamChunk is already partially cleaned.
        // We re-clean here with all unique tool calls to be certain.
        if (uniqueToolCalls.length > 0) {
            for (const tc of uniqueToolCalls) {
                const funcName = tc.function.name;
                const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`\\[Called\\s+${escapedName}\\s+with\\s+args:\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}\\]`, 'gs');
                fullResponseText = fullResponseText.replace(pattern, '');
            }
            fullResponseText = fullResponseText.replace(/\s+/g, ' ').trim();
        }
        
        //console.log(`[Kiro] Final response text after tool call cleanup: ${fullResponseText}`);
        //console.log(`[Kiro] Final tool calls after deduplication: ${JSON.stringify(uniqueToolCalls)}`);
        return { responseText: fullResponseText, toolCalls: uniqueToolCalls };
    }

/**
 * 生成内容（非流式）
 *
 * @param {KiroService} service - KiroService 实例
 * @param {string} conversationId - 对话 ID
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @returns {Promise<Object>} 生成的内容
 */
export async function generateContent(service, model, requestBody) {
    if (typeof service?.initialize !== 'function') {
        throw new Error('Service does not support initialize()');
    }

        if (!service.isInitialized) await service.initialize();

        // 官方AWS SDK逻辑：检查并刷新token（5分钟窗口+30秒防抖）
        await refreshAccessTokenIfNeeded(service);

        // Kiro 官方逻辑：如果model在MODEL_MAPPING中则使用，否则使用默认模型
        const finalModel = MODEL_MAPPING[model] ? model : service.modelName;
        if (service.verboseLogging) {
            console.log(`[Kiro] Calling generateContent with model: ${finalModel}`);
        }

        // Estimate input tokens before making the API call
        const inputTokens = estimateInputTokens(requestBody);
        console.log(`[Kiro Token] generateContent estimateInputTokens: ${inputTokens} tokens (${requestBody.messages?.length || 0} messages)`);
        
        const response = await callApi(service, '', finalModel, requestBody);

        try {
            const { responseText, toolCalls } = processApiResponse(response);
            return buildClaudeResponse(responseText, false, 'assistant', model, toolCalls, inputTokens);
        } catch (error) {
            console.error('[Kiro] Error in generateContent:', error);
            throw new Error(`Error processing response: ${error.message}`);
        }
    }


/**
 * 流式 API 调用（旧版包装器，保持向后兼容）
 *
 * @param {KiroService} service - KiroService 实例
 * @param {string} conversationId - 对话 ID
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @returns {AsyncGenerator} 事件流
 */
export async function* streamApi(service, conversationId, model, requestBody) {
    yield* streamApiReal(service, conversationId, model, requestBody);
}

/**
 * 生成内容（流式）
 *
 * @param {KiroService} service - KiroService 实例
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @returns {AsyncGenerator} 事件流
 */
export async function* generateContentStream(service, model, requestBody) {
        if (!service.isInitialized) await service.initialize();

        // 官方AWS SDK逻辑：检查并刷新token（5分钟窗口+30秒防抖）
        await refreshAccessTokenIfNeeded(service);
        // Kiro 官方逻辑：如果model在MODEL_MAPPING中则使用，否则使用默认模型
        const finalModel = MODEL_MAPPING[model] ? model : service.modelName;

        // 检查是否启用 thinking（通过 prompt injection 实现，支持配置默认启用）
        const enableThinking = requestBody.thinking?.type === 'enabled' ||
                             requestBody.extended_thinking === true ||
                             service.config.ENABLE_THINKING_BY_DEFAULT === true;
        if (service.verboseLogging) {
            console.log(`[Kiro] Calling generateContentStream with model: ${finalModel} (real streaming, thinking: ${enableThinking})`);
        }

        // ⚠️ 性能计时：token 估算
        const tokenStartTime = Date.now();
        const inputTokens = estimateInputTokens(requestBody);
        const tokenDuration = Date.now() - tokenStartTime;
        // ⚠️ 调试：打印 token 计算结果
        console.log(`[Kiro Token] estimateInputTokens: ${inputTokens} tokens (${requestBody.messages?.length || 0} messages, ${tokenDuration}ms)`);
        const messageId = `${uuidv4()}`;
        
        try {
            // 1. 先发送 message_start 事件
            yield {
                type: "message_start",
                message: {
                    id: messageId,
                    type: "message",
                    role: "assistant",
                    model: model,
                    usage: { input_tokens: inputTokens, output_tokens: 0 },
                    content: []
                }
            };

            let totalContent = '';
            let outputTokens = 0;
            const toolCalls = [];
            let currentToolCall = null;  // 用于累积结构化工具调用
            const seenToolUseIds = new Set();  // ⚠️ CRITICAL: 追踪所有见过的 toolUseId（参考官方 Kiro 客户端）
            let thinkingContent = '';  // 用于累积thinking内容
            let thinkingBlockIndex = null;  // thinking块的索引
            let textBlockStarted = false;  // 标记text块是否已开始
            const codeReferences = [];  // 用于累积代码引用

            // Thinking 解析状态（用于 prompt injection 模式）
            let contentBuffer = '';  // 用于缓冲内容以解析 <thinking> 标签
            let insideThinkingTag = false;  // 是否在 <thinking> 标签内
            let thinkingTagClosed = false;  // <thinking> 标签是否已关闭
            let thinkingBlockClosed = false;  // thinking 块是否已关闭（用于避免重复关闭）

            // 2-3. 流式接收并发送每个事件
            for await (const event of streamApiReal(service, '', finalModel, requestBody)) {
                // Debug: 记录事件类型（仅在调试时启用，生产环境注释掉以提升性能）
                // console.log(`[Kiro Debug] Event received: type=${event.type}`);

                if (event.type === 'thinking') {
                    // 处理原生thinking块（API直接返回的，目前Kiro不支持）
                    if (thinkingBlockIndex === null) {
                        // 第一次收到thinking，发送content_block_start
                        thinkingBlockIndex = 0;  // thinking总是第一个块
                        yield {
                            type: "content_block_start",
                            index: thinkingBlockIndex,
                            content_block: { type: "thinking", thinking: "" }
                        };
                    }

                    thinkingContent += event.data.thinking;

                    // 发送thinking delta
                    yield {
                        type: "content_block_delta",
                        index: thinkingBlockIndex,
                        delta: { type: "thinking_delta", thinking: event.data.thinking }
                    };
                } else if (event.type === 'content' && event.content) {
                    // Kiro 优化：HTML 转义处理
                    const unescapedContent = unescapeHTML(event.content);

                    // 如果启用了 thinking prompt injection，需要解析 <thinking> 标签
                    if (enableThinking) {
                        contentBuffer += unescapedContent;

                        // 处理 content buffer，解析 <thinking> 标签
                        while (true) {
                            if (!insideThinkingTag) {
                                // 当前不在 thinking 标签内，查找 <thinking> 开始标签
                                const thinkingStartIdx = contentBuffer.indexOf('<thinking>');

                                if (thinkingStartIdx === -1) {
                                    // 没有找到完整的 <thinking> 标签
                                    // ⚠️ 优化：快速判断是否可能有 thinking 标签
                                    // 1. 如果 buffer 不以 < 开头且长度 > 0，肯定没有 thinking → 立即输出
                                    // 2. 如果 buffer 以 < 开头但不是 <thinking>... 前缀，也立即输出
                                    // 3. 如果是 <thinking> 的前缀（如 "<t", "<think"），等待更多数据

                                    let canEmitImmediately = false;
                                    if (contentBuffer.length > 0 && !contentBuffer.startsWith('<')) {
                                        // 不以 < 开头，肯定没有 thinking
                                        canEmitImmediately = true;
                                    } else if (contentBuffer.startsWith('<') && contentBuffer.length >= 10) {
                                        // 以 < 开头且长度足够判断（<thinking> 是 10 字符）
                                        // 如果不是 <thinking> 的前缀，可以输出
                                        if (!('<thinking>'.startsWith(contentBuffer.slice(0, 10)))) {
                                            canEmitImmediately = true;
                                        }
                                    }

                                    const shouldEmit = thinkingTagClosed || canEmitImmediately ||
                                                      (thinkingBlockIndex === null && contentBuffer.length > 15);

                                    if (shouldEmit && contentBuffer.length > 0) {
                                        // 计算保留字符数
                                        // - 如果确定没有 thinking，只保留 1 字符
                                        // - 如果 thinking 已结束，保留 15 字符防止新 thinking 块
                                        const keepChars = (canEmitImmediately || thinkingBlockIndex === null) ? 1 : 15;
                                        const textToEmit = contentBuffer.length > keepChars
                                            ? contentBuffer.slice(0, -keepChars)
                                            : (canEmitImmediately ? contentBuffer : '');

                                        if (textToEmit) {
                                            contentBuffer = canEmitImmediately && contentBuffer.length <= keepChars
                                                ? ''
                                                : contentBuffer.slice(-keepChars);
                                            // 发送 text 内容
                                            if (!textBlockStarted) {
                                                const textBlockIndex = thinkingContent ? 1 : 0;
                                                yield {
                                                    type: "content_block_start",
                                                    index: textBlockIndex,
                                                    content_block: { type: "text", text: "" }
                                                };
                                                textBlockStarted = true;
                                            }

                                            totalContent += textToEmit;
                                            const textBlockIndex = thinkingContent ? 1 : 0;
                                            yield {
                                                type: "content_block_delta",
                                                index: textBlockIndex,
                                                delta: { type: "text_delta", text: textToEmit }
                                            };
                                        }
                                    }
                                    break; // 退出循环，等待更多数据
                                }

                                // 找到 <thinking> 开始标签
                                // 先发送标签之前的文本内容
                                if (thinkingStartIdx > 0) {
                                    const textBeforeThinking = contentBuffer.slice(0, thinkingStartIdx);

                                    if (textBeforeThinking.trim()) {
                                        // 发送 text 内容
                                        if (!textBlockStarted) {
                                            const textBlockIndex = thinkingContent ? 1 : 0;
                                            yield {
                                                type: "content_block_start",
                                                index: textBlockIndex,
                                                content_block: { type: "text", text: "" }
                                            };
                                            textBlockStarted = true;
                                        }

                                        totalContent += textBeforeThinking;
                                        const textBlockIndex = thinkingContent ? 1 : 0;
                                        yield {
                                            type: "content_block_delta",
                                            index: textBlockIndex,
                                            delta: { type: "text_delta", text: textBeforeThinking }
                                        };
                                    }
                                }

                                // 移除已处理的内容和 <thinking> 标签
                                contentBuffer = contentBuffer.slice(thinkingStartIdx + 10); // 10 = "<thinking>".length
                                insideThinkingTag = true;

                                // 开始 thinking 块
                                if (thinkingBlockIndex === null) {
                                    thinkingBlockIndex = 0;
                                    yield {
                                        type: "content_block_start",
                                        index: thinkingBlockIndex,
                                        content_block: { type: "thinking", thinking: "" }
                                    };
                                }
                            } else {
                                // 当前在 thinking 标签内，查找 </thinking> 结束标签
                                const thinkingEndIdx = contentBuffer.indexOf('</thinking>');

                                if (thinkingEndIdx === -1) {
                                    // 没有找到结束标签，发送当前缓冲的 thinking 内容
                                    // 保留最后 15 个字符以防标签被分割
                                    if (contentBuffer.length > 15) {
                                        const thinkingToEmit = contentBuffer.slice(0, -15);
                                        contentBuffer = contentBuffer.slice(-15);

                                        if (thinkingToEmit) {
                                            thinkingContent += thinkingToEmit;
                                            yield {
                                                type: "content_block_delta",
                                                index: thinkingBlockIndex,
                                                delta: { type: "thinking_delta", thinking: thinkingToEmit }
                                            };
                                        }
                                    }
                                    break; // 退出循环，等待更多数据
                                }

                                // 找到 </thinking> 结束标签
                                // 发送标签之前的 thinking 内容
                                if (thinkingEndIdx > 0) {
                                    const thinkingBeforeEnd = contentBuffer.slice(0, thinkingEndIdx);
                                    thinkingContent += thinkingBeforeEnd;
                                    yield {
                                        type: "content_block_delta",
                                        index: thinkingBlockIndex,
                                        delta: { type: "thinking_delta", thinking: thinkingBeforeEnd }
                                    };
                                }

                                // 结束 thinking 块
                                yield { type: "content_block_stop", index: thinkingBlockIndex };
                                thinkingBlockClosed = true;

                                // 移除已处理的内容和 </thinking> 标签
                                contentBuffer = contentBuffer.slice(thinkingEndIdx + 11); // 11 = "</thinking>".length
                                insideThinkingTag = false;
                                thinkingTagClosed = true;
                            }
                        }
                    } else {
                        // 不启用 thinking，直接发送内容
                        // 如果之前有thinking块但还没结束，先结束它
                        if (thinkingBlockIndex !== null && thinkingContent && !textBlockStarted) {
                            yield { type: "content_block_stop", index: thinkingBlockIndex };
                        }

                        // 第一次收到content时，发送text块的content_block_start
                        if (!textBlockStarted) {
                            const textBlockIndex = thinkingContent ? 1 : 0;
                            yield {
                                type: "content_block_start",
                                index: textBlockIndex,
                                content_block: { type: "text", text: "" }
                            };
                            textBlockStarted = true;
                        }

                        totalContent += event.content;

                        const textBlockIndex = thinkingContent ? 1 : 0;
                        yield {
                            type: "content_block_delta",
                            index: textBlockIndex,
                            delta: { type: "text_delta", text: event.content }
                        };
                    }
                } else if (event.type === 'toolUse') {
                    // 工具调用事件（完美复刻官方 Kiro extension.js:708085-708123）
                    const tc = event.toolUse;

                    if (tc && tc.toolUseId) {
                        // ⚠️ 完美复刻官方逻辑（extension.js:708090）：
                        // if (!toolCalls.has(toolUseId)) { 添加 id/name } else { 只处理 input }

                        if (!seenToolUseIds.has(tc.toolUseId)) {
                            // 第一次遇到这个 toolUseId
                            seenToolUseIds.add(tc.toolUseId);

                            // 如果有未完成的工具调用，先保存它
                            if (currentToolCall) {
                                try {
                                    currentToolCall.input = JSON.parse(currentToolCall.input);
                                } catch (e) {}
                                toolCalls.push(currentToolCall);
                            }

                            // 创建新的 currentToolCall（设置 id/name）
                            currentToolCall = {
                                toolUseId: tc.toolUseId,
                                name: tc.name || 'unknown',
                                input: ''
                            };
                        }

                        // ⚠️ 关键：每次都累积 input（无论是否第一次）
                        if (currentToolCall && tc.input) {
                            currentToolCall.input += tc.input;
                        }

                        // 如果有 stop 标志，保存 currentToolCall
                        if (tc.stop && currentToolCall) {
                            try {
                                currentToolCall.input = JSON.parse(currentToolCall.input);
                            } catch (e) {
                                // JSON 解析失败，保留原始字符串
                            }

                            // ⭐ 服务端执行 webSearch 工具
                            if (currentToolCall.name === 'webSearch') {
                                if (serviceverboseLogging) {
                                    console.log('[Kiro WebSearch] Detected webSearch tool call, executing on server...');
                                }
                                currentToolCall.serverSideExecute = true;  // 标记为服务端执行
                            }

                            toolCalls.push(currentToolCall);
                            currentToolCall = null;
                        }
                    }
                } else if (event.type === 'metering') {
                    // Token 计量事件
                    const meterData = event.data;
                    if (meterData.usage !== undefined) {
                        // Kiro 返回的是 credit usage，需要转换为 token
                        const estimatedTokens = Math.ceil(meterData.usage * 1000);
                        outputTokens = estimatedTokens;
                    }
                } else if (event.type === 'codeReference') {
                    // ⭐ 代码引用追踪事件（官方 Kiro 特性）
                    // 收集代码引用信息，用于开源许可证追踪和代码溯源
                    const references = event.data.references;
                    if (references && references.length > 0) {
                        codeReferences.push(...references);
                        if (service.verboseLogging) {
                            console.log(`[Kiro] Code references detected: ${references.length} sources`);
                        }
                    }
                }
            }

            // 处理未完成的工具调用（如果流提前结束）
            if (currentToolCall) {
                try {
                    currentToolCall.input = JSON.parse(currentToolCall.input);
                } catch (e) {}
                toolCalls.push(currentToolCall);
                currentToolCall = null;
            }

            // 处理 thinking 模式下剩余的 content buffer
            if (enableThinking && contentBuffer.length > 0) {
                if (insideThinkingTag) {
                    // 如果还在 thinking 标签内，发送剩余内容作为 thinking
                    thinkingContent += contentBuffer;
                    yield {
                        type: "content_block_delta",
                        index: thinkingBlockIndex,
                        delta: { type: "thinking_delta", thinking: contentBuffer }
                    };
                    // 结束 thinking 块
                    yield { type: "content_block_stop", index: thinkingBlockIndex };
                    thinkingBlockClosed = true;
                } else {
                    // 不在 thinking 标签内，发送剩余内容作为 text
                    if (contentBuffer.trim()) {
                        if (!textBlockStarted) {
                            const textBlockIndex = thinkingContent ? 1 : 0;
                            yield {
                                type: "content_block_start",
                                index: textBlockIndex,
                                content_block: { type: "text", text: "" }
                            };
                            textBlockStarted = true;
                        }

                        totalContent += contentBuffer;
                        const textBlockIndex = thinkingContent ? 1 : 0;
                        yield {
                            type: "content_block_delta",
                            index: textBlockIndex,
                            delta: { type: "text_delta", text: contentBuffer }
                        };
                    }
                }
                contentBuffer = '';
            }

            // 检查文本内容中的 bracket 格式工具调用
            const bracketToolCalls = parseBracketToolCalls(totalContent);
            if (bracketToolCalls && bracketToolCalls.length > 0) {
                for (const btc of bracketToolCalls) {
                    toolCalls.push({
                        toolUseId: btc.id || `tool_${uuidv4()}`,
                        name: btc.function.name,
                        input: JSON.parse(btc.function.arguments || '{}')
                    });
                }
            }

            // 3.5. 如果thinking块还没结束，先结束它
            if (thinkingBlockIndex !== null && thinkingContent && !textBlockStarted && !thinkingBlockClosed) {
                yield { type: "content_block_stop", index: thinkingBlockIndex };
                thinkingBlockClosed = true;
            }

            // 4. 发送 content_block_stop 事件（text块，如果有的话）
            if (textBlockStarted) {
                const textBlockIndex = thinkingContent ? 1 : 0;
                yield { type: "content_block_stop", index: textBlockIndex };
            }

            // ⭐ 4.5. 处理服务端执行的工具（webSearch）
            // 如果有 webSearch 工具调用，执行搜索并将结果作为额外内容返回
            const serverSideTools = toolCalls.filter(tc => tc.serverSideExecute);
            const clientSideTools = toolCalls.filter(tc => !tc.serverSideExecute);

            if (serverSideTools.length > 0) {
                if (service.verboseLogging) {
                    console.log(`[Kiro WebSearch] Processing ${serverSideTools.length} server-side tool calls...`);
                }

                let searchResultsContent = '';
                for (const tc of serverSideTools) {
                    if (tc.name === 'webSearch') {
                        const query = tc.input?.query || tc.input;
                        if (query) {
                            // 执行搜索
                            const searchResult = await executeWebSearch(query, service.verboseLogging);
                            const searchResultText = formatSearchResults(searchResult);
                            searchResultsContent += `\n\n---\n**Web Search Results for "${query}":**\n${searchResultText}`;
                        }
                    }
                }

                // 如果有搜索结果，发送为额外的文本内容
                if (searchResultsContent) {
                    const searchBlockIndex = (thinkingContent ? 1 : 0) + (textBlockStarted ? 1 : 0);

                    // 发送搜索结果文本块
                    yield {
                        type: "content_block_start",
                        index: searchBlockIndex,
                        content_block: { type: "text", text: "" }
                    };

                    yield {
                        type: "content_block_delta",
                        index: searchBlockIndex,
                        delta: { type: "text_delta", text: searchResultsContent }
                    };

                    yield { type: "content_block_stop", index: searchBlockIndex };

                    totalContent += searchResultsContent;
                    if (service.verboseLogging) {
                        console.log('[Kiro WebSearch] Search results added to response');
                    }
                }
            }

            // 5. 处理工具调用（如果有，只处理客户端执行的工具）
            if (clientSideTools.length > 0) {
                // 计算起始索引：thinking块(0或无) + text块(0或1) + 搜索结果块(如果有)
                let startIndex = 0;
                if (thinkingContent) startIndex++;  // thinking块占用index 0
                if (textBlockStarted) startIndex++;  // text块占用下一个index
                if (serverSideTools.length > 0) startIndex++;  // 搜索结果块

                for (let i = 0; i < clientSideTools.length; i++) {
                    const tc = clientSideTools[i];
                    const blockIndex = startIndex + i;

                    // ⚠️ 关键：反向映射参数名（Kiro → CC）
                    // Kiro 返回的参数使用 Kiro 的参数名（如 path, explanation）
                    // 需要转换回 CC 的参数名（如 file_path）并过滤 CC 不支持的参数
                    let toolInput = tc.input || {};
                    if (typeof toolInput === 'string') {
                        try {
                            toolInput = JSON.parse(toolInput);
                        } catch (e) {
                            // ⚠️ 修复：不完整的工具调用应该被跳过
                            // 打印详细日志帮助调试
                            console.warn(`[Kiro] Failed to parse tool input as JSON for ${tc.name}:`, toolInput.substring(0, 100));
                            console.warn(`[Kiro] Skipping incomplete tool call: ${tc.name} (toolUseId: ${tc.toolUseId})`);
                            // 跳过这个工具调用，不要发送空参数
                            continue;
                        }
                    }

                    // 检查必需参数是否存在（针对 Write 工具）
                    if (tc.name === 'Write' || tc.name === 'write_file') {
                        const hasFilePath = toolInput.file_path || toolInput.path;
                        const hasContent = toolInput.content !== undefined;
                        if (!hasFilePath || !hasContent) {
                            console.warn(`[Kiro] Incomplete Write tool call - missing required params. file_path: ${!!hasFilePath}, content: ${!!hasContent}`);
                            console.warn(`[Kiro] Skipping incomplete Write tool call (toolUseId: ${tc.toolUseId})`);
                            continue;
                        }
                    }

                    yield {
                        type: "content_block_start",
                        index: blockIndex,
                        content_block: {
                            type: "tool_use",
                            id: tc.toolUseId || `tool_${uuidv4()}`,
                            name: tc.name,
                            input: {}
                        }
                    };

                    const reversedInput = service.reverseMapToolInput(tc.name, toolInput);
                    const inputJson = JSON.stringify(reversedInput);

                    yield {
                        type: "content_block_delta",
                        index: blockIndex,
                        delta: {
                            type: "input_json_delta",
                            partial_json: inputJson
                        }
                    };

                    yield { type: "content_block_stop", index: blockIndex };
                }
            }

            // 6. 发送代码引用信息（如果有）
            // ⭐ Kiro 特性：追踪 AI 生成代码的来源，符合开源许可证要求
            if (codeReferences.length > 0) {
                yield {
                    type: "code_references",
                    references: codeReferences.map(ref => ({
                        license: ref.licenseName,
                        repository: ref.repository,
                        url: ref.url,
                        recommendationContentSpan: ref.recommendationContentSpan
                    }))
                };
            }

            // 7. 发送 message_delta 事件
            // 在流结束后统一计算 output tokens，避免在流式循环中阻塞事件循环
            outputTokens = countTextTokens(totalContent);
            if (thinkingContent) {
                outputTokens += countTextTokens(thinkingContent);
            }
            for (const tc of clientSideTools) {
                outputTokens += countTextTokens(JSON.stringify(tc.input || {}));
            }

            yield {
                type: "message_delta",
                delta: { stop_reason: clientSideTools.length > 0 ? "tool_use" : "end_turn" },
                usage: { output_tokens: outputTokens }
            };

            // 8. 发送 message_stop 事件
            yield { type: "message_stop" };

        } catch (error) {
            console.error('[Kiro] Error in streaming generation:', error);
            console.error('[Kiro] Error stack:', error.stack);

            // ⚠️ CRITICAL FIX: 如果stream已经开始传输,不能throw error,应该yield error event
            // 这样客户端能看到错误信息而不是静默断开
            yield {
                type: "error",
                error: {
                    type: error.response?.status === 429 ? "rate_limit_error" :
                          error.response?.status === 403 ? "permission_error" :
                          error.response?.status === 401 ? "authentication_error" : "api_error",
                    message: error.message || "An error occurred during streaming"
                }
            };

            // 然后才throw,让上层知道stream失败了
            throw new Error(`Error processing response: ${error.message}`);
        }
    }


/**
 * 计算文本的 token 数
 *
 * @param {string} text - 文本内容
 * @param {boolean} fast - 是否使用快速估算
 * @returns {number} token 数量
 */
export function countTextTokens(text, fast = false) {
    if (!text) return 0;

    // 快速模式：使用字符估算
    if (fast) {
        // Claude tokenizer 实测：中文约 2.5 token/字，英文约 0.35 token/字符
        const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const totalLength = text.length;
        const nonChineseLength = totalLength - chineseCharCount;
        return Math.ceil(chineseCharCount * 2.5 + nonChineseLength * 0.35);
    }

    try {
        return countTokens(text);
    } catch (error) {
        // Fallback to estimation if tokenizer fails
        return Math.ceil((text || '').length / 4);
    }
}

/**
 * 估算请求的输入 token 数
 *
 * @param {Object} requestBody - 请求体
 * @param {boolean} fast - 是否使用快速估算
 * @returns {number} 估算的 token 数
 */
export function estimateInputTokens(requestBody, fast = true) {
    let totalTokens = 0;

    // 计算系统提示词 tokens
    if (requestBody.system) {
        const systemText = typeof requestBody.system === 'string'
            ? requestBody.system
            : JSON.stringify(requestBody.system);
        totalTokens += countTextTokens(systemText, fast);
    }

    // 计算消息 tokens
    if (requestBody.messages && Array.isArray(requestBody.messages)) {
        for (const message of requestBody.messages) {
            if (typeof message.content === 'string') {
                totalTokens += countTextTokens(message.content, fast);
            } else if (Array.isArray(message.content)) {
                for (const part of message.content) {
                    if (part.type === 'text' && part.text) {
                        totalTokens += countTextTokens(part.text, fast);
                    } else if (part.type === 'tool_result' && part.content) {
                        const toolResultText = typeof part.content === 'string'
                            ? part.content
                            : JSON.stringify(part.content);
                        totalTokens += countTextTokens(toolResultText, fast);
                    } else if (part.type === 'tool_use' && part.input) {
                        totalTokens += countTextTokens(JSON.stringify(part.input), fast);
                    } else if (part.type === 'image') {
                        totalTokens += 1500; // 图片约 1500 tokens
                    }
                }
            }
        }
    }

    // 计算工具定义 tokens
    if (requestBody.tools && Array.isArray(requestBody.tools)) {
        if (fast) {
            let toolTokens = 0;
            for (const tool of requestBody.tools) {
                toolTokens += 80; // 基础元数据
                if (tool.description) {
                    toolTokens += countTextTokens(tool.description, true);
                }
                if (tool.input_schema?.properties) {
                    toolTokens += Object.keys(tool.input_schema.properties).length * 50;
                }
            }
            totalTokens += toolTokens;
        } else {
            totalTokens += countTextTokens(JSON.stringify(requestBody.tools), false);
        }
    }

    return totalTokens;
}

/**
 * 构建 Claude 兼容的响应对象
 *
 * @param {string} content - 响应内容
 * @param {boolean} isStream - 是否流式响应
 * @param {string} role - 角色（assistant/user）
 * @param {string} model - 模型名称
 * @param {Array} toolCalls - 工具调用列表
 * @param {number} inputTokens - 输入 token 数
 * @returns {Object|Array} Claude 格式的响应
 */
export function buildClaudeResponse(content, isStream = false, role = 'assistant', model, toolCalls = null, inputTokens = 0) {
    const messageId = `${uuidv4()}`;

    if (isStream) {
        // 流式响应：返回事件数组
        const events = [];

        // 1. message_start event
        events.push({
            type: "message_start",
            message: {
                id: messageId,
                type: "message",
                role: role,
                model: model,
                usage: {
                    input_tokens: inputTokens,
                    output_tokens: 0
                },
                content: []
            }
        });

        let totalOutputTokens = 0;
        let stopReason = "end_turn";

        if (content) {
            const contentBlockIndex = (toolCalls && toolCalls.length > 0) ? toolCalls.length : 0;

            // 2. content_block_start for text
            events.push({
                type: "content_block_start",
                index: contentBlockIndex,
                content_block: {
                    type: "text",
                    text: ""
                }
            });

            // 3. content_block_delta for text
            events.push({
                type: "content_block_delta",
                index: contentBlockIndex,
                delta: {
                    type: "text_delta",
                    text: content
                }
            });

            // 4. content_block_stop
            events.push({
                type: "content_block_stop",
                index: contentBlockIndex
            });

            totalOutputTokens += countTextTokens(content);

            if (!toolCalls || toolCalls.length === 0) {
                stopReason = "end_turn";
            }
        }

        if (toolCalls && toolCalls.length > 0) {
            toolCalls.forEach((tc, index) => {
                let inputObject;
                try {
                    inputObject = tc.function.arguments;
                    if (typeof inputObject === 'string') {
                        inputObject = JSON.parse(inputObject);
                    }
                } catch (e) {
                    console.warn(`[Kiro] Invalid JSON for tool call arguments (${tc.function.name}):`,
                        typeof tc.function.arguments === 'string' ? tc.function.arguments.substring(0, 100) : tc.function.arguments);
                    inputObject = {};
                }

                const inputJson = JSON.stringify(inputObject);

                // 2. content_block_start for each tool_use
                events.push({
                    type: "content_block_start",
                    index: index,
                    content_block: {
                        type: "tool_use",
                        id: tc.id,
                        name: tc.function.name,
                        input: {}
                    }
                });

                // 3. content_block_delta for each tool_use
                events.push({
                    type: "content_block_delta",
                    index: index,
                    delta: {
                        type: "input_json_delta",
                        partial_json: inputJson
                    }
                });

                // 4. content_block_stop for each tool_use
                events.push({
                    type: "content_block_stop",
                    index: index
                });

                totalOutputTokens += countTextTokens(JSON.stringify(inputObject));
            });
            stopReason = "tool_use";
        }

        // 5. message_delta with appropriate stop reason
        events.push({
            type: "message_delta",
            delta: {
                stop_reason: stopReason,
                stop_sequence: null,
            },
            usage: { output_tokens: totalOutputTokens }
        });

        // 6. message_stop event
        events.push({
            type: "message_stop"
        });

        return events;
    } else {
        // 非流式响应：返回完整消息对象
        const contentArray = [];
        let stopReason = "end_turn";
        let outputTokens = 0;

        if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
                let inputObject;
                try {
                    inputObject = tc.function.arguments;
                    if (typeof inputObject === 'string') {
                        inputObject = JSON.parse(inputObject);
                    }
                } catch (e) {
                    console.warn(`[Kiro] Invalid JSON for tool call arguments (${tc.function.name}):`,
                        typeof tc.function.arguments === 'string' ? tc.function.arguments.substring(0, 100) : tc.function.arguments);
                    inputObject = {};
                }

                contentArray.push({
                    type: "tool_use",
                    id: tc.id,
                    name: tc.function.name,
                    input: inputObject
                });
                outputTokens += countTextTokens(JSON.stringify(inputObject));
            }
            stopReason = "tool_use";
        } else if (content) {
            contentArray.push({
                type: "text",
                text: content
            });
            outputTokens += countTextTokens(content);
        }

        return {
            id: messageId,
            type: "message",
            role: role,
            model: model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens
            },
            content: contentArray
        };
    }
}

/**
 * 获取用量限制信息
 *
 * @param {KiroService} service - KiroService 实例
 * @returns {Promise<Object>} 用量限制信息
 */
export async function getUsageLimits(service) {
    if (!service.isInitialized) await service.initialize();

    // 官方AWS SDK逻辑：检查并刷新token（5分钟窗口+30秒防抖）
    await refreshAccessTokenIfNeeded(service);

    // 内部固定的资源类型
    const resourceType = 'AGENTIC_REQUEST';

    // 构建请求 URL
    const usageLimitsUrl = KIRO_CONSTANTS.USAGE_LIMITS_URL.replace('{{region}}', service.region);
    const params = new URLSearchParams({
        isEmailRequired: 'true',
        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
        resourceType: resourceType
    });

    if (service.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
        params.append('profileArn', service.profileArn);
    }

    const fullUrl = `${usageLimitsUrl}?${params.toString()}`;

    // 构建请求头
    const headers = {
        'amz-sdk-invocation-id': uuidv4(),
        'Authorization': `Bearer ${service.accessToken}`,
    };

    try {
        const response = await service.axiosInstance.get(fullUrl, { headers });
        console.log('[Kiro] Usage limits fetched successfully');
        return response.data;
    } catch (error) {
        // 如果是 403 错误，尝试刷新 token 后重试
        if (error.response?.status === 403) {
            console.log('[Kiro] Received 403 on getUsageLimits. Attempting token refresh and retrying...');
            try {
                await service.initializeAuth(true);
                // 更新 Authorization header
                headers['Authorization'] = `Bearer ${service.accessToken}`;
                headers['amz-sdk-invocation-id'] = uuidv4();
                const retryResponse = await service.axiosInstance.get(fullUrl, { headers });
                console.log('[Kiro] Usage limits fetched successfully after token refresh');
                return retryResponse.data;
            } catch (refreshError) {
                console.error('[Kiro] Token refresh failed during getUsageLimits retry:', refreshError.message);
                throw refreshError;
            }
        }
        console.error('[Kiro] Failed to fetch usage limits:', error.message);
        throw error;
    }
}
