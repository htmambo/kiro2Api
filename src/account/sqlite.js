/**
 * SQLiteAccountStore - SQLite 数据库账号存储实现
 *
 * 该类使用 SQLite 数据库持久化账号数据，通过 SQLiteDriver 执行所有数据库操作。
 *
 * 设计特点：
 * - 无内存缓存：所有操作直接查询数据库
 * - 即时持���化：每次写操作立即写入数据库
 * - 高性能：SQLite 查询速度快，支持索引
 * - 事务安全：利用 SQLite 的事务机制保证数据一致性
 *
 * 适用场景：
 * - 中大规模账号列表（> 1000 个账号）
 * - 高并发读写场景
 * - 需要事务支持
 *
 * @module account/sqlite
 */

import { v4 as uuidv4 } from 'uuid';
import { AccountStore } from './interface.js';
import sqliteDriver from '../lib/sqlite-db.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('account:sqlite');

/**
 * SQLiteAccountStore 类
 *
 * @class
 * @extends AccountStore
 */
export class SQLiteAccountStore extends AccountStore {
    /**
     * 创建 SQLiteAccountStore 实例
     *
     * @param {Object} options - 配置选项
     * @param {string} [options.dbPath='data/account_pool.db'] - 数据库文件路径
     * @param {Object} [options.driver] - SQLiteDriver 实例（可选，默认使用单例）
     * @throws {Error} 如果数据库初始化失败
     *
     * @example
     * const store = new SQLiteAccountStore({
     *     dbPath: './data/accounts.db'
     * });
     */
    constructor(options = {}) {
        super();

        /**
         * 数据库文件路径
         * @type {string}
         * @private
         */
        this.dbPath = options.dbPath || 'data/account_pool.db';

        /**
         * SQLiteDriver 实例
         * @type {Object}
         * @private
         */
        this.driver = options.driver || sqliteDriver;

        // 初始化数据库连接
        this.driver.init(this.dbPath);

        logger.info(`SQLiteAccountStore initialized with database: ${this.dbPath}`);
    }

    // ==================== 持久化方法 ====================

    /**
     * 初始化数据库连接
     *
     * 对于 SQLite 存储，此方法用于确保数据库已正确初始化。
     *
     * @returns {boolean} 是否成功初始化
     *
     * @example
     * if (store.load()) {
     *     console.log('数据库初始化成功');
     * }
     */
    load() {
        try {
            this.driver.init(this.dbPath);
            logger.debug('Database connection verified');
            return true;
        } catch (error) {
            logger.error('Failed to initialize database:', error);
            return false;
        }
    }

    /**
     * 重新连接数据库
     *
     * 对于 SQLite 存储，此方法与 load() 相同。
     * 不会丢弃任何数据（因为所有数据都在数据库中）。
     *
     * @returns {boolean} 是否成功重新连接
     *
     * @example
     * store.reload();
     */
    reload() {
        logger.debug('Reloading database connection');
        return this.load();
    }

    /**
     * 保存数据（空操作）
     *
     * 对于 SQLite 存储，每次写操作都立即持久化到数据库，
     * 因此此方法是空操作，总是返回 true。
     *
     * @returns {boolean} 总是返回 true
     *
     * @example
     * store.save();  // 对于 SQLite 无实际效果
     */
    save() {
        // SQLite 每次写操作都立即持久化，无需额外保存
        return true;
    }

    // ==================== 查询方法 ====================

    /**
     * 列出所有账号
     *
     * 直接从数据库查询所有账号，按更新时间倒序排列。
     *
     * @returns {Array<Object>} 账号配置数组
     *
     * @example
     * const allAccounts = store.listAccounts();
     * const healthyCount = allAccounts.filter(a => a.isHealthy).length;
     */
    listAccounts() {
        try {
            return this.driver.getAccounts();
        } catch (error) {
            logger.error('Failed to list accounts:', error);
            return [];
        }
    }

    /**
     * 获取指定 UUID 的账号
     *
     * @param {string} uuid - 账号 UUID
     * @returns {Object|null} 账号配置对象，不存在则返回 null
     *
     * @example
     * const account = store.getAccount('abc-123-def');
     * if (account) {
     *     console.log(account.cachedEmail);
     * }
     */
    getAccount(uuid) {
        if (!uuid) {
            return null;
        }

        try {
            return this.driver.getAccount(uuid);
        } catch (error) {
            logger.error(`Failed to get account (${uuid}):`, error);
            return null;
        }
    }

