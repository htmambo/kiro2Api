import { promises as fs } from 'fs';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:usage-cache');
const USAGE_CACHE_FILE = './configs/usage-cache.json';

/**
 * 读取使用量缓存
 * @returns {Promise<Object|null>} 缓存数据或 null
 */
export async function readUsageCache() {
    try {
        const content = await fs.readFile(USAGE_CACHE_FILE, 'utf8');
        return JSON.parse(content);
    } catch (error) {
        logger.warn('[Usage Cache] Failed to read usage cache', error);
        return null;
    }
}

/**
 * 写入使用量缓存
 * @param {Object} usageData - 使用量数据
 */
export async function writeUsageCache(usageData) {
    try {
        await fs.writeFile(USAGE_CACHE_FILE, JSON.stringify(usageData, null, 2), 'utf8');
        logger.info('[Usage Cache] Usage data cached successfully');
    } catch (error) {
        logger.error('[Usage Cache] Failed to write usage cache', error);
    }
}

/**
 * 读取特定提供商的使用量缓存
 * @param {string} providerType - 提供商类型
 * @returns {Promise<Object|null>} 提供商使用量数据或 null
 */
export async function readProviderUsageCache(providerType) {
    const cache = await readUsageCache();

    if (cache?.providers?.[providerType]) {
        return {
            ...cache.providers[providerType],
            cachedAt: cache.timestamp,
            fromCache: true
        };
    }

    return null;
}
