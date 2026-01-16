/**
 * Ollama 转换器
 *
 * 处理 Ollama 协议与其他协议之间的转换。
 *
 * @module converters/strategies/OllamaConverter
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { BaseConverter } from '../BaseConverter.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/protocol.js';
import {
    OLLAMA_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_DEFAULT_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_45_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_45_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_HAIKU_45_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_HAIKU_45_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_OPUS_41_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_OPUS_41_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_SONNET_40_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_40_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_SONNET_37_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_37_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_OPUS_40_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_OPUS_40_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_HAIKU_35_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_HAIKU_30_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_HAIKU_30_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_SONNET_35_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_SONNET_35_MAX_OUTPUT_TOKENS,
    OLLAMA_CLAUDE_OPUS_30_CONTEXT_LENGTH,
    OLLAMA_CLAUDE_OPUS_30_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_PRO_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_PRO_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_FLASH_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_IMAGE_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_IMAGE_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_LIVE_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_LIVE_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_25_TTS_CONTEXT_LENGTH,
    OLLAMA_GEMINI_25_TTS_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_20_FLASH_CONTEXT_LENGTH,
    OLLAMA_GEMINI_20_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_20_IMAGE_CONTEXT_LENGTH,
    OLLAMA_GEMINI_20_IMAGE_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_15_PRO_CONTEXT_LENGTH,
    OLLAMA_GEMINI_15_PRO_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_15_FLASH_CONTEXT_LENGTH,
    OLLAMA_GEMINI_15_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_GEMINI_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_GEMINI_DEFAULT_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT4_TURBO_CONTEXT_LENGTH,
    OLLAMA_GPT4_TURBO_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT4_32K_CONTEXT_LENGTH,
    OLLAMA_GPT4_32K_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT4_BASE_CONTEXT_LENGTH,
    OLLAMA_GPT4_BASE_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT35_16K_CONTEXT_LENGTH,
    OLLAMA_GPT35_16K_MAX_OUTPUT_TOKENS,
    OLLAMA_GPT35_BASE_CONTEXT_LENGTH,
    OLLAMA_GPT35_BASE_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_CODER_PLUS_CONTEXT_LENGTH,
    OLLAMA_QWEN_CODER_PLUS_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_VL_PLUS_CONTEXT_LENGTH,
    OLLAMA_QWEN_VL_PLUS_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_CODER_FLASH_CONTEXT_LENGTH,
    OLLAMA_QWEN_CODER_FLASH_MAX_OUTPUT_TOKENS,
    OLLAMA_QWEN_DEFAULT_CONTEXT_LENGTH,
    OLLAMA_QWEN_DEFAULT_MAX_OUTPUT_TOKENS,
    OLLAMA_DEFAULT_FILE_TYPE,
    OLLAMA_DEFAULT_QUANTIZATION_VERSION,
    OLLAMA_DEFAULT_ROPE_FREQ_BASE,
    OLLAMA_DEFAULT_TEMPERATURE,
    OLLAMA_DEFAULT_TOP_P,
    OLLAMA_DEFAULT_QUANTIZATION_LEVEL,
    OLLAMA_SHOW_QUANTIZATION_LEVEL
} from '../utils.js';
import { createLogger } from '../../lib/logger.js';
const logger = createLogger('OllamaConverter');



/**
 * Ollama 转换器类
 *
 * 实现 Ollama 协议到其他协议的转换。
 */
export class OllamaConverter extends BaseConverter {
    /**
     * 创建 Ollama 转换器
     */
    constructor() {
        super('ollama');
    }

    /**
     * 转换请求（Ollama -> 其他协议）
     *
     * @param {Object} data - 请求数据
     * @param {string} targetProtocol - 目标协议
     * @returns {Object} 转换后的请求
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toOpenAIRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换响应（其他协议 -> Ollama）
     *
     * @param {Object} data - 响应数据
     * @param {string} sourceProtocol - 源协议
     * @param {string} model - 模型名称
     * @returns {Object} 转换后的响应
     */
    convertResponse(data, sourceProtocol, model) {
        return this.toOllamaChatResponse(data, model);
    }

