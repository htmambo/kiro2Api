/**
 * 转换器注册模块
 *
 * 用于注册所有转换器到工厂，避免循环依赖问题。
 *
 * @module converters/register-converters
 */

import { MODEL_PROTOCOL_PREFIX } from '../utils/protocol.js';
import { ConverterFactory } from './ConverterFactory.js';
import './ContentProcessorFactory.js';
import './ToolProcessorFactory.js';
import { OpenAIConverter } from './strategies/OpenAIConverter.js';
import { OpenAIResponsesConverter } from './strategies/OpenAIResponsesConverter.js';
import { ClaudeConverter } from './strategies/ClaudeConverter.js';

/**
 * 注册所有转换器到工厂
 *
 * 此函数应在应用启动时调用一次。
 *
 * @returns {void}
 */
export function registerAllConverters() {
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OPENAI, OpenAIConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES, OpenAIResponsesConverter);
    ConverterFactory.registerConverter(MODEL_PROTOCOL_PREFIX.CLAUDE, ClaudeConverter);
}

// 自动注册所有转换器（模块加载时执行一次）
registerAllConverters();
