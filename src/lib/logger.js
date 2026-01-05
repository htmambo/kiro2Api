/**
 * 结构化日志模块
 * 提供统一的日志接口和格式化输出
 */

/**
 * 日志级别枚举
 */
export const LogLevel = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
};

/**
 * 日志级别优先级
 */
const LOG_LEVEL_PRIORITY = {
    [LogLevel.DEBUG]: 0,
    [LogLevel.INFO]: 1,
    [LogLevel.WARN]: 2,
    [LogLevel.ERROR]: 3,
};

/**
 * 日志级别颜色（ANSI 颜色码）
 */
const LOG_LEVEL_COLORS = {
    [LogLevel.DEBUG]: '\x1b[36m', // Cyan
    [LogLevel.INFO]: '\x1b[32m',  // Green
    [LogLevel.WARN]: '\x1b[33m',  // Yellow
    [LogLevel.ERROR]: '\x1b[31m', // Red
};

const RESET_COLOR = '\x1b[0m';

/**
 * Logger 类
 */
class Logger {
    constructor(options = {}) {
        this.level = options.level || LogLevel.INFO;
        this.enableColors = options.enableColors !== false;
        this.enableTimestamp = options.enableTimestamp !== false;
        this.context = options.context || 'App';
    }

    /**
     * 检查是否应该输出该级别的日志
     * @param {string} level - 日志级别
     * @returns {boolean}
     */
    shouldLog(level) {
        return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
    }

    /**
     * 格式化时间戳
     * @returns {string}
     */
    formatTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');

        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
    }

    /**
     * 格式化日志消息
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {Object} meta - 元数据
     * @returns {string}
     */
    formatMessage(level, message, meta = {}) {
        const parts = [];

        // 时间戳
        if (this.enableTimestamp) {
            parts.push(`[${this.formatTimestamp()}]`);
        }

        // 日志级别（带颜色）
        const levelStr = level.toUpperCase().padEnd(5);
        if (this.enableColors) {
            parts.push(`${LOG_LEVEL_COLORS[level]}${levelStr}${RESET_COLOR}`);
        } else {
            parts.push(levelStr);
        }

        // 上下文
        if (this.context) {
            parts.push(`[${this.context}]`);
        }

        // 消息
        parts.push(message);

        // 元数据
        if (Object.keys(meta).length > 0) {
            parts.push(JSON.stringify(meta));
        }

        return parts.join(' ');
    }

    /**
     * 通用日志方法
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {Object} meta - 元数据
     */
    log(level, message, meta = {}) {
        if (!this.shouldLog(level)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message, meta);

        switch (level) {
            case LogLevel.ERROR:
                console.error(formattedMessage);
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage);
                break;
            case LogLevel.DEBUG:
            case LogLevel.INFO:
            default:
                console.log(formattedMessage);
                break;
        }
    }

    /**
     * Debug 级别日志
     * @param {string} message - 日志消息
     * @param {Object} meta - 元数据
     */
    debug(message, meta = {}) {
        this.log(LogLevel.DEBUG, message, meta);
    }

    /**
     * Info 级别日志
     * @param {string} message - 日志消息
     * @param {Object} meta - 元数据
     */
    info(message, meta = {}) {
        this.log(LogLevel.INFO, message, meta);
    }

    /**
     * Warn 级别日志
     * @param {string} message - 日志消息
     * @param {Object} meta - 元数据
     */
    warn(message, meta = {}) {
        this.log(LogLevel.WARN, message, meta);
    }

    /**
     * Error 级别日志
     * @param {string} message - 日志消息
     * @param {Object|Error} metaOrError - 元数据或错误对象
     */
    error(message, metaOrError = {}) {
        let meta = metaOrError;

        // 如果是 Error 对象，提取有用信息
        if (metaOrError instanceof Error) {
            meta = {
                error: metaOrError.message,
                stack: metaOrError.stack,
                code: metaOrError.code,
                status: metaOrError.status,
            };
        }

        this.log(LogLevel.ERROR, message, meta);
    }

    /**
     * 创建子 Logger（带新的上下文）
     * @param {string} context - 新的上下文名称
     * @returns {Logger}
     */
    child(context) {
        return new Logger({
            level: this.level,
            enableColors: this.enableColors,
            enableTimestamp: this.enableTimestamp,
            context: context,
        });
    }
}

/**
 * 默认 Logger 实例
 */
let defaultLogger = null;

/**
 * 初始化默认 Logger
 * @param {Object} options - Logger 配置选项
 * @returns {Logger}
 */
export function initLogger(options = {}) {
    defaultLogger = new Logger(options);
    return defaultLogger;
}

/**
 * 获取默认 Logger 实例
 * @returns {Logger}
 */
export function getLogger() {
    if (!defaultLogger) {
        defaultLogger = new Logger();
    }
    return defaultLogger;
}

/**
 * 创建带上下文的 Logger
 * @param {string} context - 上下文名称
 * @returns {Logger}
 */
export function createLogger(context) {
    return getLogger().child(context);
}

// 导出便捷方法
export const logger = {
    debug: (message, meta) => getLogger().debug(message, meta),
    info: (message, meta) => getLogger().info(message, meta),
    warn: (message, meta) => getLogger().warn(message, meta),
    error: (message, metaOrError) => getLogger().error(message, metaOrError),
};

export default Logger;
