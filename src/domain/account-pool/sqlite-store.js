/**
 * SQLite 版本的账号池管理器
 *
 * 说明：该文件在 T07（SQLite schema 迁移）完成后正式启用。
 *
 * @module domain/account-pool/sqlite-store
 */

import { sqliteDB } from '../../lib/sqlite-db.js';
import { getServiceAdapter } from '../../services/manager.js';
import * as fs from 'fs';
import { generateContent } from '../../kiro/api-client.js';
import { createLogger } from '../../lib/logger.js';

/**
 * SQLite 账号池管理器
 *
 * 提供健康检查、选择账号与状态更新能力。
 */
export class SQLiteAccountPoolManager {
    static DEFAULT_HEALTH_CHECK_MODEL = 'claude-sonnet-4-20250514';

    /**
     * 创建 SQLiteAccountPoolManager
     *
     * @param {Object} [options={}] - 配置项
     */
    constructor(options = {}) {
        this.globalConfig = options.globalConfig || {};
        this.modelProvider = options.modelProvider || this.globalConfig.MODEL_PROVIDER || 'claude-kiro-oauth';
        this.maxErrorCount = options.maxErrorCount ?? 3;
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000;
        this.logLevel = options.logLevel || 'info';
        this.logger = createLogger('services:pools:sqlite');

        // 轮询索引（内存中维护）
        this.roundRobinIndex = {};

        // 初始化数据库（T07 会确保 schema 已迁移到 accounts）
        const dbPath = options.dbPath || this.globalConfig.SQLITE_DB_PATH || 'data/kiro2api.db';
        sqliteDB.init(dbPath);

        this._log('info', `SQLiteAccountPoolManager initialized (maxErrorCount: ${this.maxErrorCount})`);
    }

    /**
     * 按日志级别输出
     *
     * @param {'verbose'|'debug'|'info'|'warn'|'error'} level - 日志级别
     * @param {string} message - 日志内容
     */
    _log(level, message) {
        const levels = { verbose: -1, debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            this.logger[level](message);
        }
    }

    /**
     * 列出账号配置
     *
     * @returns {Array<Object>} 账号配置列表
     */
    listAccounts() {
        return sqliteDB.getAccounts ? sqliteDB.getAccounts().map((a) => a.config) : [];
    }

    /**
     * 选择一个可用账号
     *
     * @param {string|null} [requestedModel=null] - 可选模型过滤
     * @param {Object} [options={}] - 选项
     * @returns {Object|null} 账号配置或 null
     */
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

    /**
     * 标记账号为不健康
     *
     * @param {string} uuid - 账号 UUID
     * @param {Error|string|null} [errorOrMessage=null] - 错误信息
     */
    markAccountUnhealthy(uuid, errorOrMessage = null) {
        if (typeof sqliteDB.markAccountUnhealthy === 'function') {
            sqliteDB.markAccountUnhealthy(uuid, errorOrMessage, { maxErrorCount: this.maxErrorCount });
        }
    }

    /**
     * 标记账号为健康
     *
     * @param {string} uuid - 账号 UUID
     * @param {Object} [options={}] - 额外选项
     */
    markAccountHealthy(uuid, options = {}) {
        if (typeof sqliteDB.markAccountHealthy === 'function') {
            sqliteDB.markAccountHealthy(uuid, options);
        }
    }

    /**
     * 禁用账号
     *
     * @param {string} uuid - 账号 UUID
     */
    disableAccount(uuid) {
        if (typeof sqliteDB.setAccountDisabled === 'function') {
            sqliteDB.setAccountDisabled(uuid, true);
        }
    }

    /**
     * 启用账号
     *
     * @param {string} uuid - 账号 UUID
     */
    enableAccount(uuid) {
        if (typeof sqliteDB.setAccountDisabled === 'function') {
            sqliteDB.setAccountDisabled(uuid, false);
        }
    }

    /**
     * 获取账号池统计信息
     *
     * @returns {Object|null} 统计信息
     */
    getPoolStats() {
        return typeof sqliteDB.getPoolStats === 'function'
            ? sqliteDB.getPoolStats()
            : null;
    }

    /**
     * 执行健康检查
     *
     * @param {boolean} [isInit=false] - 是否为启动时检查
     * @returns {Promise<void>}
     */
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

    /**
     * 构造健康检查请求体（兼容不同 API 形态）
     *
     * @param {string} modelName - 模型名称
     * @returns {Array<Object>} 请求体数组
     */
    _buildHealthCheckRequests(modelName) {
        const baseMessage = { role: 'user', content: 'Hi' };
        return [
            { messages: [baseMessage], model: modelName, max_tokens: 1 },
            { contents: [{ role: 'user', parts: [{ text: baseMessage.content }] }], max_tokens: 1 }
        ];
    }

    /**
     * 执行单个账号的健康检查
     *
     * @param {Object} accountRow - 账号行数据（含 config）
     * @returns {Promise<void>}
     */
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
                    await generateContent(adapter, modelName, req);
                    if (typeof sqliteDB.recordHealthCheck === 'function') {
                        sqliteDB.recordHealthCheck(accountRow.uuid, this.modelProvider, true, modelName, null);
                    }
                    this.markAccountHealthy(accountRow.uuid, { healthCheckModel: modelName });
                    return;
                } catch (error) {
                    // 尝试下一种请求格式
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
