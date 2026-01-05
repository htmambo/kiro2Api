/**
 * 文件上传路由配置
 */

import * as uploadHandlers from '../handlers/upload.handlers.js';

/**
 * 设置文件上传路由
 *
 * @param {Router} router - 路由器实例
 */
export function setupUploadRoutes(router) {
    // 上传 OAuth 凭据文件
    router.addRoute('POST', '/api/upload-oauth-credentials', uploadHandlers.uploadCredentials, {
        auth: true,
        description: '上传 OAuth 凭据文件（支持 multipart/form-data）'
    });

    // 获取已上传的配置文件列表
    router.addRoute('GET', '/api/upload-configs', uploadHandlers.getUploadConfigs, {
        auth: true,
        description: '扫描并获取已上传的配置文件列表'
    });

    // 查看指定配置文件内容
    router.addRoute('GET', /^\/api\/upload-configs\/view\/(.+)$/, uploadHandlers.viewConfig, {
        auth: true,
        description: '查看指定配置文件的详细内容'
    });

    // 删除指定配置文件
    router.addRoute('DELETE', /^\/api\/upload-configs\/delete\/(.+)$/, uploadHandlers.deleteConfig, {
        auth: true,
        description: '删除指定的配置文件'
    });

    // 快速关联配置文件
    router.addRoute('POST', '/api/quick-link-provider', uploadHandlers.quickLink, {
        auth: true,
        description: '快速关联配置文件到对应提供商'
    });

    // 批量快速关联
    router.addRoute('POST', '/api/quick-link-provider/bulk', uploadHandlers.bulkQuickLink, {
        auth: true,
        description: '批量快速关联多个配置文件'
    });
}
