import { CONFIG } from '../../config/manager.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('security-headers');

export function createSecurityHeadersMiddleware() {
    const isProduction = CONFIG.NODE_ENV === 'production';
    
    logger.info('Security headers middleware initialized', {
        production: isProduction
    });
    
    return function securityHeadersMiddleware(req, res, next) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 
            'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
        );
        
        if (isProduction) {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }
        
        const cspDirectives = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self'",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'"
        ];
        
        if (isProduction) {
            res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
        } else {
            res.setHeader('Content-Security-Policy-Report-Only', cspDirectives.join('; '));
        }
        
        next();
    };
}

export function addSecurityHeaders(res, isProduction = false) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    if (isProduction) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
}
