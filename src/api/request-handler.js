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
import { applyCorsHeaders, handleCorsPreflight } from './cors.js';
import { handleBuiltinRoutes } from './builtin-routes.js';
import {
    sanitizeUrlForLogs,
    setBasicSecurityHeaders,
    isApiKeyProtectedPath,
    shouldServeStaticUiPath,
    normalizeProviderRequestPath,
    shouldAttemptApiHandling
} from './request-router-utils.js';

const logger = createLogger('api:request-handler');
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
            let currentConfig = deepmerge({}, config);
            const host = req.headers.host || 'localhost';
            const requestUrl = new URL(req.url, `http://${host}`);
            const normalizedRequest = normalizeProviderRequestPath(requestUrl.pathname);
            let path = normalizedRequest.path;
            const method = req.method;

            setBasicSecurityHeaders(res);
            applyCorsHeaders(req, res, currentConfig);

            const isKiroOAuthRequest = normalizedRequest.isKiroOAuthRequest;
            requestUrl.pathname = path;

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

            if (handleCorsPreflight(req, res, currentConfig)) {
                return;
            }

            // 提供 UI 静态资源（登录页面无需认证）
            if (shouldProxyToVitePath(path)) {
                const proxied = await proxyViteRequest(req, res);
                if (proxied) return;
            } else if (shouldServeStaticUiPath(path)) {
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

            logger.info(`\n${new Date().toLocaleString()}`);
            logger.info(`Received request: ${req.method} http://${host}${sanitizeUrlForLogs(req.url)}`);

            const activeAccountPoolManager = accountPoolManager || getAccountPoolManager();
            const builtinHandled = await handleBuiltinRoutes(method, path, req, res, currentConfig, activeAccountPoolManager);
            if (builtinHandled) return;

            if (!shouldAttemptApiHandling(method, path)) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Not Found' } }));
                return;
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
                const serviceSelection = await getApiService(currentConfig);
                apiService = serviceSelection.service;
                currentConfig = serviceSelection.resolvedConfig;
            } catch (error) {
                const serviceError = createError(`Failed to get API service: ${error.message}`, 500);
                await errorMiddleware(serviceError, req, res);
                if (activeAccountPoolManager && currentConfig.uuid) {
                    if (typeof activeAccountPoolManager.markAccountUnhealthy === 'function') {
                        // 获取服务失败时标记不健康，避免同账号反复选中导致连续失败
                        activeAccountPoolManager.markAccountUnhealthy(currentConfig.uuid, error);
                    }
                }
                return;
            }

            // Handle API requests
            const apiHandled = await handleAPIRequests(method, path, req, res, currentConfig, apiService, activeAccountPoolManager, PROMPT_LOG_FILENAME);
            if (apiHandled) return;

            // Fallback for unmatched routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Not Found' } }));
        } catch (error) {
            await errorMiddleware(error, req, res);
        }
    };
}
