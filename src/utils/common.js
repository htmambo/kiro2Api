import { promises as fs } from 'fs';
import * as path from 'path';
import * as http from 'http'; // Add http for IncomingMessage and ServerResponse types
import * as crypto from 'crypto'; // Import crypto for MD5 hashing
import { KiroService } from '../kiro/core.js'; // Import KiroService
import { KiroStrategy } from '../kiro/strategy.js';

export const API_ACTIONS = {
    GENERATE_CONTENT: 'generateContent',
    STREAM_GENERATE_CONTENT: 'streamGenerateContent',
};

export const MODEL_PROVIDER = {
    // Model provider constants - Only Kiro OAuth
    KIRO_API: 'claude-kiro-oauth',
}

/**
 * Extracts the protocol prefix from a given model provider string.
 * This is used to determine if two providers belong to the same underlying protocol (e.g., claude).
 * @param {string} provider - The model provider string (e.g., 'claude-kiro-oauth').
 * @returns {string} The protocol prefix (e.g., 'claude').
 */
export function getProtocolPrefix(provider) {
    const hyphenIndex = provider.indexOf('-');
    if (hyphenIndex !== -1) {
        return provider.substring(0, hyphenIndex);
    }
    return provider; // Return original if no hyphen is found
}

export const ENDPOINT_TYPE = {
    CLAUDE_MESSAGE: 'claude_message',
};

export const FETCH_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'configs', 'fetch_system_prompt.txt');
export const INPUT_SYSTEM_PROMPT_FILE = path.join(process.cwd(), 'configs', 'input_system_prompt.txt');

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
 * Reads the entire request body from an HTTP request.
 * @param {http.IncomingMessage} req - The HTTP request object.
 * @returns {Promise<Object>} A promise that resolves with the parsed JSON request body.
 * @throws {Error} If the request body is not valid JSON.
 */
export function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
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

export async function logConversation(type, content, logMode, logFilename) {
    if (logMode === 'none') return;
    if (!content) return;

    const timestamp = new Date().toLocaleString();
    const logEntry = `${timestamp} [${type.toUpperCase()}]:\n${content}\n--------------------------------------\n`;

    if (logMode === 'console') {
        console.log(logEntry);
    } else if (logMode === 'file') {
        try {
            // Append to the file
            await fs.appendFile(logFilename, logEntry);
        } catch (err) {
            console.error(`[Error] Failed to write conversation log to ${logFilename}:`, err);
        }
    }
}

/**
 * Checks if the request is authorized based on API key.
 * @param {http.IncomingMessage} req - The HTTP request object.
 * @param {URL} requestUrl - The parsed URL object.
 * @param {string} REQUIRED_API_KEY - The API key required for authorization.
 * @returns {boolean} True if authorized, false otherwise.
 */
export function isAuthorized(req, requestUrl, REQUIRED_API_KEY) {
    const authHeader = req.headers['authorization'];
    const queryKey = requestUrl.searchParams.get('key');
    const googApiKey = req.headers['x-goog-api-key'];
    const claudeApiKey = req.headers['x-api-key']; // Claude-specific header

    // Check for Bearer token in Authorization header
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === REQUIRED_API_KEY) {
            return true;
        }
    }

    // Check for API key in x-api-key header (Claude style)
    if (claudeApiKey === REQUIRED_API_KEY) {
        return true;
    }

    console.log(`[Auth] Unauthorized request denied. Bearer: "${authHeader ? 'present' : 'N/A'}", Query Key: "${queryKey}", x-goog-api-key: "${googApiKey}", x-api-key: "${claudeApiKey}"`);
    return false;
}

/**
 * Handles the common logic for sending API responses (unary and stream).
 * This includes writing response headers, logging conversation, and logging auth token expiry.
 * @param {http.ServerResponse} res - The HTTP response object.
 * @param {Object} responsePayload - The actual response payload (string for unary, object for stream chunks).
 * @param {boolean} isStream - Whether the response is a stream.
 */
