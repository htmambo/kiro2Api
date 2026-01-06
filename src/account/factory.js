/**
 * AccountStore Factory - 账号存储工厂
 *
 * 该模块提供工厂函数，根据配置创建合适的账号存储实例。
 * 支持 JSON 文件和 SQLite 数据库两种存储方式。
 *
 * 设计模式：
 * - 工厂模式：封装对象创建逻辑
 * - 单例模式：相同配置的请求返回缓存的实例
 *
 * @module account/factory
 */

import { JSONAccountStore } from './json.js';
import { SQLiteAccountStore } from './sqlite.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('account:factory');

/**
 * 存储实例缓存
 *
 * 键为配置字符串，值为存储实例。
 * 相同配置的请求会返回缓存的实例，避免重复创建。
 *
 * @type {Map<string, Object>}
 * @private
 */
const storeCache = new Map();

/**
 * 生成缓存键
 *
 * 根据配置生成唯一的缓存键。
 *
 * @param {Object} config - 配置对象
 * @returns {string} 缓存键
 * @private
 */
function generateCacheKey(config) {
    if (config.USE_SQLITE) {
        return `sqlite:${config.SQLITE_DB_PATH}`;
    } else {
        return `json:${config.ACCOUNT_POOL_FILE_PATH}`;
    }
}

/**
 * 创建账号存储实例
 *
 * 根据配置自动选择 JSON 或 SQLite 存储。
 * 支持单例缓存，相同配置返回同一实例。
 *
 * @param {Object} config - 全局配置对象
 * @param {boolean} [config.USE_SQLITE=false] - 是否使用 SQLite 存储
 * @param {string} [config.ACCOUNT_POOL_FILE_PATH='configs/account_pool.json'] - JSON 文件路径
 * @param {string} [config.SQLITE_DB_PATH='data/account_pool.db'] - SQLite 数据库路径
 * @param {number} [config.SAVE_DEBOUNCE_TIME=1000] - JSON 存储的防抖保存时间（毫秒）
 * @param {boolean} [forceCreate=false] - 是否强制创建新实例（忽略缓存）
 * @returns {Object} 账号存储实例（JSONAccountStore 或 SQLiteAccountStore）
 * @throws {Error} 如果配置无效
 */
export function createAccountStore(config, forceCreate = false) {
    // 参数验证
    if (!config || typeof config !== 'object') {
        throw new Error('createAccountStore: config must be an object');
    }

    // 生成缓存键
    const cacheKey = generateCacheKey(config);

    // 如果不强制创建，且缓存中存在，则返回缓存实例
    if (!forceCreate && storeCache.has(cacheKey)) {
        logger.debug(`Returning cached AccountStore: ${cacheKey}`);
        return storeCache.get(cacheKey);
    }

    let store;

    // 根据配置创建存储实例
    if (config.USE_SQLITE) {
        // SQLite 存储
        const dbPath = config.SQLITE_DB_PATH || 'data/account_pool.db';
        logger.info(`Creating SQLiteAccountStore with dbPath: ${dbPath}`);

        store = new SQLiteAccountStore({
            dbPath
        });
    } else {
        // JSON 存储（默认）
        const filePath = config.ACCOUNT_POOL_FILE_PATH || 'configs/account_pool.json';
        const debounceTime = config.SAVE_DEBOUNCE_TIME || 1000;

        logger.info(`Creating JSONAccountStore with filePath: ${filePath}`);

        store = new JSONAccountStore({
            filePath,
            saveDebounceTime: debounceTime
        });
    }

    // 缓存实例
    storeCache.set(cacheKey, store);

    logger.info(`AccountStore created and cached: ${cacheKey}`);
    return store;
}

/**
 * 清除存储实例缓存
 *
 * 删除所有缓存的存储实例，或者删除指定配置的缓存。
 *
 * @param {Object} [config] - 配置对象（可选，如果不提供则清除所有缓存）
 * @returns {number} 清除的缓存数量
 *
 * @example
 * // 清除所有缓存
 * clearAccountStoreCache();
 *
 * @example
 * // 清除特定配置的缓存
 * clearAccountStoreCache({ USE_SQLITE: true, SQLITE_DB_PATH: './data/accounts.db' });
 */
export function clearAccountStoreCache(config) {
    if (config) {
        // 清除特定配置的缓存
        const cacheKey = generateCacheKey(config);
        const deleted = storeCache.delete(cacheKey);

        if (deleted) {
            logger.info(`Cleared AccountStore cache: ${cacheKey}`);
        }

        return deleted ? 1 : 0;
    } else {
        // 清除所有缓存
        const count = storeCache.size;
        storeCache.clear();

        logger.info(`Cleared all AccountStore caches (${count} items)`);
        return count;
    }
}

/**
 * 获取所有缓存的存储实例
 *
 * @returns {Array<Object>} 缓存的存储实例数组
 *
 * @example
 * const cachedStores = getCachedAccountStores();
 * console.log('Cached stores:', cachedStores.length);
 */
export function getCachedAccountStores() {
    return Array.from(storeCache.values());
}

/**
 * 检查是否使用 SQLite 存储
 *
 * @param {Object} config - 配置对象
 * @returns {boolean} 是否使用 SQLite
 */
export function isSQLiteMode(config) {
    return !!(config && config.USE_SQLITE);
}

/**
 * 获取默认存储类型
 *
 * 根据环境变量或配置返回默认的存储类型。
 *
 * @param {Object} [config] - 配置对象（可选）
 * @returns {string} 存储类型（'sqlite' 或 'json'）
 *
 * @example
 * const type = getDefaultStoreType(config);
 * console.log('Default storage type:', type);
 */
export function getDefaultStoreType(config) {
    if (config && config.USE_SQLITE) {
        return 'sqlite';
    }
    return 'json';
}

export default {
    createAccountStore,
    clearAccountStoreCache,
    getCachedAccountStores,
    isSQLiteMode,
    getDefaultStoreType
};
