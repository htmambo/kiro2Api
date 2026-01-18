import { createLogger } from '../lib/logger.js';

const logger = createLogger('utils:auth');

export function isAuthorized(req, requestUrl, REQUIRED_API_KEY) {
    const authHeader = req.headers['authorization'];
    const claudeApiKey = req.headers['x-api-key'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        if (token === REQUIRED_API_KEY) {
            return true;
        }
    }

    if (claudeApiKey === REQUIRED_API_KEY) {
        return true;
    }

    logger.warn('[Auth] Unauthorized request denied', {
        bearerPresent: Boolean(authHeader),
        xApiKeyPresent: Boolean(claudeApiKey),
        hasKeyQuery: requestUrl.searchParams.has('key') || requestUrl.searchParams.has('api_key') || requestUrl.searchParams.has('apikey')
    });
    return false;
}
