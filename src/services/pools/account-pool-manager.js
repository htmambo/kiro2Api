import * as fs from 'fs';
import * as path from 'path';
import { getServiceAdapter } from '../../kiro/claude-kiro.js';

/**
 * Account Pool Manager - 单一账号池管理器（移除 providerType 概念）
 *
 * 兼容字段（与旧 providerPools 中单个 providerConfig 保持一致）：
 * - uuid
 * - isHealthy / isDisabled
 * - usageCount / errorCount / lastUsed
 * - notSupportedModels（数组）等
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

        // 保存与防抖
        this.accountPoolFilePath = options.accountPoolFilePath ||
            this.globalConfig.ACCOUNT_POOL_FILE_PATH ||
            'configs/account_pool.json';
        this.saveDebounceTime = options.saveDebounceTime || 1000;
        this.saveTimer = null;

        // 轮询索引（按 requestedModel 区分）
        this.roundRobinIndex = {};

        this._initializeAccountDefaults();
    }

    _log(level, message) {
        const levels = { debug: 0, info: 1, warn: 2, error: 3 };
        if (levels[level] >= levels[this.logLevel]) {
            const logMethod = level === 'debug' ? 'log' : level;
            console[logMethod](`[AccountPoolManager] ${message}`);
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

    listAccounts() {
        return this.accountPool.accounts;
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
                // 复用 messages 接口做最小请求
                if (typeof adapter?.generateContent !== 'function') {
                    return { success: false, modelName, errorMessage: 'Service adapter does not support generateContent()' };
                }
                await adapter.generateContent(modelName, req);
                return { success: true, modelName, errorMessage: null, userInfo: null };
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
