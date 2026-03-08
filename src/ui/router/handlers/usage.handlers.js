/**
 * 用量 Handler 实现。
 * @module ui/router/handlers/usage
 */
import path from 'path';
import { createLogger } from '../../../lib/logger.js';
import { logErrorInDev } from '../../../utils/error-logger.js';

import { MODEL_MAPPING } from "../../../kiro/model-config.js";
import { getUsageLimits } from '../../../kiro/api-client.js';
import { serviceInstances, getServiceAdapter } from '../../../services/manager.js';
import { readUsageCache, writeUsageCache } from '../../usage-cache.js';

const logger = createLogger('ui:handlers:usage');

/**
 * 获取所有用量。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse, currentConfig: object, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function getAllUsage({ req, res, currentConfig, accountPoolManager }) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const refresh = url.searchParams.get('refresh') === 'true';

        let usageResults;

        if (!refresh) {
            // 优先读取缓存，避免频繁请求
            const cachedData = await readUsageCache();
            if (cachedData) {
                usageResults = { ...cachedData, fromCache: true };
            }
        }

        if (!usageResults) {
            usageResults = await getAllProvidersUsage(currentConfig, accountPoolManager);
            await writeUsageCache(usageResults);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(usageResults));
    } catch (error) {
        logErrorInDev(error, {
            handler: 'getAllUsage',
            method: req.method,
            url: req.url,
            refresh: new URL(req.url, `http://${req.headers.host}`).searchParams.get('refresh')
        });

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 获取账号用量。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse, currentConfig: object, accountPoolManager: object, match: Array<string> }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function getAccountUsage({ req, res, currentConfig, accountPoolManager, match }) {
    const uuid = decodeURIComponent(match[1]);
    let usageResults;

    try {

        usageResults = await getAllProvidersUsage(currentConfig, accountPoolManager);
        const accountUsage = usageResults?.instances?.find(i => i.uuid === uuid);

        if (accountUsage) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, account: accountUsage }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `未找到账号 ${uuid}`, usageResults } }));
        }
    } catch (error) {
        logErrorInDev(error, {
            handler: 'getAccountUsage',
            method: req.method,
            url: req.url,
            uuid
        });

        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message, usageResults } }));
    }
}

/**
 * 获取模型列表。
 * @param {{ res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function getFullModels({ res }) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(Object.keys(MODEL_MAPPING)));
}

/**
 * 获取所有支持用量查询的提供商的用量信息。
 * @param {object} currentConfig - 当前配置。
 * @param {object} accountPoolManager - 账号池管理器。
 * @returns {Promise<object>} 所有提供商的用量信息。
 */
async function getAllProvidersUsage(currentConfig, accountPoolManager) {
    const results = {
        timestamp: new Date().toISOString(),
        providers: {}
    };

    // 支持用量查询的提供商列表 - 只支持 Kiro
    const supportedProviders = ['claude-kiro-oauth'];

    // 并发获取所有提供商的用量数据
    const usagePromises = supportedProviders.map(async (providerType) => {
        try {
            const providerUsage = await getProviderTypeUsage(providerType, currentConfig, accountPoolManager);
            return { providerType, data: providerUsage, success: true };
        } catch (error) {
            return {
                providerType,
                data: {
                    error: error.message,
                    instances: []
                },
                success: false
            };
        }
    });

    // 等待所有并发请求完成
    const usageResults = await Promise.all(usagePromises);

    // 将结果整合到 results.providers 中
    for (const result of usageResults) {
        results.providers[result.providerType] = result.data;
    }

    return results;
}

/**
 * 获取提供商显示名称。
 * @param {object} provider - 提供商配置。
 * @param {string} providerType - 提供商类型。
 * @returns {string} 显示名称。
 */
function getProviderDisplayName(provider, providerType) {
    // 尝试从凭据文件路径提取名称
    const credPathKey = {
        'claude-kiro-oauth': 'KIRO_OAUTH_CREDS_FILE_PATH'
    }[providerType];

    if (credPathKey && provider[credPathKey]) {
        const filePath = provider[credPathKey];
        const fileName = path.basename(filePath);
        const dirName = path.basename(path.dirname(filePath));
        return `${dirName}/${fileName}`;
    }

    return provider.uuid || '未命名';
}

