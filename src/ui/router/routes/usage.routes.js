/**
 * 用量路由配置
 */

import * as usageHandlers from '../handlers/usage.handlers.js';

/**
 * 设置用量查询路由
 *
 * @param {Router} router - 路由器实例
 */
export function setupUsageRoutes(router) {

    // 获取指定账号的用量
    router.addRoute('GET', /^\/api\/usage\/([^\/]+)$/, usageHandlers.getAccountUsage, {
        auth: true,
        description: '获取指定账号的用量'
    });

    // 获取所有账号的用量
    router.addRoute('GET', '/api/usage', usageHandlers.getAllUsage, {
        auth: true,
        description: '获取所有账号的用量信息'
    });

    // 获取可用模型列表
    router.addRoute('GET', '/v1/models', usageHandlers.getFullModels, {
        auth: false,
        description: '获取所有可用模型列表'
    });
}
