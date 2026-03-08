import { estimateInputTokens } from '../kiro/utils/token-counter.js';
import { parseRequestBody } from '../utils/request-body.js';
import { createError, errorMiddleware } from './error-middleware.js';

export async function handleBuiltinRoutes(method, path, req, res, currentConfig, accountPoolManager) {
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
            const poolStats = accountPoolManager ? accountPoolManager.getPoolStats() : null;
            const poolDetails = accountPoolManager ? accountPoolManager.getPoolDetails() : null;

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
        try {
            const requestBody = await parseRequestBody(req, {
                errorMessage: 'Invalid JSON in request body.'
            });
            const inputTokens = Math.max(1, estimateInputTokens(requestBody, false));

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                input_tokens: inputTokens
            }));
            return true;
        } catch (error) {
            const tokenCountError = createError(error.message || 'Failed to count tokens', error.status || 400);
            await errorMiddleware(tokenCountError, req, res);
            return true;
        }
    }

    return false;
}
