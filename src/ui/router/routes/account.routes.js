/**
 * 账号路由配置。
 * @module ui/router/routes/account
 */

import * as accountHandlers from '../handlers/account.handlers.js';

/**
 * 设置账号管理路由。
 * @param {import('../Router.js').Router} router - 路由器实例。
 * @returns {void}
 */
export function setupAccountRoutes(router) {
    // 获取账号列表
    router.addRoute('GET', '/api/accounts', accountHandlers.getAccounts, {
        auth: true,
        description: '获取所有账号列表及统计信息'
    });

    // 添加新账号
    router.addRoute('POST', '/api/accounts', accountHandlers.addAccount, {
        auth: true,
        description: '添加新账号'
    });

    // 删除指定账号（正则路由）
    router.addRoute('DELETE', /^\/api\/accounts\/([^\/]+)$/, accountHandlers.deleteAccount, {
        auth: true,
        description: '删除指定 UUID 的账号',
        metadata: {
            params: ['uuid']
        }
    });

    // 切换账号启用/禁用状态
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/toggle$/, accountHandlers.toggleAccount, {
        auth: true,
        description: '切换账号的启用/禁用状态',
        metadata: {
            params: ['uuid']
        }
    });

    // 批量删除账号
    router.addRoute('POST', '/api/accounts/batch-delete', accountHandlers.batchDeleteAccounts, {
        auth: true,
        description: '批量删除账号（支持按状态筛选）'
    });

    // 重置所有账号健康状态
    router.addRoute('POST', '/api/accounts/reset-health', accountHandlers.resetAllHealth, {
        auth: true,
        description: '重置所有账号的健康状态'
    });

    // 重置单个账号健康状态
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/reset-health$/, accountHandlers.resetAccountHealth, {
        auth: true,
        description: '重置指定账号的健康状态',
        metadata: {
            params: ['uuid']
        }
    });

    // 批量健康检查
    router.addRoute('POST', '/api/accounts/health-check', accountHandlers.healthCheckAll, {
        auth: true,
        description: '对所有启用的账号进行健康检查'
    });

    // 单个账号健康检查
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/health-check$/, accountHandlers.healthCheckAccount, {
        auth: true,
        description: '对指定账号进行强制健康检查',
        metadata: {
            params: ['uuid']
        }
    });

    // 测试账号（最小请求）
    router.addRoute('POST', /^\/api\/accounts\/([^\/]+)\/test$/, accountHandlers.testAccount, {
        auth: true,
        description: '测试指定账号（发送最小请求）',
        metadata: {
            params: ['uuid']
        }
    });

    // 生成 OAuth 授权 URL
    router.addRoute('POST', '/api/accounts/generate-auth-url', accountHandlers.generateAuthUrl, {
        auth: true,
        description: '生成 Kiro OAuth 授权 URL'
    });

    // 清理重复账号
    router.addRoute('POST', '/api/accounts/cleanup-duplicates', accountHandlers.cleanupDuplicates, {
        auth: true,
        description: '清理重复的账号（基于 userId）'
    });
}
