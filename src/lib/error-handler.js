/**
 * 错误处理模块
 * 提供统一的错误类型定义和错误处理逻辑
 */

/**
 * 错误类型枚举
 */
export const ErrorType = {
    AUTHENTICATION_ERROR: 'authentication_error',
    PERMISSION_ERROR: 'permission_error',
    RATE_LIMIT_ERROR: 'rate_limit_error',
    SERVER_ERROR: 'server_error',
    INVALID_REQUEST_ERROR: 'invalid_request_error',
    NETWORK_ERROR: 'network_error',
    TIMEOUT_ERROR: 'timeout_error',
};

/**
 * HTTP 状态码到错误类型的映射
 */
const STATUS_CODE_TO_ERROR_TYPE = {
    401: ErrorType.AUTHENTICATION_ERROR,
    403: ErrorType.PERMISSION_ERROR,
    429: ErrorType.RATE_LIMIT_ERROR,
    500: ErrorType.SERVER_ERROR,
    502: ErrorType.SERVER_ERROR,
    503: ErrorType.SERVER_ERROR,
    504: ErrorType.TIMEOUT_ERROR,
};

/**
 * 错误消息和建议配置
 */
const ERROR_CONFIG = {
    [ErrorType.AUTHENTICATION_ERROR]: {
        message: 'Authentication failed. Please check your credentials.',
        suggestions: [
            'Verify your OAuth credentials are valid',
            'Try re-authenticating by deleting the credentials file',
            'Check if your account has the necessary permissions'
        ]
    },
    [ErrorType.PERMISSION_ERROR]: {
        message: 'Access forbidden. Insufficient permissions.',
        suggestions: [
            'Ensure your account has the necessary permissions',
            'Check if the API is enabled for your account',
            'Verify the configuration is correct'
        ]
    },
    [ErrorType.RATE_LIMIT_ERROR]: {
        message: 'Too many requests. Rate limit exceeded.',
        suggestions: [
            'The request has been automatically retried with exponential backoff',
            'If the issue persists, try reducing the request frequency',
            'Consider upgrading your API quota if available'
        ]
    },
    [ErrorType.SERVER_ERROR]: {
        message: 'Server error occurred. This is usually temporary.',
        suggestions: [
            'The request has been automatically retried',
            'If the issue persists, try again in a few minutes',
            'Check service status page for outages'
        ]
    },
    [ErrorType.TIMEOUT_ERROR]: {
        message: 'Request timeout. The server took too long to respond.',
        suggestions: [
            'The request has been automatically retried',
            'Try reducing the complexity of your request',
            'Check your network connection'
        ]
    },
    [ErrorType.INVALID_REQUEST_ERROR]: {
        message: 'Invalid request. Please check your request format.',
        suggestions: [
            'Check your request format and parameters',
            'Ensure all required fields are provided',
            'Verify the data types are correct'
        ]
    },
    [ErrorType.NETWORK_ERROR]: {
        message: 'Network error. Unable to connect to the server.',
        suggestions: [
            'Check your internet connection',
            'Verify the server URL is correct',
            'Check if a firewall is blocking the connection'
        ]
    }
};

/**
 * 根据 HTTP 状态码获取错误类型
 * @param {number} statusCode - HTTP 状态码
 * @returns {string} 错误类型
 */
export function getErrorType(statusCode) {
    if (statusCode >= 400 && statusCode < 500) {
        return STATUS_CODE_TO_ERROR_TYPE[statusCode] || ErrorType.INVALID_REQUEST_ERROR;
    }
    if (statusCode >= 500) {
        return STATUS_CODE_TO_ERROR_TYPE[statusCode] || ErrorType.SERVER_ERROR;
    }
    return ErrorType.INVALID_REQUEST_ERROR;
}

/**
 * 获取错误配置
 * @param {string} errorType - 错误类型
 * @returns {Object} 错误配置对象
 */
export function getErrorConfig(errorType) {
    return ERROR_CONFIG[errorType] || {
        message: 'An unexpected error occurred.',
        suggestions: ['Please try again later']
    };
}

/**
 * 统一的错误处理函数
 * @param {http.ServerResponse} res - HTTP 响应对象
 * @param {Error} error - 错误对象
 * @param {Object} options - 可选配置
 * @param {boolean} options.logToConsole - 是否输出到控制台（默认 true）
 * @param {Function} options.logger - 自定义日志函数
 */
export function handleError(res, error, options = {}) {
    const { logToConsole = true, logger = console.error } = options;

    const statusCode = error.response?.status || error.status || error.code || 500;
    const errorType = getErrorType(statusCode);
    const errorConfig = getErrorConfig(errorType);

    const errorMessage = error.message || errorConfig.message;
    const suggestions = errorConfig.suggestions;

    // 日志输出
    if (logToConsole) {
        logger(`\n[Server] Request failed (${statusCode}): ${errorMessage}`);
        if (suggestions.length > 0) {
            logger('[Server] Suggestions:');
            suggestions.forEach((suggestion, index) => {
                logger(`  ${index + 1}. ${suggestion}`);
            });
        }
        logger('[Server] Full error details:', error.stack || error);
    }

    // 发送响应
    if (!res.headersSent) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    }

    const errorPayload = {
        error: {
            type: errorType,
            message: errorMessage,
            code: statusCode,
            suggestions: suggestions,
            details: error.response?.data
        }
    };

    res.end(JSON.stringify(errorPayload));
}

/**
 * 创建符合 provider 格式的错误响应（非流式）
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {Object} 格式化的错误响应对象
 */
export function createErrorResponse(error, fromProvider) {
    const statusCode = error.status || error.code || 500;
    const errorType = getErrorType(statusCode);
    const errorMessage = error.message || "An error occurred during processing.";

    // 根据协议前缀返回不同格式
    const protocolPrefix = getProtocolPrefix(fromProvider);

    switch (protocolPrefix) {
        case 'claude':
            return {
                type: "error",
                error: {
                    type: errorType,
                    message: errorMessage
                }
            };

        default:
            return {
                error: {
                    message: errorMessage,
                    type: errorType,
                    code: errorType
                }
            };
    }
}

/**
 * 创建符合 provider 格式的流式错误响应
 * @param {Error} error - 错误对象
 * @param {string} fromProvider - 客户端期望的提供商格式
 * @returns {string} 格式化的流式错误响应字符串
 */
export function createStreamErrorResponse(error, fromProvider) {
    const statusCode = error.status || error.code || 500;
    const errorType = getErrorType(statusCode);
    const errorMessage = error.message || "An error occurred during streaming.";

    const protocolPrefix = getProtocolPrefix(fromProvider);

    switch (protocolPrefix) {
        case 'claude':
            const claudeError = {
                type: "error",
                error: {
                    type: errorType,
                    message: errorMessage
                }
            };
            return `event: error\ndata: ${JSON.stringify(claudeError)}\n\n`;

        default:
            const defaultError = {
                error: {
                    message: errorMessage,
                    type: errorType,
                    code: null
                }
            };
            return `data: ${JSON.stringify(defaultError)}\n\n`;
    }
}

/**
 * 从提供商字符串中提取协议前缀
 * @param {string} provider - 提供商字符串
 * @returns {string} 协议前缀
 */
function getProtocolPrefix(provider) {
    const hyphenIndex = provider.indexOf('-');
    if (hyphenIndex !== -1) {
        return provider.substring(0, hyphenIndex);
    }
    return provider;
}
