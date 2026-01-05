/**
 * 环境变量管理模块
 *
 * 统一管理所有环境变量，提供类型转换、验证和默认值
 * 在应用启动时自动验证，确保配置正确
 */

import path from 'path';
import dotenv from 'dotenv';

// 加载 .env 文件
const DOTENV_PATH = process.env.KIRO_DOTENV_PATH || path.join(process.cwd(), '.env');
const dotenvResult = dotenv.config({ path: DOTENV_PATH });
if (dotenvResult.error && dotenvResult.error.code !== 'ENOENT') {
    console.warn(`[Env] Failed to load ${DOTENV_PATH}: ${dotenvResult.error.message}`);
}

// 记录哪些环境变量实际存在（用于判断是否需要覆盖配置文件）
const envPresence = {};
const validationFailures = [];

/**
 * 跟踪环境变量是否存在
 */
function track(key) {
    const hasKey = Object.prototype.hasOwnProperty.call(process.env, key);
    envPresence[key] = hasKey;
    return hasKey ? process.env[key] : undefined;
}

/**
 * 解析枚举类型
 */
function parseEnum(key, rawValue, defaultValue, allowed) {
    if (rawValue == null) {
        return defaultValue;
    }
    const normalized = rawValue.trim().toLowerCase();
    const match = allowed.find((option) => option.toLowerCase() === normalized);
    if (!match) {
        validationFailures.push(`${key} must be one of ${allowed.join(', ')}, got '${rawValue}'`);
        return defaultValue;
    }
    return match;
}

/**
 * 解析正整数
 */
function parsePositiveInt(key, rawValue, defaultValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (rawValue == null) {
        return defaultValue;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed !== Math.trunc(parsed)) {
        validationFailures.push(`${key} must be an integer, got '${rawValue}'`);
        return defaultValue;
    }
    if (parsed < min) {
        validationFailures.push(`${key} must be >= ${min}, got '${rawValue}'`);
        return defaultValue;
    }
    if (parsed > max) {
        validationFailures.push(`${key} must be <= ${max}, got '${rawValue}'`);
        return defaultValue;
    }
    return Math.trunc(parsed);
}

/**
 * 解析布尔值
 */
function parseBoolean(key, rawValue, defaultValue) {
    if (rawValue == null) {
        return defaultValue;
    }
    const normalized = rawValue.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    validationFailures.push(`${key} must be a boolean (true/false), got '${rawValue}'`);
    return defaultValue;
}

/**
 * 解析字符串
 */
function parseString(key, rawValue, defaultValue = '') {
    if (rawValue == null) {
        return defaultValue;
    }
    return rawValue.trim();
}

// 解析所有环境变量
const nodeEnv = parseEnum('NODE_ENV', track('NODE_ENV'), 'production', ['development', 'production', 'test']);
const accountPoolMode = parseEnum('ACCOUNT_POOL_MODE', track('ACCOUNT_POOL_MODE'), 'legacy', ['legacy', 'account']);
const masterPort = parsePositiveInt('MASTER_PORT', track('MASTER_PORT'), 3100, { min: 1, max: 65535 });
const requestTimeoutMs = parsePositiveInt('KIRO_REQUEST_TIMEOUT_MS', track('KIRO_REQUEST_TIMEOUT_MS'), 120000, { min: 1000, max: 600000 });
const streamTimeoutMs = parsePositiveInt('KIRO_STREAM_TIMEOUT_MS', track('KIRO_STREAM_TIMEOUT_MS'), 180000, { min: 1000, max: 600000 });
const webSearchEngine = parseEnum('WEB_SEARCH_ENGINE', track('WEB_SEARCH_ENGINE'), 'duckduckgo', ['duckduckgo', 'bing']);
const bingApiKey = parseString('BING_API_KEY', track('BING_API_KEY'));
const webSearchMaxResults = parsePositiveInt('WEB_SEARCH_MAX_RESULTS', track('WEB_SEARCH_MAX_RESULTS'), 5, { min: 1, max: 20 });
const isWorkerProcess = parseBoolean('IS_WORKER_PROCESS', track('IS_WORKER_PROCESS'), false);

/**
 * 环境变量配置对象
 */
export const ENV = {
    nodeEnv,
    isDevelopment: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    accountPoolMode,
    masterPort,
    requestTimeoutMs,
    streamTimeoutMs,
    webSearchEngine,
    bingApiKey,
    webSearchMaxResults,
    isWorkerProcess
};

/**
 * 记录哪些配置项来自环境变量（用于判断是否覆盖配置文件）
 */
export const ENV_OVERRIDES = {
    accountPoolMode: envPresence.ACCOUNT_POOL_MODE,
    requestTimeoutMs: envPresence.KIRO_REQUEST_TIMEOUT_MS,
    streamTimeoutMs: envPresence.KIRO_STREAM_TIMEOUT_MS,
    masterPort: envPresence.MASTER_PORT,
    webSearchEngine: envPresence.WEB_SEARCH_ENGINE,
    bingApiKey: envPresence.BING_API_KEY,
    webSearchMaxResults: envPresence.WEB_SEARCH_MAX_RESULTS
};

/**
 * 验证环境变量配置
 * 在模块加载时自动执行，确保配置正确
 */
export function validateEnv() {
    const errors = [...validationFailures];

    // 业务规则验证
    if (ENV.webSearchEngine === 'bing' && !ENV.bingApiKey) {
        errors.push('BING_API_KEY is required when WEB_SEARCH_ENGINE=bing');
    }

    if (errors.length > 0) {
        const error = new Error(`[Env Validation] ${errors.join(' | ')}`);
        error.details = errors;
        throw error;
    }

    return true;
}

// 启动时验证
validateEnv();

console.log(`[Env] Loaded environment: ${ENV.nodeEnv}`);
console.log(`[Env] Account pool mode: ${ENV.accountPoolMode}`);
console.log(`[Env] Master port: ${ENV.masterPort}`);
console.log(`[Env] Web search engine: ${ENV.webSearchEngine}`);
