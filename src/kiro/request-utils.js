/**
 * 请求构建工具模块
 *
 * 负责请求重试配置、请求体构建、请求头生成等通用逻辑。
 *
 * @module kiro/request-utils
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * 获取重试配置
 *
 * @param {Object} service - KiroService 实例
 * @returns {{maxRetries: number, baseDelay: number}} 重试配置
 */
export function getRetryConfig(service) {
    return {
        maxRetries: service.config.REQUEST_MAX_RETRIES || 3,
        baseDelay: service.config.REQUEST_BASE_DELAY || 1000
    };
}

/**
 * 判断是否启用思考模式
 *
 * @param {Object} body - 请求体
 * @param {Object} config - 配置
 * @returns {boolean} 是否启用思考
 */
export function isThinkingEnabled(body, config) {
    return body.thinking?.type === 'enabled' ||
        body.extended_thinking === true ||
        config.ENABLE_THINKING_BY_DEFAULT === true;
}

/**
 * 构建请求数据与统计信息
 *
 * @param {Object} service - KiroService 实例
 * @param {string} model - 模型名称
 * @param {Object} body - 请求体
 * @param {boolean} enableThinking - 是否启用思考
 * @param {Object} [options={}] - 额外选项
 * @returns {Promise<Object>} 请求数据与日志信息
 */
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

/**
 * 构建请求头
 *
 * @param {Object} service - KiroService 实例
 * @returns {Object} 请求头
 */
export function buildRequestHeaders(service) {
    return {
        'Authorization': `Bearer ${service.accessToken}`,
        'amz-sdk-invocation-id': `${uuidv4()}`
    };
}

/**
 * 获取请求 URL（根据模型类型选择）
 *
 * @param {Object} service - KiroService 实例
 * @param {string} model - 模型名称
 * @returns {string} 请求 URL
 */
export function getRequestUrl(service, model) {
    return model.startsWith('amazonq') ? service.amazonQUrl : service.baseUrl;
}
