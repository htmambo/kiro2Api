/**
 * UI事件广播模块。
 * 负责初始化日志广播、管理事件客户端，并向前端推送事件流。
 * @module ui/events
 */

import Logger, { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:events');

/**
 * 初始化 UI 管理功能。
 * 建立日志广播机制并准备事件客户端容器。
 * @returns {void}
 */
export function initializeUIManagement() {
    // 初始化用于 UI 的日志广播容器
    if (!global.eventClients) {
        global.eventClients = [];
    }
    if (!global.logBuffer) {
        global.logBuffer = [];
    }

    // 打补丁保证 Logger 的新实例也能触发广播
    if (Logger.prototype.__uiBroadcastPatched) {
        return;
    }

    const originalLog = Logger.prototype.log;
    Logger.prototype.log = function(level, message, meta = {}) {
        originalLog.call(this, level, message, meta);

        let metaForEntry = meta;
        if (metaForEntry && typeof metaForEntry !== 'object') {
            metaForEntry = { meta: metaForEntry };
        }
        try {
            JSON.stringify(metaForEntry);
        } catch {
            metaForEntry = { unserializableMeta: true };
        }

        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            meta: metaForEntry
        };

        global.logBuffer.push(logEntry);
        if (global.logBuffer.length > 100) {
            global.logBuffer.shift();
        }
        broadcastEvent('log', logEntry);
    };

    Logger.prototype.__uiBroadcastPatched = true;
    logger.info('UI log broadcasting initialized');
}

/**
 * 广播事件到所有连接的UI客户端
 * @param {string} eventType - 事件类型
 * @param {any} data - 要广播的数据
 */
export function broadcastEvent(eventType, data) {
    if (global.eventClients && global.eventClients.length > 0) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        const aliveClients = [];
        global.eventClients.forEach(client => {
            try {
                client.write(`event: ${eventType}\n`);
                client.write(`data: ${payload}\n\n`);
                aliveClients.push(client);
            } catch {
                try {
                    client.end();
                } catch {
                    // 忽略无法关闭的连接
                }
            }
        });
        global.eventClients = aliveClients;
    }
}
