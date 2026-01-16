import { v4 as uuidv4 } from 'uuid';

export function getRetryConfig(service) {
    return {
        maxRetries: service.config.REQUEST_MAX_RETRIES || 3,
        baseDelay: service.config.REQUEST_BASE_DELAY || 1000
    };
}

export function isThinkingEnabled(body, config) {
    return body.thinking?.type === 'enabled' ||
        body.extended_thinking === true ||
        config.ENABLE_THINKING_BY_DEFAULT === true;
}

export async function buildRequestData(service, model, body, enableThinking, options = {}) {
    const { logger = null, logLabel = '', logLevel = 'warn' } = options;
    const buildStartTime = Date.now();
    const requestData = await service.buildCodewhispererRequest(
        body.messages,
        model,
        body.tools,
        body.system,
        enableThinking
    );
    const buildDuration = Date.now() - buildStartTime;
    if (buildDuration > 100 && logger && typeof logger[logLevel] === 'function') {
        const prefix = logLabel ? `${logLabel} ` : '';
        logger[logLevel](
            `${prefix}buildCodewhispererRequest took ${buildDuration}ms (messages: ${body.messages?.length || 0})`
        );
    }

    const requestJson = JSON.stringify(requestData);
    const requestSizeKB = (requestJson.length / 1024).toFixed(2);
    const conversationState = requestData?.conversationState;
    const currentContent = conversationState?.currentMessage?.userInputMessage?.content || '';
    const contentPreview = currentContent.length > 60
        ? `${currentContent.substring(0, 60)}...`
        : currentContent;

    return {
        requestData,
        requestSizeKB,
        conversationState,
        contentPreview
    };
}

export function buildRequestHeaders(service) {
    return {
        'Authorization': `Bearer ${service.accessToken}`,
        'amz-sdk-invocation-id': `${uuidv4()}`
    };
}

export function getRequestUrl(service, model) {
    return model.startsWith('amazonq') ? service.amazonQUrl : service.baseUrl;
}