    /**
     * 按条件查找账号
     *
     * 先查询所有账号，然后在内存中过滤。
     * 对于复杂查询条件，建议直接在数据库层实现（需要扩展 SQLiteDriver）。
     *
     * @param {Function} predicate - 查找条件函数
     * @returns {Object|null} 找到的第一个账号，不存在则返回 null
     *
     * @example
     * // 查找特定邮箱的账号
     * const account = store.findAccount(a => a.cachedEmail === 'user@example.com');
     *
     * // 查找错误次数过多的账号
     * const badAccount = store.findAccount(a => a.errorCount > 5);
     */
    findAccount(predicate) {
        if (typeof predicate !== 'function') {
            logger.warn('findAccount: predicate must be a function');
            return null;
        }

        try {
            const accounts = this.listAccounts();
            return accounts.find(predicate) || null;
        } catch (error) {
            logger.error('Failed to find account:', error);
            return null;
        }
    }

    // ==================== 修改方法 ====================

    /**
     * 添加新账号
     *
     * 如果账号对象没有 uuid，会自动生成一个。
     * 添加后立即写入数据库（非防抖）。
     *
     * @param {Object} accountConfig - 账号配置对象
     * @returns {Object} 添加后的账号对象（包含 uuid）
     * @throws {Error} 如果 accountConfig 不是对象
     *
     * @example
     * const newAccount = {
     *     isHealthy: true,
     *     KIRO_OAUTH_CREDS_FILE_PATH: './creds/new-account.json'
     * };
     * const added = store.addAccount(newAccount);
     * console.log('Added account:', added.uuid);
     */
    addAccount(accountConfig) {
        // 参数验证
        if (!accountConfig || typeof accountConfig !== 'object') {
            throw new Error('addAccount: accountConfig must be an object');
        }

        // 复制对象，避免修改原对象
        const account = { ...accountConfig };

        // 自动生成 UUID
        if (!account.uuid) {
            account.uuid = uuidv4();
            logger.debug(`Generated UUID for new account: ${account.uuid}`);
        }

        try {
            // 写入数据库（立即持久化）
            this.driver.upsertAccount(account);

            logger.info(`Added account: ${account.uuid}`);
            return account;
        } catch (error) {
            logger.error(`Failed to add account (${account.uuid}):`, error);
            throw error;
        }
    }

    /**
     * 更新账号属性
     *
     * 使用浅合并方式更新账号，只更新提供的字段。
     * 更新后立即写入数据库（非防抖）。
     *
     * @param {string} uuid - 账号 UUID
     * @param {Object} updates - 要更新的属性对象
     * @returns {boolean} 是否成功更新（账号不存在返回 false）
     *
     * @example
     * // 更新健康状态
     * store.updateAccount('abc-123', { isHealthy: true, errorCount: 0 });
     *
     * // 更新使用时间
     * store.updateAccount('abc-123', { lastUsed: new Date().toISOString() });
     */
    updateAccount(uuid, updates) {
        // 参数验证
        if (!uuid || !updates || typeof updates !== 'object') {
            logger.warn('updateAccount: invalid parameters');
            return false;
        }

        try {
            // 获取现有账号
            const existing = this.getAccount(uuid);
            if (!existing) {
                logger.debug(`Account not found for update: ${uuid}`);
                return false;
            }

            // 合并更新（保留 uuid）
            const merged = {
                ...existing,
                ...updates,
                uuid  // 确保 uuid 不被覆盖
            };

            // 写入数据库
            this.driver.upsertAccount(merged);

            logger.debug(`Updated account: ${uuid}`);
            return true;
        } catch (error) {
            logger.error(`Failed to update account (${uuid}):`, error);
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
     * const removed = store.removeAccount('abc-123');
     * if (removed) {
     *     console.log('账号已删除');
     * }
     */
    removeAccount(uuid) {
        // 参数验证
        if (!uuid) {
            return false;
        }

        try {
            const removed = this.driver.removeAccount(uuid);

            if (removed) {
                logger.info(`Removed account: ${uuid}`);
            } else {
                logger.debug(`Account not found for removal: ${uuid}`);
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
     * 便捷方法，直接查询数据库中的账号总数。
     *
     * @returns {number} 账号总数
     *
     * @example
     * const count = store.getAccountCount();
     * console.log('Total accounts:', count);
     */
    getAccountCount() {
        try {
            return this.driver.getAccountCount();
        } catch (error) {
            logger.error('Failed to get account count:', error);
            return 0;
        }
    }

    /**
     * 销毁实例，清理资源
     *
     * 在删除实例前调用。
     * 注意：由于使用单例 driver，此方法不会关闭数据库连接。
     *
     * @returns {boolean} 总是返回 true
     *
     * @example
     * store.destroy();
     */
    destroy() {
        logger.info('Destroying SQLiteAccountStore');
        // 注意：不关闭 driver，因为是单例共享的
        return true;
    }
}

export default SQLiteAccountStore;
