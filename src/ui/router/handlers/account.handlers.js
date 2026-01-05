/**
 * 账号 Handler 实现
 * 处理账号管理相关的 API 请求
 * 这些 Handler 将调用 ui-manager.js 中的现有函数
 */

// 注意：这些 handler 实际上是调用 ui-manager.js 中的现有函数
// 我们通过导入和包装来保持代码的组织性

// 由于 ui-manager.js 中的函数是直接在 handleUIApiRequests 中定义的
// 我们需要重构或创建包装函数
// 为了简化迁移，这里提供 handler 框架，实际实现需要从原代码提取

/**
 * 获取所有账号列表
 */
export async function getAccounts({ res, currentConfig, providerPoolManager }) {
    // 从 ui-manager.js 的实现中提取
    // 这部分代码位于 1116-1168 行

    // 临时实现：调用原有逻辑
    // 实际迁移时需要将 ui-manager.js 中的函数提取为独立函数
    const { readAccountsFromStorage, parseErrorMessage } = await import('../../../ui-manager.js');
    const { broadcastEvent } = await import('../../events.js');

    const { accountPool, filePath } = readAccountsFromStorage(currentConfig, providerPoolManager);

    let healthyCount = 0;
    let checkingCount = 0;
    let bannedCount = 0;
    let totalUsageCount = 0;
    let totalErrorCount = 0;

    for (const account of accountPool.accounts) {
        totalUsageCount += account.usageCount || 0;
        totalErrorCount += account.errorCount || 0;

        if (account.lastErrorMessage) {
            account.errorStatus = parseErrorMessage(account.lastErrorMessage);
        } else {
            account.errorStatus = { status: '正常', message: '', statusType: 'ok' };
        }

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
        accounts: accountPool.accounts,
        _accountPoolStats: stats,
        _filePath: filePath
    }));
}

/**
 * 添加新账号
 */
export async function addAccount({ req, res, providerPoolManager }) {
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

        const newAccount = providerPoolManager.addAccount(accountConfig);

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
 * 删除账号
 */
export async function deleteAccount({ res, providerPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const uuid = decodeURIComponent(match[1]);

    try {
        const removed = providerPoolManager.removeAccount(uuid);

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
 * 切换账号状态
 */
export async function toggleAccount({ res, providerPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const uuid = decodeURIComponent(match[1]);

    try {
        const isDisabled = providerPoolManager.toggleAccount(uuid);

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
 * 批量删除账号
 */
export async function batchDeleteAccounts({ req, res, providerPoolManager }) {
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
            const result = providerPoolManager.batchDeleteByStatus(deleteByStatus);
            removed = result.removed;
            targetUuids = result.uuids;
        } else if (uuids.length > 0) {
            removed = providerPoolManager.batchDeleteAccounts(uuids);
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
 * 重置所有账号健康状态
 */
export async function resetAllHealth({ res, providerPoolManager }) {
    try {
        providerPoolManager.markAllAccountsHealthy();
        const resetCount = providerPoolManager.accountPool.accounts.length;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, resetCount }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 重置单个账号健康状态
 */
export async function resetAccountHealth({ res, providerPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const accountUuid = match[1];

    try {
        const result = providerPoolManager.markAccountHealthy(accountUuid);
        const resetCount = result ? 1 : 0;

        if(result) {
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
 * 批量健康检查
 */
export async function healthCheckAll({ res, providerPoolManager }) {
    try {
        const accounts = providerPoolManager.listAccounts();
        const results = [];

        for (const acc of accounts) {
            if (acc.isDisabled) continue;
            try {
                if (typeof providerPoolManager?._checkAccountHealth === 'function' && typeof providerPoolManager.markAccountHealthy === 'function') {
                    const healthResult = await providerPoolManager._checkAccountHealth(acc, true);
                    if (healthResult && healthResult.success) {
                        providerPoolManager.markAccountHealthy(acc.uuid, {
                            resetUsageCount: true,
                            healthCheckModel: healthResult.modelName,
                            userInfo: healthResult.userInfo
                        });
                        results.push({ uuid: acc.uuid, success: true, modelName: healthResult.modelName });
                    } else {
                        providerPoolManager.markAccountUnhealthy(acc.uuid, healthResult?.errorMessage || '检测失败');
                        results.push({ uuid: acc.uuid, success: false, modelName: healthResult?.modelName, message: healthResult?.errorMessage || '检测失败' });
                    }
                } else {
                    results.push({ uuid: acc.uuid, success: null, message: 'No pool manager available' });
                }
            } catch (error) {
                if (typeof providerPoolManager?.markAccountUnhealthy === 'function') {
                    providerPoolManager.markAccountUnhealthy(acc.uuid, error.message);
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
 * 单个账号健康检查
 */
export async function healthCheckAccount({ res, currentConfig, providerPoolManager, match }) {
    const { readAccountsFromStorage } = await import('../../../ui-manager.js');
    const uuid = decodeURIComponent(match[1]);

    try {
        const { accountPool } = readAccountsFromStorage(currentConfig, providerPoolManager);
        const acc = accountPool.accounts.find(a => a.uuid === uuid);

        if (!acc) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Account not found' } }));
            return;
        }

        let healthResult = null;

        if (typeof providerPoolManager?._checkAccountHealth === 'function' && typeof providerPoolManager.markAccountHealthy === 'function') {
            healthResult = await providerPoolManager._checkAccountHealth(acc, true);
            if (healthResult && healthResult.success) {
                providerPoolManager.markAccountHealthy(acc.uuid, { resetUsageCount: true, healthCheckModel: healthResult.modelName, userInfo: healthResult.userInfo });
            } else {
                providerPoolManager.markAccountUnhealthy(acc.uuid, healthResult?.errorMessage || '检测失败');
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
 * 测试账号
 */
export async function testAccount({ res, currentConfig, providerPoolManager, match }) {
    const { readAccountsFromStorage } = await import('../../../ui-manager.js');
    const { getServiceAdapter } = await import('../../../kiro/core.js');
    const uuid = decodeURIComponent(match[1]);

    try {
        const { accountPool } = readAccountsFromStorage(currentConfig, providerPoolManager);
        const acc = accountPool.accounts.find(a => a.uuid === uuid);

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
 * 生成 OAuth 授权 URL
 */
export async function generateAuthUrl({ res, currentConfig, providerPoolManager }) {
    const { handleKiroOAuth } = await import('../../../services/oauth-handlers.js');

    try {
        const result = await handleKiroOAuth(currentConfig, providerPoolManager);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, authUrl: result.authUrl, authInfo: result.authInfo }));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `生成授权链接失败: ${error.message}` } }));
    }
}

/**
 * 清理重复账号
 */
export async function cleanupDuplicates({ req, res, currentConfig, providerPoolManager }) {
    const { parseRequestBody } = await import('../../../ui-manager.js');
    const { readAccountsFromStorage } = await import('../../../ui-manager.js');
    const { findDuplicateUserId } = await import('../../../utils/account-utils.js');
    const { broadcastEvent } = await import('../../events.js');

    try {
        const body = await parseRequestBody(req);
        const { dryRun = true } = body;

        const { accountPool, providerPools } = readAccountsFromStorage(currentConfig, providerPoolManager);
        const accounts = accountPool.accounts;

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
            removedCount = providerPoolManager.batchDeleteAccounts(removeUuids);
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
