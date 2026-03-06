import { CONFIG } from '../../config/manager.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('cors');

export function parseCorsOrigins(originsString) {
    if (!originsString || typeof originsString !== 'string') {
        return [];
    }
    
    return originsString
        .split(',')
        .map(origin => origin.trim())
        .filter(origin => origin.length > 0);
}

export function isOriginAllowed(origin, whitelist) {
    if (!whitelist || whitelist.length === 0) {
        return true;
    }
    
    if (!origin) {
        return false;
    }
    
    for (const allowed of whitelist) {
        if (origin === allowed) {
            return true;
        }
        
        if (allowed.startsWith('*.')) {
            const domain = allowed.slice(2);
            if (origin.endsWith(domain) && origin.includes('.')) {
                const originHost = new URL(origin).hostname;
                if (originHost.endsWith(domain) && originHost !== domain) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

export function createCorsMiddleware() {
    const whitelist = parseCorsOrigins(CONFIG.CORS_ALLOWED_ORIGINS);
    
    if (whitelist.length > 0) {
        logger.info('CORS whitelist configured', { 
            origins: whitelist,
            count: whitelist.length 
        });
    } else {
        logger.warn('CORS whitelist empty - allowing all origins (development mode)');
    }
    
    return function corsMiddleware(req, res, next) {
        const origin = req.headers.origin;
        const method = req.method;
        
        const allowed = isOriginAllowed(origin, whitelist);
        
        if (allowed && origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        
        if (method === 'OPTIONS') {
            if (allowed) {
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
                res.setHeader('Access-Control-Max-Age', '86400');
                res.writeHead(204);
                res.end();
                return;
            } else {
                logger.warn('CORS preflight rejected', { 
                    origin: origin || 'none',
                    path: req.url 
                });
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Forbidden',
                    message: 'Origin not allowed'
                }));
                return;
            }
        }
        
        if (origin && !allowed) {
            logger.warn('CORS request rejected', { 
                origin: origin,
                path: req.url,
                ip: req.socket?.remoteAddress 
            });
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: 'Forbidden',
                message: 'Origin not allowed'
            }));
            return;
        }
        
        next();
    };
}

export function getCorsConfig() {
    return {
        whitelist: parseCorsOrigins(CONFIG.CORS_ALLOWED_ORIGINS),
        enabled: !!CONFIG.CORS_ALLOWED_ORIGINS
    };
}
