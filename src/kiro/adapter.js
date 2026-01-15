import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { countTokens } from '@anthropic-ai/tokenizer';
import { MODEL_PROVIDER } from '../utils/common.js';
import { KIRO_MODELS, KIRO_CONSTANTS } from "./constants.js";
import { sanitizeMessageHistory, getContentText, sanitizeMessages } from './message-sanitizer.js';
import { promises as fs } from 'fs';
import {getMacAddressSha256, generateRandomUserAgentComponents, getOriginalMacAddressSha256} from './utils.js';
import { createLogger } from '../lib/logger.js';

// 导入搜索模块
import { executeWebSearch, formatSearchResults } from './search.js';
import { streamApiReal } from './streaming.js';

// 导入 API 客户端模块
import {
    generateContent,
    generateContentStream,
    countTextTokens,
    estimateInputTokens,
    buildClaudeResponse,
    getUsageLimits
} from './api-client.js';

// 导入公共摘要模块
import {
    buildMessagesWithSummary,
    SUMMARIZATION_CONFIG
} from './summarization.js';

// 导入认证模块
import {
    pollDeviceToken,
    initializeAuth
} from './auth.js';

// 导入工具映射模块
import {
    CC_TO_KIRO_TOOL_MAPPING,
    KIRO_TOOL_SCHEMAS,
    mapToolUseParams as mapToolParamsImpl,
    reverseMapToolInput as reverseMapInputImpl,
    parseSingleToolCall,
    parseBracketToolCalls,
    deduplicateToolCalls
} from './tools.js';

// 导入工具函数模块
import {
    isZodSchema,
    detectImageFormat
} from './utils.js';

const logger = createLogger('adapter');

// Thinking 功能的提示词模板（通过 prompt injection 实现，参考 cifang）
// 优化版本：在简洁和效果之间平衡（~80 tokens）
const THINKING_PROMPT_TEMPLATE = `在回复之前，请在 <thinking>...</thinking> 标签内进行深入分析：
- 将复杂任务分解为清晰的步骤
- 考虑边界情况和潜在问题
- 确保工具参数完全符合要求
然后提供经过充分思考的回复。`;

// 完整的模型映射表 - Anthropic官方模型ID到AWS CodeWhisperer模型ID
// 注意：AWS CodeWhisperer模型ID使用点号分隔版本号（如claude-opus-4.5）
const FULL_MODEL_MAPPING = {
    // Opus 4.5 映射（AWS使用点号格式）
    "claude-opus-4-5": "claude-opus-4.5",
    "claude-opus-4-5-20251101": "claude-opus-4.5",
    "claude-opus-4-20250514": "claude-opus-4.5",
    "claude-opus-4-0": "claude-opus-4.5",
    // Haiku 4.5 映射（AWS使用点号格式）
    "claude-haiku-4-5": "claude-haiku-4.5",
    "claude-haiku-4-5-20251001": "claude-haiku-4.5",
    // Sonnet 4.5 映射（AWS使用大写V1_0格式）
    "claude-sonnet-4-5": "CLAUDE_SONNET_4_5_20250929_V1_0",
    "claude-sonnet-4-5-20250929": "CLAUDE_SONNET_4_5_20250929_V1_0",
    // Sonnet 4.0 映射（AWS使用大写V1_0格式）
    "claude-sonnet-4-20250514": "CLAUDE_SONNET_4_20250514_V1_0",
    "CLAUDE_SONNET_4_20250514_V1_0": "CLAUDE_SONNET_4_20250514_V1_0"
};

// 只保留 KIRO_MODELS 中存在的模型映射
export const MODEL_MAPPING = Object.fromEntries(
    Object.entries(FULL_MODEL_MAPPING).filter(([key]) => KIRO_MODELS.includes(key))
);

export class KiroService {
    constructor(config = {}) {
        this.isInitialized = false;
        this.config = config;
        this.credPath = path.join(process.cwd(), "configs", "kiro");
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_KIRO ?? false;
        // 详细日志开关（默认关闭，只显示简洁日志）
        this.verboseLogging = config?.ENABLE_VERBOSE_LOGGING ?? false;
        logger.info(`System proxy ${this.useSystemProxy ? 'enabled' : 'disabled'}`);
        logger.info(`Verbose logging ${this.verboseLogging ? 'enabled' : 'disabled'}`);
        logger.info(`ENABLE_THINKING_BY_DEFAULT in config: ${config.ENABLE_THINKING_BY_DEFAULT}`);

        // // Add kiro-oauth-creds-base64 and kiro-oauth-creds-file to config
        // if (config.KIRO_OAUTH_CREDS_BASE64) {
        //     try {
        //         const decodedCreds = Buffer.from(config.KIRO_OAUTH_CREDS_BASE64, 'base64').toString('utf8');
        //         const parsedCreds = JSON.parse(decodedCreds);
        //         this.base64Creds = parsedCreds;
        //         logger.info('Successfully decoded Base64 credentials in constructor.');
        //     } catch (error) {
        //         logger.error(`Failed to parse Base64 credentials in constructor: ${error.message}`);
        //     }
        // } else if (config.KIRO_OAUTH_CREDS_FILE_PATH) {
        //     this.credsFilePath = config.KIRO_OAUTH_CREDS_FILE_PATH;
        // }

        this.modelName = KIRO_CONSTANTS.DEFAULT_MODEL_NAME;
        this.axiosInstance = null; // Initialize later in async method
    }
 
    async checkToken() {
        if (this.isExpiryDateNear() === true) {
            logger.info(`Expiry date is near, refreshing token...`);
            return initializeAuth(this, true);
        }
        return Promise.resolve();
    }

