import * as fs from 'fs';
import * as path from 'path';
import { getServiceAdapter } from '../../services/manager.js';
import { generateContent } from '../../kiro/api-client.js';
import { createLogger } from '../../lib/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Account Pool Manager - 单一账号池管理器（移除 providerType 概念）
 */
export class AccountPoolManager {
    // 默认健康检查模型配置（目前主要用于 Kiro OAuth）
    static DEFAULT_HEALTH_CHECK_MODEL = 'claude-sonnet-4-20250514';

    constructor(accountPool = { accounts: [] }, options = {}) {
        this.accountPool = accountPool && typeof accountPool === 'object'
            ? accountPool
            : { accounts: [] };

        if (!Array.isArray(this.accountPool.accounts)) {
            this.accountPool.accounts = [];
        }

        this.globalConfig = options.globalConfig || {};
        this.modelProvider = options.modelProvider || this.globalConfig.MODEL_PROVIDER || 'claude-kiro-oauth';
        this.maxErrorCount = options.maxErrorCount ?? 3;
        this.healthCheckInterval = options.healthCheckInterval ?? 10 * 60 * 1000;
        this.logLevel = options.logLevel || 'info';
        this.logger = createLogger('services:pools:json');

        // 保存与防抖
        this.accountPoolFilePath = options.accountPoolFilePath ||
            this.globalConfig.ACCOUNT_POOL_FILE_PATH ||
            'configs/account_pool.json';
        this.saveDebounceTime = options.saveDebounceTime || 1000;
        this.saveTimer = null;

        // 轮询索引（按 requestedModel 区分）
        this.roundRobinIndex = {};
        // 如果账号池为空，尝试从文件中加载
        if (this.accountPool.accounts.length === 0) {
            this.loadAccountPool();
        }

        this._initializeAccountDefaults();
    }

    loadAccountPool() {
        const filePath = this.accountPoolFilePath;
        if (!filePath) {
            this.logger.error('No account pool file path specified');
            return;
        }
        try {
            const data = fs.readFileSync(filePath, 'utf-8');
            const accountPool = JSON.parse(data);
            this.accountPool.accounts = accountPool.accounts || [];
            this.logger.info(`Loaded account pool from ${filePath}`);
        } catch (error) {
            this.logger.error(`Failed to load account pool from ${filePath}: ${error.message}`);
        }
    }
    _log(level, message) {
        const levels = { verbose: -1, debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            this.logger[level](message);
        }
    }

    _initializeAccountDefaults() {
        for (const account of this.accountPool.accounts) {
            if (!account || typeof account !== 'object') continue;
            account.isHealthy = account.isHealthy !== undefined ? account.isHealthy : true;
            account.isDisabled = account.isDisabled !== undefined ? account.isDisabled : false;
            account.lastUsed = account.lastUsed !== undefined ? account.lastUsed : null;
            account.usageCount = account.usageCount !== undefined ? account.usageCount : 0;
            account.errorCount = account.errorCount !== undefined ? account.errorCount : 0;
            account.lastErrorTime = account.lastErrorTime instanceof Date
                ? account.lastErrorTime.toISOString()
                : (account.lastErrorTime || null);
            account.lastHealthCheckTime = account.lastHealthCheckTime || null;
            account.lastHealthCheckModel = account.lastHealthCheckModel || null;
            account.lastErrorMessage = account.lastErrorMessage || null;
        }
        this._log('info', `Initialized account pool: ${this.accountPool.accounts.length} account(s) (maxErrorCount: ${this.maxErrorCount})`);
    }

    /**
     * 替换账号池数据（用于配置热更新 / 初始化延迟）
     * @param {Object} accountPool - { accounts: [] }
     */
    setAccountPool(accountPool) {
        const nextPool = accountPool && typeof accountPool === 'object'
            ? accountPool
            : { accounts: [] };

        if (!Array.isArray(nextPool.accounts)) {
            nextPool.accounts = [];
        }

        this.accountPool = nextPool;
        this._initializeAccountDefaults();
        this._debouncedSave();
    }