export async function handleUnifiedResponse(res, responsePayload, isStream) {
    if (isStream) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Transfer-Encoding": "chunked" });
    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
    }

    if (isStream) {
        // Stream chunks are handled by the calling function that iterates the stream
    } else {
        res.end(responsePayload);
    }
}

function _canUsePool(config, poolManager) {
    return Boolean(poolManager);
}

function _markPoolHealthy(toProvider, poolManager, uuid) {
    if (!poolManager || !uuid) return;
    if (typeof poolManager.markAccountHealthy === 'function') {
        poolManager.markAccountHealthy(uuid);
        return;
    }
    if (typeof poolManager.markProviderHealthy === 'function') {
        poolManager.markProviderHealthy(toProvider, { uuid });
    }
}

function _markPoolUnhealthy(toProvider, poolManager, uuid, error) {
    if (!poolManager || !uuid) return;
    if (typeof poolManager.markAccountUnhealthy === 'function') {
        poolManager.markAccountUnhealthy(uuid, error);
        return;
    }
    if (typeof poolManager.markProviderUnhealthy === 'function') {
        poolManager.markProviderUnhealthy(toProvider, { uuid }, error);
    }
}

function _countAvailablePoolItems(config, poolManager) {
    if (!_canUsePool(config, poolManager)) return 1;

    if (typeof poolManager.listAccounts === 'function') {
        const available = poolManager.listAccounts().filter((a) => a && a.isHealthy && !a.isDisabled).length;
        return available > 0 ? available : 1;
    }

    return 1;
}

