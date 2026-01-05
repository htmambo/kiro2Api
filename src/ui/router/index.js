/**
 * 路由器主入口
 *
 * 负责创建和配置路由器实例，注册所有路由模块
 */

import { Router } from './Router.js';
import { setupSystemRoutes } from './routes/system.routes.js';
import { setupAccountRoutes } from './routes/account.routes.js';
import { setupConfigRoutes } from './routes/config.routes.js';
import { setupUsageRoutes } from './routes/usage.routes.js';
import { setupOAuthRoutes } from './routes/oauth.routes.js';
import { setupUploadRoutes } from './routes/upload.routes.js';

/**
 * 创建并配置路由器实例
 * @returns {Router} 配置好的路由器实例
 */
export function createRouter() {
    const router = new Router();

    // 注册所有路由模块
    setupSystemRoutes(router);
    setupAccountRoutes(router);
    setupConfigRoutes(router);
    setupUsageRoutes(router);
    setupOAuthRoutes(router);
    setupUploadRoutes(router);

    return router;
}

// 导出 Router 类供其他模块使用
export { Router };
