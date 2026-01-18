/**
 * 转换器基类
 *
 * 使用策略模式定义转换器的通用接口。
 *
 * @module converters/BaseConverter
 */

import { MODEL_PROTOCOL_PREFIX } from '../utils/protocol.js';

/**
 * 抽象转换器基类
 *
 * 所有具体的协议转换器都应继承此类。
 */
export class BaseConverter {
    /**
     * 创建基础转换器
     *
     * @param {string} protocolName - 协议名称
     */
    constructor(protocolName) {
        if (new.target === BaseConverter) {
            throw new Error('BaseConverter是抽象类，不能直接实例化');
        }
        this.protocolName = protocolName;
    }

    /**
     * 转换请求（通用路由实现）
     *
     * 自动路由到具体的 toXxxRequest 方法
     *
     * @param {Object} data - 请求数据
     * @param {string} targetProtocol - 目标协议
     * @returns {Object} 转换后的请求
     */
    convertRequest(data, targetProtocol) {
        const methodMap = {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: 'toOpenAIRequest',
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: 'toClaudeRequest',
            [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: 'toOpenAIResponsesRequest'
        };

        const targetMethod = methodMap[targetProtocol];
        if (!targetMethod) {
            throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }

        const method = this[targetMethod];
        if (typeof method !== 'function') {
            throw new Error(`Conversion method ${targetMethod} not implemented in ${this.protocolName} converter`);
        }

        return method.call(this, data);
    }

    /**
     * 转换响应（通用路由实现）
     *
     * 自动路由到具体的 toXxxResponse 方法
     *
     * @param {Object} data - 响应数据
     * @param {string} targetProtocol - 目标协议
     * @param {string} model - 模型名称
     * @returns {Object} 转换后的响应
     */
    convertResponse(data, targetProtocol, model) {
        const methodMap = {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: 'toOpenAIResponse',
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: 'toClaudeResponse',
            [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: 'toOpenAIResponsesResponse'
        };

        const targetMethod = methodMap[targetProtocol];
        if (!targetMethod) {
            throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }

        const method = this[targetMethod];
        if (typeof method !== 'function') {
            throw new Error(`Conversion method ${targetMethod} not implemented in ${this.protocolName} converter`);
        }

        return method.call(this, data, model);
    }

    /**
     * 转换流式响应块（通用路由实现）
     *
     * 自动路由到具体的 toXxxStreamChunk 方法
     *
     * @param {Object} chunk - 流式响应块
     * @param {string} targetProtocol - 目标协议
     * @param {string} model - 模型名称
     * @returns {Object} 转换后的流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        const methodMap = {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: 'toOpenAIStreamChunk',
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: 'toClaudeStreamChunk',
            [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: 'toOpenAIResponsesStreamChunk'
        };

        const targetMethod = methodMap[targetProtocol];
        if (!targetMethod) {
            throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }

        const method = this[targetMethod];
        if (typeof method !== 'function') {
            throw new Error(`Conversion method ${targetMethod} not implemented in ${this.protocolName} converter`);
        }

        return method.call(this, chunk, model);
    }

    /**
     * 转换模型列表（通用路由实现）
     *
     * 自动路由到具体的 toXxxModelList 方法
     *
     * @param {Object} data - 模型列表数据
     * @param {string} targetProtocol - 目标协议
     * @returns {Object} 转换后的模型列表
     */
    convertModelList(data, targetProtocol) {
        const methodMap = {
            [MODEL_PROTOCOL_PREFIX.OPENAI]: 'toOpenAIModelList',
            [MODEL_PROTOCOL_PREFIX.CLAUDE]: 'toClaudeModelList',
            [MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES]: 'toOpenAIResponsesModelList'
        };

        const targetMethod = methodMap[targetProtocol];
        if (!targetMethod) {
            throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }

        const method = this[targetMethod];
        if (typeof method !== 'function') {
            throw new Error(`Conversion method ${targetMethod} not implemented in ${this.protocolName} converter`);
        }

        return method.call(this, data);
    }

    /**
     * 获取协议名称
     *
     * @returns {string} 协议名称
     */
    getProtocolName() {
        return this.protocolName;
    }
}

/**
 * 内容处理器接口
 *
 * 用于处理不同类型的内容（文本、图片、音频等）。
 */
export class ContentProcessor {
    /**
     * 处理内容
     *
     * @param {*} content - 内容数据
     * @returns {*} 处理后的内容
     */
    process(content) {
        throw new Error('process方法必须被子类实现');
    }
}

/**
 * 工具处理器接口
 *
 * 用于处理工具调用相关的转换。
 */
export class ToolProcessor {
    /**
     * 处理工具定义
     *
     * @param {Array} tools - 工具定义数组
     * @returns {Array} 处理后的工具定义
     */
    processToolDefinitions(tools) {
        throw new Error('processToolDefinitions方法必须被子类实现');
    }

    /**
     * 处理工具调用
     *
     * @param {Object} toolCall - 工具调用数据
     * @returns {Object} 处理后的工具调用
     */
    processToolCall(toolCall) {
        throw new Error('processToolCall方法必须被子类实现');
    }

    /**
     * 处理工具结果
     *
     * @param {Object} toolResult - 工具结果数据
     * @returns {Object} 处理后的工具结果
     */
    processToolResult(toolResult) {
        throw new Error('processToolResult方法必须被子类实现');
    }
}
