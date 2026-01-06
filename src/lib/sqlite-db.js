/**
 * SQLiteDriver - SQLite 数据库驱动
 *
 * 该类提供 SQLite 数据库的基础操作，包括：
 * - 数据库连接管理
 * - 表结构初始化和维护
 * - 账号数据的 CRUD 操作
 * - JSON 序列化/反序列化处理
 *
 * 设计特点：
 * - 使用 better-sqlite3 同步驱动，API 简单可靠
 * - WAL 模式提高并发性能
 * - 单例模式，全局共享一个数据库连接
 * - 自动处理 JSON 字段的序列化
 *
 * @module lib/sqlite-db
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('sqlite-db');

/**
 * SQLiteDriver 类
 *
 * @class
 */
class SQLiteDriver {
    /**
     * 创建 SQLiteDriver 实例
     *
     * @private
     */
    constructor() {
        /**
         * 数据库连接实例
         * @type {Database.Database|null}
         * @private
         */
        this.db = null;

        /**
         * 数据库文件路径
         * @type {string|null}
         * @private
         */
        this.dbPath = null;
    }

    // ==================== 初始化方法 ====================

    /**
     * 初始化数据库连接
     *
     * 如果数据库文件不存在，会自动创建。
     * 如果表不存在，会自动创建表结构。
     *
     * @param {string} [dbPath='data/account_pool.db'] - 数据库文件路径
     * @returns {Database.Database} 数据库连接实例
     * @throws {Error} 如果数据库初始化失败
     *
     * @example
     * const driver = new SQLiteDriver();
     * const db = driver.init('./data/accounts.db');
     */
    init(dbPath = 'data/account_pool.db') {
        // 如果已经初始化且路径相同，直接返回
        if (this.db && this.dbPath === dbPath) {
            logger.debug('Database already initialized');
            return this.db;
        }

        // 如果路径不同，关闭旧连接
        if (this.db) {
            logger.info(`Closing old database connection: ${this.dbPath}`);
            this.db.close();
            this.db = null;
        }

        // 保存新路径
        this.dbPath = dbPath;

        // 确保目录存在
        const dir = path.dirname(dbPath);
        if (dir && dir !== '.' && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.debug(`Created database directory: ${dir}`);
        }

        try {
            // 打开数据库连接
            this.db = new Database(dbPath);

            // 优化配置
            this.db.pragma('journal_mode = WAL');  // WAL 模式，提高并发性能
            this.db.pragma('busy_timeout = 5000');  // 忙等待超时 5 秒
            this.db.pragma('synchronous = NORMAL'); // 平衡性能和安全

            // 确保表存在
            this._ensureTables();

            logger.info(`Initialized SQLite database at ${dbPath}`);
            return this.db;
        } catch (error) {
            logger.error(`Failed to initialize SQLite database at ${dbPath}:`, error);
            throw error;
        }
    }

    /**
     * 获取数据库连接实例
     *
     * 如果数据库未初始化，会抛出错误。
     *
     * @returns {Database.Database} 数据库连接实例
     * @throws {Error} 如果数据库未初始化
     * @private
     */
    getDb() {
        if (!this.db) {
            throw new Error('SQLiteDriver: database not initialized. Call init() first.');
        }
        return this.db;
    }

    // ==================== 表管理方法 ====================

