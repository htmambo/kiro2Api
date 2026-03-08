import { describe, expect, test } from '@jest/globals';
import {
    createClaudeStreamBlockState,
    createInlineClientToolUseStreamState
} from '../../src/kiro/stream-block-manager.js';

describe('stream block manager', () => {
    test('text block 会按需开启、复用并关闭，同时累计文本内容', () => {
        const state = createClaudeStreamBlockState();

        expect(state.emitTextDelta('hello')).toEqual([
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' }
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'hello' }
            }
        ]);

        expect(state.emitTextDelta(' world')).toEqual([
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: ' world' }
            }
        ]);

        expect(state.closeTextBlock()).toEqual([
            {
                type: 'content_block_stop',
                index: 0
            }
        ]);

        expect(state.emitTextDelta('again')).toEqual([
            {
                type: 'content_block_start',
                index: 1,
                content_block: { type: 'text', text: '' }
            },
            {
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'text_delta', text: 'again' }
            }
        ]);

        expect(state.getTotalContent()).toBe('hello worldagain');
    });

    test('tool stream state 会在 finalize 时修复可恢复的 JSON', () => {
        const streamState = createInlineClientToolUseStreamState(
            {
                toolUseId: 'tool-read-malformed',
                name: 'readFile'
            },
            0
        );

        streamState.startEvents();
        streamState.appendInputChunk('{file_path:"/tmp/demo.txt",}');

        expect(streamState.finalizeEmittedToolCall()).toEqual({
            toolUseId: 'tool-read-malformed',
            name: 'Read',
            input: { file_path: '/tmp/demo.txt' }
        });
    });

    test('tool stream state 在无法修复 JSON 时会保留原始字符串而不是返回 null', () => {
        const streamState = createInlineClientToolUseStreamState(
            {
                toolUseId: 'tool-read-broken',
                name: 'readFile'
            },
            0
        );

        streamState.startEvents();
        streamState.appendInputChunk('{"path":"/tmp/demo.txt"');

        expect(streamState.finalizeEmittedToolCall()).toEqual({
            toolUseId: 'tool-read-broken',
            name: 'Read',
            input: '{"path":"/tmp/demo.txt"'
        });
    });
});
