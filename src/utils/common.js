/**
 * 通用工具模块
 *
 * 聚合请求解析、鉴权校验、响应封装、内容处理与系统提示管理等能力。
 *
 * @module utils/common
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as http from 'http'; // 用于 IncomingMessage 和 ServerResponse 类型
import * as crypto from 'crypto'; // 用于 MD5 哈希
import { KiroService } from '../kiro/adapter.js'; // KiroService 适配器
import { generateContent, generateContentStream } from '../kiro/api-client.js';
import { KiroStrategy } from '../kiro/strategy.js';
import { KIRO_MODELS } from '../kiro/constants.js';
import os from 'os';
import { createLogger } from '../lib/logger.js';
import { convertData, getOpenAIStreamChunkStop } from './convert.js';
import { getProtocolPrefix, MODEL_PROTOCOL_PREFIX } from './protocol.js';

const logger = createLogger('utils:common');
const DEFAULT_MAX_BODY_BYTES = Number(process.env.REQUEST_MAX_BODY_BYTES) > 0
    ? Number(process.env.REQUEST_MAX_BODY_BYTES)
    : 10 * 1024 * 1024;

/**
 * API 动作常量
 *
 * @type {Object}
 */
export const API_ACTIONS = {
    GENERATE_CONTENT: 'generateContent',
    STREAM_GENERATE_CONTENT: 'streamGenerateContent',
};

/**
 * 模型提供商常量
 *
 * @type {Object}
 */
export const MODEL_PROVIDER = {
    // 模型提供商常量 - 仅 Kiro OAuth
    KIRO_API: 'claude-kiro-oauth',
}

// 处理器使用率计算相关变量
let previousCpuInfo = null;

/**
 * 获取 CPU 使用率百分比
 *
 * @returns {string} CPU 使用率字符串，如 "25.5%"
 */
export function getCpuUsagePercent() {
    const cpus = os.cpus();

    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    }

    const currentCpuInfo = {
        idle: totalIdle,
        total: totalTick
    };

    let cpuPercent = 0;

    if (previousCpuInfo) {
        const idleDiff = currentCpuInfo.idle - previousCpuInfo.idle;
        const totalDiff = currentCpuInfo.total - previousCpuInfo.total;

        if (totalDiff > 0) {
            cpuPercent = 100 - (100 * idleDiff / totalDiff);
        }
    }

    previousCpuInfo = currentCpuInfo;

    return `${cpuPercent.toFixed(1)}%`;
}

/**
 * 端点类型常量
 *
 * @type {Object}
 */
export const ENDPOINT_TYPE = {
    OPENAI_CHAT: 'openai_chat',
    OPENAI_RESPONSES: 'openai_responses',
    CLAUDE_MESSAGE: 'claude_message',
    OPENAI_MODEL_LIST: 'openai_model_list',
};

export const FETCH_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'configs', 'fetch_system_prompt.txt');
export const INPUT_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'configs', 'input_system_prompt.txt');

/**
 * 格式化过期时间为可读字符串
 *
 * @param {number} expiryTimestamp - 过期时间戳（毫秒）
 * @returns {string} 格式化后的时间字符串
 */
export function formatExpiryTime(expiryTimestamp) {
    if (!expiryTimestamp || typeof expiryTimestamp !== 'number') return "No expiry date available";
    const diffMs = expiryTimestamp - Date.now();
    if (diffMs <= 0) return "Token has expired";
    let totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

/**
 * 读取并解析 HTTP 请求体
 *
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @returns {Promise<Object>} 解析后的 JSON 请求体
 * @throws {Error} 请求体不是合法 JSON 时抛出
 */
export function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let receivedBytes = 0;
        req.on('data', chunk => {
            receivedBytes += chunk.length;
            if (receivedBytes > DEFAULT_MAX_BODY_BYTES) {
                const err = new Error('Request body too large');
                err.status = 413;
                req.destroy(err);
                return;
            }
            body += chunk.toString();
        });
        req.on('end', () => {
            if (!body) {
                return resolve({});
            }
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error("Invalid JSON in request body."));
            }
        });
        req.on('error', err => {
            reject(err);
        });
    });
}

/**
 * 根据 API key 检查请求是否授权
 *
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {URL} requestUrl - 解析后的 URL
 * @param {string} REQUIRED_API_KEY - 期望的 API key
 * @returns {boolean} 是否授权
 */
