/**
 * OAuth 路由配置
 */

import * as oauthHandlers from '../handlers/oauth.handlers.js';

/**
 * 设置 OAuth 相关路由
 *
 * @param {Router} router - 路由器实例
 */
export function setupOAuthRoutes(router) {
    // OAuth 网页回调（返回 HTML）
    router.addRoute('GET', '/kiro/oauth/web-callback', oauthHandlers.webCallback, {
        auth: false,
        description: 'Kiro OAuth 网页回调（返回 HTML 结果页）'
    });

    // 检查 OAuth state 状态
    router.addRoute('GET', '/api/kiro/oauth/check-state', oauthHandlers.checkState, {
        auth: false,
        description: '检查 OAuth 授权是否已完成'
    });

    // 手动导入 refreshToken
    router.addRoute('POST', '/api/kiro/oauth/manual-import', oauthHandlers.manualImport, {
        auth: false,
        description: '手动导入 Kiro OAuth refreshToken'
    });

    // AWS SSO 设备授权启动
    router.addRoute('POST', '/api/kiro/oauth/aws-sso/start', oauthHandlers.awsSsoStart, {
        auth: false,
        description: '启动 AWS SSO BuilderId 设备授权流程'
    });
}
