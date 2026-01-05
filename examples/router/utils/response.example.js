/**
 * 响应格式化工具示例
 *
 * 提供统一的响应格式化函数
 * 可以在所有 Handler 中使用这些工具函数
 */

/**
 * 发送 JSON 响应
 *
 * @param {ServerResponse} res - 响应对象
 * @param {Object} data - 要发送的数据
 * @param {number} statusCode - HTTP 状态码（默认 200）
 *
 * @example
 * sendJson(res, { message: 'Hello' }, 200);
 */
export function sendJson(res, data, statusCode = 200) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

/**
 * 发送成功响应
 *
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 成功消息
 * @param {Object} data - 附加数据
 *
 * @example
 * sendSuccess(res, '操作成功', { id: 123 });
 * // 返回: { success: true, message: '操作成功', id: 123 }
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
 *
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 * @param {number} statusCode - HTTP 状态码（默认 500）
 * @param {string} code - 错误代码（默认 'ERROR'）
 *
 * @example
 * sendError(res, '用户不存在', 404, 'NOT_FOUND');
 * // 返回: { success: false, error: { message: '用户不存在', code: 'NOT_FOUND' } }
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
 *
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 *
 * @example
 * sendUnauthorized(res, '请先登录');
 */
export function sendUnauthorized(res, message = '未授权访问，请先登录') {
    sendError(res, message, 401, 'UNAUTHORIZED');
}

/**
 * 发送 404 未找到响应
 *
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 *
 * @example
 * sendNotFound(res, '账号不存在');
 */
export function sendNotFound(res, message = '资源不存在') {
    sendError(res, message, 404, 'NOT_FOUND');
}

/**
 * 发送 400 验证错误响应
 *
 * @param {ServerResponse} res - 响应对象
 * @param {string} message - 错误消息
 *
 * @example
 * sendValidationError(res, '邮箱格式不正确');
 */
export function sendValidationError(res, message) {
    sendError(res, message, 400, 'VALIDATION_ERROR');
}

/**
 * 发送分页数据响应
 *
 * @param {ServerResponse} res - 响应对象
 * @param {Array} items - 数据项
 * @param {Object} pagination - 分页信息
 * @param {number} pagination.page - 当前页码
 * @param {number} pagination.pageSize - 每页大小
 * @param {number} pagination.total - 总数
 *
 * @example
 * sendPaginatedResponse(res, [1, 2, 3], { page: 1, pageSize: 10, total: 100 });
 */
export function sendPaginatedResponse(res, items, pagination) {
    sendJson(res, {
        success: true,
        data: items,
        pagination: {
            page: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
            totalPages: Math.ceil(pagination.total / pagination.pageSize)
        }
    });
}

/**
 * 发送流式响应（用于大文件或长连接）
 *
 * @param {ServerResponse} res - 响应对象
 * @param {ReadableStream} stream - 可读流
 * @param {string} contentType - 内容类型
 *
 * @example
 * const fileStream = fs.createReadStream('large-file.json');
 * sendStreamResponse(res, fileStream, 'application/json');
 */
export function sendStreamResponse(res, stream, contentType = 'application/octet-stream') {
    res.writeHead(200, { 'Content-Type': contentType });

    stream.pipe(res);

    stream.on('error', (error) => {
        console.error('[Stream Response Error]', error);
        if (!res.headersSent) {
            sendError(res, 'Stream error', 500, 'STREAM_ERROR');
        }
    });
}

/**
 * 创建 CORS 响应头
 *
 * @param {Object} options - CORS 选项
 * @param {string} options.origin - 允许的源（默认 '*'）
 * @param {string[]} options.methods - 允许的方法
 * @param {string[]} options.headers - 允许的请求头
 *
 * @returns {Object} 响应头对象
 *
 * @example
 * const corsHeaders = createCorsHeaders({
 *     origin: 'https://example.com',
 *     methods: ['GET', 'POST'],
 *     headers: ['Content-Type', 'Authorization']
 * });
 * res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
 */
export function createCorsHeaders(options = {}) {
    const {
        origin = '*',
        methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        headers = ['Content-Type', 'Authorization']
    } = options;

    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': methods.join(', '),
        'Access-Control-Allow-Headers': headers.join(', ')
    };
}

/**
 * 创建禁用缓存的响应头
 *
 * @returns {Object} 响应头对象
 *
 * @example
 * const noCacheHeaders = createNoCacheHeaders();
 * res.writeHead(200, { ...noCacheHeaders, 'Content-Type': 'application/json' });
 */
export function createNoCacheHeaders() {
    return {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    };
}
