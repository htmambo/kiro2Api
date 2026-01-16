/**
 * Streaming Module
 * 处理 AWS Event Stream 格式的流式传输
 * 包含事件解析、流式请求处理、错误重试等功能
 */

import { initializeAuth } from './auth.js';
import { createLogger } from '../lib/logger.js';
import { getRetryConfig } from './request-utils.js';
import { executeKiroRequest } from './request-executor.js';

const logger = createLogger('streaming');

/**
 * 最大待处理缓冲区大小（默认10MB）
 * 防止恶意或异常响应导致内存耗尽
 * 可通过环境变量 KIRO_MAX_BUFFER_SIZE 配置（单位：字节）
 */
const MAX_BUFFER_SIZE = (() => {
    const envValue = parseInt(process.env.KIRO_MAX_BUFFER_SIZE || '10485760', 10);
    const defaultValue = 10 * 1024 * 1024; // 10MB

    if (!Number.isFinite(envValue) || envValue <= 0) {
        if (process.env.KIRO_MAX_BUFFER_SIZE) {
            logger.warn(`Invalid KIRO_MAX_BUFFER_SIZE value: ${process.env.KIRO_MAX_BUFFER_SIZE}. Using default: ${defaultValue} bytes`);
        }
        return defaultValue;
    }

    return envValue;
})();

/**
 * 协议损坏错误
 * 用于区分"数据不完整"（需等待）和"协议损坏"（无法修复）
 */
class AwsEventStreamCorruptError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'AwsEventStreamCorruptError';
        this.details = details;
    }
}

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
 * @throws {AwsEventStreamCorruptError} 协议损坏时抛出
 */
