import { describe, expect, test } from '@jest/globals';
import {
    buildClaudeWebSearchResponse,
    buildClaudeWebSearchStreamEvents,
    extractClaudeWebSearchQuery,
    hasClaudeWebSearchTool,
    resolveClaudeWebSearchResponse
} from '../../src/kiro/websearch-response.js';
import { DEFAULT_PUBLIC_MODEL } from '../../src/kiro/model-config.js';

describe('kirors-compatible web search response', () => {
    const requestBody = {
        model: 'claude-sonnet-4-5',
        stream: false,
        tools: [
            {
                type: 'web_search_20250305',
                name: 'web_search'
            }
        ],
        messages: [
            {
                role: 'user',
                content: 'Perform a web search for the query: OpenAI latest announcements'
            }
        ]
    };

    const fakeSearchResult = {
        success: true,
        source: 'MockSearch',
        results: [
            {
                title: 'OpenAI News',
                url: 'https://example.com/openai-news',
                snippet: 'Latest OpenAI announcement summary.'
            }
        ]
    };

    test('识别纯 Claude builtin web_search 请求', () => {
        expect(hasClaudeWebSearchTool(requestBody)).toBe(true);
        expect(hasClaudeWebSearchTool({ ...requestBody, tools: [] })).toBe(false);
        expect(hasClaudeWebSearchTool({
            ...requestBody,
            tools: [
                { name: 'web_search' },
                { name: 'other_tool' }
            ]
        })).toBe(false);
    });

    test('提取并规范化搜索查询', () => {
        expect(extractClaudeWebSearchQuery(requestBody)).toBe('OpenAI latest announcements');
        expect(extractClaudeWebSearchQuery({
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'hello world' }
                    ]
                }
            ]
        })).toBe('hello world');
    });

    test('构造 Claude 一元响应时包含 server_tool_use 与 web_search_tool_result', () => {
        const response = buildClaudeWebSearchResponse({
            model: 'claude-sonnet-4-5',
            query: 'OpenAI latest announcements',
            searchResult: fakeSearchResult,
            inputTokens: 123,
            toolUseId: 'web_search_tooluse_test'
        });

        expect(response.type).toBe('message');
        expect(response.stop_reason).toBe('end_turn');
        expect(response.content.map((item) => item.type)).toEqual([
            'text',
            'server_tool_use',
            'web_search_tool_result',
            'text'
        ]);
        expect(response.content[1]).toEqual({
            type: 'server_tool_use',
            id: 'web_search_tooluse_test',
            name: 'web_search',
            input: { query: 'OpenAI latest announcements' }
        });
        expect(response.content[2].content[0]).toEqual({
            type: 'web_search_result',
            title: 'OpenAI News',
            url: 'https://example.com/openai-news',
            encrypted_content: 'Latest OpenAI announcement summary.'
        });
    });

    test('构造 Claude SSE 序列时对齐 kirors 的关键事件', () => {
        const events = buildClaudeWebSearchStreamEvents({
            model: 'claude-sonnet-4-5',
            query: 'OpenAI latest announcements',
            searchResult: fakeSearchResult,
            inputTokens: 123,
            toolUseId: 'web_search_tooluse_test'
        });

        expect(events.map((event) => event.type)).toEqual([
            'message_start',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'content_block_start',
            'content_block_stop',
            'content_block_start',
            'content_block_stop',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop'
        ]);
        expect(events[4].content_block.type).toBe('server_tool_use');
        expect(events[6].content_block.type).toBe('web_search_tool_result');
        expect(events[11].usage.server_tool_use.web_search_requests).toBe(1);
        expect(events[11].delta.stop_reason).toBe('end_turn');
    });

    test('resolveClaudeWebSearchResponse 会统一生成一元和流式结果', async () => {
        const resolved = await resolveClaudeWebSearchResponse(requestBody, {
            searchExecutor: async () => fakeSearchResult
        });

        expect(resolved.query).toBe('OpenAI latest announcements');
        expect(resolved.unaryResponse.content[1].type).toBe('server_tool_use');
        expect(resolved.streamEvents[4].content_block.type).toBe('server_tool_use');
        expect(resolved.inputTokens).toBeGreaterThan(0);
    });

    test('resolveClaudeWebSearchResponse 会对请求模型做归一化', async () => {
        const resolvedFromAlias = await resolveClaudeWebSearchResponse(
            { ...requestBody, model: 'gpt-5.2' },
            { searchExecutor: async () => fakeSearchResult }
        );
        expect(resolvedFromAlias.unaryResponse.model).toBe('claude-opus-4-5');
        expect(resolvedFromAlias.streamEvents[0].message.model).toBe('claude-opus-4-5');

        const resolvedFromUnknown = await resolveClaudeWebSearchResponse(
            { ...requestBody, model: 'unknown-model' },
            { searchExecutor: async () => fakeSearchResult }
        );
        expect(resolvedFromUnknown.unaryResponse.model).toBe(DEFAULT_PUBLIC_MODEL);
        expect(resolvedFromUnknown.streamEvents[0].message.model).toBe(DEFAULT_PUBLIC_MODEL);
    });
});
