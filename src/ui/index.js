/**
 * UI 模块统一入口。
 * 聚合静态资源、事件广播与 UI API 处理能力。
 * @module ui
 */

import * as staticSrv from './static.js';
import * as events from './events.js';

// 从 ui-manager 导入其他功能
import { handleUIApiRequests } from '../ui-manager.js';

/**
 * 提供静态文件服务的统一入口。
 * @param {string} pathParam - 请求路径。
 * @param {import('http').ServerResponse} res - HTTP 响应对象。
 * @returns {void}
 */
export function serveStaticFiles(pathParam, res) {
    return staticSrv.serveStaticFiles(pathParam, res);
}

/**
 * 初始化 UI 事件管理与日志广播。
 * @returns {void}
 */
export function initializeUIManagement() {
    return events.initializeUIManagement();
}

/**
 * 向 UI 客户端广播事件。
 * @param {string} eventType - 事件类型。
 * @param {any} data - 事件数据。
 * @returns {void}
 */
export function broadcastEvent(eventType, data) {
    return events.broadcastEvent(eventType, data);
}

// 导出 UI API 处理（暂时从 ui-manager 导入）
export { handleUIApiRequests };
