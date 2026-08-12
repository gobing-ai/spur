import { describe, expect, test } from 'bun:test';
import type {
    CreateSystemEventInput,
    SystemEventDao,
    SystemEventRetentionQuota,
    SystemEventRow,
} from '@gobing-ai/spur-domain';
import type { PlanningEvent } from '../../src/services/planning-write-service';
import { SystemEventEmitter, type SystemEventEmitterLogger } from '../../src/services/system-event-emitter';

/**
 * In-memory fake DAO recording every insert; optionally throws on a configured
 * attempt to exercise failure isolation (R5). Mirrors the tap-test fake so the
 * two stay behaviorally aligned (R3 — one canonical serialization).
 */
class FakeSystemEventDao {
    readonly inserted: CreateSystemEventInput[] = [];
    private readonly failOn?: number;
    private attempts = 0;
    readonly pruneCalls: Array<{ quotas: SystemEventRetentionQuota[]; prefix?: string }> = [];

    constructor(opts: { failOn?: number } = {}) {
        this.failOn = opts.failOn;
    }

    async insert(input: CreateSystemEventInput): Promise<void> {
        this.attempts += 1;
        if (this.failOn !== undefined && this.attempts === this.failOn) {
            throw new Error(`synthetic insert failure on attempt ${this.attempts}`);
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

/** Capturing logger so tests can assert R5 swallow-and-warn semantics. */
class CapturingLogger {
    readonly warns: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    warn(msg: string, data?: Record<string, unknown>): void {
        this.warns.push({ msg, data });
    }
}

function makeEvent(overrides: Partial<PlanningEvent> = {}): PlanningEvent {
    return {
        event: 'task.transitioned',
        entity: { kind: 'task', id: '0042' },
        at: '2026-07-13T15:00:00.000Z',
        from: 'todo',
        to: 'wip',
        ...overrides,
    } as PlanningEvent;
}

/** Safe JSON parse for the in-memory fake DAO payload; returns null on failure. */
function parsePayload(json: string | null | undefined): Record<string, unknown> | null {
    if (!json) return null;
    try {
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

describe('SystemEventEmitter', () => {
    test('persists a registered planning event with normalized payload + actor', async () => {
        const dao = new FakeSystemEventDao();
        const logger = new CapturingLogger();
        const emitter = new SystemEventEmitter(
            dao as unknown as SystemEventDao,
            logger as unknown as SystemEventEmitterLogger,
        );

        await emitter.emit(makeEvent({ event: 'task.transitioned', from: 'todo', to: 'wip' }));

        expect(dao.inserted).toHaveLength(1);
        const row = dao.inserted[0];
        expect(row?.event_name).toBe('task.transitioned');
        expect(row?.occurred_at).toBe('2026-07-13T15:00:00.000Z');
        // PlanningEvent carries no `actor` field → extractSystemEventActor returns null.
        expect(row?.actor).toBeNull();
        // Payload is the normalized event (from/to preserved, no body-redaction keys present).
        const payload = parsePayload(row?.payload_json);
        expect(payload?.schemaVersion).toBe(2);
        const data = payload?.data as Record<string, unknown> | undefined;
        expect(data?.event).toBe('task.transitioned');
        expect(data?.from).toBe('todo');
        expect(data?.to).toBe('wip');
        // Insert-time per-prefix prune (R5): called once, scoped to the just-
        // written prefix so planning overflow never evicts other prefixes.
        expect(dao.pruneCalls).toHaveLength(1);
        expect(dao.pruneCalls[0]?.prefix).toBe('task');
        expect(logger.warns).toHaveLength(0);
    });

    test('redacts configured secrets before the planning event reaches the DAO', async () => {
        const dao = new FakeSystemEventDao();
        const secret = 'planning-private-value';
        const emitter = new SystemEventEmitter(
            dao as unknown as SystemEventDao,
            new CapturingLogger() as unknown as SystemEventEmitterLogger,
            {},
            [secret],
        );

        await emitter.emit(makeEvent({ event: 'task.transitioned', from: `contains ${secret}` }));

        expect(dao.inserted[0]?.payload_json).toContain('[REDACTED]');
        expect(dao.inserted[0]?.payload_json).not.toContain(secret);
    });

    test('persists entity identity into the indexed correlation columns', async () => {
        // The CLI write path must land the same correlation columns as the
        // server tap, or a CLI-driven status change is invisible to an
        // entity-scoped query (task 0369 R3).
        const dao = new FakeSystemEventDao();
        const emitter = new SystemEventEmitter(
            dao as unknown as SystemEventDao,
            new CapturingLogger() as unknown as SystemEventEmitterLogger,
        );

        await emitter.emit(makeEvent({ event: 'task.updated', entity: { kind: 'task', id: '0369' } }));

        const row = dao.inserted[0];
        expect(row?.entity_kind).toBe('task');
        expect(row?.entity_id).toBe('0369');
        // Planning events carry no run identity.
        expect(row?.run_id).toBeNull();
        expect(row?.sequence).toBeNull();
    });

    test('emits feature.created with the entity kind carried through', async () => {
        const dao = new FakeSystemEventDao();
        const emitter = new SystemEventEmitter(
            dao as unknown as SystemEventDao,
            new CapturingLogger() as unknown as SystemEventEmitterLogger,
        );

        await emitter.emit(
            makeEvent({
                event: 'feature.created',
                entity: { kind: 'feature', id: 'J' },
            }),
        );

        expect(dao.inserted).toHaveLength(1);
        expect(dao.inserted[0]?.event_name).toBe('feature.created');
        const payload = parsePayload(dao.inserted[0]?.payload_json);
        const data = payload?.data as Record<string, unknown> | undefined;
        const entity = data?.entity as Record<string, unknown> | undefined;
        expect(entity?.kind).toBe('feature');
    });

    test('skips unregistered event names without touching the DAO', async () => {
        const dao = new FakeSystemEventDao();
        const emitter = new SystemEventEmitter(
            dao as unknown as SystemEventDao,
            new CapturingLogger() as unknown as SystemEventEmitterLogger,
        );

        // PlanningEventName narrows the union; cast an unregistered name through
        // `unknown` to exercise the skip path — a future name must be a no-op,
        // not a persistence error.
        const unknownEvent = { ...makeEvent(), event: 'task.unknown' } as unknown as PlanningEvent;
        await emitter.emit(unknownEvent);

        // Unregistered event was a no-op — no insert, no prune.
        expect(dao.inserted).toHaveLength(0);
        expect(dao.pruneCalls).toHaveLength(0);
    });

    test('swallows a DAO insert failure and warns (R5) without throwing', async () => {
        const dao = new FakeSystemEventDao({ failOn: 1 });
        const logger = new CapturingLogger();
        const emitter = new SystemEventEmitter(
            dao as unknown as SystemEventDao,
            logger as unknown as SystemEventEmitterLogger,
        );

        // Must NOT throw — the file mutation must proceed regardless of sink state.
        await expect(emitter.emit(makeEvent({ event: 'task.updated' }))).resolves.toBeUndefined();

        expect(dao.inserted).toHaveLength(0);
        expect(logger.warns).toHaveLength(1);
        expect(logger.warns[0]?.msg).toContain('system_events emitter: persist failed');
        expect(logger.warns[0]?.data?.event).toBe('task.updated');
        expect(logger.warns[0]?.data?.error).toContain('synthetic insert failure');
    });

    test('honors the append-only cap on every insert (R7)', async () => {
        const dao = new FakeSystemEventDao();
        const emitter = new SystemEventEmitter(
            dao as unknown as SystemEventDao,
            new CapturingLogger() as unknown as SystemEventEmitterLogger,
        );

        await emitter.emit(makeEvent({ event: 'task.created', entity: { kind: 'task', id: '0001' } }));
        await emitter.emit(makeEvent({ event: 'task.updated', entity: { kind: 'task', id: '0001' } }));
        await emitter.emit(makeEvent({ event: 'task.transitioned', entity: { kind: 'task', id: '0001' } }));
        expect(dao.inserted).toHaveLength(3);
        // One per-prefix prune per persisted row — eviction stays on the emit
        // path, scoped to the just-written prefix (R5).
        expect(dao.pruneCalls).toHaveLength(3);
        expect(dao.pruneCalls.every((c) => c.prefix === 'task')).toBe(true);
    });
});
