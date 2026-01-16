import {
    handleContentGenerationRequest,
    ENDPOINT_TYPE
} from '../utils/common.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('api:manager');

/**
 * Handle API authentication and routing
 * @param {string} method - The HTTP method
 * @param {string} path - The request path
 * @param {http.IncomingMessage} req - The HTTP request object
 * @param {http.ServerResponse} res - The HTTP response object
 * @param {Object} currentConfig - The current configuration object
 * @param {KiroService} apiService - The API service instance
 * @param {Object} poolManager - Pool manager instance (provider/account)
 * @param {string} promptLogFilename - The prompt log filename
 * @returns {Promise<boolean>} - True if the request was handled by API
 */
export async function handleAPIRequests(method, path, req, res, currentConfig, apiService, poolManager, promptLogFilename) {
    // Route content generation requests
    if (method === 'POST') {
        if (path === '/v1/messages' || path === '/v1/stream') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.CLAUDE_MESSAGE, currentConfig, promptLogFilename, poolManager, currentConfig.uuid);
            return true;
        }
        if (path === '/v1/chat/completions') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_CHAT, currentConfig, promptLogFilename, poolManager, currentConfig.uuid);
            return true;
        }
        if (path === '/v1/responses') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_RESPONSES, currentConfig, promptLogFilename, poolManager, currentConfig.uuid);
            return true;
        }
    }

    return false;
}

/**
 * Initialize API management features
 * @param {Object} services - The initialized services
 * @returns {Function} - The heartbeat and token refresh function
 */
export function initializeAPIManagement(services) {
    return async function heartbeatAndRefreshToken() {
        logger.info(`Server is running. Current time: ${new Date().toLocaleString()}`, { providers: Object.keys(services) });
        for (const providerKey in services) {
            const serviceAdapter = services[providerKey];
            try {
                await serviceAdapter.checkToken();
            } catch (error) {
                logger.error(`Failed to refresh token for ${providerKey}`, error);
            }
        }
    };
}

/**
 * Helper function to read request body
 * @param {http.IncomingMessage} req The HTTP request object.
 * @returns {Promise<string>} The request body as string.
 */
export function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            resolve(body);
        });
        req.on('error', err => {
            reject(err);
        });
    });
}
