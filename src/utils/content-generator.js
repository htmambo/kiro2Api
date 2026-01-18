import { promises as fs } from 'fs';
import { KiroStrategy } from '../kiro/strategy.js';
import { KIRO_MODELS } from '../kiro/constants.js';
import { generateContent, generateContentStream } from '../kiro/api-client.js';
import { convertData, getOpenAIStreamChunkStop } from './convert.js';
import { getProtocolPrefix, MODEL_PROTOCOL_PREFIX } from './protocol.js';
import { getRequestBody as getRequestBodyFromModule } from './request-body.js';
import { createLogger } from '../lib/logger.js';
import { ENDPOINT_TYPE, FETCH_SYSTEM_PROMPT_FILE } from './constants.js';
import { handleUnifiedResponse, createErrorResponse } from './response-wrapper.js';
import { extractPromptText, extractSystemPromptFromRequestBody } from './prompt-utils.js';
import { canUsePool, countAvailablePoolItems, markPoolHealthy, markPoolUnhealthy } from './account-pool-utils.js';

const logger = createLogger('utils:content-generator');

export async function handleContentGenerationRequest(req, res, service, endpointType, CONFIG, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid) {
    const originalRequestBody = await getRequestBodyFromModule(req);
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

    let model = originalRequestBody.model;
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

    let processedRequestBody = originalRequestBody;
    if (fromProvider !== MODEL_PROTOCOL_PREFIX.CLAUDE) {
        logger.warn(`Converting request from ${fromProvider} to ${toProvider}`);
        processedRequestBody = convertData(originalRequestBody, 'request', fromProvider, toProvider);
        if (processedRequestBody.model) {
            processedRequestBody.model = model;
        }
        logger.warn(`Converted request: ${JSON.stringify(processedRequestBody)}`);
    } else {
        logger.log(`Request format matches backend provider. No conversion needed.`);
    }

    if (canUsePool(CONFIG, providerPoolManager)) {
        const { getApiService } = await import('../services/manager.js');
        service = await getApiService(CONFIG, model);
        logger.debug(`Re-selected service adapter based on model: ${model}`);
    }

    processedRequestBody = await applySystemPromptFromFile(CONFIG, processedRequestBody, toProvider);
    await manageSystemPrompt(processedRequestBody, toProvider);

    const promptText = extractPromptText(processedRequestBody);
    logger.verbose(promptText);

    const availableProviders = countAvailablePoolItems(CONFIG, providerPoolManager);
    const maxRetries = Math.min(3, availableProviders);

    let lastError = null;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            if (isStream) {
                await handleStreamRequest(res, service, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid);
            } else {
                await handleUnaryRequest(res, service, model, processedRequestBody, fromProvider, toProvider, CONFIG.PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, providerPoolManager, pooluuid);
            }
            return;
        } catch (error) {
            lastError = error;
            retryCount++;

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
                throw error;
            }

            if (providerPoolManager && pooluuid) {
                logger.debug(`[Pool Retry] Request failed with ${pooluuid}, attempt ${retryCount}/${maxRetries}`);
                markPoolUnhealthy(providerPoolManager, pooluuid, error);
            }

            if (retryCount < maxRetries && canUsePool(CONFIG, providerPoolManager)) {
                logger.debug('[Pool Retry] Selecting next healthy account/provider...');
                const { getApiService } = await import('../services/manager.js');
                const newConfig = { ...CONFIG };
                service = await getApiService(newConfig, model);
                pooluuid = newConfig.uuid;
                logger.debug(`[Pool Retry] Switched to: ${pooluuid}`);
            } else {
                break;
            }
        }
    }

    logger.error(`[Pool Retry] All ${maxRetries} attempts failed. Last error:`, lastError?.message);
    throw lastError || new Error('All accounts/providers failed');
}