export function isAuthorized(req, requestUrl, REQUIRED_API_KEY) {
    const authHeader = req.headers['authorization'];
    const claudeApiKey = req.headers['x-api-key']; // Claude 专用请求头

    // 检查 Authorization header 中的 Bearer token
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === REQUIRED_API_KEY) {
            return true;
        }
    }

    // 检查 x-api-key header（Claude 风格）
    if (claudeApiKey === REQUIRED_API_KEY) {
        return true;
    }

    logger.warn('[Auth] Unauthorized request denied', {
        bearerPresent: Boolean(authHeader),
        xApiKeyPresent: Boolean(claudeApiKey),
        hasKeyQuery: requestUrl.searchParams.has('key') || requestUrl.searchParams.has('api_key') || requestUrl.searchParams.has('apikey')
    });
    return false;
}

/**
 * 统一处理响应头与返回内容（含一元与流式）
 *
 * 包含写入响应头、输出 payload 等通用逻辑。
 *
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @param {Object|string} responsePayload - 响应内容（非流式为字符串，流式为对象）
 * @param {boolean} isStream - 是否为流式响应
 * @returns {Promise<void>}
 */
export async function handleUnifiedResponse(res, responsePayload, isStream) {
    if (isStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Transfer-Encoding": "chunked" });
    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
    }

    if (isStream) {
        // 流式数据由上层迭代器负责输出
    } else {
        res.end(responsePayload);
    }
}

/**
 * 判断是否可使用账号池
 *
 * @param {Object} config - 配置对象
 * @param {Object} poolManager - 账号池管理器
 * @returns {boolean} 是否可用
 */
function _canUsePool(config, poolManager) {
    return Boolean(poolManager);
}

/**
 * 标记账号为健康
 *
 * @param {string} toProvider - 目标提供商
 * @param {Object} poolManager - 账号池管理器
 * @param {string} uuid - 账号 UUID
 * @returns {void}
 */
function _markPoolHealthy(toProvider, poolManager, uuid) {
    if (!poolManager || !uuid) return;
    if (typeof poolManager.markAccountHealthy === 'function') {
        poolManager.markAccountHealthy(uuid);
        return;
    }
}

/**
 * 标记账号为不健康
 *
 * @param {string} toProvider - 目标提供商
 * @param {Object} poolManager - 账号池管理器
 * @param {string} uuid - 账号 UUID
 * @param {Error} error - 错误对象
 * @returns {void}
 */
function _markPoolUnhealthy(toProvider, poolManager, uuid, error) {
    if (!poolManager || !uuid) return;
    if (typeof poolManager.markAccountUnhealthy === 'function') {
        poolManager.markAccountUnhealthy(uuid, error);
        return;
    }
}

/**
 * 统计可用账号数量
 *
 * @param {Object} config - 配置对象
 * @param {Object} poolManager - 账号池管理器
 * @returns {number} 可用账号数量
 */
function _countAvailablePoolItems(config, poolManager) {
    if (!_canUsePool(config, poolManager)) return 1;

    if (typeof poolManager.listAccounts === 'function') {
        const available = poolManager.listAccounts().filter((a) => a && a.isHealthy && !a.isDisabled).length;
        return available > 0 ? available : 1;
    }

    return 1;
}

/**
 * 处理流式请求
 *
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @param {KiroService} service - 服务适配器
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @param {string} fromProvider - 客户端协议
 * @param {string} toProvider - 后端协议
 * @param {string} PROMPT_LOG_MODE - 提示词日志模式
 * @param {string} PROMPT_LOG_FILENAME - 提示词日志文件名
 * @param {Object} poolManager - 账号池管理器
 * @param {string} pooluuid - 当前账号 UUID
 * @returns {Promise<void>}
 */
