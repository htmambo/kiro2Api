/**
 * Kiro 模型配置模块
 *
 * 统一维护：
 * - `MODEL_MAPPING`: 更完整的模型别名到 AWS CodeWhisperer 模型 ID 的映射表
 * - 各类默认模型与请求模型归一化规则
 *
 * @module kiro/model-config
 */

/**
 * 对外请求默认模型
 *
 * 用于：
 * - 请求未指定模型时的回退
 * - 请求传入了当前不支持的模型时的兜底
 *
 * 注意：这与 `KIRO_CONSTANTS.DEFAULT_BACKEND_MODEL_NAME` 不同。
 * `KIRO_CONSTANTS.DEFAULT_BACKEND_MODEL_NAME` 更偏向底层 Kiro 服务默认值；
 * 这里表示当前对外 API 的公开默认模型。
 *
 * @type {string}
 */
export const DEFAULT_PUBLIC_MODEL = 'claude-sonnet-4-5';

/**
 * 内部摘要流程默认模型
 *
 * 用于：
 * - 上下文压缩/摘要请求
 * - 需要稳定、较快、成本更低的内部辅助生成场景
 *
 * 与 `DEFAULT_PUBLIC_MODEL` 的区别：
 * - `DEFAULT_PUBLIC_MODEL` 面向外部请求默认值
 * - 这里面向内部摘要任务默认值
 *
 * @type {string}
 */
export const DEFAULT_SUMMARIZATION_MODEL = 'claude-haiku-4-5';

/**
 * 完整模型映射表
 *
 * 用于把 Anthropic/历史别名模型名映射为 AWS CodeWhisperer 实际接受的模型 ID。
 * 这里故意保留一些未对外暴露的历史别名，便于兼容历史调用与后续扩展。
 *
 * @type {Readonly<Record<string, string>>}
 */
export const MODEL_MAPPING = Object.freeze({
  "claude-opus-4-5": "claude-opus-4.5",
  "claude-opus-4-5-20251101": "claude-opus-4.5",

  "claude-haiku-4-5": "claude-haiku-4.5",

  "claude-sonnet-4-5": "CLAUDE_SONNET_4_5_20250929_V1_0",
  "claude-sonnet-4-5-20250929": "CLAUDE_SONNET_4_5_20250929_V1_0",
});

/**
 * 判断某个模型是否在当前 Kiro 白名单中
 *
 * @param {string | undefined | null} modelName - 待检查模型名
 * @returns {boolean} 是否受支持
 */
export function isSupportedKiroModel(modelName) {
    return typeof modelName === 'string' &&  MODEL_MAPPING.hasOwnProperty(modelName);
}

/**
 * 解析外部请求中的模型名
 *
 * 规则：
 * 1. 先应用历史别名映射
 * 2. 如果归一化后的模型不在 `MODEL_MAPPING` 中，则回退到 `DEFAULT_PUBLIC_MODEL`
 *
 * @param {string | undefined | null} requestedModel - 外部请求传入的模型名
 * @returns {string} 归一化后的可用模型名
 */
export function resolveRequestModel(requestedModel) {
    if (isSupportedKiroModel(requestedModel)) {
      return requestedModel;
    }

    return DEFAULT_PUBLIC_MODEL;
}

/**
 * 兼容旧命名：保留原导出，避免调用方升级时产生不必要改动。
 *
 * @param {string | undefined | null} requestedModel - 外部请求传入的模型名
 * @returns {string} 归一化后的可用模型名
 */
export const normalizeRequestedModel = resolveRequestModel;
