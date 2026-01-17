/**
 * 账号池管理器基类
 *
 * 提供账号池管理的通用接口和公共实现。
 * 具体实现（SQLite、JSON 等）只需实现存储层特定逻辑。
 *
 * @module domain/account-pool/BaseAccountPoolManager
 */

import { createLogger } from '../../lib/logger.js';

const logger = createLogger('account-pool:base');

/**
 * 抽象账号池管理器
 *
 * 提供健康检查、选择账号与状态更新的通用实现。
 * 子类需要实现存储层相关的方法。
 */
export class BaseAccountPoolManager {
    /**
     * 创建账号池管理器
     *
     * @param {Object} options - 配置项
     * @param {Object} options.globalConfig - 全局配置
     * @param {string} options.modelProvider - 模型提供商
     * @param {number} options.maxErrorCount - 最大错误次数
     * @param {number} options.healthCheckInterval - 健康检查间隔（毫秒）
     * @param {string} options.logLevel - 日志级别
     */
    constructor(options = {}) {
        if (new.target === BaseAccountPoolManager) {
            throw new Error('BaseAccountPoolManager 是抽象类，不能直接实例化');
        }

        this.globalConfig = options.globalConfig || {};
        this.modelProvider = options.modelProvider || this.globalConfig.MODEL_PROVIDER || 'claude-kiro-oauth';
        this.maxErrorCount = options.maxErrorCount ?? 3;
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000;
        this.logLevel = options.logLevel || 'info';
        this.logger = createLogger('account-pool:base');

        // 轮询索引（内存中维护）
        this.roundRobinIndex = {};
    }

    // =========================================================================
    // 抽象方法（子类必须实现）
    // =========================================================================

    /**
     * 列出账号配置
     *
     * @abstract
     * @returns {Array<Object>} 账号配置列表
     */
    listAccounts() {
        throw new Error('listAccounts 方法必须被子类实现');
    }

    /**
     * 获取健康账号列表
     *
     * @abstract
     * @param {string|null} [requestedModel=null] - 可选模型过滤
     * @returns {Array<Object>} 健康账号列表
     */
    getHealthyAccounts(requestedModel = null) {
        throw new Error('getHealthyAccounts 方法必须被子类实现');
    }

    /**
     * 增加账号使用计数
     *
     * @abstract
     * @param {string} uuid - 账号 UUID
     */
    incrementUsage(uuid) {
        throw new Error('incrementUsage 方法必须被子类实现');
    }

    /**
     * 标记账号为不健康
     *
     * @abstract
     * @param {string} uuid - 账号 UUID
     * @param {Error|string|null} [errorOrMessage=null] - 错误信息
     * @param {Object} [options={}] - 选项
     */
    markAccountUnhealthy(uuid, errorOrMessage = null, options = {}) {
        throw new Error('markAccountUnhealthy 方法必须被子类实现');
    }

    /**
     * 标记账号为健康
     *
     * @abstract
     * @param {string} uuid - 账号 UUID
     * @param {Object} [options={}] - 选项
     */
    markAccountHealthy(uuid, options = {}) {
        throw new Error('markAccountHealthy 方法必须被子类实现');
    }

    /**
     * 禁用账号
     *
     * @abstract
     * @param {string} uuid - 账号 UUID
     */
    disableAccount(uuid) {
        throw new Error('disableAccount 方法必须被子类实现');
    }

    /**
     * 启用账号
     *
     * @abstract
     * @param {string} uuid - 账号 UUID
     */
    enableAccount(uuid) {
        throw new Error('enableAccount 方法必须被子类实现');
    }

    /**
     * 获取账号池统计信息
     *
     * @abstract
     * @returns {Object|null} 统计信息
     */
    getPoolStats() {
        throw new Error('getPoolStats 方法必须被子类实现');
    }

    // =========================================================================
    // 通用实现方法
    // =========================================================================

    /**
     * 选择一个可用账号（通用实现）
     *
     * @param {string|null} [requestedModel=null] - 可选模型过滤
     * @param {Object} [options={}] - 选项
     * @param {boolean} options.skipUsageCount - 是否跳过使用计数
     * @returns {Object|null} 账号配置或 null
     */
    selectAccount(requestedModel = null, options = {}) {
        const healthyAccounts = this.getHealthyAccounts(requestedModel);

        if (healthyAccounts.length === 0) {
            this._log('warn', `No healthy accounts${requestedModel ? ` supporting ${requestedModel}` : ''}`);
            return null;
        }

        const indexKey = requestedModel ? `model:${requestedModel}` : 'default';
        const currentIndex = this.roundRobinIndex[indexKey] || 0;
        const selectedIndex = currentIndex % healthyAccounts.length;
        const selected = healthyAccounts[selectedIndex];

        this.roundRobinIndex[indexKey] = (currentIndex + 1) % healthyAccounts.length;

        if (!options.skipUsageCount) {
            this.incrementUsage(selected.uuid);
        }

        return selected.config || selected;
    }

    /**
     * 构造健康检查请求体（通用实现，兼容不同 API 形态）
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
}