    /**
     * 确保数据库表存在
     *
     * 如果表不存在，会创建表结构。
     *
     * @private
     */
    _ensureTables() {
        const db = this.getDb();

        // 创建 accounts 表
        db.prepare(`
            CREATE TABLE IF NOT EXISTS accounts (
                uuid TEXT PRIMARY KEY,
                config TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `).run();

        // 创建索引
        db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_accounts_updated_at
            ON accounts(updated_at DESC)
        `).run();

        logger.debug('Database tables verified/created');
    }

    // ==================== 序列化方法 ====================

    /**
     * 序列化账号对象为 JSON 字符串
     *
     * @param {Object} account - 账号对象
     * @returns {string} JSON 字符串
     * @private
     */
    _serializeAccount(account) {
        try {
            // 移除 uuid（单独存储在主键列）
            const { uuid, ...rest } = account;
            return JSON.stringify(rest);
        } catch (error) {
            logger.warn('Failed to serialize account:', error);
            return '{}';
        }
    }

    /**
     * 反序列化 JSON 字符串为账号对象
     *
     * @param {Object} row - 数据库行对象
     * @returns {Object|null} 账号对象，失败返回 null
     * @private
     */
    _deserializeAccount(row) {
        if (!row) {
            return null;
        }

        try {
            const config = JSON.parse(row.config || '{}');
            // 合并 uuid 和 config
            return {
                uuid: row.uuid,
                ...config
            };
        } catch (error) {
            logger.warn(`Failed to deserialize account (${row.uuid}):`, error.message);
            return {
                uuid: row.uuid
            };
        }
    }

    // ==================== CRUD 方法 ====================

    /**
     * 获取所有账号
     *
     * @returns {Array<Object>} 账号列表，按更新时间倒序排列
     *
     * @example
     * const accounts = driver.getAccounts();
     * console.log('Total accounts:', accounts.length);
     */
    getAccounts() {
        const db = this.getDb();

        try {
            const stmt = db.prepare(`
                SELECT uuid, config
                FROM accounts
                ORDER BY updated_at DESC
            `);

            const rows = stmt.all();
            return rows.map(row => this._deserializeAccount(row)).filter(Boolean);
        } catch (error) {
            logger.error('Failed to get accounts:', error);
            return [];
        }
    }

    /**
     * 获取指定 UUID 的账号
     *
     * @param {string} uuid - 账号 UUID
     * @returns {Object|null} 账号对象，不存在返回 null
     *
     * @example
     * const account = driver.getAccount('abc-123');
     * if (account) {
     *     console.log(account.cachedEmail);
     * }
     */
    getAccount(uuid) {
        if (!uuid) {
            return null;
        }

        const db = this.getDb();

        try {
            const stmt = db.prepare(`
                SELECT uuid, config
                FROM accounts
                WHERE uuid = ?
            `);

            const row = stmt.get(uuid);
            return this._deserializeAccount(row);
        } catch (error) {
            logger.error(`Failed to get account (${uuid}):`, error);
            return null;
        }
    }

    /**
     * 插入或更新账号（Upsert）
     *
     * 如果账号已存在（uuid 相同），则更新；
     * 如果账号不存在，则插入。
     *
     * @param {Object} account - 账号对象
     * @returns {boolean} 是否成功
     * @throws {Error} 如果参数无效
     *
     * @example
     * const success = driver.upsertAccount({
     *     uuid: 'abc-123',
     *     isHealthy: true,
     *     cachedEmail: 'user@example.com'
     * });
     */
    upsertAccount(account) {
        // 参数验证
        if (!account || typeof account !== 'object') {
            throw new Error('upsertAccount: account must be an object');
        }

        if (!account.uuid) {
            throw new Error('upsertAccount: account.uuid is required');
        }

        const db = this.getDb();

        try {
            const serialized = this._serializeAccount(account);

            const stmt = db.prepare(`
                INSERT INTO accounts (uuid, config)
                VALUES (?, ?)
                ON CONFLICT(uuid) DO UPDATE SET
                    config = excluded.config,
                    updated_at = CURRENT_TIMESTAMP
            `);

            stmt.run(account.uuid, serialized);

            logger.debug(`Upserted account: ${account.uuid}`);
            return true;
        } catch (error) {
            logger.error(`Failed to upsert account (${account.uuid}):`, error);
            return false;
        }
    }

    /**
     * 删除账号
     *
     * @param {string} uuid - 账号 UUID
     * @returns {boolean} 是否成功删除（账号不存在返回 false）
     *
     * @example
     * const removed = driver.removeAccount('abc-123');
     * if (removed) {
     *     console.log('账号已删除');
     * }
     */
    removeAccount(uuid) {
        if (!uuid) {
            return false;
        }

        const db = this.getDb();

        try {
            const stmt = db.prepare('DELETE FROM accounts WHERE uuid = ?');
            const result = stmt.run(uuid);

            const removed = result.changes > 0;

            if (removed) {
                logger.debug(`Removed account: ${uuid}`);
            }

            return removed;
        } catch (error) {
            logger.error(`Failed to remove account (${uuid}):`, error);
            return false;
        }
    }

    /**
     * 获取账号数量
     *
     * @returns {number} 账号总数
     *
     * @example
     * const count = driver.getAccountCount();
     * console.log('Total accounts:', count);
     */
    getAccountCount() {
        const db = this.getDb();

        try {
            const stmt = db.prepare('SELECT COUNT(*) as count FROM accounts');
            const result = stmt.get();
            return result.count;
        } catch (error) {
            logger.error('Failed to get account count:', error);
            return 0;
        }
    }

    /**
     * 关闭数据库连接
     *
     * @returns {boolean} 是否成功关闭
     *
     * @example
     * // 在应用退出前
     * driver.close();
     */
    close() {
        if (this.db) {
            try {
                this.db.close();
                this.db = null;
                this.dbPath = null;
                logger.info('Database connection closed');
                return true;
            } catch (error) {
                logger.error('Failed to close database:', error);
                return false;
            }
        }
        return true;
    }
}

// ==================== 单例导出 ====================

/**
 * SQLiteDriver 单例实例
 *
 * 全局共享一个数据库连接，避免重复初始化。
 *
 * @type {SQLiteDriver}
 */
const sqliteDriver = new SQLiteDriver();

export default sqliteDriver;
export { SQLiteDriver };
