import { describe, expect, test } from '@jest/globals';
import {
    buildClaudeResponse,
    buildServerSideWebSearchStreamBlocks,
    extractServerSideWebSearchQuery,
    isServerSideWebSearchToolCall,
    parseEventStreamChunk,
    processApiResponse,
    resolveServerSideWebSearchToolCalls
} from '../../src/kiro/api-client.js';

describe('api-client custom WebSearch alignment', () => {
    const webSearchToolCall = {
        toolUseId: 'tool-web-search',
        name: 'WebSearch',
        input: {
            query: 'OpenAI GPT-5.2 release notes'
        }
    };

    const readToolCall = {
        id: 'tool-read',
        type: 'function',
        function: {
            name: 'Read',
            arguments: JSON.stringify({ file_path: '/tmp/demo.txt' })
        }
    };

    test('识别并提取自定义 WebSearch 工具调用', () => {
        expect(isServerSideWebSearchToolCall(webSearchToolCall)).toBe(true);
        expect(isServerSideWebSearchToolCall(readToolCall)).toBe(false);
        expect(extractServerSideWebSearchQuery(webSearchToolCall)).toBe('OpenAI GPT-5.2 release notes');
    });

    test('resolveServerSideWebSearchToolCalls 会分离 server-side WebSearch 与普通工具', async () => {
        const fakeSearchResult = {
            success: true,
            results: [
                {
                    title: 'Release Notes',
                    url: 'https://example.com/release-notes',
                    snippet: 'Important release details.'
                }
            ]
        };

        const resolved = await resolveServerSideWebSearchToolCalls(
            [webSearchToolCall, readToolCall],
            false,
            async () => fakeSearchResult
        );

        expect(resolved.serverSideExecutions).toHaveLength(1);
        expect(resolved.serverSideExecutions[0]).toEqual(
            expect.objectContaining({
                toolUseId: 'tool-web-search',
                query: 'OpenAI GPT-5.2 release notes',
                summaryText: expect.stringContaining('Here are the search results'),
                resultBlocks: [
                    {
                        type: 'web_search_result',
                        title: 'Release Notes',
                        url: 'https://example.com/release-notes',
                        encrypted_content: 'Important release details.'
                    }
                ]
            })
        );
        expect(resolved.clientToolCalls).toEqual([readToolCall]);
    });

    test('buildServerSideWebSearchStreamBlocks 会生成 server_tool_use 与 web_search_tool_result 序列', () => {
        const result = buildServerSideWebSearchStreamBlocks([
            {
                toolUseId: 'tool-web-search',
                query: 'OpenAI GPT-5.2 release notes',
                summaryText: 'Search summary',
                resultBlocks: [
                    {
                        type: 'web_search_result',
                        title: 'Release Notes',
                        url: 'https://example.com/release-notes',
                        encrypted_content: 'Important release details.'
                    }
                ]
            }
        ], 2);

        expect(result.events.map((event) => event.type)).toEqual([
            'content_block_start',
            'content_block_stop',
            'content_block_start',
            'content_block_stop',
            'content_block_start',
            'content_block_delta',
            'content_block_stop'
        ]);
        expect(result.events[0].content_block.type).toBe('server_tool_use');
        expect(result.events[2].content_block.type).toBe('web_search_tool_result');
        expect(result.events[4].content_block.type).toBe('text');
        expect(result.nextIndex).toBe(5);
        expect(result.emittedSummaryText).toBe('Search summary');
    });

    test('buildClaudeResponse 会把 server-side WebSearch 块与普通 tool_use 一起放入响应', () => {
        const response = buildClaudeResponse(
            'I will search first.',
            false,
            'assistant',
            'claude-sonnet-4-5',
            [readToolCall],
            128,
            {
                serverWebSearchExecutions: [
                    {
                        toolUseId: 'tool-web-search',
                        query: 'OpenAI GPT-5.2 release notes',
                        summaryText: 'Search summary',
                        resultBlocks: [
                            {
                                type: 'web_search_result',
                                title: 'Release Notes',
                                url: 'https://example.com/release-notes',
                                encrypted_content: 'Important release details.'
                            }
                        ]
                    }
                ]
            }
        );

        expect(response.stop_reason).toBe('tool_use');
        expect(response.content.map((item) => item.type)).toEqual([
            'text',
            'server_tool_use',
            'web_search_tool_result',
            'text',
            'tool_use'
        ]);
        expect(response.content[1]).toEqual({
            type: 'server_tool_use',
            id: 'tool-web-search',
            name: 'web_search',
            input: { query: 'OpenAI GPT-5.2 release notes' }
        });
        expect(response.content[4]).toEqual({
            type: 'tool_use',
            id: 'tool-read',
            name: 'Read',
            input: { file_path: '/tmp/demo.txt' }
        });
    });

    test('buildClaudeResponse 兼容 event-stream 风格的普通 tool_call 结构', () => {
        const response = buildClaudeResponse(
            '',
            false,
            'assistant',
            'claude-sonnet-4-5',
            [
                {
                    toolUseId: 'tool-read-raw',
                    name: 'Read',
                    input: { file_path: '/tmp/raw.txt' }
                }
            ],
            64
        );

        expect(response.stop_reason).toBe('tool_use');
        expect(response.content).toEqual([
            {
                type: 'tool_use',
                id: 'tool-read-raw',
                name: 'Read',
                input: { file_path: '/tmp/raw.txt' }
            }
        ]);
    });

    test('buildClaudeResponse 会把 Kiro 风格 tool 输入反向映射并过滤 Kiro-only 字段', () => {
        const response = buildClaudeResponse(
            '',
            false,
            'assistant',
            'claude-sonnet-4-5',
            [
                {
                    toolUseId: 'tool-grep-raw',
                    name: 'grepSearch',
                    input: {
                        query: 'TODO',
                        includePattern: 'src/**',
                        reason: 'internal-only'
                    }
                }
            ],
            64
        );

        expect(response.content).toEqual([
            {
                type: 'tool_use',
                id: 'tool-grep-raw',
                name: 'Grep',
                input: {
                    pattern: 'TODO',
                    path: 'src/**'
                }
            }
        ]);
    });

    test('buildClaudeResponse 的 stream 模式也会对 Kiro 风格 tool 输入做反向映射', () => {
        const events = buildClaudeResponse(
            '',
            true,
            'assistant',
            'claude-sonnet-4-5',
            [
                {
                    toolUseId: 'tool-read-stream',
                    name: 'readFile',
                    input: { path: '/tmp/from-kiro.txt', reason: 'internal-only' }
                }
            ],
            64
        );

        expect(events.map((event) => event.type)).toEqual([
            'message_start',
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop'
        ]);
        expect(events[1].content_block).toEqual({
            type: 'tool_use',
            id: 'tool-read-stream',
            name: 'Read',
            input: {}
        });
        expect(events[2].delta.partial_json).toBe('{"file_path":"/tmp/from-kiro.txt"}');
        expect(events[4].delta).toEqual({
            stop_reason: 'tool_use',
            stop_sequence: null
        });
        expect(events[4].usage).toEqual(expect.objectContaining({
            input_tokens: 64,
            output_tokens: expect.any(Number)
        }));
    });

    test('buildClaudeResponse 的 stream 模式会输出 server WebSearch blocks 与 usage', () => {
        const events = buildClaudeResponse(
            'I will search first.',
            true,
            'assistant',
            'claude-sonnet-4-5',
            [readToolCall],
            128,
            {
                serverWebSearchExecutions: [
                    {
                        toolUseId: 'tool-web-search',
                        query: 'OpenAI GPT-5.2 release notes',
                        summaryText: 'Search summary',
                        resultBlocks: [
                            {
                                type: 'web_search_result',
                                title: 'Release Notes',
                                url: 'https://example.com/release-notes',
                                encrypted_content: 'Important release details.'
                            }
                        ]
                    }
                ]
            }
        );

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
            'content_block_start',
            'content_block_delta',
            'content_block_stop',
            'message_delta',
            'message_stop'
        ]);
        expect(events[4].content_block.type).toBe('server_tool_use');
        expect(events[4].content_block.input).toEqual({ query: 'OpenAI GPT-5.2 release notes' });
        expect(events[6].content_block.type).toBe('web_search_tool_result');
        expect(events[8].content_block.type).toBe('text');
        expect(events[9].delta.text).toBe('Search summary');
        expect(events[11].content_block.type).toBe('tool_use');
        expect(events[12].delta.partial_json).toBe('{"file_path":"/tmp/demo.txt"}');
        expect(events[14].delta.stop_reason).toBe('tool_use');
        expect(events[14].delta.stop_sequence).toBeNull();
        expect(events[14].usage.input_tokens).toBe(128);
        expect(events[14].usage.server_tool_use.web_search_requests).toBe(1);
    });

    test('buildClaudeResponse 会尽力修复可恢复的 tool arguments JSON', () => {
        const response = buildClaudeResponse(
            '',
            false,
            'assistant',
            'claude-sonnet-4-5',
            [
                {
                    id: 'tool-read-repair',
                    type: 'function',
                    function: {
                        name: 'Read',
                        arguments: '{file_path:"/tmp/repaired.txt",}'
                    }
                }
            ],
            64
        );

        expect(response.content).toEqual([
            {
                type: 'tool_use',
                id: 'tool-read-repair',
                name: 'Read',
                input: { file_path: '/tmp/repaired.txt' }
            }
        ]);
    });

    test('extractServerSideWebSearchQuery 会尽力修复可恢复的 WebSearch JSON', () => {
        expect(extractServerSideWebSearchQuery({
            toolUseId: 'tool-web-broken',
            name: 'webSearch',
            input: '{query:"OpenAI roadmap",}'
        })).toBe('OpenAI roadmap');
    });

    test('parseEventStreamChunk 会提取 contextUsage 计算后的 input_tokens', () => {
        const raw = [
            `event: assistantMessage`,
            `data: ${JSON.stringify({ content: 'Hello' })}`,
            '',
            `event: contextUsage`,
            `data: ${JSON.stringify({ contextUsagePercentage: 1.5 })}`,
            ''
        ].join('\n');

        expect(parseEventStreamChunk(raw)).toEqual(expect.objectContaining({
            content: 'Hello',
            contextInputTokens: 3000,
            stopReasonOverride: null
        }));
    });

    test('processApiResponse 会保留 contextUsage / exception 计算出的覆盖信息', () => {
        const raw = [
            `event: assistantMessage`,
            `data: ${JSON.stringify({ content: 'Hello' })}`,
            '',
            `event: contextUsage`,
            `data: ${JSON.stringify({ contextUsagePercentage: 100 })}`,
            '',
            `event: exception`,
            `data: ${JSON.stringify({ exceptionType: 'ContentLengthExceededException' })}`,
            ''
        ].join('\n');

        const result = processApiResponse({ data: raw });
        expect(result.responseText).toBe('Hello');
        expect(result.contextInputTokens).toBe(200000);
        expect(result.stopReasonOverride).toBe('max_tokens');
    });

    test('buildClaudeResponse 会应用 inputTokensOverride 和 forcedStopReason', () => {
        const response = buildClaudeResponse(
            'Hello',
            false,
            'assistant',
            'claude-sonnet-4-5',
            null,
            64,
            {
                inputTokensOverride: 3000,
                forcedStopReason: 'model_context_window_exceeded'
            }
        );

        expect(response.usage.input_tokens).toBe(3000);
        expect(response.stop_reason).toBe('model_context_window_exceeded');
    });
});
