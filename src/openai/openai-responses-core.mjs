/**
 * OpenAI Responses 流式事件生成与状态管理模块
 *
 * 负责生成符合 OpenAI API 规范的流式响应事件，
 * 并集中管理每个请求在流式过程中的状态与文本拼接。
 *
 * @module openai-responses-core
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * 流式处理状态管理器
 *
 * 用于保存每个请求的响应 ID、消息 ID、累计文本、序列号等信息，
 * 以便在多次事件输出中保持一致性。
 */
class StreamState {
  /**
   * 创建状态管理器实例
   */
  constructor() {
    this.states = new Map(); // 使用Map存储不同请求的状态
  }

  /**
   * 获取或创建指定请求的状态
   *
   * @param {string} requestId - 请求唯一标识
   * @returns {Object} 对应请求的状态对象
   */
  getOrCreateState(requestId) {
    if (!this.states.has(requestId)) {
      this.states.set(requestId, {
        id: `resp_${uuidv4().replace(/-/g, '')}`,
        msgId: `msg_${uuidv4().replace(/-/g, '')}`,
        fullText: '',
        sequenceNumber: 0,
        model: null,
        status: 'in_progress',
        startTime: Math.floor(Date.now() / 1000)
      });
    }
    return this.states.get(requestId);
  }

  /**
   * 追加输出文本并更新序列号
   *
   * @param {string} requestId - 请求唯一标识
   * @param {string} textDelta - 新增文本片段
   * @returns {Object} 更新后的状态对象
   */
  updateText(requestId, textDelta) {
    const state = this.getOrCreateState(requestId);
    state.fullText += textDelta;
    state.sequenceNumber += 1;
    return state;
  }

  /**
   * 设置当前请求使用的模型
   *
   * @param {string} requestId - 请求唯一标识
   * @param {string} model - 模型名称
   * @returns {Object} 更新后的状态对象
   */
  setModel(requestId, model) {
    const state = this.getOrCreateState(requestId);
    state.model = model;
    return state;
  }

  /**
   * 将请求标记为完成
   *
   * @param {string} requestId - 请求唯一标识
   * @returns {Object} 更新后的状态对象
   */
  completeRequest(requestId) {
    const state = this.getOrCreateState(requestId);
    state.status = 'completed';
    return state;
  }

  /**
   * 清理指定请求的状态
   *
   * @param {string} requestId - 请求唯一标识
   */
  cleanup(requestId) {
    this.states.delete(requestId);
  }
}

// 创建全局流式状态管理器（复用状态以保持事件一致性）
const streamStateManager = new StreamState();

/**
 * 生成 response.created 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @param {string} [model] - 可选模型名称
 * @returns {Object} response.created 事件对象
 */
function generateResponseCreated(requestId, model) {
  const state = streamStateManager.getOrCreateState(requestId);
  if (model) {
    state.model = model;
  }

  return {
    type: 'response.created',
    response: {
      id: state.id,
      object: 'response',
      created_at: state.startTime,
      status: 'in_progress',
      error: null,
      incomplete_details: null,
      instructions: '',
      max_output_tokens: null,
      model: state.model || 'gpt-4.1-2025-04-14',
      output: [],
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { },
      store: false,
      temperature: 1,
      text: { format: { type: "text" }},
      tool_choice: "auto",
      tools: [],
      top_logprobs: 0,
      top_p: 1,
      truncation: "disabled",
      usage: null,
      user: null,
      metadata: {}
    }
  };
}

/**
 * 生成 response.in_progress 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @returns {Object} response.in_progress 事件对象
 */
function generateResponseInProgress(requestId) {
  const state = streamStateManager.getOrCreateState(requestId);

  return {
    type: 'response.in_progress',
    response: {
      id: state.id,
      object: 'response',
      created_at: state.startTime,
      status: 'in_progress',
      error: null,
      incomplete_details: null,
      instructions: '',
      max_output_tokens: null,
      model: state.model || 'gpt-4.1-2025-04-14',
      output: [],
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { },
      service_tier: "auto",
      store: false,
      temperature: 1,
      text: { format: { type: "text" }},
      tool_choice: "auto",
      tools: [],
      top_logprobs: 0,
      top_p: 1,
      truncation: "disabled",
      usage: null,
      user: null,
      metadata: {}
    }
  };
}

/**
 * 生成 response.output_item.added 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @returns {Object} response.output_item.added 事件对象
 */
function generateOutputItemAdded(requestId) {
  const state = streamStateManager.getOrCreateState(requestId);

  return {
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      id: state.msgId,
      summary: [],
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
      content: []
    }
  };
}

