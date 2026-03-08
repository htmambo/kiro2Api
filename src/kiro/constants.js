/**
 * Kiro API 常量定义模块
 *
 * 包含所有 Kiro API 相关的常量配置。
 *
 * @module kiro/constants
 */

import { DEFAULT_SUMMARIZATION_MODEL } from './model-config.js';

/**
 * Kiro IDE 版本号（用于 User-Agent 等）
 *
 * @type {string}
 */
export const KIRO_IDE_VERSION = '0.7.45';

/**
 * 默认账号类型
 *
 * @type {string}
 */
export const DEFAULT_PROVIDER_TYPE = 'claude-kiro-oauth';

/**
 * Kiro 常量集合
 *
 * @type {Object}
 */
export const KIRO_CONSTANTS = {
  REFRESH_URL: "https://prod.{{region}}.auth.desktop.kiro.dev/refreshToken",
  REFRESH_IDC_URL: "https://oidc.{{region}}.amazonaws.com/token",
  DEVICE_AUTH_URL: "https://oidc.{{region}}.amazonaws.com/device_authorization",
  REGISTER_CLIENT_URL: "https://oidc.{{region}}.amazonaws.com/client/register",
  BASE_URL:
    "https://codewhisperer.{{region}}.amazonaws.com/generateAssistantResponse",
  AMAZON_Q_URL:
    "https://codewhisperer.{{region}}.amazonaws.com/SendMessageStreaming",
  USAGE_LIMITS_URL: "https://q.{{region}}.amazonaws.com/getUsageLimits",
  DEFAULT_BACKEND_MODEL_NAME: "claude-sonnet-4-20250514",
  AXIOS_TIMEOUT: 120000,
  REQUEST_TIMEOUT_MS: 120000, // 普通请求超时（120秒）
  STREAM_TIMEOUT_MS: 180000, // 流式请求超时（180秒）
  SEARCH_TIMEOUT_MS: 10000, // 搜索请求超时（10秒）
  // 新增：可配置的超时常量（与 config.js 中的配置项对应）
  TIMEOUT_API_REQUEST: 120000, // API 请求超时（120秒）
  TIMEOUT_STREAM_REQUEST: 300000, // 流式请求超时（300秒）
  TIMEOUT_AUTH_REQUEST: 30000, // 认证请求超时（30秒）
  USER_AGENT: "KiroIDE",
  KIRO_VERSION: KIRO_IDE_VERSION, // 从 constants.js 导入
  CONTENT_TYPE_JSON: "application/json",
  ACCEPT_JSON: "application/json",
  AUTH_METHOD_SOCIAL: "social",
  AUTH_METHOD_IDC: "IdC",
  CHAT_TRIGGER_TYPE_MANUAL: "MANUAL",
  ORIGIN_AI_EDITOR: "AI_EDITOR",
  EXPIRE_WINDOW_MS: 5 * 60 * 1000,
  REFRESH_DEBOUNCE_MS: 30 * 1000,
  DEVICE_GRANT_TYPE: "urn:ietf:params:oauth:grant-type:device_code",
  // Kiro 风格的上下文窗口管理配置
  // 测试结果: AWS 实际限制约 223K tokens (720K chars 失败，710K chars 成功)
  MAX_CONTEXT_TOKENS: 200000, // 200K（AWS 限制 ~223K，留缓冲）
  AUTO_SUMMARIZE_THRESHOLD: 0.8, // 80% = 160K 时开始 pruning
  CONTEXT_FILE_LIMIT: 0.75, // 上下文文件限制为 75% 窗口（和 Kiro 一致）
  MIN_MESSAGES_TO_KEEP: 5, // 摘要时保留最近的消息数量
  SUMMARIZATION_MODEL: DEFAULT_SUMMARIZATION_MODEL, // 用于生成摘要的模型（更快更便宜）

  // 官方 Kiro 输出限制（extension.js:766436）- 防止 tool_result 内容过长导致 400 错误
  MAX_TOOL_OUTPUT_LENGTH: 64000, // 64K 字符，和官方 Kiro 一致

  // ============================================================================
  // 自适应超时配置（借鉴 KiroGate）
  // ============================================================================
  SLOW_MODELS: ["claude-opus-4-5", "claude-3-opus", "opus"], // 慢模型列表
  SLOW_MODEL_TIMEOUT_MULTIPLIER: 3.0, // 慢模型超时倍数
  FIRST_TOKEN_TIMEOUT: 120000, // 首字超时 120 秒
  FIRST_TOKEN_MAX_RETRIES: 3, // 首字超时最大重试次数
  STREAM_READ_TIMEOUT: 300000, // 流读取超时 300 秒

  // ============================================================================
  // 长文档分段配置（借鉴 KiroGate）
  // ============================================================================
  AUTO_CHUNKING_ENABLED: true, // 是否启用自动分段
  AUTO_CHUNK_THRESHOLD: 150000, // 触发分段的字符数阈值（150K）
  CHUNK_MAX_CHARS: 100000, // 每个分段最大字符数（100K）
  CHUNK_OVERLAP_CHARS: 2000, // 分段重叠字符数
};
