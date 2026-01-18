/**
 * 统一请求入口与路由分流控制器
 *
 * 负责在同一链路中完成安全头、限流、静态资源、鉴权与 API 路由分发。
 * 路由处理顺序非常关键：需要尽早拒绝无效请求、优先满足静态/开发代理，并确保鉴权发生在业务处理之前。
 *
 * @module request-handler
 */

import deepmerge from 'deepmerge';
import { isAuthorized } from '../utils/auth-utils.js';
import { handleUIApiRequests, serveStaticFiles } from '../ui-manager.js';
import { proxyViteRequest, shouldProxyToVitePath } from '../ui/vite-dev-proxy.js';
import { handleAPIRequests } from './manager.js';
import { getApiService } from '../services/manager.js';
import { getAccountPoolManager } from '../services/manager.js';
import { MODEL_PROVIDER } from '../utils/constants.js';
import { PROMPT_LOG_FILENAME } from '../config/manager.js';
import { errorMiddleware, createError } from './error-middleware.js';
import { checkRateLimit, isRateLimitWhitelisted } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';
import { readRequestBody as readBody } from '../utils/request-body.js';
import { logUnmatchedRoute } from '../utils/unmatched-route-logger.js';

const logger = createLogger('api:request-handler');

/**
 * 在日志中清理 URL 中的敏感参数，避免泄露密钥
 *
 * @param {string} rawUrl - 原始请求 URL
 * @returns {string} 已脱敏的 URL
 */
function sanitizeUrlForLogs(rawUrl) {
    if (!rawUrl) return 'unknown';
    try {
        const u = new URL(rawUrl, 'http://dummy');
        for (const key of ['key', 'api_key', 'apikey', 'token', 'password', 'secret']) {
            if (u.searchParams.has(key)) u.searchParams.set(key, '***REDACTED***');
        }
        return u.pathname + u.search;
    } catch {
        return String(rawUrl).replace(/([?&])(key|api_key|apikey|token|password|secret)=([^&]*)/gi, '$1$2=***REDACTED***');
    }
}

/**
 * 设置基础安全响应头，降低常见浏览器侧风险
 *
 * @param {http.ServerResponse} res - HTTP 响应对象
 */
function setBasicSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

/**
 * 判断是否为需要 API Key 保护的路径
 *
 * @param {string} pathname - 请求路径
 * @returns {boolean} 是否需要鉴权
 */
function isApiKeyProtectedPath(pathname) {
    if (!pathname) return false;
    if (pathname.startsWith('/v1/')) return true;
    if (pathname === '/stats') return true;
    return false;
}

