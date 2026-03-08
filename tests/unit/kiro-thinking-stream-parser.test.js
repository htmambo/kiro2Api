import { describe, expect, test } from '@jest/globals';
import { createClaudeStreamBlockState } from '../../src/kiro/stream-block-manager.js';
import { createThinkingStreamParser } from '../../src/kiro/thinking-stream-parser.js';

function collectDeltaText(events, deltaType, fieldName) {
    return events
        .filter((event) => event.type === 'content_block_delta' && event.delta?.type === deltaType)
        .map((event) => event.delta[fieldName])
        .join('');
}

describe('thinking stream parser', () => {
    test('原生 thinking 增量会开启 thinking block 并发送 thinking_delta', () => {
        const parser = createThinkingStreamParser({
            enableThinking: true,
            streamBlockState: createClaudeStreamBlockState()
        });

        expect(parser.processNativeThinkingDelta('step one')).toEqual([
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'thinking', thinking: '' }
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: 'step one' }
            }
        ]);
        expect(parser.getThinkingContent()).toBe('step one');
    });

    test('只有 `</thinking>\\n\\n` 才会结束 thinking，并把后续内容作为 text', () => {
        const parser = createThinkingStreamParser({
            enableThinking: true,
            streamBlockState: createClaudeStreamBlockState()
        });

        const events = [
            ...parser.processContentChunk('<thinking>abc</thinking>\n\ntext'),
            ...parser.flushRemainingBuffer()
        ];

        expect(events[0]).toEqual({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '' }
        });
        expect(collectDeltaText(events, 'thinking_delta', 'thinking')).toBe('abc');
        expect(events.some((event) => event.type === 'content_block_stop' && event.index === 0)).toBe(true);
        expect(collectDeltaText(events, 'text_delta', 'text')).toBe('text');
    });

    test('被引号包裹的 thinking 标签不会被误识别', () => {
        const parser = createThinkingStreamParser({
            enableThinking: true,
            streamBlockState: createClaudeStreamBlockState()
        });

        const rawText = 'use `<thinking>` and "</thinking>" literally';
        const events = [
            ...parser.processContentChunk(rawText),
            ...parser.flushRemainingBuffer()
        ];

        expect(events.some((event) => event.content_block?.type === 'thinking')).toBe(false);
        expect(collectDeltaText(events, 'text_delta', 'text')).toBe(rawText);
    });

    test('tool_use 前会过滤 buffer 末尾残留的 </thinking> 并先关闭 thinking block', () => {
        const parser = createThinkingStreamParser({
            enableThinking: true,
            streamBlockState: createClaudeStreamBlockState()
        });

        const events = [
            ...parser.processContentChunk('<thinking>abc</thinking>'),
            ...parser.flushBufferedPlainTextBeforeToolUse()
        ];

        expect(collectDeltaText(events, 'thinking_delta', 'thinking')).toBe('abc');
        expect(events.some((event) => event.type === 'content_block_stop' && event.index === 0)).toBe(true);
        expect(events.every((event) => event.delta?.thinking !== '</thinking>')).toBe(true);
    });

    test('flushRemainingBuffer 在末尾边界场景会过滤独立的 </thinking>', () => {
        const parser = createThinkingStreamParser({
            enableThinking: true,
            streamBlockState: createClaudeStreamBlockState()
        });

        const events = [
            ...parser.processContentChunk('<thinking>abc</thinking>'),
            ...parser.flushRemainingBuffer()
        ];

        expect(collectDeltaText(events, 'thinking_delta', 'thinking')).toBe('abc');
        expect(events.every((event) => event.delta?.thinking !== '</thinking>')).toBe(true);
    });

    test('thinking 起始后的首个换行会被剥离，跨 chunk 也一致', () => {
        const parser = createThinkingStreamParser({
            enableThinking: true,
            streamBlockState: createClaudeStreamBlockState()
        });

        const events = [
            ...parser.processContentChunk('<thinking>'),
            ...parser.processContentChunk('\nabc</thinking>\n\ntext'),
            ...parser.flushRemainingBuffer()
        ];

        expect(collectDeltaText(events, 'thinking_delta', 'thinking')).toBe('abc');
        expect(collectDeltaText(events, 'text_delta', 'text')).toBe('text');
    });
});
