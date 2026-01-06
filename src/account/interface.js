/**
 * AccountStore - 账号存储抽象接口
 *
 * 该接口定义了账号存储层的标准契约，包含 CRUD 操作和持久化方法。
 * 所有具体存储实现（JSON、SQLite 等）都必须实现此接口。
 *
 * @module account/interface
 */

/**
 * 账号配置对象
 * @typedef {Object} AccountConfig
 * @property {string} uuid - ���号唯一标识符
 * @property {boolean} [isHealthy] - 账号健康状态
 * @property {boolean} [isDisabled] - 账号是否被禁用
 * @property {number} [usageCount] - 累计使用次数
 * @property {number} [errorCount] - 累计错误次数
 * @property {string|null} [lastUsed] - 最后使用时间（ISO 8601 格式）
 * @property {string|null} [lastErrorTime] - 最后错误��间（ISO 8601 格式）
 * @property {string|null} [lastErrorMessage] - 最后错误消息
 * @property {string} [KIRO_OAUTH_CREDS_FILE_PATH] - OAuth 凭证文件路径
 * @property {string} [cachedEmail] - 缓存的用户邮箱
 * @property {string} [cachedUserId] - 缓存的用户 ID
 * @property {number} [maxConcurrency] - 最大并发数
 * @property {string[]} [notSupportedModels] - 不支持的模型列表
 * @property {Object} [metadata] - 额外的元数据
 */

/**
 * AccountStore - 账号存储接口
 *
 * 这是一个抽象基类，定义了账号存储的标准接口。
 * 所有具体实现必须继承此类并实现所有方法。
 *
 * 设计原则：
 * - 职责单一：仅负责数据的持久化和 CRUD 操作
 * - 最小化接口：只包含 8 个核心方法
 * - 实现灵活：JSON 可以使用内存缓存，SQLite 可以直接查询
 *
 * @class
 */
export class AccountStore {
    /**
     * 从持久化存储加载账号数据
     *
     * 首次加载时调用，将数据从磁盘/数据库加载到内存（如果需要）。
     * 对于 JSON 存储，此方法会读取文件并解析到内存缓存。
     * 对于 SQLite 存储，此方法可以用于验证连接。
     *
     * @returns {boolean} 是否成功加载
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * const store = new JSONAccountStore('./accounts.json');
     * if (store.load()) {
     *     console.log('账号数据加载成功');
     * }
     */
    load() {
        throw new Error('AccountStore.load() must be implemented by subclass');
    }

    /**
     * 重新从持久化存储加载账号数据
     *
     * 丢弃内存中的所有更改，重新从磁盘/数据库加载数据。
     * 通常用于数据恢复或配置重置场景。
     *
     * @returns {boolean} 是否成功重新加载
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * // 检测到配置文件被外部修改，重新加载
     * store.reload();
     */
    reload() {
        throw new Error('AccountStore.reload() must be implemented by subclass');
    }

    /**
     * 将当前账号数据持久化到存储
     *
     * 立即保存，不使用防抖。
     * 对于 JSON 存储，此方法会将内存缓存写入文件。
     * 对于 SQLite 存储，由于每次写操作都是持久化的，此方法可能为空操作。
     *
     * @returns {boolean} 是否成功保存
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * // 执行批量更新后，立即保存
     * for (const account of accounts) {
     *     store.updateAccount(account.uuid, { isHealthy: true });
     * }
     * store.save();  // 立即持久化
     */
    save() {
        throw new Error('AccountStore.save() must be implemented by subclass');
    }

    /**
     * 列出所有账号
     *
     * 返回账号列表的副本，避免外部直接修改内部数据。
     *
     * @returns {AccountConfig[]} 账号配置数组
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * const allAccounts = store.listAccounts();
     * const healthyAccounts = allAccounts.filter(a => a.isHealthy);
     */
    listAccounts() {
        throw new Error('AccountStore.listAccounts() must be implemented by subclass');
    }

    /**
     * 获取指定 UUID 的账号
     *
     * @param {string} uuid - 账号 UUID
     * @returns {AccountConfig|null} 账号配置对象，不存在则返回 null
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * const account = store.getAccount('abc-123');
     * if (account) {
     *     console.log(account.cachedEmail);
     * }
     */
    getAccount(uuid) {
        throw new Error('AccountStore.getAccount() must be implemented by subclass');
    }

    /**
     * 添加新账号
     *
     * 如果账号已存在 UUID，应该抛出错误或返回 null。
     *
     * @param {AccountConfig} accountConfig - 账号配置对象
     * @returns {AccountConfig|null} 添加后的账号对象（包含生成的 UUID），失败返回 null
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * const newAccount = {
     *     uuid: 'new-uuid-123',
     *     isHealthy: true,
     *     KIRO_OAUTH_CREDS_FILE_PATH: './creds/new-account.json'
     * };
     * const added = store.addAccount(newAccount);
     */
    addAccount(accountConfig) {
        throw new Error('AccountStore.addAccount() must be implemented by subclass');
    }

    /**
     * 更新账号属性
     *
     * 使用浅合并方式更新账号，只更新提供的字段。
     *
     * @param {string} uuid - 账号 UUID
     * @param {Partial<AccountConfig>} updates - 要更新的属性对象
     * @returns {boolean} 是否成功更新（账号不存在返回 false）
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * // 更新健康状态
     * store.updateAccount('abc-123', { isHealthy: true, errorCount: 0 });
     *
     * // 更新使用时间
     * store.updateAccount('abc-123', { lastUsed: new Date().toISOString() });
     */
    updateAccount(uuid, updates) {
        throw new Error('AccountStore.updateAccount() must be implemented by subclass');
    }

    /**
     * 删除账号
     *
     * @param {string} uuid - 账号 UUID
     * @returns {boolean} 是否成功删除（账号不存在返回 false）
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * const removed = store.removeAccount('abc-123');
     * if (removed) {
     *     console.log('账号已删除');
     * }
     */
    removeAccount(uuid) {
        throw new Error('AccountStore.removeAccount() must be implemented by subclass');
    }

    /**
     * 按条件查找账号
     *
     * 提供灵活的查询能力，支持复杂的过滤条件。
     *
     * @param {(account: AccountConfig) => boolean} predicate - 查找条件函数
     * @returns {AccountConfig|null} 找到的第一个账号，不存在则返回 null
     * @throws {Error} 子类必须实现此方法
     *
     * @example
     * // 查找特定邮箱的账号
     * const account = store.findAccount(a => a.cachedEmail === 'user@example.com');
     *
     * // 查找错误次数过多的账号
     * const badAccount = store.findAccount(a => a.errorCount > 5);
     */
    findAccount(predicate) {
        throw new Error('AccountStore.findAccount() must be implemented by subclass');
    }
}
