/**
 * Claude WebSearch 直连响应构建器
 *
 * 目标：在纯 `web_search` 请求场景下，直接对齐 kirors 的响应语义，
 * 避免继续走 Kiro API 的普通工具调用链。
 *
 * @module kiro/websearch-response
 */

import { v4 as uuidv4 } from 'uuid';
import { executeWebSearch } from './search.js';
import { countTextTokens, estimateInputTokens } from './utils/token-counter.js';
import { resolveRequestModel } from './model-config.js';

const WEB_SEARCH_PROMPT_PREFIX = 'Perform a web search for the query: ';

/**
 * 判断是否为 Anthropic builtin `web_search` 直连请求
 *
 * 对齐 kirors：只有当 tools 有且仅有一个，且 name 为 `web_search` 时才命中。
 *
 * @param {Object} requestBody - Claude 请求体
 * @returns {boolean} 是否命中
 */
export function hasClaudeWebSearchTool(requestBody) {
    const tools = requestBody?.tools;
    if (!Array.isArray(tools) || tools.length !== 1) {
        return false;
    }

    const [tool] = tools;
    return tool?.name === 'web_search';
}

/**
 * 从 Claude 消息中提取搜索词
 *
 * @param {Object} requestBody - Claude 请求体
 * @returns {string|null} 搜索词
 */
export function extractClaudeWebSearchQuery(requestBody) {
    const firstMessage = requestBody?.messages?.[0];
    if (!firstMessage) {
        return null;
    }

    let text = '';
    if (typeof firstMessage.content === 'string') {
        text = firstMessage.content;
    } else if (Array.isArray(firstMessage.content)) {
        const firstTextBlock = firstMessage.content.find(
            (block) => block?.type === 'text' && typeof block.text === 'string'
        );
        text = firstTextBlock?.text || '';
    }

    const normalizedText = text.trim();
    if (!normalizedText) {
        return null;
    }

    if (normalizedText.startsWith(WEB_SEARCH_PROMPT_PREFIX)) {
        return normalizedText.slice(WEB_SEARCH_PROMPT_PREFIX.length).trim();
    }

    return normalizedText;
}

/**
 * 生成与 kirors 接近的 web search tool_use id
 *
 * @returns {string} tool_use_id
 */
export function createClaudeWebSearchToolUseId() {
    const randomPrefix = uuidv4().replace(/-/g, '').slice(0, 22);
    const randomSuffix = uuidv4().replace(/-/g, '').slice(0, 8);
    return `web_search_tooluse_${randomPrefix}_${Date.now()}_${randomSuffix}`;
}

/**
 * 将搜索结果转换为 Claude `web_search_tool_result` 内容块
 *
 * @param {{success?: boolean, results?: Array}} searchResult - 搜索结果
 * @returns {Array} Claude 内容块数组
 */
export function buildClaudeWebSearchResultBlocks(searchResult) {
    if (!searchResult?.success || !Array.isArray(searchResult.results)) {
        return [];
    }

    return searchResult.results.map((result) => ({
        type: 'web_search_result',
        title: result.title,
        url: result.url,
        encrypted_content: result.snippet || ''
    }));
}

/**
 * 生成搜索摘要
 *
 * @param {string} query - 搜索词
 * @param {{success?: boolean, results?: Array, error?: string, source?: string}} searchResult - 搜索结果
 * @returns {string} 摘要文本
 */
export function generateClaudeWebSearchSummary(query, searchResult) {
    if (!searchResult?.success) {
        return `I searched for "${query}", but the search failed.${searchResult?.error ? ` Error: ${searchResult.error}` : ''}`;
    }

    if (!Array.isArray(searchResult.results) || searchResult.results.length === 0) {
        return `I searched for "${query}", but found no results.`;
    }

    const lines = [`Here are the search results for "${query}":`, ''];
    searchResult.results.forEach((result, index) => {
        lines.push(`${index + 1}. ${result.title}`);
        lines.push(`   URL: ${result.url}`);
        if (result.snippet) {
            lines.push(`   ${result.snippet}`);
        }
        lines.push('');
    });

    if (searchResult.source) {
        lines.push(`Source: ${searchResult.source}`);
    }

    return lines.join('\n').trim();
}

function estimateClaudeWebSearchOutputTokens(decisionText, resultBlocks, summaryText) {
    return countTextTokens(
        `${decisionText}\n${summaryText}\n${JSON.stringify(resultBlocks)}`,
        true
    );
}

/**
 * 构造 Claude 一元响应
 *
 * @param {Object} params - 构造参数
 * @param {string} params.model - 模型名
 * @param {string} params.query - 搜索词
 * @param {Object} params.searchResult - 搜索结果
 * @param {number} params.inputTokens - 输入 token
 * @param {string} [params.toolUseId] - tool_use id
 * @returns {Object} Claude message 响应
 */
