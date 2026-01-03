import deepmerge from 'deepmerge';
import { getServiceAdapter, serviceInstances } from '../kiro/claude-kiro.js';

let accountPoolManager = null;
let useSQLiteMode = false;
let accountPoolMode = 'legacy';

function resolveAccountPoolMode(mode) {
    // 彻底移除 provider 层后，legacy 仅作为兼容别名存在
    if (mode === 'legacy') return 'account';
    return mode || 'account';
}

/**
 * Initialize API services and account pool manager
 * @param {Object} config - The server configuration
 * @returns {Promise<Object>} The initialized services
 */
export async function initApiService(config) {
    accountPoolMode = config.ACCOUNT_POOL_MODE || process.env.ACCOUNT_POOL_MODE || 'legacy';
    const effectiveMode = resolveAccountPoolMode(accountPoolMode);
    console.log(`[Initialization] ACCOUNT_POOL_MODE = ${accountPoolMode} (effective: ${effectiveMode})`);

    useSQLiteMode = config.USE_SQLITE_POOL === true;

    const accountPool = config.accountPool || { accounts: [] };

    if (effectiveMode !== 'account') {
        console.warn(`[Initialization] Unsupported ACCOUNT_POOL_MODE=${effectiveMode}, falling back to account mode`);
    }

    if (useSQLiteMode) {
        const { SQLiteAccountPoolManager } = await import('./pools/sqlite-account-pool-manager.js');
        const { sqliteDB } = await import('./storage/sqlite-db.js');

        accountPoolManager = new SQLiteAccountPoolManager({
            globalConfig: config,
            modelProvider: config.MODEL_PROVIDER,
            maxErrorCount: config.MAX_ERROR_COUNT ?? 3,
            dbPath: config.SQLITE_DB_PATH || 'data/provider_pool.db',
            healthCheckConcurrency: config.HEALTH_CHECK_CONCURRENCY ?? 5,
            usageQueryConcurrency: config.USAGE_QUERY_CONCURRENCY ?? 10
        });

        if (Array.isArray(accountPool.accounts) && accountPool.accounts.length > 0) {
            for (const acc of accountPool.accounts) {
                sqliteDB.upsertAccount(acc);
            }
        }
    } else {
        const { getAccountPoolManager } = await import('./pools/account-pool-manager.js');
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
    if (Array.isArray(config.DEFAULT_MODEL_PROVIDERS)) {
        config.DEFAULT_MODEL_PROVIDERS.forEach((provider) => providersToInit.add(provider));
    }
    if (providersToInit.size === 0) {
        const { ALL_MODEL_PROVIDERS } = await import('../config/manager.js');
        ALL_MODEL_PROVIDERS.forEach((provider) => providersToInit.add(provider));
    }

    for (const provider of providersToInit) {
        try {
            getServiceAdapter({ ...config, MODEL_PROVIDER: provider });
        } catch (error) {
            console.warn(`[Initialization Warning] Failed to initialize service adapter for ${provider}: ${error.message}`);
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
            console.log(`[API Service] Using pooled account configuration: ${serviceConfig.uuid}${requestedModel ? ` (model: ${requestedModel})` : ''}`);
        } else {
            console.warn(`[API Service] No healthy account found${requestedModel ? ` supporting model: ${requestedModel}` : ''}. Falling back to main config.`);
        }
    }

    return getServiceAdapter(serviceConfig);
}

export function getAccountPoolManager() {
    return accountPoolManager;
}

export function getActivePoolManager() {
    return accountPoolManager;
}

export function getAccountPoolMode() {
    return accountPoolMode;
}

export function isSQLiteMode() {
    return useSQLiteMode;
}

