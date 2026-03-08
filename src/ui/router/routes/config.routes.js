/**
 * 配置路由配置。
 * @module ui/router/routes/config
 */

import * as configHandlers from '../handlers/config.handlers.js';

/**
 * 设置配置管理路由。
 * @param {import('../Router.js').Router} router - 路由器实例。
 * @returns {void}
 */
export function setupConfigRoutes(router) {
    // 获取配置
    router.addRoute('GET', '/api/config', configHandlers.getConfig, {
        auth: true,
        description: '获取当前系统配置'
    });

    // 更新配置
    router.addRoute('POST', '/api/config', configHandlers.updateConfig, {
        auth: true,
        description: '更新系统配置'
    });

    // 重载配置文件
    router.addRoute('POST', '/api/reload-config', configHandlers.reloadConfig, {
        auth: true,
        description: '重载配置文件（从磁盘重新读取）'
    });
}
