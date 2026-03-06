import { timingSafeCompare, isSensitiveKey, redactSensitiveValue } from '../../utils/security.js';
import { createLogger } from '../../lib/logger.js';
import { CONFIG } from '../../config/manager.js';

const logger = createLogger('auth');

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

function sanitizeHeaders(headers) {
    const sanitized = {};
    for (const [key, value] of Object.entries(headers)) {
        if (isSensitiveKey(key)) {
            sanitized[key] = redactSensitiveValue(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

export function createAuthMiddleware() {
    return function authMiddleware(req, res, next) {
        const path = req.url || '/';
        const clientIp = getClientIp(req);
        
        if (path === '/health' || path === '/master/health' || 
            path.startsWith('/login') || path.startsWith('/static/') ||
            path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
            return next();
        }
        
        if (!path.startsWith('/v1/') && !path.startsWith('/master/')) {
            return next();
        }
        
        const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
        
        if (!apiKey) {
            logger.warn('Authentication failed: Missing API key', {
                ip: clientIp,
                path: path,
                headers: sanitizeHeaders(req.headers)
            });
            
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Unauthorized',
                message: 'API key required'
            }));
            return;
        }
        
        const requiredKey = CONFIG.REQUIRED_API_KEY;
        
        if (!requiredKey) {
            logger.error('Server configuration error: REQUIRED_API_KEY not set');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Internal Server Error',
                message: 'Authentication configuration error'
            }));
            return;
        }
        
        const isValid = timingSafeCompare(apiKey, requiredKey);
        
        if (!isValid) {
            logger.warn('Authentication failed: Invalid API key', {
                ip: clientIp,
                path: path,
                keyPrefix: apiKey.slice(0, 4) + '****'
            });
            
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'Unauthorized',
                message: 'Invalid API key'
            }));
            return;
        }
        
        logger.debug('Authentication successful', {
            ip: clientIp,
            path: path
        });
        
        next();
    };
}

export function simpleAuthCheck(providedKey, requiredKey) {
    return timingSafeCompare(providedKey, requiredKey);
}
