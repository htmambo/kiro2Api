/**
 * AccountManager - 账号管理器
 *
 * 该模块负责账号的业务逻辑，包括：
 * - 轮询选择账号
 * - 健康检查调度
 * - 错误处理
 *
 * 设计理念：
 * - 极简：只包含核心业务逻辑
 * - 状态管理：维护轮询索引等状态
 * - 依赖注入：接受 store 实例，不直接创建
 *
 * @module kiro/account-manager
 */

import { createLogger } from '../lib/logger.js';

const logger = createLogger('kiro:account-manager');

/**
 * AccountManager 类
 *
 * @class
 */
export class AccountManager {
    /**
     * 创建 AccountManager 实例
     *
     * @param {Object} store - 账号存储实例（AccountStore 接口）
     * @param {Object} [options] - ��置选项
     * @param {number} [options.maxErrorCount=3] - 最大错误次数
     * @param {number} [options.healthCheckInterval=10*60*1000] - 健康检查间隔（毫秒）
     * @param {string} [options.logLevel='info'] - 日志级别
     * @throws {Error} 如果 store 不是有效的 AccountStore 实现
     */
    constructor(store, options = {}) {
        // 验证 store 参数
        if (!store || typeof store.listAccounts !== 'function') {
            throw new Error('AccountManager requires a valid AccountStore implementation');
        }

        /**
         * 账号存储实例
         * @type {Object}
         * @private
         */
        this.store = store;

        /**
         * 最大错误次数
         * @type {number}
         * @private
         */
        this.maxErrorCount = options.maxErrorCount ?? 3;

        /**
         * 健康检查间隔（毫秒）
         * @type {number}
         * @private
         */
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000; // 默认 10 ��钟

        /**
         * 日志级别
         * @type {string}
         * @private
         */
        this.logLevel = options.logLevel || 'info';

        /**
         * 轮询索引（按模型分组）
         *
         * 格式：{ 'default': 0, 'model:claude-3-opus': 1, ... }
         *
         * @type {Object}
         * @private
         */
        this.roundRobinIndex = {};
    }

    // ==================== 核心业务逻辑：选择账号 ====================

    /**
     * 选择一个可用账号（轮询策略）
     *
     * 该方法实现了按模型分组的轮询选择逻辑：
     * 1. 过滤出健康且未禁用的账号
     * 2. 过滤出支持请求模型的账号
     * 3. 使用轮询索引选择账号
     * 4. 更新账号的使用统计
     *
     * @param {string|null} [requestedModel] - 请求的模型名称
     * @param {Object} [options] - 选择选项
     * @param {boolean} [options.skipUsageCount] - 是否跳过使用计数更新
     * @returns {Object|null} 选中的账号配置对象，无可用账号返回 null
     *
     * @example
     * // 选择默认账号
     * const account = manager.selectAccount();
     *
     * @example
     * // 选择支持特定模型的账号
     * const account = manager.selectAccount('claude-3-opus');
     *
     * @example
     * // 选择账号但不更新使用计数
     * const account = manager.selectAccount(null, { skipUsageCount: true });
     */
    selectAccount(requestedModel = null, options = {}) {
        try {
            // 1. 获取所有候选账号
            const candidates = (this.store.listAccounts() || [])
                .filter(acc => acc && acc.uuid)
                .filter(acc => acc.isHealthy && !acc.isDisabled)
                .filter(acc => {
                    // 如果没有指定模型，所有账号都可用
                    if (!requestedModel) {
                        return true;
                    }
                    // 如果账号没有 notSupportedModels 字段，认为支持所有模型
                    if (!Array.isArray(acc.notSupportedModels)) {
                        return true;
                    }
                    // 检查账号是否支持请求的模型
                    return !acc.notSupportedModels.includes(requestedModel);
                });

            // 2. 检查是否有可用账号
            if (candidates.length === 0) {
                logger.warn(
                    `No healthy accounts available${requestedModel ? ` supporting model: ${requestedModel}` : ''}`
                );
                return null;
            }

            // 3. 使用轮询索引选择账号
            const indexKey = requestedModel ? `model:${requestedModel}` : 'default';
            const currentIndex = this.roundRobinIndex[indexKey] || 0;
            const selectedIndex = currentIndex % candidates.length;
            const selected = candidates[selectedIndex];

            // 4. 更新轮询索引
            this.roundRobinIndex[indexKey] = (currentIndex + 1) % candidates.length;

            // 5. 更新使用统计（如果需要）
            if (!options.skipUsageCount && selected?.uuid) {
                const now = new Date().toISOString();
                const usageCount = (selected.usageCount || 0) + 1;

                this.store.updateAccount(selected.uuid, {
                    lastUsed: now,
                    usageCount
                });

                // 同步更新返回对象的属性
                selected.lastUsed = now;
                selected.usageCount = usageCount;
            }

            // 6. 记录日志
            logger.debug(
                `Selected account: ${selected.uuid}${requestedModel ? ` (model: ${requestedModel})` : ''}${
                    options.skipUsageCount ? ' (skip usage count)' : ''
                }`
            );

            return selected;
        } catch (error) {
            logger.error('Failed to select account:', error);
            return null;
        }
    }

