import deepmerge from 'deepmerge';
import { createLogger } from '../lib/logger.js';
import { KiroService } from '../kiro/adapter.js';

const logger = createLogger('services:manager');

let accountPoolManager = null;
let useSQLiteMode = false;

/**
 * Initialize API services and account pool manager
 * @param {Object} config - The server configuration
 * @returns {Promise<Object>} The initialized services
 */
export async function initApiService(config) {
    useSQLiteMode = config.USE_SQLITE_POOL === true;

    const accountPool = config.accountPool || { accounts: [] };

    if (useSQLiteMode) {
        const { SQLiteAccountPoolManager } = await import('../domain/account-pool/sqlite-store.js');
        const { sqliteDB } = await import('../lib/sqlite-db.js');

        accountPoolManager = new SQLiteAccountPoolManager({
            globalConfig: config,
            modelProvider: config.MODEL_PROVIDER,
            maxErrorCount: config.MAX_ERROR_COUNT ?? 3,
            dbPath: config.SQLITE_DB_PATH || 'data/kiro2api.db',
            healthCheckConcurrency: config.HEALTH_CHECK_CONCURRENCY ?? 5,
            usageQueryConcurrency: config.USAGE_QUERY_CONCURRENCY ?? 10
        });

        if (Array.isArray(accountPool.accounts) && accountPool.accounts.length > 0) {
            for (const acc of accountPool.accounts) {
                sqliteDB.upsertAccount(acc);
            }
        }
    } else {
        const { getAccountPoolManager } = await import('../domain/account-pool/json-store.js');
        accountPoolManager = getAccountPoolManager({
            accountPool,
            globalConfig: config,
            modelProvider: config.MODEL_PROVIDER,
            maxErrorCount: config.MAX_ERROR_COUNT ?? 3,
            accountPoolFilePath: config.ACCOUNT_POOL_FILE_PATH || 'configs/account_pool.json'
        });
    }

    // Initialize configured service adapters at startup
    // 对于账号池管理的 provider，适配器将按需初始化（按 uuid 维度）
    const providersToInit = new Set();
    if (providersToInit.size === 0) {
        const { ALL_MODEL_PROVIDERS } = await import('../config/manager.js');
        ALL_MODEL_PROVIDERS.forEach((provider) => providersToInit.add(provider));
    }

    for (const provider of providersToInit) {
        try {
            getServiceAdapter({ ...config, MODEL_PROVIDER: provider });
        } catch (error) {
            logger.warn(`Failed to initialize service adapter for ${provider}: ${error.message}`);
        }
    }
    
    return serviceInstances;
}

/**
 * Get API service adapter, selecting an account when pool is enabled
 * @param {Object} config - The current request configuration
 * @param {string} [requestedModel] - Optional. The model name to filter accounts by.
 * @returns {Promise<Object>} The API service adapter
 */
export async function getApiService(config, requestedModel = null) {
    let serviceConfig = config;

    if (accountPoolManager) {
        const selectedAccountConfig = accountPoolManager.selectAccount(requestedModel, { skipUsageCount: true });
        if (selectedAccountConfig) {
            serviceConfig = deepmerge(config, selectedAccountConfig);
            delete serviceConfig.accountPool;
            delete serviceConfig.providerPools;
            config.uuid = serviceConfig.uuid;
            logger.info(`Using pooled account configuration: ${serviceConfig.uuid}${requestedModel ? ` (model: ${requestedModel})` : ''}`);
        } else {
            logger.warn(`No healthy account found${requestedModel ? ` supporting model: ${requestedModel}` : ''}. Falling back to main config.`);
        }
    }

    return getServiceAdapter(serviceConfig);
}

export function getAccountPoolManager() {
    return accountPoolManager;
}



// 用于存储服务适配器单例的映射
export const serviceInstances = {};

// 服务适配器工厂 - 简化为仅支持 Kiro OAuth
export function getServiceAdapter(config) {
    logger.info(`getServiceAdapter, provider: ${config.MODEL_PROVIDER}, uuid: ${config.uuid}`);
    const provider = config.MODEL_PROVIDER;
    const providerKey = config.uuid ? provider + config.uuid : provider;

    if (!serviceInstances[providerKey] || !(serviceInstances[providerKey] instanceof KiroService)) {
        serviceInstances[providerKey] = new KiroService(config);
    } else {
        serviceInstances[providerKey].config = config;
    }
    return serviceInstances[providerKey];
}
