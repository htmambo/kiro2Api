/**
 * 认证中间件。
 * 检查请求是否包含有效的认证 token，并处理未授权响应。
 * @module ui/router/middleware/auth
 */

import { createLogger } from '../../../lib/logger.js';

const logger = createLogger('ui:middleware:auth');

// 从 ui-manager.js 动态导入 token 验证函数，兼容旧实现

/**
 * 检查请求中的 token 是否有效。
 * @param {import('http').IncomingMessage} req - 请求对象。
 * @returns {Promise<boolean>} 是否认证成功。
 */
export async function checkAuth(req) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.substring(7);
    const tokenInfo = await verifyToken(token);

    return tokenInfo !== null;
}

/**
 * Token 验证函数（统一实现）。
 * 验证 token 是否有效且未过期。
 *
 * @param {string} token - Token 字符串。
 * @returns {Promise<object | null>} Token 信息，无效或过期返回 null。
 */
export async function verifyToken(token) {
    // 从 ui-manager.js 动态导入实现，避免循环依赖
    try {
        const { readTokenStore } = await import('../../../ui-manager.js');
        const tokenStore = await readTokenStore();
        const tokenInfo = tokenStore.tokens[token];

        if (!tokenInfo) {
            return null;
        }

        // 检查是否过期，过期则删除
        if (Date.now() > tokenInfo.expiryTime) {
            await deleteToken(token);
            return null;
        }

        return tokenInfo;
    } catch (error) {
        logger.error('Token verification error:', error);
        return null;
    }
}

/**
 * 删除 token。
 * @param {string} token - Token 字符串。
 * @returns {Promise<void>}
 */
async function deleteToken(token) {
    try {
        const { readTokenStore, writeTokenStore } = await import('../../../ui-manager.js');
        const tokenStore = await readTokenStore();

        if (tokenStore.tokens[token]) {
            delete tokenStore.tokens[token];
            await writeTokenStore(tokenStore);
        }
    } catch (error) {
        logger.error('Delete token error:', error);
    }
}

/**
 * 认证中间件（用于路由器集成）。
 * @param {import('http').IncomingMessage} req - 请求对象。
 * @param {import('http').ServerResponse} res - 响应对象。
 * @returns {Promise<boolean>} 是否认证成功。
 */
export async function requireAuth(req, res) {
    const isAuth = await checkAuth(req);

    if (!isAuth) {
        sendUnauthorized(res);
        return false;
    }

    return true;
}

/**
 * 返回未授权响应。
 * @param {import('http').ServerResponse} res - 响应对象。
 * @param {string} [message='未授权访问，请先登录'] - 提示消息。
 * @returns {void}
 */
function sendUnauthorized(res, message = '未授权访问，请先登录') {
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
