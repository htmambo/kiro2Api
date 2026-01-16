/**
 * Gemini 转换器
 *
 * 处理 Gemini（Google）协议与其他协议之间的转换。
 *
 * @module converters/strategies/GeminiConverter
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseConverter } from '../BaseConverter.js';
import {
    checkAndAssignOrDefault,
    OPENAI_DEFAULT_MAX_TOKENS,
    OPENAI_DEFAULT_TEMPERATURE,
    OPENAI_DEFAULT_TOP_P,
    CLAUDE_DEFAULT_MAX_TOKENS,
    CLAUDE_DEFAULT_TEMPERATURE,
    CLAUDE_DEFAULT_TOP_P
} from '../utils.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/protocol.js';
import {
    generateResponseCreated,
    generateResponseInProgress,
    generateOutputItemAdded,
    generateContentPartAdded,
    generateOutputTextDone,
    generateContentPartDone,
    generateOutputItemDone,
    generateResponseCompleted
} from '../../openai/openai-responses-core.mjs';
import { createLogger } from '../../lib/logger.js';
const logger = createLogger('GeminiConverter');

/**
 * Gemini 转换器类
 *
 * 实现 Gemini 协议到其他协议的转换。
 */
export class GeminiConverter extends BaseConverter {
    /**
     * 创建 Gemini 转换器
     */
    constructor() {
        super('gemini');
    }

