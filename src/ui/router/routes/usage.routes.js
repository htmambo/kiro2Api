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
    // 获取所有提供商用量
    router.addRoute('GET', '/api/usage', usageHandlers.getAllUsage, {
        auth: true,
        description: '获取所有提供商的用量信息'
    });

    // 获取指定提供商类型或单个账号的用量（单段路径）
    router.addRoute('GET', /^\/api\/usage\/([^\/]+)$/, usageHandlers.getUsageBySegment, {
        auth: true,
        description: '获取指定提供商类型或账号 UUID 的用量'
    });

    // 获取指定账号的详细用量（双段路径）
    router.addRoute('GET', /^\/api\/usage\/([^\/]+)\/([^\/]+)$/, usageHandlers.getAccountUsage, {
        auth: true,
        description: '获取指定账号的详细用量信息'
    });

    // 获取可用模型列表
    router.addRoute('GET', '/api/full-models', usageHandlers.getFullModels, {
        auth: true,
        description: '获取所有可用模型列表'
    });
}
