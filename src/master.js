/**
 * 主进程 (Master Process)
 *
 * 负责管理子进程的生命周期，包括：
 * - 启动子进程
 * - 监控子进程状态
 * - 处理子进程重启请求
 * - 提供 IPC 通信
 *
 * 使用方式：
 * node src/master.js [原有的命令行参数]
 */

import { fork } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { initLogger, createLogger } from './lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从环境变量或 .env 文件读取日志级别
const logLevel = process.env.LOG_LEVEL || 'info';
initLogger({ level: logLevel });

const logger = createLogger('master');

// 从当前工作目录的 .env 文件中读取变量（优先于 process.env）
function readEnvFileVar(name) {
    try {
        const envPath = path.join(process.cwd(), '.env');
        if (!fs.existsSync(envPath)) return undefined;
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const [key, ...rest] = trimmed.split('=');
            if (key.trim() === name) {
                let val = rest.join('=').trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                return val;
            }
        }
    } catch (err) {
        // 忽略读取错误，回退到 process.env
    }
    return undefined;
}

// 子进程实例
let workerProcess = null;

// 子进程状态
let workerStatus = {
    pid: null,
    startTime: null,
    restartCount: 0,
    lastRestartTime: null,
    isRestarting: false
};

// 配置
const config = {
    workerScript: path.join(__dirname, 'api/server.js'),
    maxRestartAttempts: 10,
    restartDelay: 1000, // 重启延迟（毫秒）
    masterPort: parseInt(readEnvFileVar('MASTER_PORT') ?? process.env.MASTER_PORT, 10) || 3100, // 主进程管理端口（.env 优先）
    // 安全配置：默认只监听本地回环地址，避免管理端点暴露到公网
    // 可通过 MASTER_HOST 环境变量配置为其他地址（如 0.0.0.0）
    masterHost: readEnvFileVar('MASTER_HOST') ?? process.env.MASTER_HOST ?? '127.0.0.1',
    // 安全增强：API Token 验证
    // 设置后要求所有 /master/* 端点携带 Authorization: Bearer <token> 头
    masterApiToken: readEnvFileVar('MASTER_API_TOKEN') ?? process.env.MASTER_API_TOKEN,
    // CORS 配置：默认不启用，仅在显式配置时开放
    // 可设置为具体的 Origin（如 http://localhost:3000）或 * （不推荐）
    masterCorsOrigin: readEnvFileVar('MASTER_CORS_ORIGIN') ?? process.env.MASTER_CORS_ORIGIN,
    args: process.argv.slice(2) // 传递给子进程的参数
};

/**
 * 启动子进程
 */
function startWorker(isRestarting = false) {
    if (workerProcess) {
        logger.info(`Worker process already running, PID: ${workerProcess.pid}`);
        return;
    }
    const args = [...config.args];
    if (isRestarting) {
        args.push('--disableopenserverurl');
    }

    logger.info('Starting worker process...');
    logger.info('Worker script', { path: config.workerScript });
    logger.info('Worker args', { args: args.join(' ') });

    workerProcess = fork(config.workerScript, args, {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: {
            ...process.env,
            IS_WORKER_PROCESS: 'true'
        }
    });

    workerStatus.pid = workerProcess.pid;
    workerStatus.startTime = new Date().toISOString();

    logger.info(`Worker process started, PID: ${workerProcess.pid}`);

    // 监听子进程消息
    workerProcess.on('message', (message) => {
        logger.info('Received message from worker', { message });
        handleWorkerMessage(message);
    });

    // 监听子进程退出
    workerProcess.on('exit', (code, signal) => {
        logger.info(`Worker process exited with code ${code}, signal ${signal}`);
        workerProcess = null;
        workerStatus.pid = null;

        // 如果不是主动重启导致的退出，尝试自动重启
        if (!workerStatus.isRestarting && code !== 0) {
            logger.info('Worker crashed, attempting auto-restart...');
            scheduleRestart();
        }
    });

    // 监听子进程错误
    workerProcess.on('error', (error) => {
        logger.error('Worker process error', error);
    });
}

/**
 * 停止子进程
 * @param {boolean} graceful - 是否优雅关闭
 * @returns {Promise<void>}
 */