    /**
     * 转换请求
     *
     * @param {Object} data - 请求数据
     * @param {string} targetProtocol - 目标协议
     * @returns {Object} 转换后的请求
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIRequest(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeRequest(data);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesRequest(data);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换响应
     *
     * @param {Object} data - 响应数据
     * @param {string} targetProtocol - 目标协议
     * @param {string} model - 模型名称
     * @returns {Object} 转换后的响应
     */
    convertResponse(data, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesResponse(data, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换流式响应块
     *
     * @param {Object} chunk - 流式响应块
     * @param {string} targetProtocol - 目标协议
     * @param {string} model - 模型名称
     * @returns {Object} 转换后的流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeStreamChunk(chunk, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesStreamChunk(chunk, model);
            default:
                throw new Error(`Unsupported target protocol: ${targetProtocol}`);
        }
    }

    /**
     * 转换模型列表
     *
     * @param {Object} data - 模型列表数据
     * @param {string} targetProtocol - 目标协议
     * @returns {Object} 转换后的模型列表
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIModelList(data);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeModelList(data);
            default:
                return data;
        }
    }

    // =========================================================================
    // Gemini -> OpenAI 转换
    // =========================================================================

    /**
     * Gemini 请求 -> OpenAI 请求
     *
     * @param {Object} geminiRequest - Gemini 请求
     * @returns {Object} OpenAI 请求
     */
    toOpenAIRequest(geminiRequest) {
        const openaiRequest = {
            messages: [],
            model: geminiRequest.model,
            max_tokens: checkAndAssignOrDefault(geminiRequest.max_tokens, OPENAI_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(geminiRequest.temperature, OPENAI_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(geminiRequest.top_p, OPENAI_DEFAULT_TOP_P),
        };

        // 处理系统指令
        if (geminiRequest.systemInstruction && Array.isArray(geminiRequest.systemInstruction.parts)) {
            const systemContent = this.processGeminiPartsToOpenAIContent(geminiRequest.systemInstruction.parts);
            if (systemContent) {
                openaiRequest.messages.push({
                    role: 'system',
                    content: systemContent
                });
            }
        }

        // 处理内容
        if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
            geminiRequest.contents.forEach(content => {
                if (content && Array.isArray(content.parts)) {
                    const openaiContent = this.processGeminiPartsToOpenAIContent(content.parts);
                    if (openaiContent && openaiContent.length > 0) {
                        const openaiRole = content.role === 'model' ? 'assistant' : content.role;
                        openaiRequest.messages.push({
                            role: openaiRole,
                            content: openaiContent
                        });
                    }
                }
            });
        }

        return openaiRequest;
    }

    /**
     * Gemini 响应 -> OpenAI 响应
     *
     * @param {Object} geminiResponse - Gemini 响应
     * @param {string} model - 模型名称
     * @returns {Object} OpenAI 响应
     */
    toOpenAIResponse(geminiResponse, model) {
        const content = this.processGeminiResponseContent(geminiResponse);
        
        return {
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: content
                },
                finish_reason: "stop",
            }],
            usage: geminiResponse.usageMetadata ? {
                prompt_tokens: geminiResponse.usageMetadata.promptTokenCount || 0,
                completion_tokens: geminiResponse.usageMetadata.candidatesTokenCount || 0,
                total_tokens: geminiResponse.usageMetadata.totalTokenCount || 0,
                cached_tokens: geminiResponse.usageMetadata.cachedContentTokenCount || 0,
                prompt_tokens_details: {
                    cached_tokens: geminiResponse.usageMetadata.cachedContentTokenCount || 0
                },
                completion_tokens_details: {
                    reasoning_tokens: geminiResponse.usageMetadata.thoughtsTokenCount || 0
                }
            } : {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                cached_tokens: 0,
                prompt_tokens_details: {
                    cached_tokens: 0
                },
                completion_tokens_details: {
                    reasoning_tokens: 0
                }
            },
        };
    }

    /**
     * Gemini 流式响应 -> OpenAI 流式响应
     *
     * @param {Object} geminiChunk - Gemini 流式块
     * @param {string} model - 模型名称
     * @returns {Object|null} OpenAI 流式块
     */
    toOpenAIStreamChunk(geminiChunk, model) {
        if (!geminiChunk) return null;

        const candidate = geminiChunk.candidates?.[0];
        if (!candidate) return null;

        let content = '';
        const toolCalls = [];
        
        // 从parts中提取文本和tool calls
        const parts = candidate.content?.parts;
        if (parts && Array.isArray(parts)) {
            for (const part of parts) {
                if (part.text) {
                    content += part.text;
                }
                if (part.functionCall) {
                    toolCalls.push({
                        index: toolCalls.length,
                        id: part.functionCall.id || `call_${uuidv4()}`,
                        type: 'function',
                        function: {
                            name: part.functionCall.name,
                            arguments: typeof part.functionCall.args === 'string' 
                                ? part.functionCall.args 
                                : JSON.stringify(part.functionCall.args)
                        }
                    });
                }
                // thoughtSignature 被忽略（Gemini 内部数据）
            }
        }

        // 处理finishReason
        let finishReason = null;
        if (candidate.finishReason) {
            finishReason = candidate.finishReason === 'STOP' ? 'stop' :
                         candidate.finishReason === 'MAX_TOKENS' ? 'length' :
                         candidate.finishReason.toLowerCase();
        }

        // 如果包含工具调用，且完成原因为 stop，则将完成原因修改为 tool_calls
        if (toolCalls.length > 0 && finishReason === 'stop') {
            finishReason = 'tool_calls';
        }

        // 构建delta对象
        const delta = {};
        if (content) delta.content = content;
        if (toolCalls.length > 0) delta.tool_calls = toolCalls;

        // 不返回空的 delta 块
        if (Object.keys(delta).length === 0 && !finishReason) {
            return null;
        }

        return {
            id: `chatcmpl-${uuidv4()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
                index: 0,
                delta: delta,
                finish_reason: finishReason,
            }],
            usage: geminiChunk.usageMetadata ? {
                prompt_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                completion_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0,
                cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0,
                prompt_tokens_details: {
                    cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0
                },
                completion_tokens_details: {
                    reasoning_tokens: geminiChunk.usageMetadata.thoughtsTokenCount || 0
                }
            } : {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                cached_tokens: 0,
                prompt_tokens_details: {
                    cached_tokens: 0
                },
                completion_tokens_details: {
                    reasoning_tokens: 0
                }
            },
        };
    }

    /**
     * Gemini 模型列表 -> OpenAI 模型列表
     *
     * @param {Object} geminiModels - Gemini 模型列表
     * @returns {Object} OpenAI 模型列表
     */
    toOpenAIModelList(geminiModels) {
        return {
            object: "list",
            data: geminiModels.models.map(m => {
                const modelId = m.name.startsWith('models/') ? m.name.substring(7) : m.name;
                return {
                    id: modelId,
                    object: "model",
                    created: Math.floor(Date.now() / 1000),
                    owned_by: "google",
                    display_name: m.displayName || modelId,
                };
            }),
        };
    }

    /**
     * 处理 Gemini parts 到 OpenAI 内容
     *
     * @param {Array} parts - Gemini parts
     * @returns {Array|string} OpenAI 内容
     */
    processGeminiPartsToOpenAIContent(parts) {
        if (!parts || !Array.isArray(parts)) return '';
        
        const contentArray = [];
        
        parts.forEach(part => {
            if (!part) return;
            
            if (typeof part.text === 'string') {
                contentArray.push({
                    type: 'text',
                    text: part.text
                });
            }
            
            if (part.inlineData) {
                const { mimeType, data } = part.inlineData;
                if (mimeType && data) {
                    contentArray.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${data}`
                        }
                    });
                }
            }
            
            if (part.fileData) {
                const { mimeType, fileUri } = part.fileData;
                if (mimeType && fileUri) {
                    if (mimeType.startsWith('image/')) {
                        contentArray.push({
                            type: 'image_url',
                            image_url: {
                                url: fileUri
                            }
                        });
                    } else if (mimeType.startsWith('audio/')) {
                        contentArray.push({
                            type: 'text',
                            text: `[Audio file: ${fileUri}]`
                        });
                    }
                }
            }
        });
        
        return contentArray.length === 1 && contentArray[0].type === 'text'
            ? contentArray[0].text
            : contentArray;
    }

    /**
     * 处理 Gemini 响应内容
     *
     * @param {Object} geminiResponse - Gemini 响应
     * @returns {string} 文本内容
     */
    processGeminiResponseContent(geminiResponse) {
        if (!geminiResponse || !geminiResponse.candidates) return '';
        
        const contents = [];
        
        geminiResponse.candidates.forEach(candidate => {
            if (candidate.content && candidate.content.parts) {
                candidate.content.parts.forEach(part => {
                    if (part.text) {
                        contents.push(part.text);
                    }
                });
            }
        });
        
        return contents.join('\n');
    }

    // =========================================================================
    // Gemini -> Claude 转换
    // =========================================================================

    /**
     * Gemini 请求 -> Claude 请求
     *
     * @param {Object} geminiRequest - Gemini 请求
     * @returns {Object} Claude 请求
     */
    toClaudeRequest(geminiRequest) {
        const claudeRequest = {
            model: geminiRequest.model || 'claude-3-opus',
            messages: [],
            max_tokens: checkAndAssignOrDefault(geminiRequest.generationConfig?.maxOutputTokens, CLAUDE_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(geminiRequest.generationConfig?.temperature, CLAUDE_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(geminiRequest.generationConfig?.topP, CLAUDE_DEFAULT_TOP_P),
        };

        // 处理系统指令
        if (geminiRequest.systemInstruction && geminiRequest.systemInstruction.parts) {
            const systemText = geminiRequest.systemInstruction.parts
                .filter(p => p.text)
                .map(p => p.text)
                .join('\n');
            if (systemText) {
                claudeRequest.system = systemText;
            }
        }

        // 处理内容
        if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
            geminiRequest.contents.forEach(content => {
                if (!content || !content.parts) return;

                const role = content.role === 'model' ? 'assistant' : 'user';
                const claudeContent = this.processGeminiPartsToClaudeContent(content.parts);

                if (claudeContent.length > 0) {
                    claudeRequest.messages.push({
                        role: role,
                        content: claudeContent
                    });
                }
            });
        }

        // 处理工具
        if (geminiRequest.tools && geminiRequest.tools[0]?.functionDeclarations) {
            claudeRequest.tools = geminiRequest.tools[0].functionDeclarations.map(func => ({
                name: func.name,
                description: func.description || '',
                input_schema: func.parameters || { type: 'object', properties: {} }
            }));
        }

        return claudeRequest;
    }

    /**
     * Gemini 响应 -> Claude 响应
     *
     * @param {Object} geminiResponse - Gemini 响应
     * @param {string} model - 模型名称
     * @returns {Object} Claude 响应
     */
    toClaudeResponse(geminiResponse, model) {
        if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) {
            return {
                id: `msg_${uuidv4()}`,
                type: "message",
                role: "assistant",
                content: [],
                model: model,
                stop_reason: "end_turn",
                stop_sequence: null,
                usage: {
                    input_tokens: geminiResponse?.usageMetadata?.promptTokenCount || 0,
                    output_tokens: geminiResponse?.usageMetadata?.candidatesTokenCount || 0
                }
            };
        }

        const candidate = geminiResponse.candidates[0];
        const content = this.processGeminiResponseToClaudeContent(geminiResponse);
        const finishReason = candidate.finishReason;
        let stopReason = "end_turn";

        if (finishReason) {
            switch (finishReason) {
                case 'STOP':
                    stopReason = 'end_turn';
                    break;
                case 'MAX_TOKENS':
                    stopReason = 'max_tokens';
                    break;
                case 'SAFETY':
                    stopReason = 'safety';
                    break;
                case 'RECITATION':
                    stopReason = 'recitation';
                    break;
                case 'OTHER':
                    stopReason = 'other';
                    break;
                default:
                    stopReason = 'end_turn';
            }
        }

        return {
            id: `msg_${uuidv4()}`,
            type: "message",
            role: "assistant",
            content: content,
            model: model,
            stop_reason: stopReason,
            stop_sequence: null,
            usage: {
                input_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: geminiResponse.usageMetadata?.cachedContentTokenCount || 0,
                output_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0
            }
        };
    }

    /**
     * Gemini 流式响应 -> Claude 流式响应
     *
     * @param {Object} geminiChunk - Gemini 流式块
     * @param {string} model - 模型名称
     * @returns {Object|null} Claude 流式块
     */
    toClaudeStreamChunk(geminiChunk, model) {
        if (!geminiChunk) return null;

        // 处理完整的Gemini chunk对象
        if (typeof geminiChunk === 'object' && !Array.isArray(geminiChunk)) {
            const candidate = geminiChunk.candidates?.[0];
            
            if (candidate) {
                const parts = candidate.content?.parts;
                
                // 提取文本内容
                if (parts && Array.isArray(parts)) {
                    const textParts = parts.filter(part => part && typeof part.text === 'string');
                    if (textParts.length > 0) {
                        const text = textParts.map(part => part.text).join('');
                        return {
                            type: "content_block_delta",
                            index: 0,
                            delta: {
                                type: "text_delta",
                                text: text
                            }
                        };
                    }
                }
                
                // 处理finishReason
                if (candidate.finishReason) {
                    const result = {
                        type: "message_delta",
                        delta: {
                            stop_reason: candidate.finishReason === 'STOP' ? 'end_turn' :
                                       candidate.finishReason === 'MAX_TOKENS' ? 'max_tokens' :
                                       candidate.finishReason.toLowerCase()
                        }
                    };
                    
                    // 添加 usage 信息
                    if (geminiChunk.usageMetadata) {
                        result.usage = {
                            input_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                            cache_creation_input_tokens: 0,
                            cache_read_input_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0,
                            output_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                            prompt_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                            completion_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                            total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0,
                            cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0
                        };
                    }
                    
                    return result;
                }
            }
        }

        // 向后兼容：处理字符串格式
        if (typeof geminiChunk === 'string') {
            return {
                type: "content_block_delta",
                index: 0,
                delta: {
                    type: "text_delta",
                    text: geminiChunk
                }
            };
        }

        return null;
    }

    /**
     * Gemini 模型列表 -> Claude 模型列表
     *
     * @param {Object} geminiModels - Gemini 模型列表
     * @returns {Object} Claude 模型列表
     */
    toClaudeModelList(geminiModels) {
        return {
            models: geminiModels.models.map(m => ({
                name: m.name.startsWith('models/') ? m.name.substring(7) : m.name,
                description: "",
            })),
        };
    }

    /**
     * 处理 Gemini parts 到 Claude 内容
     *
     * @param {Array} parts - Gemini parts
     * @returns {Array} Claude 内容
     */
    processGeminiPartsToClaudeContent(parts) {
        if (!parts || !Array.isArray(parts)) return [];

        const content = [];

        parts.forEach(part => {
            if (!part) return;

            if (part.text) {
                content.push({
                    type: 'text',
                    text: part.text
                });
            }

            if (part.inlineData) {
                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: part.inlineData.mimeType,
                        data: part.inlineData.data
                    }
                });
            }

            if (part.functionCall) {
                content.push({
                    type: 'tool_use',
                    id: uuidv4(),
                    name: part.functionCall.name,
                    input: part.functionCall.args || {}
                });
            }

            if (part.functionResponse) {
                content.push({
                    type: 'tool_result',
                    tool_use_id: part.functionResponse.name,
                    content: part.functionResponse.response
                });
            }
        });

        return content;
    }

    /**
     * 处理 Gemini 响应到 Claude 内容
     *
     * @param {Object} geminiResponse - Gemini 响应
     * @returns {Array} Claude 内容
     */
    processGeminiResponseToClaudeContent(geminiResponse) {
        if (!geminiResponse || !geminiResponse.candidates || geminiResponse.candidates.length === 0) return [];

        const content = [];

        for (const candidate of geminiResponse.candidates) {
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                if (candidate.finishMessage) {
                    content.push({
                        type: 'text',
                        text: `Error: ${candidate.finishMessage}`
                    });
                }
                continue;
            }

            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    if (part.text) {
                        content.push({
                            type: 'text',
                            text: part.text
                        });
                    } else if (part.inlineData) {
                        content.push({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: part.inlineData.mimeType,
                                data: part.inlineData.data
                            }
                        });
                    } else if (part.functionCall) {
                        content.push({
                            type: 'tool_use',
                            id: uuidv4(),
                            name: part.functionCall.name,
                            input: part.functionCall.args || {}
                        });
                    }
                }
            }
        }

        return content;
    }

    // =========================================================================
    // Gemini -> OpenAI Responses 转换
    // =========================================================================

    /**
     * Gemini 请求 -> OpenAI Responses 请求
     *
     * @param {Object} geminiRequest - Gemini 请求
     * @returns {Object} OpenAI Responses 请求
     */
    toOpenAIResponsesRequest(geminiRequest) {
        const responsesRequest = {
            model: geminiRequest.model,
            max_tokens: checkAndAssignOrDefault(geminiRequest.generationConfig?.maxOutputTokens, OPENAI_DEFAULT_MAX_TOKENS),
            temperature: checkAndAssignOrDefault(geminiRequest.generationConfig?.temperature, OPENAI_DEFAULT_TEMPERATURE),
            top_p: checkAndAssignOrDefault(geminiRequest.generationConfig?.topP, OPENAI_DEFAULT_TOP_P),
        };

        // 处理系统指令
        if (geminiRequest.systemInstruction && geminiRequest.systemInstruction.parts) {
            const instructionsText = geminiRequest.systemInstruction.parts
                .filter(p => p.text)
                .map(p => p.text)
                .join('\n');
            if (instructionsText) {
                responsesRequest.instructions = instructionsText;
            }
        }

        // 处理输入
        if (geminiRequest.contents && Array.isArray(geminiRequest.contents)) {
            const lastContent = geminiRequest.contents[geminiRequest.contents.length - 1];
            if (lastContent && lastContent.parts) {
                const inputText = lastContent.parts
                    .filter(p => p.text)
                    .map(p => p.text)
                    .join(' ');
                if (inputText) {
                    responsesRequest.input = inputText;
                }
            }
        }

        return responsesRequest;
    }

    /**
     * Gemini 响应 -> OpenAI Responses 响应
     *
     * @param {Object} geminiResponse - Gemini 响应
     * @param {string} model - 模型名称
     * @returns {Object} OpenAI Responses 响应
     */
    toOpenAIResponsesResponse(geminiResponse, model) {
        const content = this.processGeminiResponseContent(geminiResponse);
        const textContent = typeof content === 'string' ? content : JSON.stringify(content);

        let output = [];
        output.push({
            id: `msg_${uuidv4().replace(/-/g, '')}`,
            summary: [],
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{
                annotations: [],
                logprobs: [],
                text: textContent,
                type: "output_text"
            }]
        });

        return {
            background: false,
            created_at: Math.floor(Date.now() / 1000),
            error: null,
            id: `resp_${uuidv4().replace(/-/g, '')}`,
            incomplete_details: null,
            max_output_tokens: null,
            max_tool_calls: null,
            metadata: {},
            model: model,
            object: "response",
            output: output,
            parallel_tool_calls: true,
            previous_response_id: null,
            prompt_cache_key: null,
            reasoning: {},
            safety_identifier: "user-" + uuidv4().replace(/-/g, ''),
            service_tier: "default",
            status: "completed",
            store: false,
            temperature: 1,
            text: {
                format: { type: "text" },
            },
            tool_choice: "auto",
            tools: [],
            top_logprobs: 0,
            top_p: 1,
            truncation: "disabled",
            usage: {
                input_tokens: geminiResponse.usageMetadata?.promptTokenCount || 0,
                input_tokens_details: {
                    cached_tokens: geminiResponse.usageMetadata?.cachedContentTokenCount || 0
                },
                output_tokens: geminiResponse.usageMetadata?.candidatesTokenCount || 0,
                output_tokens_details: {
                    reasoning_tokens: geminiResponse.usageMetadata?.thoughtsTokenCount || 0
                },
                total_tokens: geminiResponse.usageMetadata?.totalTokenCount || 0
            },
            user: null
        };
    }

    /**
     * Gemini 流式响应 -> OpenAI Responses 流式响应
     *
     * @param {Object} geminiChunk - Gemini 流式块
     * @param {string} model - 模型名称
     * @param {string|null} [requestId=null] - 请求 ID
     * @returns {Object|null} OpenAI Responses 流式块
     */
    toOpenAIResponsesStreamChunk(geminiChunk, model, requestId = null) {
        if (!geminiChunk) return [];

        const responseId = requestId || `resp_${uuidv4().replace(/-/g, '')}`;
        const events = [];

        // 处理完整的Gemini chunk对象
        if (typeof geminiChunk === 'object' && !Array.isArray(geminiChunk)) {
            const candidate = geminiChunk.candidates?.[0];
            
            if (candidate) {
                const parts = candidate.content?.parts;
                
                // 第一个chunk - 检测是否是开始（有role）
                if (candidate.content?.role === 'model' && parts && parts.length > 0) {
                    // 只在第一次有内容时发送开始事件
                    const hasContent = parts.some(part => part && typeof part.text === 'string' && part.text.length > 0);
                    if (hasContent) {
                        events.push(
                            generateResponseCreated(responseId, model || 'unknown'),
                            generateResponseInProgress(responseId),
                            generateOutputItemAdded(responseId),
                            generateContentPartAdded(responseId)
                        );
                    }
                }
                
                // 提取文本内容
                if (parts && Array.isArray(parts)) {
                    const textParts = parts.filter(part => part && typeof part.text === 'string');
                    if (textParts.length > 0) {
                        const text = textParts.map(part => part.text).join('');
                        events.push({
                            delta: text,
                            item_id: `msg_${uuidv4().replace(/-/g, '')}`,
                            output_index: 0,
                            sequence_number: 3,
                            type: "response.output_text.delta"
                        });
                    }
                }
                
                // 处理finishReason
                if (candidate.finishReason) {
                    events.push(
                        generateOutputTextDone(responseId),
                        generateContentPartDone(responseId),
                        generateOutputItemDone(responseId),
                        generateResponseCompleted(responseId)
                    );
                    
                    // 如果有 usage 信息，更新最后一个事件
                    if (geminiChunk.usageMetadata && events.length > 0) {
                        const lastEvent = events[events.length - 1];
                        if (lastEvent.response) {
                            lastEvent.response.usage = {
                                input_tokens: geminiChunk.usageMetadata.promptTokenCount || 0,
                                input_tokens_details: {
                                    cached_tokens: geminiChunk.usageMetadata.cachedContentTokenCount || 0
                                },
                                output_tokens: geminiChunk.usageMetadata.candidatesTokenCount || 0,
                                output_tokens_details: {
                                    reasoning_tokens: geminiChunk.usageMetadata.thoughtsTokenCount || 0
                                },
                                total_tokens: geminiChunk.usageMetadata.totalTokenCount || 0
                            };
                        }
                    }
                }
            }
        }

        // 向后兼容：处理字符串格式
        if (typeof geminiChunk === 'string') {
            events.push({
                delta: geminiChunk,
                item_id: `msg_${uuidv4().replace(/-/g, '')}`,
                output_index: 0,
                sequence_number: 3,
                type: "response.output_text.delta"
            });
        }

        return events;
    }
}

export default GeminiConverter;
