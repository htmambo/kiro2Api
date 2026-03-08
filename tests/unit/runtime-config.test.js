import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
    applyEnvironmentOverrides,
    isWeakApiKey,
    normalizeAndValidateConfig,
    parseStringList
} from '../../src/config/runtime-config.js';

const logger = {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
};

describe('runtime config helpers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('parseStringList 支持逗号分隔字符串和数组', () => {
        expect(parseStringList('a, b ,c')).toEqual(['a', 'b', 'c']);
        expect(parseStringList(['x', ' y ', ''])).toEqual(['x', 'y']);
    });

    test('applyEnvironmentOverrides 会解析布尔值、数字和列表', () => {
        const config = {
            SERVER_PORT: 8088,
            OPEN_SERVER_URL: false,
            CORS_ALLOWED_ORIGINS: []
        };
        const env = {
            SERVER_PORT: '9090',
            OPEN_SERVER_URL: 'true',
            CORS_ALLOWED_ORIGINS: 'http://localhost:5173,https://example.com'
        };

        const nextConfig = applyEnvironmentOverrides(config, env, logger);

        expect(nextConfig.SERVER_PORT).toBe(9090);
        expect(nextConfig.OPEN_SERVER_URL).toBe(true);
        expect(nextConfig.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:5173', 'https://example.com']);
    });

    test('normalizeAndValidateConfig 会回退非法值', () => {
        const normalized = normalizeAndValidateConfig({
            SERVER_PORT: 'bad',
            REQUEST_RATE_LIMIT_MAX_REQUESTS: 0,
            CORS_ALLOWED_HEADERS: 'Authorization, Content-Type'
        }, logger);

        expect(normalized.SERVER_PORT).toBe(8088);
        expect(normalized.REQUEST_RATE_LIMIT_MAX_REQUESTS).toBe(60);
        expect(normalized.CORS_ALLOWED_HEADERS).toEqual(['Authorization', 'Content-Type']);
        expect(logger.warn).toHaveBeenCalled();
    });

    test('isWeakApiKey 能识别弱默认值', () => {
        expect(isWeakApiKey('123456')).toBe(true);
        expect(isWeakApiKey('your-secret-key-here')).toBe(true);
        expect(isWeakApiKey('custom-strong-key')).toBe(false);
    });
});