function stopWorker(graceful = true) {
    return new Promise((resolve) => {
        if (!workerProcess) {
            logger.error('No worker process to stop');
            resolve();
            return;
        }

        logger.warn(`Stopping worker process, PID: ${workerProcess.pid}`);

        const timeout = setTimeout(() => {
            if (workerProcess) {
                logger.warn('Force killing worker process...');
                workerProcess.kill('SIGKILL');
            }
            resolve();
        }, 5000); // 5秒超时后强制杀死

        workerProcess.once('exit', () => {
            clearTimeout(timeout);
            workerProcess = null;
            workerStatus.pid = null;
            logger.warn('Worker process stopped');
            resolve();
        });

        if (graceful) {
            // 发送优雅关闭信号
            workerProcess.send({ type: 'shutdown' });
            workerProcess.kill('SIGTERM');
        } else {
            workerProcess.kill('SIGKILL');
        }
    });
}

/**
 * 重启子进程
 * @returns {Promise<Object>}
 */
async function restartWorker() {
    if (workerStatus.isRestarting) {
        logger.info('Restart already in progress');
        return { success: false, message: 'Restart already in progress' };
    }

    workerStatus.isRestarting = true;
    workerStatus.restartCount++;
    workerStatus.lastRestartTime = new Date().toISOString();

    logger.info('Restarting worker process...');

    try {
        await stopWorker(true);
        
        // 等待一小段时间确保端口释放
        await new Promise(resolve => setTimeout(resolve, config.restartDelay));
        
        startWorker(true);
        workerStatus.isRestarting = false;

        return {
            success: true,
            message: 'Worker restarted successfully',
            pid: workerStatus.pid,
            restartCount: workerStatus.restartCount
        };
    } catch (error) {
        workerStatus.isRestarting = false;
        logger.error('Failed to restart worker', error);
        return {
            success: false,
            message: 'Failed to restart worker: ' + error.message
        };
    }
}

/**
 * 计划重启（用于崩溃后自动重启）
 */
function scheduleRestart() {
    if (workerStatus.restartCount >= config.maxRestartAttempts) {
        logger.error('Max restart attempts reached, giving up');
        return;
    }

    const delay = Math.min(config.restartDelay * Math.pow(2, workerStatus.restartCount), 30000);
    logger.info(`Scheduling restart in ${delay}ms...`);

    setTimeout(() => {
        restartWorker();
    }, delay);
}

/**
 * 处理来自子进程的消息
 * @param {Object} message - 消息对象
 */
function handleWorkerMessage(message) {
    if (!message || !message.type) return;

    switch (message.type) {
        case 'ready':
            logger.info('Worker is ready');
            break;
        case 'restart_request':
            logger.info('Worker requested restart');
            restartWorker();
            break;
        case 'status':
            logger.info('Worker status', { status: message.data });
            break;
        default:
            logger.info(`Unknown message type: ${message.type}`);
    }
}

/**
 * 获取状态信息
 * @returns {Object}
 */
function getStatus() {
    return {
        master: {
            pid: process.pid,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        },
        worker: {
            pid: workerStatus.pid,
            startTime: workerStatus.startTime,
            restartCount: workerStatus.restartCount,
            lastRestartTime: workerStatus.lastRestartTime,
            isRestarting: workerStatus.isRestarting,
            isRunning: workerProcess !== null
        }
    };
}

/**
 * 验证 API Token
 * @param {http.IncomingMessage} req - HTTP 请求对象
 * @returns {boolean} 是否通过验证
 */
function verifyApiToken(req) {
    if (!config.masterApiToken) {
        // 未配置 Token，跳过验证
        return true;
    }

    const authHeader = (req.headers.authorization || '').trim();
    const providedToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : authHeader;

    return providedToken === config.masterApiToken;
}

/**
 * 创建主进程管理 HTTP 服务器
 */
function createMasterServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;
        const method = req.method;

        // 安全配置：仅在显式配置 MASTER_CORS_ORIGIN 时启用 CORS
        if (config.masterCorsOrigin) {
            res.setHeader('Access-Control-Allow-Origin', config.masterCorsOrigin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        }

        // 处理 OPTIONS 预检请求
        if (method === 'OPTIONS') {
            if (config.masterCorsOrigin) {
                res.writeHead(204);
                res.end();
            } else {
                // 未配置 CORS，拒绝预检请求
                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'CORS not enabled' }));
            }
            return;
        }

        // 安全增强：对所有 /master/* 端点进行 Token 验证
        if (path.startsWith('/master/')) {
            if (!verifyApiToken(req)) {
                logger.warn(`Unauthorized access attempt to ${path} from ${req.socket.remoteAddress}`);
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    error: 'Unauthorized',
                    message: 'Valid API token required. Set MASTER_API_TOKEN environment variable.'
                }));
                return;
            }
        }

        // 状态端点
        if (method === 'GET' && path === '/master/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getStatus()));
            return;
        }

        // 重启端点
        if (method === 'POST' && path === '/master/restart') {
            logger.info('Restart requested via API');
            const result = await restartWorker();
            res.writeHead(result.success ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        // 停止端点
        if (method === 'POST' && path === '/master/stop') {
            logger.info('Stop requested via API');
            await stopWorker(true);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Worker stopped' }));
            return;
        }

        // 启动端点
        if (method === 'POST' && path === '/master/start') {
            logger.info('Start requested via API');
            if (workerProcess) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Worker already running' }));
                return;
            }
            startWorker();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Worker started', pid: workerStatus.pid }));
            return;
        }

        // 健康检查
        if (method === 'GET' && path === '/master/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                workerRunning: workerProcess !== null,
                timestamp: new Date().toISOString()
            }));
            return;
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    });

    server.listen(config.masterPort, config.masterHost, () => {
        logger.info(`Management server listening on ${config.masterHost}:${config.masterPort}`);

        // 安全检查：如果监听非本地地址但未配置 Token，输出警告
        const isLocalHost = config.masterHost === 'localhost' ||
                           config.masterHost.startsWith('127.') ||
                           config.masterHost === '::1' ||
                           config.masterHost.startsWith('::ffff:127.');
        if (!isLocalHost && !config.masterApiToken) {
            logger.warn('━'.repeat(60));
            logger.warn('⚠️  SECURITY WARNING ⚠️');
            logger.warn('Management server is listening on a non-local address without authentication!');
            logger.warn(`Host: ${config.masterHost}:${config.masterPort}`);
            logger.warn('This allows anyone on the network to control your application.');
            logger.warn('');
            logger.warn('To secure your management endpoints:');
            logger.warn('1. Set MASTER_API_TOKEN environment variable, or');
            logger.warn('2. Set MASTER_HOST=127.0.0.1 to restrict to local access only');
            logger.warn('━'.repeat(60));
        } else if (config.masterApiToken) {
            logger.info('✓ Management endpoints are protected with API token');
            logger.info('  Note: All /master/* endpoints (including /master/health) require authentication');
        } else {
            logger.info('✓ Management endpoints are restricted to localhost');
        }

        logger.info(`Available endpoints:`);
        logger.info(`  GET  /master/status  - Get master and worker status`);
        logger.info(`  GET  /master/health  - Health check`);
        logger.info(`  POST /master/restart - Restart worker process`);
        logger.info(`  POST /master/stop    - Stop worker process`);
        logger.info(`  POST /master/start   - Start worker process`);

        if (config.masterApiToken) {
            logger.info('');
            logger.info('Authentication required: Authorization: Bearer <token>');
        }
    });

    return server;
}

/**
 * 处理进程信号
 */
function setupSignalHandlers() {
    // 优雅关闭
    process.on('SIGTERM', async () => {
        logger.info('Received SIGTERM, shutting down...');
        await stopWorker(true);
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        logger.info('Received SIGINT, shutting down...');
        await stopWorker(true);
        process.exit(0);
    });

    // 未捕获的异常
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught exception', error);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled rejection', { promise, reason });
    });
}

/**
 * 主函数
 */
async function main() {
    logger.verbose('='.repeat(50));
    logger.info('AIClient2API Master Process');
    logger.info(`PID: ${process.pid}`);
    logger.info(`Node version: ${process.version}`);
    logger.info(`Working directory: ${process.cwd()}`);
    logger.verbose('='.repeat(50));

    // 设置信号处理
    setupSignalHandlers();

    // 创建管理服务器
    createMasterServer();

    // 启动子进程
    startWorker();
}

// 启动主进程
main().catch(error => {
    logger.error('Failed to start', error);
    process.exit(1);
});
