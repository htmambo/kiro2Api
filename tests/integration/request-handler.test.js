import http from 'http';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { estimateInputTokens } from '../../src/kiro/utils/token-counter.js';

process.env.UI_PASSWORD = 'test-password-for-jest';

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
        ...overrides
    };
}

describe('request handler smoke tests', () => {
    let server;

    beforeEach(() => {
        delete global.uiRouter;
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

    test('GET /health 返回 unified health payload', async () => {
        const response = await request(server)
            .get('/health')
            .expect(200);

        expect(response.body.status).toBe('healthy');
        expect(response.body.provider).toBe('claude-kiro-oauth');
    });

    test('GET /api/health 返回 UI health payload', async () => {
        const response = await request(server)
            .get('/api/health')
            .expect(200);

        expect(response.body.status).toBe('ok');
        expect(typeof response.body.timestamp).toBe('number');
    });

    test('POST /v1/messages 在缺少 API key 时返回 401', async () => {
        const response = await request(server)
            .post('/v1/messages')
            .send({
                model: 'claude-sonnet-4-5',
                max_tokens: 32,
                messages: [{ role: 'user', content: 'hello' }]
            })
            .expect(401);

        expect(response.body.error.message).toMatch(/Unauthorized/i);
    });

    test('POST /v1/chat/completions 已移除并返回 404', async () => {
        const response = await request(server)
            .post('/v1/chat/completions')
            .set('x-api-key', 'test-api-key')
            .send({
                model: 'claude-sonnet-4-5',
                messages: [{ role: 'user', content: 'hello' }]
            })
            .expect(404);

        expect(response.body.error.message).toBe('Not Found');
    });

    test('POST /v1/responses 已移除并返回 404', async () => {
        const response = await request(server)
            .post('/v1/responses')
            .set('x-api-key', 'test-api-key')
            .send({
                model: 'claude-sonnet-4-5',
                input: [{ role: 'user', content: 'hello' }]
            })
            .expect(404);

        expect(response.body.error.message).toBe('Not Found');
    });

    test('POST /v1/messages/count_tokens 返回 kirors 风格的 input_tokens', async () => {
        const requestBody = {
            model: 'claude-sonnet-4-5',
            system: 'You are helpful.',
            messages: [{ role: 'user', content: 'hello count tokens' }],
            tools: []
        };

        const response = await request(server)
            .post('/v1/messages/count_tokens')
            .set('x-api-key', 'test-api-key')
            .send(requestBody)
            .expect(200);

        expect(response.body).toEqual({
            input_tokens: Math.max(1, estimateInputTokens(requestBody, false))
        });
    });

    test('POST /cc/v1/messages/count_tokens 与 /v1/messages/count_tokens 保持一致', async () => {
        const requestBody = {
            model: 'claude-sonnet-4-5',
            messages: [{ role: 'user', content: 'hello cc count tokens' }]
        };

        const response = await request(server)
            .post('/cc/v1/messages/count_tokens')
            .set('x-api-key', 'test-api-key')
            .send(requestBody)
            .expect(200);

        expect(response.body).toEqual({
            input_tokens: Math.max(1, estimateInputTokens(requestBody, false))
        });
    });

    test('GET /api/system 在缺少 UI token 时返回 401', async () => {
        const response = await request(server)
            .get('/api/system')
            .expect(401);

        expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('POST /api/admin-password 已下线并返回 404', async () => {
        const response = await request(server)
            .post('/api/admin-password')
            .send({ password: 'new-password' })
            .expect(404);

        expect(response.body.error.message).toBe('Not Found');
    });

    test('OPTIONS 预检仅对允许的 Origin 返回 CORS 头', async () => {
        const corsServer = http.createServer(createRequestHandler(createTestConfig({
            CORS_ALLOWED_ORIGINS: ['http://localhost:5173']
        }), null));

        const response = await request(corsServer)
            .options('/api/health')
            .set('Origin', 'http://localhost:5173')
            .expect(204);

        expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
        expect(response.headers['access-control-allow-methods']).toContain('GET');

        if (corsServer.listening) {
            await new Promise((resolve) => corsServer.close(resolve));
        }
    });
});
