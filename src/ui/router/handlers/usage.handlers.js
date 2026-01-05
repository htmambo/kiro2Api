/**
 * 用量 Handler 实现
 */

import { KIRO_MODELS } from '../../../kiro/constants.js';
import { getAllProvidersUsage, getProviderTypeUsage, updateProviderUsageCache } from '../../../ui-manager.js';

/**
 * 获取所有用量
 */
export async function getAllUsage({ req, res, currentConfig, providerPoolManager }) {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const refresh = url.searchParams.get('refresh') === 'true';

        let usageResults;

        if (!refresh) {
            const { readUsageCache } = await import('../../../ui-manager.js');
            const cachedData = await readUsageCache();
            if (cachedData) {
                usageResults = { ...cachedData, fromCache: true };
            }
        }

        if (!usageResults) {
            usageResults = await getAllProvidersUsage(currentConfig, providerPoolManager);
            const { writeUsageCache } = await import('../../../ui-manager.js');
            await writeUsageCache(usageResults);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(usageResults));
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 按段获取用量
 */
export async function getUsageBySegment({ req, res, currentConfig, providerPoolManager, match }) {
    const segment = decodeURIComponent(match[1]);
    const { DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS } = await import('../../../ui-manager.js');
    const isProviderType = segment === DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS;

    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const refresh = url.searchParams.get('refresh') === 'true';

        let usageResults;

        if (isProviderType) {
            const providerType = segment;
            if (!refresh) {
                const { readProviderUsageCache } = await import('../../../ui-manager.js');
                const cachedData = await readProviderUsageCache(providerType);
                if (cachedData) {
                    usageResults = cachedData;
                }
            }
            if (!usageResults) {
                usageResults = await getProviderTypeUsage(providerType, currentConfig, providerPoolManager);
                await updateProviderUsageCache(providerType, usageResults);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(usageResults));
        } else {
            const uuid = segment;
            const providerType = DEFAULT_PROVIDER_TYPE_FOR_ACCOUNTS;
            const providerUsage = await getProviderTypeUsage(providerType, currentConfig, providerPoolManager);
            const accountUsage = providerUsage?.instances?.find(i => i.uuid === uuid);

            if (accountUsage) {
                await updateProviderUsageCache(providerType, providerUsage);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, account: accountUsage }));
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `未找到账号 ${uuid}` } }));
            }
        }
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 获取账号用量
 */
export async function getAccountUsage({ req, res, currentConfig, providerPoolManager, match }) {
    const providerType = decodeURIComponent(match[1]);
    const uuid = decodeURIComponent(match[2]);

    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const refresh = url.searchParams.get('refresh') === 'true';

        let usageResults = await getProviderTypeUsage(providerType, currentConfig, providerPoolManager);
        const accountUsage = usageResults?.instances?.find(i => i.uuid === uuid);

        if (accountUsage) {
            await updateProviderUsageCache(providerType, usageResults);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, account: accountUsage }));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `未找到账号 ${uuid}` } }));
        }
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
    }
}

/**
 * 获取模型列表
 */
export async function getFullModels({ res }) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(KIRO_MODELS));
}
