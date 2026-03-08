import { CONFIG } from './config/manager.js';
import { serviceInstances, initApiService } from './services/manager.js';
import { serveStaticFiles } from './ui/static.js';
import { initializeUIManagement, broadcastEvent } from './ui/events.js';
import { createLogger } from './lib/logger.js';
import { KIRO_IDE_VERSION, DEFAULT_PROVIDER_TYPE } from './kiro/constants.js';
import { readUsageCache, writeUsageCache, readProviderUsageCache } from './ui/usage-cache.js';
import {
    readTokenStore,
    writeTokenStore,
    generateToken,
    getExpiryTime,
    saveToken,
    startTokenCleanupScheduler
} from './ui/auth/session-store.js';
import { checkUiPasswordOnStartup, validateCredentials } from './ui/auth/credentials.js';

// 路由器相关导入
import { createRouter } from './ui/router/index.js';
import { requireAuth as routerCheckAuth } from './ui/router/middleware/auth.middleware.js';

// 路由器配置
export const ROUTER_CONFIG = {
    ENABLE_ROUTER_LOGGING: true // 启用路由日志
};

export const DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS = DEFAULT_PROVIDER_TYPE;
const logger = createLogger('ui:manager');
checkUiPasswordOnStartup();
startTokenCleanupScheduler();

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

// OAuth state 已迁移到 domain 层（兼容旧 export）
export { kiroOAuthStates, kiroOAuthCompletedStates } from './domain/oauth/state-store.js';

// Kiro OAuth 配置
export const KIRO_OAUTH_CONFIG = {
    REDIRECT_URI: 'kiro://kiro.kiroAgent/authenticate-success',
    REDIRECT_URI_WEB: null,  // 动态生成，基于实际监听端口
    IDE_VERSION: KIRO_IDE_VERSION,  // 从 constants.js 导入
    TOKEN_ENDPOINT: 'https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token',
    LOGIN_ENDPOINT: 'https://prod.us-east-1.auth.desktop.kiro.dev/login'
};

/**
 * OAuth 结果页面生成
 * Stage 2.5: 已拆分到独立视图模块 (src/ui/views/oauth-result.js)
 * 保留从 ui-manager 的导出以兼容旧引用
 */
export { generateOAuthResultPage } from './ui/views/oauth-result.js';

// ============================================================================
// 请求体解析工具（从 request-body.js 模块 re-export）
// ============================================================================

/**
 * 解析请求体 JSON
 *
 * 此函数已迁移到 `./utils/request-body.js` 模块
 * 此处保留 re-export 以保持向后兼容性
 * 同时解决循环依赖问题：system.handlers 不再依赖 ui-manager
 */
export { parseRequestBody } from './utils/request-body.js';

/**
 * Serve static files for the UI
 * @param {string} path - The request path
 * @param {http.ServerResponse} res - The HTTP response object
 */

/**
 * 重载配置文件
 * 动态导入config-manager并重新初始化配置
 * @returns {Promise<Object>} 返回重载后的配置对象
 */
export async function reloadConfig() {
    try {
        // Import config manager dynamically
        const { initializeConfig } = await import('./config/manager.js');

        // Reload main config
        const newConfig = await initializeConfig(process.argv.slice(2), './configs/config.json');

        // Update global CONFIG
        Object.assign(CONFIG, newConfig);
        logger.info('[UI API] Configuration reloaded:');

        // Update initApiService - 清空并重新初始化服务实例
        Object.keys(serviceInstances).forEach(key => delete serviceInstances[key]);
        initApiService(CONFIG);

        logger.info('[UI API] Configuration reloaded successfully');

        return newConfig;
    } catch (error) {
        logger.error('[UI API] Failed to reload configuration', error);
        throw error;
    }
}

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
export {
    serveStaticFiles,
    initializeUIManagement,
    broadcastEvent,
    readUsageCache,
    writeUsageCache,
    readProviderUsageCache,
    readTokenStore,
    writeTokenStore,
    generateToken,
    getExpiryTime,
    saveToken,
    validateCredentials
};
