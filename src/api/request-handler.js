import deepmerge from 'deepmerge';
import { isAuthorized } from '../utils/common.js';
import { handleUIApiRequests, serveStaticFiles } from '../ui-manager.js';
import { handleAPIRequests } from './manager.js';
import { getApiService } from '../services/manager.js';
import { getAccountPoolManager } from '../services/manager.js';
import { MODEL_PROVIDER } from '../utils/common.js';
import { PROMPT_LOG_FILENAME } from '../config/manager.js';
import { errorMiddleware, createError } from './error-middleware.js';
import { checkRateLimit, isRateLimitWhitelisted } from './rate-limiter.js';
/**
 * Main request handler. It authenticates the request, determines the endpoint type,
 * and delegates to the appropriate specialized handler function.
 * @param {Object} config - The server configuration
 * @param {Object} accountPoolManager - Pool manager instance (provider/account)
 * @returns {Function} - The request handler function
 */
export function createRequestHandler(config, accountPoolManager) {
    return async function requestHandler(req, res) {
        try {
            // Deep copy the config for each request to allow dynamic modification
            const currentConfig = deepmerge({}, config);
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        let path = requestUrl.pathname;
        const method = req.method;

        // Check rate limit (before any heavy processing)
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
        if (path.startsWith('/static/') ||path.startsWith('/assets/') ||  path.startsWith('/static-site/') || path === '/' || path === '/favicon.ico' || path === '/index.html' || path.startsWith('/app/') || path === '/login.html' || path.startsWith('/_next/') || path.startsWith('/dashboard') || path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.svg')) {
            const served = await serveStaticFiles(path, res);
            if (served) return;
        }

        const uiHandled = await handleUIApiRequests(method, path, req, res, currentConfig, accountPoolManager);
        if (uiHandled) return;

        console.log(`\n${new Date().toLocaleString()}`);
        console.log(`[Server] Received request: ${req.method} http://${req.headers.host}${req.url}`);

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
                const { getAccountPoolManager } = await import('../services/pools/json.js');

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
            console.log(`[Server] Ignoring count_tokens request: ${path}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                tokens: 0,
                message: 'Token counting is not supported'
            }));
            return true;
        }

        currentConfig.MODEL_PROVIDER = 'claude-kiro-oauth';
        // Check if the first path segment matches a MODEL_PROVIDER and switch if it does
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

        // 获取或选择 API Service 实例
        let apiService;
        try {
            apiService = await getApiService(currentConfig);
        } catch (error) {
            const serviceError = createError(`Failed to get API service: ${error.message}`, 500);
            await errorMiddleware(serviceError, req, res);
            const activeAccountPoolManager = poolManager || getAccountPoolManager();
            if (activeAccountPoolManager && currentConfig.uuid) {
                if (typeof activeAccountPoolManager.markAccountUnhealthy === 'function') {
                    activeAccountPoolManager.markAccountUnhealthy(currentConfig.uuid, error);
                }
            }
            return;
        }
        // Handle API requests
        const apiHandled = await handleAPIRequests(method, path, req, res, currentConfig, apiService, accountPoolManager, PROMPT_LOG_FILENAME);
        if (apiHandled) return;

        // Skip authentication for OAuth callback endpoints
        const isOAuthCallback = path === '/api/kiro/oauth/callback';

        // Check authentication for API requests
        if (!isOAuthCallback && !isAuthorized(req, requestUrl, currentConfig.REQUIRED_API_KEY)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Unauthorized: API key is invalid or missing.' } }));
            return;
        }


            // Fallback for unmatched routes
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Not Found' } }));
        } catch (error) {
            await errorMiddleware(error, req, res);
        }
    };
}