export async function handleStreamRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, poolManager, pooluuid) {
    let fullResponseText = '';
    let fullResponseJson = '';
    let fullOldResponseJson = '';
    let responseClosed = false;

    await handleUnifiedResponse(res, '', true);

    // fs.writeFile('request'+Date.now()+'.json', JSON.stringify(requestBody));
    // The service returns a stream in its native format (toProvider).
    requestBody.model = model;

    let nativeStream;
    let streamStarted = false;

    try {
        nativeStream = await service.generateContentStream(model, requestBody);
    } catch (initialError) {
        // 如果在生成stream时就失败了（还没有开始传输数据），尝试重试其他provider
        console.error('[Stream] Initial stream generation failed:', initialError.message);
        throw initialError; // 抛出让外层重试逻辑处理
    }

    const addEvent = getProtocolPrefix(fromProvider) === 'claude';

    try {
        streamStarted = true;
        for await (const nativeChunk of nativeStream) {
            // Extract text for logging purposes
            const chunkText = extractResponseText(nativeChunk, toProvider);
            if (chunkText && !Array.isArray(chunkText)) {
                fullResponseText += chunkText;
            }

            // Convert the complete chunk object to the client's format (fromProvider), if necessary.
            const chunkToSend = nativeChunk;

            if (!chunkToSend) {
                continue;
            }

            // 处理 chunkToSend 可能是数组或对象的情况
            const chunksToSend = Array.isArray(chunkToSend) ? chunkToSend : [chunkToSend];

            for (const chunk of chunksToSend) {
                if (addEvent) {
                    // fullOldResponseJson += chunk.type+"\n";
                    // fullResponseJson += chunk.type+"\n";
                    res.write(`event: ${chunk.type}\n`);
                    // console.log(`event: ${chunk.type}\n`);
                }

                // fullOldResponseJson += JSON.stringify(chunk)+"\n";
                // fullResponseJson += JSON.stringify(chunk)+"\n\n";
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                // console.log(`data: ${JSON.stringify(chunk)}\n`);
            }
        }

        // 流式请求成功完成，统计使用次数，错误次数重置为0
        if (poolManager && pooluuid) {
            console.log(`[Pool] Increasing usage count for ${toProvider} (${pooluuid}) after successful stream request`);
            _markPoolHealthy(toProvider, poolManager, pooluuid);
        }

    }  catch (error) {
        console.error('\n[Server] Error during stream processing:', error.stack);

        // 如果stream已经开始传输数据，则无法重试，直接返回错误
        if (streamStarted) {
            if (poolManager && pooluuid) {
                console.log(`[Pool] Marking ${toProvider} (${pooluuid}) as unhealthy due to stream error`);
                _markPoolUnhealthy(toProvider, poolManager, pooluuid, error);
            }

            // 使用新方法创建符合 fromProvider 格式的流式错误响应
            const errorPayload = createStreamErrorResponse(error, fromProvider);
            res.write(errorPayload);
            res.end();
            responseClosed = true;
        } else {
            // Stream还没开始，可以重试，向上抛出错误
            throw error;
        }
    } finally {
        if (!responseClosed) {
            res.end();
        }
        await logConversation('output', fullResponseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
        // fs.writeFile('oldResponseChunk'+Date.now()+'.json', fullOldResponseJson);
        // fs.writeFile('responseChunk'+Date.now()+'.json', fullResponseJson);
    }
}


export async function handleUnaryRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, poolManager, pooluuid) {
    let responseWritten = false;
    try{
        requestBody.model = model;
        // fs.writeFile('oldRequest'+Date.now()+'.json', JSON.stringify(requestBody));
        const nativeResponse = await service.generateContent(model, requestBody);
        const responseText = extractResponseText(nativeResponse, toProvider);

        // Convert the response back to the client's format (fromProvider), if necessary.
        let clientResponse = nativeResponse;

        //console.log(`[Response] Sending response to client: ${JSON.stringify(clientResponse)}`);
        await handleUnifiedResponse(res, JSON.stringify(clientResponse), false);
        responseWritten = true;
        await logConversation('output', responseText, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);
        // fs.writeFile('oldResponse'+Date.now()+'.json', JSON.stringify(clientResponse));

        // 一元请求成功完成，统计使用次数，错误次数重置为0
        if (poolManager && pooluuid) {
            console.log(`[Pool] Increasing usage count for ${toProvider} (${pooluuid}) after successful unary request`);
            _markPoolHealthy(toProvider, poolManager, pooluuid);
        }
    } catch (error) {
        console.error('\n[Server] Error during unary processing:', error.stack);

        // 如果响应已经写入，无法重试，直接返回错误
        if (responseWritten) {
            if (poolManager && pooluuid) {
                console.log(`[Pool] Marking ${toProvider} (${pooluuid}) as unhealthy due to unary error`);
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
 * Handles requests for content generation (both unary and streaming). This function
 * logging, and dispatching to the appropriate stream or unary handler.
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {http.ServerResponse} res The HTTP response object.
 * @param {KiroService} service The API service adapter.
 * @param {string} endpointType The type of endpoint being called (e.g., CLAUDE_MESSAGE).
 * @param {Object} CONFIG - The server configuration object.
 * @param {string} PROMPT_LOG_FILENAME - The prompt log filename.
 */
export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid) {
    const originalRequestBody = await getRequestBody(req);
    if (!originalRequestBody) {
        throw new Error("Request body is missing for content generation.");
    }

    const clientProviderMap = {
        [ENDPOINT_TYPE.CLAUDE_MESSAGE]: 'claude',
    };

    const fromProvider = clientProviderMap[endpointType];
    const toProvider = CONFIG.MODEL_PROVIDER;
    console.warn(`[Content Generation] fromProvider: ${fromProvider}, toProvider: ${toProvider}`);

    if (!fromProvider) {
        throw new Error(`Unsupported endpoint type for content generation: ${endpointType}`);
    }

    // 1. Convert request body from client format to backend format, if necessary.
    let processedRequestBody = originalRequestBody;

    // 2. Extract model and determine if the request is for streaming.
    const { model, isStream } = _extractModelAndStreamInfo(req, originalRequestBody, fromProvider);

    if (!model) {
        throw new Error("Could not determine the model from the request.");
    }
    console.warn(`[Content Generation] Model: ${model}, Stream: ${isStream}`);

    // 2.5. 如果使用了提供商池，根据模型重新选择提供商
    // 注意：这里使用 skipUsageCount: true，因为初次选择时已经增加了 usageCount
    if (_canUsePool(CONFIG, providerPoolManager)) {
        const { getApiService } = await import('../services/manager.js');
        service = await getApiService(CONFIG, model);
        console.log(`[Content Generation] Re-selected service adapter based on model: ${model}`);
    }

    // 3. Apply system prompt from file if configured.
    processedRequestBody = await _applySystemPromptFromFile(CONFIG, processedRequestBody, toProvider);
    await _manageSystemPrompt(processedRequestBody, toProvider);

    // 4. Log the incoming prompt (after potential conversion to the backend's format).
    const promptText = extractPromptText(processedRequestBody, toProvider);
    await logConversation('input', promptText, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME);

    // 5. 添加重试逻辑：如果使用了提供商池，当请求失败时自动切换到下一个健康的provider
    // 限制最多重试3次，避免把所有provider都试一遍
    const availableProviders = _countAvailablePoolItems(CONFIG, providerPoolManager);
    const maxRetries = Math.min(3, availableProviders);

    let lastError = null;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            // Call the appropriate stream or unary handler, passing the provider info.
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
                console.log(`[Provider Retry] Client error detected, not retrying: ${error.message}`);
                // 客户端错误不计入provider的错误计数，直接抛出
                throw error;
            }

            // 标记当前provider为unhealthy
            if (providerPoolManager && pooluuid) {
                console.log(`[Pool Retry] Request failed with ${pooluuid}, attempt ${retryCount}/${maxRetries}`);
                _markPoolUnhealthy(toProvider, providerPoolManager, pooluuid, error);
            }

            // 如果还有重试机会，选择下一个健康的provider
            if (retryCount < maxRetries && _canUsePool(CONFIG, providerPoolManager)) {
                console.log('[Pool Retry] Selecting next healthy account/provider...');
                const { getApiService } = await import('../services/manager.js');
                const newConfig = { ...CONFIG };
                service = await getApiService(newConfig, model);
                pooluuid = newConfig.uuid;
                console.log(`[Pool Retry] Switched to: ${pooluuid}`);
            } else {
                // 没有重试机会了，抛出最后的错误
                break;
            }
        }
    }

    // 所有重试都失败，抛出最后一个错误
    console.error(`[Pool Retry] All ${maxRetries} attempts failed. Last error:`, lastError?.message);
    throw lastError || new Error('All accounts/providers failed');
}

