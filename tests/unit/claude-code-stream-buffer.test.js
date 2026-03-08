import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateContentStreamMock = jest.fn();

jest.unstable_mockModule('../../src/kiro/api-client.js', () => ({
    generateContentStream: generateContentStreamMock,
    generateContent: jest.fn()
}));

const { handleStreamRequest, reconcileBufferedMessageStartUsage, MODEL_PROVIDER } = await import('../../src/utils/common.js');
const { MODEL_PROTOCOL_PREFIX } = await import('../../src/utils/protocol.js');

function createMockResponse() {
    return {
        writeHead: jest.fn(),
        write: jest.fn(() => true),
        end: jest.fn()
    };
}

async function* createNativeClaudeStream(chunks) {
    for (const chunk of chunks) {
        yield chunk;
    }
}

describe('Claude Code buffered stream alignment', () => {
    beforeEach(() => {
        generateContentStreamMock.mockReset();
    });

    test('reconcileBufferedMessageStartUsage 会用最终 message_delta 的 input_tokens 回填 message_start', () => {
        const chunks = [
            {
                type: 'message_start',
                message: {
                    id: 'msg_1',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-sonnet-4-5',
                    usage: {
                        input_tokens: 1200,
                        output_tokens: 0
                    },
                    content: []
                }
            },
            {
                type: 'message_delta',
                delta: {
                    stop_reason: 'end_turn',
                    stop_sequence: null
                },
                usage: {
                    input_tokens: 3000,
                    output_tokens: 42
                }
            }
        ];

        const reconciled = reconcileBufferedMessageStartUsage(chunks);

        expect(reconciled[0].message.usage.input_tokens).toBe(3000);
        expect(reconciled[1].usage.input_tokens).toBe(3000);
    });

    test('handleStreamRequest 在 bufferUntilComplete 模式下会输出已回填 input_tokens 的 message_start', async () => {
        generateContentStreamMock.mockResolvedValue(createNativeClaudeStream([
            {
                type: 'message_start',
                message: {
                    id: 'msg_buffered',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-sonnet-4-5',
                    usage: {
                        input_tokens: 1200,
                        output_tokens: 0
                    },
                    content: []
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
                    text: 'Hello Claude Code'
                }
            },
            {
                type: 'content_block_stop',
                index: 0
            },
            {
                type: 'message_delta',
                delta: {
                    stop_reason: 'end_turn',
                    stop_sequence: null
                },
                usage: {
                    input_tokens: 3000,
                    output_tokens: 19
                }
            },
            {
                type: 'message_stop'
            }
        ]));

        const response = createMockResponse();

        await handleStreamRequest(
            response,
            {},
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }],
                stream: true
            },
            MODEL_PROTOCOL_PREFIX.CLAUDE,
            MODEL_PROVIDER.KIRO_API,
            'off',
            '',
            null,
            null,
            {
                bufferUntilComplete: true
            }
        );

        const payloads = response.write.mock.calls
            .map(([chunk]) => chunk)
            .filter((chunk) => typeof chunk === 'string' && chunk.startsWith('data: '))
            .map((chunk) => JSON.parse(chunk.slice('data: '.length).trim()));

        expect(response.writeHead).toHaveBeenCalledTimes(1);
        expect(payloads[0].type).toBe('message_start');
        expect(payloads[0].message.usage.input_tokens).toBe(3000);
        expect(payloads.at(-2).type).toBe('message_delta');
        expect(payloads.at(-2).usage.input_tokens).toBe(3000);
        expect(response.end).toHaveBeenCalledTimes(1);
    });

    test('handleStreamRequest 在缓冲等待期间会先发送 Claude ping 保活', async () => {
        generateContentStreamMock.mockResolvedValue((async function* () {
            await new Promise((resolve) => setTimeout(resolve, 20));
            yield {
                type: 'message_start',
                message: {
                    id: 'msg_ping',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-sonnet-4-5',
                    usage: {
                        input_tokens: 1000,
                        output_tokens: 0
                    },
                    content: []
                }
            };
            yield {
                type: 'message_delta',
                delta: {
                    stop_reason: 'end_turn',
                    stop_sequence: null
                },
                usage: {
                    input_tokens: 2400,
                    output_tokens: 8
                }
            };
            yield {
                type: 'message_stop'
            };
        })());

        const response = createMockResponse();

        await handleStreamRequest(
            response,
            {},
            'claude-sonnet-4-5',
            {
                messages: [{ role: 'user', content: 'hello' }],
                stream: true
            },
            MODEL_PROTOCOL_PREFIX.CLAUDE,
            MODEL_PROVIDER.KIRO_API,
            'off',
            '',
            null,
            null,
            {
                bufferUntilComplete: true,
                pingIntervalMs: 5
            }
        );

        const payloads = response.write.mock.calls
            .map(([chunk]) => chunk)
            .filter((chunk) => typeof chunk === 'string' && chunk.startsWith('data: '))
            .map((chunk) => JSON.parse(chunk.slice('data: '.length).trim()));

        expect(payloads[0]).toEqual({ type: 'ping' });
        expect(payloads.some((payload) => payload.type === 'message_start')).toBe(true);
        expect(payloads.find((payload) => payload.type === 'message_start').message.usage.input_tokens).toBe(2400);
    });
});