/**
 * 获取指定提供商类型的用量信息。
 * @param {string} providerType - 提供商类型。
 * @param {object} currentConfig - 当前配置。
 * @param {object} accountPoolManager - 账号池管理器。
 * @returns {Promise<object>} 提供商用量信息。
 */
async function getProviderTypeUsage(providerType, currentConfig, accountPoolManager) {
    const result = {
        providerType,
        instances: [],
        totalCount: 0,
        successCount: 0,
        errorCount: 0
    };

    // 获取账号列表（支持 SQLite 和 JSON 两种模式）
    let providers = [];
    const accounts = accountPoolManager.listAccounts();
    providers = accounts || [];

    result.totalCount = providers.length;

        // 遍历所有提供商实例获取用量
        for (const provider of providers) {
        const providerKey = providerType + (provider.uuid || '');
        let adapter = serviceInstances[providerKey];

        const instanceResult = {
            uuid: provider.uuid || 'unknown',
            email: provider.cachedEmail || getProviderDisplayName(provider, providerType),
            userId: provider.cachedUserId || null,
            isHealthy: provider.isHealthy !== false,
            isDisabled: provider.isDisabled === true,
            usageCount: provider.usageCount || 0,
            errorCount: provider.errorCount || 0,
            success: false,
            limits: null,
            error: null
        };

        // 首先检查是否已禁用，已禁用的提供商跳过初始化
        if (provider.isDisabled) {
            instanceResult.error = '提供商已禁用';
            result.errorCount++;
        } else if (!adapter) {
            // 服务实例未初始化，尝试自动初始化
            try {
                logger.info(`[Usage API] Auto-initializing service adapter for ${providerType}: ${provider.uuid}`);
                // 构建配置对象
                const serviceConfig = {
                    ...currentConfig,
                    ...provider,
                    MODEL_PROVIDER: providerType
                };
                adapter = getServiceAdapter(serviceConfig);
            } catch (initError) {
                logErrorInDev(initError, {
                    context: 'getProviderTypeUsage - adapter initialization',
                    providerType,
                    uuid: provider.uuid
                });

                logger.error(`[Usage API] Failed to initialize adapter for ${providerType}: ${provider.uuid}:`, initError);
                instanceResult.error = `服务实例初始化失败: ${initError.message}`;
                result.errorCount++;
            }
        }
        
        // 如果适配器存在（包括刚初始化的），且没有错误，尝试获取用量
        if (adapter && !instanceResult.error) {
            try {
                const usage = await getAdapterUsage(adapter);
                instanceResult.success = true;

                // 提取用量数据到扁平结构
                if (usage) {
                    // 保存完整的 usage 对象，用于后续的缓存更新检查
                    instanceResult.usage = usage;

                    // 更新 email 和 userId
                    if (usage.user) {
                        instanceResult.email = usage.user.email || instanceResult.email;
                        instanceResult.userId = usage.user.userId || instanceResult.userId;
                    }
                    // 提取 limits 数据
                    if (usage.limits) {
                        instanceResult.limits = {
                            used: usage.limits.used,
                            remaining: usage.limits.remaining,
                            total: usage.limits.total,
                            percentUsed: usage.limits.percentUsed,
                            unit: usage.limits.unit || 'tokens'
                        };
                    }
                    // 提取订阅信息
                    if (usage.subscription) {
                        instanceResult.subscription = {
                            title: usage.subscription.title,
                            type: usage.subscription.type
                        };
                    }
                    // 提取用量明细（Credit, Free Trial 等）
                    if (usage.usageBreakdown && Array.isArray(usage.usageBreakdown)) {
                        instanceResult.usageBreakdown = usage.usageBreakdown.map(item => ({
                            displayName: item.displayName,
                            currentUsage: item.currentUsage,
                            usageLimit: item.usageLimit,
                            unit: item.unit,
                            freeTrial: item.freeTrial ? {
                                currentUsage: item.freeTrial.currentUsage,
                                usageLimit: item.freeTrial.usageLimit,
                                expiresAt: item.freeTrial.expiresAt
                            } : null
                        }));
                    }
                    // 下次重置时间
                    if (usage.nextDateReset) {
                        instanceResult.nextDateReset = usage.nextDateReset;
                    }
                    if (usage.daysUntilReset !== undefined) {
                        instanceResult.daysUntilReset = usage.daysUntilReset;
                    }
                }
                // 添加凭据文件路径
                if (provider.KIRO_OAUTH_CREDS_FILE_PATH) {
                    instanceResult.credentialsPath = provider.KIRO_OAUTH_CREDS_FILE_PATH;
                }
                result.successCount++;

                // 缓存 userId 和 email 到 provider pool，用于去重检测
                if (usage && usage.user) {
                    const needsUpdate = provider.cachedUserId !== usage.user.userId ||
                                       provider.cachedEmail !== usage.user.email;
                    if (needsUpdate) {
                        // 通过 accountPoolManager 更新账号信息
                        try {
                            accountPoolManager.updateAccount(provider.uuid, {
                                cachedUserId: usage.user.userId,
                                cachedEmail: usage.user.email,
                                cachedAt: new Date().toISOString()
                            });

                            // 更新本地引用（用于后续去重检测）
                            provider.cachedUserId = usage.user.userId;
                            provider.cachedEmail = usage.user.email;
                            provider.cachedAt = new Date().toISOString();
                        } catch (updateError) {
                            logger.warn(`[Usage API] Failed to update cached user info: ${updateError.message}`);
                        }

                        // 检查是否有重复的 userId
                        const { findDuplicateUserId } = await import('../../../utils/account-utils.js');
                        const duplicate = findDuplicateUserId(providers, usage.user.userId, provider.uuid);
                        if (duplicate) {
                            logger.warn(`[Usage API] 检测到重复账号: ${usage.user.email} (userId: ${usage.user.userId})`);
                            logger.warn(`[Usage API] 重复的 token: ${provider.KIRO_OAUTH_CREDS_FILE_PATH} 与 ${duplicate.path}`);
                            instanceResult.isDuplicate = true;
                            instanceResult.duplicateOf = duplicate.path;
                        }
                    }
                }
            } catch (error) {
                logErrorInDev(error, {
                    context: 'getProviderTypeUsage - get adapter usage',
                    providerType,
                    uuid: provider.uuid,
                    email: provider.cachedEmail
                });

                instanceResult.error = error.message;
                result.errorCount++;
            }
        }

        result.instances.push(instanceResult);
    }

    // accountPoolManager 会自动保存更新（通过 debounce 机制）
    // 无需手动调用 writeFileSync

    return result;
}

