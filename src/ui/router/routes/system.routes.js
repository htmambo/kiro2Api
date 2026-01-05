/**
 * 系统路由配置
 */

import * as systemHandlers from '../handlers/system.handlers.js';

/**
 * 设置系统相关路由
 *
 * @param {Router} router - 路由器实例
 */
export function setupSystemRoutes(router) {
    // 登录 - 无需认证
    router.addRoute('POST', '/api/login', systemHandlers.login, {
        auth: false,
        description: '用户登录接口',
        metadata: {
            category: 'system',
            tags: ['auth', 'login']
        }
    });

    // 健康检查 - 无需认证
    router.addRoute('GET', '/api/health', systemHandlers.healthCheck, {
        auth: false,
        description: '健康检查接口（用于前端 token 验证）',
        metadata: {
            category: 'system',
            tags: ['health', 'monitoring']
        }
    });

    // 获取系统信息 - 需要认证
    router.addRoute('GET', '/api/system', systemHandlers.getSystemInfo, {
        auth: true,
        description: '获取系统运行信息（内存、CPU、运行时间等）',
        metadata: {
            category: 'system',
            tags: ['system', 'monitoring']
        }
    });

    // 重启服务器 - 需要认证（仅 Worker 模式）
    router.addRoute('POST', '/api/restart', systemHandlers.restartServer, {
        auth: true,
        description: '重启服务器（仅 Worker 模式支持）',
        metadata: {
            category: 'system',
            tags: ['system', 'admin']
        }
    });

    // 获取日志 - 无需认证
    router.addRoute('GET', '/api/logs', systemHandlers.getLogs, {
        auth: false,
        description: '获取系统运行日志',
        metadata: {
            category: 'system',
            tags: ['logs', 'monitoring']
        }
    });

    // 清空日志 - 无需认证
    router.addRoute('DELETE', '/api/logs', systemHandlers.clearLogs, {
        auth: false,
        description: '清空系统日志缓冲区',
        metadata: {
            category: 'system',
            tags: ['logs', 'admin']
        }
    });

    // SSE 实时事件推送 - 无需认证
    router.addRoute('GET', '/api/events', systemHandlers.eventStream, {
        auth: false,
        description: 'Server-Sent Events 实时事件推送',
        metadata: {
            category: 'system',
            tags: ['sse', 'realtime']
        }
    });
}
