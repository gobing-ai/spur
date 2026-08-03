import { describe, expect, test } from 'bun:test';
import events from 'node:events';
import util from 'node:util';

type UtilTypesWithEventTarget = typeof util.types & {
    isEventTarget?: (target: unknown) => boolean;
};

describe('node:events setMaxListeners with AbortSignal', () => {
    test('util.types.isEventTarget identifies AbortSignal', () => {
        const controller = new AbortController();
        const utilTypes = util.types as UtilTypesWithEventTarget;
        expect(utilTypes.isEventTarget?.(controller.signal)).toBe(true);
    });

    test('allows setMaxListeners on AbortSignal without throwing', () => {
        const controller = new AbortController();
        expect(() => events.setMaxListeners(10, controller.signal)).not.toThrow();
    });

    test('invokes setMaxListeners fallback function if present', () => {
        const controller = new AbortController();
        const signal = controller.signal as unknown as { setMaxListeners?: (n?: number) => void };
        if (typeof signal.setMaxListeners === 'function') {
            expect(() => signal.setMaxListeners?.(10)).not.toThrow();
        }
    });
});