export function parseAwsEventStreamMessage(buffer, offset = 0) {
    const MIN_MESSAGE_LENGTH = 16; // Prelude(12) + MessageCRC(4)

    // 1. offset 合法性校验
    if (!Number.isInteger(offset) || offset < 0 || offset > buffer.length) {
        throw new AwsEventStreamCorruptError('Invalid offset', { offset, bufferLength: buffer.length });
    }

    // 2. 检查最小消息长度（不完整则等待）
    if (buffer.length - offset < MIN_MESSAGE_LENGTH) {
        return null; // 数据不完整，等待更多数据
    }

    // 读取 Prelude (12 bytes)
    const totalLength = buffer.readUInt32BE(offset);
    const headersLength = buffer.readUInt32BE(offset + 4);
    const preludeCrc = buffer.readUInt32BE(offset + 8);

    // 3. totalLength 下界校验
    if (!Number.isFinite(totalLength) || totalLength < MIN_MESSAGE_LENGTH) {
        throw new AwsEventStreamCorruptError('Invalid totalLength (too small)', {
            totalLength,
            headersLength,
            offset
        });
    }

    // 4. totalLength 上界校验（防止 DoS）
    if (totalLength > MAX_BUFFER_SIZE) {
        throw new AwsEventStreamCorruptError('Invalid totalLength (too large)', {
            totalLength,
            maxBufferSize: MAX_BUFFER_SIZE,
            offset
        });
    }

    // 检查是否有完整的消息
    if (buffer.length - offset < totalLength) {
        return null; // 消息不完整，等待更多数据
    }

    const messageEnd = offset + totalLength;

    // 5. headersLength 边界校验
    // 约束: 12 + headersLength <= totalLength - 4
    if (!Number.isFinite(headersLength) || (12 + headersLength) > (totalLength - 4)) {
        throw new AwsEventStreamCorruptError('Invalid headersLength (out of bounds)', {
            totalLength,
            headersLength,
            offset
        });
    }

    // 解析 Headers
    let headerOffset = offset + 12;
    const headersEnd = headerOffset + headersLength;
    const headers = {};

    while (headerOffset < headersEnd) {
        // 6. Header 逐步边界检查
        const remaining = headersEnd - headerOffset;

        // 读取 header name
        if (remaining < 1) {
            throw new AwsEventStreamCorruptError('Truncated header: missing name length', { offset, headerOffset });
        }
        const headerNameLength = buffer.readUInt8(headerOffset);
        headerOffset += 1;

        if (headersEnd - headerOffset < headerNameLength) {
            throw new AwsEventStreamCorruptError('Truncated header: missing name bytes', {
                offset,
                headerOffset,
                headerNameLength
            });
        }
        const headerName = buffer.toString('utf8', headerOffset, headerOffset + headerNameLength);
        headerOffset += headerNameLength;

        // 读取 header value type
        if (headersEnd - headerOffset < 1) {
            throw new AwsEventStreamCorruptError('Truncated header: missing value type', {
                offset,
                headerOffset,
                headerName
            });
        }
        const headerValueType = buffer.readUInt8(headerOffset);
        headerOffset += 1;

        // Type 7 = string (其他类型暂时跳过)
        if (headerValueType === 7) {
            if (headersEnd - headerOffset < 2) {
                throw new AwsEventStreamCorruptError('Truncated header: missing string value length', {
                    offset,
                    headerOffset,
                    headerName
                });
            }
            const headerValueLength = buffer.readUInt16BE(headerOffset);
            headerOffset += 2;

            if (headersEnd - headerOffset < headerValueLength) {
                throw new AwsEventStreamCorruptError('Truncated header: missing string value bytes', {
                    offset,
                    headerOffset,
                    headerName,
                    headerValueLength
                });
            }
            const headerValue = buffer.toString('utf8', headerOffset, headerOffset + headerValueLength);
            headerOffset += headerValueLength;
            headers[headerName] = headerValue;
        } else {
            // 跳过其他类型的 header value
            if (headersEnd - headerOffset < 2) {
                throw new AwsEventStreamCorruptError('Truncated header: missing value length', {
                    offset,
                    headerOffset,
                    headerName,
                    headerValueType
                });
            }
            const headerValueLength = buffer.readUInt16BE(headerOffset);
            headerOffset += 2;

            if (headersEnd - headerOffset < headerValueLength) {
                throw new AwsEventStreamCorruptError('Truncated header: missing value bytes', {
                    offset,
                    headerOffset,
                    headerName,
                    headerValueType,
                    headerValueLength
                });
            }
            headerOffset += headerValueLength;
        }
    }

    // 7. 读取 Payload (减去最后 4 bytes 的 message CRC)
    const payloadStart = offset + 12 + headersLength;
    const payloadEnd = offset + totalLength - 4;

    // payload 范围合法性校验
    if (payloadStart < offset || payloadEnd > messageEnd || payloadStart > payloadEnd) {
        throw new AwsEventStreamCorruptError('Invalid payload range', {
            offset,
            totalLength,
            headersLength,
            payloadStart,
            payloadEnd
        });
    }

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
        let message;

        // 8. 捕获协议损坏错误，避免进程崩溃
        try {
            message = parseAwsEventStreamMessage(buffer, offset);
        } catch (error) {
            if (error && error.name === 'AwsEventStreamCorruptError') {
                // 协议损坏：记录警告并丢弃剩余缓冲区
                logger.warn('AWS Event Stream message corrupt, dropping remaining buffer', {
                    offset,
                    bufferLength: buffer.length,
                    error: error.message,
                    details: error.details
                });
                // 返回已解析的事件，丢弃剩余数据
                return { events, remaining: Buffer.alloc(0) };
            }
            // 非协议错误：继续抛出
            throw error;
        }

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
            logger.warn(`解析 payload 失败 (${message.eventType}):`, { error: e.message });
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
export async function* streamApiReal(
  service,
  method,
  model,
  body,
  isRetry = false,
  retryCount = 0
) {
  const callStartTime = Date.now();

  // 确保服务已初始化
  if (!service.isInitialized) await service.initialize();
  const { maxRetries, baseDelay } = getRetryConfig(service);

  let stream = null;
  let requestData = null;
  let requestStartTime = null;
  let eventCount = 0; // 统计流式事件数量
  let responseSize = 0; // 统计接收的字节数
  let firstTokenTime = null; // 首字时间（TTFT - Time To First Token）

  try {
    const logBadRequest = (error, requestData) => {
      logger.error("❌ 400 Bad Request Error in streaming");

      // 安全获取响应数据（可能是流对象）
      let errorData = "Unable to read response data";
      try {
        if (typeof error.response.data === "string") {
          errorData = error.response.data.substring(0, 500);
        } else if (error.response.data && typeof error.response.data.on === "function") {
          // 这是一个流，无法直接读取
          errorData = "[Stream response - check statusText]";
        } else if (error.response.data) {
          errorData = JSON.stringify(error.response.data).substring(0, 500);
        }
      } catch (e) {
        errorData = `[Error reading data: ${e.message}]`;
      }

      logger.error("Error details:", {
        status: error.response.status,
        statusText: error.response.statusText,
        data: errorData,
        amznErrorType: error.response.headers?.["x-amzn-errortype"] || "unknown",
      });

      // 打印请求体的关键信息
      try {
        const reqState = requestData?.conversationState;
        logger.error("Request debug info:", {
          historyLength: reqState?.history?.length || 0,
          hasCurrentMessage: !!reqState?.currentMessage,
          currentMsgType: reqState?.currentMessage?.userInputMessage
            ? "userInputMessage"
            : "unknown",
          currentMsgContentLen:
            reqState?.currentMessage?.userInputMessage?.content?.length || 0,
          hasTools:
            !!reqState?.currentMessage?.userInputMessage
              ?.userInputMessageContext?.tools,
          toolsCount:
            reqState?.currentMessage?.userInputMessage?.userInputMessageContext
              ?.tools?.length || 0,
          hasToolResults:
            !!reqState?.currentMessage?.userInputMessage
              ?.userInputMessageContext?.toolResults,
          toolResultsCount:
            reqState?.currentMessage?.userInputMessage?.userInputMessageContext
              ?.toolResults?.length || 0,
        });

        // 打印 history 中每个消息的 content 长度
        if (reqState?.history) {
          for (let idx = 0; idx < reqState.history.length; idx++) {
            const h = reqState.history[idx];
            if (h.userInputMessage) {
              logger.error(
                `History[${idx}] user.content len:`,
                h.userInputMessage.content?.length || 0
              );
            }
            if (h.assistantResponseMessage) {
              logger.error(
                `History[${idx}] assistant.content len:`,
                h.assistantResponseMessage.content?.length || 0,
                `hasToolUses: ${!!h.assistantResponseMessage.toolUses}`
              );
            }
          }
        }
      } catch (debugError) {
        logger.error("Error printing debug info:", { error: debugError.message });
      }
    };

    const executeResult = await executeKiroRequest({
        service,
        model,
        body,
        isRetry,
        retryCount,
        logger,
        compactLabel: "STREAM",
        detailLabel: "STREAM REQUEST",
        compactLevel: "info",
        detailLevel: "info",
        buildLogLevel: "warn",
        buildLogLabel: "streamApiReal",
        axiosConfig: {
          responseType: "stream",
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
        retryOn5xx: false,
        socketErrorPrefix: "Stream connection failed",
        wrapRateLimitError: false,
        onBadRequest: logBadRequest,
      });

    requestData = executeResult.requestData;
    requestStartTime = executeResult.requestStartTime;
    const response = executeResult.response;

    stream = response.data;
    let pendingBuffer = Buffer.alloc(0); // 待处理的缓冲区
    let lastContentEvent = null; // 用于检测连续重复的 content 事件

    for await (const chunk of stream) {
      responseSize += chunk.length;

      // 检查缓冲区大小限制，防止内存耗尽
      const nextBufferSize = pendingBuffer.length + chunk.length;
      if (nextBufferSize > MAX_BUFFER_SIZE) {
        throw new Error(
          `Pending buffer exceeded MAX_BUFFER_SIZE (${MAX_BUFFER_SIZE} bytes). ` +
            `This may indicate a malformed response or protocol mismatch. ` +
            `Current: pending=${pendingBuffer.length}, chunk=${chunk.length}, total=${nextBufferSize}. ` +
            `You can increase the limit via KIRO_MAX_BUFFER_SIZE environment variable.`
        );
      }

      // 高效合并：只合并 pending + 新 chunk，而不是所有历史 chunk
      pendingBuffer =
        pendingBuffer.length > 0
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
        if (
          firstTokenTime === null &&
          (event.type === "content" || event.type === "thinking")
        ) {
          firstTokenTime = Date.now() - requestStartTime;
          logger.info(`⚡ TTFT: ${(firstTokenTime / 1000).toFixed(2)}s`);
        }

        if (event.type === "content" && event.data) {
          // 检查是否与上一个 content 事件完全相同
          if (lastContentEvent === event.data) {
            // 跳过重复的内容
            continue;
          }
          lastContentEvent = event.data;
          yield { type: "content", content: event.data };
        } else if (event.type === "thinking") {
          // 转发 thinking 事件
          yield { type: "thinking", data: event.data };
        } else if (event.type === "toolUse") {
          if (event.data) {
            yield { type: "toolUse", toolUse: event.data };
          }
        } else if (event.type === "toolUseInput") {
          if (event.data && event.data.input !== undefined) {
            yield {
              type: "toolUseInput",
              input: event.data.input,
              toolUseId: event.data.toolUseId,
            };
          }
        } else if (event.type === "toolUseStop") {
          if (event.data && event.data.stop !== undefined) {
            yield {
              type: "toolUseStop",
              stop: event.data.stop,
              toolUseId: event.data.toolUseId,
            };
          }
        }
      }
    }

    // ========================================
    // 📥 流式响应日志
    // ========================================
    const requestDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
    const responseSizeKB = (responseSize / 1024).toFixed(2);

    // 简洁模式：只显示关键信息
    if (!service.verboseLogging) {
      logger.info(`📥 STREAM [Complete] [${requestDuration}s]`);
    } else {
      // 详细模式：显示所有信息
      logger.info("\n" + "=".repeat(60));
      logger.info(`📥 STREAM RESPONSE [Complete] [${requestDuration}s]`);
      logger.info("=".repeat(60));
      logger.info(
        `Total Events: ${eventCount} | Total Size: ${responseSizeKB} KB`
      );
      logger.info("=".repeat(60) + "\n");
    }
  } catch (error) {
    const requestStageError = error?.kiroRequestStage === "request";
    if (requestStageError && error.kiroRateLimitExceeded) {
      const rateLimitError = new Error("RATE_LIMIT_EXCEEDED");
      rateLimitError.isRateLimitError = true; // 标记为限流错误
      rateLimitError.retryable = true; // 标记为可重试(不应标记账号不健康)
      throw rateLimitError;
    }

    // 确保出错时关闭流
    if (stream && typeof stream.destroy === "function") {
      stream.destroy();
    }

    // ⚠️ Socket 错误处理（流式 API）
    const isSocketError =
      !error.response &&
      (error.code === "ECONNRESET" ||
        error.code === "ETIMEDOUT" ||
        error.code === "ENOTFOUND" ||
        error.code === "UND_ERR_SOCKET" ||
        error.code === "UND_ERR_CONNECT_TIMEOUT" ||
        error.message?.includes("socket") ||
        error.message?.includes("ECONNRESET"));

    if (!requestStageError && isSocketError && retryCount < maxRetries) {
      logger.info(`Socket error detected: ${error.code || error.message}`);
      logger.info(
        `Resetting connection pool and retrying... (attempt ${
          retryCount + 1
        }/${maxRetries})`
      );

      // 重置连接池
      await service.resetConnectionPool();

      // 短暂延迟后重试
      await new Promise((resolve) => setTimeout(resolve, 1000));

      yield* streamApiReal(
        service,
        method,
        model,
        body,
        isRetry,
        retryCount + 1
      );
      return;
    } else if (!requestStageError && isSocketError) {
      logger.error("Socket error after max retries:", {
        error: error.code || error.message,
      });
      throw new Error(
        `Stream connection failed: ${error.message}. Please check your network or try restarting the service.`
      );
    }

    // 403 错误：Token 过期，刷新后重试
    if (!requestStageError && error.response?.status === 403 && !isRetry) {
      logger.info(
        "Received 403 in stream. Attempting token refresh and retrying..."
      );
      await initializeAuth(service, true);
      yield* streamApiReal(service, method, model, body, true, retryCount);
      return;
    }

    // 429 错误：速率限制，指数退避重试
    if (!requestStageError && error.response?.status === 429) {
      if (retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount);
        logger.warn(`Received 429 in stream. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        yield* streamApiReal(
          service,
          method,
          model,
          body,
          isRetry,
          retryCount + 1
        );
        return;
      } else {
        // 429 重试次数用尽,包装成特殊错误类型
        const rateLimitError = new Error("RATE_LIMIT_EXCEEDED");
        rateLimitError.isRateLimitError = true; // 标记为限流错误
        rateLimitError.retryable = true; // 标记为可重试(不应标记账号不健康)
        throw rateLimitError;
      }
    }

    // ⚠️ 400 错误：详细日志用于调试
    if (!requestStageError && error.response?.status === 400) {
      logger.error("❌ 400 Bad Request Error in streaming");

      // 安全获取响应数据（可能是流对象）
      let errorData = "Unable to read response data";
      try {
        if (typeof error.response.data === "string") {
          errorData = error.response.data.substring(0, 500);
        } else if (
          error.response.data &&
          typeof error.response.data.on === "function"
        ) {
          // 这是一个流，无法直接读取
          errorData = "[Stream response - check statusText]";
        } else if (error.response.data) {
          errorData = JSON.stringify(error.response.data).substring(0, 500);
        }
      } catch (e) {
        errorData = `[Error reading data: ${e.message}]`;
      }

      logger.error("Error details:", {
        status: error.response.status,
        statusText: error.response.statusText,
        data: errorData,
        amznErrorType:
          error.response.headers?.["x-amzn-errortype"] || "unknown",
      });

      // 打印请求体的关键信息
      try {
        const reqState = requestData?.conversationState;
        logger.error("Request debug info:", {
          historyLength: reqState?.history?.length || 0,
          hasCurrentMessage: !!reqState?.currentMessage,
          currentMsgType: reqState?.currentMessage?.userInputMessage
            ? "userInputMessage"
            : "unknown",
          currentMsgContentLen:
            reqState?.currentMessage?.userInputMessage?.content?.length || 0,
          hasTools:
            !!reqState?.currentMessage?.userInputMessage
              ?.userInputMessageContext?.tools,
          toolsCount:
            reqState?.currentMessage?.userInputMessage?.userInputMessageContext
              ?.tools?.length || 0,
          hasToolResults:
            !!reqState?.currentMessage?.userInputMessage
              ?.userInputMessageContext?.toolResults,
          toolResultsCount:
            reqState?.currentMessage?.userInputMessage?.userInputMessageContext
              ?.toolResults?.length || 0,
        });

        // ⚠️ 关键调试：打印 toolResults 结构
        const toolResults =
          reqState?.currentMessage?.userInputMessage?.userInputMessageContext
            ?.toolResults;
        if (toolResults && toolResults.length > 0) {
          logger.error(
            "ToolResults structure:",
            JSON.stringify(
              toolResults.map((tr) => ({
                toolUseId: tr.toolUseId,
                status: tr.status,
                hasContent: !!tr.content,
                contentType: Array.isArray(tr.content)
                  ? "array"
                  : typeof tr.content,
                contentLength: tr.content
                  ? Array.isArray(tr.content)
                    ? tr.content.length
                    : String(tr.content).length
                  : 0,
                // 新增：打印 content 详细结构
                contentDetail: Array.isArray(tr.content)
                  ? tr.content.map((c) => ({
                      type: typeof c,
                      hasText: !!c?.text,
                      textLen: c?.text?.length || 0,
                      textPreview: c?.text?.substring(0, 100) || "",
                    }))
                  : null,
              })),
              null,
              2
            )
          );
        }

        // ⚠️ 关键调试：打印 history 中的 toolUses
        if (reqState?.history) {
          for (let idx = 0; idx < reqState.history.length; idx++) {
            const h = reqState.history[idx];
            if (h.userInputMessage) {
              logger.error(
                `History[${idx}] userInputMessage.content length:`,
                h.userInputMessage.content?.length || 0
              );
            }
            if (h.assistantResponseMessage) {
              logger.error(
                `History[${idx}] assistantResponseMessage.content length:`,
                h.assistantResponseMessage.content?.length || 0
              );
              if (h.assistantResponseMessage.toolUses) {
                // ⚠️ 增强调试：打印完整的 toolUse 结构，检查是否有 input 字段
                logger.error(
                  `History[${idx}] toolUses:`,
                  JSON.stringify(
                    h.assistantResponseMessage.toolUses.map((tu) => ({
                      toolUseId: tu.toolUseId,
                      name: tu.name,
                      hasInput: tu.input !== undefined,
                      inputType: typeof tu.input,
                      inputKeys:
                        tu.input && typeof tu.input === "object"
                          ? Object.keys(tu.input)
                          : null,
                    }))
                  )
                );
              }
            }
          }
        }
      } catch (debugError) {
        logger.error("Error printing debug info:", {
          error: debugError.message,
        });
      }
    }

    // 抛出错误供上层处理
    yield {
      type: "error",
      error: { message: error.message, status: error.response?.status },
    };
    throw error;
  }
}