    // ==================== 核心业务逻辑：健康检查 ====================

    /**
     * 执行健康检查
     *
     * 该方法遍历所有账号，对需要检查的账号执行健康检查：
     * 1. 跳过禁用的账号
     * 2. 检查距离上次检查的时间间隔
     * 3. 执行单个账号的健康检查
     *
     * 注意：如果不提供 healthCheckFn，健康检查将被跳过并记录警告。
     *
     * @param {boolean} [isInit=false] - 是否为初始化检查（忽略时间间隔）
     * @param {Function} [healthCheckFn] - 自定义健康检查函数（可选）
     * @returns {Promise<void>}
     *
     * @example
     * // 初始化时对所有账号执行健康检查
     * await manager.performHealthChecks(true);
     *
     * @example
     * // 定期健康检查（跳过未到间隔的账号）
     * await manager.performHealthChecks(false);
     *
     * @example
     * // 使用自定义健康检查函数
     * await manager.performHealthChecks(false, async (account) => {
     *     // 自定义检查逻辑
     *     return { success: true };
     * });
     */
    async performHealthChecks(isInit = false, healthCheckFn) {
        try {
            const accounts = (this.store.listAccounts() || []).filter(acc => acc && acc.uuid);

            if (accounts.length === 0) {
                logger.debug('No accounts to check');
                return;
            }

            // 如果没有提供健康检查函数，记录警告并跳过
            if (!healthCheckFn) {
                logger.warn('Health check function not provided, skipping health checks. ' +
                    'Please provide a healthCheckFn parameter to enable health checks.');
                return;
            }

            logger.debug(`Starting health checks for ${accounts.length} accounts (isInit: ${isInit})`);

            const now = Date.now();
            let checkedCount = 0;
            let passedCount = 0;
            let failedCount = 0;

            for (const account of accounts) {
                // 跳过禁用的账号
                if (account.isDisabled) {
                    continue;
                }

                // 检查时间间隔（初始化时跳过）
                if (!isInit && account.lastHealthCheckTime) {
                    const last = Date.parse(account.lastHealthCheckTime);
                    if (!Number.isNaN(last) && now - last < this.healthCheckInterval) {
                        continue;
                    }
                }

                // 执行单个账号的健康检查
                const result = await this._performSingleHealthCheck(account, healthCheckFn);
                checkedCount++;

                if (result === 'passed') {
                    passedCount++;
                } else if (result === 'failed') {
                    failedCount++;
                }
            }

            logger.info(
                `Health checks completed: ${checkedCount} checked, ${passedCount} passed, ${failedCount} failed`
            );
        } catch (error) {
            logger.error('Failed to perform health checks:', error);
        }
    }

    /**
     * 检查单个账号的健康状态
     *
     * @private
     * @param {Object} accountConfig - 账号配置对象
     * @param {Function} healthCheckFn - 健康检查函数
     * @returns {Promise<string>} 'passed' | 'failed' | 'skipped'
     */
    async _performSingleHealthCheck(accountConfig, healthCheckFn) {
        const { uuid } = accountConfig;

        try {
            // 调用健康检查函数
            const result = await healthCheckFn(accountConfig);

            // 更新健康状态
            if (result.success) {
                this.store.updateAccount(uuid, {
                    isHealthy: true,
                    errorCount: 0,
                    lastHealthCheckTime: new Date().toISOString(),
                    lastHealthCheckModel: result.modelName
                });
                logger.debug(`Health check passed: ${uuid}`);
                return 'passed';
            } else {
                this.store.updateAccount(uuid, {
                    isHealthy: false,
                    lastErrorTime: new Date().toISOString(),
                    lastErrorMessage: result.errorMessage
                });
                logger.warn(`Health check failed: ${uuid} - ${result.errorMessage}`);
                return 'failed';
            }
        } catch (error) {
            logger.error(`Health check error for ${uuid}:`, error);
            this.store.updateAccount(uuid, {
                isHealthy: false,
                lastErrorTime: new Date().toISOString(),
                lastErrorMessage: error.message
            });
            return 'failed';
        }
    }