export async function handleStreamRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, poolManager, pooluuid) {
    let fullResponseText = '';
    let fullResponseJson = '';
    let fullOldResponseJson = '';
    let responseClosed = false;

    await handleUnifiedResponse(res, '', true);

    // fs.writeFile('request'+Date.now()+'.json', JSON.stringify(requestBody));
    // 服务返回的流为后端协议格式（toProvider）
    requestBody.model = model;
    const needsConversion = getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider);
    const addEvent = getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.CLAUDE || getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES;
    const openStop = getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.OPENAI ;

    let streamStarted = false;
    let nativeStream;

    try {
        nativeStream = await generateContentStream(service, model, requestBody);
    } catch (initialError) {
        // 如果在生成流时就失败（尚未输出数据），交由上层重试
        logger.error(`[Stream] Initial stream generation failed: ${initialError.message}`);
        throw initialError; // 抛出让外层重试逻辑处理
    }

    try {
        streamStarted = true;
        for await (const nativeChunk of nativeStream) {
        // 提取文本用于日志记录
            const chunkText = extractResponseText(nativeChunk, toProvider);
            if (chunkText && !Array.isArray(chunkText)) {
                fullResponseText += chunkText;
            }

            // 按需将流式块转换为客户端协议格式（fromProvider）
            const chunkToSend = needsConversion
                ? convertData(nativeChunk, 'streamChunk', toProvider, fromProvider, model)
                : nativeChunk;

            if (!chunkToSend) {
                continue;
            }

            // 处理 chunkToSend 可能是数组或对象的情况
            const chunksToSend = Array.isArray(chunkToSend) ? chunkToSend : [chunkToSend];

            for (const chunk of chunksToSend) {
                if (addEvent) {
                    // 调试记录事件类型
                    res.write(`event: ${chunk.type}\n`);
                    // 调试输出事件日志
                }

                // 调试记录事件数据
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                // 调试输出数据日志
            }
        }
        if (openStop && needsConversion) {
            res.write(`data: ${JSON.stringify(getOpenAIStreamChunkStop(model))}\n\n`);
            // 调试输出结束块
        }

        // 流式请求成功完成，统计使用次数，错误次数重置为 0
        if (poolManager && pooluuid) {
            logger.info(`[Pool] Increasing usage count for ${toProvider} (${pooluuid}) after successful stream request`);
            _markPoolHealthy(toProvider, poolManager, pooluuid);
        }

    }  catch (error) {
        logger.error(`[Server] Error during stream processing: ${error.stack}`);

        // 如果 stream 已开始传输数据，则无法重试，直接返回错误
        if (streamStarted) {
            if (poolManager && pooluuid) {
                logger.warn(`[Pool] Marking ${toProvider} (${pooluuid}) as unhealthy due to stream error`);
                _markPoolUnhealthy(toProvider, poolManager, pooluuid, error);
            }

            // 使用统一的错误中间件处理流式错误
            // 注意：这里需要构造一个简单的 req 对象来传递必要的信息
            const mockReq = {
                method: 'POST',
                url: '/stream',
                headers: { 'model-provider': fromProvider }
            };
            const { errorMiddleware } = await import('../api/error-middleware.js');
            await errorMiddleware(error, mockReq, res, true);
            res.end();
            responseClosed = true;
        } else {
            // 流还没开始，可以重试，向上抛出错误
            throw error;
        }
    } finally {
        if (!responseClosed) {
            res.end();
        }
        logger.verbose(fullResponseText);
    }
}


/**
 * 处理一元请求
 *
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @param {KiroService} service - 服务适配器
 * @param {string} model - 模型名称
 * @param {Object} requestBody - 请求体
 * @param {string} fromProvider - 客户端协议
 * @param {string} toProvider - 后端协议
 * @param {string} PROMPT_LOG_MODE - 提示词日志模式
 * @param {string} PROMPT_LOG_FILENAME - 提示词日志文件名
 * @param {Object} poolManager - 账号池管理器
 * @param {string} pooluuid - 当前账号 UUID
 * @returns {Promise<void>}
 */
export async function handleUnaryRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, poolManager, pooluuid) {
    let responseWritten = false;
    try{
        requestBody.model = model;
        // fs.writeFile('oldRequest'+Date.now()+'.json', JSON.stringify(requestBody));
        const nativeResponse = await generateContent(service, model, requestBody);
        const responseText = extractResponseText(nativeResponse, toProvider);

        // 按需将响应转换为客户端协议格式（fromProvider）
        let clientResponse = nativeResponse;
        const needsConversion = getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider);
        if (needsConversion) {
            clientResponse = convertData(nativeResponse, 'response', toProvider, fromProvider, model);
        }

        // 调试输出响应内容
        await handleUnifiedResponse(res, JSON.stringify(clientResponse), false);
        responseWritten = true;
        logger.verbose(responseText);

        // 一元请求成功完成，统计使用次数，错误次数重置为 0
        if (poolManager && pooluuid) {
            logger.info(`[Pool] Increasing usage count for ${toProvider} (${pooluuid}) after successful unary request`);
            _markPoolHealthy(toProvider, poolManager, pooluuid);
        }
    } catch (error) {
        logger.error(`[Server] Error during unary processing: ${error.stack}`);

        // 如果响应已经写入，无法重试，直接返回错误
        if (responseWritten) {
            if (poolManager && pooluuid) {
                logger.warn(`[Pool] Marking ${toProvider} (${pooluuid}) as unhealthy due to unary error`);
                _markPoolUnhealthy(toProvider, poolManager, pooluuid, error);
            }

            // 使用新方法创建符合 fromProvider 格式的错误响应
            const errorResponse = createErrorResponse(error, fromProvider);
            await handleUnifiedResponse(res, JSON.stringify(errorResponse), false);
        } else {
        // 响应还没写入，可以重试，向上抛出错误
            throw error;
        }
    }
}

