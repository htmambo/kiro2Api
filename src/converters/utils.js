/**
 * 转换器公共工具函数模块
 *
 * 提供各种协议转换所需的通用辅助函数。
 *
 * @module converters/utils
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../lib/logger.js';
import { cleanSchema, SCHEMA_CLEANER_STRATEGY } from '../utils/schema-cleaner.js';
const logger = createLogger({ module: 'ConverterUtils' });
// =============================================================================
// 常量定义
// =============================================================================

// 通用默认值
export const DEFAULT_MAX_TOKENS = 8192;
export const DEFAULT_TEMPERATURE = 1;
export const DEFAULT_TOP_P = 0.95;

// =============================================================================
// OpenAI 相关常量
// =============================================================================
export const OPENAI_DEFAULT_MAX_TOKENS = 128000;
export const OPENAI_DEFAULT_TEMPERATURE = 1;
export const OPENAI_DEFAULT_TOP_P = 0.95;
export const OPENAI_DEFAULT_INPUT_TOKEN_LIMIT = 32768;
export const OPENAI_DEFAULT_OUTPUT_TOKEN_LIMIT = 128000;

// =============================================================================
// Claude 相关常量
// =============================================================================
export const CLAUDE_DEFAULT_MAX_TOKENS = 200000;
export const CLAUDE_DEFAULT_TEMPERATURE = 1;
export const CLAUDE_DEFAULT_TOP_P = 0.95;

// =============================================================================
// Gemini 相关常量
// =============================================================================
export const GEMINI_DEFAULT_MAX_TOKENS = 65534;
export const GEMINI_DEFAULT_TEMPERATURE = 1;
export const GEMINI_DEFAULT_TOP_P = 0.95;
export const GEMINI_DEFAULT_INPUT_TOKEN_LIMIT = 32768;
export const GEMINI_DEFAULT_OUTPUT_TOKEN_LIMIT = 65534;

// =============================================================================
// OpenAI Responses 相关常量
// =============================================================================
export const OPENAI_RESPONSES_DEFAULT_MAX_TOKENS = 128000;
export const OPENAI_RESPONSES_DEFAULT_TEMPERATURE = 1;
export const OPENAI_RESPONSES_DEFAULT_TOP_P = 0.95;
export const OPENAI_RESPONSES_DEFAULT_INPUT_TOKEN_LIMIT = 32768;
export const OPENAI_RESPONSES_DEFAULT_OUTPUT_TOKEN_LIMIT = 128000;

// =============================================================================
// Ollama 相关常量
// =============================================================================
export const OLLAMA_DEFAULT_CONTEXT_LENGTH = 65534;
export const OLLAMA_DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// Claude 模型上下文长度
export const OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_45_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_45_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_HAIKU_45_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_HAIKU_45_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_OPUS_41_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_OPUS_41_MAX_OUTPUT_TOKENS = 32000;
export const OLLAMA_CLAUDE_SONNET_40_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_40_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_SONNET_37_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_37_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_OPUS_40_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_OPUS_40_MAX_OUTPUT_TOKENS = 32000;
export const OLLAMA_CLAUDE_HAIKU_35_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_HAIKU_30_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_HAIKU_30_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_CLAUDE_SONNET_35_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_SONNET_35_MAX_OUTPUT_TOKENS = 200000;
export const OLLAMA_CLAUDE_OPUS_30_CONTEXT_LENGTH = 200000;
export const OLLAMA_CLAUDE_OPUS_30_MAX_OUTPUT_TOKENS = 8192;

// Gemini 模型上下文长度
export const OLLAMA_GEMINI_25_PRO_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_25_PRO_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_25_FLASH_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_25_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_25_IMAGE_CONTEXT_LENGTH = 65534;
export const OLLAMA_GEMINI_25_IMAGE_MAX_OUTPUT_TOKENS = 32768;
export const OLLAMA_GEMINI_25_LIVE_CONTEXT_LENGTH = 131072;
export const OLLAMA_GEMINI_25_LIVE_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_25_TTS_CONTEXT_LENGTH = 65534;
export const OLLAMA_GEMINI_25_TTS_MAX_OUTPUT_TOKENS = 16384;
export const OLLAMA_GEMINI_20_FLASH_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_20_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_20_IMAGE_CONTEXT_LENGTH = 32768;
export const OLLAMA_GEMINI_20_IMAGE_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_15_PRO_CONTEXT_LENGTH = 2097152;
export const OLLAMA_GEMINI_15_PRO_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_15_FLASH_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_15_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_GEMINI_DEFAULT_CONTEXT_LENGTH = 1048576;
export const OLLAMA_GEMINI_DEFAULT_MAX_OUTPUT_TOKENS = 65534;

// GPT 模型上下文长度
export const OLLAMA_GPT4_TURBO_CONTEXT_LENGTH = 128000;
export const OLLAMA_GPT4_TURBO_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT4_32K_CONTEXT_LENGTH = 32768;
export const OLLAMA_GPT4_32K_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT4_BASE_CONTEXT_LENGTH = 200000;
export const OLLAMA_GPT4_BASE_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT35_16K_CONTEXT_LENGTH = 16385;
export const OLLAMA_GPT35_16K_MAX_OUTPUT_TOKENS = 8192;
export const OLLAMA_GPT35_BASE_CONTEXT_LENGTH = 8192;
export const OLLAMA_GPT35_BASE_MAX_OUTPUT_TOKENS = 8192;

// Qwen 模型上下文长度
export const OLLAMA_QWEN_CODER_PLUS_CONTEXT_LENGTH = 128000;
export const OLLAMA_QWEN_CODER_PLUS_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_QWEN_VL_PLUS_CONTEXT_LENGTH = 262144;
export const OLLAMA_QWEN_VL_PLUS_MAX_OUTPUT_TOKENS = 32768;
export const OLLAMA_QWEN_CODER_FLASH_CONTEXT_LENGTH = 128000;
export const OLLAMA_QWEN_CODER_FLASH_MAX_OUTPUT_TOKENS = 65534;
export const OLLAMA_QWEN_DEFAULT_CONTEXT_LENGTH = 32768;
export const OLLAMA_QWEN_DEFAULT_MAX_OUTPUT_TOKENS = 200000;

export const OLLAMA_DEFAULT_FILE_TYPE = 2;
export const OLLAMA_DEFAULT_QUANTIZATION_VERSION = 2;
export const OLLAMA_DEFAULT_ROPE_FREQ_BASE = 10000.0;
export const OLLAMA_DEFAULT_TEMPERATURE = 0.7;
export const OLLAMA_DEFAULT_TOP_P = 0.9;
export const OLLAMA_DEFAULT_QUANTIZATION_LEVEL = 'Q4_0';
export const OLLAMA_SHOW_QUANTIZATION_LEVEL = 'Q4_K_M';

// =============================================================================
// 通用辅助函数
// =============================================================================

/**
 * 判断值是否为 undefined 或 0，并返回默认值
 *
 * @param {*} value - 要检查的值
 * @param {*} defaultValue - 默认值
 * @returns {*} 处理后的值
 */
