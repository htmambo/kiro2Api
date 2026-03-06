/**
 * SQLite 数据库管理器
 *
 * v2（账号池）：移除 provider_type，providers 表迁移为 accounts。
 *
 * @module lib/sqlite-db
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from './logger.js';
import { DEFAULT_PROVIDER_TYPE } from '../kiro/constants.js';

const SCHEMA_VERSION = 2;
const logger = createLogger('services:storage:sqlite-db');

/**
 * SQLite 数据库访问封装
 *
 * 负责初始化、迁移、账号池数据读写与统计。
 */
class SQLiteDB {
    /**
     * 创建 SQLiteDB 实例
     */
    constructor() {
        this.db = null;
        this.dbPath = null;
    }

    /**
     * 初始化数据库
     *
     * @param {string} dbPath - 数据库文件路径
     * @returns {Database} 数据库实例
     */
    init(dbPath = 'data/kiro2api.db') {
        if (this.db) {
            if (this.dbPath !== dbPath) {
                logger.warn(
                    `[SQLiteDB] Database already initialized with path: ${this.dbPath}, ignoring new path: ${dbPath}`
                );
            }
            return this.db;
        }

        this.dbPath = dbPath;

        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);

        // 启用 WAL 模式提高并发性能
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('busy_timeout = 5000');

        // 迁移并创建表
        this._migrateIfNeeded();
        
        // 创建性能优化索引
        this._createIndexes();
        this._createTablesV2();

