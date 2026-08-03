import { describe, expect, test } from 'bun:test';
import events from 'node:events';

describe('node:events setMaxListeners with AbortSignal', () => {
    test('allows setMaxListeners on AbortSignal without throwing', () => {
        const controller = new AbortController();
        expect(() => events.setMaxListeners(10, controller.signal)).not.toThrow();
    });

    test('AbortSignal prototype includes setMaxListeners function fallback', () => {
        const controller = new AbortController();
        const signal = controller.signal as unknown as { setMaxListeners?: (n?: number) => void };
        expect(typeof signal.setMaxListeners).toBe('function');
        expect(() => signal.setMaxListeners?.(10)).not.toThrow();
    });
});
