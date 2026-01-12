/**
 * 协议转换入口（主实现）
 *
 * 说明：
 * - 当前项目已有调用点：`src/utils/common.js` 会 import `./convert.js`
 * - 转换器主体迁入：`src/converters/**`
 * - 这里作为薄封装层，负责：
 *   1) 初始化注册（避免循环依赖）
 *   2) 暴露 convertData / getOpenAIStreamChunkStop 供业务层调用
 */

import { v4 as uuidv4 } from 'uuid';
import { ConverterFactory } from '../converters/ConverterFactory.js';
import { getProtocolPrefix } from './protocol.js';

// 触发一次性注册（副作用导入）
import '../converters/register-converters.js';

/**
 * 通用数据转换函数
 * @param {object} data - 要转换的数据（请求体或响应/流式 chunk）
 * @param {'request'|'response'|'streamChunk'|'modelList'} type - 转换类型
 * @param {string} fromProvider - 源 provider（可能带后缀，如 claude-kiro-oauth）
 * @param {string} toProvider - 目标 provider（可能带后缀）
 * @param {string} [model] - 可选模型名（部分响应/流式转换需要）
 */
export function convertData(data, type, fromProvider, toProvider, model) {
    const fromProtocol = getProtocolPrefix(fromProvider);
    const toProtocol = getProtocolPrefix(toProvider);

    const converter = ConverterFactory.getConverter(fromProtocol);
    if (!converter) {
        throw new Error(`No converter found for protocol: ${fromProtocol}`);
    }

    switch (type) {
        case 'request':
            return converter.convertRequest(data, toProtocol);
        case 'response':
            return converter.convertResponse(data, toProtocol, model);
        case 'streamChunk':
            return converter.convertStreamChunk(data, toProtocol, model);
        case 'modelList':
            return converter.convertModelList(data, toProtocol);
        default:
            throw new Error(`Unsupported conversion type: ${type}`);
    }
}

/**
 * OpenAI ChatCompletions 流式 stop chunk（用于在 Claude → OpenAI 转换后补全结尾块）
 * @param {string} model
 */
export function getOpenAIStreamChunkStop(model) {
    return {
        id: `chatcmpl-${uuidv4()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        system_fingerprint: '',
        choices: [
            {
                index: 0,
                delta: {
                    content: '',
                    reasoning_content: '',
                },
                finish_reason: 'stop',
                message: {
                    content: '',
                    reasoning_content: '',
                },
            },
        ],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

