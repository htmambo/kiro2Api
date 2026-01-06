/**
 * 认证中间件
 * 检查请求是否包含有效的认证 token
 */

import { createLogger } from '../../../lib/logger.js';

const logger = createLogger('ui:middleware:auth');

// 从 ui-manager.js 导入 token 验证函数
// 这些函数需要在迁移时保持兼容

/**
 * 检查 token 验证
 * @param {IncomingMessage} req - 请求对象
 * @returns {Promise<boolean>} 是否认证成功
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
 * Token 验证函数（从 ui-manager.js 迁移）
 * @param {string} token - Token 字符串
 * @returns {Promise<Object|null>} Token 信息
 */
async function verifyToken(token) {
    // 从 ui-manager.js 导入的实现
    // 这里需要确保从正确的位置导入
    try {
        const { readTokenStore } = await import('../../../ui-manager.js');
        const tokenStore = await readTokenStore();
        const tokenInfo = tokenStore.tokens[token];

        if (!tokenInfo) {
            return null;
        }

        // 检查是否过期
        if (Date.now() > tokenInfo.expiryTime) {
            await deleteToken(token);
            return null;
        }

        return tokenInfo;
    } catch (error) {
        logger.error('[Auth Middleware] Token verification error:', error);
        return null;
    }
}

/**
 * 删除 token
 * @param {string} token - Token 字符串
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
        logger.error('[Auth Middleware] Delete token error:', error);
    }
}

/**
 * 认证中间件（用于路由器集成）
 * 返回一个异步函数，可以在路由匹配后调用
 *
 * @param {IncomingMessage} req - 请求对象
 * @param {ServerResponse} res - 响应对象
 * @returns {Promise<boolean>} 是否认证成功
 */
export async function requireAuth(req, res) {
    const isAuth = await checkAuth(req);

    if (!isAuth) {
        sendUnauthorized(res);
        return false;
    }

    return true;
}

// 重新导出 sendUnauthorized 用于内部使用
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
