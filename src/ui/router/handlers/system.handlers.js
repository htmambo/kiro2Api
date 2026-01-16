/**
 * 系统 Handler 实现。
 * 处理系统相关的 API 请求。
 * @module ui/router/handlers/system
 */

import { getNoCacheHeaders } from '../utils/response.js';
import { parseRequestBody } from '../../../utils/request-body.js';
import { createLogger } from '../../../lib/logger.js';

const logger = createLogger('ui:handlers:system');

/**
 * 登录 Handler。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function login({ req, res }) {
    try {
        const requestData = await parseRequestBody(req);
        const { password } = requestData;

        if (!password) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: '密码不能为空' }));
            return;
        }

        // 动态导入 UI 管理逻辑，避免循环依赖
        const { validateCredentials, generateToken, getExpiryTime, saveToken } = await import('../../../ui-manager.js');

        const isValid = await validateCredentials(password);

        if (isValid) {
            // 生成简单 token
            const token = generateToken();
            const expiryTime = getExpiryTime();

            // 存储 token 信息到本地文件
            await saveToken(token, {
                username: 'admin',
                loginTime: Date.now(),
                expiryTime
            });

            logger.info('[Login] User logged in successfully');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: '登录成功',
                token,
                expiresIn: '1小时'
            }));
        } else {
            logger.info('[Login] Failed login attempt');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: '密码错误，请重试'
            }));
        }
    } catch (error) {
        logger.error('[Login] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message || '服务器错误'
        }));
    }
}


/**
 * 健康检查 Handler。
 * @param {{ res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function healthCheck({ res }) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'ok',
        timestamp: Date.now()
    }));
}

/**
 * 获取系统信息 Handler。
 * @param {{ res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function getSystemInfo({ res }) {
    const memUsage = process.memoryUsage();
    const { join } = await import('path');
    const { existsSync, readFileSync } = await import('fs');
    const { getCpuUsagePercent } = await import('../../../utils/common.js');
    // 读取版本号
    let appVersion = 'unknown';
    try {
        const versionFilePath = join(process.cwd(), 'VERSION');
        if (existsSync(versionFilePath)) {
            appVersion = readFileSync(versionFilePath, 'utf8').trim();
        } else {
            throw new Error('VERSION file does not exist: ' + versionFilePath);
        }
    } catch (error) {
        logger.warn(`[UI API] Failed to read VERSION file: ${error.message}`);
    }

    // 计算 CPU 使用率
    const cpuUsage = getCpuUsagePercent();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        appVersion: appVersion,
        nodeVersion: process.version,
        serverTime: new Date().toLocaleString(),
        memoryUsage: `${Math.round(memUsage.heapUsed / 1024 / 1024)} MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`,
        cpuUsage: cpuUsage,
        uptime: process.uptime(),
        isWorker: !!process.env.IS_WORKER_PROCESS
    }));
}

/**
 * 重启服务器 Handler。
 * @param {{ res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function restartServer({ res }) {
    if (process.send && process.env.IS_WORKER_PROCESS) {
        logger.info('[System] Sending restart request to master...');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: '服务器正在重启...'
        }));

        // 稍微延迟发送，让响应先返回
        setTimeout(() => {
            process.send({ type: 'restart_request' });
        }, 100);
    } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: '当前未运行在 Cluster Worker 模式，无法自动重启。请手动重启服务。'
        }));
    }
}

/**
 * 获取日志 Handler。
 * @param {{ res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function getLogs({ res }) {
    res.writeHead(200, getNoCacheHeaders());
    res.end(JSON.stringify(global.logBuffer || []));
}

/**
 * 清空日志 Handler。
 * @param {{ res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function clearLogs({ res }) {
    global.logBuffer = [];

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        success: true,
        message: '日志已清空'
    }));
}

/**
 * SSE 事件流 Handler。
 * 长连接实现，用于实时推送事件。
 * @param {{ req: import('http').IncomingMessage, res: import('http').ServerResponse }} ctx - 请求上下文。
 * @returns {Promise<void>}
 */
export async function eventStream({ req, res }) {
    // EventSource 无法设置 Authorization header，这里使用 ?token= 传递
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const token = urlObj.searchParams.get('token');
        if (!token) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '未授权访问，请先登录' } }));
            return;
        }

        const { readTokenStore, writeTokenStore } = await import('../../../ui-manager.js');
        const tokenStore = await readTokenStore();
        const tokenInfo = tokenStore.tokens?.[token];
        if (!tokenInfo) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '未授权访问，请先登录' } }));
            return;
        }
        if (Date.now() > tokenInfo.expiryTime) {
            // 过期时清理 token 并提示重新登录
            delete tokenStore.tokens[token];
            await writeTokenStore(tokenStore);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: '登录已过期，请重新登录' } }));
            return;
        }
    } catch (e) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '未授权访问，请先登录' } }));
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // 发送初始注释以刷新连接并触发浏览器的 onopen 事件
    res.write(':\n\n');

    // 存储响应对象用于广播
    if (!global.eventClients) {
        global.eventClients = [];
    }
    global.eventClients.push(res);

    // 限制最大连接数，避免被长连接耗尽资源
    const MAX_SSE_CLIENTS = Number(process.env.MAX_SSE_CLIENTS) > 0 ? Number(process.env.MAX_SSE_CLIENTS) : 50;
    while (global.eventClients.length > MAX_SSE_CLIENTS) {
        const oldest = global.eventClients.shift();
        try {
            oldest?.end();
        } catch {
            // 忽略无法关闭的连接
        }
    }

    // 保持连接活跃
    const keepAlive = setInterval(() => {
        res.write(':\n\n');
    }, 30000);

    // 监听连接关闭
    req.on('close', () => {
        clearInterval(keepAlive);
        global.eventClients = global.eventClients.filter(r => r !== res);
    });
}
