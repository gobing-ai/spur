import { describe, expect, test } from 'bun:test';
import { enqueueSseFrame, sendSseKeepalive } from '../../../src/modules/sse/stream-helpers';

function makeController(): {
    controller: ReadableStreamDefaultController;
    chunks: Uint8Array[];
    closed: boolean;
} {
    const chunks: Uint8Array[] = [];
    let closed = false;
    const controller = {
        enqueue(chunk: Uint8Array) {
            if (closed) throw new Error('controller closed');
            chunks.push(chunk);
        },
        close() {
            closed = true;
        },
    } as unknown as ReadableStreamDefaultController;
    return { controller, chunks, closed: false };
}

describe('sendSseKeepalive', () => {
    test('enqueues a keepalive comment frame', () => {
        const { controller, chunks } = makeController();
        const encoder = new TextEncoder();
        sendSseKeepalive({ current: false }, controller, encoder);
        expect(chunks).toHaveLength(1);
        expect(new TextDecoder().decode(chunks[0])).toBe(': keepalive\n\n');
    });

    test('is a no-op when the stream is already closed', () => {
        const { controller, chunks } = makeController();
        const encoder = new TextEncoder();
        sendSseKeepalive({ current: true }, controller, encoder);
        expect(chunks).toHaveLength(0);
    });

    test('swallows enqueue errors (controller already closed)', () => {
        const encoder = new TextEncoder();
        const controller = {
            enqueue() {
                throw new Error('already closed');
            },
        } as unknown as ReadableStreamDefaultController;
        // Must not throw.
        sendSseKeepalive({ current: false }, controller, encoder);
    });
});

describe('enqueueSseFrame', () => {
    test('enqueues a JSON data frame and returns true', () => {
        const { controller, chunks } = makeController();
        const encoder = new TextEncoder();
        const ok = enqueueSseFrame({ current: false }, controller, encoder, { type: 'ping' });
        expect(ok).toBe(true);
        expect(chunks).toHaveLength(1);
        expect(new TextDecoder().decode(chunks[0])).toBe('data: {"type":"ping"}\n\n');
    });

    test('returns false when the stream is closed without enqueuing', () => {
        const { controller, chunks } = makeController();
        const encoder = new TextEncoder();
        const ok = enqueueSseFrame({ current: true }, controller, encoder, { type: 'ping' });
        expect(ok).toBe(false);
        expect(chunks).toHaveLength(0);
    });

    test('returns false when enqueue throws', () => {
        const encoder = new TextEncoder();
        const controller = {
            enqueue() {
                throw new Error('already closed');
            },
        } as unknown as ReadableStreamDefaultController;
        const ok = enqueueSseFrame({ current: false }, controller, encoder, { x: 1 });
        expect(ok).toBe(false);
    });
});