        logger.info(`[SQLiteDB] Database initialized: ${dbPath} (schema v${SCHEMA_VERSION})`);
        return this.db;
    }

    /**
     * 获取数据库连接
     *
     * @returns {Database} 数据库实例
     */
    getDb() {
        if (!this.db) {
            throw new Error('Database not initialized. Call init() first.');
        }
        return this.db;
    }

    /**
     * 关闭数据库连接
     *
     * @returns {void}
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            logger.info('[SQLiteDB] Database connection closed');
        }
    }

    /**
     * 检查表是否存在
     *
     * @param {string} name - 表名
     * @returns {boolean} 是否存在
     */
    _tableExists(name) {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(name);
        return Boolean(row);
    }

    /**
     * 按需执行数据库迁移
     *
     * @returns {void}
     */
    _migrateIfNeeded() {
        const db = this.getDb();
        const currentVersion = db.pragma('user_version', { simple: true }) || 0;
        if (currentVersion >= SCHEMA_VERSION) {
            return;
        }

        // 新库：直接创建 v2
        if (!this._tableExists('providers') && !this._tableExists('accounts')) {
            db.pragma(`user_version = ${SCHEMA_VERSION}`);
            return;
        }

        // 旧库：从 providers/usage_cache/health_check_history 迁移到 accounts 结构
        if (this._tableExists('providers')) {
            const backupPath = `${this.dbPath}.bak-${Date.now()}`;
            fs.copyFileSync(this.dbPath, backupPath);
            logger.info(`[SQLiteDB] Backup created: ${backupPath}`);

            // 校验：只能存在一种 provider_type
            try {
                const distinctTypes = db.prepare(
                    'SELECT COUNT(DISTINCT provider_type) as count FROM providers'
                ).get();
                if (distinctTypes && distinctTypes.count > 1) {
                    throw new Error('Multiple provider types found, cannot migrate to accounts schema');
                }
            } catch (error) {
                logger.error('[SQLiteDB] Migration validation failed:', error);
                throw error;
            }

            db.transaction(() => {
                // accounts 表
                db.exec(`
                    CREATE TABLE IF NOT EXISTS accounts_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        uuid TEXT UNIQUE NOT NULL,
                        config TEXT NOT NULL,
                        is_healthy INTEGER DEFAULT 1,
                        is_disabled INTEGER DEFAULT 0,
                        error_count INTEGER DEFAULT 0,
                        usage_count INTEGER DEFAULT 0,
                        last_used TEXT,
                        last_error_time TEXT,
                        last_error_message TEXT,
                        last_health_check_time TEXT,
                        last_health_check_model TEXT,
                        cached_email TEXT,
                        cached_user_id TEXT,
                        not_supported_models TEXT,
                        created_at TEXT DEFAULT (datetime('now')),
                        updated_at TEXT DEFAULT (datetime('now'))
                    )
                `);

                db.exec(`
                    INSERT INTO accounts_new (
                        id, uuid, config, is_healthy, is_disabled, error_count, usage_count,
                        last_used, last_error_time, last_error_message, last_health_check_time,
                        last_health_check_model, cached_email, cached_user_id, not_supported_models,
                        created_at, updated_at
                    )
                    SELECT
                        id, uuid, config, is_healthy, is_disabled, error_count, usage_count,
                        last_used, last_error_time, last_error_message, last_health_check_time,
                        last_health_check_model, cached_email, cached_user_id, not_supported_models,
                        created_at, updated_at
                    FROM providers
                `);

                db.exec('DROP TABLE providers');
                db.exec('ALTER TABLE accounts_new RENAME TO accounts');

                // usage_cache 表
                if (this._tableExists('usage_cache')) {
                    db.exec(`
                        CREATE TABLE IF NOT EXISTS usage_cache_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            account_uuid TEXT NOT NULL,
                            usage_data TEXT NOT NULL,
                            cached_at TEXT DEFAULT (datetime('now')),
                            expires_at TEXT NOT NULL,
                            UNIQUE(account_uuid)
                        )
                    `);
                    db.exec(`
                        INSERT OR REPLACE INTO usage_cache_new (
                            id, account_uuid, usage_data, cached_at, expires_at
                        )
                        SELECT
                            id, provider_uuid, usage_data, cached_at, expires_at
                        FROM usage_cache
                    `);
                    db.exec('DROP TABLE usage_cache');
                    db.exec('ALTER TABLE usage_cache_new RENAME TO usage_cache');
                }

                // health_check_history 表
                if (this._tableExists('health_check_history')) {
                    db.exec(`
                        CREATE TABLE IF NOT EXISTS health_check_history_new (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            account_uuid TEXT NOT NULL,
                            is_healthy INTEGER NOT NULL,
                            check_model TEXT,
                            error_message TEXT,
                            check_time TEXT DEFAULT (datetime('now'))
                        )
                    `);
                    db.exec(`
                        INSERT INTO health_check_history_new (
                            id, account_uuid, is_healthy, check_model, error_message, check_time
                        )
                        SELECT
                            id, provider_uuid, is_healthy, check_model, error_message, check_time
                        FROM health_check_history
                    `);
                    db.exec('DROP TABLE health_check_history');
                    db.exec('ALTER TABLE health_check_history_new RENAME TO health_check_history');
                }

                // 索引（v2）
                db.exec('DROP INDEX IF EXISTS idx_providers_type');
                db.exec('DROP INDEX IF EXISTS idx_providers_healthy');
                db.exec('DROP INDEX IF EXISTS idx_providers_type_health');
                db.exec('DROP INDEX IF EXISTS idx_usage_cache_type_expires');
                db.exec('DROP INDEX IF EXISTS idx_health_history_uuid');

                db.exec(`
                    CREATE INDEX IF NOT EXISTS idx_accounts_uuid ON accounts(uuid);
                    CREATE INDEX IF NOT EXISTS idx_accounts_healthy ON accounts(is_healthy, is_disabled);
                    CREATE INDEX IF NOT EXISTS idx_usage_cache_expires ON usage_cache(expires_at);
                    CREATE INDEX IF NOT EXISTS idx_health_history_uuid ON health_check_history(account_uuid);
                    CREATE INDEX IF NOT EXISTS idx_health_history_time ON health_check_history(check_time);
                `);

                db.pragma(`user_version = ${SCHEMA_VERSION}`);
            })();

            logger.info('[SQLiteDB] Migration to accounts schema completed');
            return;
        }

        // 兜底：如果已有 accounts 但版本号未设置
        if (this._tableExists('accounts')) {
            db.pragma(`user_version = ${SCHEMA_VERSION}`);
        }
    }

    /**
     * 创建 v2 表结构
     *
     * @returns {void}
     */
    _createTablesV2() {
        const db = this.getDb();

        db.exec(`
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE NOT NULL,
                config TEXT NOT NULL,
                is_healthy INTEGER DEFAULT 1,
                is_disabled INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                usage_count INTEGER DEFAULT 0,
                last_used TEXT,
                last_error_time TEXT,
                last_error_message TEXT,
                last_health_check_time TEXT,
                last_health_check_model TEXT,
                cached_email TEXT,
                cached_user_id TEXT,
                not_supported_models TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS usage_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_uuid TEXT NOT NULL,
                usage_data TEXT NOT NULL,
                cached_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL,
                UNIQUE(account_uuid)
            )
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS health_check_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_uuid TEXT NOT NULL,
                is_healthy INTEGER NOT NULL,
                check_model TEXT,
                error_message TEXT,
                check_time TEXT DEFAULT (datetime('now'))
            )
        `);

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_accounts_uuid ON accounts(uuid);
            CREATE INDEX IF NOT EXISTS idx_accounts_healthy ON accounts(is_healthy, is_disabled);
            CREATE INDEX IF NOT EXISTS idx_accounts_error_count ON accounts(error_count);
            CREATE INDEX IF NOT EXISTS idx_accounts_last_used ON accounts(last_used);
            CREATE INDEX IF NOT EXISTS idx_usage_cache_expires ON usage_cache(expires_at);
            CREATE INDEX IF NOT EXISTS idx_health_history_uuid ON health_check_history(account_uuid);
            CREATE INDEX IF NOT EXISTS idx_health_history_time ON health_check_history(check_time);
        `);

        db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }

    // ==================== Accounts (v2) ====================

    /**
     * 新增或更新账号
     *
     * @param {Object} account - 账号对象
     * @returns {Object} 执行结果
     */
    upsertAccount(account) {
        const db = this.getDb();
        const stmt = db.prepare(`
            INSERT INTO accounts (
                uuid, config, is_healthy, is_disabled,
                error_count, usage_count, last_used, last_error_time,
                last_error_message, last_health_check_time, last_health_check_model,
                cached_email, cached_user_id, not_supported_models, updated_at
            ) VALUES (
                @uuid, @config, @is_healthy, @is_disabled,
                @error_count, @usage_count, @last_used, @last_error_time,
                @last_error_message, @last_health_check_time, @last_health_check_model,
                @cached_email, @cached_user_id, @not_supported_models, datetime('now')
            )
            ON CONFLICT(uuid) DO UPDATE SET
                config = @config,
                is_healthy = @is_healthy,
                is_disabled = @is_disabled,
                error_count = @error_count,
                usage_count = @usage_count,
                last_used = @last_used,
                last_error_time = @last_error_time,
                last_error_message = @last_error_message,
                last_health_check_time = @last_health_check_time,
                last_health_check_model = @last_health_check_model,
                cached_email = @cached_email,
                cached_user_id = @cached_user_id,
                not_supported_models = @not_supported_models,
                updated_at = datetime('now')
        `);

        const configJson = JSON.stringify(account.config || account);
        const notSupported = account.notSupportedModels || account.not_supported_models;

        return stmt.run({
            uuid: account.uuid,
            config: configJson,
            is_healthy: account.isHealthy !== false ? 1 : 0,
            is_disabled: account.isDisabled ? 1 : 0,
            error_count: account.errorCount || 0,
            usage_count: account.usageCount || 0,
            last_used: account.lastUsed || null,
            last_error_time: account.lastErrorTime || null,
            last_error_message: account.lastErrorMessage || null,
            last_health_check_time: account.lastHealthCheckTime || null,
            last_health_check_model: account.lastHealthCheckModel || null,
            cached_email: account.cachedEmail || null,
            cached_user_id: account.cachedUserId || null,
            not_supported_models: Array.isArray(notSupported) ? JSON.stringify(notSupported) : (notSupported || null)
        });
    }

    /**
     * 获取所有账号
     *
     * @returns {Array} 账号数组
     */
    getAccounts() {
        const db = this.getDb();
        return db.prepare('SELECT * FROM accounts').all().map((row) => this._parseAccountRow(row));
    }

    /**
     * 按 UUID 获取账号
     *
     * @param {string} uuid - 账号 UUID
     * @returns {Object|null} 账号对象或 null
     */
    getAccountByUuid(uuid) {
        const db = this.getDb();
        const row = db.prepare('SELECT * FROM accounts WHERE uuid = ?').get(uuid);
        return row ? this._parseAccountRow(row) : null;
    }

    /**
     * 获取健康账号列表（可按模型过滤）
     *
     * @param {string|null} [model=null] - 模型名称
     * @returns {Array} 账号数组
     */
    getHealthyAccounts(model = null) {
        const db = this.getDb();
        let rows;
        if (model) {
            const allHealthy = db.prepare(`
                SELECT * FROM accounts
                WHERE is_healthy = 1
                AND is_disabled = 0
            `).all();
            rows = allHealthy.filter((r) => {
                if (!r.not_supported_models) return true;
                try {
                    const notSupported = JSON.parse(r.not_supported_models);
                    return !notSupported.includes(model);
                } catch {
                    return true;
                }
            });
        } else {
            rows = db.prepare(`
                SELECT * FROM accounts
                WHERE is_healthy = 1
                AND is_disabled = 0
            `).all();
        }
        return rows.map((row) => this._parseAccountRow(row));
    }

    /**
     * 设置账号禁用状态
     *
     * @param {string} uuid - 账号 UUID
     * @param {boolean} disabled - 是否禁用
     * @returns {Object} 执行结果
     */
    setAccountDisabled(uuid, disabled) {
        const db = this.getDb();
        return db.prepare(`
            UPDATE accounts
            SET is_disabled = ?,
                updated_at = datetime('now')
            WHERE uuid = ?
        `).run(disabled ? 1 : 0, uuid);
    }

    /**
     * 标记账号为健康
     *
     * @param {string} uuid - 账号 UUID
     * @param {Object} [options={}] - 额外选项
     * @returns {Object} 执行结果
     */
    markAccountHealthy(uuid, options = {}) {
        const db = this.getDb();
        const {
            resetUsageCount = false,
            healthCheckModel = null,
            userInfo = null
        } = options;

        const fields = [
            'is_healthy = 1',
            'error_count = 0',
            'last_error_time = NULL',
            'last_error_message = NULL',
            "updated_at = datetime('now')"
        ];

        if (resetUsageCount) {
            fields.push('usage_count = 0');
        } else {
            fields.push('usage_count = usage_count + 1');
            fields.push("last_used = datetime('now')");
        }

        if (healthCheckModel) {
            fields.push('last_health_check_model = ?');
        }
        fields.push("last_health_check_time = datetime('now')");

        if (userInfo?.email) {
            fields.push('cached_email = ?');
        }
        if (userInfo?.userId) {
            fields.push('cached_user_id = ?');
        }

        const values = [];
        if (healthCheckModel) values.push(healthCheckModel);
        if (userInfo?.email) values.push(userInfo.email);
        if (userInfo?.userId) values.push(userInfo.userId);
        values.push(uuid);

        return db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE uuid = ?`).run(...values);
    }

    /**
     * 标记账号为不健康
     *
     * @param {string} uuid - 账号 UUID
     * @param {Error|string|null} [errorOrMessage=null] - 错误信息
     * @param {Object} [options={}] - 额外选项
     * @returns {Object|undefined} 执行结果
     */
    markAccountUnhealthy(uuid, errorOrMessage = null, options = {}) {
        const db = this.getDb();
        const maxErrorCount = options.maxErrorCount ?? 3;
        const nowIso = new Date().toISOString();
        const errorMessage = typeof errorOrMessage === 'string'
            ? errorOrMessage
            : (errorOrMessage?.message || String(errorOrMessage || ''));

        const isRetryableError = typeof errorOrMessage === 'object' && errorOrMessage !== null
            ? (errorOrMessage.isRateLimitError === true || errorOrMessage.retryable === true)
            : Boolean(errorMessage && (
                errorMessage.includes('RATE_LIMIT_EXCEEDED') ||
                errorMessage.includes('429') ||
                errorMessage.includes('Too Many Requests') ||
                errorMessage.includes('Rate Limit')
            ));

        const isClientRequestError = errorMessage && (
            errorMessage.includes('400') ||
            errorMessage.includes('Bad Request')
        );
        if (isClientRequestError || isRetryableError) {
            return;
        }

        const isFatalError = (() => {
            if (!errorMessage) return false;
            const msg = errorMessage.toLowerCase();
            return (msg.includes('400') && msg.includes('token refresh')) ||
                msg.includes('402') ||
                msg.includes('403') ||
                msg.includes('forbidden') ||
                msg.includes('suspended') ||
                msg.includes('locked') ||
                msg.includes('quota') ||
                msg.includes('payment required') ||
                (msg.includes('401') && !msg.includes('rate')) ||
                msg.includes('token is expired') ||
                msg.includes('invalid token') ||
                msg.includes('unauthorized');
        })();

        return db.prepare(`
            UPDATE accounts
            SET error_count = error_count + 1,
                last_error_time = ?,
                last_error_message = ?,
                is_healthy = CASE
                    WHEN ? = 1 THEN 0
                    WHEN error_count + 1 >= ? THEN 0
                    ELSE is_healthy
                END,
                updated_at = datetime('now')
            WHERE uuid = ?
        `).run(nowIso, errorMessage || null, isFatalError ? 1 : 0, maxErrorCount, uuid);
    }

    /**
     * 增加账号使用次数
     *
     * @param {string} uuid - 账号 UUID
     * @returns {Object} 执行结果
     */
    incrementUsage(uuid) {
        const db = this.getDb();
        return db.prepare(`
            UPDATE accounts
            SET usage_count = usage_count + 1,
                last_used = datetime('now'),
                updated_at = datetime('now')
            WHERE uuid = ?
        `).run(uuid);
    }

    /**
     * 删除账号
     *
     * @param {string} uuid - 账号 UUID
     * @returns {Object} 执行结果
     */
    deleteAccount(uuid) {
        const db = this.getDb();
        return db.prepare('DELETE FROM accounts WHERE uuid = ?').run(uuid);
    }

    /**
     * 解析账号行数据
     *
     * @param {Object} row - 数据库行
     * @returns {Object} 账号对象
     */
    _parseAccountRow(row) {
        let config = {};
        try {
            config = JSON.parse(row.config);
        } catch (e) {
            logger.error('[SQLiteDB] Failed to parse account config:', e);
        }

        let notSupportedModels = null;
        if (row.not_supported_models) {
            try {
                notSupportedModels = JSON.parse(row.not_supported_models);
            } catch {}
        }

        return {
            id: row.id,
            uuid: row.uuid,
            providerType: DEFAULT_PROVIDER_TYPE,
            config,
            isHealthy: row.is_healthy === 1,
            isDisabled: row.is_disabled === 1,
            errorCount: row.error_count || 0,
            usageCount: row.usage_count || 0,
            lastUsed: row.last_used || null,
            lastErrorTime: row.last_error_time || null,
            lastErrorMessage: row.last_error_message || null,
            lastHealthCheckTime: row.last_health_check_time || null,
            lastHealthCheckModel: row.last_health_check_model || null,
            cachedEmail: row.cached_email || null,
            cachedUserId: row.cached_user_id || null,
            notSupportedModels
        };
    }

    // ==================== 兼容旧 Provider API（映射到 accounts） ====================

    /**
     * 兼容旧 Provider API：新增或更新 provider
     *
     * @param {Object} provider - provider 对象
     * @returns {Object} 执行结果
     */
    upsertProvider(provider) {
        return this.upsertAccount(provider);
    }

    /**
     * 兼容旧 Provider API：批量新增或更新 provider
     *
     * @param {Array} providers - provider 数组
     * @param {string} providerType - provider 类型
     * @returns {Object} 执行结果
     */
    upsertProviders(providers, providerType) {
        const db = this.getDb();
        const upsert = db.transaction((items) => {
            for (const provider of items) {
                this.upsertAccount(provider);
            }
        });
        return upsert(providers);
    }

    /**
     * 兼容旧 Provider API：获取 provider 列表
     *
     * @param {string|null} [providerType=null] - provider 类型
     * @returns {Array} provider 列表
     */
    getProviders(providerType = null) {
        const accounts = this.getAccounts();
        if (!providerType) return accounts.map((a) => ({ ...a, providerType: DEFAULT_PROVIDER_TYPE }));
        return accounts.map((a) => ({ ...a, providerType }));
    }

    /**
     * 兼容旧 Provider API：获取健康 provider 列表
     *
     * @param {string} providerType - provider 类型
     * @param {string|null} [model=null] - 模型名称
     * @returns {Array} provider 列表
     */
    getHealthyProviders(providerType, model = null) {
        const accounts = this.getHealthyAccounts(model);
        return accounts.map((a) => ({ ...a, providerType: providerType || DEFAULT_PROVIDER_TYPE }));
    }

    /**
     * 兼容旧 Provider API：按 UUID 获取 provider
     *
     * @param {string} uuid - 账号 UUID
     * @returns {Object|null} provider 对象
     */
    getProviderByUuid(uuid) {
        return this.getAccountByUuid(uuid);
    }

    /**
     * 兼容旧 Provider API：更新健康状态
     *
     * @param {string} uuid - 账号 UUID
     * @param {boolean} isHealthy - 是否健康
     * @param {Object} [extra={}] - 额外字段
     * @returns {Object} 执行结果
     */
    updateProviderHealth(uuid, isHealthy, extra = {}) {
        const db = this.getDb();
        const fields = ['is_healthy = ?', "updated_at = datetime('now')"];
        const values = [isHealthy ? 1 : 0];

        if (extra.errorCount !== undefined) {
            fields.push('error_count = ?');
            values.push(extra.errorCount);
        }
        if (extra.lastErrorTime !== undefined) {
            fields.push('last_error_time = ?');
            values.push(extra.lastErrorTime);
        }
        if (extra.lastErrorMessage !== undefined) {
            fields.push('last_error_message = ?');
            values.push(extra.lastErrorMessage);
        }
        if (extra.lastHealthCheckTime !== undefined) {
            fields.push('last_health_check_time = ?');
            values.push(extra.lastHealthCheckTime);
        }
        if (extra.lastHealthCheckModel !== undefined) {
            fields.push('last_health_check_model = ?');
            values.push(extra.lastHealthCheckModel);
        }
        if (extra.cachedEmail !== undefined) {
            fields.push('cached_email = ?');
            values.push(extra.cachedEmail);
        }
        if (extra.cachedUserId !== undefined) {
            fields.push('cached_user_id = ?');
            values.push(extra.cachedUserId);
        }

        values.push(uuid);
        return db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE uuid = ?`).run(...values);
    }

    /**
     * 兼容旧 Provider API：删除 provider
     *
     * @param {string} uuid - 账号 UUID
     * @returns {Object} 执行结果
     */
    deleteProvider(uuid) {
        return this.deleteAccount(uuid);
    }

    // ==================== Usage Cache（v2：按 account_uuid） ====================

    /**
     * 设置 usage 缓存
     *
     * @param {string} uuid - 账号 UUID
     * @param {string} providerType - provider 类型
     * @param {Object} usageData - usage 数据
     * @param {number} [ttlSeconds=300] - 过期时间（秒）
     * @returns {Object} 执行结果
     */
    setUsageCache(uuid, providerType, usageData, ttlSeconds = 300) {
        const db = this.getDb();
        const expiresAt = Date.now() + ttlSeconds * 1000;
        const stmt = db.prepare(`
            INSERT INTO usage_cache (account_uuid, usage_data, expires_at)
            VALUES (?, ?, ?)
            ON CONFLICT(account_uuid) DO UPDATE SET
                usage_data = excluded.usage_data,
                cached_at = datetime('now'),
                expires_at = excluded.expires_at
        `);
        return stmt.run(uuid, JSON.stringify(usageData), expiresAt);
    }

    /**
     * 获取 usage 缓存
     *
     * @param {string} uuid - 账号 UUID
     * @param {string} providerType - provider 类型
     * @returns {Object|null} 缓存数据或 null
     */
    getUsageCache(uuid, providerType) {
        const db = this.getDb();
        const row = db.prepare(`
            SELECT * FROM usage_cache
            WHERE account_uuid = ?
            AND expires_at > ?
        `).get(uuid, Date.now());
        if (!row) return null;

        try {
            return {
                usageData: JSON.parse(row.usage_data),
                cachedAt: row.cached_at,
                expiresAt: row.expires_at
            };
        } catch {
            return null;
        }
    }

    /**
     * 批量获取 usage 缓存
     *
     * @param {string} providerType - provider 类型
     * @returns {Map} 缓存 Map
     */
    getUsageCacheBatch(providerType) {
        const db = this.getDb();
        const rows = db.prepare(`
            SELECT * FROM usage_cache
            WHERE expires_at > ?
        `).all(Date.now());
        const cache = new Map();

        for (const row of rows) {
            try {
                cache.set(row.account_uuid, {
                    usageData: JSON.parse(row.usage_data),
                    cachedAt: row.cached_at,
                    expiresAt: row.expires_at
                });
            } catch {}
        }

        return cache;
    }

    /**
     * 清理过期 usage 缓存
     *
     * @returns {Object} 执行结果
     */
    cleanExpiredUsageCache() {
        const db = this.getDb();
        const result = db.prepare(`DELETE FROM usage_cache WHERE expires_at <= ?`).run(Date.now());
        if (result.changes > 0) {
            logger.info(`[SQLiteDB] Cleaned ${result.changes} expired usage cache entries`);
        }
        return result;
    }

    /**
     * 清空所有 usage 缓存
     *
     * @returns {Object} 执行结果
     */
    clearAllUsageCache() {
        const db = this.getDb();
        return db.prepare('DELETE FROM usage_cache').run();
    }

    // ==================== Health History（v2：按 account_uuid） ====================

    /**
     * 记录健康检查结果
     *
     * @param {string} uuid - 账号 UUID
     * @param {string} providerType - provider 类型
     * @param {boolean} isHealthy - 是否健康
     * @param {string|null} [checkModel=null] - 检查模型
     * @param {string|null} [errorMessage=null] - 错误信息
     * @returns {Object} 执行结果
     */
    recordHealthCheck(uuid, providerType, isHealthy, checkModel = null, errorMessage = null) {
        const db = this.getDb();
        return db.prepare(`
            INSERT INTO health_check_history (account_uuid, is_healthy, check_model, error_message)
            VALUES (?, ?, ?, ?)
        `).run(uuid, isHealthy ? 1 : 0, checkModel, errorMessage);
    }

    /**
     * 获取健康检查历史
     *
     * @param {string} uuid - 账号 UUID
     * @param {number} [limit=10] - 返回数量
     * @returns {Array} 历史记录
     */
    getHealthCheckHistory(uuid, limit = 10) {
        const db = this.getDb();
        return db.prepare(`
            SELECT * FROM health_check_history
            WHERE account_uuid = ?
            ORDER BY check_time DESC
            LIMIT ?
        `).all(uuid, limit);
    }

    /**
     * 清理旧的健康检查历史
     *
     * @param {number} [days=7] - 保留天数
     * @returns {Object} 执行结果
     */
    cleanOldHealthHistory(days = 7) {
        const db = this.getDb();
        const result = db.prepare(`
            DELETE FROM health_check_history
            WHERE check_time < datetime('now', '-' || ? || ' days')
        `).run(days);
        if (result.changes > 0) {
            logger.info(`[SQLiteDB] Cleaned ${result.changes} old health check history entries`);
        }
        return result;
    }

    // ==================== Stats ====================

    /**
     * 获取账号池统计信息
     *
     * @param {string|null} [providerType=null] - provider 类型
     * @returns {Array} 统计结果
     */
    getPoolStats(providerType = null) {
        const db = this.getDb();
        const row = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN is_healthy = 1 AND is_disabled = 0 THEN 1 ELSE 0 END) as healthy,
                SUM(CASE WHEN is_healthy = 0 THEN 1 ELSE 0 END) as unhealthy,
                SUM(CASE WHEN is_disabled = 1 THEN 1 ELSE 0 END) as disabled,
                SUM(usage_count) as total_usage,
                SUM(error_count) as total_errors
            FROM accounts
        `).get();

        return [{
            provider_type: providerType || DEFAULT_PROVIDER_TYPE,
            total: row.total || 0,
            healthy: row.healthy || 0,
            unhealthy: row.unhealthy || 0,
            disabled: row.disabled || 0,
            total_usage: row.total_usage || 0,
            total_errors: row.total_errors || 0
        }];
    }
}

/**
 * SQLiteDB 单例实例
 *
 * @type {SQLiteDB}
 */
export const sqliteDB = new SQLiteDB();
export default sqliteDB;
