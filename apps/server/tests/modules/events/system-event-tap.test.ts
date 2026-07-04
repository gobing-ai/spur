import { describe, expect, test } from 'bun:test';
import type { CreateSystemEventInput, SystemEventDao, SystemEventRow } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import { registerSystemEventTap } from '../../../src/modules/events/system-event-tap';

/** In-memory fake DAO recording every insert; optionally throws to exercise failure isolation. */
class FakeSystemEventDao {
    readonly inserted: CreateSystemEventInput[] = [];
    private readonly failOn?: number;
    private attempts = 0;

    constructor(opts: { failOn?: number } = {}) {
        this.failOn = opts.failOn;
    }

    async insert(input: CreateSystemEventInput): Promise<void> {
        this.attempts += 1;
        if (this.failOn !== undefined && this.attempts === this.failOn) {
            throw new Error(`synthetic failure on attempt ${this.attempts}`);
        }
        this.inserted.push(input);
    }

    async prune(): Promise<number> {
        return 0;
    }

    async query(): Promise<SystemEventRow[]> {
        return [];
    }

    async deleteAll(): Promise<void> {}
}

/** Minimal logger capturing warn calls for assertion. */
class CapturingLogger {
    readonly warns: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    warn(msg: string, data?: Record<string, unknown>): void {
        this.warns.push({ msg, data });
    }
    debug(): void {}
}

function fakeDao(opts?: { failOn?: number }): SystemEventDao {
    return new FakeSystemEventDao(opts) as unknown as SystemEventDao;
}

describe('registerSystemEventTap', () => {
    test('persists emitted planning events to the DAO', async () => {
        const dao = fakeDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const logger = new CapturingLogger();

        const tap = registerSystemEventTap(bus, dao, logger);
        await bus.emit('task.created', { entityId: '0001', actor: 'operator' });
        await tap.flush();

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.inserted).toHaveLength(1);
        expect(fake.inserted[0]?.event_name).toBe('task.created');
        expect(fake.inserted[0]?.actor).toBe('operator');
        expect(logger.warns).toHaveLength(0);

        tap.unsubscribe();
    });

    test('extracts actor from a nested payload object', async () => {
        const dao = fakeDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const tap = registerSystemEventTap(bus, dao, new CapturingLogger());

        await bus.emit('task.updated', { change: { field: 'status' }, actor: 'agent-7' });
        await tap.flush();

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.inserted[0]?.actor).toBe('agent-7');

        tap.unsubscribe();
    });

    test('persist failure is logged and does not reject bus.emit', async () => {
        const dao = fakeDao({ failOn: 1 });
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const logger = new CapturingLogger();

        const tap = registerSystemEventTap(bus, dao, logger);
        // emit must not throw — failure is isolated inside the tap.
        await bus.emit('task.updated', { entityId: '0002' });
        await tap.flush();

        expect(logger.warns).toHaveLength(1);
        const warn = logger.warns[0];
        expect(warn?.msg).toContain('system_events tap');
        expect(warn?.data?.name).toBe('task.updated');

        tap.unsubscribe();
    });

    test('persist failure on one event does not stop later events being attempted', async () => {
        const dao = fakeDao({ failOn: 1 });
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const logger = new CapturingLogger();
        const tap = registerSystemEventTap(bus, dao, logger);

        await bus.emit('task.created', {});
        await tap.flush();
        await bus.emit('task.created', {});
        await tap.flush();

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.inserted).toHaveLength(1);
        expect(logger.warns).toHaveLength(1);

        tap.unsubscribe();
    });

    test('unsubscribe detaches handlers — no further events are persisted', async () => {
        const dao = fakeDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const tap = registerSystemEventTap(bus, dao, new CapturingLogger());

        tap.unsubscribe();
        await bus.emit('task.created', { entityId: '0009' });
        await tap.flush();

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.inserted).toHaveLength(0);
    });

    test('flush resolves immediately when no persists are in flight', async () => {
        const dao = fakeDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const tap = registerSystemEventTap(bus, dao, new CapturingLogger());

        await tap.flush(); // no emit — nothing in flight
        tap.unsubscribe();
    });

    test('a second subscriber still receives events when the tap throws', async () => {
        const dao = fakeDao({ failOn: 1 });
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const logger = new CapturingLogger();

        const { promise, resolve } = Promise.withResolvers<unknown>();
        bus.on('task.created', () => resolve('second-subscriber-saw-it'));

        const tap = registerSystemEventTap(bus, dao, logger);
        await bus.emit('task.created', { entityId: '0003' });
        // Second subscriber resolved synchronously during emit; assert its signal.
        expect(await promise).toBe('second-subscriber-saw-it');
        await tap.flush();

        tap.unsubscribe();
        expect(logger.warns).toHaveLength(1);
    });
});
