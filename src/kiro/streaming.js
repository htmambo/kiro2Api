/**
 * Streaming Module
 * 处理 AWS Event Stream 格式的流式传输
 * 包含事件解析、流式请求处理、错误重试等功能
 */

import { v4 as uuidv4 } from 'uuid';
import { KIRO_CONSTANTS, initializeAuth } from './auth.js';

/**
 * 解析单个 AWS Event Stream 消息
 * AWS Event Stream 格式：
 * - Prelude (12 bytes): totalLength(4) + headersLength(4) + preludeCrc(4)
 * - Headers (variable): 键值对，用于存储事件类型等元数据
 * - Payload (variable): JSON 格式的事件数据
 * - Message CRC (4 bytes): 消息校验和
 *
 * @param {Buffer} buffer - 包含事件流数据的缓冲区
 * @param {number} offset - 开始解析的偏移量
 * @returns {Object|null} 解析结果或 null（如果数据不完整）
 */
export function parseAwsEventStreamMessage(buffer, offset = 0) {
    // 检查是否有足够的数据读取 Prelude (12 bytes)
    if (buffer.length - offset < 16) {
        return null; // 数据不完整，等待更多数据
    }

    // 读取 Prelude (12 bytes)
    const totalLength = buffer.readUInt32BE(offset);
    const headersLength = buffer.readUInt32BE(offset + 4);
    const preludeCrc = buffer.readUInt32BE(offset + 8);

    // 检查是否有完整的消息
    if (buffer.length - offset < totalLength) {
        return null; // 消息不完整，等待更多数据
    }

    // 解析 Headers
    let headerOffset = offset + 12;
    const headersEnd = headerOffset + headersLength;
    const headers = {};

    while (headerOffset < headersEnd) {
        // 读取 header name
        const headerNameLength = buffer.readUInt8(headerOffset);
        headerOffset += 1;
        const headerName = buffer.toString('utf8', headerOffset, headerOffset + headerNameLength);
        headerOffset += headerNameLength;

        // 读取 header value type
        const headerValueType = buffer.readUInt8(headerOffset);
        headerOffset += 1;

        // Type 7 = string (其他类型暂时跳过)
        if (headerValueType === 7) {
            const headerValueLength = buffer.readUInt16BE(headerOffset);
            headerOffset += 2;
            const headerValue = buffer.toString('utf8', headerOffset, headerOffset + headerValueLength);
            headerOffset += headerValueLength;
            headers[headerName] = headerValue;
        } else {
            // 跳过其他类型的 header value
            const headerValueLength = buffer.readUInt16BE(headerOffset);
            headerOffset += 2;
            headerOffset += headerValueLength;
        }
    }

    // 读取 Payload (减去最后 4 bytes 的 message CRC)
    const payloadStart = offset + 12 + headersLength;
    const payloadEnd = offset + totalLength - 4;
    const payload = buffer.toString('utf8', payloadStart, payloadEnd);

    return {
        eventType: headers[':event-type'] || 'unknown',
        contentType: headers[':content-type'] || 'application/json',
        messageType: headers[':message-type'] || 'event',
        payload: payload,
        totalLength: totalLength,
        nextOffset: offset + totalLength
    };
}

/**
 * 解析 AWS Event Stream 缓冲区，提取所有完整的事件
 *
 * @param {Buffer} buffer - 包含事件流数据的缓冲区
 * @returns {Object} { events: 解析出的事件数组, remaining: 未处理完的缓冲区 }
 */
