import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@gobing-ai/ts-infra';
import { bridgeEventBus } from '../../src/services/event-bridge';

/** Minimal stub EventBus that records calls for assertion. */
function stubEventBus(): {
    bus: EventBus<Record<string, (event: unknown) => void>>;
    calls: Array<{ method: string; event: string; args: unknown[] }>;
} {
    const calls: Array<{ method: string; event: string; args: unknown[] }> = [];
    const bus = {
        on(event: string, listener: (event: unknown) => void) {
            calls.push({ method: 'on', event, args: [listener] });
        },
        off(event: string, listener: (event: unknown) => void) {
            calls.push({ method: 'off', event, args: [listener] });
        },
        emit(event: string, detail: unknown) {
            calls.push({ method: 'emit', event, args: [detail] });
            return Promise.resolve();
        },
    } as unknown as EventBus<Record<string, (event: unknown) => void>>;
    return { bus, calls };
}

describe('bridgeEventBus', () => {
    test('forwards on() to the server bus', () => {
        const { bus, calls } = stubEventBus();
        const bridged = bridgeEventBus(bus);

        const listener = (_e: unknown) => {};
        bridged.on('task.created', listener);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('on');
        expect(calls[0]?.event).toBe('task.created');
        expect(calls[0]?.args[0]).toBe(listener);
    });

    test('forwards off() to the server bus', () => {
        const { bus, calls } = stubEventBus();
        const bridged = bridgeEventBus(bus);

        const listener = (_e: unknown) => {};
        bridged.off('task.created', listener);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('off');
        expect(calls[0]?.event).toBe('task.created');
        expect(calls[0]?.args[0]).toBe(listener);
    });

    test('forwards emit() to the server bus and wraps in Promise.resolve', async () => {
        const { bus, calls } = stubEventBus();
        const bridged = bridgeEventBus(bus);

        const result = bridged.emit('task.created', { wbs: '0042' });

        expect(result).toBeInstanceOf(Promise);
        await result;

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('emit');
        expect(calls[0]?.event).toBe('task.created');
        expect(calls[0]?.args[0]).toEqual({ wbs: '0042' });
    });

    test('bridged bus carries the expected type parameter', () => {
        type MyEvents = Record<string, (event: unknown) => void>;

        const { bus } = stubEventBus();
        const bridged = bridgeEventBus<MyEvents>(bus);

        // The bridged bus is an object with on/off/emit — structural check.
        expect(typeof bridged.on).toBe('function');
        expect(typeof bridged.off).toBe('function');
        expect(typeof bridged.emit).toBe('function');
    });
});