    // ==================== 错误处理 ====================

    /**
     * 标记账号为不健康（错误处理）
     *
     * 当使用账号时发生错误，调用此方法更新账号状态。
     *
     * @param {string} uuid - 账号 UUID
     * @param {Error|string} error - 错误对象或错误消息
     * @returns {boolean} 是否成功标记
     *
     * @example
     * try {
     *     await apiCall(account);
     * } catch (error) {
     *     manager.markAccountUnhealthy(account.uuid, error);
     * }
     */
    markAccountUnhealthy(uuid, error) {
        try {
            const account = this.store.getAccount(uuid);
            if (!account) {
                logger.warn(`Account not found: ${uuid}`);
                return false;
            }

            const errorCount = (account.errorCount || 0) + 1;
            const updates = {
                isHealthy: false,
                errorCount,
                lastErrorTime: new Date().toISOString(),
                lastErrorMessage: error?.message || String(error)
            };

            // 如果错误次数超过阈值，禁用账号
            if (errorCount >= this.maxErrorCount) {
                updates.isDisabled = true;
                logger.error(`Account disabled due to too many errors: ${uuid}`);
            }

            this.store.updateAccount(uuid, updates);

            logger.debug(
                `Marked account as unhealthy: ${uuid} (errorCount: ${errorCount}, disabled: ${updates.isDisabled})`
            );

            return true;
        } catch (err) {
            logger.error(`Failed to mark account as unhealthy (${uuid}):`, err);
            return false;
        }
    }

    /**
     * 标记账号为健康
     *
     * @param {string} uuid - 账号 UUID
     * @returns {boolean} 是否成功标记
     *
     * @example
     * manager.markAccountHealthy(account.uuid);
     */
    markAccountHealthy(uuid) {
        try {
            const result = this.store.updateAccount(uuid, {
                isHealthy: true,
                errorCount: 0,
                lastErrorMessage: null
            });

            if (result) {
                logger.debug(`Marked account as healthy: ${uuid}`);
            }

            return result;
        } catch (error) {
            logger.error(`Failed to mark account as healthy (${uuid}):`, error);
            return false;
        }
    }

    // ==================== 辅助方法 ====================

    /**
     * 获取账号存储实例
     *
     * @returns {Object} 账号存储实例
     *
     * @example
     * const store = manager.getStore();
     * const accounts = store.listAccounts();
     */
    getStore() {
        return this.store;
    }

    /**
     * 重置轮询索引
     *
     * 当账号列表发生变化时，可以调用此方法重置轮询索引。
     *
     * @example
     * manager.resetRoundRobinIndex();
     */
    resetRoundRobinIndex() {
        this.roundRobinIndex = {};
        logger.debug('Round-robin index reset');
    }

    /**
     * 获取统计信息
     *
     * @returns {Object} 统计信息对象
     *
     * @example
     * const stats = manager.getStats();
     * console.log('Total accounts:', stats.total);
     */
    getStats() {
        try {
            const accounts = this.store.listAccounts() || [];

            return {
                total: accounts.length,
                healthy: accounts.filter(a => a.isHealthy).length,
                unhealthy: accounts.filter(a => !a.isHealthy).length,
                disabled: accounts.filter(a => a.isDisabled).length,
                enabled: accounts.filter(a => !a.isDisabled).length
            };
        } catch (error) {
            logger.error('Failed to get stats:', error);
            return {
                total: 0,
                healthy: 0,
                unhealthy: 0,
                disabled: 0,
                enabled: 0
            };
        }
    }

    /**
     * 获取账号池统计信息（向后兼容方法）
     *
     * @returns {Object} 统计信息对象
     */
    getPoolStats() {
        return this.getStats();
    }

    /**
     * 获取账号池详细信息（向后兼容方法）
     *
     * @returns {Object} 详细信息对象
     */
    getPoolDetails() {
        try {
            const accounts = this.store.listAccounts() || [];

            return {
                accounts: accounts.map(account => ({
                    uuid: account.uuid,
                    isHealthy: account.isHealthy,
                    isDisabled: account.isDisabled,
                    usageCount: account.usageCount || 0,
                    errorCount: account.errorCount || 0,
                    lastUsed: account.lastUsed,
                    lastErrorTime: account.lastErrorTime,
                    lastErrorMessage: account.lastErrorMessage,
                    cachedEmail: account.cachedEmail,
                    cachedUserId: account.cachedUserId
                }))
            };
        } catch (error) {
            logger.error('Failed to get pool details:', error);
            return { accounts: [] };
        }
    }
}

export default AccountManager;
