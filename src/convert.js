/**
 * 协议转换模块 - 新架构版本
 * 使用重构后的转换器架构
 *
 * 这个文件展示了如何使用新的转换器架构
 * 可以逐步替换原有的 convert.js
 */

import { v4 as uuidv4 } from 'uuid';
import { getProtocolPrefix } from './common.js';
import { ConverterFactory } from './converters/ConverterFactory.js';

// =============================================================================
// 初始化：注册所有转换器
// =============================================================================

// =============================================================================
// 主转换函数
// =============================================================================

/**
 * 以下函数保持与原有API的兼容性
 * 内部使用新的转换器架构
 */


// 辅助函数导出
export async function extractAndProcessSystemMessages(messages) {
    const { Utils } = await import('./converters/utils.js');
    return Utils.extractSystemMessages(messages);
}

export async function extractTextFromMessageContent(content) {
    const { Utils } = await import('./converters/utils.js');
    return Utils.extractText(content);
}

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 获取所有已注册的协议
 * @returns {Array<string>} 协议前缀数组
 */
export function getRegisteredProtocols() {
    return ConverterFactory.getRegisteredProtocols();
}

/**
 * 检查协议是否已注册
 * @param {string} protocol - 协议前缀
 * @returns {boolean} 是否已注册
 */
export function isProtocolRegistered(protocol) {
    return ConverterFactory.isProtocolRegistered(protocol);
}

/**
 * 清除所有转换器缓存
 */
export function clearConverterCache() {
    ConverterFactory.clearCache();
}

/**
 * 获取转换器实例（用于高级用法）
 * @param {string} protocol - 协议前缀
 * @returns {BaseConverter} 转换器实例
 */
export function getConverter(protocol) {
    return ConverterFactory.getConverter(protocol);
}

// =============================================================================
// 辅助函数 - 从原 convert.js 迁移
// =============================================================================

// =============================================================================
// 默认导出
// =============================================================================

export default {
    getRegisteredProtocols,
    isProtocolRegistered,
    clearConverterCache,
    getConverter
};