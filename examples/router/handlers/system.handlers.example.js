/**
 * 系统 Handler 示例
 *
 * 演示如何编写业务逻辑处理函数
 * 每个 Handler 函数都是独立的、可测试的
 */

/**
 * 健康检查 Handler
 *
 * @param {Object} context - 上下文对象
 * @param {IncomingMessage} context.req - 请求对象
 * @param {ServerResponse} context.res - 响应对象
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
 *
 * @param {Object} context - 上下文对象
 * @param {ServerResponse} context.res - 响应对象
 */
export async function getSystemInfo({ res }) {
    const memUsage = process.memoryUsage();

    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
    });

    res.end(JSON.stringify({
        nodeVersion: process.version,
        serverTime: new Date().toLocaleString(),
        memoryUsage: `${Math.round(memUsage.rss / 1024 / 1024)} MB / ${Math.round(memUsage.rss * 1.5 / 1024 / 1024)} MB`,
        uptime: process.uptime(),
        platform: process.platform,
        arch: process.arch,
        isWorker: !!process.env.IS_WORKER_PROCESS
    }));
}

/**
 * 重启服务器 Handler
 *
 * @param {Object} context - 上下文对象
 * @param {ServerResponse} context.res - 响应对象
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
 *
 * @param {Object} context - 上下文对象
 * @param {ServerResponse} context.res - 响应对象
 */
export async function getLogs({ res }) {
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
    });

    res.end(JSON.stringify(global.logBuffer || []));
}

/**
 * 清空日志 Handler
 *
 * @param {Object} context - 上下文对象
 * @param {ServerResponse} context.res - 响应对象
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
 *
 * 这是一个特殊的长连接 Handler
 * 需要保持连接开放并持续推送数据
 *
 * @param {Object} context - 上下文对象
 * @param {IncomingMessage} context.req - 请求对象
 * @param {ServerResponse} context.res - 响应对象
 */
export async function eventStream({ req, res }) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // 发送初始注释以刷新连接并触发浏览器的 onopen 事件
    // 这是关键 - SSE 规范要求初始数据触发 EventSource.onopen
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