export function parseAwsEventStreamBuffer(buffer) {
    const events = [];
    let offset = 0;

    while (offset < buffer.length) {
        const message = parseAwsEventStreamMessage(buffer, offset);
        if (!message) {
            // 没有完整消息了，返回剩余部分
            return {
                events: events,
                remaining: buffer.slice(offset)
            };
        }

        offset = message.nextOffset;

        // 根据事件类型和 payload 构造事件
        try {
            const parsed = JSON.parse(message.payload);

            // 根据事件类型处理
            if (message.eventType === 'assistantResponseEvent') {
                // 普通内容事件
                if (parsed.content !== undefined) {
                    events.push({
                        type: 'content',
                        data: parsed.content
                    });
                }
            } else if (message.eventType === 'toolUseEvent') {
                // 工具调用事件
                // ⚠️ 完美复刻官方 Kiro (extension.js:708085-708123)：
                //   - 每次 toolUseEvent 都处理（不管是否重复）
                //   - 每次都传递完整事件（name, toolUseId, input）
                //   - 在 generateContentStream 层用 Set 判断是否第一次
                //   - 只在第一次添加 id/name，但每次都处理 input
                events.push({
                    type: 'toolUse',
                    data: {
                        name: parsed.name,
                        toolUseId: parsed.toolUseId,
                        input: parsed.input || '',  // 每次都传递 input（可能为空）
                        stop: parsed.stop || false
                    }
                });
            } else if (message.eventType === 'meteringEvent') {
                // Token 计量事件
                if (parsed.usage !== undefined) {
                    events.push({
                        type: 'metering',
                        data: {
                            usage: parsed.usage,
                            unit: parsed.unit
                        }
                    });
                }
            } else if (message.eventType === 'reasoningContentEvent') {
                // ⭐ Thinking 事件（Extended Thinking 功能）
                const thinkingText = parsed.text || parsed.reasoningText || '';
                if (thinkingText) {
                    events.push({
                        type: 'thinking',
                        data: { thinking: thinkingText }
                    });
                }
            } else if (message.eventType === 'followupPromptEvent') {
                // Followup prompt 事件
                if (parsed.followupPrompt !== undefined) {
                    events.push({
                        type: 'followup',
                        data: parsed.followupPrompt
                    });
                }
            } else if (message.eventType === 'codeReferenceEvent') {
                // ⭐ 代码引用追踪事件（官方 Kiro 特性）
                if (parsed.references && Array.isArray(parsed.references)) {
                    // 过滤有效引用（必须包含许可证、仓库、URL）
                    const validReferences = parsed.references.filter(ref =>
                        ref.licenseName && ref.repository && ref.url
                    );
                    if (validReferences.length > 0) {
                        events.push({
                            type: 'codeReference',
                            data: {
                                references: validReferences
                            }
                        });
                    }
                }
            } else if (message.eventType === 'messageMetadataEvent') {
                // Metadata 事件
                if (parsed.conversationId) {
                    events.push({
                        type: 'metadata',
                        data: { conversationId: parsed.conversationId }
                    });
                }
            }
        } catch (e) {
            console.warn(`[Kiro Streaming] 解析 payload 失败 (${message.eventType}):`, e.message);
        }
    }

    return {
        events: events,
        remaining: Buffer.alloc(0)
    };
}

/**
 * 流式 API 调用（生成器函数）
 * 处理 AWS CodeWhisperer 的流式响应，包含错误重试、性能监控等功能
 *
 * @param {Object} service - KiroService 实例
 * @param {string} method - HTTP 方法（保留参数，暂未使用）
 * @param {string} model - 模型名称
 * @param {Object} body - 请求体 { messages, tools, system, thinking }
 * @param {boolean} isRetry - 是否为重试请求
 * @param {number} retryCount - 当前重试次数
 * @yields {Object} 流式事件 { type, content/data }
 */
