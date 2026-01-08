/**
 * 错误日志记录工具
 *
 * 提供统一的错误日志记录功能：
 * - 开发环境：记录详细的错误信息（堆栈、响应数据等）
 * - 生产环境：记录结构化日志，过滤敏感信息
 */

import { createLogger } from '../lib/logger.js';

const logger = createLogger('error-logger');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * 清理 URL 中的敏感信息（如 API key）
 * @param {string} url - 原始 URL
 * @returns {string} 清理后的 URL
 */
function sanitizeUrl(url) {
    if (!url) return 'unknown';

    try {
        const urlObj = new URL(url, 'http://dummy');

        // 检查查询参数中是否包含敏感信息
        const sensitiveParams = ['key', 'apikey', 'api_key', 'token', 'password', 'secret'];

        for (const param of sensitiveParams) {
            if (urlObj.searchParams.has(param)) {
                urlObj.searchParams.set(param, '***REDACTED***');
            }
        }

        // 返回清理后的路径和查询字符串
        return urlObj.pathname + urlObj.search;
    } catch (e) {
        // 如果不是完整的 URL，尝试简单处理
        return url.replace(/([?&])(key|apikey|api_key|token|password|secret)=([^&]*)/gi, '$1$2=***REDACTED***');
    }
}

/**
 * 记录结构化错误日志
 *
 * 用于 HTTP 请求错误的统一日志记录，支持：
 * - 自动清理 URL 中的敏感信息
 * - 结构化日志输出
 * - 开发环境输出完整堆栈和响应数据
 *
 * @param {Error} error - 错误对象
 * @param {Object} req - 请求对象
 * @param {number} statusCode - HTTP 状态码
 *
 * @example
 * logError(error, req, 500);
 */
export function logError(error, req, statusCode) {
    const timestamp = new Date().toISOString();
    const method = req?.method || 'UNKNOWN';
    const rawPath = req?.url || req?.originalUrl || 'unknown';
    const safePath = sanitizeUrl(rawPath);
    const errorType = error.name || 'Error';
    const errorMessage = error.message || 'Unknown error';

    // 结构化日志输出
    logger.error(
        `[Error] ${timestamp} | ${method} ${safePath} | ` +
        `Status: ${statusCode} | Type: ${errorType} | ` +
        `Message: ${errorMessage}`,
        { timestamp, method, path: safePath, statusCode, errorType, errorMessage }
    );

    // 开发环境：输出完整堆栈
    if (!IS_PRODUCTION && error.stack) {
        logger.error('[Error Stack]', { stack: error.stack });
    }

    // 如果有响应数据，也记录下来（开发环境）
    if (!IS_PRODUCTION && error.response?.data) {
        logger.error('[Error Response Data]', { responseData: error.response.data });
    }
}

/**
 * 在开发环境记录详细的错误信息
 *
 * @param {Error} error - 错误对象
 * @param {Object} context - 上下文信息
 * @param {string} context.handler - Handler 名称
 * @param {string} context.method - HTTP 方法
 * @param {string} context.url - 请求 URL
 * @param {Object} context.params - 请求参数
 * @param {*} context.data - 其他相关数据
 *
 * @example
 * try {
 *   await someOperation();
 * } catch (error) {
 *   logErrorInDev(error, {
 *     handler: 'getAllUsage',
 *     method: req.method,
 *     url: req.url
 *   });
 *   // 返回给客户端的逻辑...
 * }
 */
export function logErrorInDev(error, context = {}) {
    // 只在非生产环境记录详细信息
    const errorDetails = {
        message: error.message,
        name: error.name,
        stack: error.stack,
        ...context
    };

    // 如果有 HTTP 响应错误，也记录下来
    if (error.response) {
        errorDetails.httpStatus = error.response.status;
        errorDetails.httpData = error.response.data;
    }

    logger.error('[Dev Error Details]', errorDetails);
}

/**
 * 在开发环境记录警告信息
 *
 * @param {string} message - 警告消息
 * @param {Object} context - 上下文信息
 */
export function logWarningInDev(message, context = {}) {
    logger.warn('[Dev Warning]', { message, ...context });
}
