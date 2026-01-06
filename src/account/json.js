/**
 * JSONAccountStore - JSON 文件账号存储实现
 *
 * 该类使用 JSON 文件持久化账号数据，并通过内存缓存和防抖机制优化性能。
 *
 * 性能优化策略：
 * - 内存缓存：所有账号数据保存在 this.accounts 中，读操作无需 IO
 * - 防抖保存：写操作延迟 1 秒后批量保存，减少频繁 IO
 * - 立即保存：save() 方法提供立即持久化能力
 *
 * 适用场景：
 * - 小规模账号列表（< 1000 个账号）
 * - 低并发读写场景
 * - 需要人类可读的数据格式
 *
 * @module account/json
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AccountStore } from './interface.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('account:json');

/**
 * JSONAccountStore 类
 *
 * @class
 * @extends AccountStore
 */
export class JSONAccountStore extends AccountStore {
    /**
     * 默认防抖保存时间（毫秒）
     * @static
     */
    static DEFAULT_DEBOUNCE_TIME = 1000;

    /**
     * 创建 JSONAccountStore 实例
     *
     * @param {Object} options - 配置选项
     * @param {string} [options.filePath='configs/account_pool.json'] - JSON 文件路径
     * @param {number} [options.saveDebounceTime=1000] - 防抖保存时间（毫秒）
     * @throws {Error} 如果 filePath 不是字符串
     *
     * @example
     * const store = new JSONAccountStore({
     *     filePath: './data/accounts.json',
     *     saveDebounceTime: 2000  // 2秒后保存
     * });
     */
    constructor(options = {}) {
        super();

        // 验证参数
        if (options.filePath !== undefined && typeof options.filePath !== 'string') {
            throw new Error('JSONAccountStore: filePath must be a string');
        }

        /**
         * JSON 文件路径
         * @type {string}
         * @private
         */
        this.filePath = options.filePath || 'configs/account_pool.json';

        /**
         * 防抖保存时间（毫秒）
         * @type {number}
         * @private
         */
        this.saveDebounceTime = options.saveDebounceTime ?? JSONAccountStore.DEFAULT_DEBOUNCE_TIME;

        /**
         * 内存缓存：账号列表
         * @type {Array<Object>}
         * @private
         */
        this.accounts = [];

        /**
         * 脏标记：数据是否被修改但未保存
         * @type {boolean}
         * @private
         */
        this.dirty = false;

        /**
         * 防抖定时器
         * @type {NodeJS.Timeout|null}
         * @private
         */
        this.saveTimer = null;

        // 初始化时加载数据
        this.load();
    }

    // ==================== 持久化方法 ====================

    /**
     * 从 JSON 文件加载账号数据到内存缓存
     *
     * @returns {boolean} 是否成功加载
     *
     * @example
     * if (store.load()) {
     *     console.log('加载成功，账号数量:', store.listAccounts().length);
     * }
     */
    load() {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(this.filePath)) {
                logger.debug(`Account file not found, starting with empty pool: ${this.filePath}`);
                this.accounts = [];
                this.dirty = false;
                return true;
            }

            // 读取并解析文件
            const content = fs.readFileSync(this.filePath, 'utf8');
            const data = JSON.parse(content);

            // 验证数据格式
            if (!data || !Array.isArray(data.accounts)) {
                logger.warn(`Invalid account file format, starting with empty pool: ${this.filePath}`);
                this.accounts = [];
                this.dirty = false;
                return false;
            }

            // 加载到内存缓存
            this.accounts = data.accounts;
            this.dirty = false;