export async function* streamApiReal(service, method, model, body, isRetry = false, retryCount = 0) {
    const callStartTime = Date.now();

    // 确保服务已初始化
    if (!service.isInitialized) {
        await service.initialize();
    }

    const maxRetries = service.config.REQUEST_MAX_RETRIES || 3;
    const baseDelay = service.config.REQUEST_BASE_DELAY || 1000;

    // 检查是否启用 thinking（从 body 或配置中读取）
    const enableThinking = body.thinking?.type === 'enabled' ||
                         body.extended_thinking === true ||
                         service.config.ENABLE_THINKING_BY_DEFAULT === true;

    // 🔍 性能诊断：记录请求构建时间
    const buildStartTime = Date.now();
    const requestData = await service.buildCodewhispererRequest(
        body.messages,
        model,
        body.tools,
        body.system,
        enableThinking
    );
    const buildDuration = Date.now() - buildStartTime;
    if (buildDuration > 100) {
        console.log(`[Kiro Perf] streamApiReal buildCodewhispererRequest took ${buildDuration}ms (messages: ${body.messages?.length || 0})`);
    }

    // ========================================
    // 📤 流式请求日志
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
        console.log(`[Kiro] 📤 STREAM [${model}] - ${new Date().toISOString()}`);
    } else {
        // 详细模式：显示所有信息
        console.log('\n' + '='.repeat(60));
        console.log(`📤 STREAM REQUEST [${model}]${isRetry ? ' (retry ' + retryCount + ')' : ''}`);
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

    const token = service.accessToken;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'amz-sdk-invocation-id': `${uuidv4()}`,
    };

    const requestUrl = model.startsWith('amazonq') ? service.amazonQUrl : service.baseUrl;

    // 使用流式请求专用超时配置
    const streamTimeout = service.config?.TIMEOUT_STREAM_REQUEST ?? KIRO_CONSTANTS.TIMEOUT_STREAM_REQUEST;

    let stream = null;
    let eventCount = 0;  // 统计流式事件数量
    let totalBytesReceived = 0;  // 统计接收的字节数
    let firstTokenTime = null;  // 首字时间（TTFT - Time To First Token）

    try {
        const response = await service.axiosInstance.post(requestUrl, requestData, {
            headers,
            responseType: 'stream',
            timeout: streamTimeout,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        stream = response.data;
        let pendingBuffer = Buffer.alloc(0);  // 待处理的缓冲区
        let lastContentEvent = null;  // 用于检测连续重复的 content 事件

        for await (const chunk of stream) {
            totalBytesReceived += chunk.length;

            // 高效合并：只合并 pending + 新 chunk，而不是所有历史 chunk
            pendingBuffer = pendingBuffer.length > 0
                ? Buffer.concat([pendingBuffer, chunk])
                : chunk;

            // 解析缓冲区中的事件
            const { events, remaining } = parseAwsEventStreamBuffer(pendingBuffer);

            // 更新 pending buffer 为未解析的部分
            pendingBuffer = remaining;

            // yield 所有事件，但过滤连续完全相同的 content 事件（Kiro API 有时会重复发送）
            for (const event of events) {
                eventCount++;

                // 记录首字时间（TTFT）
                if (firstTokenTime === null && (event.type === 'content' || event.type === 'thinking')) {
                    firstTokenTime = Date.now() - requestStartTime;
                    console.log(`[Kiro] ⚡ TTFT: ${(firstTokenTime / 1000).toFixed(2)}s`);
                }

                if (event.type === 'content' && event.data) {
                    // 检查是否与上一个 content 事件完全相同
                    if (lastContentEvent === event.data) {
                        // 跳过重复的内容
                        continue;
                    }
                    lastContentEvent = event.data;
                    yield { type: 'content', content: event.data };
                } else if (event.type === 'thinking') {
                    // 转发 thinking 事件
                    yield { type: 'thinking', data: event.data };
                } else if (event.type === 'toolUse') {
                    if (event.data) {
                        yield { type: 'toolUse', toolUse: event.data };
                    }
                } else if (event.type === 'toolUseInput') {
                    if (event.data && event.data.input !== undefined) {
                        yield { type: 'toolUseInput', input: event.data.input, toolUseId: event.data.toolUseId };
                    }
                } else if (event.type === 'toolUseStop') {
                    if (event.data && event.data.stop !== undefined) {
                        yield { type: 'toolUseStop', stop: event.data.stop, toolUseId: event.data.toolUseId };
                    }
                }
            }
        }

        // ========================================
        // 📥 流式响应日志
        // ========================================
        const requestDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
        const totalSizeKB = (totalBytesReceived / 1024).toFixed(2);

        // 简洁模式：只显示关键信息
        if (!service.verboseLogging) {
            console.log(`[Kiro] 📥 STREAM [Complete] [${requestDuration}s]`);
        } else {
            // 详细模式：显示所有信息
            console.log('\n' + '='.repeat(60));
            console.log(`📥 STREAM RESPONSE [Complete] [${requestDuration}s]`);
            console.log('='.repeat(60));
            console.log(`Total Events: ${eventCount} | Total Size: ${totalSizeKB} KB`);
            console.log('='.repeat(60) + '\n');
        }
    } catch (error) {
        // 确保出错时关闭流
        if (stream && typeof stream.destroy === 'function') {
            stream.destroy();
        }

        // ⚠️ Socket 错误处理（流式 API）
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
            console.log(`[Kiro Stream] Socket error detected: ${error.code || error.message}`);
            console.log(`[Kiro Stream] Resetting connection pool and retrying... (attempt ${retryCount + 1}/${maxRetries})`);

            // 重置连接池
            await service.resetConnectionPool();

            // 短暂延迟后重试
            await new Promise(resolve => setTimeout(resolve, 1000));

            yield* streamApiReal(service, method, model, body, isRetry, retryCount + 1);
            return;
        } else if (isSocketError) {
            console.error('[Kiro Stream] Socket error after max retries:', error.code || error.message);
            throw new Error(`Stream connection failed: ${error.message}. Please check your network or try restarting the service.`);
        }

        // 403 错误：Token 过期，刷新后重试
        if (error.response?.status === 403 && !isRetry) {
            console.log('[Kiro] Received 403 in stream. Attempting token refresh and retrying...');
            await initializeAuth(service, true);
            yield* streamApiReal(service, method, model, body, true, retryCount);
            return;
        }

        // 429 错误：速率限制，指数退避重试
        if (error.response?.status === 429 && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            console.log(`[Kiro] Received 429 in stream. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            yield* streamApiReal(service, method, model, body, isRetry, retryCount + 1);
            return;
        }

        // ⚠️ 400 错误：详细日志用于调试
        if (error.response?.status === 400) {
            console.error('[Kiro Stream] ❌ 400 Bad Request Error in streaming');

            // 安全获取响应数据（可能是流对象）
            let errorData = 'Unable to read response data';
            try {
                if (typeof error.response.data === 'string') {
                    errorData = error.response.data.substring(0, 500);
                } else if (error.response.data && typeof error.response.data.on === 'function') {
                    // 这是一个流，无法直接读取
                    errorData = '[Stream response - check statusText]';
                } else if (error.response.data) {
                    errorData = JSON.stringify(error.response.data).substring(0, 500);
                }
            } catch (e) {
                errorData = `[Error reading data: ${e.message}]`;
            }

            console.error('[Kiro Stream] Error details:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: errorData,
                amznErrorType: error.response.headers?.['x-amzn-errortype'] || 'unknown'
            });

            // 打印请求体的关键信息
            try {
                const reqState = requestData?.conversationState;
                console.error('[Kiro Stream] Request debug info:', {
                    historyLength: reqState?.history?.length || 0,
                    hasCurrentMessage: !!reqState?.currentMessage,
                    currentMsgType: reqState?.currentMessage?.userInputMessage ? 'userInputMessage' : 'unknown',
                    currentMsgContentLen: reqState?.currentMessage?.userInputMessage?.content?.length || 0,
                    hasTools: !!(reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools),
                    toolsCount: reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools?.length || 0,
                    hasToolResults: !!(reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.toolResults),
                    toolResultsCount: reqState?.currentMessage?.userInputMessage?.userInputMessageContext?.toolResults?.length || 0,
                });

                // 打印 history 中每个消息的 content 长度
                if (reqState?.history) {
                    for (let idx = 0; idx < reqState.history.length; idx++) {
                        const h = reqState.history[idx];
                        if (h.userInputMessage) {
                            console.error(`[Kiro Stream] History[${idx}] user.content len: ${h.userInputMessage.content?.length || 0}`);
                        }
                        if (h.assistantResponseMessage) {
                            console.error(`[Kiro Stream] History[${idx}] assistant.content len: ${h.assistantResponseMessage.content?.length || 0}, hasToolUses: ${!!h.assistantResponseMessage.toolUses}`);
                        }
                    }
                }
            } catch (debugError) {
                console.error('[Kiro Stream] Error printing debug info:', debugError.message);
            }
        }

        // 抛出错误供上层处理
        yield { type: 'error', error: { message: error.message, status: error.response?.status } };
        throw error;
    }
}