/**
 * 从适配器获取用量信息。
 * @param {object} adapter - 服务适配器。
 * @returns {Promise<object | null>} 用量信息。
 */
async function getAdapterUsage(adapter) {
    const rawUsage = await getUsageLimits(adapter);
    return formatKiroUsage(rawUsage);
}

/**
 * 格式化 Kiro 用量信息为易读格式。
 * @param {object | null} usageData - 原始用量数据。
 * @returns {object | null} 格式化后的用量信息。
 */
function formatKiroUsage(usageData) {
    if (!usageData) {
        return null;
    }

    const result = {
        // 基本信息
        daysUntilReset: usageData.daysUntilReset,
        nextDateReset: usageData.nextDateReset ? new Date(usageData.nextDateReset * 1000).toISOString() : null,

        // 订阅信息
        subscription: null,

        // 用户信息
        user: null,

        // 用量明细
        usageBreakdown: []
    };

    // 解析订阅信息
    if (usageData.subscriptionInfo) {
        result.subscription = {
            title: usageData.subscriptionInfo.subscriptionTitle,
            type: usageData.subscriptionInfo.type,
            upgradeCapability: usageData.subscriptionInfo.upgradeCapability,
            overageCapability: usageData.subscriptionInfo.overageCapability
        };
    }

    // 解析用户信息
    if (usageData.userInfo) {
        result.user = {
            email: usageData.userInfo.email,
            userId: usageData.userInfo.userId
        };
    }

    // 解析用量明细
    if (usageData.usageBreakdownList && Array.isArray(usageData.usageBreakdownList)) {
        for (const breakdown of usageData.usageBreakdownList) {
            const item = {
                resourceType: breakdown.resourceType,
                displayName: breakdown.displayName,
                displayNamePlural: breakdown.displayNamePlural,
                unit: breakdown.unit,
                currency: breakdown.currency,

                // 当前用量
                currentUsage: breakdown.currentUsageWithPrecision ?? breakdown.currentUsage,
                usageLimit: breakdown.usageLimitWithPrecision ?? breakdown.usageLimit,

                // 超额信息
                currentOverages: breakdown.currentOveragesWithPrecision ?? breakdown.currentOverages,
                overageCap: breakdown.overageCapWithPrecision ?? breakdown.overageCap,
                overageRate: breakdown.overageRate,
                overageCharges: breakdown.overageCharges,

                // 下次重置时间
                nextDateReset: breakdown.nextDateReset ? new Date(breakdown.nextDateReset * 1000).toISOString() : null,

                // 免费试用信息
                freeTrial: null,

                // 奖励信息
                bonuses: []
            };

            // 解析免费试用信息
            if (breakdown.freeTrialInfo) {
                item.freeTrial = {
                    status: breakdown.freeTrialInfo.freeTrialStatus,
                    currentUsage: breakdown.freeTrialInfo.currentUsageWithPrecision ?? breakdown.freeTrialInfo.currentUsage,
                    usageLimit: breakdown.freeTrialInfo.usageLimitWithPrecision ?? breakdown.freeTrialInfo.usageLimit,
                    expiresAt: breakdown.freeTrialInfo.freeTrialExpiry
                        ? new Date(breakdown.freeTrialInfo.freeTrialExpiry * 1000).toISOString()
                        : null
                };
            }

            // 解析奖励信息
            if (breakdown.bonuses && Array.isArray(breakdown.bonuses)) {
                for (const bonus of breakdown.bonuses) {
                    item.bonuses.push({
                        code: bonus.bonusCode,
                        displayName: bonus.displayName,
                        description: bonus.description,
                        status: bonus.status,
                        currentUsage: bonus.currentUsage,
                        usageLimit: bonus.usageLimit,
                        redeemedAt: bonus.redeemedAt ? new Date(bonus.redeemedAt * 1000).toISOString() : null,
                        expiresAt: bonus.expiresAt ? new Date(bonus.expiresAt * 1000).toISOString() : null
                    });
                }
            }

            result.usageBreakdown.push(item);
        }
    }

    // 计算汇总的 limits 数据（合并所有 breakdown 包括免费试用）
    if (result.usageBreakdown.length > 0) {
        let totalUsed = 0;
        let totalLimit = 0;

        for (const breakdown of result.usageBreakdown) {
            // 添加基础额度
            totalUsed += breakdown.currentUsage || 0;
            totalLimit += breakdown.usageLimit || 0;

            // 添加免费试用额度
            if (breakdown.freeTrial) {
                totalUsed += breakdown.freeTrial.currentUsage || 0;
                totalLimit += breakdown.freeTrial.usageLimit || 0;
            }
        }

        const remaining = totalLimit - totalUsed;
        const percentUsed = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;

        result.limits = {
            used: totalUsed,
            remaining: remaining,
            total: totalLimit,
            percentUsed: percentUsed,
            unit: result.usageBreakdown[0]?.unit || 'tokens'
        };
    } else {
        result.limits = null;
    }

    return result;
}

/**
 * 更新特定提供商类型的用量缓存。
 * @param {string} providerType - 提供商类型。
 * @param {object} usageData - 用量数据。
 * @returns {Promise<void>}
 */
export async function updateProviderUsageCache(providerType, usageData) {
    let cache = await readUsageCache();
    if (!cache) {
        cache = {
            timestamp: new Date().toISOString(),
            providers: {}
        };
    }
    cache.providers[providerType] = usageData;
    cache.timestamp = new Date().toISOString();
    await writeUsageCache(cache);
}