    /**
     * 转换流式响应块（其他协议 -> Ollama）
     *
     * @param {Object} chunk - 流式响应块
     * @param {string} sourceProtocol - 源协议
     * @param {string} model - 模型名称
     * @param {boolean} [isDone=false] - 是否结束
     * @returns {Object} 转换后的流式响应块
     */
    convertStreamChunk(chunk, sourceProtocol, model, isDone = false) {
        return this.toOllamaStreamChunk(chunk, model, isDone);
    }

    /**
     * 转换模型列表（其他协议 -> Ollama）
     *
     * @param {Object} data - 模型列表数据
     * @param {string} sourceProtocol - 源协议
     * @returns {Object} 转换后的模型列表
     */
    convertModelList(data, sourceProtocol) {
        return this.toOllamaTags(data, sourceProtocol);
    }

    // =========================================================================
    // Ollama -> OpenAI 转换
    // =========================================================================

    /**
     * Ollama 请求 -> OpenAI 请求
     *
     * @param {Object} ollamaRequest - Ollama 请求
     * @returns {Object} OpenAI 请求
     */
    toOpenAIRequest(ollamaRequest) {
        const openaiRequest = {
            model: ollamaRequest.model || 'default',
            messages: [],
            stream: ollamaRequest.stream !== undefined ? ollamaRequest.stream : false
        };

        // 将 Ollama messages 映射为 OpenAI 格式
        if (ollamaRequest.messages && Array.isArray(ollamaRequest.messages)) {
            openaiRequest.messages = ollamaRequest.messages.map(msg => ({
                role: msg.role || 'user',
                content: msg.content || ''
            }));
        }

        // 将 Ollama options 映射为 OpenAI 参数
        if (ollamaRequest.options) {
            const opts = ollamaRequest.options;
            if (opts.temperature !== undefined) openaiRequest.temperature = opts.temperature;
            if (opts.top_p !== undefined) openaiRequest.top_p = opts.top_p;
            if (opts.top_k !== undefined) openaiRequest.top_k = opts.top_k;
            if (opts.num_predict !== undefined) openaiRequest.max_tokens = opts.num_predict;
            if (opts.stop !== undefined) openaiRequest.stop = opts.stop;
        }

        // 处理 system prompt
        if (ollamaRequest.system) {
            openaiRequest.messages.unshift({
                role: 'system',
                content: ollamaRequest.system
            });
        }

        // 处理 generate 接口的 template/prompt
        if (ollamaRequest.prompt) {
            openaiRequest.messages = [{
                role: 'user',
                content: ollamaRequest.prompt
            }];
            
            // 如果有 system prompt，则插入系统消息
            if (ollamaRequest.system) {
                openaiRequest.messages.unshift({
                    role: 'system',
                    content: ollamaRequest.system
                });
            }
        }

        return openaiRequest;
    }

    // =========================================================================
    // OpenAI/Claude/Gemini -> Ollama 转换
    // =========================================================================

    /**
     * OpenAI/Claude/Gemini 响应 -> Ollama chat 响应
     *
     * @param {Object} response - 源响应
     * @param {string} model - 模型名称
     * @returns {Object} Ollama chat 响应
     */
    toOllamaChatResponse(response, model) {
        const ollamaResponse = {
            model: model || response.model || 'unknown',
            created_at: new Date().toISOString(),
            done: true
        };

        // 处理 OpenAI 格式（choices 数组）
        if (response.choices && response.choices.length > 0) {
            const choice = response.choices[0];
            ollamaResponse.message = {
                role: choice.message?.role || 'assistant',
                content: choice.message?.content || ''
            };

            // 映射结束原因
            if (choice.finish_reason) {
                ollamaResponse.done_reason = choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason;
            }
        }
        // 处理 Claude 格式（content 数组）
        else if (response.content && Array.isArray(response.content)) {
            let textContent = '';
            response.content.forEach(block => {
                if (block.type === 'text' && block.text) {
                    textContent += block.text;
                }
            });
            
            ollamaResponse.message = {
                role: response.role || 'assistant',
                content: textContent
            };

            if (response.stop_reason) {
                ollamaResponse.done_reason = response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason;
            }
        }
        // 处理 Gemini 格式（candidates 数组）
        else if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            let textContent = '';
            if (candidate.content && candidate.content.parts) {
                textContent = candidate.content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join('');
            }
            
            ollamaResponse.message = {
                role: candidate.content?.role || 'assistant',
                content: textContent
            };

            if (candidate.finishReason) {
                ollamaResponse.done_reason = candidate.finishReason.toLowerCase();
            }
        }