export async function handleStreamRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, poolManager, pooluuid) {
    let fullResponseText = '';
    let responseClosed = false;

    await handleUnifiedResponse(res, '', true);

    requestBody.model = model;
    const needsConversion = getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider);
    const addEvent = getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.CLAUDE || getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES;
    const openStop = getProtocolPrefix(fromProvider) === MODEL_PROTOCOL_PREFIX.OPENAI;

    let streamStarted = false;
    let nativeStream;

    try {
        nativeStream = await generateContentStream(service, model, requestBody);
    } catch (initialError) {
        logger.error(`[Stream] Initial stream generation failed: ${initialError.message}`);
        throw initialError;
    }

    try {
        streamStarted = true;
        for await (const nativeChunk of nativeStream) {
            const chunkText = extractResponseText(nativeChunk, toProvider);
            if (chunkText && !Array.isArray(chunkText)) {
                fullResponseText += chunkText;
            }

            const chunkToSend = needsConversion
                ? convertData(nativeChunk, 'streamChunk', toProvider, fromProvider, model)
                : nativeChunk;

            if (!chunkToSend) {
                continue;
            }

            const chunksToSend = Array.isArray(chunkToSend) ? chunkToSend : [chunkToSend];

            for (const chunk of chunksToSend) {
                if (addEvent) {
                    res.write(`event: ${chunk.type}\n`);
                }

                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
        }
        if (openStop && needsConversion) {
            res.write(`data: ${JSON.stringify(getOpenAIStreamChunkStop(model))}\n\n`);
        }

        if (poolManager && pooluuid) {
            logger.debug(`[Pool] Increasing usage count for ${toProvider} (${pooluuid}) after successful stream request`);
            markPoolHealthy(poolManager, pooluuid);
        }

    }  catch (error) {
        logger.error(`[Server] Error during stream processing: ${error.stack}`);

        if (streamStarted) {
            if (poolManager && pooluuid) {
                logger.warn(`[Pool] Marking ${toProvider} (${pooluuid}) as unhealthy due to stream error`);
                markPoolUnhealthy(poolManager, pooluuid, error);
            }

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
            throw error;
        }
    } finally {
        if (!responseClosed) {
            res.end();
        }
        logger.verbose(fullResponseText);
    }
}

export async function handleUnaryRequest(res, service, model, requestBody, fromProvider, toProvider, PROMPT_LOG_MODE, PROMPT_LOG_FILENAME, poolManager, pooluuid) {
    let responseWritten = false;
    try {
        requestBody.model = model;
        const nativeResponse = await generateContent(service, model, requestBody);
        const responseText = extractResponseText(nativeResponse, toProvider);

        let clientResponse = nativeResponse;
        const needsConversion = getProtocolPrefix(fromProvider) !== getProtocolPrefix(toProvider);
        if (needsConversion) {
            clientResponse = convertData(nativeResponse, 'response', toProvider, fromProvider, model);
        }

        await handleUnifiedResponse(res, JSON.stringify(clientResponse), false);
        responseWritten = true;
        logger.verbose(responseText);

        if (poolManager && pooluuid) {
            logger.debug(`[Pool] Increasing usage count for ${toProvider} (${pooluuid}) after successful unary request`);
            markPoolHealthy(poolManager, pooluuid);
        }
    } catch (error) {
        logger.error(`[Server] Error during unary processing: ${error.stack}`);

        if (responseWritten) {
            if (poolManager && pooluuid) {
                logger.warn(`[Pool] Marking ${toProvider} (${pooluuid}) as unhealthy due to unary error`);
                markPoolUnhealthy(poolManager, pooluuid, error);
            }

            const errorResponse = createErrorResponse(error, fromProvider);
            await handleUnifiedResponse(res, JSON.stringify(errorResponse), false);
        } else {
            throw error;
        }
    }
}

export function extractResponseText(response, provider) {
    const strategy = new KiroStrategy();
    return strategy.extractResponseText(response);
}

async function applySystemPromptFromFile(config, requestBody, toProvider) {
    const strategy = new KiroStrategy();
    return strategy.applySystemPromptFromFile(config, requestBody);
}

async function manageSystemPrompt(requestBody, provider) {
    let incomingSystemText = extractSystemPromptFromRequestBody(requestBody, provider);
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

