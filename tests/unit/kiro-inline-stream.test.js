import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const streamApiRealMock = jest.fn();
const executeWebSearchMock = jest.fn();
const refreshAccessTokenIfNeededMock = jest.fn(async () => {});
const initializeAuthMock = jest.fn(async () => {});

jest.unstable_mockModule('../../src/kiro/streaming.js', () => ({
    streamApiReal: streamApiRealMock
}));

jest.unstable_mockModule('../../src/kiro/search.js', () => ({
    executeWebSearch: executeWebSearchMock,
    formatSearchResults: jest.fn(() => '')
}));

jest.unstable_mockModule('../../src/kiro/auth.js', () => ({
    refreshAccessTokenIfNeeded: refreshAccessTokenIfNeededMock,
    initializeAuth: initializeAuthMock,
    pollDeviceToken: jest.fn()
}));

const { generateContentStream } = await import('../../src/kiro/api-client.js');

function createService() {
    return {
        isInitialized: true,
        modelName: 'claude-sonnet-4-5',
        verboseLogging: false,
        config: {
            ENABLE_THINKING_BY_DEFAULT: false
        }
    };
}

async function collectStreamEvents(generator) {
    const events = [];
    for await (const event of generator) {
        events.push(event);
    }
    return events;
}

describe('generateContentStream inline tool alignment', () => {
    beforeEach(() => {
        streamApiRealMock.mockReset();
        executeWebSearchMock.mockReset();
        refreshAccessTokenIfNeededMock.mockClear();
        initializeAuthMock.mockClear();
    });

    test('普通 tool_use 在 stop 时立刻以内联 block 形式发出，后续文本重新开块', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield { type: 'content', content: 'Before tool' };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-read-1',
                    name: 'readFile',
                    input: '{"path":"/tmp/demo.txt"}',
                    stop: true
                }
            };
            yield { type: 'content', content: 'After tool' };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        expect(events.map((event) => event.type)).toEqual([
            'message_start',
            'content_block_start',
            'content_block_delta',
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
        expect(events[1].index).toBe(0);
        expect(events[4]).toEqual({
            type: 'content_block_start',
            index: 1,
            content_block: {
                type: 'tool_use',
                id: 'tool-read-1',
                name: expect.any(String),
                input: {}
            }
        });
        expect(events[5].delta.partial_json).toContain('/tmp/demo.txt');
        expect(events[7].index).toBe(2);
        expect(events[8].delta.text).toBe('After tool');
        expect(events[10].delta.stop_reason).toBe('tool_use');
        expect(events[10].delta.stop_sequence).toBeNull();
        expect(events[10].usage).toEqual(expect.objectContaining({
            input_tokens: expect.any(Number),
            output_tokens: expect.any(Number)
        }));
    });

    test('contextUsage 先到达时，会让真实流式的 message_start 和 message_delta 使用更准确的 input_tokens', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield {
                type: 'contextUsage',
                data: {
                    contextUsagePercentage: 1.5
                }
            };
            yield { type: 'content', content: 'Hello' };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        expect(events[0].type).toBe('message_start');
        expect(events[0].message.usage.input_tokens).toBe(3000);
        expect(events.at(-2).usage.input_tokens).toBe(3000);
        expect(events.at(-2).delta.stop_reason).toBe('end_turn');
        expect(events.at(-2).delta.stop_sequence).toBeNull();
    });

    test('contextUsage 达到 100% 时会把 stop_reason 置为 model_context_window_exceeded', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield {
                type: 'contextUsage',
                data: {
                    contextUsagePercentage: 100
                }
            };
            yield { type: 'content', content: 'Window full' };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        expect(events[0].message.usage.input_tokens).toBe(200000);
        expect(events.at(-2).delta.stop_reason).toBe('model_context_window_exceeded');
        expect(events.at(-2).usage.input_tokens).toBe(200000);
    });

    test('ContentLengthExceededException 会把 stop_reason 置为 max_tokens', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield {
                type: 'exception',
                data: {
                    exceptionType: 'ContentLengthExceededException',
                    message: 'Input too long'
                }
            };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        expect(events.map((event) => event.type)).toEqual([
            'message_start',
            'message_delta',
            'message_stop'
        ]);
        expect(events[1].delta).toEqual({
            stop_reason: 'max_tokens',
            stop_sequence: null
        });
    });

    test('普通 tool_use 会按输入 chunk 增量发出 input_json_delta', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-read-split',
                    name: 'readFile',
                    input: '{"pa',
                    stop: false
                }
            };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-read-split',
                    name: 'readFile',
                    input: 'th":"/tmp/demo.txt"',
                    stop: false
                }
            };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-read-split',
                    name: 'readFile',
                    input: '}',
                    stop: true
                }
            };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        expect(events[1]).toEqual({
            type: 'content_block_start',
            index: 0,
            content_block: {
                type: 'tool_use',
                id: 'tool-read-split',
                name: 'Read',
                input: {}
            }
        });

        const toolJson = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta')
            .map((event) => event.delta.partial_json)
            .join('');
        expect(toolJson).toBe('{"file_path":"/tmp/demo.txt"}');
        expect(events.filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta')).toHaveLength(3);
        expect(events.at(-2).delta.stop_reason).toBe('tool_use');
        expect(events.at(-2).delta.stop_sequence).toBeNull();
    });

    test('流结束时未收到 stop 的普通 tool_use 也会被关闭，并保持 tool_use stop_reason', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-write-open',
                    name: 'fsWrite',
                    input: '{"path":"/tmp/a.txt","text":"hel',
                    stop: false
                }
            };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-write-open',
                    name: 'fsWrite',
                    input: 'lo"}',
                    stop: false
                }
            };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        const toolJson = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta')
            .map((event) => event.delta.partial_json)
            .join('');
        expect(toolJson).toBe('{"file_path":"/tmp/a.txt","content":"hello"}');

        const stopIndex = events.findIndex((event) =>
            event.type === 'content_block_stop' && event.index === 0
        );
        expect(stopIndex).toBeGreaterThan(-1);
        expect(events.at(-2).delta.stop_reason).toBe('tool_use');
        expect(events.at(-2).delta.stop_sequence).toBeNull();
    });

    test('普通 tool_use 增量输出会过滤顶层 Kiro-only 字段，并保持 JSON 合法', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-grep-filtered',
                    name: 'grepSearch',
                    input: '{"reason":"internal",',
                    stop: false
                }
            };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-grep-filtered',
                    name: 'grepSearch',
                    input: '"query":"TODO","includePattern":"src/**",',
                    stop: false
                }
            };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-grep-filtered',
                    name: 'grepSearch',
                    input: '"includeIgnoredFiles":true}',
                    stop: true
                }
            };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        const toolJson = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta')
            .map((event) => event.delta.partial_json)
            .join('');
        expect(toolJson).toBe('{"pattern":"TODO","path":"src/**"}');
        expect(events.at(-2).delta.stop_reason).toBe('tool_use');
        expect(events.at(-2).delta.stop_sequence).toBeNull();
    });

    test('普通 tool_use 遇到无法修复的 JSON 时仍会完整输出 block 并以 tool_use 结束', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-read-bad-json',
                    name: 'readFile',
                    input: '{"path":"/tmp/demo.txt"',
                    stop: true
                }
            };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        expect(events[1].content_block.type).toBe('tool_use');
        expect(events.some((event) => event.type === 'content_block_stop' && event.index === 0)).toBe(true);
        const toolJson = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta')
            .map((event) => event.delta.partial_json)
            .join('');
        expect(toolJson).toBe('{"file_path":"/tmp/demo.txt"');
        expect(events.at(-2).delta.stop_reason).toBe('tool_use');
        expect(events.at(-2).delta.stop_sequence).toBeNull();
    });

    test('自定义 WebSearch 在 stop 时立刻转成 server_tool_use 与 web_search_tool_result', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield { type: 'content', content: 'Searching...' };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-web-1',
                    name: 'webSearch',
                    input: '{"query":"OpenAI roadmap"}',
                    stop: true
                }
            };
        });

        executeWebSearchMock.mockResolvedValue({
            success: true,
            source: 'MockSearch',
            results: [
                {
                    title: 'Roadmap',
                    url: 'https://example.com/roadmap',
                    snippet: 'Roadmap summary'
                }
            ]
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

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
        expect(events[4].content_block.input).toEqual({ query: 'OpenAI roadmap' });
        expect(events[6].content_block.type).toBe('web_search_tool_result');
        expect(events[6].content_block.content[0]).toEqual({
            type: 'web_search_result',
            title: 'Roadmap',
            url: 'https://example.com/roadmap',
            encrypted_content: 'Roadmap summary'
        });
        expect(events[9].delta.text).toContain('Here are the search results');
        expect(events[11].delta.stop_reason).toBe('end_turn');
        expect(events[11].delta.stop_sequence).toBeNull();
        expect(events[11].usage.server_tool_use.web_search_requests).toBe(1);
    });

    test('启用 thinking 时会把 `<thinking>...</thinking>\\n\\n` 拆成 Claude thinking block', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield { type: 'content', content: '<thinking>\n先分析</thinking>\n\n最终答案' };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                extended_thinking: true,
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        expect(events[1]).toEqual({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '' }
        });
        expect(events[2]).toEqual({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: '先分析' }
        });
        expect(events[3]).toEqual({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: '' }
        });
        expect(events[4]).toEqual({
            type: 'content_block_stop',
            index: 0
        });
        expect(events[5]).toEqual({
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'text', text: '' }
        });

        const textDelta = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'text_delta')
            .map((event) => event.delta.text)
            .join('');
        expect(textDelta).toBe('最终答案');

        expect(events.at(-2).delta.stop_reason).toBe('end_turn');
        expect(events.at(-2).delta.stop_sequence).toBeNull();
        expect(events.at(-1).type).toBe('message_stop');
    });

    test('tool_use 紧跟 thinking 结束标签时，会先关闭 thinking block 并过滤 `</thinking>`', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield { type: 'content', content: '<thinking>abc</thinking>' };
            yield {
                type: 'toolUse',
                toolUse: {
                    toolUseId: 'tool-write-1',
                    name: 'Write',
                    input: '{"file_path":"/tmp/a.txt","content":"ok"}',
                    stop: true
                }
            };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                extended_thinking: true,
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        const thinkingText = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta')
            .map((event) => event.delta.thinking)
            .filter(Boolean)
            .join('');
        expect(thinkingText).toBe('abc');
        expect(events.every((event) => event.delta?.thinking !== '</thinking>')).toBe(true);

        const thinkingStopIndex = events.findIndex((event) =>
            event.type === 'content_block_stop' && event.index === 0
        );
        const toolStartIndex = events.findIndex((event) =>
            event.type === 'content_block_start' && event.content_block?.type === 'tool_use'
        );
        expect(thinkingStopIndex).toBeGreaterThan(-1);
        expect(toolStartIndex).toBeGreaterThan(thinkingStopIndex);
        expect(events.at(-2).delta.stop_sequence).toBeNull();
    });

    test('纯 thinking 输出会补空格 text block，并以 max_tokens 结束', async () => {
        streamApiRealMock.mockImplementation(async function* () {
            yield { type: 'content', content: '<thinking>abc</thinking>' };
        });

        const events = await collectStreamEvents(generateContentStream(
            createService(),
            'claude-sonnet-4-5',
            {
                extended_thinking: true,
                messages: [{ role: 'user', content: 'hello' }]
            }
        ));

        const thinkingText = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta')
            .map((event) => event.delta.thinking)
            .filter(Boolean)
            .join('');
        expect(thinkingText).toBe('abc');

        const textDelta = events
            .filter((event) => event.type === 'content_block_delta' && event.delta?.type === 'text_delta')
            .map((event) => event.delta.text)
            .join('');
        expect(textDelta).toBe(' ');
        expect(events.at(-2).delta.stop_reason).toBe('max_tokens');
        expect(events.at(-2).delta.stop_sequence).toBeNull();
    });
});