export function buildClaudeWebSearchResponse({
    model,
    query,
    searchResult,
    inputTokens,
    toolUseId = createClaudeWebSearchToolUseId()
}) {
    const decisionText = `I'll search for "${query}".`;
    const resultBlocks = buildClaudeWebSearchResultBlocks(searchResult);
    const summaryText = generateClaudeWebSearchSummary(query, searchResult);
    const outputTokens = estimateClaudeWebSearchOutputTokens(decisionText, resultBlocks, summaryText);

    return {
        id: `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
        type: 'message',
        role: 'assistant',
        model,
        content: [
            { type: 'text', text: decisionText },
            {
                type: 'server_tool_use',
                id: toolUseId,
                name: 'web_search',
                input: { query }
            },
            {
                type: 'web_search_tool_result',
                content: resultBlocks
            },
            { type: 'text', text: summaryText }
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
        }
    };
}

/**
 * 构造 Claude SSE 事件序列
 *
 * @param {Object} params - 构造参数
 * @param {string} params.model - 模型名
 * @param {string} params.query - 搜索词
 * @param {Object} params.searchResult - 搜索结果
 * @param {number} params.inputTokens - 输入 token
 * @param {string} [params.toolUseId] - tool_use id
 * @returns {Array<Object>} Claude SSE 事件
 */
export function buildClaudeWebSearchStreamEvents({
    model,
    query,
    searchResult,
    inputTokens,
    toolUseId = createClaudeWebSearchToolUseId()
}) {
    const messageId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const decisionText = `I'll search for "${query}".`;
    const resultBlocks = buildClaudeWebSearchResultBlocks(searchResult);
    const summaryText = generateClaudeWebSearchSummary(query, searchResult);
    const outputTokens = estimateClaudeWebSearchOutputTokens(decisionText, resultBlocks, summaryText);

    return [
        {
            type: 'message_start',
            message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                model,
                content: [],
                stop_reason: null,
                usage: {
                    input_tokens: inputTokens,
                    output_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0
                }
            }
        },
        {
            type: 'content_block_start',
            index: 0,
            content_block: {
                type: 'text',
                text: ''
            }
        },
        {
            type: 'content_block_delta',
            index: 0,
            delta: {
                type: 'text_delta',
                text: decisionText
            }
        },
        {
            type: 'content_block_stop',
            index: 0
        },
        {
            type: 'content_block_start',
            index: 1,
            content_block: {
                id: toolUseId,
                type: 'server_tool_use',
                name: 'web_search',
                input: { query }
            }
        },
        {
            type: 'content_block_stop',
            index: 1
        },
        {
            type: 'content_block_start',
            index: 2,
            content_block: {
                type: 'web_search_tool_result',
                content: resultBlocks
            }
        },
        {
            type: 'content_block_stop',
            index: 2
        },
        {
            type: 'content_block_start',
            index: 3,
            content_block: {
                type: 'text',
                text: ''
            }
        },
        {
            type: 'content_block_delta',
            index: 3,
            delta: {
                type: 'text_delta',
                text: summaryText
            }
        },
        {
            type: 'content_block_stop',
            index: 3
        },
        {
            type: 'message_delta',
            delta: {
                stop_reason: 'end_turn'
            },
            usage: {
                output_tokens: outputTokens,
                server_tool_use: {
                    web_search_requests: 1
                }
            }
        },
        {
            type: 'message_stop'
        }
    ];
}

/**
 * 解析纯 Claude WebSearch 请求并构造直连响应
 *
 * @param {Object} requestBody - Claude 请求体
 * @param {Object} [options={}] - 附加选项
 * @param {Function} [options.searchExecutor=executeWebSearch] - 搜索执行器
 * @returns {Promise<Object>} 构造结果
 */
export async function resolveClaudeWebSearchResponse(requestBody, options = {}) {
    const searchExecutor = options.searchExecutor || executeWebSearch;
    const query = extractClaudeWebSearchQuery(requestBody);

    if (!query) {
        const error = new Error('无法从消息中提取搜索查询');
        error.status = 400;
        throw error;
    }

    const searchResult = await searchExecutor(query);
    const inputTokens = estimateInputTokens(requestBody);
    const model = resolveRequestModel(requestBody.model);
    const toolUseId = createClaudeWebSearchToolUseId();

    return {
        query,
        inputTokens,
        searchResult,
        unaryResponse: buildClaudeWebSearchResponse({
            model,
            query,
            searchResult,
            inputTokens,
            toolUseId
        }),
        streamEvents: buildClaudeWebSearchStreamEvents({
            model,
            query,
            searchResult,
            inputTokens,
            toolUseId
        })
    };
}
