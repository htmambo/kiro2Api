/**
 * 系统 Handler 实现
 * 处理系统相关的 API 请求
 */

import { getNoCacheHeaders } from '../utils/response.js';
import { parseRequestBody } from '../../../ui-manager.js';

/**
 * 登录 Handler
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

        // 导入必要的函数
        const { validateCredentials, generateToken, getExpiryTime, saveToken } = await import('../../../ui-manager.js');

        const isValid = await validateCredentials(password);

        if (isValid) {
            // 生成简单token
            const token = generateToken();
            const expiryTime = getExpiryTime();

            // 存储token信息到本地文件
            await saveToken(token, {
                username: 'admin',
                loginTime: Date.now(),
                expiryTime
            });

            console.log('[Login] User logged in successfully');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: '登录成功',
                token,
                expiresIn: '1小时'
            }));
        } else {
            console.log('[Login] Failed login attempt');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                message: '密码错误，请重试'
            }));
        }
    } catch (error) {
        console.error('[Login] Error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            message: error.message || '服务器错误'
        }));
    }
}


/**
 * 健康检查 Handler
 */
export async function healthCheck({ res }) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'ok',
        timestamp: Date.now()
    }));
}

/**
 * 获取系统信息 Handler
 */
export async function getSystemInfo({ res }) {
    const memUsage = process.memoryUsage();

    res.writeHead(200, getNoCacheHeaders());
    res.end(JSON.stringify({
        nodeVersion: process.version,
        serverTime: new Date().toLocaleString(),
        memoryUsage: `${Math.round(memUsage.rss / 1024 / 1024)} MB / ${Math.round(memUsage.rss * 1.5 / 1024 / 1024)} MB`,
        uptime: process.uptime(),
        isWorker: !!process.env.IS_WORKER_PROCESS
    }));
}

/**
 * 重启服务器 Handler
 */
export async function restartServer({ res }) {
    if (process.send && process.env.IS_WORKER_PROCESS) {
        console.log('[System] Sending restart request to master...');

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
 * 获取日志 Handler
 */
export async function getLogs({ res }) {
    res.writeHead(200, getNoCacheHeaders());
    res.end(JSON.stringify(global.logBuffer || []));
}

/**
 * 清空日志 Handler
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
 * SSE 事件流 Handler
 * 长连接实现，用于实时推送事件
 */
export async function eventStream({ req, res }) {
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
