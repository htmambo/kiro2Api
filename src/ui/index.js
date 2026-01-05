/**
 * UI模块统一入口
 * 导出所有UI相关功能
 */

import * as staticSrv from './static.js';
import * as events from './events.js';

// 从ui-manager导入其他功能
import { handleUIApiRequests } from '../ui-manager.js';

// 导出静态文件服务
export function serveStaticFiles(pathParam, res) {
    return staticSrv.serveStaticFiles(pathParam, res);
}

// 导出事件管理
export function initializeUIManagement() {
    return events.initializeUIManagement();
}

export function broadcastEvent(eventType, data) {
    return events.broadcastEvent(eventType, data);
}

// 导出UI API处理（暂时从ui-manager导入）
export { handleUIApiRequests };
