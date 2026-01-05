/**
 * 响应格式化工具
 *
 * 提供统一的响应格式化函数
 * 可以在所有 Handler 中使用这些工具函数
 */

/**
 * 生成不缓存的响应头
 * @param {Object} additionalHeaders - 额外的响应头
 * @returns {Object} 包含禁用缓存的响应头
 */
export function getNoCacheHeaders(additionalHeaders = {}) {
    return {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...additionalHeaders
    };
}

/**
 * 发送 JSON 响应
 * @param {ServerResponse} res - 响应对象
 * @param {Object} data - 要发送的数据
 * @param {number} statusCode - HTTP 状态码（默认 200）
 */
export function sendJson(res, data, statusCode = 200) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

/**
 * 发送成功响应
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 成功消息
 * @param {Object} data - 附加数据
 */
export function sendSuccess(res, message, data = {}) {
    sendJson(res, {
        success: true,
        message,
        ...data
    });
}

/**
 * 发送错误响应
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 * @param {number} statusCode - HTTP 状态码（默认 500）
 * @param {string} code - 错误代码（默认 'ERROR'）
 */
export function sendError(res, message, statusCode = 500, code = 'ERROR') {
    sendJson(res, {
        success: false,
        error: {
            message,
            code
        }
    }, statusCode);
}

/**
 * 发送 401 未授权响应
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 */
export function sendUnauthorized(res, message = '未授权访问，请先登录') {
    res.writeHead(401, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify({
        error: {
            message,
            code: 'UNAUTHORIZED'
        }
    }));
}

/**
 * 发送 404 未找到响应
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 */
export function sendNotFound(res, message = '资源不存在') {
    sendError(res, message, 404, 'NOT_FOUND');
}

/**
 * 发送 400 验证错误响应
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 */
export function sendValidationError(res, message) {
    sendError(res, message, 400, 'VALIDATION_ERROR');
}
