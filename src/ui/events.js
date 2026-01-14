/**
 * UI事件广播模块
 * 处理日志广播和事件流
 */

import Logger, { createLogger } from '../lib/logger.js';

const logger = createLogger('ui:events');

/**
 * 初始化UI管理功能
 * 设置日志广播和事件客户端
 */
export function initializeUIManagement() {
    // Initialize log broadcasting for UI
    if (!global.eventClients) {
        global.eventClients = [];
    }
    if (!global.logBuffer) {
        global.logBuffer = [];
    }

    // Patch Logger.prototype so broadcasting survives initLogger()/new Logger() calls.
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
                    // ignore
                }
            }
        });
        global.eventClients = aliveClients;
    }
}
