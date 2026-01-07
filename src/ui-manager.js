import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { CONFIG } from './config/manager.js';
import { serveStaticFiles } from './ui/static.js';
import { initializeUIManagement, broadcastEvent } from './ui/events.js';
import { createLogger } from './lib/logger.js';
import { cleanupExpiredTokens } from './ui/token-store.js';
import { isUploadRequest, handleUpload } from './ui/upload.js';

// 导入新的子模块并重导出
export {
    registerAccountServiceInitializer,
    reloadConfig
} from './ui/config-reloader.js';
export {
    kiroOAuthStates,
    kiroOAuthCompletedStates,
    KIRO_OAUTH_CONFIG,
    loadOAuthStates,
    saveOAuthStates
} from './ui/oauth-states.js';
export {
    readUsageCache,
    writeUsageCache,
    readProviderUsageCache
} from './ui/usage-cache.js';
export {
    readTokenStore,
    writeTokenStore,
    generateToken,
    getExpiryTime,
    verifyToken,
    saveToken,
    deleteToken,
    cleanupExpiredTokens as exportCleanupExpiredTokens
} from './ui/token-store.js';
export {
    upload,
    handleUpload as exportHandleUpload,
    isUploadRequest as exportIsUploadRequest
} from './ui/upload.js';

// 路由器相关导入
import { createRouter } from './ui/router/index.js';
import { requireAuth as routerCheckAuth } from './ui/router/middleware/auth.middleware.js';

// 路由器配置
export const ROUTER_CONFIG = {
    ENABLE_ROUTER_LOGGING: true // 启用路由日志
};

const ACCOUNT_POOL_FILE = './configs/account_pool.json';
export const DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS = 'claude-kiro-oauth';
const logger = createLogger('ui:manager');

/**
 * 生成不缓存的响应头
 * @param {Object} additionalHeaders - 额外的响应头
 * @returns {Object} 包含禁用缓存的响应头
 */
function getNoCacheHeaders(additionalHeaders = {}) {
    return {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...additionalHeaders
    };
}

/**
 * 解析错误消息，转换为友好的中文提示
 * @param {string} errorMessage - 原始错误消息
 * @returns {object} { status: '封禁'|'过期'|'额度用尽'|'限流'|'未知错误', message: '友好提示' }
 */
export function parseErrorMessage(errorMessage) {
    if (!errorMessage) return { status: '正常', message: '' };

    const msg = errorMessage.toLowerCase();

    // 403 - 封禁/禁止访问
    if (msg.includes('403') || msg.includes('forbidden') || msg.includes('suspended') || msg.includes('locked')) {
        return { status: '封禁', message: '账号已被封禁，无法使用', statusType: 'banned' };
    }

    // 402 - 额度用尽
    if (msg.includes('402') || msg.includes('payment') || msg.includes('quota') || msg.includes('limit exceeded')) {
        return { status: '额度用尽', message: '账号额度已用完', statusType: 'quota_exceeded' };
    }

    // 401 - Token 无效/过期
    if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid token') || msg.includes('expired')) {
        return { status: '过期', message: 'Token 已失效，需要重新授权', statusType: 'expired' };
    }

    // 429 - 限流
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
        return { status: '限流', message: '请求过于频繁，稍后自动恢复', statusType: 'rate_limit' };
    }

    // 500/502/503 - 服务器错误
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server error')) {
        return { status: '服务异常', message: '服务器暂时不可用', statusType: 'server_error' };
    }

    // 网络错误
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused')) {
        return { status: '网络错误', message: '网络连接失败', statusType: 'network_error' };
    }

    // 默认
    return { status: '异常', message: errorMessage, statusType: 'unknown' };
}

/**
 * 读取密码
 */
async function readPasswordFile() {
    // 兼容旧的 pwd 文件方式
    try {
        const password = await fs.readFile('./pwd', 'utf8');
        return password.trim();
    } catch (error) {
        logger.error('读取密码文件失败', error);
        return null;
    }
}

/**
 * 验证登录凭据
 */
export async function validateCredentials(password) {
    const storedPassword = await readPasswordFile();
    return storedPassword && password === storedPassword;
}

/**
 * 解析请求体JSON
 */
export function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                if (!body.trim()) {
                    resolve({});
                } else {
                    resolve(JSON.parse(body));
                }
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * 生成 OAuth 结果页面 HTML
 */
