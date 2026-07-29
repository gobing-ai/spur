import { describe, expect, test } from 'bun:test';
import type {
    CreateSystemEventInput,
    SystemEventDao,
    SystemEventRetentionQuota,
    SystemEventRow,
} from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import { normalizeSystemEventPayload } from '../../src/services/event-names';
import { registerSystemEventTap } from '../../src/services/system-event-tap';

/** In-memory fake DAO recording every insert and pruneQuotas call. */
class FakeSystemEventDao {
    readonly inserted: CreateSystemEventInput[] = [];
    readonly pruneCalls: Array<{ quotas: SystemEventRetentionQuota[]; prefix?: string }> = [];
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

    async pruneQuotas(quotas: SystemEventRetentionQuota[], prefix?: string): Promise<number> {
        this.pruneCalls.push({ quotas, prefix });
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

    test('redacts sensitive workflow payload fields before persistence', async () => {
        const dao = fakeDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const tap = registerSystemEventTap(bus, dao, new CapturingLogger());

        await bus.emit('workflow.hitl.ask', {
            runId: 'run-1',
            query: 'secret approval prompt',
            message: 'secret message',
            actor: 'operator',
        });
        await tap.flush();

        const fake = dao as unknown as FakeSystemEventDao;
        const payload = JSON.parse(fake.inserted[0]?.payload_json ?? '{}') as Record<string, unknown>;
        expect(payload.query).toBe('[redacted]');
        expect(payload.message).toBe('[redacted]');
        expect(payload.runId).toBe('run-1');

        tap.unsubscribe();
    });

    test('normalizes primitive payloads for generic persistence', () => {
        const payload = normalizeSystemEventPayload(
            {
                name: 'task.updated',
                prefix: 'task',
                source: 'planning',
                tier: 'default',
                persisted: true,
                streamed: true,
                payloadPolicy: 'metadata-only',
                renderer: 'planning',
            },
            'ok',
        );
        expect(payload).toEqual({ value: 'ok' });
    });

    test('redacts sensitive fields for the redacted payload policy', () => {
        const payload = normalizeSystemEventPayload(
            {
                name: 'workflow.hitl.ask',
                prefix: 'workflow',
                source: 'workflow',
                tier: 'default',
                persisted: true,
                streamed: true,
                payloadPolicy: 'redacted',
                renderer: 'workflow-hitl',
            },
            { runId: 'run-1', message: 'secret prompt text', node: 'review' },
        );
        expect(payload).toEqual({ runId: 'run-1', message: '[redacted]', node: 'review' });
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

    test('persist prunes per-prefix — only the just-written prefix is pruned (R5)', async () => {
        const dao = fakeDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const logger = new CapturingLogger();

        const tap = registerSystemEventTap(bus, dao, logger);
        await bus.emit('task.created', { entityId: '0001' });
        await tap.flush();

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.pruneCalls).toHaveLength(1);
        // The just-written prefix is passed for scoped eviction.
        expect(fake.pruneCalls[0]?.prefix).toBe('task');
        // Quotas resolved from defaults cover the catalog prefixes.
        expect(fake.pruneCalls[0]?.quotas.length).toBeGreaterThan(0);
        expect(fake.pruneCalls[0]?.quotas.some((q) => q.prefix === 'task')).toBe(true);

        tap.unsubscribe();
    });
    test('R1 — diagnostic heartbeat events skip persistence when diagnostic toggle is off', async () => {
        const dao = fakeDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const tap = registerSystemEventTap(bus, dao, new CapturingLogger());

        // The three self-observation heartbeat events are demoted to the
        // diagnostic tier; without the toggle they must not persist.
        await bus.emit('queue.job.enqueued', { jobId: 'j1' });
        await bus.emit('queue.job.completed', { jobId: 'j1' });
        await bus.emit('scheduler.job.executed', { jobId: 'j1' });
        // A default-tier event still persists, proving the tap is wired.
        await bus.emit('task.created', { entityId: '0001' });
        await tap.flush();

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.inserted.map((r) => r.event_name)).toEqual(['task.created']);

        tap.unsubscribe();
    });
});