/**
 * Helper function to extract model and stream information from the request.
 * @param {http.IncomingMessage} req The HTTP request object.
 * @param {Object} requestBody The parsed request body.
 * @param {string} fromProvider The type of endpoint being called.
 * @returns {{model: string, isStream: boolean}} An object containing the model name and stream status.
 */
function _extractModelAndStreamInfo(req, requestBody, fromProvider) {
    const strategy = new KiroStrategy();
    return strategy.extractModelAndStreamInfo(req, requestBody);
}

async function _applySystemPromptFromFile(config, requestBody, toProvider) {
    const strategy = new KiroStrategy();
    return strategy.applySystemPromptFromFile(config, requestBody);
}

async function _manageSystemPrompt(requestBody, provider) {
    let incomingSystemText = extractSystemPromptFromRequestBody(requestBody, 'claude');
    let currentSystemText = '';
    try {
        currentSystemText = await fs.readFile(FETCH_SYSTEM_PROMPT_FILE, 'utf8');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`[System Prompt Manager] Error reading system prompt file: ${error.message}`);
        }
    }

    try {
        if (incomingSystemText && incomingSystemText !== currentSystemText) {
            await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, incomingSystemText);
            console.log(`[System Prompt Manager] System prompt updated in file for provider '${providerName}'.`);
        } else if (!incomingSystemText && currentSystemText) {
            await fs.writeFile(FETCH_SYSTEM_PROMPT_FILE, '');
            console.log('[System Prompt Manager] System prompt cleared from file.');
        }
    } catch (error) {
        console.error(`[System Prompt Manager] Failed to manage system prompt file: ${error.message}`);
    }
}



