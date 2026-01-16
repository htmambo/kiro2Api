/**
 * 请求体解析工具模块
 *
 * 统一处理 HTTP 请求体的解析逻辑，消除代码重复
 * 提供三个函数：
 * - readRequestBody(): 读取原始请求体（字符串）
 * - parseRequestBody(): 解析 JSON 请求体（空值返回 {}）
 * - getRequestBody(): 兼容别名，保持向后兼容
 *
 * @module utils/request-body
 */

/**
 * 默认请求体最大字节数（10MB）
 * 可通过环境变量 REQUEST_MAX_BODY_BYTES 覆盖
 * @constant {number}
 */
const DEFAULT_MAX_BODY_BYTES = Number(process.env.REQUEST_MAX_BODY_BYTES) > 0
    ? Number(process.env.REQUEST_MAX_BODY_BYTES)
    : 10 * 1024 * 1024;

/**
 * 读取原始请求体（字符串）
 *
 * @param {import('http').IncomingMessage} req - HTTP 请求对象
 * @param {{ maxBytes?: number }} [options] - 读取选项
 * @param {number} [options.maxBytes] - 最大字节数，null 表示不限制
 * @returns {Promise<string>} 请求体字符串
 */
export function readRequestBody(req, options = {}) {
    const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes
        : null;

    return new Promise((resolve, reject) => {
        let body = '';
        let receivedBytes = 0;

        req.on('data', chunk => {
            receivedBytes += chunk.length;

            // 检查大小限制
            if (maxBytes && receivedBytes > maxBytes) {
                const err = new Error('Request body too large');
                err.status = 413;
                err.code = 'REQUEST_TOO_LARGE';
                req.destroy(err);
                return;
            }

            body += chunk.toString();
        });

        req.on('end', () => {
            resolve(body);
        });

        req.on('error', reject);
    });
}

/**
 * 解析 JSON 请求体
 *
 * 特性：
 * - 自动处理空请求体（返回 {}）
 * - 支持自定义错误消息
 * - 支持 trim 空白字符
 * - 可配置大小限制
 *
 * @param {import('http').IncomingMessage} req - HTTP 请求对象
 * @param {{ maxBytes?: number, errorMessage?: string, trim?: boolean }} [options] - 解析选项
 * @param {number} [options.maxBytes] - 最大字节数，默认使用 DEFAULT_MAX_BODY_BYTES
 * @param {string} [options.errorMessage] - JSON 解析失败时的错误消息
 * @param {boolean} [options.trim] - 是否 trim 空白字符，默认 true
 * @returns {Promise<Object>} 解析后的对象
 * @throws {Error} JSON 解析失败时抛出错误
 */
export async function parseRequestBody(req, options = {}) {
    const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
        ? options.maxBytes
        : DEFAULT_MAX_BODY_BYTES;

    const errorMessage = typeof options.errorMessage === 'string'
        ? options.errorMessage
        : '无效的JSON格式';

    const trim = options.trim !== false;

    // 读取原始请求体
    const body = await readRequestBody(req, { maxBytes });

    // 规范化处理
    const normalized = trim ? body.trim() : body;

    // 空请求体返回空对象
    if (!normalized) {
        return {};
    }

    // 解析 JSON
    try {
        return JSON.parse(body);
    } catch (error) {
        throw new Error(errorMessage);
    }
}

/**
 * getRequestBody 函数（向后兼容别名）
 *
 * 与 parseRequestBody 的差异：
 * - 错误消息为英文（'Invalid JSON in request body.'）
 * - 不 trim 空白字符
 * - 用于保持与旧代码的兼容性
 *
 * @param {import('http').IncomingMessage} req - HTTP 请求对象
 * @returns {Promise<Object>} 解析后的对象
 */
export function getRequestBody(req) {
    return parseRequestBody(req, {
        errorMessage: 'Invalid JSON in request body.',
        trim: false
    });
}
