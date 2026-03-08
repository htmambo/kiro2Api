/**
 * 服务适配器与账号池的统一管理入口
 *
 * 负责初始化 provider 适配器、选择账号池配置并提供单例服务实例，
 * 确保请求侧只面对一致的服务获取方式。
 *
 * @module manager
 */

import deepmerge from 'deepmerge';
import { createLogger } from '../lib/logger.js';
import { KiroService } from '../kiro/adapter.js';

const logger = createLogger('services:manager');

let accountPoolManager = null;
let useSQLiteMode = false;

/**
 * 初始化 API 服务与账号池管理器
 *
 * 需要提前初始化 provider 适配器，才能在运行时快速路由请求，
 * 并在启动阶段尽早暴露配置问题。
 *
 * 注意：此函数会初始化全局单例 accountPoolManager 和 serviceInstances，
 * 具有副作用，应在服务器启动时调用一次。
 *
 * @param {Object} config - 服务器配置
 * @returns {Promise<Record<string, KiroService>>} 已初始化的服务实例映射表
 */
export async function initApiService(config) {
    useSQLiteMode = config.USE_SQLITE_POOL === true;

    const accountPool = config.accountPool || { accounts: [] };

    if (useSQLiteMode) {
        // SQLite 模式适合多实例/持久化场景，避免仅依赖本地 JSON 文件
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
                // 通过 upsert 迁移/更新账号数据，避免重复导入或覆盖失败
                sqliteDB.upsertAccount(acc);
            }
        }
    } else {
        // JSON 模式适合单机/轻量部署，配置可读性更高
        const { getAccountPoolManager } = await import('../domain/account-pool/json-store.js');
        accountPoolManager = getAccountPoolManager({
            accountPool,
            globalConfig: config,
            modelProvider: config.MODEL_PROVIDER,
            maxErrorCount: config.MAX_ERROR_COUNT ?? 3,
            accountPoolFilePath: config.ACCOUNT_POOL_FILE_PATH || 'configs/account_pool.json'
        });
    }

    // 启动阶段预初始化已配置的 provider 适配器，以尽早发现配置问题
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
            logger.warn(`Failed to initialize service adapter for ${provider}: ${error.message}`);
        }
    }
    
    return serviceInstances;
}

/**
 * 获取 API 服务适配器，并在启用账号池时选择具体账号
 *
 * 账号池会优先选择健康账号（基于错误计数和健康检查结果）；
 * 若无可用账号则降级回主配置，以保证服务仍可响应并避免全量失败。
 *
 * @param {Object} config - 当前请求配置
 * @param {string} [requestedModel] - 可选的模型过滤条件
 * @returns {Promise<{service: KiroService, resolvedConfig: Object}>} 服务实例与解析后的请求配置
 */
export async function getApiService(config, requestedModel = null) {
    let serviceConfig = { ...config };

    if (accountPoolManager) {
        const selectedAccountConfig = accountPoolManager.selectAccount(requestedModel, { skipUsageCount: true });
        if (selectedAccountConfig) {
            serviceConfig = deepmerge(config, selectedAccountConfig);
            // 删除池配置字段，避免被下游日志或适配器重复持有，减少敏感/冗余数据
            // 注意：仅移除合并后的 serviceConfig 字段，避免修改调用方传入的 request config
            delete serviceConfig.accountPool;
            delete serviceConfig.providerPools;
            logger.info(`Using pooled account configuration: ${serviceConfig.uuid}${requestedModel ? ` (model: ${requestedModel})` : ''}`);
        } else {
            logger.warn(`No healthy account found${requestedModel ? ` supporting model: ${requestedModel}` : ''}. Falling back to main config.`);
        }
    }

    return {
        service: getServiceAdapter(serviceConfig),
        resolvedConfig: serviceConfig
    };
}

/**
 * 获取当前账号池管理器实例
 *
 * @returns {import('../domain/account-pool/sqlite-store.js').SQLiteAccountPoolManager|import('../domain/account-pool/json-store.js').AccountPoolManager|null} 账号池管理器或 null
 */
export function getAccountPoolManager() {
    return accountPoolManager;
}



// 用于存储服务适配器单例的映射
export const serviceInstances = {};

/**
 * 获取或创建服务适配器实例
 *
 * 采用单例是为了复用连接与缓存，避免每个请求重复创建实例带来的开销。
 *
 * @param {Object} config - 请求配置
 * @returns {KiroService} 服务适配器
 */
export function getServiceAdapter(config) {
    logger.info(`getServiceAdapter, provider: ${config.MODEL_PROVIDER}, uuid: ${config.uuid}`);
    const provider = config.MODEL_PROVIDER;
    const providerKey = config.uuid ? provider + config.uuid : provider;

    if (!serviceInstances[providerKey] || !(serviceInstances[providerKey] instanceof KiroService)) {
        serviceInstances[providerKey] = new KiroService(config);
    } else {
        serviceInstances[providerKey].applyRuntimeConfig(config);
    }
    return serviceInstances[providerKey];
}
