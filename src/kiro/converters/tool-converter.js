/**
 * 统一的工具格式转换器模块
 *
 * 提供：
 * - convertToQTool(): 将多种工具格式统一转换为 AWS CodeWhisperer toolSpecification 格式
 * - convertToQToolWithMapping(): 使用映射表优先转换工具
 * - compressInputSchema(): 压缩 schema 以兼容 AWS CodeWhisperer
 *
 * 支持的工具格式：
 * - 格式 0: Kiro 内置工具（Builtin Tools）- { type, name, ... }
 * - 格式 1: OpenAI 风格 - { function: { name, description, parameters } }
 * - 格式 2: Kiro 原生格式 - { toolSpecification: { ... } }
 * - 格式 3: Anthropic/Claude 格式 - { name, description, input_schema }
 * - 格式 4: 带 id 和 parameters - { id, description, parameters }
 * - 格式 5: 带 id 和 schema - { id, description, schema }
 *
 * 依赖：
 * - ../tools.js: CC_TO_KIRO_TOOL_MAPPING, normalizeToolName, isZodSchema
 * - ../lib/logger.js: createLogger
 *
 * @module kiro/converters/tool-converter
 */

import { CC_TO_KIRO_TOOL_MAPPING, normalizeToolName } from '../tools.js';
import { isZodSchema } from '../utils.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('kiro:tool-converter');

/**
 * AWS CodeWhisperer 不支持的 JSON Schema 字段
 *
 * 参考官方Kiro的做法：保留所有可能有功能性的validation，只删除元数据和文档
 * 优化：保留更多关键字段以提升模型理解
 */
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

/**
 * 清理 inputSchema - 只移除 AWS CodeWhisperer 明确不支持的元数据和文档字段
 *
 * 保守策略：保留所有 validation 字段（minLength, maxLength, pattern, minimum, maximum等）
 * 仿照官方 Kiro：不压缩 description，保持 schema 的功能完整性。
 *
 * @param {Object} schema - 原始 schema
 * @returns {Object} 压缩后的 schema
 */
export function compressInputSchema(schema) {
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
}

/**
 * Kiro 内置工具列表
 * 参考 Kiro 源码 extension.js:683316-683326
 */
const BUILTIN_TOOLS = [
    'web_search',
    'bash',
    'code_execution',
    'computer',
    'str_replace_editor',
    'str_replace_based_edit_tool'
];

/**
 * 将多种工具格式统一转换为 AWS CodeWhisperer toolSpecification 格式
 *
 * ⚠️ 重要：AWS CodeWhisperer API 只接受 toolSpecification 格式！
 * Anthropic 的 builtin tool 格式（如 { type: "bash_20250305", name: "bash" }）
 * 在 CodeWhisperer API 中会导致 400 Bad Request 错误。
 *
 * @param {Object} tool - 工具定义（多种格式之一）
 * @param {Function} [compressInputSchemaFn=compressInputSchema] - schema 压缩函数
 * @param {number} [maxDescLength=500] - 描述最大长度
 * @returns {Object} toolSpecification 格式的工具定义
 */
export function convertToQTool(tool, compressInputSchemaFn = compressInputSchema, maxDescLength = 500) {
    // 格式 0：Kiro 内置工具（Builtin Tools）- 直接传递，不转换
    // 参考 Kiro 源码 extension.js:683316-683326
    // 格式：{ type: "web_search_20250305", name: "web_search", max_uses: 8, ... }
    // ⚠️ 严格按照 Kiro 官方支持的 6 个工具，不添加额外工具
    // ⚠️ 警告：内置工具格式会导致 AWS CodeWhisperer API 400 错误，应在调用前过滤
    if (typeof tool === 'object' && tool !== null &&
        'type' in tool && 'name' in tool &&
        typeof tool.type === 'string' && typeof tool.name === 'string' &&
        BUILTIN_TOOLS.includes(tool.name)) {
        logger.warn(`⚠️ Builtin tool detected (${tool.name}): This format is not supported by AWS CodeWhisperer API and will cause 400 Bad Request. Please filter builtin tools before calling this function.`);
        logger.error(`Detected builtin tool: ${tool.name}, passing through without conversion`);
        return tool;  // 内置工具原样传递
    }

    // 格式 1：OpenAI 风格 { function: { name, description, parameters } }
    if (tool.function && typeof tool.function === 'object') {
        const schema = compressInputSchemaFn(tool.function.parameters || {});
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

        schema = compressInputSchemaFn(schema);
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

        schema = compressInputSchemaFn(schema);
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

        schema = compressInputSchemaFn(schema);
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
 * 使用映射表优先转换工具
 *
 * Kiro 优化：使用映射表转换工具，优先使用 CC_TO_KIRO_TOOL_MAPPING 中的 Kiro 官方 schema。
 * 如果没有映射，则降级到原始的 convertToQTool。
 *
 * @param {Object} tool - 工具定义
 * @param {Function} [compressInputSchemaFn=compressInputSchema] - schema 压缩函数
 * @param {number} [maxDescLength=500] - 描述最大长度
 * @returns {Object} toolSpecification 格式的工具定义
 */
export function convertToQToolWithMapping(tool, compressInputSchemaFn = compressInputSchema, maxDescLength = 500) {
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

    const normalizedToolName = normalizeToolName(toolName);
    // 检查是否有映射
    const mapping = CC_TO_KIRO_TOOL_MAPPING[normalizedToolName];

    if (mapping && mapping.kiroTool) {
        // ⚠️ 关键修复：使用 CC 原始的 schema，不要用 Kiro 的 schema
        // 因为 CC 会根据返回的 schema 验证参数，如果使用 Kiro schema，
        // CC 会收到它不认识的参数（如 explanation, path），导致验证失败
        // 参数映射只在 mapToolUseParams 中进行（发送给 Kiro 时）

        // 压缩原始 schema
        const compressedSchema = originalSchema ? compressInputSchemaFn(originalSchema) : { type: 'object', properties: {} };

        const desc = mapping.description || originalDesc || '';
        const truncatedDesc = desc.length > maxDescLength
            ? desc.substring(0, maxDescLength).trim() + '...'
            : desc;

        // logger.error(`Mapped tool: ${toolName} → ${mapping.kiroTool} (keeping original CC toolName)`);

        return {
            toolSpecification: {
                name: toolName,  // ⚠️ 保留原始 CC 工具名，参数映射在 mapToolUseParams 中进行
                description: truncatedDesc,
                inputSchema: { json: compressedSchema }
            }
        };
    }

    // 没有映射，使用原始的 convertToQTool 逻辑
    return convertToQTool(tool, compressInputSchemaFn, maxDescLength);
}