export function generateOAuthResultPage(success, message, details = null) {
    const iconColor = success ? '#10b981' : '#ef4444';
    const icon = success ? '✓' : '✗';
    const title = success ? '授权成功' : '授权失败';

    let detailsHtml = '';
    if (details) {
        detailsHtml = `
            <div style="background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; text-align: left; max-width: 400px; margin: 0 auto 32px;">
                ${details.provider ? `<div style="color: #9ca3af; margin-bottom: 8px;">登录方式: <span style="color: #3b82f6; font-weight: 600;">${details.provider}</span></div>` : ''}
                ${details.accountNumber ? `<div style="color: #9ca3af; margin-bottom: 8px;">账号编号: <span style="color: #10b981; font-weight: 600;">#${details.accountNumber}</span></div>` : ''}
                ${details.tokenFile ? `<div style="color: #9ca3af; margin-bottom: 8px;">Token 文件: <code style="color: #f59e0b; background: rgba(245,158,11,0.1); padding: 2px 6px; border-radius: 4px;">${details.tokenFile}</code></div>` : ''}
                <div style="color: #9ca3af;">状态: <span style="color: #10b981;">已保存</span></div>
            </div>
        `;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kiro OAuth - ${title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            animation: fadeIn 0.5s ease-out;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .icon {
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, ${iconColor} 0%, ${iconColor}cc 100%);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
            box-shadow: 0 0 40px ${iconColor}66;
        }
        .icon span { font-size: 40px; }
        h1 { font-size: 32px; margin-bottom: 12px; }
        .message { color: #9ca3af; font-size: 18px; margin-bottom: 32px; max-width: 500px; }
        .btn {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 14px 32px;
            font-size: 16px;
            cursor: pointer;
            font-weight: 500;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }
        .hint { color: #6b7280; font-size: 14px; margin-top: 16px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon"><span>${icon}</span></div>
        <h1>${title}</h1>
        <p class="message">${message}</p>
        ${detailsHtml}
        <button class="btn" onclick="window.close()">关闭此页面</button>
        <p class="hint">此页面可以安全关闭</p>
    </div>
</body>
</html>`;
}


/**
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                if (!body.trim()) {
                    resolve({});
                } else {
                    resolve(JSON.parse(body));
                }
            } catch (error) {
                reject(new Error('无效的JSON格式'));
            }
        });
        req.on('error', reject);
    });
}

// 定时清理过期token
setInterval(cleanupExpiredTokens, 5 * 60 * 1000); // 每5分钟清理一次

/**
 * Handle UI management API requests
 * @param {string} method - The HTTP method
 * @param {string} path - The request path
 * @param {http.IncomingMessage} req - The HTTP request object
 * @param {http.ServerResponse} res - The HTTP response object
 * @param {Object} currentConfig - The current configuration object
 * @param {Object} accountPoolManager - The account pool manager instance
 * @returns {Promise<boolean>} - True if the request was handled by UI API
 */
export async function handleUIApiRequests(method, pathParam, req, res, currentConfig, accountPoolManager) {
    // ========== 文件上传特殊处理（需要在路由器之前） ==========
    if (isUploadRequest(method, pathParam)) {
        await handleUpload(req, res, currentConfig);
        return true;
    }

    // ========== 路由器处理逻辑 ==========
    // 创建路由器实例
    if (!global.uiRouter || process.env.NODE_ENV !== 'production') {
        global.uiRouter = createRouter();
        if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
            logger.verbose(`Router initialized with ${global.uiRouter.getRoutes().length} routes`);
        }
    }

    // 匹配路由
    const matched = global.uiRouter.match(method, pathParam);

    if (matched) {
        const { route, match } = matched;

        if (ROUTER_CONFIG.ENABLE_ROUTER_LOGGING) {
            logger.verbose(`Router matched: ${method} ${pathParam} -> ${route.description || '(no description)'}`);
        }

        // 认证检查
        if (route.auth) {
            const isAuth = await routerCheckAuth(req, res);
            if (!isAuth) {
                // routerCheckAuth 已经发送了 401 响应
                return true;
            }
        }

        // 调用 handler
        try {
            await route.handler({
                req,
                res,
                currentConfig,
                accountPoolManager,
                match
            });

            logger.verbose(`Router handler completed: ${method} ${pathParam}`);

            return true;
        } catch (error) {
            logger.error(`Router error handling ${method} ${pathParam}`, error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Internal Server Error' } }));
            }
            return true;
        }
    }

    // 未匹配到路由，返回 false 继续处理
    logger.debug(`Router no match found for: ${method} ${pathParam}`);
    return false;
}

// 重新导出从 UI 模块导入的函数
export { serveStaticFiles, initializeUIManagement, broadcastEvent };
