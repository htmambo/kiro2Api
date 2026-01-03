import * as http from 'http';
import { initializeConfig, CONFIG } from './config-manager.js';
import { initApiService } from './service-manager.js';
import { initializeUIManagement } from './ui-manager.js';
import { initializeAPIManagement } from './api-manager.js';
import { createRequestHandler } from './request-handler.js';

import 'dotenv/config'; // Import dotenv and configure it
import { getActivePoolManager } from './service-manager.js';

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
    const requestHandlerInstance = createRequestHandler(CONFIG, getActivePoolManager());

    const server = http.createServer(requestHandlerInstance);
    server.listen(CONFIG.SERVER_PORT, CONFIG.HOST, async () => {
        console.log(`--- Unified API Server Configuration ---`);
        console.log(`  System Prompt File: ${CONFIG.SYSTEM_PROMPT_FILE_PATH || 'Default'}`);
        console.log(`  System Prompt Mode: ${CONFIG.SYSTEM_PROMPT_MODE}`);
        console.log(`  Host: ${CONFIG.HOST}`);
        console.log(`  Port: ${CONFIG.SERVER_PORT}`);
        console.log(`  Required API Key: ${CONFIG.REQUIRED_API_KEY}`);
        console.log(`  Prompt Logging: ${CONFIG.PROMPT_LOG_MODE}${CONFIG.PROMPT_LOG_FILENAME ? ` (to ${CONFIG.PROMPT_LOG_FILENAME})` : ''}`);
        console.log(`------------------------------------------`);
        console.log(`\nUnified API Server running on http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}`);
        console.log(`Supports multiple API formats:`);
        console.log(`  • Claude-compatible: /v1/messages`);
        console.log(`  • Health check: /health`);
        console.log(`  • UI Management Console: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/`);

        // Auto-open browser to UI (only if host is localhost or 127.0.0.1)
        if (CONFIG.HOST === 'localhost' || CONFIG.HOST === '127.0.0.1') {
            try {
                const open = (await import('open')).default;
                setTimeout(() => {
                    open(`http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`)
                        .then(() => {
                            console.log('[UI] Opened login page in default browser');
                        })
                        .catch(err => {
                            console.log('[UI] Please open manually: http://' + CONFIG.HOST + ':' + CONFIG.SERVER_PORT + '/login.html');
                        });
                }, 1000);
            } catch (err) {
                console.log(`[UI] Login page available at: http://${CONFIG.HOST}:${CONFIG.SERVER_PORT}/login.html`);
            }
        } else {
            console.log('[UI] Login page available at: http://' + CONFIG.HOST + ':' + CONFIG.SERVER_PORT + '/login.html');
        }

        // Suppress unhandled error events from open module
        process.on('uncaughtException', (err) => {
            if (err.code === 'ENOENT' && err.syscall === 'spawn xdg-open') {
                console.log('[UI] Could not auto-open browser. Please visit http://' + CONFIG.HOST + ':' + CONFIG.SERVER_PORT + '/login.html manually');
            } else {
                console.error('[Server] Uncaught Exception:', err);
                process.exit(1);
            }
        });

        if (CONFIG.CRON_REFRESH_TOKEN) {
            console.log(`  • Cron Near Minutes: ${CONFIG.CRON_NEAR_MINUTES}`);
            console.log(`  • Cron Refresh Token: ${CONFIG.CRON_REFRESH_TOKEN}`);
            // 每 CRON_NEAR_MINUTES 分钟执行一次心跳日志和令牌刷新
            setInterval(heartbeatAndRefreshToken, CONFIG.CRON_NEAR_MINUTES * 60 * 1000);
        }
        // 服务器完全启动后,执行初始健康检查
        const poolManager = getActivePoolManager();
        if (poolManager) {
            console.log('[Initialization] Performing initial health checks for account pool...');
            if (typeof poolManager.performHealthChecks === 'function') {
                poolManager.performHealthChecks(true);
            }
        }
    });
    return server; // Return the server instance for testing purposes
}

startServer().catch(err => {
    console.error("[Server] Failed to start server:", err.message);
    process.exit(1);
});
