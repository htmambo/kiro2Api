import { validateKeyComplexity } from '../utils/security.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('config-validation');

export function validateServerConfig(config) {
    const errors = [];
    
    if (config.NODE_ENV === 'production' && config.REQUIRED_API_KEY) {
        const keyValidation = validateKeyComplexity(config.REQUIRED_API_KEY);
        
        if (!keyValidation.valid) {
            if (config.ALLOW_WEAK_API_KEY === 'true') {
                logger.warn('Production server starting with weak API key (ALLOW_WEAK_API_KEY=true)', {
                    reason: keyValidation.reason
                });
            } else {
                errors.push(`API key validation failed: ${keyValidation.reason}`);
            }
        }
    }
    
    if (config.CORS_ALLOWED_ORIGINS) {
        const origins = config.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(o => o);
        for (const origin of origins) {
            try {
                new URL(origin);
            } catch {
                errors.push(`Invalid CORS origin format: ${origin}`);
            }
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

export function sanitizeConfigForLogging(config) {
    const sensitiveKeys = [
        'REQUIRED_API_KEY',
        'TOKEN_ENCRYPTION_KEY',
        'REDIS_PASSWORD',
        'DATABASE_PASSWORD',
        'OAUTH_CLIENT_SECRET'
    ];
    
    const sanitized = {};
    for (const [key, value] of Object.entries(config)) {
        if (sensitiveKeys.includes(key) && value) {
            sanitized[key] = value.length > 4 
                ? `${value.slice(0, 2)}****${value.slice(-2)}`
                : '****';
        } else {
            sanitized[key] = value;
        }
    }
    
    return sanitized;
}
