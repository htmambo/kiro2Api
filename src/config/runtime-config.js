const BOOLEAN_KEYS = new Set([
    'CRON_REFRESH_TOKEN',
    'ENABLE_THINKING_BY_DEFAULT',
    'USE_SQLITE_POOL',
    'OPEN_SERVER_URL',
    'CORS_ALLOW_CREDENTIALS'
]);

const INTEGER_KEYS = new Set([
    'SERVER_PORT',
    'REQUEST_MAX_RETRIES',
    'REQUEST_BASE_DELAY',
    'REQUEST_RATE_LIMIT_WINDOW_MS',
    'REQUEST_RATE_LIMIT_MAX_REQUESTS',
    'REQUEST_MAX_BODY_BYTES',
    'KIRO_REQUEST_TIMEOUT_MS',
    'KIRO_STREAM_TIMEOUT_MS',
    'CRON_NEAR_MINUTES',
    'MAX_ERROR_COUNT',
    'HEALTH_CHECK_CONCURRENCY',
    'USAGE_QUERY_CONCURRENCY'
]);

const LIST_KEYS = new Set([
    'MODEL_PROVIDER',
    'REQUEST_RATE_LIMIT_WHITELIST_PATHS',
    'REQUEST_RATE_LIMIT_TRUSTED_PROXIES',
    'CORS_ALLOWED_ORIGINS',
    'CORS_ALLOWED_HEADERS',
    'CORS_ALLOWED_METHODS'
]);

const SUPPORTED_ENV_KEYS = [
    'REQUIRED_API_KEY',
    'SERVER_PORT',
    'HOST',
    'MODEL_PROVIDER',
    'ACCOUNT_POOL_FILE_PATH',
    'KIRO_OAUTH_CREDS_BASE64',
    'KIRO_OAUTH_CREDS_FILE_PATH',
    'SYSTEM_PROMPT_FILE_PATH',
    'SYSTEM_PROMPT_MODE',
    'PROMPT_LOG_BASE_NAME',
    'PROMPT_LOG_MODE',
    'REQUEST_MAX_RETRIES',
    'REQUEST_BASE_DELAY',
    'REQUEST_RATE_LIMIT_WINDOW_MS',
    'REQUEST_RATE_LIMIT_MAX_REQUESTS',
    'REQUEST_RATE_LIMIT_WHITELIST_PATHS',
    'REQUEST_RATE_LIMIT_TRUSTED_PROXIES',
    'REQUEST_MAX_BODY_BYTES',
    'KIRO_REQUEST_TIMEOUT_MS',
    'KIRO_STREAM_TIMEOUT_MS',
    'CRON_NEAR_MINUTES',
    'CRON_REFRESH_TOKEN',
    'MAX_ERROR_COUNT',
    'ENABLE_THINKING_BY_DEFAULT',
    'USE_SQLITE_POOL',
    'SQLITE_DB_PATH',
    'HEALTH_CHECK_CONCURRENCY',
    'USAGE_QUERY_CONCURRENCY',
    'OPEN_SERVER_URL',
    'CORS_ALLOWED_ORIGINS',
    'CORS_ALLOWED_HEADERS',
    'CORS_ALLOWED_METHODS',
    'CORS_ALLOW_CREDENTIALS'
];

const KNOWN_WEAK_API_KEYS = new Set([
    '',
    '123456',
    'password',
    'admin',
    'your-secret-key-here',
    'change-me',
    'changeme'
]);

function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;

    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return undefined;
}

function parseInteger(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}

export function parseStringList(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item).trim())
            .filter(Boolean);
    }

    if (typeof value !== 'string') {
        return [];
    }

    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

export function isWeakApiKey(value) {
    if (typeof value !== 'string') {
        return true;
    }

    return KNOWN_WEAK_API_KEYS.has(value.trim().toLowerCase());
}

export function applyEnvironmentOverrides(config, env, logger) {
    const nextConfig = { ...config };

    for (const key of SUPPORTED_ENV_KEYS) {
        const envValue = env[key];
        if (envValue === undefined || envValue === null || envValue === '') {
            continue;
        }

        if (BOOLEAN_KEYS.has(key)) {
            const parsedBoolean = parseBoolean(envValue);
            if (parsedBoolean === undefined) {
                logger.warn(`Ignoring invalid boolean environment override for ${key}: ${envValue}`);
                continue;
            }
            nextConfig[key] = parsedBoolean;
            continue;
        }

        if (INTEGER_KEYS.has(key)) {
            const parsedInteger = parseInteger(envValue);
            if (parsedInteger === undefined) {
                logger.warn(`Ignoring invalid integer environment override for ${key}: ${envValue}`);
                continue;
            }
            nextConfig[key] = parsedInteger;
            continue;
        }

        if (LIST_KEYS.has(key)) {
            nextConfig[key] = parseStringList(envValue);
            continue;
        }

        nextConfig[key] = envValue;
    }

    return nextConfig;
}

function normalizePositiveInteger(value, fallback, fieldName, logger, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = parseInteger(value);
    if (parsed === undefined || parsed < min || parsed > max) {
        logger.warn(`Invalid ${fieldName}: ${value}. Falling back to ${fallback}.`);
        return fallback;
    }
    return parsed;
}

