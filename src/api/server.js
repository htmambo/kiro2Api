/**
 * 统一 API 服务器启动入口
 *
 * 负责按固定顺序完成配置加载、服务初始化、UI 管理、API 管理与 HTTP 监听。
 * 启动顺序不可随意调整，否则会导致配置未就绪、服务未注册或健康检查失效。
 *
 * @module server
 */

import * as http from 'http';
import { initializeConfig, CONFIG } from '../config/manager.js';
import { initApiService } from '../services/manager.js';
import { initializeUIManagement } from '../ui-manager.js';
import { initializeAPIManagement } from './manager.js';
import { createRequestHandler } from './request-handler.js';
import { initLogger, createLogger } from '../lib/logger.js';
import { attachViteDevProxy } from '../ui/vite-dev-proxy.js';
import { isWeakApiKey } from '../config/runtime-config.js';

import 'dotenv/config'; // 加载 dotenv 环境变量
import { getAccountPoolManager } from '../services/manager.js';

// 从环境变量读取日志级别
const logLevel = process.env.LOG_LEVEL || 'info';
initLogger({ level: logLevel });

const logger = createLogger('server');

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

    // 生产环境禁止使用弱默认 API Key（可用 ALLOW_WEAK_API_KEY=true 覆盖）
    // 为什么：默认/弱密钥一旦被部署到公网，风险极高，宁可启动失败也不要默默放过
    if (process.env.NODE_ENV === 'production' && isWeakApiKey(CONFIG.REQUIRED_API_KEY)) {
        if (process.env.ALLOW_WEAK_API_KEY !== 'true') {
            logger.error('Refusing to start with insecure REQUIRED_API_KEY in production. Please set a strong REQUIRED_API_KEY.');
            process.exit(1);
        }
        logger.warn('Starting with insecure REQUIRED_API_KEY because ALLOW_WEAK_API_KEY=true is set.');
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
        logger.info(`  Claude Code-compatible: /cc/v1/messages`);
        logger.info(`  Health check: /health`);
        logger.info(`  UI Management Console: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/`);

        // 自动打开浏览器进入 UI（仅本地地址）
        const shouldOpenBrowser = CONFIG.OPEN_SERVER_URL === true
            && ['127.0.0.1', 'localhost', '::1'].includes(String(CONFIG.HOST).trim());

        if (shouldOpenBrowser) {
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
        } else if (CONFIG.OPEN_SERVER_URL) {
            logger.warn('OPEN_SERVER_URL 已启用，但当前 HOST 不是本地回环地址，已跳过自动打开浏览器。');
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
