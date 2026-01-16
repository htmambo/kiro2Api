import { initializeAuth } from './auth.js';
import { KIRO_CONSTANTS } from './constants.js';
import { getAdaptiveTimeout } from './tools.js';
import {
    buildRequestData,
    buildRequestHeaders,
    getRequestUrl,
    getRetryConfig,
    isThinkingEnabled
} from './request-utils.js';

function isSocketError(error) {
    return !error.response && (
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'UND_ERR_SOCKET' ||
        error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        error.message?.includes('socket') ||
        error.message?.includes('ECONNRESET')
    );
}

function markRequestStage(error) {
    if (error && typeof error === 'object') {
        error.kiroRequestStage = 'request';
    }
    return error;
}

function logRequestDetails({
    logger,
    detailLevel,
    compactLevel,
    compactLabel,
    detailLabel,
    model,
    isRetry,
    retryCount,
    requestSizeKB,
    conversationState,
    contentPreview,
    enableThinking,
    context
}) {
    const timestamp = new Date().toISOString();
    if (!logger) return;

    if (!context?.serviceVerboseLogging) {
        if (typeof logger[compactLevel] === 'function') {
            logger[compactLevel](`📤 ${compactLabel} [${model}] - ${timestamp}`);
        }
        return;
    }

    if (typeof logger[detailLevel] !== 'function') return;

    logger[detailLevel]('='.repeat(60));
    logger[detailLevel](
        `📤 ${detailLabel} [${model}]${isRetry ? ` (retry ${retryCount})` : ''}`
    );
    logger[detailLevel]('='.repeat(60));
    logger[detailLevel](`Timestamp: ${timestamp}`);
    logger[detailLevel](`URL: ${model.startsWith('amazonq') ? context.amazonQUrl : context.baseUrl}`);
    logger[detailLevel](
        `Messages: ${(conversationState?.history?.length || 0) + 1} | Tools: ${conversationState?.currentMessage?.userInputMessage?.userInputMessageContext?.tools?.length || 0} | System: ${context.system ? 'yes' : 'no'}`
    );
    logger[detailLevel](`Request Size: ${requestSizeKB} KB | Thinking: ${enableThinking ? 'enabled' : 'disabled'}`);
    if (conversationState?.conversationId) {
        logger[detailLevel](`Conversation ID: ${conversationState.conversationId}`);
    }
    logger[detailLevel](`Message Preview: ${contentPreview}`);
    logger[detailLevel]('='.repeat(60));
}

export async function executeKiroRequest({
    service,
    model,
    body,
    isRetry = false,
    retryCount = 0,
    logger,
    compactLabel = 'REQUEST',
    detailLabel = 'REQUEST',
    compactLevel = 'info',
    detailLevel = 'info',
    buildLogLevel = 'warn',
    buildLogLabel = '',
    axiosConfig = {},
    retryOn5xx = false,
    socketErrorPrefix = 'Connection failed',
    wrapRateLimitError = false,
    onBadRequest
}) {
    if (!service.isInitialized) await service.initialize();

    const { maxRetries, baseDelay } = getRetryConfig(service);
    const enableThinking = isThinkingEnabled(body, service.config);
    const {
        requestData,
        requestSizeKB,
        conversationState,
        contentPreview
    } = await buildRequestData(service, model, body, enableThinking, {
        logger,
        logLevel: buildLogLevel,
        logLabel: buildLogLabel
    });

    const requestStartTime = Date.now();
    logRequestDetails({
        logger,
        detailLevel,
        compactLevel,
        compactLabel,
        detailLabel,
        model,
        isRetry,
        retryCount,
        requestSizeKB,
        conversationState,
        contentPreview,
        enableThinking,
        context: {
            system: body.system,
            baseUrl: service.baseUrl,
            amazonQUrl: service.amazonQUrl,
            serviceVerboseLogging: service.verboseLogging
        }
    });

    try {
        const headers = buildRequestHeaders(service);
        const requestUrl = getRequestUrl(service, model);
        const adaptiveTimeout = getAdaptiveTimeout(model, KIRO_CONSTANTS.AXIOS_TIMEOUT);
        const response = await service.axiosInstance.post(requestUrl, requestData, {
            headers,
            timeout: adaptiveTimeout,
            ...axiosConfig
        });

        return {
            response,
            requestData,
            requestStartTime
        };
    } catch (error) {
        if (isSocketError(error) && retryCount < maxRetries) {
            logger?.info?.(`Socket error detected: ${error.code || error.message}`);
            logger?.info?.(`Resetting connection pool and retrying... (attempt ${retryCount + 1}/${maxRetries})`);

            await service.resetConnectionPool();
            await new Promise(resolve => setTimeout(resolve, 1000));
            return executeKiroRequest({
                service,
                model,
                body,
                isRetry,
                retryCount: retryCount + 1,
                logger,
                compactLabel,
                detailLabel,
                compactLevel,
                detailLevel,
                buildLogLevel,
                axiosConfig,
                retryOn5xx,
                wrapRateLimitError,
                onBadRequest
            });
        }

        if (isSocketError(error)) {
            const socketError = new Error(
                `${socketErrorPrefix}: ${error.message}. Please check your network or try restarting the service.`
            );
            throw markRequestStage(socketError);
        }

        if (error.response?.status === 403 && !isRetry) {
            logger?.info?.('Received 403. Attempting token refresh and retrying...');
            await initializeAuth(service, true);
            return executeKiroRequest({
                service,
                model,
                body,
                isRetry: true,
                retryCount,
                logger,
                compactLabel,
                detailLabel,
                compactLevel,
                detailLevel,
                buildLogLevel,
                axiosConfig,
                retryOn5xx,
                wrapRateLimitError,
                onBadRequest
            });
        }

        if (error.response?.status === 429) {
            if (retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger?.info?.(`Received 429 (Rate Limit). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return executeKiroRequest({
                    service,
                    model,
                    body,
                    isRetry,
                    retryCount: retryCount + 1,
                    logger,
                    compactLabel,
                    detailLabel,
                    compactLevel,
                    detailLevel,
                    buildLogLevel,
                    axiosConfig,
                    retryOn5xx,
                    wrapRateLimitError,
                    onBadRequest
                });
            }

            if (wrapRateLimitError) {
                const rateLimitError = new Error('RATE_LIMIT_EXCEEDED');
                rateLimitError.isRateLimitError = true;
                rateLimitError.retryable = true;
                throw markRequestStage(rateLimitError);
            }
            if (error && typeof error === 'object') {
                error.kiroRateLimitExceeded = true;
            }
            throw markRequestStage(error);
        }

        if (retryOn5xx && error.response?.status >= 500 && error.response?.status < 600 && retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            logger?.info?.(`Received ${error.response.status} server error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return executeKiroRequest({
                service,
                model,
                body,
                isRetry,
                retryCount: retryCount + 1,
                logger,
                compactLabel,
                detailLabel,
                compactLevel,
                detailLevel,
                buildLogLevel,
                axiosConfig,
                retryOn5xx,
                wrapRateLimitError,
                onBadRequest
            });
        }

        if (error.response?.status === 400 && typeof onBadRequest === 'function') {
            onBadRequest(error, requestData);
        }

        throw markRequestStage(error);
    }
}