// Helper functions for content extraction and conversion
export function extractResponseText(response, provider) {
    const strategy = new KiroStrategy();
    return strategy.extractResponseText(response);
}

export function extractPromptText(requestBody, provider) {
    const strategy = new KiroStrategy();
    return strategy.extractPromptText(requestBody);
}

export function handleError(res, error) {
    const statusCode = error.response?.status || 500;
    let errorMessage = error.message;
    let suggestions = [];

    // Provide detailed information and suggestions for different error types
    switch (statusCode) {
        case 401:
            errorMessage = 'Authentication failed. Please check your credentials.';
            suggestions = [
                'Verify your OAuth credentials are valid',
                'Try re-authenticating by deleting the credentials file',
                'Check if your Google Cloud project has the necessary permissions'
            ];
            break;
        case 403:
            errorMessage = 'Access forbidden. Insufficient permissions.';
            suggestions = [
                'Ensure your Google Cloud project has the Code Assist API enabled',
                'Check if your account has the necessary permissions',
                'Verify the project ID is correct'
            ];
            break;
        case 429:
            errorMessage = 'Too many requests. Rate limit exceeded.';
            suggestions = [
                'The request has been automatically retried with exponential backoff',
                'If the issue persists, try reducing the request frequency',
                'Consider upgrading your API quota if available'
            ];
            break;
        case 500:
        case 502:
        case 503:
        case 504:
            errorMessage += 'Server error occurred. This is usually temporary.';
            suggestions = [
                'The request has been automatically retried',
                'If the issue persists, try again in a few minutes',
                'Check Google Cloud status page for service outages'
            ];
            break;
        default:
            if (statusCode >= 400 && statusCode < 500) {
                errorMessage = `Client error (${statusCode}): ${error.message}`;
                suggestions = ['Check your request format and parameters'];
            } else if (statusCode >= 500) {
                errorMessage = `Server error (${statusCode}): ${error.message}`;
                suggestions = ['This is a server-side issue, please try again later'];
            }
    }

    console.error(`\n[Server] Request failed (${statusCode}): ${errorMessage}`);
    if (suggestions.length > 0) {
        console.error('[Server] Suggestions:');
        suggestions.forEach((suggestion, index) => {
            console.error(`  ${index + 1}. ${suggestion}`);
        });
    }
    console.error('[Server] Full error details:', error.stack);

    if (!res.headersSent) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    }

    const errorPayload = {
        error: {
            message: errorMessage,
            code: statusCode,
            suggestions: suggestions,
            details: error.response?.data
        }
    };
    res.end(JSON.stringify(errorPayload));
}

/**
 * 从请求体中提取系统提示词。
 * @param {Object} requestBody - 请求体对象。
 * @param {string} provider - 提供商类型（'claude'）。
 * @returns {string} 提取到的系统提示词字符串。
 */
export function extractSystemPromptFromRequestBody(requestBody, provider) {
    let incomingSystemText = '';
    if (typeof requestBody.system === 'string') {
        incomingSystemText = requestBody.system;
    } else if (typeof requestBody.system === 'object') {
        incomingSystemText = JSON.stringify(requestBody.system);
    } else if (requestBody.messages?.length > 0) {
        // Fallback to first user message if no system property
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
 * Generates an MD5 hash for a given object by first converting it to a JSON string.
 * @param {object} obj - The object to hash.
 * @returns {string} The MD5 hash of the object's JSON string representation.
 */
export function getMD5Hash(obj) {
    const jsonString = JSON.stringify(obj);
    return crypto.createHash('md5').update(jsonString).digest('hex');
}


/**
 * 创建符合 fromProvider 格式的错误响应（非流式）
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {Object} 格式化的错误响应对象
 */
function createErrorResponse(error, fromProvider) {
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
            // Claude 流式错误格式（SSE event + data）
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
