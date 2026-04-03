/**
 * 统一 API 服务器启动入口
 *
 * 负责按固定顺序完成配置加载、服务初始化、UI 管理、API 管理与 HTTP 监听。
 * 启动顺序不可随意调整，否则会导致配置未就绪、服务未注册或健康检查失效。
 *
 * @module server
 */

import 'dotenv/config'; // 加载 dotenv 环境变量 — 必须最先加载

import * as http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { initializeConfig, CONFIG } from '../config/manager.js';
import { initApiService } from '../services/manager.js';
import { initializeUIManagement } from '../ui-manager.js';
import { initializeAPIManagement } from './manager.js';
import { createRequestHandler } from './request-handler.js';
import { initLogger, createLogger } from '../lib/logger.js';
import { attachViteDevProxy } from '../ui/vite-dev-proxy.js';
import { validateServerConfig } from '../config/validation.js';
import { getAccountPoolManager } from '../services/manager.js';

// 从环境变量读取日志级别
const logLevel = process.env.LOG_LEVEL || 'info';
initLogger({ level: logLevel });

const logger = createLogger('server');

/**
 * 判断 API Key 是否属于弱口令
 *
 * @param {string} value - 待检查的 API Key
 * @returns {boolean} 是否为弱口令
 */
function isInsecureDefaultApiKey(value) {
    return value === '123456' || value === 'password' || value === 'admin';
}

/**
 * 对敏感配置做日志脱敏，避免误泄露
 *
 * @param {*} value - 原始密钥（任意类型，会转为字符串）
 * @returns {string} 脱敏后的字符串
 */
function maskSecret(value) {
    if (!value) return '(unset)';
    const str = String(value);
    if (str.length <= 4) return '****';
    return `${str.slice(0, 2)}****${str.slice(-2)}`;
}

// --- Server Initialization ---
/**
 * 启动服务器并初始化所有依赖模块
 *
 * 生产环境会严格校验弱密钥并在不安全时退出，以防配置疏漏被带入公网。
 * 启动后可选自动打开浏览器用于提升本地体验，但必须容忍无 GUI 环境的失败场景。
 *
 * @returns {Promise<http.Server>} 服务器实例（便于测试）
 */
async function startServer() {
    // 初始化配置
    await initializeConfig();

    // Validate server configuration
    const configValidation = validateServerConfig(CONFIG);
    if (!configValidation.valid) {
        logger.error('Configuration validation failed:');
        configValidation.errors.forEach(error => logger.error(`  - ${error}`));
        process.exit(1);
    }

    // 生产环境禁止使用弱默认 API Key（可用 ALLOW_WEAK_API_KEY=true 覆盖）
    // 为什么：默认/弱密钥一旦被部署到公网，风险极高，宁可启动失败也不要默默放过
    if (process.env.NODE_ENV === 'production' && isInsecureDefaultApiKey(CONFIG.REQUIRED_API_KEY)) {
        if (process.env.ALLOW_WEAK_API_KEY !== 'true') {
            logger.error('Refusing to start with insecure REQUIRED_API_KEY in production. Please set a strong REQUIRED_API_KEY.');
            process.exit(1);
        }
        logger.warn('Starting with insecure REQUIRED_API_KEY because ALLOW_WEAK_API_KEY=true is set.');
    }

    // 生产环境检查前端构建产物
    if (process.env.NODE_ENV === 'production') {
        const distPath = path.resolve(process.cwd(), 'frontend-vue/dist');
        try {
            await fs.access(path.join(distPath, 'index.html'));
        } catch {
            logger.error('');
            logger.error('前端构建产物不存在，无法启动生产模式');
            logger.error(`期望路径: ${distPath}`);
            logger.error('');
            logger.error('请先构建前端：');
            logger.error('  cd frontend-vue && npm install && npm run build && cd ..');
            logger.error('');
            process.exit(1);
        }
    }
    
    // Initialize API services
    const services = await initApiService(CONFIG);
    
    // Initialize UI management features
    initializeUIManagement(CONFIG);
    
    // Initialize API management and get heartbeat function
    const heartbeatAndRefreshToken = initializeAPIManagement(services);
    
    // Create request handler
    const requestHandlerInstance = createRequestHandler(CONFIG, getAccountPoolManager());

    const server = http.createServer(requestHandlerInstance);
    attachViteDevProxy(server);
    server.listen(CONFIG.SERVER_PORT, CONFIG.HOST, async () => {
        logger.info(`--- Unified API Server Configuration ---`);
        logger.info(`  System Prompt File: ${CONFIG.SYSTEM_PROMPT_FILE_PATH || 'Default'}`);
        logger.info(`  System Prompt Mode: ${CONFIG.SYSTEM_PROMPT_MODE}`);
        logger.info(`  Host: ${CONFIG.HOST}`);
        logger.info(`  Port: ${CONFIG.SERVER_PORT}`);
        logger.info(`  Required API Key: ${process.env.NODE_ENV === 'production' ? '[configured]' : maskSecret(CONFIG.REQUIRED_API_KEY)}`);
        logger.info(`  Prompt Logging: ${CONFIG.PROMPT_LOG_MODE}${CONFIG.PROMPT_LOG_FILENAME ? ` (to ${CONFIG.PROMPT_LOG_FILENAME})` : ''}`);
        logger.info(`------------------------------------------`);
        logger.info(`Unified API Server running on http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}`);
        logger.info(`  Claude-compatible: /v1/messages`);
        logger.info(`  Health check: /health`);
        logger.info(`  UI Management Console: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/`);

        // 自动打开浏览器进入 UI（仅本地地址）
        if (CONFIG.OPEN_SERVER_URL) {
            try {
                const open = (await import('open')).default;
                setTimeout(() => {
                    open(`http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login`)
                        .then(() => {
                            logger.info('Opened login page in default browser');
                        })
                        .catch(err => {
                            logger.info(`Please open manually: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login`);
                        });
                }, 1000);
            } catch (err) {
                logger.info(`Login page available at: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login`);
            }
        } else {
            logger.info(`Login page available at: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login`);
        }

        // 特殊处理 xdg-open：在无桌面环境下会抛异常，避免误判为服务崩溃
        process.on('uncaughtException', (err) => {
            if (err.code === 'ENOENT' && err.syscall === 'spawn xdg-open') {
                logger.info('Could not auto-open browser. Please visit http://' + CONFIG.HOST + ':' + CONFIG.SERVER_PORT + '/login manually');
            } else {
                logger.error('Uncaught Exception', err);
                process.exit(1);
            }
        });

        if (CONFIG.CRON_REFRESH_TOKEN) {
            logger.info(`  • Cron Near Minutes: ${CONFIG.CRON_NEAR_MINUTES}`);
            logger.info(`  • Cron Refresh Token: ${CONFIG.CRON_REFRESH_TOKEN}`);
            // 每 CRON_NEAR_MINUTES 分钟执行一次心跳日志和令牌刷新
            setInterval(heartbeatAndRefreshToken, CONFIG.CRON_NEAR_MINUTES * 60 * 1000);
        }
        // 服务器完全启动后才做健康检查，避免在服务未就绪时产生误报或竞争资源
        const accountPoolManager = getAccountPoolManager();
        if (accountPoolManager) {
            logger.info('Performing initial health checks for account pool...');
            if (typeof accountPoolManager.performHealthChecks === 'function') {
                accountPoolManager.performHealthChecks(true);
            }
        }
    });
    return server; // Return the server instance for testing purposes
}

startServer().catch(err => {
    logger.error('Failed to start server', err);
    process.exit(1);
});