export function checkAndAssignOrDefault(value, defaultValue) {
    if (value !== undefined && value !== 0) {
        return value;
    }
    return defaultValue;
}

/**
 * 生成唯一 ID
 *
 * @param {string} [prefix=''] - ID 前缀
 * @returns {string} 生成的 ID
 */
export function generateId(prefix = '') {
    return prefix ? `${prefix}_${uuidv4()}` : uuidv4();
}

/**
 * 安全解析 JSON 字符串
 *
 * @param {string} str - JSON 字符串
 * @returns {*} 解析后的对象或原始字符串
 */
export function safeParseJSON(str) {
    if (!str) {
        return str;
    }
    let cleanedStr = str;

    // 处理可能被截断的转义序列
    if (cleanedStr.endsWith('\\') && !cleanedStr.endsWith('\\\\')) {
        cleanedStr = cleanedStr.substring(0, cleanedStr.length - 1);
    } else if (cleanedStr.endsWith('\\u') || cleanedStr.endsWith('\\u0') || cleanedStr.endsWith('\\u00')) {
        const idx = cleanedStr.lastIndexOf('\\u');
        cleanedStr = cleanedStr.substring(0, idx);
    }

    try {
        return JSON.parse(cleanedStr || '{}');
    } catch (e) {
        return str;
    }
}

/**
 * 提取消息内容中的文本
 *
 * @param {string|Array} content - 消息内容
 * @returns {string} 提取的文本
 */
export function extractTextFromMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .filter(part => part.type === 'text' && part.text)
            .map(part => part.text)
            .join('\n');
    }
    return '';
}

/**
 * 提取并处理系统消息
 *
 * @param {Array} messages - 消息数组
 * @returns {{systemInstruction: Object|null, nonSystemMessages: Array}} 系统指令与非系统消息
 */
export function extractAndProcessSystemMessages(messages) {
    const systemContents = [];
    const nonSystemMessages = [];

    for (const message of messages) {
        if (message.role === 'system') {
            systemContents.push(extractTextFromMessageContent(message.content));
        } else {
            nonSystemMessages.push(message);
        }
    }

    let systemInstruction = null;
    if (systemContents.length > 0) {
        systemInstruction = {
            parts: [{
                text: systemContents.join('\n')
            }]
        };
    }
    return { systemInstruction, nonSystemMessages };
}

/**
 * 清理 JSON Schema 属性（移除 Gemini 不支持的属性）
 *
 * 使用统一的 Schema 清理器，策略为 GEMINI。
 * 兼容性包装：保留原有函数签名，内部调用新实现。
 *
 * @param {Object} schema - JSON Schema
 * @returns {Object} 清理后的 JSON Schema
 */
