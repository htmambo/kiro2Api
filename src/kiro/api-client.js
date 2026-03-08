/**
 * Kiro API 客户端模块
 *
 * 提取自 core.js 的 API 调用相关函数，
 * 包含请求发送、响应处理、流式传输与 token 计数等功能。
 *
 * @module kiro/api-client
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { streamApiReal } from './streaming.js';
import { executeKiroRequest } from './request-executor.js';
import {
  parseBracketToolCalls,
  deduplicateToolCalls,
  mapToolNameToCC,
  reverseMapToolInput,
} from "./tools.js";
import { executeWebSearch } from './search.js';
import { MODEL_MAPPING } from './model-config.js';
import { refreshAccessTokenIfNeeded, initializeAuth } from './auth.js';
import { KIRO_CONSTANTS } from './constants.js';
import { repairJson, unescapeHTML } from './utils.js';
import { createLogger } from '../lib/logger.js';
import { estimateInputTokens, countTextTokens } from "./utils/token-counter.js";
import {
    buildClaudeWebSearchResultBlocks,
    generateClaudeWebSearchSummary
} from './websearch-response.js';
import {
    buildInlineClientToolUseStreamBlocks,
    buildServerSideWebSearchStreamBlocks,
    createClaudeStreamBlockState,
    createInlineClientToolUseStreamState
} from './stream-block-manager.js';
import { createThinkingStreamParser } from './thinking-stream-parser.js';

const logger = createLogger('kiro:api-client');

function getToolCallIdentifier(toolCall) {
    return toolCall?.id || toolCall?.toolUseId || `tool_${uuidv4()}`;
}

function getToolCallName(toolCall) {
    return toolCall?.function?.name || toolCall?.name || '';
}

function parseToolCallArguments(toolCall) {
    const rawInput = toolCall?.function?.arguments ?? toolCall?.input ?? {};
    if (typeof rawInput === 'string') {
        try {
            return JSON.parse(rawInput);
        } catch (error) {
            const trimmedInput = rawInput.trim();
            if (trimmedInput.startsWith('{') || trimmedInput.startsWith('[')) {
                try {
                    return JSON.parse(repairJson(rawInput));
                } catch (repairError) {
                    // 保持与当前调用方兼容：修复失败时返回原始字符串，由上层决定如何降级
                }
            }
            return rawInput;
        }
    }
    return rawInput;
}

function normalizeToolCallForClaudeOutput(toolCall) {
    const toolName = getToolCallName(toolCall);
    const claudeToolName = mapToolNameToCC(toolName);
    let inputObject = parseToolCallArguments(toolCall);

    if (typeof inputObject === 'string') {
        logger.warn(`Invalid JSON for tool call arguments (${toolName}):`,
            inputObject.substring(0, 100));
        inputObject = {};
    } else {
        inputObject = reverseMapToolInput(claudeToolName, inputObject);
    }

    return {
        toolId: getToolCallIdentifier(toolCall),
        toolName: claudeToolName,
        inputObject
    };
}

export function isServerSideWebSearchToolCall(toolCall) {
    const toolName = getToolCallName(toolCall);
    return toolName === 'WebSearch' || toolName === 'webSearch' || toolName === 'web_search';
}

export function extractServerSideWebSearchQuery(toolCall) {
    const parsedInput = parseToolCallArguments(toolCall);
    if (typeof parsedInput === 'string') {
        return parsedInput.trim();
    }

    return parsedInput?.query || parsedInput?.value || '';
}

export async function resolveServerSideWebSearchToolCalls(
    toolCalls,
    verboseLogging = false,
    searchExecutor = executeWebSearch
) {
    const serverSideExecutions = [];
    const clientToolCalls = [];

    for (const toolCall of toolCalls || []) {
        if (!isServerSideWebSearchToolCall(toolCall)) {
            clientToolCalls.push(toolCall);
            continue;
        }

        const query = extractServerSideWebSearchQuery(toolCall);
        if (!query) {
            clientToolCalls.push(toolCall);
            continue;
        }

        if (verboseLogging) {
            logger.info(`Executing server-side WebSearch for query: ${query}`);
        }

        const searchResult = await searchExecutor(query, verboseLogging);
        serverSideExecutions.push({
            toolUseId: getToolCallIdentifier(toolCall),
            query,
            searchResult,
            resultBlocks: buildClaudeWebSearchResultBlocks(searchResult),
            summaryText: generateClaudeWebSearchSummary(query, searchResult)
        });
    }

    return {
        serverSideExecutions,
        clientToolCalls
    };
}

export {
    buildServerSideWebSearchStreamBlocks,
    buildInlineClientToolUseStreamBlocks,
    createClaudeStreamBlockState
};

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
    let contextInputTokens = null;
    let stopReasonOverride = null;

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
                            } catch (e) { }
                            toolCalls.push(currentToolCall);
                        }

                        currentToolCall = {
                            toolUseId: tc.toolUseId,
                            name: mapToolNameToCC(tc.name || 'unknown'),
                            input: ''
                        };
                    }

                    if (currentToolCall && tc.input) {
                        currentToolCall.input += tc.input;
                    }

                    if (tc.stop && currentToolCall) {
                        try {
                            currentToolCall.input = JSON.parse(currentToolCall.input);
                        } catch (e) { }
                        toolCalls.push(currentToolCall);
                        currentToolCall = null;
                    }
                } else if (eventType === 'contextUsage') {
                    const usagePercentage = Number(
                        parsed.contextUsagePercentage ?? parsed.context_usage_percentage
                    );
                    if (Number.isFinite(usagePercentage) && usagePercentage >= 0) {
                        contextInputTokens = Math.floor((usagePercentage * 200000) / 100);
                        if (usagePercentage >= 100) {
                            stopReasonOverride = 'model_context_window_exceeded';
                        }
                    }
                } else if (eventType === 'exception') {
                    const exceptionType = parsed.exceptionType ?? parsed.exception_type;
                    if (exceptionType === 'ContentLengthExceededException') {
                        stopReasonOverride = 'max_tokens';
                    }
                }
            } catch (e) {
                logger.warn('Failed to parse event data:', e.message);
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
        } catch (e) { }
        toolCalls.push(currentToolCall);
    }

    return {
        type: 'chunk',
        content: fullContent,
        toolCalls: toolCalls,
        contextInputTokens,
        stopReasonOverride
    };
}

/**
 * 调用 Kiro API（带重试和错误处理）
 *
 * @param {KiroService} service - KiroService 实例
 * @param {string} method - 请求方法（保留参数）
 * @param {string} model - 模型名称
 * @param {Object} body - 请求体
 * @param {boolean} [isRetry=false] - 是否为重试
 * @param {number} [retryCount=0] - 当前重试次数
 * @returns {Promise<Object>} API 响应
 */
