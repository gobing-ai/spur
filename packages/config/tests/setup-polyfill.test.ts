import { describe, expect, test } from 'bun:test';
import events from 'node:events';

describe('events.setMaxListeners polyfill', () => {
    test('handles valid target without throwing', () => {
        const target = new events.EventEmitter();
        expect(() => events.setMaxListeners(10, target)).not.toThrow();
    });

    test('handles non-EventTarget by catching ERR_INVALID_ARG_TYPE gracefully', () => {
        // Passing an invalid target triggers the catch path when node:events validates target type
        const fakeTarget = {} as unknown as EventTarget;
        expect(() => events.setMaxListeners(10, fakeTarget)).not.toThrow();
    });
});