/**
 * 生成 response.content_part.added 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @returns {Object} response.content_part.added 事件对象
 */
function generateContentPartAdded(requestId) {
  const state = streamStateManager.getOrCreateState(requestId);

  return {
    type: 'response.content_part.added',
    item_id: state.msgId,
    output_index: 0,
    content_index: 0,
    part: {
      type: 'output_text',
      text: '',
      annotations: [],
      logprobs: []
    }
  };
}

/**
 * 生成 response.output_text.delta 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @param {string} delta - 文本增量
 * @returns {Object} response.output_text.delta 事件对象
 */
function generateOutputTextDelta(requestId, delta) {
  const state = streamStateManager.getOrCreateState(requestId);
  state.fullText += delta;

  return {
    type: 'response.output_text.delta',
    item_id: state.msgId,
    output_index: 0,
    content_index: 0,
    delta: delta,
    logprobs: [],
    obfuscation: null
  };
}

/**
 * 生成 response.output_text.done 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @returns {Object} response.output_text.done 事件对象
 */
function generateOutputTextDone(requestId) {
  const state = streamStateManager.getOrCreateState(requestId);

  return {
    type: 'response.output_text.done',
    item_id: state.msgId,
    output_index: 0,
    content_index: 0,
    text: state.fullText,
    logprobs: []
  };
}

/**
 * 生成 response.content_part.done 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @returns {Object} response.content_part.done 事件对象
 */
function generateContentPartDone(requestId) {
  const state = streamStateManager.getOrCreateState(requestId);

  return {
    type: 'response.content_part.done',
    item_id: state.msgId,
    output_index: 0,
    content_index: 0,
    part: {
      type: 'output_text',
      text: state.fullText,
      annotations: [],
      logprobs: []
    }
  };
}

/**
 * 生成 response.output_item.done 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @returns {Object} response.output_item.done 事件对象
 */
function generateOutputItemDone(requestId) {
  const state = streamStateManager.getOrCreateState(requestId);

  return {
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: state.msgId,
      summary: [],
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: state.fullText,
          annotations: [],
          logprobs: []
        }
      ]
    }
  };
}

/**
 * 生成 response.completed 事件
 *
 * @param {string} requestId - 请求唯一标识
 * @param {Object} [usage] - 可选的用量统计（不传则生成占位值）
 * @returns {Object} response.completed 事件对象
 */
function generateResponseCompleted(requestId, usage) {
  const state = streamStateManager.getOrCreateState(requestId);

  return {
    type: 'response.completed',
    response: {
      background: false,
      created_at: state.startTime,
      error: null,
      id: state.id,
      incomplete_details: null,
      max_output_tokens: null,
      max_tool_calls: null,
      metadata: {},
      model: state.model || 'gpt-4.1-2025-04-14',
      object: 'response',
      output: [
        {
          id: state.msgId,
          summary: [],
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: state.fullText,
              annotations: [],
              logprobs: []
            }
          ]
        }
      ],
      parallel_tool_calls: true,
      previous_response_id: null,
      prompt_cache_key: null,
      reasoning: {
      },
      // 使用随机标识符模拟安全标记，便于与真实 API 输出格式保持一致
      safety_identifier: `user-${uuidv4().replace(/-/g, '')}`,
      service_tier: "default",
      status: "completed",
      store: false,
      temperature: 1,
      text: {
        format: { type: "text" }
      },
      tool_choice: "auto",
      tools: [],
      top_logprobs: 0,
      top_p: 1,
      truncation: "disabled",
      usage: usage || {
        // 未提供 usage 时生成占位值，避免客户端依赖字段时报错
        input_tokens: Math.floor(Math.random() * 100) + 20,
        input_tokens_details: {
          // 随机缓存 token 仅用于占位
          cached_tokens: Math.floor(Math.random() * 50)
        },
        output_tokens: state.fullText.split('').length,
        output_tokens_details: {
          reasoning_tokens: 0
        },
        // 总量由随机占位值与文本长度叠加，便于保持合理范围
        total_tokens: Math.floor(Math.random() * 100) + 20 + state.fullText.split('').length
      },
      user: null
    }
  };
}

// 导出流式状态管理器与事件生成函数以供外部使用
export { streamStateManager, generateResponseCreated, generateResponseInProgress,
  generateOutputItemAdded, generateContentPartAdded, generateOutputTextDelta,
  generateOutputTextDone, generateContentPartDone, generateOutputItemDone,
  generateResponseCompleted };
