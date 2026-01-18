/**
 * 未匹配路由日志记录
 *
 * 复用在未匹配路由与内部请求异常记录场景，便于排查请求内容。
 *
 * @module utils/unmatched-route-logger
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UNMATCHED_ROUTES_LOG_DIR = path.resolve(__dirname, '../../logs/unmatched-routes');

const logger = createLogger('unmatched-route-logger');

/**
 * 获取客户端真实 IP 地址
 *
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @returns {string} 客户端 IP 地址
 */
function getClientIp(req) {
    const headers = req?.headers || {};
    const xForwardedFor = headers['x-forwarded-for'];
    if (xForwardedFor) {
        const ips = xForwardedFor.split(',').map(ip => ip.trim());
        return ips[0];
    }

    const xRealIp = headers['x-real-ip'];
    if (xRealIp) {
        return xRealIp;
    }

    return req?.socket?.remoteAddress || 'unknown';
}

/**
 * 将请求记录写入 unmatched-routes 日志
 *
 * @param {http.IncomingMessage|Object} req - HTTP 请求对象或兼容对象
 * @param {string} method - HTTP 方法
 * @param {string} pathname - 请求路径
 * @param {string} body - 请求体
 * @returns {string|null} 日志文件路径
 */
export function logUnmatchedRoute(req, method, pathname, body) {
    try {
        if (!fs.existsSync(UNMATCHED_ROUTES_LOG_DIR)) {
            fs.mkdirSync(UNMATCHED_ROUTES_LOG_DIR, { recursive: true });
        }

        const timestamp = Date.now();
        const randomSuffix = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
        const filename = `${timestamp}-${randomSuffix}.txt`;
        const filepath = path.join(UNMATCHED_ROUTES_LOG_DIR, filename);

        const headers = req?.headers || {};
        const clientIp = getClientIp(req);
        const userAgent = headers['user-agent'] || 'unknown';
        const referer = headers['referer'] || headers['referrer'] || 'none';
        const contentType = headers['content-type'] || 'none';
        const contentLength = headers['content-length'] || '0';

        const logContent = [
            `=== Unmatched Route Request ===`,
            `Time: ${new Date().toISOString()}`,
            `Timestamp: ${timestamp}`,
            ``,
            `--- Request Info ---`,
            `Method: ${method || req?.method || 'UNKNOWN'}`,
            `URL: ${req?.url || pathname || 'unknown'}`,
            `Path: ${pathname || 'unknown'}`,
            ``,
            `--- Client Info ---`,
            `IP: ${clientIp}`,
            `User-Agent: ${userAgent}`,
            `Referer: ${referer}`,
            ``,
            `--- Headers ---`,
            ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
            ``,
            `--- Request Body ---`,
            `Content-Type: ${contentType}`,
            `Content-Length: ${contentLength}`,
            `Body:`,
            body || '(empty)',
            ``,
            `=== End of Request ===`
        ].join('\n');

        fs.writeFileSync(filepath, logContent, 'utf-8');
        logger.debug(`Unmatched route logged to: ${filepath}`);
        return filepath;
    } catch (error) {
        logger.error(`Failed to log unmatched route: ${error.message}`);
        return null;
    }
}
