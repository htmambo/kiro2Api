/**
 * SQLite 版本的账号池管理器
 * 说明：该文件在 T07（SQLite schema 迁移）完成后正式启用。
 */

import { sqliteDB } from './sqlite-db.js';
import { getServiceAdapter } from './core/claude-kiro.js';
import * as fs from 'fs';

export class SQLiteAccountPoolManager {
    static DEFAULT_HEALTH_CHECK_MODEL = 'claude-sonnet-4-20250514';

    constructor(options = {}) {
        this.globalConfig = options.globalConfig || {};
        this.modelProvider = options.modelProvider || this.globalConfig.MODEL_PROVIDER || 'claude-kiro-oauth';
        this.maxErrorCount = options.maxErrorCount ?? 3;
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000;
        this.logLevel = options.logLevel || 'info';

        // 轮询索引（内存中维护）
        this.roundRobinIndex = {};

        // 初始化数据库（T07 会确保 schema 已迁移到 accounts）
        const dbPath = options.dbPath || this.globalConfig.SQLITE_DB_PATH || 'data/provider_pool.db';
        sqliteDB.init(dbPath);

        this._log('info', `SQLiteAccountPoolManager initialized (maxErrorCount: ${this.maxErrorCount})`);
    }

    _log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            const logMethod = level === 'debug' ? 'log' : level;
            console[logMethod](`[SQLiteAccountPoolManager] ${message}`);
        }
    }

    listAccounts() {
        return sqliteDB.getAccounts ? sqliteDB.getAccounts().map((a) => a.config) : [];
    }

    selectAccount(requestedModel = null, options = {}) {
        const healthyAccounts = sqliteDB.getHealthyAccounts
            ? sqliteDB.getHealthyAccounts(requestedModel)
            : [];

        if (healthyAccounts.length === 0) {
            this._log('warn', `No healthy accounts${requestedModel ? ` supporting ${requestedModel}` : ''}`);
            return null;
        }

        const indexKey = requestedModel ? `model:${requestedModel}` : 'default';
        const currentIndex = this.roundRobinIndex[indexKey] || 0;
        const selectedIndex = currentIndex % healthyAccounts.length;
        const selected = healthyAccounts[selectedIndex];

        this.roundRobinIndex[indexKey] = (currentIndex + 1) % healthyAccounts.length;

        if (!options.skipUsageCount && typeof sqliteDB.incrementUsage === 'function') {
            sqliteDB.incrementUsage(selected.uuid);
        }

        return selected.config;
    }

    markAccountUnhealthy(uuid, errorOrMessage = null) {
        if (typeof sqliteDB.markAccountUnhealthy === 'function') {
            sqliteDB.markAccountUnhealthy(uuid, errorOrMessage, { maxErrorCount: this.maxErrorCount });
        }
    }

    markAccountHealthy(uuid, options = {}) {
        if (typeof sqliteDB.markAccountHealthy === 'function') {
            sqliteDB.markAccountHealthy(uuid, options);
        }
    }

    disableAccount(uuid) {
        if (typeof sqliteDB.setAccountDisabled === 'function') {
            sqliteDB.setAccountDisabled(uuid, true);
        }
    }

    enableAccount(uuid) {
        if (typeof sqliteDB.setAccountDisabled === 'function') {
            sqliteDB.setAccountDisabled(uuid, false);
        }
    }

    getPoolStats() {
        return typeof sqliteDB.getPoolStats === 'function'
            ? sqliteDB.getPoolStats()
            : null;
    }

    async performHealthChecks(isInit = false) {
        if (typeof sqliteDB.getAccounts !== 'function') return;

        const accounts = sqliteDB.getAccounts().filter((a) => a && a.uuid);
        const now = Date.now();

        for (const a of accounts) {
            if (a.isDisabled) continue;

            if (!isInit && a.lastHealthCheckTime) {
                const last = Date.parse(a.lastHealthCheckTime);
                if (!Number.isNaN(last) && (now - last) < this.healthCheckInterval) {
                    continue;
                }
            }

            await this._performSingleHealthCheck(a);
        }
    }

    _buildHealthCheckRequests(modelName) {
        const baseMessage = { role: 'user', content: 'Hi' };
        return [
            { messages: [baseMessage], model: modelName, max_tokens: 1 },
            { contents: [{ role: 'user', parts: [{ text: baseMessage.content }] }], max_tokens: 1 }
        ];
    }

    async _performSingleHealthCheck(accountRow) {
        const accountConfig = accountRow.config;
        const modelName = accountConfig.checkModelName || SQLiteAccountPoolManager.DEFAULT_HEALTH_CHECK_MODEL;
        if (!accountConfig.checkHealth) {
            return;
        }

        try {
            const tempConfig = {
                ...this.globalConfig,
                ...accountConfig,
                MODEL_PROVIDER: this.modelProvider
            };
            const adapter = getServiceAdapter(tempConfig);
            const requests = this._buildHealthCheckRequests(modelName);

            for (const req of requests) {
                try {
                    await adapter.generateContent(modelName, req);
                    if (typeof sqliteDB.recordHealthCheck === 'function') {
                        sqliteDB.recordHealthCheck(accountRow.uuid, this.modelProvider, true, modelName, null);
                    }
                    this.markAccountHealthy(accountRow.uuid, { healthCheckModel: modelName });
                    return;
                } catch (error) {
                    // 尝试下一种格式
                }
            }

            if (typeof sqliteDB.recordHealthCheck === 'function') {
                sqliteDB.recordHealthCheck(accountRow.uuid, this.modelProvider, false, modelName, 'Health check failed');
            }
            this.markAccountUnhealthy(accountRow.uuid, 'Health check failed');
        } catch (error) {
            if (typeof sqliteDB.recordHealthCheck === 'function') {
                sqliteDB.recordHealthCheck(accountRow.uuid, this.modelProvider, false, modelName, error.message);
            }
            this.markAccountUnhealthy(accountRow.uuid, error.message);
        }
    }
}
