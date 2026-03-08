import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const handleContentGenerationRequestMock = jest.fn(async () => {});

const mockedEndpointType = {
    CLAUDE_MESSAGE: 'claude_message',
    CLAUDE_CODE_MESSAGE: 'claude_code_message'
};

jest.unstable_mockModule('../../src/utils/common.js', () => ({
    handleContentGenerationRequest: handleContentGenerationRequestMock,
    ENDPOINT_TYPE: mockedEndpointType,
    MODEL_PROVIDER: {
        KIRO_API: 'claude-kiro-oauth'
    }
}));

const { handleAPIRequests } = await import('../../src/api/manager.js');
const {
    isApiKeyProtectedPath,
    shouldAttemptApiHandling
} = await import('../../src/api/request-router-utils.js');

describe('Claude Code route alignment', () => {
    beforeEach(() => {
        handleContentGenerationRequestMock.mockClear();
    });

    test('cc 路径会进入 API 鉴权与处理判定', () => {
        expect(isApiKeyProtectedPath('/cc/v1/messages')).toBe(true);
        expect(shouldAttemptApiHandling('POST', '/cc/v1/messages')).toBe(true);
        expect(shouldAttemptApiHandling('GET', '/cc/v1/messages')).toBe(false);
    });

    test('handleAPIRequests 会把 /cc/v1/messages 分发到 CLAUDE_CODE_MESSAGE', async () => {
        const handled = await handleAPIRequests(
            'POST',
            '/cc/v1/messages',
            { method: 'POST' },
            {},
            { uuid: 'pool-1' },
            {},
            null,
            'prompt.log'
        );

        expect(handled).toBe(true);
        expect(handleContentGenerationRequestMock).toHaveBeenCalledTimes(1);
        expect(handleContentGenerationRequestMock.mock.calls[0][3]).toBe(mockedEndpointType.CLAUDE_CODE_MESSAGE);
    });
});