/**
 * 处理内容生成请求（支持一元与流式）
 *
 * 包含请求解析、协议转换、日志记录与分发到流式/一元处理器的逻辑。
 *
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @param {KiroService} service - API 服务适配器
 * @param {string} endpointType - 端点类型（如 CLAUDE_MESSAGE）
 * @param {Object} CONFIG - 服务器配置对象
 * @param {string} PROMPT_LOG_FILENAME - 提示词日志文件名
 * @param {Object} providerPoolManager - 账号池管理器
 * @param {string} pooluuid - 当前账号 UUID
 * @returns {Promise<void>}
 */
export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid) {
    const originalRequestBody = await getRequestBody(req);
    if (!originalRequestBody) {
        throw new Error("Request body is missing for content generation.");
    }

    const clientProviderMap = {
        [ENDPOINT_TYPE.OPENAI_CHAT]: MODEL_PROTOCOL_PREFIX.OPENAI,
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES,
        [ENDPOINT_TYPE.CLAUDE_MESSAGE]: MODEL_PROTOCOL_PREFIX.CLAUDE,
    };

    const fromProvider = clientProviderMap[endpointType];
    const toProvider = CONFIG.MODEL_PROVIDER;
    logger.warn(`fromProvider: ${fromProvider}, toProvider: ${toProvider}`);

    if (!fromProvider) {
        throw new Error(`Unsupported endpoint type for content generation: ${endpointType}`);
    }

    // 2. 提取模型并判断是否为流式请求
    let model = originalRequestBody.model;
    /**
     * 这里需要一个转换列表，将 OpenAI 的模型名称转换为 Claude 对应的模型名称
     * 例如：
     * gpt-5.2-codex -> 'claude-opus-4-5'
     * gpt-5.2 -> 'claude-opus-4-5'
     * gpt-5.1 -> 'claude-sonnet-4-5'
     * gpt-5.1-codex -> 'claude-sonnet-4-5'
     * 其它都转换成 claude-sonnet-4-5
     */
    const modelMapping = {
        'gpt-5.2-codex': 'claude-opus-4-5',
        'gpt-5.2': 'claude-opus-4-5',
        'gpt-5.1': 'claude-sonnet-4-5',
        'gpt-5.1-codex': 'claude-sonnet-4-5',
    };
    let mappedModel = modelMapping[model] ?? model;
    if (!KIRO_MODELS.includes(mappedModel)) {
        mappedModel = 'claude-sonnet-4-5';
    }
    model = mappedModel;
    const isStream = originalRequestBody.stream === true;

    if (!model) {
        throw new Error("Could not determine the model from the request.");
    }
    logger.warn(`Model: ${model}, Stream: ${isStream}`);

    // 1. 按需将请求体从客户端格式转换为后端格式
    let processedRequestBody = originalRequestBody;
    if (fromProvider !== MODEL_PROTOCOL_PREFIX.CLAUDE) {
        logger.warn(`Converting request from ${fromProvider} to ${toProvider}`);
        processedRequestBody = convertData(originalRequestBody, 'request', fromProvider, toProvider);
        // 如果 processedRequestBody 中有 model，则需要更新为转换后的 model
        if (processedRequestBody.model) {
            processedRequestBody.model = model;
        }
        logger.warn(`Converted request: ${JSON.stringify(processedRequestBody)}`);
    } else {
        logger.log(`Request format matches backend provider. No conversion needed.`);
    }

    // 2.5. 如果使用了号池，根据模型重新选择提供商
    // 注意：这里使用 skipUsageCount: true，因为初次选择时已经增加了 usageCount
    if (_canUsePool(CONFIG, providerPoolManager)) {
        const { getApiService } = await import('../services/manager.js');
        service = await getApiService(CONFIG, model);
        logger.info(`Re-selected service adapter based on model: ${model}`);
    }

    // 3. 如果配置了 system prompt 文件，则应用系统提示词
    processedRequestBody = await _applySystemPromptFromFile(CONFIG, processedRequestBody, toProvider);
    await _manageSystemPrompt(processedRequestBody, toProvider);

    // 4. 记录传入的提示词（在可能完成协议转换之后）
    const promptText = extractPromptText(processedRequestBody, toProvider);
    logger.verbose(promptText);

    // 5. 添加重试逻辑：如果使用了号池，当请求失败时自动切换到下一个健康的 provider
    // 限制最多重试 3 次，避免把所有 provider 都试一遍
    const availableProviders = _countAvailablePoolItems(CONFIG, providerPoolManager);
    const maxRetries = Math.min(3, availableProviders);

    let lastError = null;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            // 调用流式/一元处理器，并传递 provider 信息
            if (isStream) {
                await handleStreamRequest(res, service, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid);
            } else {
                await handleUnaryRequest(res, service, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid);
            }
            return; // 成功则直接返回
        } catch (error) {
            lastError = error;
            retryCount++;

            // 检查是否是客户端错误（不应该重试的错误）
            const isClientError = error.message && (
                error.message.includes('Invalid tool format') ||
                error.message.includes('Invalid request') ||
                error.message.includes('Invalid model') ||
                error.message.includes('Missing required') ||
                error.message.includes('Bad Request') ||
                (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429)
            );

            if (isClientError) {
                logger.warn(`[Provider Retry] Client error detected, not retrying: ${error.message}`);
                // 客户端错误不计入provider的错误计数，直接抛出
                throw error;
            }

            // 标记当前 provider 为 unhealthy
            if (providerPoolManager && pooluuid) {
                logger.info(`[Pool Retry] Request failed with ${pooluuid}, attempt ${retryCount}/${maxRetries}`);
                _markPoolUnhealthy(toProvider, providerPoolManager, pooluuid, error);
            }

            // 如果还有重试机会，选择下一个健康的 provider
            if (retryCount < maxRetries && _canUsePool(CONFIG, providerPoolManager)) {
                logger.info('[Pool Retry] Selecting next healthy account/provider...');
                const { getApiService } = await import('../services/manager.js');
                const newConfig = { ...CONFIG };
                service = await getApiService(newConfig, model);
                pooluuid = newConfig.uuid;
                logger.info(`[Pool Retry] Switched to: ${pooluuid}`);
            } else {
                // 没有重试机会了，抛出最后的错误
                break;
            }
        }
    }

    // 所有重试都失败，抛出最后一个错误
    logger.error(`[Pool Retry] All ${maxRetries} attempts failed. Last error:`, lastError?.message);
    throw lastError || new Error('All accounts/providers failed');
}

