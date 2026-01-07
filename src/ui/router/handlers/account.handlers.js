import { createLogger } from '../../../lib/logger.js';
const logger = createLogger('ui:handlers:config');

/**
 * 获取所有账号列表
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
 * 添加新账号
 */
export async function addAccount({ req, res, accountPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');
    const { broadcastEvent } = await import('../../events.js');

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
}

/**
 * 删除账号
 */
export async function deleteAccount({ res, accountPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const uuid = decodeURIComponent(match[1]);

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
}

/**
 * 切换账号状态
 */
export async function toggleAccount({ res, accountPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const uuid = decodeURIComponent(match[1]);

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
    res.end(JSON.stringify({ success: true, isDisabled }));
}

/**
 * 批量删除账号
 */
export async function batchDeleteAccounts({ req, res, accountPoolManager }) {
    const { getRequestBody } = await import('../../../utils/common.js');
    const { broadcastEvent } = await import('../../events.js');

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
}

/**
 * 重置所有账号健康状态
 */
export async function resetAllHealth({ res, accountPoolManager }) {
    accountPoolManager.markAllAccountsHealthy();
    const accounts = accountPoolManager.listAccounts();
    const resetCount = accounts.length;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, resetCount }));
}

/**
 * 重置单个账号健康状态
 */
export async function resetAccountHealth({ res, accountPoolManager, match }) {
    const { broadcastEvent } = await import('../../events.js');

    const accountUuid = match[1];

    const result = accountPoolManager.markAccountHealthy(accountUuid);
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
}

/**
 * 批量健康检查
 */
export async function healthCheckAll({ res, accountPoolManager }) {
    const accounts = accountPoolManager.listAccounts();
    const results = [];

    for (const acc of accounts) {
        if (acc.isDisabled) continue;
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
}

/**
 * 单个账号健康检查
 */
export async function healthCheckAccount({ res, currentConfig, accountPoolManager, match }) {
    const uuid = decodeURIComponent(match[1]);

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
}

/**
 * 测试账号
 */
export async function testAccount({ res, currentConfig, accountPoolManager, match }) {
    const { getServiceAdapter } = await import('../../../kiro/adapter.js');
    const uuid = decodeURIComponent(match[1]);

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
}

/**
 * 生成 OAuth 授权 URL
 */
export async function generateAuthUrl({ res, currentConfig, accountPoolManager }) {
    const { handleKiroOAuth } = await import('../../../services/oauth-handlers.js');

    const result = await handleKiroOAuth(currentConfig, accountPoolManager);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, authUrl: result.authUrl, authInfo: result.authInfo }));
}

/**
 * 清理重复账号
 */
export async function cleanupDuplicates({ req, res, currentConfig, accountPoolManager }) {
    const { parseRequestBody } = await import('../../../ui-manager.js');
    const { findDuplicateUserId } = await import('../../../utils/account-utils.js');
    const { broadcastEvent } = await import('../../events.js');

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
}
