import * as http from 'http';
import { initializeConfig, CONFIG } from '../config/manager.js';
import { initializeUIManagement, registerAccountServiceInitializer } from '../ui-manager.js';
import { initializeAPIManagement } from './manager.js';
import { createRequestHandler } from './request-handler.js';
import { initLogger, createLogger } from '../lib/logger.js';
import { serviceInstances, getServiceAdapter } from '../kiro/adapter.js';
import { createAccountStore } from '../account/index.js';
import { AccountManager } from '../kiro/account-manager.js';
import deepmerge from 'deepmerge';

import 'dotenv/config'; // Import dotenv and configure it

// 从环境变量读取日志级别
const logLevel = process.env.LOG_LEVEL || 'info';
initLogger({ level: logLevel });

const logger = createLogger('api:server');

// --- Server Initialization ---
async function startServer() {
    // Initialize configuration
    await initializeConfig();
    
    // Initialize Account services
    const services = await initAccountService(CONFIG);

    // Initialize UI management features
    initializeUIManagement(CONFIG);

    // Register account service initializer for config reload
    registerAccountServiceInitializer(initAccountService);

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
                            logger.info('[UI] Opened login page in default browser');
                        })
                        .catch(err => {
                            logger.info(`[UI] Please open manually: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`);
                        });
                }, 1000);
            } catch (err) {
                logger.info(`[UI] Login page available at: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`);
            }
        } else {
            logger.info(`[UI] Login page available at: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`);
        }

        // Suppress unhandled error events from open module
        process.on('uncaughtException', (err) => {
            if (err.code === 'ENOENT' && err.syscall === 'spawn xdg-open') {
                logger.info('[UI] Could not auto-open browser. Please visit http://' + CONFIG.HOST + ':' + CONFIG.SERVER_PORT + '/login.html manually');
            } else {
                logger.error('[Server] Uncaught Exception', err);
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
            logger.info('[Initialization] Performing initial health checks for account pool...');
            if (typeof accountPoolManager.performHealthChecks === 'function') {
                accountPoolManager.performHealthChecks(true);
            }
        }
    });
    return server; // Return the server instance for testing purposes
}
let useSQLiteMode = false;
let accountManager = null;

/**
 * Initialize API services and account manager
 * @param {Object} config - The server configuration
 * @returns {Promise<Object>} The initialized services
 */
export async function initAccountService(config) {
    useSQLiteMode = config.USE_SQLITE_POOL === true;

    const accountPool = config.accountPool || { accounts: [] };

    // 使用工厂创建 AccountStore
    const accountStore = createAccountStore({
        USE_SQLITE: useSQLiteMode,
        ACCOUNT_POOL_FILE_PATH: config.ACCOUNT_POOL_FILE_PATH || 'configs/account_pool.json',
        SQLITE_DB_PATH: config.SQLITE_DB_PATH || 'data/provider_pool.db',
        SAVE_DEBOUNCE_TIME: 1000
    });

    // 创建 AccountManager 管理 Store
    accountManager = new AccountManager(accountStore, {
        maxErrorCount: config.MAX_ERROR_COUNT ?? 3,
        healthCheckInterval: config.HEALTH_CHECK_INTERVAL,
        logLevel: 'info'
    });

    // 记录账号存储类型和配置
    const storeType = useSQLiteMode ? 'SQLite' : 'JSON';
    const storePath = useSQLiteMode
        ? (config.SQLITE_DB_PATH || 'data/provider_pool.db')
        : (config.ACCOUNT_POOL_FILE_PATH || 'configs/account_pool.json');
    const accountCount = accountStore.listAccounts().length;

    logger.info('========================================');
    logger.info('[Account] Account Manager initialized');
    logger.info(`[Account] Storage type: ${storeType}`);
    logger.info(`[Account] Storage path: ${storePath}`);
    logger.info(`[Account] Total accounts: ${accountCount}`);
    logger.info(`[Account] Max error count: ${config.MAX_ERROR_COUNT ?? 3}`);
    if (config.HEALTH_CHECK_INTERVAL) {
        logger.info(`[Account] Health check interval: ${config.HEALTH_CHECK_INTERVAL}ms`);
    }
    logger.info('========================================');

    getServiceAdapter(config); // 初始化主服务适配器实例

    return serviceInstances;
}

startServer().catch(err => {
    logger.error('[Server] Failed to start server', err);
    process.exit(1);
});

/**
 * Get API service adapter, selecting an account when available
 * @param {Object} config - The current request configuration
 * @param {string} [requestedModel] - Optional. The model name to filter accounts by.
 * @returns {Promise<Object>} The API service adapter
 */
export async function getApiService(config, requestedModel = null) {
    let serviceConfig = config;

    if (accountManager) {
        const selectedAccountConfig = accountManager.selectAccount(requestedModel, { skipUsageCount: true });
        if (selectedAccountConfig) {
            serviceConfig = deepmerge(config, selectedAccountConfig);
            delete serviceConfig.accountPool;
            delete serviceConfig.providerPools;
            config.uuid = serviceConfig.uuid;
            logger.info(`[API Service] Using account configuration: ${serviceConfig.uuid}${requestedModel ? ` (model: ${requestedModel})` : ''}`);
        } else {
            logger.warn(`[API Service] No healthy account found${requestedModel ? ` supporting model: ${requestedModel}` : ''}. Falling back to main config.`);
        }
    }

    return getServiceAdapter(serviceConfig);
}

export function getAccountManager() {
    return accountManager;
}

// 向后兼容：保留旧名称
export function getAccountPoolManager() {
    return accountManager;
}
