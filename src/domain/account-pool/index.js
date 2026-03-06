/**
 * 账号池领域门面
 *
 * 统一 JSON 与 SQLite 账号池的访问方式，并对外输出领域事件。
 *
 * @module domain/account-pool
 */
import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../lib/logger.js';
import { sqliteDB } from '../../lib/sqlite-db.js';
import { getRedisClient } from '../../lib/redis-client.js';

import { getAccountPoolManager as getJsonAccountPoolManager } from './json-store.js';
import { SQLiteAccountPoolManager } from './sqlite-store.js';

/**
 * 账号池领域事件枚举
 *
 * @readonly
 * @enum {string}
 */
export const ACCOUNT_POOL_DOMAIN_EVENTS = Object.freeze({
    ACCOUNT_ADDED: 'account_added',
    ACCOUNT_UPDATED: 'account_updated',
    ACCOUNT_REMOVED: 'account_removed',
    ACCOUNT_HEALTH_CHANGED: 'account_health_changed'
});

/**
 * 规范化原因描述
 *
 * @param {string|Error|Object|null} reason - 原始原因
 * @returns {string|null} 可读文本
 */
function normalizeReason(reason) {
    if (!reason) return null;
    if (typeof reason === 'string') return reason;
    if (typeof reason === 'object' && reason !== null) {
        return reason.message || String(reason);
    }
    return String(reason);
}

/**
 * 账号池门面
 *
 * 统一 JSON / SQLite 模式的账号池操作，并向上层发送领域事件。
 */
export class AccountPoolFacade extends EventEmitter {
    /**
     * 创建账号池门面
     *
     * @param {Object} [options={}] - 配置项
     * @param {'json'|'sqlite'} [options.mode='json'] - 存储模式
     * @param {Object} [options.manager] - 账号池管理器实例
     * @param {Object} [options.config] - 全局配置
     */
    constructor({ mode = 'json', manager, config } = {}) {
        super();
        this.mode = mode;
        this.manager = manager;
        this.config = config || null;
        this.logger = createLogger('domain:account-pool');
        this.redis = getRedisClient();
        this.cacheEnabled = config?.REDIS_ENABLED === true;
    }

    _cacheKey(accountId) {
        return `account:${accountId}`;
    }

