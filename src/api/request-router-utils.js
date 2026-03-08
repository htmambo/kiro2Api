import { MODEL_PROVIDER } from '../utils/common.js';

export function sanitizeUrlForLogs(rawUrl) {
    if (!rawUrl) return 'unknown';
    try {
        const parsedUrl = new URL(rawUrl, 'http://dummy');
        for (const key of ['key', 'api_key', 'apikey', 'token', 'password', 'secret']) {
            if (parsedUrl.searchParams.has(key)) {
                parsedUrl.searchParams.set(key, '***REDACTED***');
            }
        }
        return parsedUrl.pathname + parsedUrl.search;
    } catch {
        return String(rawUrl).replace(/([?&])(key|api_key|apikey|token|password|secret)=([^&]*)/gi, '$1$2=***REDACTED***');
    }
}

export function setBasicSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
}

export function isApiKeyProtectedPath(pathname) {
    if (!pathname) return false;
    return pathname.startsWith('/v1/')
        || pathname.startsWith('/cc/v1/')
        || pathname === '/stats';
}

export function shouldServeStaticUiPath(pathname) {
    return pathname.startsWith('/static/')
        || pathname.startsWith('/assets/')
        || pathname.startsWith('/static-site/')
        || pathname === '/'
        || pathname === '/favicon.ico'
        || pathname === '/index.html'
        || pathname === '/login'
        || pathname.startsWith('/login/')
        || pathname === '/login.html'
        || pathname.startsWith('/app/')
        || pathname.startsWith('/_next/')
        || pathname.startsWith('/dashboard')
        || pathname.endsWith('.png')
        || pathname.endsWith('.jpg')
        || pathname.endsWith('.svg');
}

export function normalizeProviderRequestPath(pathname) {
    const pathSegments = pathname.split('/').filter((segment) => segment.length > 0);
    let normalizedPath = pathname;
    let isKiroOAuthRequest = false;

    if (pathSegments.length > 0) {
        const firstSegment = pathSegments[0];
        isKiroOAuthRequest = firstSegment === MODEL_PROVIDER.KIRO_API;

        if (isKiroOAuthRequest) {
            pathSegments.shift();
            normalizedPath = '/' + pathSegments.join('/');
        }
    }

    return {
        path: normalizedPath,
        isKiroOAuthRequest
    };
}

export function shouldAttemptApiHandling(method, pathname) {
    if (method !== 'POST') {
        return false;
    }

    return pathname === '/v1/messages'
        || pathname === '/cc/v1/messages'
        || pathname === '/v1/stream';
}
