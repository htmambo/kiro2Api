/**
 * 请求速率限制器
 *
 * 使用滑动窗口算法实现速率限制，支持：
 * - 基于 IP + API Key 的组合限流
 * - 可信代理的 X-Forwarded-For 支持
 * - 白名单路由（健康检查、静态资源等）
 * - 自动清理过期记录
 * - CIDR 格式的代理配置
 *
 * @module rate-limiter
 */

import crypto from 'crypto';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('api:rate-limiter');

// 默认配置
const DEFAULT_WINDOW_MS = 60000; // 60 秒
const DEFAULT_MAX_REQUESTS = 60; // 每分钟 60 个请求
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // 2 分钟清理一次
const DEFAULT_WHITELIST = ['/health', '/favicon.ico', '/public/'];

// 速率限制记录存储
const records = new Map();
let cleanupTimer = null;

/**
 * 启动定期清理任务
 * 清理超过清理间隔时间未访问的记录，防止内存泄漏
 */
function startCleanup() {
    if (cleanupTimer) return;

    cleanupTimer = setInterval(() => {
        const now = Date.now();
        const expiry = now - CLEANUP_INTERVAL_MS;
        let cleanedCount = 0;

        for (const [key, entry] of records) {
            if (entry.lastSeen < expiry) {
                records.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.info(`[Rate Limiter] Cleaned up ${cleanedCount} expired records. Current size: ${records.size}`);
        }
    }, CLEANUP_INTERVAL_MS);

    // 确保进程退出时清理定时器
    if (cleanupTimer.unref) {
        cleanupTimer.unref();
    }
}

/**
 * 规范化 IP 地址
 * 移除 IPv6 前缀和区域标识符
 *
 * @param {string} address - 原始 IP 地址
 * @returns {string} 规范化后的 IP 地址
 */
function normalizeIp(address) {
    if (!address) return 'unknown';

    let clean = address;

    // 移除 IPv4-mapped IPv6 前缀 (::ffff:)
    if (clean.startsWith('::ffff:')) {
        clean = clean.substring(7);
    }

    // 移除 IPv6 区域标识符 (%)
    const zoneIndex = clean.indexOf('%');
    if (zoneIndex !== -1) {
        clean = clean.substring(0, zoneIndex);
    }

    return clean;
}

/**
 * 解析 CIDR 格式的 IP 范围
 *
 * @param {string} cidr - CIDR 格式字符串 (例如: "192.168.1.0/24")
 * @returns {Object|null} 包含 subnetNum 和 maskNum 的对象，解析失败返回 null
 */
function parseCidr(cidr) {
    const parts = cidr.split('/');
    if (parts.length !== 2) return null;

    const mask = Number(parts[1]);
    if (Number.isNaN(mask) || mask < 0 || mask > 32) return null;

    const octets = parts[0].split('.').map(Number);
    if (octets.length !== 4 || octets.some(Number.isNaN)) return null;

    // 将 IP 地址转换为 32 位整数
    const ipNum = octets.reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0;

    // 计算子网掩码
    const maskNum = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;

    // 应用掩码到 IP 地址，确保子网地址的主机位为 0
    // 这样即使用户输入 "10.0.0.5/24"，也会被规范化为 "10.0.0.0/24"
    const subnetNum = (ipNum & maskNum) >>> 0;

    return { subnetNum, maskNum };
}

/**
 * 将 IPv4 地址转换为 32 位整数
 *
 * @param {string} ip - IPv4 地址字符串
 * @returns {number|null} 32 位整数，转换失败返回 null
 */
function ipToNumber(ip) {
    const octets = ip.split('.');
    if (octets.length !== 4) return null;

    const numbers = octets.map(Number);
    if (numbers.some(Number.isNaN)) return null;

    return numbers.reduce((acc, octet) => (acc << 8) + octet, 0) >>> 0;
}

/**
 * 检查 IP 是否在可信代理列表中
 * 支持精确匹配和 CIDR 范围匹配（仅 IPv4）
 * IPv6 地址仅支持精确匹配
 *
 * @param {string} remoteIp - 远程 IP 地址
 * @param {Array<string>} trustedList - 可信代理列表
 * @returns {boolean} 是否为可信代理
 */
function isTrustedProxy(remoteIp, trustedList = []) {
    if (!remoteIp || trustedList.length === 0) return false;

    const normalized = normalizeIp(remoteIp);

    for (const entry of trustedList) {
        if (!entry) continue;

        // CIDR 格式匹配（仅 IPv4）
        if (entry.includes('/')) {
            // 检查是否为 IPv4 地址
            if (normalized.includes(':')) {
                // IPv6 地址不支持 CIDR 匹配，跳过
                continue;
            }

            const cidr = parseCidr(entry);
            const ipNum = ipToNumber(normalized);

            if (cidr && ipNum !== null) {
                // 检查 IP 是否在 CIDR 范围内
                if ((ipNum & cidr.maskNum) === cidr.subnetNum) {
                    return true;
                }
            }
        }
        // 精确匹配（支持 IPv4 和 IPv6）
        else if (normalizeIp(entry) === normalized) {
            return true;
        }
    }

    return false;
}

/**
 * 解析客户端真实 IP 地址
 * 如果请求来自可信代理，则使用 X-Forwarded-For 头
 *
 * @param {Object} req - 请求对象
 * @param {Object} config - 配置对象
 * @returns {string} 客户端 IP 地址
 */
function resolveClientIp(req, config) {
    const remoteIp = normalizeIp(req.socket?.remoteAddress);
    const trustedProxies = config?.REQUEST_RATE_LIMIT_TRUSTED_PROXIES || [];

    // 如果请求来自可信代理，尝试使用 X-Forwarded-For
    if (isTrustedProxy(remoteIp, trustedProxies)) {
        const xff = req.headers?.['x-forwarded-for'];
        if (xff) {
            // 取第一个 IP（最原始的客户端 IP）
            const forwarded = xff.split(',')[0].trim();
            if (forwarded) {
                return normalizeIp(forwarded);
            }
        }
    }

    return remoteIp;
}

/**
 * 获取 API Key 的指纹（哈希值）
 * 从多个可能的位置提取 API Key 并计算哈希
 *
 * @param {Object} req - 请求对象
 * @returns {string} API Key 的 SHA256 哈希值（前 16 位）或 'anon'
 */
function getApiKeyFingerprint(req) {
    let token = '';

    // 1. 尝试从 Authorization 头获取
    const authHeader = req.headers?.authorization;
    if (authHeader) {
        const parts = authHeader.split(' ');
        token = parts.length > 1 ? parts[1] : parts[0];
    }

    // 2. 尝试从自定义头获取
    if (!token) {
        token = req.headers?.['x-api-key'] || req.headers?.['x-goog-api-key'] || '';
    }

    // 3. 尝试从查询参数获取
    if (!token) {
        try {
            const parsed = new URL(req.url, 'http://127.0.0.1');
            token = parsed.searchParams.get('key') || parsed.searchParams.get('api_key') || '';
        } catch {
            token = '';
        }
    }

    // 如果没有找到 API Key，返回匿名标识
    if (!token) return 'anon';

    // 返回 API Key 的哈希值（前 16 位），避免在内存中存储原始密钥
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/**
 * 检查路径是否在白名单中
 * 白名单中的路由不受速率限制
 *
 * @param {string} path - 请求路径
 * @param {Object} config - 配置对象
 * @returns {boolean} 是否在白名单中
 */
export function isRateLimitWhitelisted(path, config) {
    const whitelist = config?.REQUEST_RATE_LIMIT_WHITELIST_PATHS || DEFAULT_WHITELIST;
    if (!path) return false;

    const normalizedPath = path.toLowerCase();

    return whitelist.some(entry => {
        if (!entry) return false;

        const normalizedEntry = entry.toLowerCase();

        // 如果白名单条目以 / 结尾，则匹配所有以该前缀开头的路径
        if (normalizedEntry.endsWith('/')) {
            return normalizedPath.startsWith(normalizedEntry);
        }

        // 否则精确匹配
        return normalizedPath === normalizedEntry;
    });
}

/**
 * 检查请求是否超过速率限制
 * 使用滑动窗口算法
 *
 * @param {Object} req - 请求对象
 * @param {Object} config - 配置对象
 * @returns {Object} 包含 allowed 和 retryAfterSeconds 的对象
 *
 * @example
 * const result = checkRateLimit(req, config);
 * if (!result.allowed) {
 *   res.setHeader('Retry-After', result.retryAfterSeconds);
 *   res.status(429).json({ error: 'Too many requests' });
 * }
 */
export function checkRateLimit(req, config) {
    // 启动清理任务（仅首次调用时启动）
    startCleanup();

    // 获取配置
    const windowMs = config?.REQUEST_RATE_LIMIT_WINDOW_MS ?? DEFAULT_WINDOW_MS;
    const maxRequests = config?.REQUEST_RATE_LIMIT_MAX_REQUESTS ?? DEFAULT_MAX_REQUESTS;

    const now = Date.now();

    // 构建限流键：IP + API Key 指纹
    const clientIp = resolveClientIp(req, config);
    const keyFingerprint = getApiKeyFingerprint(req);
    const bucketKey = `${clientIp}|${keyFingerprint}`;

    // 获取或创建记录
    const entry = records.get(bucketKey) || { timestamps: [], lastSeen: now };

    // 移除窗口外的时间戳（滑动窗口）
    entry.timestamps = entry.timestamps.filter(ts => ts > now - windowMs);
    entry.lastSeen = now;

    // 检查是否超过限制
    if (entry.timestamps.length >= maxRequests) {
        const oldest = entry.timestamps[0];
        const retryAfterMs = Math.max(0, windowMs - (now - oldest));

        // 保存记录（即使被限流也要记录，以便后续清理）
        records.set(bucketKey, entry);

        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
            windowMs,
            currentCount: entry.timestamps.length,
            maxRequests
        };
    }

    // 记录新的请求时间戳
    entry.timestamps.push(now);
    records.set(bucketKey, entry);

    return {
        allowed: true,
        windowMs,
        currentCount: entry.timestamps.length,
        maxRequests
    };
}

/**
 * 获取速率限制器统计信息
 * 用于监控和调试
 *
 * @returns {Object} 统计信息
 */
export function getRateLimiterStats() {
    const now = Date.now();
    let activeRecords = 0;
    let totalRequests = 0;

    for (const [, entry] of records) {
        if (entry.lastSeen > now - CLEANUP_INTERVAL_MS) {
            activeRecords++;
            totalRequests += entry.timestamps.length;
        }
    }

    return {
        totalRecords: records.size,
        activeRecords,
        totalRequests,
        cleanupIntervalMs: CLEANUP_INTERVAL_MS
    };
}