export function normalizeAndValidateConfig(config, logger) {
    const normalized = { ...config };

    normalized.REQUIRED_API_KEY = typeof normalized.REQUIRED_API_KEY === 'string'
        ? normalized.REQUIRED_API_KEY.trim()
        : '';
    normalized.HOST = typeof normalized.HOST === 'string' && normalized.HOST.trim()
        ? normalized.HOST.trim()
        : '127.0.0.1';

    normalized.SERVER_PORT = normalizePositiveInteger(
        normalized.SERVER_PORT,
        8088,
        'SERVER_PORT',
        logger,
        { max: 65535 }
    );

    normalized.REQUEST_MAX_RETRIES = normalizePositiveInteger(normalized.REQUEST_MAX_RETRIES, 8, 'REQUEST_MAX_RETRIES', logger);
    normalized.REQUEST_BASE_DELAY = normalizePositiveInteger(normalized.REQUEST_BASE_DELAY, 3000, 'REQUEST_BASE_DELAY', logger);
    normalized.REQUEST_RATE_LIMIT_WINDOW_MS = normalizePositiveInteger(normalized.REQUEST_RATE_LIMIT_WINDOW_MS, 60000, 'REQUEST_RATE_LIMIT_WINDOW_MS', logger);
    normalized.REQUEST_RATE_LIMIT_MAX_REQUESTS = normalizePositiveInteger(normalized.REQUEST_RATE_LIMIT_MAX_REQUESTS, 60, 'REQUEST_RATE_LIMIT_MAX_REQUESTS', logger);
    normalized.REQUEST_MAX_BODY_BYTES = normalizePositiveInteger(normalized.REQUEST_MAX_BODY_BYTES, 10 * 1024 * 1024, 'REQUEST_MAX_BODY_BYTES', logger);
    normalized.KIRO_REQUEST_TIMEOUT_MS = normalizePositiveInteger(normalized.KIRO_REQUEST_TIMEOUT_MS, 120000, 'KIRO_REQUEST_TIMEOUT_MS', logger);
    normalized.KIRO_STREAM_TIMEOUT_MS = normalizePositiveInteger(normalized.KIRO_STREAM_TIMEOUT_MS, 180000, 'KIRO_STREAM_TIMEOUT_MS', logger);
    normalized.CRON_NEAR_MINUTES = normalizePositiveInteger(normalized.CRON_NEAR_MINUTES, 15, 'CRON_NEAR_MINUTES', logger);
    normalized.MAX_ERROR_COUNT = normalizePositiveInteger(normalized.MAX_ERROR_COUNT, 5, 'MAX_ERROR_COUNT', logger);
    normalized.HEALTH_CHECK_CONCURRENCY = normalizePositiveInteger(normalized.HEALTH_CHECK_CONCURRENCY, 5, 'HEALTH_CHECK_CONCURRENCY', logger);
    normalized.USAGE_QUERY_CONCURRENCY = normalizePositiveInteger(normalized.USAGE_QUERY_CONCURRENCY, 10, 'USAGE_QUERY_CONCURRENCY', logger);

    normalized.CRON_REFRESH_TOKEN = parseBoolean(normalized.CRON_REFRESH_TOKEN) ?? true;
    normalized.ENABLE_THINKING_BY_DEFAULT = parseBoolean(normalized.ENABLE_THINKING_BY_DEFAULT) ?? true;
    normalized.USE_SQLITE_POOL = parseBoolean(normalized.USE_SQLITE_POOL) ?? false;
    normalized.OPEN_SERVER_URL = parseBoolean(normalized.OPEN_SERVER_URL) ?? false;
    normalized.CORS_ALLOW_CREDENTIALS = parseBoolean(normalized.CORS_ALLOW_CREDENTIALS) ?? false;

    normalized.REQUEST_RATE_LIMIT_WHITELIST_PATHS = parseStringList(normalized.REQUEST_RATE_LIMIT_WHITELIST_PATHS);
    normalized.REQUEST_RATE_LIMIT_TRUSTED_PROXIES = parseStringList(normalized.REQUEST_RATE_LIMIT_TRUSTED_PROXIES);
    normalized.CORS_ALLOWED_ORIGINS = parseStringList(normalized.CORS_ALLOWED_ORIGINS);
    normalized.CORS_ALLOWED_HEADERS = parseStringList(normalized.CORS_ALLOWED_HEADERS);
    normalized.CORS_ALLOWED_METHODS = parseStringList(normalized.CORS_ALLOWED_METHODS);

    if (normalized.REQUEST_RATE_LIMIT_WHITELIST_PATHS.length === 0) {
        normalized.REQUEST_RATE_LIMIT_WHITELIST_PATHS = ['/health', '/api/health', '/favicon.ico', '/public/'];
    }

    if (normalized.CORS_ALLOWED_METHODS.length === 0) {
        normalized.CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
    }

    if (normalized.CORS_ALLOWED_HEADERS.length === 0) {
        normalized.CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'x-api-key', 'Model-Provider'];
    }

    return normalized;
}
