import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { subscribePlanningConnection, subscribePlanningEvents } from '../../src/lib/planning-events';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';
import { FakePlanningSource } from './planning-source.fixture';

const originalEventSource = globalThis.EventSource;
const unsubscribes: Array<() => void> = [];
beforeAll(registerHappyDom);
afterAll(teardownHappyDom);
afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    globalThis.EventSource = originalEventSource;
    FakePlanningSource.instances = [];
});

describe('shared planning source', () => {
    test('opens lazily, parses once, filters malformed/non-planning frames, and ref-counts both listener kinds', () => {
        globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
        const received: unknown[] = [];
        const connection: boolean[] = [];
        expect(FakePlanningSource.instances).toHaveLength(0);
        const offEvent = subscribePlanningEvents((event) => received.push(event));
        const offSecond = subscribePlanningEvents((event) => received.push(event));
        const offConnection = subscribePlanningConnection((connected) => connection.push(connected));
        unsubscribes.push(offEvent, offSecond, offConnection);
        expect(FakePlanningSource.instances).toHaveLength(1);
        const source = FakePlanningSource.latest;
        expect(source.url).toEndWith('/events/planning');
        const parse = spyOn(JSON, 'parse');
        try {
            source.emit('task.updated', { wbs: '1301' });
            expect(parse).toHaveBeenCalledTimes(1);
        } finally {
            parse.mockRestore();
        }
        for (const raw of ['bad json', 'null', '[]', '{}', '{"eventName":42}', '{"eventName":""}']) {
            source.frame(raw);
        }
        source.emit('process.output', { cursor: 9 });
        source.emit('history.updated');
        expect(received).toEqual([
            { eventName: 'task.updated', payload: { wbs: '1301' } },
            { eventName: 'task.updated', payload: { wbs: '1301' } },
        ]);
        source.emit('feature.updated');
        source.emit('queue.job.completed');
        expect(received).toHaveLength(6);
        source.onopen?.();
        source.onerror?.();
        source.onopen?.();
        expect(connection).toEqual([false, true, false, true]);
        offEvent();
        offEvent(); // cleanup is idempotent
        offSecond();
        expect(source.closed).toBe(false); // the connection listener still owns it
        const lateMessage = source.onmessage;
        const lateOpen = source.onopen;
        offConnection();
        expect(source.closed).toBe(true);
        lateMessage?.({ data: '{"eventName":"task.updated"}' } as MessageEvent);
        lateOpen?.();
        expect(received).toHaveLength(6);
        expect(connection).toEqual([false, true, false, true]);

        const states: boolean[] = [];
        unsubscribes.push(subscribePlanningConnection((value) => states.push(value)));
        expect(states).toEqual([false]);
        expect(FakePlanningSource.instances).toHaveLength(2);
    });

    test('connection subscribers joining an open source see its current state; duplicate callbacks own separate subscriptions', () => {
        globalThis.EventSource = FakePlanningSource as unknown as typeof EventSource;
        const states: boolean[] = [];
        const listener = (value: boolean) => states.push(value);
        const first = subscribePlanningConnection(listener);
        unsubscribes.push(first);
        const source = FakePlanningSource.latest;
        source.onopen?.();
        const second = subscribePlanningConnection(listener);
        unsubscribes.push(second);
        expect(states).toEqual([false, true, true]);
        first();
        expect(source.closed).toBe(false);
        source.onerror?.();
        expect(states.at(-1)).toBe(false);
    });

    test('server rendering without EventSource remains disconnected and cleans up', () => {
        Reflect.deleteProperty(globalThis, 'EventSource');
        const states: boolean[] = [];
        unsubscribes.push(subscribePlanningEvents(() => {}));
        unsubscribes.push(subscribePlanningConnection((value) => states.push(value)));
        expect(states).toEqual([false]);
        expect(FakePlanningSource.instances).toHaveLength(0);
    });
});
