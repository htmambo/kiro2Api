import { timingSafeEqual, randomBytes, createHash } from 'crypto';

export function timingSafeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    
    if (a.length !== b.length) {
        const dummy = Buffer.alloc(a.length, 0);
        const bufA = Buffer.from(a);
        timingSafeEqual(bufA, dummy);
        return false;
    }
    
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    
    return timingSafeEqual(bufA, bufB);
}

export function validateKeyComplexity(key) {
    if (!key || typeof key !== 'string') {
        return { valid: false, reason: 'Key must be a non-empty string' };
    }
    
    if (key.length < 32) {
        return { valid: false, reason: `Key must be at least 32 characters (current: ${key.length})` };
    }
    
    const charSet = new Set(key);
    const entropy = Math.log2(charSet.size);
    
    if (entropy < 4.5) {
        return { valid: false, reason: `Key entropy too low (${entropy.toFixed(2)} bits/char, min: 4.5)` };
    }
    
    return { valid: true, reason: '' };
}

export function generateSecureRandom(bytes) {
    return randomBytes(bytes);
}

export function generateSecureRandomString(bytes = 32) {
    return randomBytes(bytes).toString('base64url');
}

export function sha256Hash(data) {
    return createHash('sha256').update(data).digest('hex');
}

export function isSensitiveKey(key) {
    if (!key || typeof key !== 'string') return false;
    
    const sensitivePatterns = [
        /password/i, /secret/i, /token/i, /api.?key/i, /auth/i,
        /credential/i, /private/i, /key/i, /authorization/i, /cookie/i, /session/i
    ];
    
    const lowerKey = key.toLowerCase();
    return sensitivePatterns.some(pattern => pattern.test(lowerKey));
}

export function redactSensitiveValue(value) {
    if (!value || typeof value !== 'string') return '[REDACTED]';
    if (value.length <= 4) return '****';
    
    return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