export async function callApi(
  service,
  method,
  model,
  body,
  isRetry = false,
  retryCount = 0
) {
  const logBadRequest = (error, requestData) => {
    logger.error("❌ 400 Bad Request Error - Request format issue detected");
    const errorData = JSON.stringify(error.response.data).substring(0, 500);
    logger.error("Error details:", {
      status: error.response.status,
      statusText: error.response.statusText,
      data: errorData,
      headers: error.response.headers,
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
              contentType: Array.isArray(tr.content) ? "array" : typeof tr.content,
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
  };

  try {
    const { response, requestStartTime } = await executeKiroRequest({
      service,
      model,
      body,
      isRetry,
      retryCount,
      logger,
      compactLabel: "REQUEST",
      detailLabel: "REQUEST",
      compactLevel: "info",
      detailLevel: "info",
      buildLogLevel: "warn",
      retryOn5xx: true,
      wrapRateLimitError: true,
      onBadRequest: logBadRequest,
    });

    // ========================================
    // 📥 响应日志
    // ========================================
    const requestDuration = ((Date.now() - requestStartTime) / 1000).toFixed(2);
    const responseSize = response.data
      ? Buffer.byteLength(JSON.stringify(response.data))
      : 0;
    const responseSizeKB = (responseSize / 1024).toFixed(2);

    // 简洁模式：只显示关键信息
    if (!service.verboseLogging) {
      logger.info(`📥 RESPONSE [${response.status}] [${requestDuration}s]`);
    } else {
      // 详细模式：显示所有信息
      logger.info("\n" + "=".repeat(60));
      logger.info(
        `📥 RESPONSE [${response.status} ${response.statusText}] [${requestDuration}s]`
      );
      logger.info("=".repeat(60));
      logger.info(`Response Size: ${responseSizeKB} KB`);
      logger.info("=".repeat(60) + "\n");
    }

    return response;
  } catch (error) {
    logger.error("API call failed:", error.message);
    if (error.response) {
      logger.error("Response status:", error.response.status);
      logger.error(
        "Response data:",
        JSON.stringify(error.response.data).substring(0, 300)
      );
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

export function processApiResponse(response) {
    const rawResponseText = Buffer.isBuffer(response.data) ? response.data.toString('utf8') : String(response.data);
    //logger.info(`Raw response length: ${rawResponseText.length}`);
    if (rawResponseText.includes("[Called")) {
        logger.info("Raw response contains [Called marker.");
    }

    // 1. Parse structured events and bracket calls from parsed content
    const parsedFromEvents = parseEventStreamChunk(rawResponseText);
    let fullResponseText = parsedFromEvents.content;
    let allToolCalls = [...parsedFromEvents.toolCalls]; // clone
    //logger.info(`Found ${allToolCalls.length} tool calls from event stream parsing.`);

    // 2. Crucial fix from Python example: Parse bracket tool calls from the original raw response
    const rawBracketToolCalls = parseBracketToolCalls(rawResponseText);
    if (rawBracketToolCalls) {
        //logger.info(`Found ${rawBracketToolCalls.length} bracket tool calls in raw response.`);
        allToolCalls.push(...rawBracketToolCalls);
    }

    // 3. Deduplicate all collected tool calls
    const uniqueToolCalls = deduplicateToolCalls(allToolCalls);
    //logger.info(`Total unique tool calls after deduplication: ${uniqueToolCalls.length}`);

    // 4. Clean up response text by removing all tool call syntax from the final text.
    // The text from parseEventStreamChunk is already partially cleaned.
    // We re-clean here with all unique tool calls to be certain.
    if (uniqueToolCalls.length > 0) {
        for (const tc of uniqueToolCalls) {
            const funcName = getToolCallName(tc);
            if (!funcName) {
                continue;
            }
            const escapedName = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const pattern = new RegExp(`\\[Called\\s+${escapedName}\\s+with\\s+args:\\s*\\{[^}]*(?:\\{[^}]*\\}[^}]*)*\\}\\]`, 'gs');
            fullResponseText = fullResponseText.replace(pattern, '');
        }
        fullResponseText = fullResponseText.replace(/\s+/g, ' ').trim();
    }

    //logger.info(`Final response text after tool call cleanup: ${fullResponseText}`);
    //logger.info(`Final tool calls after deduplication: ${JSON.stringify(uniqueToolCalls)}`);
    return {
        responseText: fullResponseText,
        toolCalls: uniqueToolCalls,
        contextInputTokens: parsedFromEvents.contextInputTokens,
        stopReasonOverride: parsedFromEvents.stopReasonOverride
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
/**
 * 生成非流式内容
 *
 * @param {Object} service - KiroService 实例
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @returns {Promise<Object>} 生成结果
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
        logger.info(`Calling generateContent with model: ${finalModel}`);
    }

    // Estimate input tokens before making the API call
    const inputTokens = estimateInputTokens(requestBody);
    logger.info(`Token] generateContent estimateInputTokens: ${inputTokens} tokens (${requestBody.messages?.length || 0} messages)`);

    const response = await callApi(service, '', finalModel, requestBody);

    try {
        const {
            responseText,
            toolCalls,
            contextInputTokens,
            stopReasonOverride
        } = processApiResponse(response);
        const { serverSideExecutions, clientToolCalls } = await resolveServerSideWebSearchToolCalls(
            toolCalls,
            service.verboseLogging
        );
        return buildClaudeResponse(
            responseText,
            false,
            'assistant',
            model,
            clientToolCalls,
            inputTokens,
            {
                serverWebSearchExecutions: serverSideExecutions,
                inputTokensOverride: contextInputTokens,
                forcedStopReason: stopReasonOverride
            }
        );
    } catch (error) {
        logger.error('Error in generateContent:', error);
        throw new Error(`Error processing response: ${error.message}`);
    }
}


/**
 * 生成内容（流式）
 *
 * @param {KiroService} service - KiroService 实例
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @returns {AsyncGenerator} 事件流
 */
/**
 * 生成流式内容
 *
 * @param {Object} service - KiroService 实例
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @yields {Object} 流式事件
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
        logger.info(`Calling generateContentStream with model: ${finalModel} (real streaming, thinking: ${enableThinking})`);
    }

    // ⚠️ 性能计时：token 估算
    const tokenStartTime = Date.now();
    const inputTokens = estimateInputTokens(requestBody);
    const tokenDuration = Date.now() - tokenStartTime;
    // ⚠️ 调试：打印 token 计算结果
    logger.info(`Token estimateInputTokens: ${inputTokens} tokens (${requestBody.messages?.length || 0} messages, ${tokenDuration}ms)`);
    const messageId = `${uuidv4()}`;

    try {
        let outputTokens = 0;
        let resolvedInputTokens = inputTokens;
        let stopReasonOverride = null;
        const completedClientToolCalls = [];
        const serverSideExecutions = [];
        const pendingToolCalls = new Map();
        let hasClientToolUse = false;
        const streamBlockState = createClaudeStreamBlockState();
        const thinkingParser = createThinkingStreamParser({
            enableThinking,
            streamBlockState
        });
        const codeReferences = [];  // 用于累积代码引用

        let messageStarted = false;

        const buildMessageStartEvent = () => ({
            type: "message_start",
            message: {
                id: messageId,
                type: "message",
                role: "assistant",
                model: model,
                usage: { input_tokens: resolvedInputTokens, output_tokens: 0 },
                content: []
            }
        });

        const emitMessageStartIfNeeded = async function* () {
            if (messageStarted) {
                return;
            }

            messageStarted = true;
            yield buildMessageStartEvent();
        };

        const emitEvents = async function* (events) {
            if (!events || events.length === 0) {
                return;
            }

            yield* emitMessageStartIfNeeded();
            for (const chunk of events || []) {
                yield chunk;
            }
        };

        // 2-3. 流式接收并发送每个事件
        for await (const event of streamApiReal(service, '', finalModel, requestBody)) {
            // Debug: 记录事件类型（仅在调试时启用，生产环境注释掉以提升性能）
            // logger.info(`Event received: type=${event.type}`);

            if (event.type === 'thinking') {
                yield* emitEvents(thinkingParser.processNativeThinkingDelta(event.data.thinking));
            } else if (event.type === 'content' && event.content) {
                // Kiro 优化：HTML 转义处理
                const unescapedContent = unescapeHTML(event.content);
                yield* emitEvents(thinkingParser.processContentChunk(unescapedContent));
            } else if (event.type === 'toolUse') {
                // 工具调用事件（完美复刻官方 Kiro extension.js:708085-708123）
                const tc = event.toolUse;

                if (tc && tc.toolUseId) {
                    const isServerSideTool = isServerSideWebSearchToolCall({ name: tc.name });
                    let pendingToolState = pendingToolCalls.get(tc.toolUseId);

                    if (!pendingToolState) {
                        pendingToolState = isServerSideTool
                            ? {
                                kind: 'server-web-search',
                                toolCall: {
                                    toolUseId: tc.toolUseId,
                                    name: mapToolNameToCC(tc.name || 'unknown'),
                                    input: ''
                                }
                            }
                            : {
                                kind: 'client-tool',
                                streamState: createInlineClientToolUseStreamState(
                                    {
                                        toolUseId: tc.toolUseId,
                                        name: tc.name || 'unknown'
                                    },
                                    streamBlockState.getNextBlockIndex()
                                )
                            };
                        pendingToolCalls.set(tc.toolUseId, pendingToolState);
                    }

                    if (pendingToolState.kind === 'server-web-search') {
                        if (tc.input) {
                            pendingToolState.toolCall.input += tc.input;
                        }

                        if (tc.stop) {
                            yield* emitEvents(thinkingParser.flushBufferedPlainTextBeforeToolUse());
                            yield* emitEvents(streamBlockState.closeTextBlock());

                            const existingToolCall = pendingToolState.toolCall;
                            const { serverSideExecutions: resolvedExecutions } = await resolveServerSideWebSearchToolCalls(
                                [existingToolCall],
                                service.verboseLogging
                            );
                            if (resolvedExecutions.length > 0) {
                                const streamBlocks = buildServerSideWebSearchStreamBlocks(
                                    resolvedExecutions,
                                    streamBlockState.getNextBlockIndex()
                                );
                                serverSideExecutions.push(...resolvedExecutions);
                                streamBlockState.setNextBlockIndex(streamBlocks.nextIndex);
                                streamBlockState.appendText(streamBlocks.emittedSummaryText);
                                yield* emitEvents(streamBlocks.events);
                            }

                            pendingToolCalls.delete(tc.toolUseId);
                        }
                    } else {
                        const { streamState } = pendingToolState;

                        if (tc.input || !pendingToolState.started) {
                            if (!pendingToolState.started) {
                                yield* emitEvents(thinkingParser.flushBufferedPlainTextBeforeToolUse());
                                yield* emitEvents(streamBlockState.closeTextBlock());
                                yield* emitEvents(streamState.startEvents());
                                streamBlockState.setNextBlockIndex(streamState.index + 1);
                                pendingToolState.started = true;
                                hasClientToolUse = true;
                            }

                            if (tc.input) {
                                yield* emitEvents(streamState.appendInputChunk(tc.input));
                            }
                        }

                        if (tc.stop) {
                            const finalizedToolCall = streamState.finalizeEmittedToolCall();
                            if (finalizedToolCall) {
                                completedClientToolCalls.push(finalizedToolCall);
                            }

                            yield* emitEvents(streamState.stopEvents());
                            pendingToolCalls.delete(tc.toolUseId);
                        }
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
            } else if (event.type === 'contextUsage') {
                const usagePercentage = Number(event.data?.contextUsagePercentage);
                if (Number.isFinite(usagePercentage) && usagePercentage >= 0) {
                    resolvedInputTokens = Math.floor((usagePercentage * 200000) / 100);
                    if (usagePercentage >= 100) {
                        stopReasonOverride = 'model_context_window_exceeded';
                    }
                }
            } else if (event.type === 'exception') {
                if (event.data?.exceptionType === 'ContentLengthExceededException') {
                    stopReasonOverride = 'max_tokens';
                }
            } else if (event.type === 'codeReference') {
                // ⭐ 代码引用追踪事件（官方 Kiro 特性）
                // 收集代码引用信息，用于开源许可证追踪和代码溯源
                const references = event.data.references;
                if (references && references.length > 0) {
                    codeReferences.push(...references);
                    if (service.verboseLogging) {
                        logger.info(`Code references detected: ${references.length} sources`);
                    }
                }
            }
        }

        // 处理未完成的工具调用（如果流提前结束）
        if (pendingToolCalls.size > 0) {
            for (const pendingToolCall of pendingToolCalls.values()) {
                yield* emitEvents(thinkingParser.flushBufferedPlainTextBeforeToolUse());
                if (pendingToolCall.kind === 'server-web-search') {
                    const toolCall = pendingToolCall.toolCall;
                    const { serverSideExecutions: resolvedExecutions } = await resolveServerSideWebSearchToolCalls(
                        [toolCall],
                        service.verboseLogging
                    );
                    if (resolvedExecutions.length > 0) {
                        yield* emitEvents(streamBlockState.closeTextBlock());
                        const streamBlocks = buildServerSideWebSearchStreamBlocks(
                            resolvedExecutions,
                            streamBlockState.getNextBlockIndex()
                        );
                        serverSideExecutions.push(...resolvedExecutions);
                        streamBlockState.setNextBlockIndex(streamBlocks.nextIndex);
                        streamBlockState.appendText(streamBlocks.emittedSummaryText);
                        yield* emitEvents(streamBlocks.events);
                    }
                } else {
                    const finalizedToolCall = pendingToolCall.streamState.finalizeEmittedToolCall();
                    if (finalizedToolCall) {
                        completedClientToolCalls.push(finalizedToolCall);
                    }
                    yield* emitEvents(pendingToolCall.streamState.stopEvents());
                    hasClientToolUse = true;
                }
            }
            pendingToolCalls.clear();
        }

        // 处理 thinking 模式下剩余的 content buffer
        yield* emitEvents(thinkingParser.flushRemainingBuffer());

        // 检查文本内容中的 bracket 格式工具调用
        const bracketToolCalls = parseBracketToolCalls(streamBlockState.getTotalContent());
        if (bracketToolCalls && bracketToolCalls.length > 0) {
            for (const btc of bracketToolCalls) {
                const synthesizedToolCall = {
                    toolUseId: btc.id || `tool_${uuidv4()}`,
                    name: btc.function.name,
                    input: JSON.parse(btc.function.arguments || '{}')
                };
                yield* emitEvents(streamBlockState.closeTextBlock());
                const inlineToolUseResult = buildInlineClientToolUseStreamBlocks(
                    synthesizedToolCall,
                    streamBlockState.getNextBlockIndex()
                );
                if (inlineToolUseResult.emittedToolCall) {
                    completedClientToolCalls.push(inlineToolUseResult.emittedToolCall);
                    streamBlockState.setNextBlockIndex(inlineToolUseResult.nextIndex);
                    yield* emitEvents(inlineToolUseResult.events);
                }
            }
        }

        // 3.5. 如果只有 thinking 没有 text/tool，则对齐 kirors：补一个空格 text block，并将 stop_reason 设为 max_tokens
        yield* emitEvents(thinkingParser.closeThinkingBlockIfNeeded());
        const pureThinkingOnly =
            enableThinking &&
            thinkingParser.hasThinkingBlock() &&
            !streamBlockState.getTotalContent() &&
            completedClientToolCalls.length === 0 &&
            serverSideExecutions.length === 0;
        if (pureThinkingOnly) {
            yield* emitEvents(streamBlockState.emitTextDelta(' '));
        }

        // 4. 发送 content_block_stop 事件（text块，如果有的话）
        yield* emitEvents(streamBlockState.closeTextBlock());

        if (completedClientToolCalls.length > 0) {
            for (const tc of completedClientToolCalls) {
                outputTokens += countTextTokens(JSON.stringify(tc.input || {}));
            }
        }

        // 6. 发送代码引用信息（如果有）
        // ⭐ Kiro 特性：追踪 AI 生成代码的来源，符合开源许可证要求
        if (codeReferences.length > 0) {
            yield* emitMessageStartIfNeeded();
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
        outputTokens = countTextTokens(streamBlockState.getTotalContent());
        const thinkingContent = thinkingParser.getThinkingContent();
        if (thinkingContent) {
            outputTokens += countTextTokens(thinkingContent);
        }
        for (const execution of serverSideExecutions) {
            outputTokens += countTextTokens(
                `${execution.summaryText || ''}${JSON.stringify(execution.resultBlocks || [])}`
            );
        }

        const stopReason = pureThinkingOnly
            ? "max_tokens"
            : stopReasonOverride ||
                (hasClientToolUse || completedClientToolCalls.length > 0
                    ? "tool_use"
                    : "end_turn");

        yield* emitMessageStartIfNeeded();

        const messageDelta = {
            type: "message_delta",
            delta: {
                stop_reason: stopReason,
                stop_sequence: null
            },
            usage: {
                input_tokens: resolvedInputTokens,
                output_tokens: outputTokens
            }
        };
        if (serverSideExecutions.length > 0) {
            messageDelta.usage.server_tool_use = {
                web_search_requests: serverSideExecutions.length
            };
        }
        yield messageDelta;

        // 8. 发送 message_stop 事件
        yield { type: "message_stop" };

    } catch (error) {
        logger.error('Error in streaming generation:', error);
        logger.error('Error stack:', error.stack);

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
/**
 * 构造 Claude 风格响应
 *
 * @param {string|Array} content - 响应内容
 * @param {boolean} [isStream=false] - 是否为流式响应
 * @param {string} [role='assistant'] - 角色
 * @param {string} model - 模型名称
 * @param {Array|null} [toolCalls=null] - 工具调用
 * @param {number} [inputTokens=0] - 输入 token 数
 * @returns {Object} Claude 风格响应对象
 */
export function buildClaudeResponse(content, isStream = false, role = 'assistant', model, toolCalls = null, inputTokens = 0, options = {}) {
    const messageId = `${uuidv4()}`;
    const serverWebSearchExecutions = options.serverWebSearchExecutions || [];
    const effectiveInputTokens = options.inputTokensOverride ?? inputTokens;
    const forcedStopReason = options.forcedStopReason || null;

    if (isStream) {
        // 流式响应：返回事件数组
        const events = [];
        let nextBlockIndex = 0;

        // 1. message_start event
        events.push({
            type: "message_start",
            message: {
                id: messageId,
                type: "message",
                role: role,
                model: model,
                usage: {
                    input_tokens: effectiveInputTokens,
                    output_tokens: 0
                },
                content: []
            }
        });

        let totalOutputTokens = 0;
        let stopReason = "end_turn";

        if (content) {
            const contentBlockIndex = nextBlockIndex++;

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

        if (serverWebSearchExecutions.length > 0) {
            const streamBlocks = buildServerSideWebSearchStreamBlocks(
                serverWebSearchExecutions,
                nextBlockIndex
            );
            events.push(...streamBlocks.events);
            nextBlockIndex = streamBlocks.nextIndex;
            totalOutputTokens += countTextTokens(streamBlocks.emittedSummaryText);
            for (const execution of serverWebSearchExecutions) {
                totalOutputTokens += countTextTokens(JSON.stringify(execution.resultBlocks || []));
            }
        }

        if (toolCalls && toolCalls.length > 0) {
            toolCalls.forEach((tc) => {
                const inlineToolUseResult = buildInlineClientToolUseStreamBlocks(tc, nextBlockIndex);
                events.push(...inlineToolUseResult.events);
                nextBlockIndex = inlineToolUseResult.nextIndex;
                const normalizedInput = inlineToolUseResult.emittedToolCall?.input || {};
                totalOutputTokens += countTextTokens(JSON.stringify(normalizedInput));
            });
            stopReason = "tool_use";
        }

        stopReason = forcedStopReason || stopReason;

        // 5. message_delta with appropriate stop reason
        events.push({
            type: "message_delta",
            delta: {
                stop_reason: stopReason,
                stop_sequence: null,
            },
            usage: {
                input_tokens: effectiveInputTokens,
                output_tokens: totalOutputTokens,
                ...(serverWebSearchExecutions.length > 0
                    ? {
                        server_tool_use: {
                            web_search_requests: serverWebSearchExecutions.length
                        }
                    }
                    : {})
            }
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

        if (content) {
            contentArray.push({
                type: "text",
                text: content
            });
            outputTokens += countTextTokens(content);
        }

        for (const execution of serverWebSearchExecutions) {
            contentArray.push({
                type: 'server_tool_use',
                id: execution.toolUseId,
                name: 'web_search',
                input: { query: execution.query }
            });
            contentArray.push({
                type: 'web_search_tool_result',
                content: execution.resultBlocks
            });
            outputTokens += countTextTokens(JSON.stringify(execution.resultBlocks || []));

            if (execution.summaryText) {
                contentArray.push({
                    type: 'text',
                    text: execution.summaryText
                });
                outputTokens += countTextTokens(execution.summaryText);
            }
        }

        if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
                const { toolId, toolName, inputObject } = normalizeToolCallForClaudeOutput(tc);

                contentArray.push({
                    type: "tool_use",
                    id: toolId,
                    name: toolName,
                    input: inputObject
                });
                outputTokens += countTextTokens(JSON.stringify(inputObject));
            }
            stopReason = "tool_use";
        }

        stopReason = forcedStopReason || stopReason;

        return {
            id: messageId,
            type: "message",
            role: role,
            model: model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: effectiveInputTokens,
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
/**
 * 获取使用额度限制
 *
 * @param {Object} service - KiroService 实例
 * @returns {Promise<Object>} 使用额度信息
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
        logger.info('Usage limits fetched successfully');
        return response.data;
    } catch (error) {
        // 如果是 403 错误，尝试刷新 token 后重试
        if (error.response?.status === 403) {
            logger.info('Received 403 on getUsageLimits. Attempting token refresh and retrying...');
            try {
                await initializeAuth(service, true);
                // 更新 Authorization header
                headers['Authorization'] = `Bearer ${service.accessToken}`;
                headers['amz-sdk-invocation-id'] = uuidv4();
                const retryResponse = await service.axiosInstance.get(fullUrl, { headers });
                logger.info('Usage limits fetched successfully after token refresh');
                return retryResponse.data;
            } catch (refreshError) {
                logger.error('Token refresh failed during getUsageLimits retry:', refreshError.message);
                throw refreshError;
            }
        }
        logger.error('Failed to fetch usage limits:', error.message);
        throw error;
    }
}
