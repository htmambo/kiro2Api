import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:usage-cache');
const USAGE_CACHE_FILE = './configs/usage-cache.json';

export async function readUsageCache() {
    try {
        if (existsSync(USAGE_CACHE_FILE)) {
            const content = await fs.readFile(USAGE_CACHE_FILE, 'utf8');
            return JSON.parse(content);
        }
        return null;
    } catch (error) {
        logger.warn('Failed to read usage cache', error);
        return null;
    }
}

export async function writeUsageCache(usageData) {
    try {
        await fs.writeFile(USAGE_CACHE_FILE, JSON.stringify(usageData, null, 2), 'utf8');
        logger.info(`Usage data cached to ${USAGE_CACHE_FILE}`);
    } catch (error) {
        logger.error('Failed to write usage cache', error);
    }
}

export async function readProviderUsageCache(providerType) {
    const cache = await readUsageCache();
    if (cache && cache.providers && cache.providers[providerType]) {
        return {
            ...cache.providers[providerType],
            cachedAt: cache.timestamp,
            fromCache: true
        };
    }
    return null;
}