    _findAccount(uuid) {
        if (!uuid) return null;
        return this.accountPool.accounts.find((acc) => acc && acc.uuid === uuid) || null;
    }

    _debouncedSave() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            try {
                const dirName = path.dirname(this.accountPoolFilePath);
                if (dirName && dirName !== '.' && !fs.existsSync(dirName)) {
                    fs.mkdirSync(dirName, { recursive: true });
                }
                fs.writeFileSync(this.accountPoolFilePath, JSON.stringify(this.accountPool, null, 2), 'utf8');
                this._log('debug', `Saved account pool to ${this.accountPoolFilePath}`);
            } catch (error) {
                this._log('error', `Failed to save account pool: ${error.message}`);
            }
        }, this.saveDebounceTime);
    }

    /**
     * 列出所有账号
     * @returns {Array} 账号数组
     */
    listAccounts() {
        return this.accountPool.accounts;
    }

    /**
     * 获取单个账号
     * @param {string} uuid - 账号 UUID
     * @returns {Object|null} 账号对象或 null
     */
    getAccount(uuid) {
        if (!uuid) {
            this._log('warn', 'getAccount: uuid is required');
            return null;
        }
        return this._findAccount(uuid);
    }

    /**
     * 按条件查找账号
     * @param {Function} predicate - 查找条件函数
     * @returns {Object|null} 找到的账号或 null
     */
    findAccount(predicate) {
        if (typeof predicate !== 'function') {
            this._log('warn', 'findAccount: predicate must be a function');
            return null;
        }
        try {
            return this.accountPool.accounts.find(predicate) || null;
        } catch (error) {
            this._log('error', `findAccount: predicate threw error: ${error.message}`);
            return null;
        }
    }

    /**
     * 添加完整账号配置
     * @param {Object} accountConfig - 账号配置对象
     * @returns {Object} 添加的账号对象（包含生成的 UUID）
     */
    addAccount(accountConfig) {
        if (!accountConfig || typeof accountConfig !== 'object') {
            this._log('error', 'addAccount: accountConfig must be an object');
            throw new Error('accountConfig must be an object');
        }

        try {
            // 创建副本避免修改原对象
            const sanitizedConfig = { ...accountConfig };

            // 生成 UUID（如果没有提供）
            if (!sanitizedConfig.uuid) {
                sanitizedConfig.uuid = uuidv4();
            }

            // 设置默认值
            const newAccount = {
                ...sanitizedConfig,
                uuid: sanitizedConfig.uuid,
                isHealthy: sanitizedConfig.isHealthy !== undefined ? sanitizedConfig.isHealthy : true,
                isDisabled: sanitizedConfig.isDisabled !== undefined ? sanitizedConfig.isDisabled : false,
                lastUsed: sanitizedConfig.lastUsed || null,
                usageCount: sanitizedConfig.usageCount || 0,
                errorCount: sanitizedConfig.errorCount || 0,
                lastErrorTime: sanitizedConfig.lastErrorTime || null,
                lastHealthCheckTime: sanitizedConfig.lastHealthCheckTime || null,
                lastHealthCheckModel: sanitizedConfig.lastHealthCheckModel || null,
                lastErrorMessage: sanitizedConfig.lastErrorMessage || null,
                notSupportedModels: Array.isArray(sanitizedConfig.notSupportedModels)
                    ? sanitizedConfig.notSupportedModels
                    : []
            };

            this.accountPool.accounts.push(newAccount);
            this._log('info', `Added account: ${newAccount.uuid}`);
            this._debouncedSave();
            return newAccount;
        } catch (error) {
            this._log('error', `addAccount failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * 删除账号
     * @param {string} uuid - 账号 UUID
     * @returns {boolean} 是否成功删除
     */
    removeAccount(uuid) {
        if (!uuid) {
            this._log('warn', 'removeAccount: uuid is required');
            return false;
        }

        const initialLength = this.accountPool.accounts.length;
        this.accountPool.accounts = this.accountPool.accounts.filter(a => a.uuid !== uuid);
        const removed = this.accountPool.accounts.length < initialLength;

        if (removed) {
            this._log('info', `Removed account: ${uuid}`);
            this._debouncedSave();
        } else {
            this._log('warn', `Account not found for removal: ${uuid}`);
        }

        return removed;
    }

    /**
     * 更新账号属性
     * @param {string} uuid - 账号 UUID
     * @param {Object} updates - 要更新的属性对象
     * @returns {boolean} 是否成功更新
     */
    updateAccount(uuid, updates) {
        if (!uuid) {
            this._log('warn', 'updateAccount: uuid is required');
            return false;
        }

        const account = this._findAccount(uuid);
        if (!account) {
            this._log('warn', `Account not found for update: ${uuid}`);
            return false;
        }

        if (!updates || typeof updates !== 'object') {
            this._log('warn', 'updateAccount: updates must be an object');
            return false;
        }

        try {
            // 合并更新
            Object.assign(account, updates);
            this._log('info', `Updated account: ${uuid}`);
            this._debouncedSave();
            return true;
        } catch (error) {
            this._log('error', `updateAccount failed for ${uuid}: ${error.message}`);
            return false;
        }
    }

    /**
     * 切换账号启用/禁用状态
     * @param {string} uuid - 账号 UUID
     * @returns {boolean} 切换后的 isDisabled 状态，如果账号不存在返回 null
     */
    toggleAccount(uuid) {
        if (!uuid) {
            this._log('warn', 'toggleAccount: uuid is required');
            return null;
        }

        const account = this._findAccount(uuid);
        if (!account) {
            this._log('warn', `Account not found in toggleAccount: ${uuid}`);
            return null;
        }

        account.isDisabled = !account.isDisabled;
        this._log('info', `Toggled account ${uuid}: isDisabled=${account.isDisabled}`);
        this._debouncedSave();
        return account.isDisabled;
    }

    /**
     * 批量删除账号
     * @param {Array<string>} uuids - 账号 UUID 数组
     * @returns {number} 删除的账号数量
     */
    batchDeleteAccounts(uuids) {
        if (!Array.isArray(uuids)) {
            this._log('warn', 'batchDeleteAccounts: uuids must be an array');
            return 0;
        }

        const initialLength = this.accountPool.accounts.length;
        const uuidSet = new Set(uuids);
        this.accountPool.accounts = this.accountPool.accounts.filter(a => !uuidSet.has(a.uuid));
        const removed = initialLength - this.accountPool.accounts.length;

        if (removed > 0) {
            this._log('info', `Batch deleted ${removed} account(s)`);
            this._debouncedSave();
        }

        return removed;
    }

    /**
     * 按状态批量删除账号
     * @param {Array<string>} statusTypes - 状态类型数组 ['banned', 'expired', 'quota_exceeded', etc.]
     * @returns {Object} { removed: number, uuids: Array<string> }
     */
    batchDeleteByStatus(statusTypes) {
        if (!Array.isArray(statusTypes)) {
            this._log('warn', 'batchDeleteByStatus: statusTypes must be an array');
            return { removed: 0, uuids: [] };
        }

        if (statusTypes.length === 0) {
            this._log('warn', 'batchDeleteByStatus: statusTypes array is empty');
            return { removed: 0, uuids: [] };
        }

        const toDelete = [];

        for (const account of this.accountPool.accounts) {
            const errorStatus = this._parseErrorStatus(account.lastErrorMessage);

            // 检查是否匹配任一指定状态
            if (statusTypes.includes(errorStatus.statusType)) {
                toDelete.push(account.uuid);
            } else if (statusTypes.includes('banned') && (account.isDisabled || !account.isHealthy)) {
                toDelete.push(account.uuid);
            } else if (statusTypes.includes('disabled') && account.isDisabled) {
                toDelete.push(account.uuid);
            }
        }

        const removed = this.batchDeleteAccounts(toDelete);
        return { removed, uuids: toDelete };
    }

    /**
     * 解析错误消息，返回状态类型
     * @param {string} errorMessage - 错误消息
     * @returns {Object} { status, message, statusType }
     */
    _parseErrorStatus(errorMessage) {
        if (!errorMessage) {
            return { status: '正常', message: '', statusType: 'ok' };
        }

        const msg = errorMessage.toLowerCase();

        if (msg.includes('403') || msg.includes('forbidden') || msg.includes('suspended') || msg.includes('locked')) {
            return { status: '封禁', message: '账号已被封禁，无法使用', statusType: 'banned' };
        }
        if (msg.includes('402') || msg.includes('payment') || msg.includes('quota') || msg.includes('limit exceeded')) {
            return { status: '额度用尽', message: '账号额度已用完', statusType: 'quota_exceeded' };
        }
        if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid token') || msg.includes('expired')) {
            return { status: '过期', message: 'Token 已失效，需要重新授权', statusType: 'expired' };
        }
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
            return { status: '限流', message: '请求过于频繁，稍后自动恢复', statusType: 'rate_limit' };
        }
        if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('server error')) {
            return { status: '服务异常', message: '服务器暂时不可用', statusType: 'server_error' };
        }
        if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused')) {
            return { status: '网络错误', message: '网络连接失败', statusType: 'network_error' };
        }

        return { status: '异常', message: errorMessage, statusType: 'unknown' };
    }

    /**
     * 重置单个账号健康状态
     * @param {string} uuid - 账号 UUID
     * @returns {boolean} 是否成功重置
     */
    resetAccountHealth(uuid) {
        const account = this._findAccount(uuid);
        if (!account) {
            this._log('warn', `Account not found in resetAccountHealth: ${uuid}`);
            return false;
        }

        account.isHealthy = true;
        account.errorCount = 0;
        account.lastErrorTime = null;
        account.lastErrorMessage = null;
        account.lastHealthCheckTime = new Date().toISOString();

        this._log('info', `Reset health for account: ${uuid}`);
        this._debouncedSave();
        return true;
    }

    /**
     * 按状态获取账号列表
     * @param {string} statusType - 状态类型 ('healthy', 'unhealthy', 'disabled', 'banned', 'checking')
     * @returns {Array} 符合条件的账号数组
     */
    getAccountsByStatus(statusType) {
        if (!statusType || typeof statusType !== 'string') {
            this._log('warn', 'getAccountsByStatus: statusType must be a non-empty string');
            return [];
        }

        switch (statusType) {
            case 'healthy':
                return this.accountPool.accounts.filter(a =>
                    a.isHealthy && !a.isDisabled && (!a.errorCount || a.errorCount === 0)
                );
            case 'unhealthy':
                return this.accountPool.accounts.filter(a => !a.isHealthy);
            case 'disabled':
                return this.accountPool.accounts.filter(a => a.isDisabled);
            case 'banned':
                return this.accountPool.accounts.filter(a => a.isDisabled || !a.isHealthy);
            case 'checking':
                return this.accountPool.accounts.filter(a =>
                    a.isHealthy && !a.isDisabled && a.errorCount > 0
                );
            default:
                this._log('warn', `Unknown status type: ${statusType}`);
                return [];
        }
    }

    /**
     * 查找重复账号（相同 cachedUserId）
     * @returns {Object} { duplicates: Array, summary: Object }
     */
    findDuplicateAccounts() {
        try {
            const userIdGroups = {};
            const noUserIdAccounts = [];

            for (const account of this.accountPool.accounts) {
                if (account.cachedUserId) {
                    if (!userIdGroups[account.cachedUserId]) {
                        userIdGroups[account.cachedUserId] = [];
                    }
                    userIdGroups[account.cachedUserId].push(account);
                } else {
                    noUserIdAccounts.push(account);
                }
            }

            const duplicates = [];
            for (const [userId, accounts] of Object.entries(userIdGroups)) {
                if (accounts.length > 1) {
                    duplicates.push({
                        userId,
                        email: accounts[0].cachedEmail,
                        accounts: accounts.map(a => ({
                            uuid: a.uuid,
                            path: a.KIRO_OAUTH_CREDS_FILE_PATH,
                            email: a.cachedEmail,
                            isHealthy: a.isHealthy,
                            isDisabled: a.isDisabled
                        }))
                    });
                }
            }

            return {
                duplicates,
                summary: {
                    totalAccounts: this.accountPool.accounts.length,
                    accountsWithUserId: Object.values(userIdGroups).reduce((sum, g) => sum + g.length, 0),
                    accountsWithoutUserId: noUserIdAccounts.length,
                    duplicateCount: duplicates.reduce((sum, d) => sum + d.accounts.length - 1, 0)
                }
            };
        } catch (error) {
            this._log('error', `findDuplicateAccounts failed: ${error.message}`);
            return {
                duplicates: [],
                summary: {
                    totalAccounts: this.accountPool.accounts.length,
                    accountsWithUserId: 0,
                    accountsWithoutUserId: 0,
                    duplicateCount: 0
                }
            };
        }
    }

    /**
     * 从文件显式加载账号池
     * @returns {boolean} 是否成功加载
     */
    loadFromFile() {
        try {
            if (!fs.existsSync(this.accountPoolFilePath)) {
                this._log('warn', `Account pool file not found: ${this.accountPoolFilePath}`);
                return false;
            }

            const fileContent = fs.readFileSync(this.accountPoolFilePath, 'utf8');
            const parsed = JSON.parse(fileContent);

            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.accounts)) {
                this.accountPool = parsed;
                this._initializeAccountDefaults();
                this._log('info', `Loaded account pool from file: ${this.accountPool.accounts.length} account(s)`);
                return true;
            } else {
                this._log('error', 'Invalid account pool file format');
                return false;
            }
        } catch (error) {
            this._log('error', `Failed to load account pool from file: ${error.message}`);
            return false;
        }
    }

    /**
     * 显式保存到文件（非防抖，立即保存）
     * @returns {boolean} 是否成功保存
     */
    saveToFile() {
        try {
            const dirName = path.dirname(this.accountPoolFilePath);
            if (dirName && dirName !== '.' && !fs.existsSync(dirName)) {
                fs.mkdirSync(dirName, { recursive: true });
            }
            fs.writeFileSync(this.accountPoolFilePath, JSON.stringify(this.accountPool, null, 2), 'utf8');
            this._log('info', `Saved account pool to file: ${this.accountPoolFilePath}`);
            return true;
        } catch (error) {
            this._log('error', `Failed to save account pool to file: ${error.message}`);
            return false;
        }
    }

    /**
     * 重新加载文件（丢弃内存中的更改）
     * @returns {boolean} 是否成功重新加载
     */
    reloadFromFile() {
        // 清除防抖定时器
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }

        const success = this.loadFromFile();
        if (success) {
            this._log('info', 'Reloaded account pool from disk');
        } else {
            this._log('error', 'Failed to reload account pool from disk');
        }
        return success;
    }

    addTokenFile(tokenFilePath) {
        const relativePath = path.relative(process.cwd(), tokenFilePath);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        const exists = this.accountPool.accounts.some(p => {
            const existingPath = (p.KIRO_OAUTH_CREDS_FILE_PATH || '').replace(/\\/g, '/');
            return existingPath === normalizedPath || existingPath === './' + normalizedPath;
        });

        if (!exists) {
            const newAccount = {
                uuid: uuidv4(),
                KIRO_OAUTH_CREDS_FILE_PATH: normalizedPath,
                isHealthy: true,
                isDisabled: false,
                lastUsed: null,
                usageCount: 0,
                errorCount: 0,
                lastErrorTime: null,
                lastHealthCheckTime: null,
                lastHealthCheckModel: null,
                lastErrorMessage: null,
            };
            this.accountPool.accounts.push(newAccount);
        }
        this._initializeAccountDefaults();
        this._debouncedSave();
    }

    /**
     * 选择一个健康账号（轮询）
     * @param {string|null} requestedModel
     * @param {Object} options
     * @param {boolean} options.skipUsageCount
     */
    selectAccount(requestedModel = null, options = {}) {
        const availableAndHealthyAccounts = this.accountPool.accounts
            .filter((acc) => acc && acc.uuid)
            .filter((acc) => acc.isHealthy && !acc.isDisabled)
            .filter((acc) => {
                if (!requestedModel) return true;
                if (!Array.isArray(acc.notSupportedModels)) return true;
                return !acc.notSupportedModels.includes(requestedModel);
            });

        if (availableAndHealthyAccounts.length === 0) {
            this._log('warn', `No healthy accounts available${requestedModel ? ` supporting model: ${requestedModel}` : ''}`);
            return null;
        }

        const indexKey = requestedModel ? `model:${requestedModel}` : 'default';
        const currentIndex = this.roundRobinIndex[indexKey] || 0;
        const selectedIndex = currentIndex % availableAndHealthyAccounts.length;
        const selected = availableAndHealthyAccounts[selectedIndex];
        this.roundRobinIndex[indexKey] = (currentIndex + 1) % availableAndHealthyAccounts.length;

        if (!options.skipUsageCount) {
            selected.lastUsed = new Date().toISOString();
            selected.usageCount = (selected.usageCount || 0) + 1;
            this._debouncedSave();
        }

        this._log('debug', `Selected account: ${selected.uuid}${requestedModel ? ` (model: ${requestedModel})` : ''}${options.skipUsageCount ? ' (skip usage count)' : ''}`);
        return selected;
    }

    markAccountUnhealthy(uuid, errorOrMessage = null) {
        const account = this._findAccount(uuid);
        if (!account) {
            this._log('warn', `Account not found in markAccountUnhealthy: ${uuid}`);
            return;
        }

        let isRetryableError = false;
        let isFatalError = false;
        let errorMessage = null;

        if (typeof errorOrMessage === 'object' && errorOrMessage !== null) {
            isRetryableError = errorOrMessage.isRateLimitError === true || errorOrMessage.retryable === true;
            errorMessage = errorOrMessage.message || String(errorOrMessage);
        } else if (typeof errorOrMessage === 'string') {
            errorMessage = errorOrMessage;
            isRetryableError = errorMessage && (
                errorMessage.includes('RATE_LIMIT_EXCEEDED') ||
                errorMessage.includes('429') ||
                errorMessage.includes('Too Many Requests') ||
                errorMessage.includes('Rate Limit')
            );
        }

        // 400 错误是请求格式问题，不是账号问题，不计入健康度
        const isClientRequestError = errorMessage && (
            errorMessage.includes('400') ||
            errorMessage.includes('Bad Request')
        );
        if (isClientRequestError) {
            this._log('info', `Client request error (400) for ${uuid}, not counting against account health`);
            return;
        }

        if (errorMessage) {
            const msg = errorMessage.toLowerCase();
            isFatalError =
                (msg.includes('400') && msg.includes('token refresh')) ||
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
        }

        if (!isRetryableError) {
            account.errorCount = (account.errorCount || 0) + 1;
            account.lastErrorTime = new Date().toISOString();
            if (errorMessage) {
                account.lastErrorMessage = errorMessage;
            }

            if (isFatalError) {
                account.isHealthy = false;
                this._log('warn', `Marked account as unhealthy (fatal error): ${uuid}. Error: ${errorMessage}`);
            } else if (account.errorCount >= this.maxErrorCount) {
                account.isHealthy = false;
                this._log('warn', `Marked account as unhealthy: ${uuid}. Total errors: ${account.errorCount}`);
            } else {
                this._log('warn', `Account ${uuid} error count: ${account.errorCount}/${this.maxErrorCount}. Still healthy.`);
            }
        } else {
            this._log('info', `Rate limit/retryable error for ${uuid}, not counting as fatal error. Error: ${errorMessage}`);
            if (errorMessage) {
                account.lastRetryableError = errorMessage;
                account.lastRetryableErrorTime = new Date().toISOString();
            }
        }

        this._debouncedSave();
    }

    markAccountHealthy(uuid, options = {}) {
        const account = this._findAccount(uuid);
        if (!account) {
            this._log('warn', `Account not found in markAccountHealthy: ${uuid}`);
            return;
        }

        const {
            resetUsageCount = false,
            healthCheckModel = null,
            userInfo = null
        } = options;

        account.isHealthy = true;
        account.errorCount = 0;
        account.lastErrorTime = null;
        account.lastErrorMessage = null;
        account.lastHealthCheckTime = new Date().toISOString();
        if (healthCheckModel) {
            account.lastHealthCheckModel = healthCheckModel;
        }

        if (userInfo) {
            if (userInfo.email && account.cachedEmail !== userInfo.email) {
                account.cachedEmail = userInfo.email;
                account.cachedAt = new Date().toISOString();
            }
            if (userInfo.userId && account.cachedUserId !== userInfo.userId) {
                account.cachedUserId = userInfo.userId;
            }
        }

        if (resetUsageCount) {
            account.usageCount = 0;
        } else {
            account.usageCount = (account.usageCount || 0) + 1;
            account.lastUsed = new Date().toISOString();
        }

        this._log('info', `Marked account as healthy: ${uuid}${resetUsageCount ? ' (usage count reset)' : ''}`);
        this._debouncedSave();
    }

    markAllAccountsUnhealthy() {
        this.accountPool.accounts.forEach((account) => {
            account.isHealthy = false;
            account.errorCount = 0;
            account.lastErrorTime = null;
            account.lastErrorMessage = null;
            account.lastHealthCheckTime = new Date().toISOString();
        });
        this._debouncedSave();
    }
    
    markAllAccountsHealthy() {
        this.accountPool.accounts.forEach((account) => {
            account.isHealthy = true;
            account.errorCount = 0;
            account.lastErrorTime = null;
            account.lastErrorMessage = null;
            account.lastHealthCheckTime = new Date().toISOString();
        });
        this._debouncedSave();
    }

    disableAccount(uuid) {
        const account = this._findAccount(uuid);
        if (!account) {
            this._log('warn', `Account not found in disableAccount: ${uuid}`);
            return;
        }
        account.isDisabled = true;
        this._log('info', `Disabled account: ${uuid}`);
        this._debouncedSave();
    }

    enableAccount(uuid) {
        const account = this._findAccount(uuid);
        if (!account) {
            this._log('warn', `Account not found in enableAccount: ${uuid}`);
            return;
        }
        account.isDisabled = false;
        this._log('info', `Enabled account: ${uuid}`);
        this._debouncedSave();
    }

    getPoolStats() {
        const accounts = this.accountPool.accounts;
        return {
            total: accounts.length,
            healthy: accounts.filter((a) => a && a.isHealthy && !a.isDisabled).length,
            unhealthy: accounts.filter((a) => a && !a.isHealthy).length,
            disabled: accounts.filter((a) => a && a.isDisabled).length,
            totalUsage: accounts.reduce((sum, a) => sum + (a?.usageCount || 0), 0),
            totalErrors: accounts.reduce((sum, a) => sum + (a?.errorCount || 0), 0)
        };
    }

    getPoolDetails() {
        return {
            accounts: this.accountPool.accounts.map((a) => ({
                uuid: a.uuid,
                isHealthy: a.isHealthy,
                isDisabled: a.isDisabled,
                usageCount: a.usageCount,
                errorCount: a.errorCount,
                lastUsed: a.lastUsed,
                lastErrorTime: a.lastErrorTime,
                lastErrorMessage: a.lastErrorMessage,
                lastHealthCheckTime: a.lastHealthCheckTime,
                lastHealthCheckModel: a.lastHealthCheckModel,
                cachedEmail: a.cachedEmail,
                cachedUserId: a.cachedUserId
            }))
        };
    }

    async performHealthChecks(isInit = false) {
        const accounts = this.accountPool.accounts.filter((a) => a && a.uuid);
        if (accounts.length === 0) return;

        const now = Date.now();

        for (const account of accounts) {
            if (account.isDisabled) continue;

            if (!isInit && account.lastHealthCheckTime) {
                const last = Date.parse(account.lastHealthCheckTime);
                if (!Number.isNaN(last) && (now - last) < this.healthCheckInterval) {
                    continue;
                }
            }

            await this._performSingleHealthCheck(account);
        }
    }

    _buildHealthCheckRequests(modelName) {
        const baseMessage = { role: 'user', content: 'Hi' };
        return [
            {
                messages: [baseMessage],
                model: modelName,
                max_tokens: 1
            },
            {
                contents: [{
                    role: 'user',
                    parts: [{ text: baseMessage.content }]
                }],
                max_tokens: 1
            }
        ];
    }

    async _checkAccountHealth(accountConfig, forceCheck = false) {
        const modelName = accountConfig.checkModelName || AccountPoolManager.DEFAULT_HEALTH_CHECK_MODEL;
        if (!accountConfig.checkHealth && !forceCheck) {
            return null;
        }

        const tempConfig = {
            ...this.globalConfig,
            ...accountConfig,
            MODEL_PROVIDER: this.modelProvider
        };

        const adapter = getServiceAdapter(tempConfig);

        const requests = this._buildHealthCheckRequests(modelName);
        let lastError = null;

        for (const req of requests) {
            try {
                if (typeof adapter?.initialize !== 'function') {
                    continue;
                }
                await generateContent(adapter, modelName, req);
                return { success: true, modelName, errorMessage: null };
            } catch (error) {
                lastError = error;
            }
        }

        return {
            success: false,
            modelName,
            errorMessage: lastError?.message || 'Health check failed'
        };
    }

    async _performSingleHealthCheck(accountConfig) {
        try {
            const healthResult = await this._checkAccountHealth(accountConfig);
            if (healthResult === null) {
                this._log('debug', `Health check skipped for ${accountConfig.uuid}`);
                return;
            }

            if (healthResult.success) {
                this.markAccountHealthy(accountConfig.uuid, {
                    resetUsageCount: true,
                    healthCheckModel: healthResult.modelName,
                    userInfo: healthResult.userInfo
                });
                this._log('debug', `Health check ok for ${accountConfig.uuid}`);
            } else {
                this._log('warn', `Health check failed for ${accountConfig.uuid}: ${healthResult.errorMessage || 'unknown error'}`);
                accountConfig.lastHealthCheckTime = new Date().toISOString();
                if (healthResult.modelName) {
                    accountConfig.lastHealthCheckModel = healthResult.modelName;
                }
                this.markAccountUnhealthy(accountConfig.uuid, healthResult.errorMessage);
            }
        } catch (error) {
            this._log('error', `Health check error for ${accountConfig.uuid}: ${error.message}`);
            this.markAccountUnhealthy(accountConfig.uuid, error.message);
        }
    }
}

let accountPoolManagerInstance = null;

/**
 * 获取 AccountPoolManager 单例（与现有调用点兼容）
 * @param {Object} options
 * @param {Object} options.accountPool - { accounts: [] }
 * @param {Object} options.globalConfig - 全局 config（用于 health check / file path）
 * @param {number} options.maxErrorCount
 * @param {string} options.accountPoolFilePath
 */
export function getAccountPoolManager(options = {}) {
    if (!accountPoolManagerInstance) {
        const accountPool = options.accountPool || { accounts: [] };
        accountPoolManagerInstance = new AccountPoolManager(accountPool, options);
    } else if (options.accountPool) {
        accountPoolManagerInstance.setAccountPool(options.accountPool);
    }
    return accountPoolManagerInstance;
}

export default AccountPoolManager;
