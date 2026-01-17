/**
 * Schema 清理器
 *
 * 提供可配置的 JSON Schema 清理功能，支持不同 Provider 的策略。
 *
 * @module utils/schema-cleaner
 */

/**
 * 清理策略枚举
 */
export const SCHEMA_CLEANER_STRATEGY = {
    /**
     * Gemini API 策略
     *
     * Gemini 只支持有限的 JSON Schema 属性，不支持：
     * - exclusiveMinimum, exclusiveMaximum, minimum, maximum
     * - minLength, maxLength, minItems, maxItems
     * - pattern, format, default, const
     * - additionalProperties, $schema, $ref, $id
     * - allOf, anyOf, oneOf, not
     */
    GEMINI: 'gemini',

    /**
     * AWS CodeWhisperer API 策略
     *
     * AWS CodeWhisperer 不支持：
     * - JSON Schema 元信息（$schema, $id, $defs, definitions）
     * - 文档字段（examples）
     * - 组合逻辑（allOf, anyOf, oneOf, not, if, then, else）
     * - 评估相关（additionalItems, unevaluatedItems, unevaluatedProperties）
     * - 依赖相关（dependentSchemas, dependentRequired）
     *
     * 保留所有可能有功能性的 validation 字段（minLength, maxLength, pattern, minimum, maximum等）
     */
    AWS_CODEWHISPERER: 'aws-codewhisperer'
};

/**
 * Gemini 策略的允许字段列表
 */
const GEMINI_ALLOWED_KEYS = [
    "type",
    "description",
    "properties",
    "required",
    "enum",
    "items",
    "nullable"
];

/**
 * AWS CodeWhisperer 策略的不支持字段列表
 */
const AWS_CODEWHISPERER_UNSUPPORTED_KEYS = new Set([
    // JSON Schema 元信息（纯元数据，无功能）
    '$schema', '$id', '$defs', 'definitions',
    // 文档字段（保留 title 和 default，它们对理解有帮助）
    'examples',
    // 组合逻辑（AWS不支持复杂schema组合）
    'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
    // 评估相关（AWS不支持）
    'additionalItems', 'unevaluatedItems', 'unevaluatedProperties',
    // 依赖相关（AWS不支持）
    'dependentSchemas', 'dependentRequired'
]);

/**
 * 清理 JSON Schema（可配置策略）
 *
 * @param {Object} schema - 原始 schema
 * @param {string} [strategy=SCHEMA_CLEANER_STRATEGY.AWS_CODEWHISPERER] - 清理策略
 * @returns {Object} 清理后的 schema
 */
export function cleanSchema(schema, strategy = SCHEMA_CLEANER_STRATEGY.AWS_CODEWHISPERER) {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }

    // 处理数组
    if (Array.isArray(schema)) {
        return schema.map(item => cleanSchema(item, strategy));
    }

    // 根据策略选择清理方式
    switch (strategy) {
        case SCHEMA_CLEANER_STRATEGY.GEMINI:
            return _cleanForGemini(schema);
        case SCHEMA_CLEANER_STRATEGY.AWS_CODEWHISPERER:
            return _cleanForAWSCodeWhisperer(schema);
        default:
            throw new Error(`Unknown schema cleaner strategy: ${strategy}`);
    }
}

/**
 * 为 Gemini API 清理 Schema
 *
 * @private
 * @param {Object} schema - 原始 schema
 * @returns {Object} 清理后的 schema
 */
function _cleanForGemini(schema) {
    const sanitized = {};

    for (const [key, value] of Object.entries(schema)) {
        // 只保留允许的字段
        if (!GEMINI_ALLOWED_KEYS.includes(key)) {
            continue;
        }

        // 对于需要递归处理的属性
        if (key === 'properties' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
            sanitized.properties = {};
            for (const [propName, propSchema] of Object.entries(value)) {
                sanitized.properties[propName] = _cleanForGemini(propSchema);
            }
        } else if (key === 'items') {
            sanitized.items = _cleanForGemini(value);
        } else if (key === 'additionalProperties' && typeof value === 'object') {
            sanitized.additionalProperties = _cleanForGemini(value);
        } else {
            // 保留其他字段（如 description, type, required, enum）
            sanitized[key] = value;
        }
    }

    return sanitized;
}

/**
 * 为 AWS CodeWhisperer 清理 Schema
 *
 * @private
 * @param {Object} schema - 原始 schema
 * @returns {Object} 清理后的 schema
 */
function _cleanForAWSCodeWhisperer(schema) {
    const sanitized = {};

    for (const [key, value] of Object.entries(schema)) {
        // 跳过黑名单中的字段
        if (AWS_CODEWHISPERER_UNSUPPORTED_KEYS.has(key)) {
            continue;
        }

        // 处理需要递归的字段
        if (key === 'properties' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
            sanitized.properties = {};
            for (const [propName, propSchema] of Object.entries(value)) {
                sanitized.properties[propName] = _cleanForAWSCodeWhisperer(propSchema);
            }
        } else if (key === 'items') {
            sanitized.items = _cleanForAWSCodeWhisperer(value);
        } else if (key === 'additionalProperties' && typeof value === 'object') {
            sanitized.additionalProperties = _cleanForAWSCodeWhisperer(value);
        } else {
            // 保留所有其他字段（包括description、type、required、enum、validation字段等）
            sanitized[key] = value;
        }
    }

    return sanitized;
}