async function safeReadRequestBody(req) {
    if (req.body !== undefined) {
        return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    try {
        return await Promise.race([
            readBody(req),
            new Promise(resolve => setTimeout(() => resolve('(timeout)'), 1000))
        ]);
    } catch {
        return '(error reading body)';
    }
}
/**
 * 主请求处理器，按固定顺序完成限流、静态资源、鉴权与 API 路由分发
 *
 * 处理顺序的原因：
 * 1) 先做限流，避免无效请求消耗后续资源
 * 2) 静态资源与开发代理优先返回，避免被鉴权或业务逻辑阻塞
 * 3) 鉴权必须早于业务处理，防止未授权请求进入核心路径
 *
 * @param {Object} config - 服务器配置
 * @param {Object} accountPoolManager - 账号池管理器
 * @returns {Function} - 请求处理函数
 */
export function createRequestHandler(config, accountPoolManager) {
    return async function requestHandler(req, res) {
        try {
            // 为什么深拷贝：请求级配置可能被动态修改，避免并发请求相互污染
            const currentConfig = deepmerge({}, config);
            const host = req.headers.host || 'localhost';
            const requestUrl = new URL(req.url, `http://${host}`);
            let path = requestUrl.pathname;
            const method = req.method;

            setBasicSecurityHeaders(res);

            // 提前剥离 provider 前缀，统一路由入口，避免后续处理分叉
            const pathSegments = path.split('/').filter(segment => segment.length > 0);
            let isKiroOAuthRequest = false;
            if (pathSegments.length > 0) {
                const firstSegment = pathSegments[0];
                isKiroOAuthRequest = firstSegment === MODEL_PROVIDER.KIRO_API;
                if (firstSegment && isKiroOAuthRequest) {
                    pathSegments.shift();
                    path = '/' + pathSegments.join('/');
                    requestUrl.pathname = path;
                }
            }

            // 限流放在最早：优先拒绝高频请求，减少后续 IO/鉴权成本
            if (!isRateLimitWhitelisted(path, currentConfig)) {
                const { allowed, retryAfterSeconds } = checkRateLimit(req, currentConfig);
                if (!allowed) {
                    res.setHeader('Retry-After', String(retryAfterSeconds));
                    const rateLimitError = createError('Too many requests. Rate limit exceeded.', 429);
                    await errorMiddleware(rateLimitError, req, res);
                    return;
                }
            }

        // 处理 CORS 预检请求
        if (method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, Model-Provider');
            res.writeHead(204);
            res.end();
            return;
        }

        const isProduction = process.env.NODE_ENV === 'production';

        if (!isProduction && shouldProxyToVitePath(path)) {
            const proxied = await proxyViteRequest(req, res);
            if (proxied) return;
        } else if (isProduction && (
            path.startsWith('/static/') ||
            path.startsWith('/assets/') ||
            path.startsWith('/static-site/') ||
            path === '/' ||
            path === '/favicon.ico' ||
            path === '/index.html' ||
            path === '/login' ||
            path.startsWith('/login/') ||
            path === '/login.html' ||
            path.startsWith('/app/') ||
            path.startsWith('/dashboard') ||
            path.endsWith('.png') ||
            path.endsWith('.jpg') ||
            path.endsWith('.svg')
        )) {
            const served = await serveStaticFiles(path, res);
            if (served) return;
        }

        // 需要 API Key 的路由必须先鉴权
        if (isApiKeyProtectedPath(path)) {
            if (!isAuthorized(req, requestUrl, currentConfig.REQUIRED_API_KEY)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing.' } }));
                return;
            }
        }

        const uiHandled = await handleUIApiRequests(method, path, req, res, currentConfig, accountPoolManager);
        if (uiHandled) return;

        logger.debug(`\n${new Date().toLocaleString()}`);
        logger.debug(`Received request: ${req.method} http://${host}${sanitizeUrlForLogs(req.url)}`);

        if (method === 'GET' && path === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                provider: currentConfig.MODEL_PROVIDER
            }));
            return true;
        }

        if (method === 'GET' && path === '/stats') {
            try {
                const { getAccountPoolManager } = await import('../domain/account-pool/json-store.js');

                const accountPool = getAccountPoolManager();

                const poolStats = accountPool ? accountPool.getPoolStats() : null;
                const poolDetails = accountPool ? accountPool.getPoolDetails() : null;

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    timestamp: new Date().toISOString(),
                    accountPool: {
                        stats: poolStats,
                        details: poolDetails
                    },
                    provider: currentConfig.MODEL_PROVIDER
                }, null, 2));
                return true;
            } catch (error) {
                const statsError = createError(`Failed to get stats: ${error.message}`, 500);
                await errorMiddleware(statsError, req, res);
                return true;
            }
        }

        if (path.includes('/count_tokens')) {
            logger.debug(`Ignoring count_tokens request: ${path}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                tokens: 0,
                message: 'Token counting is not supported'
            }));
            return true;
        }

        // ============================================================================
        // MODEL_PROVIDER 配置策略
        // ============================================================================
        // 仅在明确场景下设置 MODEL_PROVIDER，尊重用户配置
        //
        // 场景 1: Kiro OAuth 请求（路径以 /claude-kiro-oauth 开头）
        //   - 若用户未配置 MODEL_PROVIDER，则自动设置为 KIRO_API
        //   - 若用户已配置，则尊重用户配置
        //   - 可通过 FORCE_KIRO_OAUTH_PROVIDER=true 强制覆盖（不推荐）
        //
        // 场景 2: 非 Kiro OAuth 请求
        //   - 完全尊重用户配置，不做任何修改
        // ============================================================================

        const hasConfiguredProvider = typeof currentConfig.MODEL_PROVIDER === 'string'
            && currentConfig.MODEL_PROVIDER.trim().length > 0;
        const forceKiroOAuthProvider = currentConfig.FORCE_KIRO_OAUTH_PROVIDER === true;

        if (isKiroOAuthRequest && (!hasConfiguredProvider || forceKiroOAuthProvider)) {
            currentConfig.MODEL_PROVIDER = MODEL_PROVIDER.KIRO_API;

            if (forceKiroOAuthProvider && hasConfiguredProvider) {
                logger.warn('FORCE_KIRO_OAUTH_PROVIDER 已启用，强制覆盖用户配置的 MODEL_PROVIDER');
            }
        }

        // 获取或选择 API Service 实例
        let apiService;
        try {
            apiService = await getApiService(currentConfig);
        } catch (error) {
            const serviceError = createError(`Failed to get API service: ${error.message}`, 500);
            await errorMiddleware(serviceError, req, res);
            const activeAccountPoolManager = accountPoolManager || getAccountPoolManager();
            if (activeAccountPoolManager && currentConfig.uuid) {
                if (typeof activeAccountPoolManager.markAccountUnhealthy === 'function') {
                    // 获取服务失败时标记不健康，避免同账号反复选中导致连续失败
                    activeAccountPoolManager.markAccountUnhealthy(currentConfig.uuid, error);
                }
            }
            return;
        }
        // Handle API requests
        const apiHandled = await handleAPIRequests(method, path, req, res, currentConfig, apiService, accountPoolManager, PROMPT_LOG_FILENAME);
        if (apiHandled) return;

            if (currentConfig.LOG_UNMATCHED_ROUTES) {
                const body = await safeReadRequestBody(req);
                await logUnmatchedRoute(req, method, path, body);
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Not Found' } }));
        } catch (error) {
            await errorMiddleware(error, req, res);
        }
    };
}
