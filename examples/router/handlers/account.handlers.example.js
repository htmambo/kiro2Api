/**
 * 账号 Handler 示例
 *
 * 演示如何处理包含路径参数的请求
 * 重点展示正则路由的参数提取
 */

/**
 * 获取所有账号列表
 *
 * @param {Object} context - 上下文对象
 * @param {ServerResponse} context.res - 响应对象
 * @param {Object} context.currentConfig - 当前配置
 * @param {AccountPoolManager} context.providerPoolManager - 账号池管理器
 */
export async function getAccounts({ res, currentConfig, providerPoolManager }) {
    // 从存储中读取账号数据
    const { accountPool, filePath } = readAccountsFromStorage(currentConfig, providerPoolManager);

    // 统计数据
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
 * 删除账号（正则路由 Handler 示例）
 *
 * 演示如何从 match 对象中提取路径参数
 *
 * @param {Object} context - 上下文对象
 * @param {ServerResponse} context.res - 响应对象
 * @param {AccountPoolManager} context.providerPoolManager - 账号池管理器
 * @param {Array} context.match - 正则匹配结果
 *
 * @example
 * // 路由配置: /^\/api\/accounts\/([^\/]+)$/
 * // 请求路径: DELETE /api/accounts/abc-123-def
 * // match = ['/api/accounts/abc-123-def', 'abc-123-def']
 * // match[1] = 'abc-123-def' (第一个捕获组)
 */
export async function deleteAccount({ res, providerPoolManager, match }) {
    // 从正则匹配结果中提取 UUID
    const uuid = decodeURIComponent(match[1]);

    console.log(`[Account Handler] Deleting account: ${uuid}`);

    try {
        // 调用账号池管理器删除账号
        const removed = providerPoolManager.removeAccount(uuid);

        if (!removed) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: 'Account not found' }
            }));
            return;
        }

        // 广播删除事件
        broadcastEvent('account_update', {
            action: 'delete',
            uuid,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
    } catch (error) {
        console.error('[Account Handler] Delete error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: error.message }
        }));
    }
}

/**
 * 切换账号状态（多个路径参数示例）
 *
 * @param {Object} context - 上下文对象
 * @param {ServerResponse} context.res - 响应对象
 * @param {AccountPoolManager} context.providerPoolManager - 账号池管理器
 * @param {Array} context.match - 正则匹配结果
 *
 * @example
 * // 路由配置: /^\/api\/accounts\/([^\/]+)\/toggle$/
 * // 请求路径: POST /api/accounts/abc-123/toggle
 * // match = ['/api/accounts/abc-123/toggle', 'abc-123']
 * // match[1] = 'abc-123' (账号 UUID)
 */
export async function toggleAccount({ res, providerPoolManager, match }) {
    const uuid = decodeURIComponent(match[1]);

    console.log(`[Account Handler] Toggling account: ${uuid}`);

    try {
        // 切换账号状态
        const isDisabled = providerPoolManager.toggleAccount(uuid);

        if (isDisabled === null) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: 'Account not found' }
            }));
            return;
        }

        // 广播更新事件
        broadcastEvent('account_update', {
            action: 'toggle',
            uuid,
            isDisabled,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            uuid,
            isDisabled
        }));
    } catch (error) {
        console.error('[Account Handler] Toggle error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: error.message }
        }));
    }
}

/**
 * 批量删除账号
 *
 * 演示如何处理请求体数据
 *
 * @param {Object} context - 上下文对象
 * @param {IncomingMessage} context.req - 请求对象
 * @param {ServerResponse} context.res - 响应对象
 * @param {AccountPoolManager} context.providerPoolManager - 账号池管理器
 */
export async function batchDeleteAccounts({ req, res, providerPoolManager }) {
    try {
        // 解析请求体
        const body = await getRequestBody(req);
        const uuids = Array.isArray(body?.uuids) ? body.uuids : [];
        const deleteByStatus = Array.isArray(body?.deleteByStatus) ? body.deleteByStatus : [];

        if (uuids.length === 0 && deleteByStatus.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                error: { message: 'uuids or deleteByStatus is required' }
            }));
            return;
        }

        let removed = 0;
        let targetUuids = [];

        // 使用 AccountPoolManager 批量删除
        if (deleteByStatus.length > 0) {
            const result = providerPoolManager.batchDeleteByStatus(deleteByStatus);
            removed = result.removed;
            targetUuids = result.uuids;
        } else if (uuids.length > 0) {
            removed = providerPoolManager.batchDeleteAccounts(uuids);
            targetUuids = uuids;
        }

        // 广播批量删除事件
        broadcastEvent('account_update', {
            action: 'batch_delete',
            uuids: targetUuids,
            removed,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            removed,
            message: `已删除 ${removed} 个账号`
        }));
    } catch (error) {
        console.error('[Account Handler] Batch delete error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: { message: error.message }
        }));
    }
}

// ========== 辅助函数（从 ui-manager.js 导入） ==========

// 这些是辅助函数的占位符，实际实现需要从 ui-manager.js 导入
function readAccountsFromStorage(currentConfig, providerPoolManager) {
    // 实际实现...
    return { accountPool: { accounts: [] }, filePath: '' };
}

function parseErrorMessage(errorMessage) {
    // 实际实现...
    return { status: '异常', message: errorMessage };
}

function broadcastEvent(eventType, data) {
    // 实际实现...
    console.log(`[Broadcast] ${eventType}:`, data);
}

async function getRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