/**
 * 从请求中提取模型与流式标记
 *
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @param {Object} requestBody - 解析后的请求体
 * @param {string} fromProvider - 端点类型
 * @returns {{model: string, isStream: boolean}} 模型名称与流式标记
 */
function _extractModelAndStreamInfo(req, requestBody, fromProvider) {
    const model = requestBody.model;
    const isStream = requestBody.stream === true;
    return { model, isStream };
}

async function _applySystemPromptFromFile(config, requestBody, toProvider) {
    const strategy = new KiroStrategy();
    return strategy.applySystemPromptFromFile(config, requestBody);
}

/**
 * 管理系统提示词文件（同步内存与文件内容）
 *
 * @param {Object} requestBody - 请求体
 * @param {string} provider - 提供商类型
 * @returns {Promise<void>}
 */
async function _manageSystemPrompt(requestBody, provider) {
    let incomingSystemText = extractSystemPromptFromRequestBody(requestBody, 'claude');
    let currentSystemText = '';
    try {
        currentSystemText = await fs.readFile(FETCH_SYSTEM_PROMPT_FILE, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            logger.error(`Error reading system prompt file: ${error.message}`);
        }
    }

    try {
        if (incomingSystemText && incomingSystemText !== currentSystemText) {
            await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, incomingSystemText);
            logger.info('System prompt updated.');
        } else if (!incomingSystemText && currentSystemText) {
            await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, '');
            logger.info('System prompt cleared from file.');
        }
    } catch (error) {
        logger.error(`Failed to manage system prompt file: ${error.message}`);
    }
}

