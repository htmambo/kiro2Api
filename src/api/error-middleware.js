/**
 * 统一错误处理中间件
 *
 * 提供统一的错误处理机制，支持：
 * - JSON 和 SSE 两种响应格式
 * - 生产环境敏感信息过滤
 * - 结构化日志记录
 * - 错误分类和建议
 *
 * @module error-middleware
 */

import { createErrorResponse } from '../utils/common.js';
import { logError } from '../utils/error-logger.js';
import { createLogger } from '../lib/logger.js';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const logger = createLogger('api:error-middleware');

/**
 * 错误类型到建议信息的映射
 */
const ERROR_SUGGESTIONS = {
    401: [
        'Verify your OAuth credentials are valid',
        'Try re-authenticating by deleting the credentials file',
        'Check if your Cloud project has the necessary permissions'
    ],
    403: [
        'Ensure your Google Cloud project has the Code Assist API enabled',
        'Check if your account has the necessary permissions',
        'Verify the project ID is correct'
    ],
    429: [
        'The request has been automatically retried with exponential backoff',
        'If the issue persists, try reducing the request frequency',
        'Consider upgrading your API quota if available'
    ],
    500: [
        'The request has been automatically retried',
        'If the issue persists, try again in a few minutes',
        'Check service status page for outages'
    ],
    502: [
        'Bad gateway error, usually temporary',
        'The request has been automatically retried',
        'Try again in a few moments'
    ],
    503: [
        'Service temporarily unavailable',
        'The request has been automatically retried',
        'Try again in a few minutes'
    ],
    504: [
        'Gateway timeout, request took too long',
        'The request has been automatically retried',
        'Consider breaking down large requests'
    ]
};

/**
 * 获取错误的友好描述信息
 * @param {number} statusCode - HTTP 状态码
 * @param {string} originalMessage - 原始错误信息
 * @returns {string} 友好的错误描述
 */
function getFriendlyErrorMessage(statusCode, originalMessage) {
    switch (statusCode) {
        case 401:
            return 'Authentication failed. Please check your credentials.';
        case 403:
            return 'Access forbidden. Insufficient permissions.';
        case 429:
            return 'Too many requests. Rate limit exceeded.';
        case 500:
        case 502:
        case 503:
        case 504:
            return `Server error occurred. This is usually temporary. ${originalMessage}`;
        default:
            if (statusCode >= 400 && statusCode < 500) {
                return `Client error (${statusCode}): ${originalMessage}`;
            } else if (statusCode >= 500) {
                return `Server error (${statusCode}): ${originalMessage}`;
            }
            return originalMessage;
    }
}

/**
 * 构建错误响应负载
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {Object} 格式化的错误响应对象
 */
function buildErrorPayload(error, fromProvider) {
    const statusCode = error.status || error.response?.status || 500;
    const originalMessage = error.message || 'An error occurred during processing.';
    const friendlyMessage = getFriendlyErrorMessage(statusCode, originalMessage);

    // 使用现有的 createErrorResponse 函数创建基础响应
    const baseResponse = createErrorResponse(
        { ...error, message: friendlyMessage },
        fromProvider
    );

    // 增强错误响应
    if (baseResponse.error) {
        // 添加建议信息
        const suggestions = ERROR_SUGGESTIONS[statusCode];
        if (suggestions && suggestions.length > 0) {
            baseResponse.error.suggestions = suggestions;
        }

        // 开发环境：添加调试信息
        if (!IS_PRODUCTION) {
            if (error.stack) {
                baseResponse.error.stack = error.stack;
            }
            if (error.response?.data) {
                baseResponse.error.details = error.response.data;
            }
        }

        // 添加状态码
        baseResponse.error.code = statusCode;
    }

    return baseResponse;
}

/**
 * 发送 SSE 格式的错误事件
 * @param {Response} res - 响应对象
 * @param {Object} payload - 错误负载
 * @param {string} method - 请求方法
 * @param {string} path - 请求路径
 */
function sendSSEError(res, payload, method, path) {
    try {
        const eventData = `event: error\ndata: ${JSON.stringify(payload)}\n\n`;
        res.write(eventData);
    } catch (writeError) {
        logger.error(
            `Failed to emit SSE error event for ${method} ${path}: ` +
            `${writeError.message}`
        );
    }
}

/**
 * 发送 JSON 格式的错误响应
 * @param {Response} res - 响应对象
 * @param {Object} payload - 错误负载
 * @param {number} statusCode - HTTP 状态码
 * @param {string} method - 请求方法
 * @param {string} path - 请求路径
 */
function sendJSONError(res, payload, statusCode, method, path) {
    // 检查 headers 是否已发送
    if (res.headersSent) {
        logger.warn(
            `Headers already sent for ${method} ${path}, ` +
            `cannot send JSON error response`
        );
        return;
    }

    try {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
    } catch (writeError) {
        logger.error(
            `Failed to send JSON error response for ${method} ${path}: ` +
            `${writeError.message}`
        );
    }
}

/**
 * 统一错误处理中间件
 *
 * 处理所有类型的错误，并根据响应类型（JSON 或 SSE）返回适当的格式。
 * 在生产环境中自动过滤敏感信息。
 *
 * @param {Error} error - 错误对象
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {boolean} [isStreaming=false] - 是否为流式响应（SSE）
 * @returns {Promise<void>}
 *
 * @example
 * // 在普通请求中使用
 * try {
 *   await someAsyncOperation();
 * } catch (error) {
 *   await errorMiddleware(error, req, res);
 * }
 *
 * @example
 * // 在流式请求中使用
 * try {
 *   await streamingOperation();
 * } catch (error) {
 *   await errorMiddleware(error, req, res, true);
 * }
 */
export async function errorMiddleware(error, req, res, isStreaming = false) {
    // 提取状态码
    const statusCode = error.status || error.response?.status || 500;

    // 获取客户端期望的提供商格式
    const providerHeader = req?.headers?.['model-provider'] || req?.headers?.['Model-Provider'];
    const fromProvider = typeof providerHeader === 'string' ? providerHeader : 'claude';

    // 构建错误响应负载
    const payload = buildErrorPayload(error, fromProvider);

    // 记录错误日志
    logError(error, req, statusCode);

    // 根据响应类型发送错误
    const method = req?.method || 'UNKNOWN';
    const path = req?.url || req?.originalUrl || 'unknown';

    if (isStreaming) {
        sendSSEError(res, payload, method, path);
    } else {
        sendJSONError(res, payload, statusCode, method, path);
    }
}

/**
 * 创建带有特定状态码的错误对象
 * @param {string} message - 错误信息
 * @param {number} status - HTTP 状态码
 * @returns {Error} 错误对象
 */
export function createError(message, status = 500) {
    const error = new Error(message);
    error.status = status;
    return error;
}