export function cleanJsonSchemaProperties(schema) {
    return cleanSchema(schema, SCHEMA_CLEANER_STRATEGY.GEMINI);
}

/**
 * 映射结束原因
 *
 * @param {string} reason - 结束原因
 * @param {string} sourceFormat - 源格式
 * @param {string} targetFormat - 目标格式
 * @returns {string} 映射后的结束原因
 */
export function mapFinishReason(reason, sourceFormat, targetFormat) {
    const reasonMappings = {
        openai: {
            anthropic: {
                stop: "end_turn",
                length: "max_tokens",
                content_filter: "stop_sequence",
                tool_calls: "tool_use"
            }
        },
        gemini: {
            anthropic: {
                STOP: "end_turn",
                MAX_TOKENS: "max_tokens",
                SAFETY: "stop_sequence",
                RECITATION: "stop_sequence",
                stop: "end_turn",
                length: "max_tokens",
                safety: "stop_sequence",
                recitation: "stop_sequence",
                other: "end_turn"
            }
        }
    };

    try {
        return reasonMappings[sourceFormat][targetFormat][reason] || "end_turn";
    } catch (e) {
        return "end_turn";
    }
}

/**
 * 根据 budget_tokens 智能判断 OpenAI reasoning_effort 等级
 *
 * @param {number|null} budgetTokens - Anthropic thinking 的 budget_tokens 值
 * @returns {string} OpenAI reasoning_effort 等级
 */
export function determineReasoningEffortFromBudget(budgetTokens) {
    if (budgetTokens === null || budgetTokens === undefined) {
        logger.info("No budget_tokens provided, defaulting to reasoning_effort='high'");
        return "high";
    }

    const LOW_THRESHOLD = 50;
    const HIGH_THRESHOLD = 200;

    logger.debug(`Threshold configuration: low <= ${LOW_THRESHOLD}, medium <= ${HIGH_THRESHOLD}, high > ${HIGH_THRESHOLD}`);

    let effort;
    if (budgetTokens <= LOW_THRESHOLD) {
        effort = "low";
    } else if (budgetTokens <= HIGH_THRESHOLD) {
        effort = "medium";
    } else {
        effort = "high";
    }

    logger.info(`🎯 Budget tokens ${budgetTokens} -> reasoning_effort '${effort}' (thresholds: low<=${LOW_THRESHOLD}, high<=${HIGH_THRESHOLD})`);
    return effort;
}

/**
 * 从 OpenAI 文本中提取 thinking 内容
 *
 * @param {string} text - 文本内容
 * @returns {string|Array} 提取后的内容
 */
export function extractThinkingFromOpenAIText(text) {
    const thinkingPattern = /<thinking>\s*(.*?)\s*<\/thinking>/gs;
    const matches = [...text.matchAll(thinkingPattern)];

    const contentBlocks = [];
    let lastEnd = 0;

    for (const match of matches) {
        const beforeText = text.substring(lastEnd, match.index).trim();
        if (beforeText) {
            contentBlocks.push({
                type: "text",
                text: beforeText
            });
        }

        const thinkingText = match[1].trim();
        if (thinkingText) {
            contentBlocks.push({
                type: "thinking",
                thinking: thinkingText
            });
        }

        lastEnd = match.index + match[0].length;
    }

    const afterText = text.substring(lastEnd).trim();
    if (afterText) {
        contentBlocks.push({
            type: "text",
            text: afterText
        });
    }

    if (contentBlocks.length === 0) {
        return text;
    }

    if (contentBlocks.length === 1 && contentBlocks[0].type === "text") {
        return contentBlocks[0].text;
    }

    return contentBlocks;
}

// =============================================================================
// 工具状态管理器（单例模式）
// =============================================================================

/**
 * 全局工具状态管理器
 */
class ToolStateManager {
    /**
     * 创建工具状态管理器（单例）
     */
    constructor() {
        if (ToolStateManager.instance) {
            return ToolStateManager.instance;
        }
        ToolStateManager.instance = this;
        this._toolMappings = {};
        return this;
    }

    /**
     * 存储函数名与工具 ID 的映射
     *
     * @param {string} funcName - 函数名
     * @param {string} toolId - 工具 ID
     * @returns {void}
     */
    storeToolMapping(funcName, toolId) {
        this._toolMappings[funcName] = toolId;
    }

    /**
     * 获取工具 ID
     *
     * @param {string} funcName - 函数名
     * @returns {string|null} 工具 ID
     */
    getToolId(funcName) {
        return this._toolMappings[funcName] || null;
    }

    /**
     * 清空映射
     *
     * @returns {void}
     */
    clearMappings() {
        this._toolMappings = {};
    }
}

/**
 * 工具状态管理器单例
 *
 * @type {ToolStateManager}
 */
export const toolStateManager = new ToolStateManager();
