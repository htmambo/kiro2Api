/**
 * 账号相关 Handler 实现。
 * @module ui/router/handlers/account
 */

/**
 * 获取所有账号列表。
 * @param {{ res: import('http').ServerResponse, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function getAccounts({ res, accountPoolManager }) {
    const { parseErrorMessage } = await import('../../../ui-manager.js');
    const accounts = accountPoolManager.listAccounts();

    let healthyCount = 0;
    let checkingCount = 0;
    let bannedCount = 0;
    let totalUsageCount = 0;
    let totalErrorCount = 0;

    for (const account of accounts) {
        totalUsageCount += account.usageCount || 0;
        totalErrorCount += account.errorCount || 0;

        if (account.lastErrorMessage) {
            account.errorStatus = parseErrorMessage(account.lastErrorMessage);
        } else {
            account.errorStatus = { status: '正常', message: '', statusType: 'ok' };
        }

        // 根据状态分类账号池类型
        if (account.isDisabled) {
            account.poolType = 'disabled';
            bannedCount++;
        } else if (!account.isHealthy) {
            account.poolType = 'banned';
            bannedCount++;
        } else if (account.errorCount > 0 && account.isHealthy) {
            account.poolType = 'checking';
            checkingCount++;
        } else {
            account.poolType = 'healthy';
            healthyCount++;
        }
    }

    const stats = {
        healthy: healthyCount,
        checking: checkingCount,
        banned: bannedCount,
        total: healthyCount + checkingCount + bannedCount,
        totalUsageCount,
        totalErrorCount,
        cacheHitRate: '0%'
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        accounts: accounts,
        _accountPoolStats: stats
    }));
}

/**
 * 添加新账号。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function addAccount({ req, res, accountPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');
    const { broadcastEvent } = await import('../../events.js');

    try {
        const body = await getRequestBody(req);
        const accountConfig = body?.accountConfig || body;

        if (!accountConfig || typeof accountConfig !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'accountConfig is required' } }));
            return;
        }

        const newAccount = accountPoolManager.addAccount(accountConfig);

        broadcastEvent('account_update', {
            action: 'add',
            uuid: newAccount.uuid,
            accountConfig: newAccount,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, account: newAccount }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 删除账号。
 * @param {{ res: import('http').ServerResponse, accountPoolManager: object, match: Array<string> }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function deleteAccount({ res, accountPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const uuid = decodeURIComponent(match[1]);

    try {
        const removed = accountPoolManager.removeAccount(uuid);

        if (!removed) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Account not found' } }));
            return;
        }

        broadcastEvent('account_update', {
            action: 'delete',
            uuid,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 切换账号状态。
 * @param {{ res: import('http').ServerResponse, accountPoolManager: object, match: Array<string> }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function toggleAccount({ res, accountPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const uuid = decodeURIComponent(match[1]);

    try {
        const isDisabled = accountPoolManager.toggleAccount(uuid);

        if (isDisabled === null) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Account not found' } }));
            return;
        }

        broadcastEvent('account_update', {
            action: 'toggle',
            uuid,
            isDisabled,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, account }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 批量删除账号。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function batchDeleteAccounts({ req, res, accountPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');
    const { broadcastEvent } = await import('../../events.js');

    try {
        const body = await getRequestBody(req);
        const uuids = Array.isArray(body?.uuids) ? body.uuids : [];
        const deleteByStatus = Array.isArray(body?.deleteByStatus) ? body.deleteByStatus : [];

        if (uuids.length === 0 && deleteByStatus.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'uuids or deleteByStatus is required' } }));
            return;
        }

        let removed = 0;
        let targetUuids = [];

        if (deleteByStatus.length > 0) {
            const result = accountPoolManager.batchDeleteByStatus(deleteByStatus);
            removed = result.removed;
            targetUuids = result.uuids;
        } else if (uuids.length > 0) {
            removed = accountPoolManager.batchDeleteAccounts(uuids);
            targetUuids = uuids;
        }

        broadcastEvent('account_update', {
            action: 'batch_delete',
            uuids: targetUuids,
            removed,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, removed, message: `已删除 ${removed} 个账号` }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 重置所有账号健康状态。
 * @param {{ res: import('http').ServerResponse, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function resetAllHealth({ res, accountPoolManager }) {
    try {
        accountPoolManager.markAllAccountsHealthy();
        const resetCount = accountPoolManager.accountPool.accounts.length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, resetCount }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 重置单个账号健康状态。
 * @param {{ res: import('http').ServerResponse, accountPoolManager: object, match: Array<string> }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function resetAccountHealth({ res, accountPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const accountUuid = match[1];

    try {
        const result = accountPoolManager.markAccountHealthy(accountUuid);
        const resetCount = result ? 1 : 0;

        if (result) {
            broadcastEvent('config_update', {
                action: 'reset_health',
                resetCount,
                timestamp: new Date().toISOString()
            });
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `成功重置 ${resetCount} 个节点的健康状态`,
        }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 批量健康检查。
 * @param {{ res: import('http').ServerResponse, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function healthCheckAll({ res, accountPoolManager }) {
    try {
        const accounts = accountPoolManager.listAccounts();
        const results = [];

        for (const acc of accounts) {
            if (acc.isDisabled) continue;
            try {
                if (typeof accountPoolManager?._checkAccountHealth === 'function' && typeof accountPoolManager.markAccountHealthy === 'function') {
                    const healthResult = await accountPoolManager._checkAccountHealth(acc, true);
                    if (healthResult && healthResult.success) {
                        accountPoolManager.markAccountHealthy(acc.uuid, {
                            resetUsageCount: true,
                            healthCheckModel: healthResult.modelName,
                            userInfo: healthResult.userInfo
                        });
                        results.push({ uuid: acc.uuid, success: true, modelName: healthResult.modelName });
                    } else {
                        accountPoolManager.markAccountUnhealthy(acc.uuid, healthResult?.errorMessage || '检测失败');
                        results.push({ uuid: acc.uuid, success: false, modelName: healthResult?.modelName, message: healthResult?.errorMessage || '检测失败' });
                    }
                } else {
                    results.push({ uuid: acc.uuid, success: null, message: 'No pool manager available' });
                }
            } catch (error) {
                if (typeof accountPoolManager?.markAccountUnhealthy === 'function') {
                    accountPoolManager.markAccountUnhealthy(acc.uuid, error.message);
                }
                results.push({ uuid: acc.uuid, success: false, message: error.message });
            }
        }

        const successCount = results.filter(r => r.success === true).length;
        const failCount = results.filter(r => r.success === false).length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: `健康检测完成: ${successCount} 个健康, ${failCount} 个异常`,
            successCount,
            failCount,
            totalCount: accounts.length,
            results
        }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 单个账号健康检查。
 * @param {{ res: import('http').ServerResponse, currentConfig: object, accountPoolManager: object, match: Array<string> }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function healthCheckAccount({ res, currentConfig, accountPoolManager, match }) {
    const uuid = decodeURIComponent(match[1]);

    try {
        const accounts = accountPoolManager.listAccounts();
        const acc = accounts.find(a => a.uuid === uuid);

        if (!acc) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Account not found' } }));
            return;
        }

        let healthResult = null;

        if (typeof accountPoolManager?._checkAccountHealth === 'function' && typeof accountPoolManager.markAccountHealthy === 'function') {
            healthResult = await accountPoolManager._checkAccountHealth(acc, true);
            if (healthResult && healthResult.success) {
                accountPoolManager.markAccountHealthy(acc.uuid, { resetUsageCount: true, healthCheckModel: healthResult.modelName, userInfo: healthResult.userInfo });
            } else {
                accountPoolManager.markAccountUnhealthy(acc.uuid, healthResult?.errorMessage || '检测失败');
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: healthResult?.success || false,
            isHealthy: healthResult?.success || false,
            uuid,
            modelName: healthResult?.modelName || null,
            error: healthResult?.errorMessage || healthResult?.error || null
        }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 测试账号。
 * @param {{ res: import('http').ServerResponse, currentConfig: object, accountPoolManager: object, match: Array<string> }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function testAccount({ res, currentConfig, accountPoolManager, match }) {
    const { getServiceAdapter } = await import('../../../services/manager.js');
    const uuid = decodeURIComponent(match[1]);

    try {
        const accounts = accountPoolManager.listAccounts();
        const acc = accounts.find(a => a.uuid === uuid);

        if (!acc) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Account not found' } }));
            return;
        }

        const adapter = getServiceAdapter({ ...currentConfig, ...acc, MODEL_PROVIDER: currentConfig.MODEL_PROVIDER });
        const { generateContent } = await import('../../../kiro/api-client.js');
        await generateContent(adapter, 'claude-sonnet-4-20250514', {
            messages: [{ role: 'user', content: 'Hi' }],
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, uuid }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 生成 OAuth 授权 URL。
 * @param {{ res: import('http').ServerResponse, currentConfig: object, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function generateAuthUrl({ res, currentConfig, accountPoolManager }) {
    const { broadcastEvent } = await import('../../events.js');
    const { AwsSsoDeviceFlow } = await import('../../../domain/oauth/flows/aws-sso-device.js');
    const { OAUTH_DOMAIN_EVENTS } = await import('../../../domain/oauth/index.js');
    const { AccountPoolFacade, ACCOUNT_POOL_DOMAIN_EVENTS } = await import('../../../domain/account-pool/index.js');

    try {
        // UI 层负责把 domain 事件映射为 UI 广播事件（替代 services 层直接调用 broadcastEvent）
        const useSQLiteMode = currentConfig.USE_SQLITE_POOL === true;
        const accountPool = new AccountPoolFacade({
            mode: useSQLiteMode ? 'sqlite' : 'json',
            manager: accountPoolManager,
            config: currentConfig
        });

        // ⚠️ 使用 once 而非 on，避免重复触发和内存泄漏
        accountPool.once(ACCOUNT_POOL_DOMAIN_EVENTS.ACCOUNT_ADDED, (evt) => {
            broadcastEvent('account_update', {
                action: 'add',
                uuid: evt.accountId,
                accountConfig: evt.account,
                timestamp: evt.timestamp || new Date().toISOString()
            });
        });

        const flow = new AwsSsoDeviceFlow({ accountPool });

        flow.once(OAUTH_DOMAIN_EVENTS.OAUTH_COMPLETED, (evt) => {
            broadcastEvent('oauth_success', {
                provider: evt?.provider || 'claude-kiro-oauth',
                timestamp: evt?.timestamp || new Date().toISOString()
            });
        });

        flow.once(OAUTH_DOMAIN_EVENTS.OAUTH_FAILED, (evt) => {
            broadcastEvent('oauth_error', {
                provider: evt?.provider || 'claude-kiro-oauth',
                error: evt?.message || 'Unknown error',
                timestamp: evt?.timestamp || new Date().toISOString()
            });
        });

        const result = await flow.start(currentConfig);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, authUrl: result.authUrl, authInfo: result.authInfo }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `生成授权链接失败: ${error.message}` } }));
    }
}

/**
 * 清理重复账号。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse, currentConfig: object, accountPoolManager: object }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function cleanupDuplicates({ req, res, currentConfig, accountPoolManager }) {
    const { parseRequestBody } = await import('../../../ui-manager.js');
    const { findDuplicateUserId } = await import('../../../utils/account-utils.js');
    const { broadcastEvent } = await import('../../events.js');

    try {
        const body = await parseRequestBody(req);
        const { dryRun = true } = body;

        const accounts = accountPoolManager.listAccounts();

        const userIdGroups = {};
        const noUserIdAccounts = [];

        for (const account of accounts) {
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
        const toKeep = [];
        const toRemove = [];

        for (const [userId, group] of Object.entries(userIdGroups)) {
            if (group.length > 1) {
                toKeep.push(group[0]);
                for (let i = 1; i < group.length; i++) {
                    duplicates.push({
                        uuid: group[i].uuid,
                        path: group[i].KIRO_OAUTH_CREDS_FILE_PATH,
                        email: group[i].cachedEmail,
                        userId,
                        duplicateOf: group[0].KIRO_OAUTH_CREDS_FILE_PATH
                    });
                    toRemove.push(group[i]);
                }
            } else {
                toKeep.push(group[0]);
            }
        }

        let removedCount = 0;
        if (!dryRun && toRemove.length > 0) {
            const removeUuids = toRemove.map(a => a.uuid);
            removedCount = accountPoolManager.batchDeleteAccounts(removeUuids);
            broadcastEvent('account_update', { action: 'cleanup_duplicates', removedCount, timestamp: new Date().toISOString() });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, dryRun: false, removedCount, duplicates }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            dryRun: true,
            duplicates,
            summary: {
                totalAccounts: accounts.length,
                accountsWithUserId: Object.values(userIdGroups).reduce((sum, g) => sum + g.length, 0),
                accountsWithoutUserId: noUserIdAccounts.length,
                duplicateCount: duplicates.length
            }
        }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}
