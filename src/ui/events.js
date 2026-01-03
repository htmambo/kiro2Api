/**
 * UI事件广播模块
 * 处理日志广播和事件流
 */

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

    // Override console.log to broadcast logs
    const originalLog = console.log;
    console.log = function(...args) {
        originalLog.apply(console, args);
        const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: message
        };
        global.logBuffer.push(logEntry);
        if (global.logBuffer.length > 100) {
            global.logBuffer.shift();
        }
        broadcastEvent('log', logEntry);
    };

    // Override console.error to broadcast errors
    const originalError = console.error;
    console.error = function(...args) {
        originalError.apply(console, args);
        const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: message
        };
        global.logBuffer.push(logEntry);
        if (global.logBuffer.length > 100) {
            global.logBuffer.shift();
        }
        broadcastEvent('log', logEntry);
    };
}

/**
 * 广播事件到所有连接的UI客户端
 * @param {string} eventType - 事件类型
 * @param {any} data - 要广播的数据
 */
export function broadcastEvent(eventType, data) {
    if (global.eventClients && global.eventClients.length > 0) {
        const payload = typeof data === 'string' ? data : JSON.stringify(data);
        global.eventClients.forEach(client => {
            client.write(`event: ${eventType}\n`);
            client.write(`data: ${payload}\n\n`);
        });
    }
}