    async _getFromCache(accountId) {
        if (!this.cacheEnabled || !this.redis.isHealthy()) {
            return null;
        }
        try {
            const cached = await this.redis.get(this._cacheKey(accountId));
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (err) {
            this.logger.debug('Cache get error', { accountId, message: err.message });
        }
        return null;
    }

    async _setInCache(accountId, accountData, ttlSeconds = 300) {
        if (!this.cacheEnabled || !this.redis.isHealthy()) {
            return false;
        }
        try {
            await this.redis.set(this._cacheKey(accountId), JSON.stringify(accountData), ttlSeconds);
            return true;
        } catch (err) {
            this.logger.debug('Cache set error', { accountId, message: err.message });
            return false;
        }
    }

    async _invalidateCache(accountId) {
        if (!this.cacheEnabled || !this.redis.isHealthy()) {
            return false;
        }
        try {
            await this.redis.del(this._cacheKey(accountId));
            return true;
        } catch (err) {
            this.logger.debug('Cache invalidate error', { accountId, message: err.message });
            return false;
        }
    }

    /**
     * 基于 services/manager.js 的现有初始化逻辑创建 Facade
     * - USE_SQLITE_POOL=true -> SQLiteAccountPoolManager，并将 config.accountPool.accounts 灌入 sqliteDB
     * - 否则 -> JSON 单例 getAccountPoolManager
     *
     * @param {Object} [config={}] - 全局配置
     * @returns {Promise<AccountPoolFacade>} 创建后的门面实例
     */
    static async createFromConfig(config = {}) {
        const useSQLiteMode = config.USE_SQLITE_POOL === true;
        const accountPool = config.accountPool || { accounts: [] };

        if (useSQLiteMode) {
            const manager = new SQLiteAccountPoolManager({
                globalConfig: config,
                modelProvider: config.MODEL_PROVIDER,
                maxErrorCount: config.MAX_ERROR_COUNT ?? 3,
                dbPath: config.SQLITE_DB_PATH || 'data/kiro2api.db',
                healthCheckConcurrency: config.HEALTH_CHECK_CONCURRENCY ?? 5,
                usageQueryConcurrency: config.USAGE_QUERY_CONCURRENCY ?? 10
            });

            if (Array.isArray(accountPool.accounts) && accountPool.accounts.length > 0) {
                for (const acc of accountPool.accounts) {
                    try {
                        sqliteDB.upsertAccount(acc);
                    } catch (e) {
                        // 保持与现状一致：单条写入失败不影响整体启动
                        // 事件系统阶段会再补充更结构化的错误上报
                    }
                }
            }

            return new AccountPoolFacade({ mode: 'sqlite', manager, config });
        }

        const manager = getJsonAccountPoolManager({
            accountPool,
            globalConfig: config,
            modelProvider: config.MODEL_PROVIDER,
            maxErrorCount: config.MAX_ERROR_COUNT ?? 3,
            accountPoolFilePath: config.ACCOUNT_POOL_FILE_PATH || 'configs/account_pool.json'
        });

        return new AccountPoolFacade({ mode: 'json', manager, config });
    }

    /**
     * 发送领域事件
     *
     * @param {string} type - 事件类型
     * @param {Object} payload - 事件数据
     */
    _emitDomainEvent(type, payload) {
        try {
            this.emit(type, payload);
        } catch (e) {
            this.logger.warn(`Domain event handler threw: ${e.message}`);
        }
    }

    /**
     * 通过账号 ID 获取账号
     *
     * @param {string} accountId - 账号 UUID
     * @returns {Promise<Object|null>} 账号对象或 null
     */
    async _getAccountById(accountId) {
        if (!accountId) return null;

        const cached = await this._getFromCache(accountId);
        if (cached) {
            this.logger.debug('Account cache hit', { accountId });
            return cached;
        }

        let account = null;

        if (this.mode === 'sqlite') {
            if (typeof sqliteDB.getAccountByUuid !== 'function') return null;
            const row = sqliteDB.getAccountByUuid(accountId);
            if (!row) return null;

            const base = (row.config && typeof row.config === 'object') ? row.config : {};
            account = {
                ...base,
                uuid: row.uuid,
                isHealthy: row.isHealthy,
                isDisabled: row.isDisabled,
                errorCount: row.errorCount,
                usageCount: row.usageCount,
                lastUsed: row.lastUsed,
                lastErrorTime: row.lastErrorTime,
                lastErrorMessage: row.lastErrorMessage,
                lastHealthCheckTime: row.lastHealthCheckTime,
                lastHealthCheckModel: row.lastHealthCheckModel,
                cachedEmail: row.cachedEmail,
                cachedUserId: row.cachedUserId,
                notSupportedModels: Array.isArray(row.notSupportedModels)
                    ? row.notSupportedModels
                    : (Array.isArray(base.notSupportedModels) ? base.notSupportedModels : [])
            };
        } else if (this.manager && typeof this.manager.getAccount === 'function') {
            account = this.manager.getAccount(accountId);
        } else if (this.manager && typeof this.manager.listAccounts === 'function') {
            account = this.manager.listAccounts().find((a) => a && a.uuid === accountId) || null;
        }

        if (account) {
            await this._setInCache(accountId, account);
        }

        return account;
    }

    /**
     * 列出账号（支持过滤）
     *
     * @param {Object} [filters={}] - 过滤条件
     * @returns {Array<Object>} 账号列表
     */
    listAccounts(filters = {}) {
        let accounts = [];

        if (this.mode === 'sqlite') {
            const rows = typeof sqliteDB.getAccounts === 'function' ? sqliteDB.getAccounts() : [];
            accounts = rows.map((row) => {
                const base = (row.config && typeof row.config === 'object') ? row.config : {};
                return {
                    ...base,
                    uuid: row.uuid,
                    isHealthy: row.isHealthy,
                    isDisabled: row.isDisabled,
                    errorCount: row.errorCount,
                    usageCount: row.usageCount,
                    lastUsed: row.lastUsed,
                    lastErrorTime: row.lastErrorTime,
                    lastErrorMessage: row.lastErrorMessage,
                    lastHealthCheckTime: row.lastHealthCheckTime,
                    lastHealthCheckModel: row.lastHealthCheckModel,
                    cachedEmail: row.cachedEmail,
                    cachedUserId: row.cachedUserId,
                    notSupportedModels: Array.isArray(row.notSupportedModels)
                        ? row.notSupportedModels
                        : (Array.isArray(base.notSupportedModels) ? base.notSupportedModels : [])
                };
            });
        } else if (this.manager && typeof this.manager.listAccounts === 'function') {
            accounts = this.manager.listAccounts();
        }

        const {
            accountId,
            uuid,
            isHealthy,
            isDisabled,
            status,
            supportsModel
        } = (filters && typeof filters === 'object') ? filters : {};

        const id = accountId || uuid;
        if (id) {
            accounts = accounts.filter((a) => a && a.uuid === id);
        }
        if (typeof isHealthy === 'boolean') {
            accounts = accounts.filter((a) => Boolean(a?.isHealthy) === isHealthy);
        }
        if (typeof isDisabled === 'boolean') {
            accounts = accounts.filter((a) => Boolean(a?.isDisabled) === isDisabled);
        }
        if (status) {
            if (status === 'healthy') {
                accounts = accounts.filter((a) => a?.isHealthy && !a?.isDisabled);
            } else if (status === 'unhealthy') {
                accounts = accounts.filter((a) => a && a.isHealthy === false);
            } else if (status === 'disabled') {
                accounts = accounts.filter((a) => a && a.isDisabled === true);
            }
        }
        if (supportsModel) {
            accounts = accounts.filter((a) => {
                const notSupported = Array.isArray(a?.notSupportedModels) ? a.notSupportedModels : [];
                return !notSupported.includes(supportsModel);
            });
        }

        return accounts;
    }

    /**
     * 添加账号
     *
     * @param {Object} accountData - 账号配置
     * @returns {Object} 新建账号
     */
    addAccount(accountData) {
        if (!accountData || typeof accountData !== 'object') {
            throw new Error('accountData must be an object');
        }

        if (this.mode === 'sqlite') {
            const next = { ...accountData };
            if (!next.uuid) next.uuid = uuidv4();
            if (next.isHealthy === undefined) next.isHealthy = true;
            if (next.isDisabled === undefined) next.isDisabled = false;
            if (!Array.isArray(next.notSupportedModels)) next.notSupportedModels = [];

            sqliteDB.upsertAccount(next);

            const created = this._getAccountById(next.uuid) || next;
            this._emitDomainEvent(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_ADDED, {
                accountId: created.uuid,
                account: created,
                timestamp: new Date().toISOString()
            });
            return created;
        }

        const created = this.manager.addAccount(accountData);
        this._emitDomainEvent(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_ADDED, {
            accountId: created.uuid,
            account: created,
            timestamp: new Date().toISOString()
        });
        return created;
    }

    /**
     * 更新账号
     *
     * @param {string} accountId - 账号 UUID
     * @param {Object} updates - 更新内容
     * @returns {Object|null} 更新后的账号或 null
     */
    updateAccount(accountId, updates) {
        if (!accountId) throw new Error('accountId is required');
        if (!updates || typeof updates !== 'object') throw new Error('updates must be an object');

        const sanitized = { ...updates };
        delete sanitized.uuid;

        if (this.mode === 'sqlite') {
            const existing = typeof sqliteDB.getAccountByUuid === 'function'
                ? sqliteDB.getAccountByUuid(accountId)
                : null;
            if (!existing) return null;

            const base = (existing.config && typeof existing.config === 'object') ? existing.config : {};
            const next = { ...base, ...sanitized, uuid: accountId };
            sqliteDB.upsertAccount(next);

            const updated = this._getAccountById(accountId) || next;
            this._emitDomainEvent(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_UPDATED, {
                accountId,
                updates: sanitized,
                account: updated,
                timestamp: new Date().toISOString()
            });
            return updated;
        }

        const ok = this.manager.updateAccount(accountId, sanitized);
        if (!ok) return null;

        const updated = this._getAccountById(accountId);
        this._emitDomainEvent(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_UPDATED, {
            accountId,
            updates: sanitized,
            account: updated,
            timestamp: new Date().toISOString()
        });
        return updated;
    }

    /**
     * 删除账号
     *
     * @param {string} accountId - 账号 UUID
     * @returns {boolean} 是否成功删除
     */
    removeAccount(accountId) {
        if (!accountId) throw new Error('accountId is required');

        let removed = false;
        if (this.mode === 'sqlite') {
            const result = sqliteDB.deleteAccount(accountId);
            removed = Boolean(result && typeof result.changes === 'number' ? result.changes > 0 : result);
        } else {
            // JSON 模式兼容旧 manager 的 removeAccount 接口
            removed = Boolean(this.manager.removeAccount(accountId));
        }

        if (removed) {
            this._emitDomainEvent(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_REMOVED, {
                accountId,
                timestamp: new Date().toISOString()
            });
        }

        return removed;
    }

    /**
     * 标记账号为健康
     *
     * @param {string} accountId - 账号 UUID
     * @param {Object} [options={}] - 额外选项
     * @returns {boolean} 是否成功标记
     */
    markHealthy(accountId, options = {}) {
        if (!accountId) throw new Error('accountId is required');
        const existing = this._getAccountById(accountId);
        if (!existing) return false;

        if (this.mode === 'sqlite') {
            this.manager.markAccountHealthy(accountId, options);
        } else {
            this.manager.markAccountHealthy(accountId, options);
        }

        const updated = this._getAccountById(accountId) || existing;
        this._emitDomainEvent(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_HEALTH_CHANGED, {
            accountId,
            isHealthy: true,
            account: updated,
            timestamp: new Date().toISOString()
        });
        return true;
    }

    /**
     * 标记账号为不健康
     *
     * @param {string} accountId - 账号 UUID
     * @param {string|Error|Object|null} [reason=null] - 错误原因
     * @returns {boolean} 是否成功标记
     */
    markUnhealthy(accountId, reason = null) {
        if (!accountId) throw new Error('accountId is required');
        const existing = this._getAccountById(accountId);
        if (!existing) return false;

        const normalizedReason = normalizeReason(reason);

        if (this.mode === 'sqlite') {
            this.manager.markAccountUnhealthy(accountId, reason);
        } else {
            this.manager.markAccountUnhealthy(accountId, reason);
        }

        const updated = this._getAccountById(accountId) || existing;
        this._emitDomainEvent(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_HEALTH_CHANGED, {
            accountId,
            isHealthy: false,
            reason: normalizedReason,
            account: updated,
            timestamp: new Date().toISOString()
        });
        return true;
    }
}

export default AccountPoolFacade;
