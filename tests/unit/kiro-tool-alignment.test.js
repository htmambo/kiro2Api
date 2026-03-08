import { describe, expect, test } from '@jest/globals';
import { sanitizeMessages } from '../../src/kiro/message-sanitizer.js';
import { KiroService } from '../../src/kiro/adapter.js';

describe('kirors tool alignment', () => {
    test('sanitizeMessages 会移除孤立 tool_result', () => {
        const sanitized = sanitizeMessages([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'done' },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'missing-tool',
                        content: 'orphan result'
                    }
                ]
            }
        ]);

        const toolResults = sanitized
            .filter((message) => Array.isArray(message.content))
            .flatMap((message) => message.content.filter((part) => part.type === 'tool_result'));

        expect(toolResults).toHaveLength(0);
    });

    test('sanitizeMessages 不再伪造失败 tool_result，且会移除孤立 tool_use', () => {
        const sanitized = sanitizeMessages([
            { role: 'user', content: 'hello' },
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tool-1',
                        name: 'Read',
                        input: { file_path: '/tmp/demo.txt' }
                    }
                ]
            }
        ]);

        const allParts = sanitized
            .filter((message) => Array.isArray(message.content))
            .flatMap((message) => message.content);

        expect(allParts.find((part) => part.type === 'tool_use')).toBeUndefined();
        expect(allParts.find((part) => part.type === 'tool_result')).toBeUndefined();
        expect(JSON.stringify(sanitized)).not.toContain('Tool execution failed');
    });

    test('buildCodewhispererRequest 会保留当前 tool_result 的 error 状态，并补齐历史 placeholder tool', async () => {
        const service = new KiroService({});
        const request = await service.buildCodewhispererRequest(
            [
                { role: 'user', content: 'hello' },
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'Read',
                            input: { file_path: '/tmp/demo.txt' }
                        }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'tool-1',
                            content: 'permission denied',
                            is_error: true
                        }
                    ]
                }
            ],
            'claude-sonnet-4-5',
            []
        );

        const currentContext = request.conversationState.currentMessage.userInputMessage.userInputMessageContext;

        expect(currentContext.toolResults).toHaveLength(1);
        expect(currentContext.toolResults[0].status).toBe('error');
        expect(currentContext.tools).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    toolSpecification: expect.objectContaining({
                        name: 'readFile',
                        description: 'Tool used in conversation history'
                    })
                })
            ])
        );
    });

    test('buildCodewhispererRequest 会保留历史 tool_result 的 error 状态', async () => {
        const service = new KiroService({});
        const request = await service.buildCodewhispererRequest(
            [
                { role: 'user', content: 'hello' },
                {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'Read',
                            input: { file_path: '/tmp/demo.txt' }
                        }
                    ]
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: 'tool-1',
                            content: 'failed',
                            is_error: true
                        }
                    ]
                },
                { role: 'assistant', content: 'understood' },
                { role: 'user', content: 'continue' }
            ],
            'claude-sonnet-4-5',
            []
        );

        const history = request.conversationState.history;
        const historyToolResults = history[2].userInputMessage.userInputMessageContext.toolResults;

        expect(historyToolResults).toHaveLength(1);
        expect(historyToolResults[0].status).toBe('error');
    });
});
