/**
 * 错误日志记录工具
 *
 * 在非生产环境下记录详细的错误信息，帮助开发者调试问题。
 * 生产环境下保持静默，避免泄露敏感信息。
 */

import { createLogger } from '../lib/logger.js';

const logger = createLogger('error-logger');

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