        // 如果有 usage，则补充统计信息
        const usage = response.usage || response.usageMetadata;
        if (usage) {
            ollamaResponse.prompt_eval_count = usage.prompt_tokens || usage.input_tokens || usage.promptTokenCount || 0;
            ollamaResponse.eval_count = usage.completion_tokens || usage.output_tokens || usage.candidatesTokenCount || 0;
            ollamaResponse.total_duration = 0;
            ollamaResponse.load_duration = 0;
            ollamaResponse.prompt_eval_duration = 0;
            ollamaResponse.eval_duration = 0;
        }

        return ollamaResponse;
    }

    /**
     * OpenAI/Claude/Gemini generate 响应 -> Ollama generate 响应
     *
     * @param {Object} response - 源响应
     * @param {string} model - 模型名称
     * @returns {Object} Ollama generate 响应
     */
    toOllamaGenerateResponse(response, model) {
        const ollamaResponse = {
            model: model || response.model || 'unknown',
            created_at: new Date().toISOString(),
            done: true
        };

        // 处理 OpenAI 格式
        if (response.choices && response.choices.length > 0) {
            const choice = response.choices[0];
            ollamaResponse.response = choice.message?.content || choice.text || '';
            
            if (choice.finish_reason) {
                ollamaResponse.done_reason = choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason;
            }
        }
        // 处理 Claude 格式
        else if (response.content && Array.isArray(response.content)) {
            let textContent = '';
            response.content.forEach(block => {
                if (block.type === 'text' && block.text) {
                    textContent += block.text;
                }
            });
            ollamaResponse.response = textContent;

            if (response.stop_reason) {
                ollamaResponse.done_reason = response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason;
            }
        }
        // 处理 Gemini 格式
        else if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            let textContent = '';
            if (candidate.content && candidate.content.parts) {
                textContent = candidate.content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join('');
            }
            ollamaResponse.response = textContent;

            if (candidate.finishReason) {
                ollamaResponse.done_reason = candidate.finishReason.toLowerCase();
            }
        }

        // 补充 usage 统计信息
        const genUsage = response.usage || response.usageMetadata;
        if (genUsage) {
            ollamaResponse.prompt_eval_count = genUsage.prompt_tokens || genUsage.input_tokens || genUsage.promptTokenCount || 0;
            ollamaResponse.eval_count = genUsage.completion_tokens || genUsage.output_tokens || genUsage.candidatesTokenCount || 0;
            ollamaResponse.total_duration = 0;
            ollamaResponse.load_duration = 0;
            ollamaResponse.prompt_eval_duration = 0;
            ollamaResponse.eval_duration = 0;
        }

        return ollamaResponse;
    }

    /**
     * OpenAI/Claude/Gemini 流式块 -> Ollama 流式块
     *
     * @param {Object} chunk - 流式块
     * @param {string} model - 模型名称
     * @param {boolean} [isDone=false] - 是否结束
     * @returns {Object} Ollama 流式块
     */
    toOllamaStreamChunk(chunk, model, isDone = false) {
        const ollamaChunk = {
            model: model || 'unknown',
            created_at: new Date().toISOString(),
            done: isDone
        };

        // 处理 Claude SSE 格式
        if (chunk.type) {
            if (chunk.type === 'content_block_delta' && chunk.delta) {
                ollamaChunk.message = {
                    role: 'assistant',
                    content: chunk.delta.text || ''
                };
            } else if (chunk.type === 'message_delta' && chunk.usage) {
                ollamaChunk.message = {
                    role: 'assistant',
                    content: ''
                };
                ollamaChunk.prompt_eval_count = 0;
                ollamaChunk.eval_count = chunk.usage.output_tokens || 0;
            } else {
                ollamaChunk.message = {
                    role: 'assistant',
                    content: ''
                };
            }
        }
        // 处理 Gemini 格式
        else if (!isDone && chunk.candidates && chunk.candidates.length > 0) {
            const candidate = chunk.candidates[0];
            let content = '';
            if (candidate.content && candidate.content.parts) {
                content = candidate.content.parts
                    .filter(part => part.text)
                    .map(part => part.text)
                    .join('');
            }
            ollamaChunk.message = {
                role: 'assistant',
                content: content
            };
        }
        // 处理 OpenAI 格式
        else if (!isDone && chunk.choices && chunk.choices.length > 0) {
            const delta = chunk.choices[0].delta;
            ollamaChunk.message = {
                role: delta.role || 'assistant',
                content: delta.content || ''
            };
        } 
        // 处理结束块
        else if (isDone) {
            ollamaChunk.message = {
                role: 'assistant',
                content: ''
            };
            ollamaChunk.done_reason = 'stop';
        }

        return ollamaChunk;
    }

    /**
     * OpenAI/Claude/Gemini 流式块 -> Ollama generate 流式块
     *
     * @param {Object} chunk - 流式块
     * @param {string} model - 模型名称
     * @param {boolean} [isDone=false] - 是否结束
     * @returns {Object} Ollama generate 流式块
     */
    toOllamaGenerateStreamChunk(chunk, model, isDone = false) {
        const ollamaChunk = {
            model: model || 'unknown',
            created_at: new Date().toISOString(),
            done: isDone
        };

        // 处理 Claude SSE 格式
        if (chunk.type) {
            if (chunk.type === 'content_block_delta' && chunk.delta) {
                ollamaChunk.response = chunk.delta.text || '';
            } else if (chunk.type === 'message_delta' && chunk.usage) {
                ollamaChunk.response = '';
                ollamaChunk.prompt_eval_count = 0;
                ollamaChunk.eval_count = chunk.usage.output_tokens || 0;
            } else {
                ollamaChunk.response = '';
            }
        }
        // 处理 OpenAI 格式
        else if (!isDone && chunk.choices && chunk.choices.length > 0) {
            const delta = chunk.choices[0].delta;
            ollamaChunk.response = delta.content || '';
        }
        // 处理结束块
        else if (isDone) {
            ollamaChunk.response = '';
            ollamaChunk.done_reason = 'stop';
        }

        return ollamaChunk;
    }

    /**
     * OpenAI/Claude/Gemini 模型列表 -> Ollama tags
     *
     * @param {Object} modelList - 模型列表
     * @param {string|null} [sourceProtocol=null] - 源协议
     * @returns {Object} Ollama tags 响应
     */
    toOllamaTags(modelList, sourceProtocol = null) {
        const models = [];

        // 同时兼容 OpenAI 格式（data 数组）与 Gemini 格式（models 数组）
        const sourceModels = modelList.data || modelList.models || [];
        
        if (Array.isArray(sourceModels)) {
            sourceModels.forEach(model => {
                // 获取模型名称
                let modelName = model.id || model.name || model.displayName || 'unknown';
                
                // 移除 "models/" 前缀（适配 Gemini）
                if (modelName.startsWith('models/')) {
                    modelName = modelName.substring(7); // 移除 "models/" 前缀
                }
                
                // 跳过无效名称
                if (modelName === 'unknown' || !modelName) {
                    return;
                }
                
                // 重要：Copilot 期望 family 为 "Ollama"（首字母大写）
                const modelOwner = 'Ollama';
                
                models.push({
                    name: modelName,
                    model: modelName,
                    modified_at: new Date().toISOString(),
                    size: 0,  // 保持与旧补丁一致
                    digest: '',  // 保持与旧补丁一致
                    details: {
                        parent_model: '',
                        format: 'gguf',
                        family: modelOwner,  // "Ollama" with capital O
                        families: [modelOwner],
                        parameter_size: '0B',  // 保持与旧补丁一致
                        quantization_level: OLLAMA_DEFAULT_QUANTIZATION_LEVEL
                    }
                });
            });
        }

        return { models };
    }

    /**
     * 生成 Ollama show 响应
     *
     * @param {string} modelName - 模型名称
     * @returns {Object} show 响应
     */
    toOllamaShowResponse(modelName) {
        // 最小实现，保持与旧补丁一致
        let contextLength = OLLAMA_DEFAULT_CONTEXT_LENGTH;
        let maxOutputTokens = OLLAMA_DEFAULT_MAX_OUTPUT_TOKENS;
        let family = 'Ollama';  // 重要：首字母大写，符合 Copilot 预期
        let architecture = 'transformer';
        
        const lowerName = modelName.toLowerCase();
        
        // 根据模型名称确定上下文长度
        // Claude 模型
        if (lowerName.includes('claude')) {
            architecture = 'claude';
            contextLength = OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH; // 默认 200K
            
            // Claude Sonnet 4.5
            if (lowerName.includes('sonnet-4-5') || lowerName.includes('sonnet-4.5')) {
                contextLength = OLLAMA_CLAUDE_SONNET_45_CONTEXT_LENGTH; // 200K (1M beta available)
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_45_MAX_OUTPUT_TOKENS; // 64K output
            }
            // Claude Haiku 4.5
            else if (lowerName.includes('haiku-4-5') || lowerName.includes('haiku-4.5')) {
                contextLength = OLLAMA_CLAUDE_HAIKU_45_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_45_MAX_OUTPUT_TOKENS; // 64K output
            }
            // Claude Opus 4.1
            else if (lowerName.includes('opus-4-1') || lowerName.includes('opus-4.1')) {
                contextLength = OLLAMA_CLAUDE_OPUS_41_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_OPUS_41_MAX_OUTPUT_TOKENS; // 32K output
            }
            // Claude Sonnet 4.0（旧版）
            else if (lowerName.includes('sonnet-4-0') || lowerName.includes('sonnet-4.0') || lowerName.includes('sonnet-4-20')) {
                contextLength = OLLAMA_CLAUDE_SONNET_40_CONTEXT_LENGTH; // 200K (1M beta available)
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_40_MAX_OUTPUT_TOKENS; // 64K output
            }
            // Claude Sonnet 3.7（旧版）
            else if (lowerName.includes('3-7') || lowerName.includes('3.7')) {
                contextLength = OLLAMA_CLAUDE_SONNET_37_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_37_MAX_OUTPUT_TOKENS; // 64K output (128K beta available)
            }
            // Claude Opus 4.0（旧版）
            else if (lowerName.includes('opus-4-0') || lowerName.includes('opus-4.0') || lowerName.includes('opus-4-20')) {
                contextLength = OLLAMA_CLAUDE_OPUS_40_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_OPUS_40_MAX_OUTPUT_TOKENS; // 32K output
            }
            // Claude Haiku 3.5（旧版）
            else if (lowerName.includes('haiku-3-5') || lowerName.includes('haiku-3.5')) {
                contextLength = OLLAMA_CLAUDE_HAIKU_35_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS; // 8K output
            }
            // Claude Haiku 3.0（旧版）
            else if (lowerName.includes('haiku-3-0') || lowerName.includes('haiku-3.0') || lowerName.includes('haiku-20240307')) {
                contextLength = OLLAMA_CLAUDE_HAIKU_30_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_30_MAX_OUTPUT_TOKENS; // 4K output
            }
            // Claude Sonnet 3.5（旧版）
            else if (lowerName.includes('sonnet-3-5') || lowerName.includes('sonnet-3.5')) {
                contextLength = OLLAMA_CLAUDE_SONNET_35_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_SONNET_35_MAX_OUTPUT_TOKENS; // 8K output
            }
            // Claude Opus 3.0（旧版）
            else if (lowerName.includes('opus-3-0') || lowerName.includes('opus-3.0') || lowerName.includes('opus') && lowerName.includes('20240229')) {
                contextLength = OLLAMA_CLAUDE_OPUS_30_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_OPUS_30_MAX_OUTPUT_TOKENS; // 4K output
            }
            // Claude 默认配置
            else {
                contextLength = OLLAMA_CLAUDE_DEFAULT_CONTEXT_LENGTH; // 200K
                maxOutputTokens = OLLAMA_CLAUDE_HAIKU_35_MAX_OUTPUT_TOKENS; // 8K output
            }
        }
        // Gemini 模型
        else if (lowerName.includes('gemini')) {
            architecture = 'gemini';
            
            // Gemini 2.5 Pro
            if (lowerName.includes('2.5') && lowerName.includes('pro')) {
                contextLength = OLLAMA_GEMINI_25_PRO_CONTEXT_LENGTH; // 1M input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_PRO_MAX_OUTPUT_TOKENS; // 65K output tokens
            }
            // Gemini 2.5 Flash / Flash-Lite
            else if (lowerName.includes('2.5') && (lowerName.includes('flash') || lowerName.includes('lite'))) {
                contextLength = OLLAMA_GEMINI_25_FLASH_CONTEXT_LENGTH; // 1M input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_FLASH_MAX_OUTPUT_TOKENS; // 65K output tokens
            }
            // Gemini 2.5 Flash Image
            else if (lowerName.includes('2.5') && lowerName.includes('image')) {
                contextLength = OLLAMA_GEMINI_25_IMAGE_CONTEXT_LENGTH; // 65K input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_IMAGE_MAX_OUTPUT_TOKENS; // 32K output tokens
            }
            // Gemini 2.5 Flash Live / Native Audio
            else if (lowerName.includes('2.5') && (lowerName.includes('live') || lowerName.includes('native-audio'))) {
                contextLength = OLLAMA_GEMINI_25_LIVE_CONTEXT_LENGTH; // 131K input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_LIVE_MAX_OUTPUT_TOKENS; // 8K output tokens
            }
            // Gemini 2.5 TTS
            else if (lowerName.includes('2.5') && lowerName.includes('tts')) {
                contextLength = OLLAMA_GEMINI_25_TTS_CONTEXT_LENGTH; // 8K input tokens
                maxOutputTokens = OLLAMA_GEMINI_25_TTS_MAX_OUTPUT_TOKENS; // 16K output tokens
            }
            // Gemini 2.0 Flash
            else if (lowerName.includes('2.0') && lowerName.includes('flash')) {
                contextLength = OLLAMA_GEMINI_20_FLASH_CONTEXT_LENGTH; // 1M input tokens
                maxOutputTokens = OLLAMA_GEMINI_20_FLASH_MAX_OUTPUT_TOKENS; // 8K output tokens
            }
            // Gemini 2.0 Flash Image
            else if (lowerName.includes('2.0') && lowerName.includes('image')) {
                contextLength = OLLAMA_GEMINI_20_IMAGE_CONTEXT_LENGTH; // 32K input tokens
                maxOutputTokens = OLLAMA_GEMINI_20_IMAGE_MAX_OUTPUT_TOKENS; // 8K output tokens
            }
            // Gemini 1.5 Pro（旧版）
            else if (lowerName.includes('1.5') && lowerName.includes('pro')) {
                contextLength = OLLAMA_GEMINI_15_PRO_CONTEXT_LENGTH; // 2M tokens
                maxOutputTokens = OLLAMA_GEMINI_15_PRO_MAX_OUTPUT_TOKENS;
            }
            // Gemini 1.5 Flash（旧版）
            else if (lowerName.includes('1.5') && lowerName.includes('flash')) {
                contextLength = OLLAMA_GEMINI_15_FLASH_CONTEXT_LENGTH; // 1M tokens
                maxOutputTokens = OLLAMA_GEMINI_15_FLASH_MAX_OUTPUT_TOKENS;
            }
            // Gemini 默认配置
            else {
                contextLength = OLLAMA_GEMINI_DEFAULT_CONTEXT_LENGTH; // 1M tokens
                maxOutputTokens = OLLAMA_GEMINI_DEFAULT_MAX_OUTPUT_TOKENS;
            }
        }
        // GPT-4 模型
        else if (lowerName.includes('gpt-4')) {
            architecture = 'gpt';
            
            if (lowerName.includes('turbo') || lowerName.includes('preview')) {
                contextLength = OLLAMA_GPT4_TURBO_CONTEXT_LENGTH; // GPT-4 Turbo
                maxOutputTokens = OLLAMA_GPT4_TURBO_MAX_OUTPUT_TOKENS;
            } else if (lowerName.includes('32k')) {
                contextLength = OLLAMA_GPT4_32K_CONTEXT_LENGTH;
                maxOutputTokens = OLLAMA_GPT4_32K_MAX_OUTPUT_TOKENS;
            } else {
                contextLength = OLLAMA_GPT4_BASE_CONTEXT_LENGTH; // GPT-4 基础版
                maxOutputTokens = OLLAMA_GPT4_BASE_MAX_OUTPUT_TOKENS;
            }
        }
        // GPT-3.5 模型
        else if (lowerName.includes('gpt-3.5')) {
            architecture = 'gpt';
            
            if (lowerName.includes('16k')) {
                contextLength = OLLAMA_GPT35_16K_CONTEXT_LENGTH;
                maxOutputTokens = OLLAMA_GPT35_16K_MAX_OUTPUT_TOKENS;
            } else {
                contextLength = OLLAMA_GPT35_BASE_CONTEXT_LENGTH;
                maxOutputTokens = OLLAMA_GPT35_BASE_MAX_OUTPUT_TOKENS;
            }
        }
        // Qwen 模型
        else if (lowerName.includes('qwen')) {
            architecture = 'qwen';
            
            // Qwen3 Coder Plus（coder-model）
            if (lowerName.includes('coder-plus') || lowerName.includes('coder_plus') || lowerName.includes('coder-model')) {
                contextLength = OLLAMA_QWEN_CODER_PLUS_CONTEXT_LENGTH; // 128K tokens
                maxOutputTokens = OLLAMA_QWEN_CODER_PLUS_MAX_OUTPUT_TOKENS; // 65K output
            }
            // Qwen3 VL Plus（vision-model）
            else if (lowerName.includes('vl-plus') || lowerName.includes('vl_plus') || lowerName.includes('vision-model')) {
                contextLength = OLLAMA_QWEN_VL_PLUS_CONTEXT_LENGTH; // 256K tokens
                maxOutputTokens = OLLAMA_QWEN_VL_PLUS_MAX_OUTPUT_TOKENS; // 32K output
            }
            // Qwen3 Coder Flash
            else if (lowerName.includes('coder-flash') || lowerName.includes('coder_flash')) {
                contextLength = OLLAMA_QWEN_CODER_FLASH_CONTEXT_LENGTH; // 128K tokens
                maxOutputTokens = OLLAMA_QWEN_CODER_FLASH_MAX_OUTPUT_TOKENS; // 65K output
            }
            // Qwen 默认配置
            else {
                contextLength = OLLAMA_QWEN_DEFAULT_CONTEXT_LENGTH; // 32K tokens
                maxOutputTokens = OLLAMA_QWEN_DEFAULT_MAX_OUTPUT_TOKENS;
            }
        }
        
        // 最小化 parameter_size，保持旧补丁一致
        let parameterSize = '0B';
        
        return {
            license: '',
            modelfile: `# Modelfile for ${modelName}\nFROM ${modelName}`,
            parameters: `num_ctx ${contextLength}\nnum_predict ${maxOutputTokens}\ntemperature ${OLLAMA_DEFAULT_TEMPERATURE}\ntop_p ${OLLAMA_DEFAULT_TOP_P}`,
            template: '{{ if .System }}{{ .System }}\n{{ end }}{{ .Prompt }}',
            details: {
                parent_model: '',
                format: 'gguf',
                family: family,
                families: [family],
                parameter_size: parameterSize,
                quantization_level: OLLAMA_SHOW_QUANTIZATION_LEVEL
            },
            model_info: {
                'general.architecture': architecture,
                'general.file_type': OLLAMA_DEFAULT_FILE_TYPE,
                'general.parameter_count': 0,
                'general.quantization_version': OLLAMA_DEFAULT_QUANTIZATION_VERSION,
                'general.context_length': contextLength,
                'llama.context_length': contextLength,
                'llama.rope.freq_base': OLLAMA_DEFAULT_ROPE_FREQ_BASE
            },
            capabilities: ['tools', 'vision', 'completion']  // 标记模型支持工具调用
        };
    }
}
