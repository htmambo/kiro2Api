function appendVaryHeader(res, value) {
    const current = res.getHeader('Vary');
    if (!current) {
        res.setHeader('Vary', value);
        return;
    }

    const currentValues = String(current)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    if (!currentValues.includes(value)) {
        currentValues.push(value);
        res.setHeader('Vary', currentValues.join(', '));
    }
}

function getAllowedOrigins(config) {
    return Array.isArray(config?.CORS_ALLOWED_ORIGINS)
        ? config.CORS_ALLOWED_ORIGINS
        : [];
}

function getAllowedHeaders(config) {
    return Array.isArray(config?.CORS_ALLOWED_HEADERS) && config.CORS_ALLOWED_HEADERS.length > 0
        ? config.CORS_ALLOWED_HEADERS
        : ['Content-Type', 'Authorization', 'x-api-key', 'Model-Provider'];
}

function getAllowedMethods(config) {
    return Array.isArray(config?.CORS_ALLOWED_METHODS) && config.CORS_ALLOWED_METHODS.length > 0
        ? config.CORS_ALLOWED_METHODS
        : ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
}

function isOriginAllowed(origin, config) {
    const allowedOrigins = getAllowedOrigins(config);
    if (!origin || allowedOrigins.length === 0) {
        return false;
    }

    if (allowedOrigins.includes('*')) {
        return true;
    }

    return allowedOrigins.includes(origin);
}

export function applyCorsHeaders(req, res, config) {
    const origin = req.headers.origin;
    if (!origin || !isOriginAllowed(origin, config)) {
        return false;
    }

    const allowCredentials = config?.CORS_ALLOW_CREDENTIALS === true;
    res.setHeader('Access-Control-Allow-Origin', allowCredentials ? origin : (getAllowedOrigins(config).includes('*') ? '*' : origin));
    appendVaryHeader(res, 'Origin');

    if (allowCredentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    return true;
}

export function handleCorsPreflight(req, res, config) {
    if (req.method !== 'OPTIONS') {
        return false;
    }

    const origin = req.headers.origin;
    if (!origin) {
        res.writeHead(204);
        res.end();
        return true;
    }

    if (!isOriginAllowed(origin, config)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: {
                message: 'CORS origin is not allowed.'
            }
        }));
        return true;
    }

    applyCorsHeaders(req, res, config);
    res.setHeader('Access-Control-Allow-Methods', getAllowedMethods(config).join(', '));
    res.setHeader('Access-Control-Allow-Headers', getAllowedHeaders(config).join(', '));
    res.writeHead(204);
    res.end();
    return true;
}
