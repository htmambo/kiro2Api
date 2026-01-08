import * as http from 'http';
import { initializeConfig, CONFIG } from '../config/manager.js';
import { initApiService } from '../services/manager.js';
import { initializeUIManagement } from '../ui-manager.js';
import { initializeAPIManagement } from './manager.js';
import { createRequestHandler } from './request-handler.js';
import { initLogger, createLogger } from '../lib/logger.js';

import 'dotenv/config'; // Import dotenv and configure it
import { getAccountPoolManager } from '../services/manager.js';

// 从环境变量读取日志级别
const logLevel = process.env.LOG_LEVEL || 'info';
initLogger({ level: logLevel });

const logger = createLogger('server');

// --- Server Initialization ---
async function startServer() {
    // Initialize configuration
    await initializeConfig();
    
    // Initialize API services
    const services = await initApiService(CONFIG);
    
    // Initialize UI management features
    initializeUIManagement(CONFIG);
    
    // Initialize API management and get heartbeat function
    const heartbeatAndRefreshToken = initializeAPIManagement(services);
    
    // Create request handler
    const requestHandlerInstance = createRequestHandler(CONFIG, getAccountPoolManager());

    const server = http.createServer(requestHandlerInstance);
    server.listen(CONFIG.SERVER_PORT, CONFIG.HOST, async () => {
        logger.info(`--- Unified API Server Configuration ---`);
        logger.info(`  System Prompt File: ${CONFIG.SYSTEM_PROMPT_FILE_PATH || 'Default'}`);
        logger.info(`  System Prompt Mode: ${CONFIG.SYSTEM_PROMPT_MODE}`);
        logger.info(`  Host: ${CONFIG.HOST}`);
        logger.info(`  Port: ${CONFIG.SERVER_PORT}`);
        logger.info(`  Required API Key: ${CONFIG.REQUIRED_API_KEY}`);
        logger.info(`  Prompt Logging: ${CONFIG.PROMPT_LOG_MODE}${CONFIG.PROMPT_LOG_FILENAME ? ` (to ${CONFIG.PROMPT_LOG_FILENAME})` : ''}`);
        logger.info(`------------------------------------------`);
        logger.info(`Unified API Server running on http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}`);
        logger.info(`  Claude-compatible: /v1/messages`);
        logger.info(`  Health check: /health`);
        logger.info(`  UI Management Console: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/`);

        // Auto-open browser to UI (only if host is localhost or 127.0.0.1)
        if (CONFIG.OPEN_SERVER_URL) {
            try {
                const open = (await import('open')).default;
                setTimeout(() => {
                    open(`http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`)
                        .then(() => {
                            logger.info('Opened login page in default browser');
                        })
                        .catch(err => {
                            logger.info(`Please open manually: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`);
                        });
                }, 1000);
            } catch (err) {
                logger.info(`Login page available at: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`);
            }
        } else {
            logger.info(`Login page available at: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`);
        }

        // Suppress unhandled error events from open module
        process.on('uncaughtException', (err) => {
            if (err.code === 'ENOENT' && err.syscall === 'spawn xdg-open') {
                logger.info('Could not auto-open browser. Please visit http://' + CONFIG.HOST + ':' + CONFIG.SERVER_PORT + '/login.html manually');
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
        // 服务器完全启动后,执行初始健康检查
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
