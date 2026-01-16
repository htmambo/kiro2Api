/**
 * 统一的 Token 计算工具模块
 *
 * 提供：
 * - countTextTokens: 计算文本的 token 数（基础函数）
 * - countMessageTokens: 计算消息的完整 token 数（包括所有内容类型）
 *
 * 依赖：
 * - @anthropic-ai/tokenizer: Claude 官方 tokenizer 库
 * - ./message-sanitizer: getContentText 工具函数
 */

import { countTokens as tokenizerCountTokens } from '@anthropic-ai/tokenizer';
import { getContentText } from '../message-sanitizer.js';

/**
 * 计算文本的 token 数
 *
 * @param {string} text - 文本内容
 * @param {boolean} fast - 是否使用快速估算（默认 false）
 * @returns {number} token 数量
 *
 * 算法说明：
 * - 快速模式（fast=true）：使用字符估算
 *   - 中文约 2.5 token/字
 *   - 英文约 0.35 token/字符
 * - 精确模式（fast=false）：使用 Claude tokenizer 库
 *   - Fallback 到简单的字符数/4
 */
export function countTextTokens(text, fast = false) {
    if (!text) return 0;

    // 快速模式：使用字符估算
    if (fast) {
        // Claude tokenizer 实测：中文约 2.5 token/字，英文约 0.35 token/字符
        const chineseCharCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const totalLength = text.length;
        const nonChineseLength = totalLength - chineseCharCount;
        return Math.ceil(chineseCharCount * 2.5 + nonChineseLength * 0.35);
    }

    try {
        return tokenizerCountTokens(text);
    } catch (error) {
        // Fallback to estimation if tokenizer fails
        return Math.ceil((text || '').length / 4);
    }
}

/**
 * 计算消息的完整 token 数（包括 tool_result, tool_use, thinking, 图片等）
 *
 * ⚠️ 关键修复：之前 getContentText 只提取 text 类型，导致其他内容被忽略
 * 这会导致 token 估算严重低估，从而触发 CONTENT_LENGTH_EXCEEDS_THRESHOLD 错误
 *
 * @param {Object} message - 消息对象
 * @param {boolean} useFastEstimate - 是否使用快速估算（默认 true）
 * @returns {number} token 数量
 *
 * 支持的内容类型：
 * - text: 普通文本内容
 * - tool_result: 工具执行结果（字符串或数组）
 * - tool_use: 工具调用（包括 input）
 * - thinking: 思考内容
 * - image: 图片（估算为 1500 tokens/张）
 *
 * 算法说明：
 * 1. 收集所有文本内容
 * 2. 计算图片 token（1500 tokens/张）
 * 3. 使用 countTokens 计算文本 token
 * 4. 加上 10% 的 JSON 格式开销
 */
export function countMessageTokens(message, useFastEstimate = true) {
    if (!message) return 0;

    let allText = '';  // 收集所有文本内容
    let imageCount = 0;

    // 提取文本内容
    const textContent = getContentText(message);
    allText += textContent;

    // ⚠️ 计算所有内容类型的 token 数
    if (Array.isArray(message.content)) {
        for (const part of message.content) {
            if (part.type === 'tool_result') {
                // tool_result 的内容可能是字符串或数组
                if (typeof part.content === 'string') {
                    allText += part.content;
                } else if (Array.isArray(part.content)) {
                    const toolResultText = part.content
                        .filter(c => c.type === 'text' && c.text)
                        .map(c => c.text)
                        .join('');
                    allText += toolResultText;
                    // 检查是否有图片
                    imageCount += part.content.filter(c => c.type === 'image').length;
                }
                // JSON 结构开销（约 15 tokens）
                allText += '                ';  // 16 个空格代表结构开销
            } else if (part.type === 'tool_use') {
                // tool_use 的 input 也需要计算
                if (part.input) {
                    const inputStr = typeof part.input === 'string'
                        ? part.input
                        : JSON.stringify(part.input);
                    allText += inputStr;
                }
                // tool_use 元数据（name, id 等）
                allText += (part.name || '') + (part.id || '') + '          ';  // 结构开销
            } else if (part.type === 'thinking') {
                // ⚠️ 关键：thinking 内容也需要计算
                if (part.thinking) {
                    allText += part.thinking;
                }
            } else if (part.type === 'image') {
                // 图片 token 计数
                imageCount++;
            }
        }
    }

    // 图片 token 估算：每张图片约 1000-2000 tokens（根据分辨率）
    const imageTokens = imageCount * 1500;

    // ⚠️ 关键修复：使用 countTextTokens 正确处理中文
    // 中文约 2.5 tokens/字，英文约 0.35 tokens/字符
    const textTokens = countTextTokens(allText, useFastEstimate);

    // JSON 格式开销（约 10%）
    return Math.ceil(textTokens * 1.1) + imageTokens;
}

/**
 * 估算请求的输入 token 数
 *
 * @param {Object} requestBody - 请求体
 * @param {boolean} fast - 是否使用快速估算（默认 true）
 * @returns {number} 估算的 token 数
 */
export function estimateInputTokens(requestBody, fast = true) {
    if (!requestBody) return 0;

    let totalTokens = 0;

    // 计算消息的 token 数
    if (requestBody.messages && Array.isArray(requestBody.messages)) {
        for (const message of requestBody.messages) {
            totalTokens += countMessageTokens(message, fast);
        }
    }

    // 计算系统提示词的 token 数
    if (requestBody.system) {
        totalTokens += countTextTokens(requestBody.system, fast);
    }

    return totalTokens;
}
