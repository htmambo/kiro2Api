import { describe, expect, jest, test } from '@jest/globals';

jest.unstable_mockModule('../../src/kiro/auth.js', () => ({
    initializeAuth: jest.fn(async () => {})
}));

jest.unstable_mockModule('../../src/kiro/request-utils.js', () => ({
    getRetryConfig: jest.fn(() => ({ maxRetries: 0, baseDelay: 0 }))
}));

jest.unstable_mockModule('../../src/kiro/request-executor.js', () => ({
    executeKiroRequest: jest.fn()
}));

const { parseAwsEventStreamBuffer } = await import('../../src/kiro/streaming.js');

function encodeHeader(name, value) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const valueBuffer = Buffer.from(value, 'utf8');
    const header = Buffer.alloc(1 + nameBuffer.length + 1 + 2 + valueBuffer.length);

    let offset = 0;
    header.writeUInt8(nameBuffer.length, offset);
    offset += 1;
    nameBuffer.copy(header, offset);
    offset += nameBuffer.length;
    header.writeUInt8(7, offset);
    offset += 1;
    header.writeUInt16BE(valueBuffer.length, offset);
    offset += 2;
    valueBuffer.copy(header, offset);

    return header;
}

function createAwsEventStreamMessage({ headers, payload }) {
    const headerBuffers = Object.entries(headers).map(([name, value]) => encodeHeader(name, value));
    const headersBuffer = Buffer.concat(headerBuffers);
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const totalLength = 12 + headersBuffer.length + payloadBuffer.length + 4;
    const message = Buffer.alloc(totalLength);

    message.writeUInt32BE(totalLength, 0);
    message.writeUInt32BE(headersBuffer.length, 4);
    message.writeUInt32BE(0, 8);
    headersBuffer.copy(message, 12);
    payloadBuffer.copy(message, 12 + headersBuffer.length);
    message.writeUInt32BE(0, totalLength - 4);

    return message;
}

describe('AWS Event Stream parser', () => {
    test('parseAwsEventStreamBuffer 会把 contextUsageEvent 解析为 contextUsage 事件', () => {
        const frame = createAwsEventStreamMessage({
            headers: {
                ':event-type': 'contextUsageEvent',
                ':content-type': 'application/json',
                ':message-type': 'event'
            },
            payload: JSON.stringify({
                contextUsagePercentage: 1.5
            })
        });

        const result = parseAwsEventStreamBuffer(frame);

        expect(result.remaining).toEqual(Buffer.alloc(0));
        expect(result.events).toEqual([
            {
                type: 'contextUsage',
                data: {
                    contextUsagePercentage: 1.5
                }
            }
        ]);
    });

    test('parseAwsEventStreamBuffer 会把 exception message 解析为 exception 事件', () => {
        const frame = createAwsEventStreamMessage({
            headers: {
                ':event-type': 'internalServerException',
                ':content-type': 'application/json',
                ':message-type': 'exception',
                ':exception-type': 'ContentLengthExceededException'
            },
            payload: 'Input too long'
        });

        const result = parseAwsEventStreamBuffer(frame);

        expect(result.remaining).toEqual(Buffer.alloc(0));
        expect(result.events).toEqual([
            {
                type: 'exception',
                data: {
                    exceptionType: 'ContentLengthExceededException',
                    message: 'Input too long'
                }
            }
        ]);
    });
});
