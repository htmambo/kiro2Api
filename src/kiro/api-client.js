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
import { unescapeHTML } from './utils.js';
import { KIRO_CONSTANTS } from './auth.js';

/**
 * 解析事件流数据块（SSE 格式）
 * 参考 Kiro 官方实现：extension.js:708090
 *
 * @param {Buffer|string} rawData - 原始数据块
 * @returns {Object} 解析后的事件对象 { type, data }
 */
export function parseEventStreamChunk(rawData) {
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
export async function callApi(service, conversationId, model, requestBody, isStreaming = false) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // 官方AWS SDK逻辑：检查并刷新token（5分钟窗口+30秒防抖）
            await service.refreshAccessTokenIfNeeded();

            const headers = {
                'amz-sdk-invocation-id': uuidv4(),
                'Authorization': `Bearer ${service.accessToken}`,
            };

            const url = service.amazonQUrl;
            const timeout = isStreaming
                ? (service.config?.TIMEOUT_STREAM_REQUEST ?? KIRO_CONSTANTS.TIMEOUT_STREAM_REQUEST)
                : (service.config?.TIMEOUT_API_REQUEST ?? KIRO_CONSTANTS.TIMEOUT_API_REQUEST);

            const response = await service.axiosInstance.post(url, requestBody, {
                headers,
                timeout,
                responseType: isStreaming ? 'stream' : 'json'
            });

            return response;

        } catch (error) {
            lastError = error;

            // Socket 错误：重置连接池并重试
            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'UND_ERR_SOCKET') {
                console.warn(`[Kiro] Socket error (${error.code}) on attempt ${attempt + 1}, resetting connection pool...`);
                await service.resetConnectionPool();

                if (attempt < maxRetries - 1) {
                    const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }

            // 403 错误：刷新 token 并重试一次
            if (error.response?.status === 403 && attempt === 0) {
                console.log('[Kiro] Received 403, attempting token refresh...');
                try {
                    await service.initializeAuth(true);
                    continue;
                } catch (refreshError) {
                    console.error('[Kiro] Token refresh failed:', refreshError.message);
                    throw refreshError;
                }
            }

            // 429 错误：速率限制，指数退避重试
            if (error.response?.status === 429) {
                const retryAfter = parseInt(error.response.headers['retry-after'] || '5', 10);
                const delay = Math.min(retryAfter * 1000 * Math.pow(2, attempt), 30000);
                console.warn(`[Kiro] Rate limited (429), retrying after ${delay}ms...`);

                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }

            // 400 错误：客户端错误，不重试
            if (error.response?.status === 400) {
                console.error('[Kiro] Bad request (400):', error.response?.data);
                throw error;
            }

            // 5xx 错误：服务器错误，重试
            if (error.response?.status >= 500 && attempt < maxRetries - 1) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
                console.warn(`[Kiro] Server error (${error.response.status}), retrying after ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // 其他错误：不重试
            throw error;
        }
    }

    // 所有重试都失败
    throw lastError;
}

/**
 * 处理 API 响应（非流式）
 *
 * @param {Object} response - Axios 响应对象
 * @param {KiroService} service - KiroService 实例
 * @returns {Object} 处理后的响应数据
 */
export function _processApiResponse(response, service) {
    const data = response.data;

    if (!data || !data.conversationState) {
        throw new Error('Invalid API response: missing conversationState');
    }

    const conversationState = data.conversationState;
    const currentMessage = conversationState.currentMessage;

    if (!currentMessage || !currentMessage.assistantResponseMessage) {
        throw new Error('Invalid API response: missing assistantResponseMessage');
    }

    const assistantMessage = currentMessage.assistantResponseMessage;
    let content = assistantMessage.content || '';

    // 解析 HTML 实体
    content = unescapeHTML(content);

    // 提取工具调用
    const toolUses = assistantMessage.toolUses || [];
    const toolCalls = toolUses.map(tu => ({
        id: tu.toolUseId || `tool_${uuidv4()}`,
        function: {
            name: tu.name,
            arguments: tu.input
        }
    }));

    // 检查文本内容中的 bracket 格式工具调用
    const bracketToolCalls = parseBracketToolCalls(content);
    if (bracketToolCalls && bracketToolCalls.length > 0) {
        toolCalls.push(...bracketToolCalls);
    }

    // 去重工具调用
    const uniqueToolCalls = deduplicateToolCalls(toolCalls);

    return {
        content,
        toolCalls: uniqueToolCalls,
        conversationId: conversationState.conversationId,
        continuationId: conversationState.agentContinuationId
    };
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
export async function generateContent(service, conversationId, model, requestBody) {
    const response = await callApi(service, conversationId, model, requestBody, false);
    return _processApiResponse(response, service);
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
 * @param {string} conversationId - 对话 ID
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @returns {AsyncGenerator} 事件流
 */
export async function* generateContentStream(service, conversationId, model, requestBody) {
    yield* streamApiReal(service, conversationId, model, requestBody);
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
    await service.refreshAccessTokenIfNeeded();

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
