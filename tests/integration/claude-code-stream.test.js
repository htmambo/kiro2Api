import http from 'http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

process.env.UI_PASSWORD = 'test-password-for-jest';

const generateContentStreamMock = jest.fn();
const getApiServiceMock = jest.fn();

jest.unstable_mockModule('../../src/kiro/api-client.js', () => ({
    generateContentStream: generateContentStreamMock,
    generateContent: jest.fn(),
    getUsageLimits: jest.fn(async () => ({
        limits: [],
        subscriptions: []
    }))
}));

jest.unstable_mockModule('../../src/services/manager.js', () => ({
    getApiService: getApiServiceMock,
    getAccountPoolManager: jest.fn(() => null),
    getServiceAdapter: jest.fn(() => null),
    initApiService: jest.fn(async () => ({})),
    serviceInstances: {}
}));

const { createRequestHandler } = await import('../../src/api/request-handler.js');

function createTestConfig(overrides = {}) {
    return {
        REQUIRED_API_KEY: 'test-api-key',
        MODEL_PROVIDER: 'claude-kiro-oauth',
        PROMPT_LOG_MODE: 'none',
        REQUEST_RATE_LIMIT_WINDOW_MS: 60_000,
        REQUEST_RATE_LIMIT_MAX_REQUESTS: 1_000,
        REQUEST_RATE_LIMIT_WHITELIST_PATHS: ['/health', '/api/health', '/favicon.ico', '/public/'],
        REQUEST_RATE_LIMIT_TRUSTED_PROXIES: [],
        OPEN_SERVER_URL: false,
        CORS_ALLOWED_ORIGINS: [],
        CORS_ALLOWED_HEADERS: ['Content-Type', 'Authorization', 'x-api-key', 'x-goog-api-key', 'Model-Provider'],
        CORS_ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        CLAUDE_CODE_STREAM_PING_INTERVAL_MS: 5,
        ...overrides
    };
}

function parseSsePayloads(rawText) {
    return String(rawText)
        .trim()
        .split('\n\n')
        .filter(Boolean)
        .map((entry) => {
            const dataLine = entry
                .split('\n')
                .find((line) => line.startsWith('data: '));
            return JSON.parse(dataLine.slice('data: '.length));
        });
}

describe('/cc/v1/messages SSE alignment', () => {
    let server;

    beforeEach(() => {
        delete global.uiRouter;
        generateContentStreamMock.mockReset();
        getApiServiceMock.mockReset();
        getApiServiceMock.mockResolvedValue({
            service: {
                isInitialized: true,
                modelName: 'claude-sonnet-4-5',
                verboseLogging: false,
                config: {
                    ENABLE_THINKING_BY_DEFAULT: false
                }
            },
            resolvedConfig: createTestConfig()
        });

        server = http.createServer(createRequestHandler(createTestConfig(), null));
    });

    afterEach((done) => {
        delete global.uiRouter;
        if (!server.listening) {
            done();
            return;
        }
        server.close(done);
    });

    test('/cc/v1/messages 会先发送 ping，再输出回填过 input_tokens 的 message_start', async () => {
        generateContentStreamMock.mockResolvedValue((async function* () {
            await new Promise((resolve) => setTimeout(resolve, 20));
            yield {
                type: 'message_start',
                message: {
                    id: 'msg_cc_1',
                    type: 'message',
                    role: 'assistant',
                    model: 'claude-sonnet-4-5',
                    usage: {
                        input_tokens: 1200,
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
                    input_tokens: 3600,
                    output_tokens: 10
                }
            };
            yield {
                type: 'message_stop'
            };
        })());

        const response = await request(server)
            .post('/cc/v1/messages')
            .set('x-api-key', 'test-api-key')
            .send({
                model: 'claude-sonnet-4-5',
                stream: true,
                max_tokens: 32,
                messages: [{ role: 'user', content: 'hello' }]
            })
            .expect(200);

        expect(response.headers['content-type']).toContain('text/event-stream');

        const payloads = parseSsePayloads(response.text);

        expect(payloads[0]).toEqual({ type: 'ping' });
        const messageStartIndex = payloads.findIndex((payload) => payload.type === 'message_start');
        expect(messageStartIndex).toBeGreaterThan(0);
        expect(payloads.slice(0, messageStartIndex).every((payload) => payload.type === 'ping')).toBe(true);
        expect(payloads[messageStartIndex].message.usage.input_tokens).toBe(3600);
        expect(payloads.at(-2).type).toBe('message_delta');
        expect(payloads.at(-2).usage.input_tokens).toBe(3600);
        expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    });
});