// 内容提取与转换的辅助函数
/**
 * 提取响应文本
 *
 * @param {Object} response - 响应对象
 * @param {string} provider - 提供商类型
 * @returns {string} 响应文本
 */
export function extractResponseText(response, provider) {
    const strategy = new KiroStrategy();
    return strategy.extractResponseText(response);
}

/**
 * 提取请求体中的提示词文本
 *
 * @param {Object} requestBody - 请求体
 * @param {string} provider - 提供商类型
 * @returns {string} 提示词文本
 */
export function extractPromptText(requestBody, provider) {
    const strategy = new KiroStrategy();
    return strategy.extractPromptText(requestBody);
}

/**
 * 从请求体中提取系统提示词
 *
 * @param {Object} requestBody - 请求体对象
 * @param {string} provider - 提供商类型（如 'claude'）
 * @returns {string} 提取到的系统提示词字符串
 */
export function extractSystemPromptFromRequestBody(requestBody, provider) {
    let incomingSystemText = '';
    if (typeof requestBody.system === 'string') {
        incomingSystemText = requestBody.system;
    } else if (typeof requestBody.system === 'object') {
        incomingSystemText = JSON.stringify(requestBody.system);
    } else if (requestBody.messages?.length > 0) {
        // 如果没有 system 字段，回退到首条 user 消息
        const userMessage = requestBody.messages.find(m => m.role === 'user');
        if (userMessage) {
            if (Array.isArray(userMessage.content)) {
                incomingSystemText = userMessage.content.map(block => block.text).join('');
            } else {
                incomingSystemText = userMessage.content;
            }
        }
    }
    return incomingSystemText;
}

/**
 * 生成对象的 MD5 哈希（先转为 JSON 字符串）
 *
 * @param {object} obj - 需要哈希的对象
 * @returns {string} MD5 哈希值
 */
export function getMD5Hash(obj) {
    const jsonString = JSON.stringify(obj);
    return crypto.createHash('md5').update(jsonString).digest('hex');
}


/**
 * 创建符合 fromProvider 格式的错误响应（非流式）
 *
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {Object} 格式化的错误响应对象
 */
export function createErrorResponse(error, fromProvider) {
    const protocolPrefix = getProtocolPrefix(fromProvider);
    const statusCode = error.status || error.code || 500;
    const errorMessage = error.message || "An error occurred during processing.";
    
    // 根据 HTTP 状态码映射错误类型
    const getErrorType = (code) => {
        if (code === 401) return 'authentication_error';
        if (code === 403) return 'permission_error';
        if (code === 429) return 'rate_limit_error';
        if (code >= 500) return 'server_error';
        return 'invalid_request_error';
    };
    
    switch (protocolPrefix) {
        case 'claude':
            // Claude 非流式错误格式（外层有 type 标记）
            return {
                type: "error",  // 核心区分标记
                error: {
                    type: getErrorType(statusCode),  // Claude 使用 error.type 作为核心判断
                    message: errorMessage
                }
            };
            
        default:
            // 默认
            return {
                error: {
                    message: errorMessage,
                    type: getErrorType(statusCode),
                    code: getErrorType(statusCode)
                }
            };
    }
}

/**
 * 创建符合 fromProvider 格式的流式错误响应
 *
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {string} 格式化的流式错误响应字符串
 */
function createStreamErrorResponse(error, fromProvider) {
    const protocolPrefix = getProtocolPrefix(fromProvider);
    const statusCode = error.status || error.code || 500;
    const errorMessage = error.message || "An error occurred during streaming.";
    
    // 根据 HTTP 状态码映射错误类型
    const getErrorType = (code) => {
        if (code === 401) return 'authentication_error';
        if (code === 403) return 'permission_error';
        if (code === 429) return 'rate_limit_error';
        if (code >= 500) return 'server_error';
        return 'invalid_request_error';
    };
    
    switch (protocolPrefix) {
        case 'claude':
            // Claude 流式错误格式（SSE 事件与数据）
            const claudeError = {
                type: "error",
                error: {
                    type: getErrorType(statusCode),
                    message: errorMessage
                }
            };
            return `event: error\ndata: ${JSON.stringify(claudeError)}\n\n`;
            
        default:
            // 默认
            const defaultError = {
                error: {
                    message: errorMessage,
                    type: getErrorType(statusCode),
                    code: null
                }
            };
            return `data: ${JSON.stringify(defaultError)}\n\n`;
    }
}