    async initialize(skipAuthCheck = false) {
        if (this.isInitialized) return;
        logger.info('Initializing Kiro API Service...');
        if (!skipAuthCheck) {
            await initializeAuth(this);
        }

        // 生成随机化的设备指纹
        const macSha256 = await getMacAddressSha256();
        const uaComponents = generateRandomUserAgentComponents();

        // 配置 HTTP/HTTPS agent 限制连接池大小，避免资源泄漏
        // ⚠️ 修复：减少 keepAlive 超时，避免连接失效后仍被复用
        const httpAgent = new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 30000,  // keepAlive 探测间隔 30 秒
            maxSockets: 100,        // 每个主机最多 100 个连接
            maxFreeSockets: 5,      // 最多保留 5 个空闲连接
            timeout: 60000,         // 空闲连接 60 秒后关闭（减少到 1 分钟）
            scheduling: 'lifo'      // LIFO：优先使用最近的连接，减少失效连接复用
        });
        const httpsAgent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 30000,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: 60000,
            scheduling: 'lifo'
        });

        // 保存 agent 引用，用于后续销毁
        this.httpAgent = httpAgent;
        this.httpsAgent = httpsAgent;

        // 构建随机化的 User-Agent
        const randomizedUserAgent = `aws-sdk-js/${uaComponents.sdkVersion} ua/2.1 os/${uaComponents.osType}#${uaComponents.winVersion} lang/js md/nodejs#${uaComponents.nodeVersion} api/codewhispererstreaming#${uaComponents.sdkVersion} m/N,E KiroIDE-${uaComponents.kiroVersion}-${macSha256}`;
        const randomizedAmzUserAgent = `aws-sdk-js/${uaComponents.sdkVersion} KiroIDE-${uaComponents.kiroVersion}-${macSha256}`;

        // 随机化请求重试次数
        const maxRetries = 2 + Math.floor(Math.random() * 3); // 2-4

        const axiosConfig = {
            timeout: KIRO_CONSTANTS.AXIOS_TIMEOUT,
            httpAgent,
            httpsAgent,
            headers: {
                'Content-Type': KIRO_CONSTANTS.CONTENT_TYPE_JSON,
                'Accept': KIRO_CONSTANTS.ACCEPT_JSON,
                'amz-sdk-request': `attempt=1; max=${maxRetries}`,
                'x-amzn-kiro-agent-mode': 'vibe',
                'x-amz-user-agent': randomizedAmzUserAgent,
                'user-agent': randomizedUserAgent
            },
        };
        
        // 根据 useSystemProxy 配置代理设置
        if (!this.useSystemProxy) {
            axiosConfig.proxy = false;
        }
        
        this.axiosInstance = axios.create(axiosConfig);
        this.isInitialized = true;
    }

    /**
     * 重置连接池（用于处理 socket 错误）
     * 销毁旧的 agent 并重新初始化
     */
    async resetConnectionPool() {
        logger.info('Resetting connection pool...');

        // 销毁旧的 agent
        if (this.httpAgent) {
            this.httpAgent.destroy();
        }
        if (this.httpsAgent) {
            this.httpsAgent.destroy();
        }

        // 重新初始化
        this.isInitialized = false;
        await this.initialize();

        logger.info('Connection pool reset completed');
    }

    /**
     * AWS SSO OIDC设备授权流程 - 完整流程(用于OAuth handler调用)
     *
     * @param {string} startUrl - AWS SSO起始URL
     * @returns {Promise<Object>} 返回授权URL和设备信息
     */
    async initiateDeviceAuthorization(startUrl) {
        const deviceAuthInfo = await this.startDeviceAuthorization(this, startUrl);

        // 启动后台轮询(不等待完成)
        pollDeviceToken(
            this,
            deviceAuthInfo.deviceCode,
            deviceAuthInfo.interval,
            deviceAuthInfo.expiresIn
        ).catch(error => {
            logger.error('Background polling failed:', { error: error.message });
        });

        return {
            authUrl: deviceAuthInfo.verificationUriComplete,
            authInfo: {
                provider: 'claude-kiro-oauth',
                authMethod: KIRO_CONSTANTS.AUTH_METHOD_IDC,
                deviceCode: deviceAuthInfo.deviceCode,
                userCode: deviceAuthInfo.userCode,
                verificationUri: deviceAuthInfo.verificationUri,
                verificationUriComplete: deviceAuthInfo.verificationUriComplete,
                expiresIn: deviceAuthInfo.expiresIn,
                interval: deviceAuthInfo.interval,
                instructions: '请在浏览器中打开此链接进行AWS SSO授权。授权完成后,系统会自动获取访问令牌。'
            }
        };
    }

    /**
     * 反向映射 schema 参数名（Kiro → CC）
     * 用于将 Kiro schema 的参数名转换回 Claude Code 期望的参数名
     *
     * @param {Object} schema - Kiro schema
     * @param {Object} paramMap - 参数映射表（CC → Kiro）
     * @returns {Object} - 反向映射后的 schema
     */
    reverseMapSchema(schema, paramMap) {
        if (!schema || typeof schema !== 'object') {
            return schema;
        }

        // 创建反向映射表（Kiro → CC）
        const reverseMap = {};
        for (const [ccParam, kiroParam] of Object.entries(paramMap)) {
            reverseMap[kiroParam] = ccParam;
        }

        // 深拷贝 schema
        const newSchema = { ...schema };

        // 反向映射 properties 中的参数名
        if (newSchema.properties && typeof newSchema.properties === 'object') {
            const newProperties = {};
            for (const [key, value] of Object.entries(newSchema.properties)) {
                const newKey = reverseMap[key] || key;  // 如果有反向映射，使用 CC 参数名
                newProperties[newKey] = value;
            }
            newSchema.properties = newProperties;
        }

        // 反向映射 required 数组中的参数名
        if (Array.isArray(newSchema.required)) {
            newSchema.required = newSchema.required.map(param => reverseMap[param] || param);
        }

        return newSchema;
    }

    /**
     * 映射工具调用的参数名（Claude Code → Kiro）
     * 用于处理 tool_use 时将 CC 的参数名转换为 Kiro 的参数名
     *
     * @param {string} toolName - 工具名称
     * @param {Object} input - 原始输入参数
     * @returns {Object} - 映射后的参数
     */
    mapToolUseParams(toolName, input) {
        return mapToolParamsImpl(toolName, input, this.verboseLogging || toolName === 'Task');
    }

    /**
     * 反向映射工具调用的参数名（Kiro → Claude Code）
     * 用于将 Kiro 返回的 tool_use 参数转换回 CC 期望的格式
     *
     * @param {string} toolName - 工具名称（CC 格式）
     * @param {Object} input - Kiro 返回的参数
     * @returns {Object} - 反向映射后的参数（CC 格式）
     */
    reverseMapToolInput(toolName, input) {
        return reverseMapInputImpl(toolName, input, this.verboseLogging);
    }

    /**
     * Kiro 优化：工具格式转换（支持多种输入格式，统一输出 toolSpecification）
     * 参考 Kiro 源码 extension.js:707778
     * 支持 Kiro 原生等多种工具格式
     *
     * ⚠️ 重要：AWS CodeWhisperer API 只接受 toolSpecification 格式！
     * Anthropic 的 builtin tool 格式（如 { type: "bash_20250305", name: "bash" }）
     * 在 CodeWhisperer API 中会导致 400 Bad Request 错误。
     */
    convertToQTool(tool, compressInputSchema, maxDescLength) {
        // 格式 0：Kiro 内置工具（Builtin Tools）- 直接传递，不转换
        // 参考 Kiro 源码 extension.js:683316-683326
        // 格式：{ type: "web_search_20250305", name: "web_search", max_uses: 8, ... }
        // ⚠️ 严格按照Kiro官方支持的6个工具，不添加额外工具
        const builtinTools = [
            'web_search',
            'bash',
            'code_execution',
            'computer',
            'str_replace_editor',
            'str_replace_based_edit_tool'
        ];

        // 完全按照Kiro官方逻辑：extension.js:683325
        if (typeof tool === 'object' && tool !== null &&
            'type' in tool && 'name' in tool &&
            typeof tool.type === 'string' && typeof tool.name === 'string' &&
            builtinTools.includes(tool.name)) {
            if (this.verboseLogging) {
                logger.info(`Detected builtin tool: ${tool.name}, passing through without conversion`);
            }
            return tool;  // 内置工具原样传递
        }

        // 格式 1：风格 { function: { name, description, parameters } }
        if (tool.function && typeof tool.function === 'object') {
            const schema = compressInputSchema(tool.function.parameters || {});
            let desc = tool.function.description || "";
            if (desc.length > maxDescLength) {
                desc = desc.substring(0, maxDescLength).trim() + '...';
            }

            return {
                toolSpecification: {
                    name: tool.function.name,
                    description: desc,
                    inputSchema: { json: schema }
                }
            };
        }

        // 格式 2：Kiro 原生格式（已经是 toolSpecification）
        if (tool.toolSpecification) {
            // 压缩 description
            if (tool.toolSpecification.description && tool.toolSpecification.description.length > maxDescLength) {
                tool.toolSpecification.description = tool.toolSpecification.description.substring(0, maxDescLength).trim() + '...';
            }
            return tool;
        }

        // 格式 3：Anthropic/Claude 格式 { name, description, input_schema }
        if (tool.name && 'description' in tool && (tool.input_schema || tool.schema)) {
            let schema = tool.input_schema || tool.schema || {};

            // 支持 Zod Schema（自动转换）
            if (isZodSchema(schema)) {
                logger.info('Converting Zod schema to JSON schema for tool:', { toolName: tool.name });
                // 注意：需要安装 zod-to-json-schema 库才能完整支持
                // 这里暂时保持原样，避免引入额外依赖
            }

            schema = compressInputSchema(schema);
            let desc = tool.description || "";
            if (desc.length > maxDescLength) {
                desc = desc.substring(0, maxDescLength).trim() + '...';
            }

            return {
                toolSpecification: {
                    name: tool.name,
                    description: desc,
                    inputSchema: { json: schema }
                }
            };
        }

        // 格式 4：带 id 和 parameters { id, description, parameters }
        if (tool.id && 'description' in tool && tool.parameters) {
            let schema = tool.parameters;
            if (isZodSchema(schema)) {
                logger.info('Zod schema detected for tool:', { toolId: tool.id });
            }

            schema = compressInputSchema(schema);
            let desc = tool.description || "";
            if (desc.length > maxDescLength) {
                desc = desc.substring(0, maxDescLength).trim() + '...';
            }

            return {
                toolSpecification: {
                    name: tool.id,
                    description: desc,
                    inputSchema: { json: schema }
                }
            };
        }

        // 格式 5：带 id 和 schema { id, description, schema }
        if (tool.id && 'description' in tool && tool.schema) {
            let schema = tool.schema;
            if (isZodSchema(schema)) {
                logger.info('Zod schema detected for tool:', { toolId: tool.id });
            }

            schema = compressInputSchema(schema);
            let desc = tool.description || "";
            if (desc.length > maxDescLength) {
                desc = desc.substring(0, maxDescLength).trim() + '...';
            }

            return {
                toolSpecification: {
                    name: tool.id,
                    description: desc,
                    inputSchema: { json: schema }
                }
            };
        }

        // 无法识别的格式
        logger.error('Invalid tool format:', { tool });
        throw new Error('Invalid tool format. Supported: Anthropic, LangChain, Kiro native, or id+parameters/schema formats.');
    }

    /**
     * Kiro 优化：使用映射表转换工具
     * 优先使用 CC_TO_KIRO_TOOL_MAPPING 中的 Kiro 官方 schema
     * 如果没有映射，则降级到原始的 convertToQTool
     */
    convertToQToolWithMapping(tool, compressInputSchema, maxDescLength) {
        // 获取工具名（兼容多种格式）
        let toolName = null;
        let originalSchema = null;
        let originalDesc = null;

        if (tool.function?.name) {
            toolName = tool.function.name;
            originalSchema = tool.function.parameters;
            originalDesc = tool.function.description;
        } else if (tool.toolSpecification?.name) {
            toolName = tool.toolSpecification.name;
            originalSchema = tool.toolSpecification.inputSchema?.json;
            originalDesc = tool.toolSpecification.description;
        } else if (tool.name) {
            toolName = tool.name;
            originalSchema = tool.input_schema || tool.schema;
            originalDesc = tool.description;
        } else if (tool.id) {
            toolName = tool.id;
            originalSchema = tool.parameters || tool.schema;
            originalDesc = tool.description;
        }

        // 检查是否有映射
        const mapping = CC_TO_KIRO_TOOL_MAPPING[toolName];

        if (mapping && mapping.kiroTool) {
            // ⚠️ 关键修复：使用 CC 原始的 schema，不要用 Kiro 的 schema
            // 因为 CC 会根据返回的 schema 验证参数，如果使用 Kiro schema，
            // CC 会收到它不认识的参数（如 explanation, path），导致验证失败
            // 参数映射只在 mapToolUseParams 中进行（发送给 Kiro 时）

            // 压缩原始 schema
            const compressedSchema = originalSchema ? compressInputSchema(originalSchema) : { type: 'object', properties: {} };

            const desc = mapping.description || originalDesc || '';
            const truncatedDesc = desc.length > maxDescLength
                ? desc.substring(0, maxDescLength).trim() + '...'
                : desc;

            if (this.verboseLogging) {
                logger.info(`Mapped tool: ${toolName} → ${mapping.kiroTool} (keeping original CC schema)`);
            }

            return {
                toolSpecification: {
                    name: toolName,  // 保持原工具名，因为 CC 会用原名调用
                    description: truncatedDesc,
                    inputSchema: { json: compressedSchema }
                }
            };
        }

        // 没有映射，使用原始的 convertToQTool 逻辑
        return this.convertToQTool(tool, compressInputSchema, maxDescLength);
    }

    /**
     * Kiro 优化：提取消息元数据
     * 参考 Kiro 源码 extension.js:707749
     * 从消息的 additional_kwargs 中提取元数据（conversationId, continuationId, taskType）
     */
    extractMetadata(messages, key) {
        if (!messages || messages.length === 0) return null;

        // 从后往前查找（最新消息优先）
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.additional_kwargs && msg.additional_kwargs[key]) {
                logger.debug(`Extracted ${key}:`, { value: msg.additional_kwargs[key] });
                return msg.additional_kwargs[key];
            }
        }
        return null;
    }

    /**
     * Kiro 优化：提取补充上下文
     * 参考 Kiro 源码 extension.js:578750-578780
     * 从消息的 additional_kwargs 中提取工作区上下文信息
     *
     * @param {Object} message - 消息对象
     * @returns {Array} 补充上下文数组
     */
    extractSupplementalContext(message) {
        const supplementalContexts = [];

        if (!message || !message.additional_kwargs) {
            return supplementalContexts;
        }

        const kwargs = message.additional_kwargs;

        // 1. 提取最近编辑的文件（recentlyEditedFiles）
        if (kwargs.recentlyEditedFiles && Array.isArray(kwargs.recentlyEditedFiles)) {
            kwargs.recentlyEditedFiles.forEach(file => {
                if (file.filepath && file.contents) {
                    supplementalContexts.push({
                        filePath: file.filepath,
                        content: file.contents
                    });
                }
            });
        }

        // 2. 提取最近编辑的范围（recentlyEditedRanges）
        if (kwargs.recentlyEditedRanges && Array.isArray(kwargs.recentlyEditedRanges)) {
            kwargs.recentlyEditedRanges.forEach(range => {
                if (range.filepath && range.lines) {
                    supplementalContexts.push({
                        filePath: range.filepath,
                        content: Array.isArray(range.lines) ? range.lines.join('\n') : range.lines
                    });
                }
            });
        }

        // 3. 提取光标上下文（cursorContext）
        if (kwargs.cursorContext) {
            const ctx = kwargs.cursorContext;
            if (ctx.filepath && ctx.content) {
                supplementalContexts.push({
                    filePath: ctx.filepath,
                    content: ctx.content
                });
            }
        }

        return supplementalContexts;
    }

    /**
     * Kiro 风格的消息摘要（简单截断到 100 字符）
     * 参考: Kiro extension.js:161275-1280
     * 注意：不是 AI 摘要，只是简单截断，节省成本和时间
     *
     * ⚠️ 关键：保持原始 content 的格式（数组就保持数组，字符串就保持字符串）
     */
    /**
     * Kiro 官方的 pruneStringFromTop 实现：使用 tokenizer 精确裁剪
     * 保留字符串的最后 maxTokens 个 token
     */
    pruneStringFromTop(text, maxTokens) {
        try {
            const tokens = this.tokenizer.encode(text);
            if (tokens.length <= maxTokens) {
                return text;
            }
            // 保留最后 maxTokens 个 token
            const prunedTokens = tokens.slice(tokens.length - maxTokens);
            return this.tokenizer.decode(prunedTokens);
        } catch (error) {
            // Fallback: 字符估算
            logger.warn('Tokenizer failed, using character estimation');
            const estimatedChars = Math.floor(maxTokens * 3.5);
            return text.substring(text.length - estimatedChars);
        }
    }

    /**
     * Kiro 官方的 summarize 实现：智能摘要消息内容
     * ⚠️ 关键：保留 tool_result 和 tool_use 的结构，只截断其内容
     */
    summarizeMessage(message) {
        const content = message.content;
        // ⚠️ 优化：提高截断阈值，减少信息丢失
        // 对于工具结果（代码、文件内容），保留更多内容
        const TEXT_TRUNCATE_LENGTH = 1000;      // 普通文本：1000 字符
        const TOOL_RESULT_TRUNCATE_LENGTH = 2000;  // 工具结果：2000 字符（代码更重要）

        if (Array.isArray(content)) {
            // ⚠️ 关键修复：保留 tool_result 和 tool_use 结构，只截断内容
            const summarizedContent = [];
            let hasToolParts = false;

            for (const part of content) {
                if (part.type === 'text' && part.text) {
                    // 截断文本内容
                    const truncated = part.text.length > TEXT_TRUNCATE_LENGTH
                        ? part.text.substring(0, TEXT_TRUNCATE_LENGTH) + '...'
                        : part.text;
                    summarizedContent.push({ type: 'text', text: truncated });
                } else if (part.type === 'tool_result') {
                    hasToolParts = true;
                    // 保留 tool_result 结构，但截断内容（保留更多）
                    const truncatedResult = {
                        type: 'tool_result',
                        tool_use_id: part.tool_use_id
                    };
                    if (part.content) {
                        if (typeof part.content === 'string') {
                            truncatedResult.content = part.content.length > TOOL_RESULT_TRUNCATE_LENGTH
                                ? part.content.substring(0, TOOL_RESULT_TRUNCATE_LENGTH) + '...[truncated]'
                                : part.content;
                        } else {
                            truncatedResult.content = '[content truncated]';
                        }
                    }
                    if (part.is_error) {
                        truncatedResult.is_error = part.is_error;
                    }
                    summarizedContent.push(truncatedResult);
                } else if (part.type === 'tool_use') {
                    hasToolParts = true;
                    // 保留 tool_use 结构
                    summarizedContent.push({
                        type: 'tool_use',
                        id: part.id,
                        name: part.name,
                        input: part.input  // 保留完整的 input
                    });
                } else {
                    // 其他类型直接保留
                    summarizedContent.push(part);
                }
            }

            return summarizedContent.length > 0 ? summarizedContent : [{ type: 'text', text: '...' }];
        }

        // 字符串格式，直接截断（使用 TEXT_TRUNCATE_LENGTH，并保留未截断的原文）但是这里的字符串有可能是json字符串，直接截断会出问题
        if (typeof content === 'string') {
            return content.length > TEXT_TRUNCATE_LENGTH
                ? content.substring(0, TEXT_TRUNCATE_LENGTH) + '...'
                : content;
        }
        return String(content).substring(0, TEXT_TRUNCATE_LENGTH) + '...';
    }

    /**
     * 使用 AI 进行智能摘要（异步方法）- 流式版本
     * 优先尝试 AI 摘要，失败后降级到传统裁剪
     *
     * 优化：使用流式请求复用现有连接，避免建立新连接的开销
     *
     * @param {Array} messages - 消息数组
     * @param {number} contextLength - 上下文长度限制
     * @param {number} reservedTokens - 预留 token 数
     * @returns {Promise<Array>} - 处理后的消息数组
     */
    async pruneChatHistoryWithAI(messages, contextLength, reservedTokens) {
        const minKeep = SUMMARIZATION_CONFIG.MIN_MESSAGES_TO_KEEP || 5;
        const minMessagesForSummary = SUMMARIZATION_CONFIG.MIN_MESSAGES_FOR_SUMMARY || 8;

        // 如果消息数量不足，直接使用传统裁剪
        if (messages.length < minMessagesForSummary) {
            return this.pruneChatHistory(messages, contextLength, reservedTokens);
        }

        // 检查冷却时间（避免频繁摘要）
        const now = Date.now();
        const cooldown = SUMMARIZATION_CONFIG.SUMMARIZATION_COOLDOWN_MS || 3 * 60 * 1000;
        if (this._lastSummarizationTime && (now - this._lastSummarizationTime) < cooldown) {
            return this.pruneChatHistory(messages, contextLength, reservedTokens);
        }

        try {
            // 分离：需要摘要的消息 vs 保留的最近消息
            const messagesToSummarize = messages.slice(0, -minKeep);
            const recentMessages = messages.slice(-minKeep);

            if (messagesToSummarize.length <= 3) {
                return this.pruneChatHistory(messages, contextLength, reservedTokens);
            }

            // 提取对话信息用于摘要
            const extractedInfo = this._extractConversationInfo(messagesToSummarize);

            // 限制总长度避免摘要请求本身超限
            let conversationData = extractedInfo;
            if (conversationData.length > 50000) {
                conversationData = conversationData.substring(0, 50000) + '\n[...truncated for summarization...]';
            }

            // 构建摘要请求
            const summaryPrompt = `[SYSTEM NOTE: Context limit reached. Create a structured summary.]

You are preparing a summary for a new agent instance who will pick up this conversation.

Organize the summary by TASKS/REQUESTS. For each distinct task:
- **SHORT DESCRIPTION**: Brief description of the task
- **STATUS**: done | in-progress | not-started | abandoned
- **DETAILS**: Key context, decisions made, current state
- **NEXT STEPS**: If in-progress, list remaining work
- **FILEPATHS**: Related files (use \`code\` formatting)

CONVERSATION DATA TO SUMMARIZE:
${conversationData}`;

            // ✅ 优化：使用流式请求，复用现有连接
            const summaryRequestBody = {
                messages: [{ role: 'user', content: summaryPrompt }],
                system: null,
                tools: null  // 摘要请求不需要工具
            };

            const summaryModel = SUMMARIZATION_CONFIG.SUMMARIZATION_MODEL || 'claude-sonnet-4-5-20250929';

            // ⚠️ 修复：增加超时时间到 60 秒（流式请求需要更多时间处理大量内容）
            // 之前 10 秒太短，导致摘要全部超时失败
            const SUMMARY_TIMEOUT_MS = 60000;
            let timeoutId;
            let aborted = false;

            logger.info('Starting streaming summarization...');
            logger.debug(`Conversation data length: ${conversationData.length} chars`);
            const streamStartTime = Date.now();

            const summaryPromise = (async () => {
                const chunks = [];
                try {
                    for await (const event of streamApiReal(this, '', summaryModel, summaryRequestBody)) {
                        if (aborted) break;
                        if (event.type === 'content' && event.content) {
                            chunks.push(event.content);
                        }
                    }
                    return chunks.join('');
                } catch (streamError) {
                    if (!aborted) throw streamError;
                    return null;
                }
            })();

            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    aborted = true;
                    reject(new Error('Summary timeout after 60s'));
                }, SUMMARY_TIMEOUT_MS);
            });

            const summary = await Promise.race([summaryPromise, timeoutPromise]);
            clearTimeout(timeoutId);

            const streamDuration = Date.now() - streamStartTime;
            logger.info(`Streaming completed in ${streamDuration}ms`);

            if (summary) {
                // 使用摘要 + 最近消息构建新的消息历史
                const originalCount = messages.length;
                const newMessages = buildMessagesWithSummary(summary, recentMessages, originalCount);
                this._lastSummarizationTime = now;
                logger.info(`Success! Summary length: ${summary.length} chars`);
                return newMessages;
            }
        } catch (error) {
            logger.error(`Failed:`, { error: error.message });
        }

        // 降级：AI 摘要失败，使用传统裁剪
        return this.pruneChatHistory(messages, contextLength, reservedTokens);
    }

    /**
     * 提取对话信息用于摘要（内部辅助方法）
     * @param {Array} messages - 消息数组
     * @returns {string} - 提取的对话信息
     */
    _extractConversationInfo(messages) {
        const sections = [];

        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                sections.push(`${role}: ${msg.content}\n`);
                continue;
            }

            if (!Array.isArray(msg.content)) continue;

            for (const entry of msg.content) {
                if (entry.type === 'text' && entry.text) {
                    const role = msg.role === 'user' ? 'User' : 'Assistant';
                    sections.push(`${role}: ${entry.text}\n`);
                }

                if (entry.type === 'tool_use') {
                    const args = entry.input ? JSON.stringify(entry.input).substring(0, 500) : 'no args';
                    sections.push(`Tool: ${entry.name || 'unknown'} - ${args}\n`);
                }

                if (entry.type === 'tool_result') {
                    const status = entry.is_error ? 'FAILED' : 'SUCCESS';
                    let responseMsg = '';
                    if (entry.content) {
                        const content = typeof entry.content === 'string'
                            ? entry.content
                            : JSON.stringify(entry.content);
                        responseMsg = ` - ${content.substring(0, 300)}`;
                    }
                    sections.push(`ToolResult: ${status}${responseMsg}\n`);
                }
            }
        }

        return sections.join('\n');
    }

    /**
     * Kiro 风格的消息历史修剪策略（传统方法，作为降级方案）
     * 参考: Kiro extension.js:161281-1340
     *
     * 多阶段策略：
     * 1. 修剪超长消息（> contextLength/3）
     * 2. 保留最后 5 条消息，摘要前面的消息
     * 3. 删除最旧的消息（保留至少 5 条）
     * 4. 继续摘要剩余消息
     * 5. 继续删除旧消息（保留至少 1 条）
     * 6. 最终修剪第一条消息
     */
    pruneChatHistory(messages, contextLength, tokensForCompletion) {
        // 深拷贝消息副本，避免修改原数组（特别是 content 数组）
        const chatHistory = messages.map(msg => ({
            ...msg,
            content: Array.isArray(msg.content)
                ? msg.content.map(part => ({ ...part }))  // 深拷贝 content 数组
                : msg.content  // 字符串直接复制
        }));

        // ⚠️ 关键修复：使用 getFullMessageTokens 计算完整 token 数（包括 tool_result）
        let totalTokens = tokensForCompletion + chatHistory.reduce((acc, message) => {
            return acc + this.getFullMessageTokens(message, true);
        }, 0);

        // 如果不超限，直接返回
        if (totalTokens <= contextLength) {
            return chatHistory;
        }

        // 阶段 1: 处理超长消息（> contextLength/3 的消息）
        const longestMessages = [...chatHistory];
        longestMessages.sort((a, b) => {
            // 使用完整 token 计算进行排序
            return this.getFullMessageTokens(b, true) - this.getFullMessageTokens(a, true);
        });

        const longerThanOneThird = longestMessages.filter(message => {
            return this.getFullMessageTokens(message, true) > contextLength / 3;
        });

        for (const message of longerThanOneThird) {
            const messageTokens = this.getFullMessageTokens(message, true);
            const deltaNeeded = totalTokens - contextLength;
            const distanceFromThird = messageTokens - contextLength / 3;
            const delta = Math.min(deltaNeeded, distanceFromThird);

            // ⚠️ 优化：如果消息包含 tool_result，直接清空 tool_result 内容而不是截断
            if (Array.isArray(message.content)) {
                let hasToolResult = false;
                for (const part of message.content) {
                    if (part.type === 'tool_result') {
                        hasToolResult = true;
                        // 截断 tool_result 内容
                        if (typeof part.content === 'string' && part.content.length > 500) {
                            part.content = part.content.substring(0, 500) + '\n[... content truncated for context limit ...]';
                        } else if (Array.isArray(part.content)) {
                            part.content = [{ type: 'text', text: '[... content truncated for context limit ...]' }];
                        }
                    }
                }
                if (hasToolResult) {
                    // 重新计算 token 并更新 totalTokens
                    const newTokens = this.getFullMessageTokens(message, true);
                    totalTokens -= (messageTokens - newTokens);
                    if (totalTokens <= contextLength) {
                        return chatHistory;
                    }
                    continue;
                }
            }

            // 对于纯文本消息，从顶部修剪
            const content = getContentText(message);
            const targetTokens = messageTokens - delta;
            const estimatedChars = Math.floor(targetTokens * 3.5);  // 粗略估算字符数
            const prunedText = content.substring(content.length - estimatedChars);

            // ⚠️ 保持原始格式：数组就保持数组，字符串就保持字符串
            if (Array.isArray(message.content)) {
                message.content = [{ type: 'text', text: prunedText }];
            } else {
                message.content = prunedText;
            }
            totalTokens -= delta;

            if (totalTokens <= contextLength) {
                return chatHistory;
            }
        }

        // 阶段 2: 保留最后 5 条消息，摘要前面的消息
        let i = 0;
        while (totalTokens > contextLength && i < chatHistory.length - 5) {
            const message = chatHistory[i];
            // ⚠️ 关键修复：使用完整 token 计算
            const oldTokens = this.getFullMessageTokens(message, true);
            const summarized = this.summarizeMessage(message);  // 传入整个 message
            const newTokens = countTextTokens(getContentText({ content: summarized }), true);

            message.content = summarized;  // summarized 已经是正确格式（数组或字符串）
            totalTokens = totalTokens - oldTokens + newTokens;
            i++;
        }

        if (totalTokens <= contextLength) {
            return chatHistory;
        }

        // 阶段 3: 删除最旧的消息（保留至少 5 条）
        while (chatHistory.length > 5 && totalTokens > contextLength) {
            const message = chatHistory.shift();
            // ⚠️ 关键修复：使用完整 token 计算
            totalTokens -= this.getFullMessageTokens(message, true);
        }

        if (totalTokens <= contextLength) {
            return chatHistory;
        }

        // 阶段 4: 继续摘要剩余消息（除了最后一条）
        i = 0;
        while (totalTokens > contextLength && chatHistory.length > 0 && i < chatHistory.length - 1) {
            const message = chatHistory[i];
            const content = getContentText(message);

            // 如果已经是摘要，跳过
            if (content.endsWith('...') && content.length <= 103) {
                i++;
                continue;
            }

            // ⚠️ 关键修复：使用完整 token 计算
            const oldTokens = this.getFullMessageTokens(message, true);
            const summarized = this.summarizeMessage(message);  // 传入整个 message
            const newTokens = countTextTokens(getContentText({ content: summarized }), true);

            message.content = summarized;  // summarized 已经是正确格式
            totalTokens = totalTokens - oldTokens + newTokens;
            i++;
        }

        if (totalTokens <= contextLength) {
            return chatHistory;
        }

        // 阶段 5: 继续删除旧消息（保留至少 1 条）
        while (totalTokens > contextLength && chatHistory.length > 1) {
            const message = chatHistory.shift();
            // ⚠️ 关键修复：使用完整 token 计算
            totalTokens -= this.getFullMessageTokens(message, true);
        }

        if (totalTokens <= contextLength) {
            return chatHistory;
        }

        // 阶段 6: 最终修剪第一条消息
        if (totalTokens > contextLength && chatHistory.length > 0) {
            const message = chatHistory[0];
            // ⚠️ 关键修复：使用完整 token 计算
            const currentMessageTokens = this.getFullMessageTokens(message, true);

            // ⚠️ FIX: 正确计算需要删除多少 tokens
            const tokensToRemove = totalTokens - contextLength;
            const targetMessageTokens = Math.max(100, currentMessageTokens - tokensToRemove); // 至少保留100 tokens

            // 如果消息包含 tool_result，直接截断
            if (Array.isArray(message.content)) {
                for (const part of message.content) {
                    if (part.type === 'tool_result') {
                        part.content = '[... content truncated ...]';
                    }
                }
            }

            const content = getContentText(message);
            const estimatedChars = Math.floor(targetMessageTokens * 3.5);
            const prunedText = content.substring(content.length - estimatedChars);

            // ⚠️ 保持原始格式：数组就保持数组，字符串就保持字符串
            if (Array.isArray(message.content)) {
                message.content = [{ type: 'text', text: prunedText }];
            } else {
                message.content = prunedText;
            }
        }

        return chatHistory;
    }

    /**
     * 计算消息的完整 token 数（包括 tool_result, tool_use, thinking, 图片等）
     * ⚠️ 关键修复：之前 getContentText 只提取 text 类型，导致其他内容被忽略
     * 这会导致 token 估算严重低估，从而触发 CONTENT_LENGTH_EXCEEDS_THRESHOLD 错误
     */
    getFullMessageTokens(message, useFastEstimate = true) {
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
     * Build CodeWhisperer request
     * @param {Array} messages - 消息数组
     * @param {string} model - 模型名称
     * @param {Array} tools - 工具定义数组
     * @param {string} inSystemPrompt - 系统提示词
     * @param {boolean} enableThinking - 是否启用思考模式（通过prompt injection实现）
     */
    async buildCodewhispererRequest(messages, model, tools = null, inSystemPrompt = null, enableThinking = false) {
        const buildStartTime = Date.now();
        let systemPrompt = getContentText(inSystemPrompt);

        // 如果启用 thinking，在系统提示词中注入 thinking 指令
        if (enableThinking) {
            if (systemPrompt) {
                systemPrompt = `${THINKING_PROMPT_TEMPLATE}\n\n${systemPrompt}`;
            } else {
                systemPrompt = THINKING_PROMPT_TEMPLATE;
            }
        }

        // Kiro 优化 1：消息验证和自动修复（确保消息交替）
        const sanitizeStartTime = Date.now();
        messages = sanitizeMessages(messages, this.verboseLogging);
        const sanitizeDuration = Date.now() - sanitizeStartTime;
        if (sanitizeDuration > 50) {
            logger.debug(`sanitizeMessages took ${sanitizeDuration}ms`);
        }

        // Kiro 官方逻辑：使用MODEL_MAPPING映射到AWS支持的模型ID（提前定义，供后续使用）
        const codewhispererModel = MODEL_MAPPING[model] || MODEL_MAPPING[this.modelName];

        // Kiro 优化 1.5：消息历史修剪（防止 CONTENT_LENGTH_EXCEEDS_THRESHOLD 错误）
        // 参考 Kiro 官方客户端的实现
        const contextLength = KIRO_CONSTANTS.MAX_CONTEXT_TOKENS;
        const autoSummarizeThreshold = Math.floor(contextLength * KIRO_CONSTANTS.AUTO_SUMMARIZE_THRESHOLD);

        // ⚠️ 关键修复：使用 getFullMessageTokens 计算完整 token 数（包括 tool_result）
        // 之前使用 getContentText 只计算 text 类型，导致 tool_result 被忽略，token 严重低估
        let currentTokens = messages.reduce((acc, message) => {
            return acc + this.getFullMessageTokens(message, true);
        }, 0);

        // 添加系统提示词的 token 数
        if (systemPrompt) {
            currentTokens += countTextTokens(systemPrompt, true);
        }

        // 添加工具定义的 token 数（如果有）- 只计算一次，缓存结果
        let toolsTokens = 0;
        if (tools && Array.isArray(tools)) {
            // 性能优化：使用简单估算替代 JSON.stringify
            // 每个工具约 80 基础 tokens + description tokens + schema 属性数 * 50
            for (const tool of tools) {
                toolsTokens += 80;  // 基础元数据
                const desc = tool.description || tool.function?.description || '';
                if (desc) {
                    toolsTokens += countTextTokens(desc, true);
                }
                const schema = tool.input_schema || tool.function?.parameters || tool.parameters;
                if (schema?.properties) {
                    toolsTokens += Object.keys(schema.properties).length * 50;
                }
            }
            currentTokens += toolsTokens;
        }

        // 如果超过阈值，触发消息修剪
        const thresholdPct = Math.round(KIRO_CONSTANTS.AUTO_SUMMARIZE_THRESHOLD * 100);
        if (currentTokens > autoSummarizeThreshold) {
            logger.debug(
                `Auto-Pruning Token usage: ${currentTokens}/${contextLength} (${Math.round(currentTokens/contextLength*100)}%) > ${thresholdPct}% threshold - TRIGGERING PRUNING`
            );
            logger.debug(
                `Token Detail: messages=${messages.length}, sysTokens=${systemPrompt ? countTextTokens(systemPrompt, true) : 0}, toolsTokens=${toolsTokens}`
            );
        } else {
            // ⚠️ 每10条消息打印一次详细日志
            if (messages.length % 10 === 0 || messages.length <= 5) {
                logger.debug(
                    `Token-Check ${currentTokens}/${contextLength} (${Math.round(currentTokens/contextLength*100)}%) < ${thresholdPct}% threshold - NO PRUNING`
                );
                logger.debug(
                    `Token Detail: messages=${messages.length}, msgTokens=${currentTokens - toolsTokens - (systemPrompt ? countTextTokens(systemPrompt, true) : 0)}, sysTokens=${systemPrompt ? countTextTokens(systemPrompt, true) : 0}, toolsTokens=${toolsTokens}`
                );
            }
        }

        if (currentTokens > autoSummarizeThreshold) {

            // 预留给工具和系统提示词的 token（复用已计算的 toolsTokens）
            const tokensForCompletion = 4096;  // 预留给响应的 token
            let reservedTokens = tokensForCompletion + (systemPrompt ? countTextTokens(systemPrompt, true) : 0);
            reservedTokens += toolsTokens;  // 直接复用，不再重复计算

            // 执行修剪（优先使用 AI 摘要，失败则降级到传统裁剪）
            const pruneStartTime = Date.now();
            messages = await this.pruneChatHistoryWithAI(messages, contextLength, reservedTokens);
            const pruneDuration = Date.now() - pruneStartTime;
            logger.debug(`pruneChatHistoryWithAI took ${pruneDuration}ms`);

            // 修剪后重新计算 token 数（使用完整 token 计算方法）
            const prunedTokens = messages.reduce((acc, message) => {
                return acc + this.getFullMessageTokens(message, true);
            }, 0);
            logger.debug(
                `Auto-Pruning Completed: ${prunedTokens}/${contextLength} (${Math.round(prunedTokens/contextLength*100)}%)`
            );
        }

        // Kiro 优化 2：提取 conversationId 和 continuationId（多轮对话优化）
        // 从消息历史中提取（如果客户端提供），否则生成新的
        const conversationId = this.extractMetadata(messages, 'conversationId') || uuidv4();
        const continuationId = this.extractMetadata(messages, 'continuationId');  // 可选
        const taskType = this.extractMetadata(messages, 'taskType');  // 可选
        const processedMessages = messages;

        if (processedMessages.length === 0) {
            throw new Error('No user messages found');
        }

        // 判断最后一条消息是否为 assistant,如果是则移除
        const lastMessage = processedMessages[processedMessages.length - 1];
        if (processedMessages.length > 0 && lastMessage.role === 'assistant') {
            if (lastMessage.content[0].type === "text" && lastMessage.content[0].text === "{") {
                logger.debug('Removing last assistant with "{" message from processedMessages');
                processedMessages.pop();
            }
        }

        // 合并相邻相同 role 的消息
        const mergedMessages = [];
        for (let i = 0; i < processedMessages.length; i++) {
            const currentMsg = processedMessages[i];
            
            if (mergedMessages.length === 0) {
                mergedMessages.push(currentMsg);
            } else {
                const lastMsg = mergedMessages[mergedMessages.length - 1];
                
                // 判断当前消息和上一条消息是否为相同 role
                if (currentMsg.role === lastMsg.role) {
                    // 合并消息内容
                    if (Array.isArray(lastMsg.content) && Array.isArray(currentMsg.content)) {
                        // 如果都是数组,合并数组内容
                        lastMsg.content.push(...currentMsg.content);
                    } else if (typeof lastMsg.content === 'string' && typeof currentMsg.content === 'string') {
                        // 如果都是字符串,用换行符连接
                        lastMsg.content += '\n' + currentMsg.content;
                    } else if (Array.isArray(lastMsg.content) && typeof currentMsg.content === 'string') {
                        // 上一条是数组,当前是字符串,添加为 text 类型
                        lastMsg.content.push({ type: 'text', text: currentMsg.content });
                    } else if (typeof lastMsg.content === 'string' && Array.isArray(currentMsg.content)) {
                        // 上一条是字符串,当前是数组,转换为数组格式
                        lastMsg.content = [{ type: 'text', text: lastMsg.content }, ...currentMsg.content];
                    }
                    if (this.verboseLogging) {
                        logger.info(`Merged adjacent ${currentMsg.role} messages`);
                    }
                } else {
                    mergedMessages.push(currentMsg);
                }
            }
        }
        
        // 用合并后的消息替换原消息数组
        processedMessages.length = 0;
        processedMessages.push(...mergedMessages);

        // AWS CodeWhisperer不支持的JSON Schema关键字（保守策略：只移除纯文档字段）
        // 参考官方Kiro的做法：保留所有可能有功能性的validation，只删除元数据和文档
        // 优化：保留更多关键字段以提升模型理解
        const UNSUPPORTED_SCHEMA_KEYS = new Set([
            // JSON Schema 元信息（纯元数据，无功能）
            '$schema', '$id', '$defs', 'definitions',
            // 文档字段（保留 title 和 default，它们对理解有帮助）
            'examples',  // 只移除 examples，保留 title 和 default
            // 组合逻辑（AWS不支持复杂schema组合）
            'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
            // 评估相关（AWS不支持）
            'additionalItems', 'unevaluatedItems', 'unevaluatedProperties',
            // 依赖相关（AWS不支持）
            'dependentSchemas', 'dependentRequired'
        ]);

        // 清理inputSchema - 只移除AWS CodeWhisperer明确不支持的元数据和文档字段
        // 保守策略：保留所有validation字段（minLength, maxLength, pattern, minimum, maximum等）
        // 仿照官方Kiro：不压缩description，保持schema的功能完整性
        const compressInputSchema = (schema) => {
            if (!schema || typeof schema !== 'object') return schema;

            // 处理数组
            if (Array.isArray(schema)) {
                return schema.map(item => compressInputSchema(item));
            }

            // 深拷贝并移除不支持的字段
            const compressed = {};

            for (const [key, value] of Object.entries(schema)) {
                // 跳过黑名单中的字段
                if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
                    continue;
                }

                // 处理需要递归的字段
                if (key === 'properties' && typeof value === 'object' && !Array.isArray(value)) {
                    compressed.properties = {};
                    for (const [propKey, propValue] of Object.entries(value)) {
                        compressed.properties[propKey] = compressInputSchema(propValue);
                    }
                } else if (key === 'items') {
                    compressed.items = compressInputSchema(value);
                } else if (key === 'additionalProperties' && typeof value === 'object') {
                    compressed.additionalProperties = compressInputSchema(value);
                } else {
                    // 保留所有其他字段（包括description、type、required、enum、validation字段等）
                    compressed[key] = value;
                }
            }

            return compressed;
        };

        // ⭐ 工具处理策略：AWS CodeWhisperer API 只支持 toolSpecification 格式
        //
        // ⚠️ 重要发现：AWS CodeWhisperer API 不支持 Anthropic 的 builtin tool 格式！
        // Anthropic API 的 builtin tools（如 { type: "bash_20250305", name: "bash" }）
        // 在 CodeWhisperer API 中是无效的，会导致 400 Bad Request 错误。
        //
        // CodeWhisperer 只接受 toolSpecification 格式：
        // { toolSpecification: { name: "...", description: "...", inputSchema: { json: {...} } } }
        //
        // 因此我们只做工具压缩（减少 description 长度），不做格式转换。

        // ⚠️ 关键修复：限制工具总大小以避免 CONTENT_LENGTH_EXCEEDS_THRESHOLD 错误
        const MAX_TOOL_COUNT = 25;  // 限制工具数量
        const DESCRIPTION_MAX_LENGTH = 500;  // 工具描述最大长度（减少以降低请求体大小）
        let toolsContext = {};

        // ⚠️ 内置工具（builtin tools）定义 - 用于过滤
        // 这些工具由 Anthropic 官方 API 或客户端本地处理，AWS CodeWhisperer 不支持
        // 完全匹配官方 Kiro 的 isBuiltinTool 逻辑 (extension.js:683316-683325)
        const builtinToolNames = ['web_search', 'bash', 'code_execution', 'computer', 'str_replace_editor', 'str_replace_based_edit_tool'];
        const isBuiltinTool = (tool) => {
            return tool && typeof tool === 'object' &&
                   'type' in tool && 'name' in tool &&
                   typeof tool.type === 'string' && typeof tool.name === 'string' &&
                   builtinToolNames.includes(tool.name);
        };

        // 获取工具名（兼容多种格式）
        const getToolName = (tool) => {
            if (tool.function?.name) return tool.function.name;
            if (tool.toolSpecification?.name) return tool.toolSpecification.name;
            if (tool.name) return tool.name;
            if (tool.id) return tool.id;
            return null;
        };

        // 检查工具是否应该被移除（使用 CC_TO_KIRO_TOOL_MAPPING）
        const shouldRemoveTool = (tool) => {
            const name = getToolName(tool);
            if (!name) return false;
            const mapping = CC_TO_KIRO_TOOL_MAPPING[name];
            if (mapping?.remove) {
                if (this.verboseLogging) {
                    logger.info(`Removing unsupported tool: ${name} (${mapping.reason || 'not supported'})`);
                }
                return true;
            }
            return false;
        };

        if (tools && Array.isArray(tools) && tools.length > 0) {
            // 第一步：过滤掉内置工具（AWS CodeWhisperer 不支持）
            let filteredTools = tools.filter(tool => {
                const isBuiltin = isBuiltinTool(tool);
                if (isBuiltin && this.verboseLogging) {
                    logger.info(`Filtering out builtin tool: ${tool.name} (not supported by AWS CodeWhisperer)`);
                }
                return !isBuiltin;
            });

            // 第二步：使用 CC_TO_KIRO_TOOL_MAPPING 过滤不支持的工具
            filteredTools = filteredTools.filter(tool => !shouldRemoveTool(tool));

            // 第三步：限制工具数量
            if (filteredTools.length > MAX_TOOL_COUNT) {
                logger.warn(`⚠️ Too many tools: ${filteredTools.length} > ${MAX_TOOL_COUNT}, keeping first ${MAX_TOOL_COUNT}`);
                filteredTools = filteredTools.slice(0, MAX_TOOL_COUNT);
            }

            // 转换所有工具为 toolSpecification 格式（使用映射表和压缩）
            if (filteredTools.length > 0) {
                toolsContext = {
                    tools: filteredTools.map(tool => this.convertToQToolWithMapping(tool, compressInputSchema, DESCRIPTION_MAX_LENGTH))
                };
                if (this.verboseLogging) {
                    logger.info(`Processed ${filteredTools.length} tools (original: ${tools.length})`);
                }            }
        }

        // ⚠️ 关键修复：收集保留的工具名称，用于过滤历史消息中的 tool_use 和 tool_result
        const keptToolNames = new Set();
        if (tools && Array.isArray(tools)) {
            // 收集裁剪后保留的工具名称
            const maxTools = Math.min(tools.length, MAX_TOOL_COUNT);
            for (let i = 0; i < maxTools; i++) {
                const tool = tools[i];
                const name = tool.name || (tool.function && tool.function.name);
                if (name) {
                    keptToolNames.add(name);
                }
            }
        }

        // 建立 toolUseId → toolName 的映射，用于过滤 tool_result
        const toolUseIdToName = new Map();
        for (const message of processedMessages) {
            if (message.role === 'assistant' && Array.isArray(message.content)) {
                for (const part of message.content) {
                    if (part.type === 'tool_use' && part.id && part.name) {
                        toolUseIdToName.set(part.id, part.name);
                    }
                }
            }
        }

        // 日志输出工具裁剪信息
        if (tools && tools.length > MAX_TOOL_COUNT) {
            logger.info(`Tool trimming info: kept ${keptToolNames.size} tools, mapped ${toolUseIdToName.size} toolUseIds`);
        }

        const history = [];
        let startIndex = 0;

        // Handle system prompt
        if (systemPrompt) {
            // If the first message is a user message, prepend system prompt to it
            if (processedMessages[0].role === 'user') {
                let firstUserContent = getContentText(processedMessages[0]);
                history.push({
                    userInputMessage: {
                        content: `${systemPrompt}\n\n${firstUserContent}`,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    }
                });
                startIndex = 1; // Start processing from the second message
            } else {
                // If the first message is not a user message, or if there's no initial user message,
                // add system prompt as a standalone user message.
                history.push({
                    userInputMessage: {
                        content: systemPrompt,
                        modelId: codewhispererModel,
                        origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR,
                    }
                });
            }
        }

        // 官方Kiro策略：不裁剪history，直接发送所有消息（除最后一条作为currentMessage）
        // history: serializedMessages.slice(0, -1)
        // Add remaining user/assistant messages to history
        for (let i = startIndex; i < processedMessages.length - 1; i++) {
            const message = processedMessages[i];
            if (message.role === 'user') {
                let userInputMessage = {
                    content: '',
                    modelId: codewhispererModel,
                    origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
                };
                let images = [];
                let toolResults = [];
                
                if (Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (part.type === 'text') {
                            userInputMessage.content += part.text;
                        } else if (part.type === 'tool_result') {
                            // ⚠️ 关键修复：过滤掉引用被裁剪工具的 tool_result
                            const toolName = toolUseIdToName.get(part.tool_use_id);
                            if (keptToolNames.size > 0 && toolName && !keptToolNames.has(toolName)) {
                                if (this.verboseLogging) {
                                    logger.info(`Filtering out tool_result for trimmed tool: ${toolName} (toolUseId: ${part.tool_use_id})`);
                                }
                                continue; // 跳过这个 tool_result
                            }

                            // 官方 Kiro 优化：截断过长的工具输出，防止 400 错误
                            let toolContent = getContentText(part.content);
                            if (toolContent.length > KIRO_CONSTANTS.MAX_TOOL_OUTPUT_LENGTH) {
                                const truncatedLength = KIRO_CONSTANTS.MAX_TOOL_OUTPUT_LENGTH;
                                toolContent = toolContent.substring(0, truncatedLength) +
                                    `\n\n[... truncated ${toolContent.length - truncatedLength} characters ...]`;
                            }
                            toolResults.push({
                                content: [{ text: toolContent }],
                                status: 'success',
                                toolUseId: part.tool_use_id
                            });
                        } else if (part.type === 'image') {
                            // Kiro 优化：智能图片格式检测
                            let format = 'jpeg';  // 默认
                            if (part.source?.media_type) {
                                // 优先使用 media_type
                                format = part.source.media_type.split('/')[1];
                            } else if (part.source?.data || part.image_url?.url) {
                                // 降级到自动检测
                                format = detectImageFormat(part.source?.data || part.image_url?.url);
                            }

                            images.push({
                                format: format,
                                source: {
                                    bytes: part.source.data
                                }
                            });
                        }
                    }
                } else {
                    userInputMessage.content = getContentText(message);
                }
                
                // 只添加非空字段，API 不接受空数组或空对象
                if (images.length > 0) {
                    userInputMessage.images = images;
                }
                if (toolResults.length > 0) {
                    // 去重 toolResults - Kiro API 不接受重复的 toolUseId
                    const uniqueToolResults = [];
                    const seenIds = new Set();
                    for (const tr of toolResults) {
                        if (!seenIds.has(tr.toolUseId)) {
                            seenIds.add(tr.toolUseId);
                            uniqueToolResults.push(tr);
                        }
                    }
                    userInputMessage.userInputMessageContext = { toolResults: uniqueToolResults };
                }

                // 修复：Kiro API 不接受空 content，当只有 toolResults 时添加默认文本
                if (!userInputMessage.content || userInputMessage.content.trim() === '') {
                    userInputMessage.content = toolResults.length > 0 ? 'Tool results provided.' : 'Continue';
                }

                history.push({ userInputMessage });
            } else if (message.role === 'assistant') {
                let assistantResponseMessage = {
                    content: ''
                };
                let toolUses = [];
                
                if (Array.isArray(message.content)) {
                    for (const part of message.content) {
                        if (part.type === 'text') {
                            assistantResponseMessage.content += part.text;
                        } else if (part.type === 'tool_use') {
                            // ⚠️ 关键修复：过滤掉被裁剪的工具
                            if (keptToolNames.size > 0 && !keptToolNames.has(part.name)) {
                                if (this.verboseLogging) {
                                    logger.info(`Filtering out tool_use for trimmed tool: ${part.name}`);
                                }
                                continue; // 跳过这个 tool_use
                            }

                            // 应用参数映射（CC → Kiro）
                            const mappedInput = this.mapToolUseParams(part.name, part.input);
                            toolUses.push({
                                input: mappedInput,
                                name: part.name,
                                toolUseId: part.id
                            });
                        } else if (part.type === 'thinking') {
                            // 将thinking内容添加到文本中，避免signature缺失导致的400错误
                            const thinkingText = part.thinking || '';
                            if (thinkingText) {
                                assistantResponseMessage.content += `<thinking>\n${thinkingText}\n</thinking>\n`;
                            }
                        }
                    }
                } else {
                    assistantResponseMessage.content = getContentText(message);
                }
                
                // 只添加非空字段
                if (toolUses.length > 0) {
                    assistantResponseMessage.toolUses = toolUses;
                }

                // ⚠️ 关键修复：Kiro API 不接受空 content，当只有 toolUses 时添加默认文本
                if (!assistantResponseMessage.content || assistantResponseMessage.content.trim() === '') {
                    assistantResponseMessage.content = toolUses.length > 0 ? 'Calling tools...' : '...';
                }

                history.push({ assistantResponseMessage });
            }
        }

        // Build current message
        let currentMessage = processedMessages[processedMessages.length - 1];
        let currentContent = '';
        let currentToolResults = [];
        let currentToolUses = [];
        let currentImages = [];

        // 如果最后一条消息是 assistant，需要将其加入 history，然后创建一个 user 类型的 currentMessage
        // 因为 CodeWhisperer API 的 currentMessage 必须是 userInputMessage 类型
        if (currentMessage.role === 'assistant') {
            logger.info('Last message is assistant, moving it to history and creating user currentMessage');
            
            // 构建 assistant 消息并加入 history
            let assistantResponseMessage = {
                content: '',
                toolUses: []
            };
            if (Array.isArray(currentMessage.content)) {
                for (const part of currentMessage.content) {
                    if (part.type === 'text') {
                        assistantResponseMessage.content += part.text;
                    } else if (part.type === 'tool_use') {
                        // ⚠️ 关键修复：过滤掉被裁剪的工具
                        if (keptToolNames.size > 0 && !keptToolNames.has(part.name)) {
                            if (this.verboseLogging) {
                                logger.info(`Filtering out tool_use for trimmed tool: ${part.name}`);
                            }
                            continue;
                        }
                        // 应用参数映射（CC → Kiro）
                        const mappedInput = this.mapToolUseParams(part.name, part.input);
                        assistantResponseMessage.toolUses.push({
                            input: mappedInput,
                            name: part.name,
                            toolUseId: part.id
                        });
                    } else if (part.type === 'thinking') {
                        // 将thinking内容添加到文本中，避免signature缺失导致的400错误
                        const thinkingText = part.thinking || '';
                        if (thinkingText) {
                            assistantResponseMessage.content += `<thinking>\n${thinkingText}\n</thinking>\n`;
                        }
                    }
                }
            } else {
                assistantResponseMessage.content = getContentText(currentMessage);
            }
            if (assistantResponseMessage.toolUses.length === 0) {
                delete assistantResponseMessage.toolUses;
            }
            // ⚠️ 关键修复：Kiro API 不接受空 content
            if (!assistantResponseMessage.content || assistantResponseMessage.content.trim() === '') {
                assistantResponseMessage.content = assistantResponseMessage.toolUses ? 'Calling tools...' : '...';
            }
            history.push({ assistantResponseMessage });
            
            // 设置 currentContent 为 "Continue"，因为我们需要一个 user 消息来触发 AI 继续
            currentContent = 'Continue';
        } else {
            // 处理 user 消息
            if (Array.isArray(currentMessage.content)) {
                for (const part of currentMessage.content) {
                    if (part.type === 'text') {
                        currentContent += part.text;
                    } else if (part.type === 'tool_result') {
                        // ⚠️ 关键修复：过滤掉引用被裁剪工具的 tool_result
                        const toolName = toolUseIdToName.get(part.tool_use_id);
                        if (keptToolNames.size > 0 && toolName && !keptToolNames.has(toolName)) {
                            if (this.verboseLogging) {
                                logger.info(`Filtering out tool_result for trimmed tool: ${toolName} (toolUseId: ${part.tool_use_id})`);
                            }
                            continue;
                        }

                        // 官方 Kiro 优化：截断过长的工具输出，防止 400 错误
                        let toolContent = getContentText(part.content);
                        if (toolContent.length > KIRO_CONSTANTS.MAX_TOOL_OUTPUT_LENGTH) {
                            const truncatedLength = KIRO_CONSTANTS.MAX_TOOL_OUTPUT_LENGTH;
                            toolContent = toolContent.substring(0, truncatedLength) +
                                `\n\n[... truncated ${toolContent.length - truncatedLength} characters ...]`;
                        }
                        currentToolResults.push({
                            content: [{ text: toolContent }],
                            status: 'success',
                            toolUseId: part.tool_use_id
                        });
                    } else if (part.type === 'tool_use') {
                        // ⚠️ 关键修复：过滤掉被裁剪的工具
                        if (keptToolNames.size > 0 && !keptToolNames.has(part.name)) {
                            if (this.verboseLogging) {
                                logger.info(`Filtering out tool_use for trimmed tool: ${part.name}`);
                            }
                            continue;
                        }
                        // 应用参数映射（CC → Kiro）
                        const mappedInput = this.mapToolUseParams(part.name, part.input);
                        currentToolUses.push({
                            input: mappedInput,
                            name: part.name,
                            toolUseId: part.id
                        });
                    } else if (part.type === 'image') {
                        // Kiro 优化：智能图片格式检测
                        let format = 'jpeg';  // 默认
                        if (part.source?.media_type) {
                            // 优先使用 media_type
                            format = part.source.media_type.split('/')[1];
                        } else if (part.source?.data || part.image_url?.url) {
                            // 降级到自动检测
                            format = detectImageFormat(part.source?.data || part.image_url?.url);
                        }

                        currentImages.push({
                            format: format,
                            source: {
                                bytes: part.source.data
                            }
                        });
                    }
                }
            } else {
                currentContent = getContentText(currentMessage);
            }

            // Kiro API 要求 content 不能为空，即使有 toolResults
            if (!currentContent) {
                currentContent = currentToolResults.length > 0 ? 'Tool results provided.' : 'Continue';
            }

            // ⚠️ 关键修复：限制 currentContent 长度，防止 400 错误
            // 之前只裁剪了 history，但 currentMessage 没有被裁剪
            const MAX_CURRENT_CONTENT_LENGTH = 32000;  // 32KB 限制
            if (currentContent.length > MAX_CURRENT_CONTENT_LENGTH) {
                logger.info(`⚠️ currentContent too long (${currentContent.length} chars), truncating to ${MAX_CURRENT_CONTENT_LENGTH}`);

                // 智能截断：移除 <system-reminder> 块以保留更多有用内容
                let truncatedContent = currentContent;

                // 先尝试移除 system-reminder 块
                const systemReminderPattern = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
                truncatedContent = truncatedContent.replace(systemReminderPattern, '[system-reminder removed for context limit]');

                // 如果还是太长，从中间截断，保留开头和结尾
                if (truncatedContent.length > MAX_CURRENT_CONTENT_LENGTH) {
                    const keepStart = Math.floor(MAX_CURRENT_CONTENT_LENGTH * 0.7);  // 保留 70% 开头
                    const keepEnd = MAX_CURRENT_CONTENT_LENGTH - keepStart - 100;     // 剩余给结尾
                    truncatedContent = truncatedContent.substring(0, keepStart) +
                        '\n\n[... content truncated for API limit ...]\n\n' +
                        truncatedContent.substring(truncatedContent.length - keepEnd);
                }

                currentContent = truncatedContent;
                logger.info(`currentContent truncated to ${currentContent.length} chars`);
            }
        }

        const request = {
            conversationState: {
                chatTriggerType: KIRO_CONSTANTS.CHAT_TRIGGER_TYPE_MANUAL,
                conversationId: conversationId,
                currentMessage: {} // Will be populated as userInputMessage
            }
        };

        // Kiro 优化：添加 agentContinuationId（多轮对话优化）
        if (continuationId) {
            request.conversationState.agentContinuationId = continuationId;
            logger.info('Using continuationId for multi-turn optimization:', continuationId);
        }

        // Kiro 优化：添加 agentTaskType（任务类型优化）
        if (taskType) {
            request.conversationState.agentTaskType = taskType;
            logger.info('Using taskType:', taskType);
        }

        // 只有当 history 非空时才添加（API 可能不接受空数组）
        if (history.length > 0) {
            request.conversationState.history = history;
        }

        // currentMessage 始终是 userInputMessage 类型
        // 注意：API 不接受 null 值，空字段应该完全不包含
        const userInputMessage = {
            content: currentContent,
            modelId: codewhispererModel,
            origin: KIRO_CONSTANTS.ORIGIN_AI_EDITOR
        };

        // 只有当 images 非空时才添加
        if (currentImages && currentImages.length > 0) {
            userInputMessage.images = currentImages;
        }

        // 构建 userInputMessageContext，只包含非空字段
        const userInputMessageContext = {};
        if (currentToolResults.length > 0) {
            // 去重 toolResults - Kiro API 不接受重复的 toolUseId
            const uniqueToolResults = [];
            const seenToolUseIds = new Set();
            for (const tr of currentToolResults) {
                if (!seenToolUseIds.has(tr.toolUseId)) {
                    seenToolUseIds.add(tr.toolUseId);
                    uniqueToolResults.push(tr);
                }
            }
            userInputMessageContext.toolResults = uniqueToolResults;
        }
        // 官方Kiro客户端模式：发送压缩后的tools定义
        if (Object.keys(toolsContext).length > 0 && toolsContext.tools) {
            userInputMessageContext.tools = toolsContext.tools;
        }

        // ⭐ Kiro 优化：补充上下文（supplementalContext）
        // 从最后一条消息的 additional_kwargs 中提取工作区上下文
        const supplementalContext = this.extractSupplementalContext(currentMessage);
        if (supplementalContext && supplementalContext.length > 0) {
            userInputMessageContext.supplementalContexts = supplementalContext;
        }

        // 只有当 userInputMessageContext 有内容时才添加
        if (Object.keys(userInputMessageContext).length > 0) {
            userInputMessage.userInputMessageContext = userInputMessageContext;
        }

        request.conversationState.currentMessage.userInputMessage = userInputMessage;

        if (this.authMethod === KIRO_CONSTANTS.AUTH_METHOD_SOCIAL) {
            request.profileArn = this.profileArn;
        }

        // ⚠️ 关键修复：清理消息历史，确保符合 Kiro API 规则
        // 官方 Kiro 扩展的 message-history-sanitizer 会验证并修复消息
        sanitizeMessageHistory(history, currentToolResults);

        // 性能优化：移除每次请求都执行的 JSON.stringify 调试日志
        // 这些操作对大请求来说非常慢，会显著增加首字响应时间
        // 如需调试，可临时取消注释以下代码块
        /*
        const requestJson = JSON.stringify(request);
        const requestSizeKB = (requestJson.length / 1024).toFixed(2);
        logger.info(`Request size: ${requestSizeKB} KB`);
        if (request.conversationState) {
            const historySize = JSON.stringify(request.conversationState.history || []).length;
            logger.info(`- History: ${(historySize / 1024).toFixed(2)} KB`);
        }
        */

        // ⚠️ 性能计时：buildCodewhispererRequest 总耗时
        const buildDuration = Date.now() - buildStartTime;
        if (buildDuration > 100) {
            logger.info(`Perf: buildCodewhispererRequest total: ${buildDuration}ms (messages: ${messages.length})`);
        }

        return request;
    }

    /**
     * 清理消息历史，确保符合 Kiro API 规则
     * 规则来自官方 Kiro 扩展的 message-history-sanitizer
     * 不仅验证，还会自动修复问题
     *
     * @param {Array} history - 消息历史（会被原地修改）
     * @param {Array} currentToolResults - 当前消息的 toolResults
     */
    

    /**
     * List available models
     */
    async listModels() {
        const models = KIRO_MODELS.map(id => ({
            name: id
        }));
        
        return { models: models };
    }

    /**
     * Checks if the given expiresAt timestamp is within 10 minutes from now.
     * @returns {boolean} - True if expiresAt is less than 10 minutes from now, false otherwise.
     */
    isExpiryDateNear() {
        try {
            const expirationTime = new Date(this.expiresAt);
            const currentTime = new Date();
            const cronNearMinutesInMillis = (this.config.CRON_NEAR_MINUTES || 10) * 60 * 1000;
            const thresholdTime = new Date(currentTime.getTime() + cronNearMinutesInMillis);
            if (this.verboseLogging) {
                logger.info(`Expiry date: ${expirationTime.getTime()}, Current time: ${currentTime.getTime()}, ${this.config.CRON_NEAR_MINUTES || 10} minutes from now: ${thresholdTime.getTime()}`);
            }
            return expirationTime.getTime() <= thresholdTime.getTime();
        } catch (error) {
            logger.error(`Error checking expiry date: ${this.expiresAt}, Error: ${error.message}`);
            return false; // Treat as expired if parsing fails
        }
    }

}