            logger.info(`Loaded ${this.accounts.length} accounts from ${this.filePath}`);
            return true;
        } catch (error) {
            logger.error(`Failed to load accounts from ${this.filePath}:`, error);
            this.accounts = [];
            this.dirty = false;
            return false;
        }
    }

    /**
     * 重新从 JSON 文件加载数据
     *
     * 丢弃内存中的所有更改，重新从磁盘加载数据。
     * 会清除所有未保存的修改。
     *
     * @returns {boolean} 是否成功重新加载
     *
     * @example
     * // 检测到配置文件被外部修改
     * store.reload();
     */
    reload() {
        // 取消待处理的保存任务
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        logger.info('Reloading accounts from disk (unsaved changes will be lost)');
        return this.load();
    }

    /**
     * 立即保存账号数据到 JSON 文件
     *
     * 该方法会立即执行 IO 操作，不使用防抖。
     * 如果当前没有未保存的修改（dirty=false），则跳过保存。
     *
     * @returns {boolean} 是否成功保存
     *
     * @example
     * // 执行批量更新后，立即保存
     * for (const account of accounts) {
     *     store.updateAccount(account.uuid, { isHealthy: true });
     * }
     * store.save();  // 立即持久化
     */
    save() {
        // 如果没有修改，跳过保存
        if (!this.dirty) {
            logger.debug('No changes to save');
            return true;
        }

        if (!this.filePath) {
            logger.error('Cannot save: filePath is not configured');
            return false;
        }

        try {
            // 确保目录存在
            const dirName = path.dirname(this.filePath);
            if (dirName && dirName !== '.' && !fs.existsSync(dirName)) {
                fs.mkdirSync(dirName, { recursive: true });
                logger.debug(`Created directory: ${dirName}`);
            }

            // 写入文件
            const data = { accounts: this.accounts };
            fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');

            // 清除脏标记
            this.dirty = false;

            logger.info(`Saved ${this.accounts.length} accounts to ${this.filePath}`);
            return true;
        } catch (error) {
            logger.error(`Failed to save accounts to ${this.filePath}:`, error);
            return false;
        }
    }

    // ==================== 查询方法 ====================

    /**
     * 列出所有账号
     *
     * 直接返回内存缓存中的账号列表，无需 IO 操作。
     *
     * 注意：返回的是原始数组的引用，直接修改不会触发保存。
     * 如需修改账号，请使用 updateAccount() 方法。
     *
     * @returns {Array<Object>} 账号配置数组
     *
     * @example
     * const allAccounts = store.listAccounts();
     * const healthyCount = allAccounts.filter(a => a.isHealthy).length;
     */
    listAccounts() {
        // 返回原始数组引用以保持性能
        // 调用方应该通过 updateAccount() 修改账号，而不是直接修改数组
        return this.accounts;
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

        return this.accounts.find(account => account.uuid === uuid) || null;
    }

    /**
     * 按条件查找账号
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

        return this.accounts.find(predicate) || null;
    }

    // ==================== 修改方法 ====================

    /**
     * 添加新账号
     *
     * 如果账号对象没有 uuid，会自动生成一个。
     * 添加后会触发防抖保存。
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

        // 添加到内存缓存
        this.accounts.push(account);

        // 标记为脏数据，触发防抖保存
        this._markDirty();

        logger.info(`Added account: ${account.uuid}`);
        return account;
    }

    /**
     * 更新账号属性
     *
     * 使用浅合并方式更新账号，只更新提供的字段。
     * 更新后会触发防抖保存。
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

        // 查找账号
        const account = this.getAccount(uuid);
        if (!account) {
            logger.debug(`Account not found for update: ${uuid}`);
            return false;
        }

        // 合并更新
        Object.assign(account, updates);

        // 标记为脏数据，触发防抖保存
        this._markDirty();

        logger.debug(`Updated account: ${uuid}`);
        return true;
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

        // 记录删除前的数量
        const beforeLength = this.accounts.length;

        // 过滤掉要删除的账号
        this.accounts = this.accounts.filter(account => account.uuid !== uuid);

        // 检查是否真的删除了
        const removed = this.accounts.length < beforeLength;

        if (removed) {
            // 标记为脏数据，触发防抖保存
            this._markDirty();
            logger.info(`Removed account: ${uuid}`);
        } else {
            logger.debug(`Account not found for removal: ${uuid}`);
        }

        return removed;
    }

    // ==================== 私有方法 ====================

    /**
     * 标记数据为脏状态，并触发防抖保存
     *
     * @private
     */
    _markDirty() {
        this.dirty = true;
        this._scheduleSave();
    }

    /**
     * 调度防抖保存
     *
     * 取消之前的定时器，创建新的定时器。
     * 在指定时间后执行 save() 方法。
     *
     * @private
     */
    _scheduleSave() {
        // 清除之前的定时器
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        // 创建新的定时器
        this.saveTimer = setTimeout(() => {
            this.save();
            this.saveTimer = null;
        }, this.saveDebounceTime);
    }

    /**
     * 销毁实例，清理资源
     *
     * 在删除实例前调用，确保未保存的数据被持久化。
     *
     * @returns {boolean} 是否成功清理
     *
     * @example
     * // 在关闭应用前
     * store.destroy();
     */
    destroy() {
        // 取消防抖定时器
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        // 立即保存未持久化的数据
        if (this.dirty) {
            logger.info('Destroying store, saving unsaved changes...');
            return this.save();
        }

        return true;
    }
}

export default JSONAccountStore;
