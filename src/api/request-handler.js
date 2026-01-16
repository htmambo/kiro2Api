/**
 * 统一请求入口与路由分流控制器
 *
 * 负责在同一链路中完成安全头、限流、静态资源、鉴权与 API 路由分发。
 * 路由处理顺序非常关键：需要尽早拒绝无效请求、优先满足静态/开发代理，并确保鉴权发生在业务处理之前。
 *
 * @module request-handler
 */

import deepmerge from 'deepmerge';
import { isAuthorized } from '../utils/common.js';
import { handleUIApiRequests, serveStaticFiles } from '../ui-manager.js';
import { proxyViteRequest, shouldProxyToVitePath } from '../ui/vite-dev-proxy.js';
import { handleAPIRequests } from './manager.js';
import { getApiService } from '../services/manager.js';
import { getAccountPoolManager } from '../services/manager.js';
import { MODEL_PROVIDER } from '../utils/common.js';
import { PROMPT_LOG_FILENAME } from '../config/manager.js';
import { errorMiddleware, createError } from './error-middleware.js';
import { checkRateLimit, isRateLimitWhitelisted } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

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
            if (pathSegments.length > 0) {
                const firstSegment = pathSegments[0];
                const isValidProvider = firstSegment === 'claude-kiro-oauth';
                if (firstSegment && isValidProvider) {
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

        // Handle CORS preflight requests
        if (method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-goog-api-key, Model-Provider');
            res.writeHead(204);
            res.end();
            return;
        }

        // Serve static files for UI (除了登录页面需要认证)
        if (shouldProxyToVitePath(path)) {
            const proxied = await proxyViteRequest(req, res);
            if (proxied) return;
        } else if (
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
            path.startsWith('/_next/') ||
            path.startsWith('/dashboard') ||
            path.endsWith('.png') ||
            path.endsWith('.jpg') ||
            path.endsWith('.svg')
        ) {
            const served = await serveStaticFiles(path, res);
            if (served) return;
        }

        // API-key protected endpoints should be authenticated before any handler consumes the request
        if (isApiKeyProtectedPath(path)) {
            if (!isAuthorized(req, requestUrl, currentConfig.REQUIRED_API_KEY)) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing.' } }));
                return;
            }
        }

        const uiHandled = await handleUIApiRequests(method, path, req, res, currentConfig, accountPoolManager);
        if (uiHandled) return;

        logger.info(`\n${new Date().toLocaleString()}`);
        logger.info(`Received request: ${req.method} http://${host}${sanitizeUrlForLogs(req.url)}`);

        // Health check endpoint
        if (method === 'GET' && path === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                provider: currentConfig.MODEL_PROVIDER
            }));
            return true;
        }

        // Pool status and cache stats endpoint
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

        // Ignore count_tokens requests
        if (path.includes('/count_tokens')) {
            logger.info(`Ignoring count_tokens request: ${path}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                tokens: 0,
                message: 'Token counting is not supported'
            }));
            return true;
        }

        currentConfig.MODEL_PROVIDER = 'claude-kiro-oauth';

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


            // Fallback for unmatched routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Not Found' } }));
        } catch (error) {
            await errorMiddleware(error, req, res);
        }
    };
}
