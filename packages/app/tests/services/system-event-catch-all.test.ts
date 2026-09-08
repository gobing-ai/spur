import { describe, expect, test } from 'bun:test';
import {
    applyCliMigrations,
    type CreateSystemEventInput,
    SystemEventDao,
    type SystemEventRetentionQuota,
    type SystemEventRow,
} from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import { systemEventCatalogEntry } from '../../src/services/event-names';
import {
    createSystemEventCatchAllSink,
    ensureRetentionQuotaForPrefix,
    GENERIC_SYSTEM_EVENT_RENDERER,
    genericSystemEventCatalogEntry,
    installSystemEventCatchAll,
    SYSTEM_EVENT_UNCATALOGED_WARN_EVENT,
} from '../../src/services/system-event-catch-all';
import { buildSystemEventEnvelope, systemEventProjectContext } from '../../src/services/system-event-envelope';
import {
    DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA,
    resolveRetentionQuotas,
} from '../../src/services/system-event-retention';
import type { SystemEventBus } from '../../src/services/system-event-tap';

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

function makeBus(): SystemEventBus {
    return new EventBus<Record<string, (event: unknown) => void>>();
}

function parsePayload(json: string | null | undefined): Record<string, unknown> | null {
    if (!json) return null;
    try {
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

describe('genericSystemEventCatalogEntry', () => {
    test('derives the prefix from the first dot-segment and marks the generic renderer', () => {
        const entry = genericSystemEventCatalogEntry('db.connection.error');
        expect(entry.prefix).toBe('db');
        expect(entry.renderer).toBe(GENERIC_SYSTEM_EVENT_RENDERER);
        expect(entry.tier).toBe('default');
        expect(entry.persisted).toBe(true);
        expect(entry.streamed).toBe(true);
        expect(entry.payloadPolicy).toBe('metadata-only');
        expect(entry.producerPackage).toBe('spur');
        expect(entry.subsystem).toBe('unknown');
        expect(entry.severity).toBe('info');
        expect(entry.metadataFields).toEqual([]);
        expect(entry.remediationKind).toBe('none');
    });

    test('falls back to the full name as prefix when the name has no dot', () => {
        expect(genericSystemEventCatalogEntry('daemonbeat').prefix).toBe('daemonbeat');
    });

    test('keeps an empty prefix for an empty name (task 0802 R1 pin)', () => {
        expect(genericSystemEventCatalogEntry('').prefix).toBe('');
    });

    test('does not infer severity from the name — info is the default (Q5)', () => {
        // Even a failure-sounding name must not be escalated: severity comes
        // from the payload envelope path only.
        expect(genericSystemEventCatalogEntry('db.connection.failed').severity).toBe('info');
    });
});

describe('createSystemEventCatchAllSink', () => {
    test('persists an uncataloged event through the shared envelope path (D3a)', async () => {
        const dao = fakeDao();
        const logger = new CapturingLogger();
        const sink = createSystemEventCatchAllSink({
            dao,
            logger,
            projectContext: systemEventProjectContext('/repo'),
        });

        await sink('db.connection.error', { reason: 'boom', actor: 'runtime' });

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.inserted).toHaveLength(1);
        const row = fake.inserted[0];
        expect(row?.id.startsWith('sev_')).toBe(true);
        expect(row?.event_name).toBe('db.connection.error');
        expect(row?.actor).toBe('runtime');
        expect(Number.isNaN(Date.parse(row?.occurred_at ?? 'x'))).toBe(false);

        const payload = parsePayload(row?.payload_json);
        expect(payload?.schemaVersion).toBe(2);
        const data = payload?.data as Record<string, unknown> | undefined;
        expect(data?.reason).toBe('boom');
        expect(data?.actor).toBe('runtime');
        const context = payload?.context as Record<string, unknown> | undefined;
        const project = context?.project as Record<string, unknown> | undefined;
        expect(project?.root).toBe('/repo');
        const producer = context?.producer as Record<string, unknown> | undefined;
        expect(producer?.package).toBe('spur');
        expect(producer?.subsystem).toBe('unknown');
        const presentation = payload?.presentation as Record<string, unknown> | undefined;
        expect(presentation?.severity).toBe('info');

        // No drift warning goes out before the row persists; the single emit
        // produces exactly one warn.
        expect(logger.warns).toHaveLength(1);
        expect(logger.warns[0]?.msg).toBe(SYSTEM_EVENT_UNCATALOGED_WARN_EVENT);
        expect(logger.warns[0]?.data?.event).toBe('db.connection.error');
    });

    test('redacts configured secrets inside the envelope (D3a)', async () => {
        const dao = fakeDao();
        const secret = 'uncataloged-secret-value';
        const sink = createSystemEventCatchAllSink({ dao, logger: new CapturingLogger(), secretValues: [secret] });

        await sink('dbx.leak', { actor: 'op', reason: `contains ${secret}` });

        const row = (dao as unknown as FakeSystemEventDao).inserted[0];
        expect(row?.actor).toBe('op');
        const envelopeData = parsePayload(row?.payload_json)?.data as Record<string, unknown> | undefined;
        expect(envelopeData?.reason).not.toContain(secret);
        expect(row?.payload_json).toContain('[REDACTED]');
        expect(row?.payload_json).not.toContain(secret);
    });

    test('a payload severity wins over the info default; an invalid severity does not (Q5)', async () => {
        const dao = fakeDao();
        const sink = createSystemEventCatchAllSink({ dao, logger: new CapturingLogger() });

        await sink('dbx.failed', { severity: 'error' });
        await sink('dbx.failed', { severity: 'catastrophic' });

        const rows = (dao as unknown as FakeSystemEventDao).inserted;
        expect(rows).toHaveLength(2);
        const first = parsePayload(rows[0]?.payload_json);
        const second = parsePayload(rows[1]?.payload_json);
        expect((first?.presentation as Record<string, unknown>)?.severity).toBe('error');
        expect((second?.presentation as Record<string, unknown>)?.severity).toBe('info');
    });

    test('lands correlation payload fields into the indexed columns', async () => {
        const dao = fakeDao();
        const sink = createSystemEventCatchAllSink({ dao, logger: new CapturingLogger() });

        await sink('dbx.moved', { entityId: '42', entityKind: 'widget', runId: 'run-1', sequence: 7 });

        const row = (dao as unknown as FakeSystemEventDao).inserted[0];
        expect(row?.entity_id).toBe('42');
        expect(row?.entity_kind).toBe('widget');
        expect(row?.run_id).toBe('run-1');
        expect(row?.sequence).toBe(7);
    });

    test('scopes the insert-time prune to the written prefix with the ensured quota (D3c)', async () => {
        const dao = fakeDao();
        const logger = new CapturingLogger();
        const sink = createSystemEventCatchAllSink({ dao, logger, retention: { default: 5 } });

        await sink('dbx.event', {});

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.pruneCalls).toHaveLength(1);
        expect(fake.pruneCalls[0]?.prefix).toBe('dbx');
        // The uncataloged prefix was appended with the configured default (5),
        // not the documented fallback, before pruning.
        expect(fake.pruneCalls[0]?.quotas.find((q) => q.prefix === 'dbx')?.quota).toBe(5);
    });

    test('does not widen the quota list for a cataloged prefix (typo-guard stays intact, R10)', async () => {
        const dao = fakeDao();
        const sink = createSystemEventCatchAllSink({ dao, logger: new CapturingLogger() });

        // 'task.thing' is uncataloged as a NAME but its prefix is a catalog
        // prefix — the ensured list must not grow a duplicate 'task' entry.
        await sink('task.thing', {});

        const fake = dao as unknown as FakeSystemEventDao;
        expect(fake.pruneCalls[0]?.prefix).toBe('task');
        expect(fake.pruneCalls[0]?.quotas.filter((q) => q.prefix === 'task')).toHaveLength(1);
        expect(fake.pruneCalls[0]?.quotas).toHaveLength(resolveRetentionQuotas({}).length);
    });

    test('warns the drift signal once per name per sink, even across retries (R11/Q4)', async () => {
        const dao = fakeDao();
        const logger = new CapturingLogger();
        const sink = createSystemEventCatchAllSink({ dao, logger });

        await sink('dbx.a', {});
        await sink('dbx.a', {});
        await sink('dbx.b', {});

        const drift = logger.warns.filter((w) => w.msg === SYSTEM_EVENT_UNCATALOGED_WARN_EVENT);
        expect(drift).toHaveLength(2);
        expect(drift.map((w) => w.data?.event).sort()).toEqual(['dbx.a', 'dbx.b']);
    });

    test('swallows a persist failure behind a warn and skips the drift signal (R9)', async () => {
        const dao = fakeDao({ failOn: 1 });
        const logger = new CapturingLogger();
        const sink = createSystemEventCatchAllSink({ dao, logger });

        await expect(sink('dbx.a', {})).resolves.toBeUndefined();
        expect(logger.warns[0]?.msg).toContain('persist failed');
        expect(logger.warns[0]?.data?.event).toBe('dbx.a');
        expect(logger.warns[0]?.data?.error).toContain('synthetic failure on attempt 1');
        // A failed persist is not a successful capture — no drift warn yet.
        expect(logger.warns.filter((w) => w.msg === SYSTEM_EVENT_UNCATALOGED_WARN_EVENT)).toHaveLength(0);

        // The next attempt persists and then raises the drift warn once.
        await sink('dbx.a', {});
        expect(logger.warns.filter((w) => w.msg === SYSTEM_EVENT_UNCATALOGED_WARN_EVENT)).toHaveLength(1);
    });
});

describe('ensureRetentionQuotaForPrefix', () => {
    test('appends the fallback quota for an absent prefix and is a no-op otherwise', () => {
        const quotas = resolveRetentionQuotas({});
        const before = quotas.length;

        const widened = ensureRetentionQuotaForPrefix(quotas, 'dbx', 42);
        expect(widened).toHaveLength(before + 1);
        expect(widened.find((q) => q.prefix === 'dbx')?.quota).toBe(42);

        const unchanged = ensureRetentionQuotaForPrefix(widened, 'dbx', 42);
        expect(unchanged).toBe(widened);
    });

    test('the fallback quota for an uncataloged prefix is the documented default', () => {
        const quotas = resolveRetentionQuotas({});
        const widened = ensureRetentionQuotaForPrefix(quotas, 'dbx', DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA);
        expect(widened.find((q) => q.prefix === 'dbx')?.quota).toBe(DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA);
    });
});

describe('installSystemEventCatchAll', () => {
    test('cataloged names pass through untouched — no second subscriber, no diagnostic rescue (R8)', async () => {
        const bus = makeBus();
        const sinked: string[] = [];
        let handlerRuns = 0;
        bus.on('task.created', () => {
            handlerRuns += 1;
        });
        const handle = installSystemEventCatchAll(bus, async (name) => {
            sinked.push(name);
        });
        expect(handle.installed).toBe(true);

        await bus.emit('task.created', { entityId: '1' });
        // The tap/emitter owns cataloged names — exactly one write path (R8).
        expect(sinked).toHaveLength(0);
        expect(handlerRuns).toBe(1);

        // A diagnostic-tier cataloged name is NOT rescued either: the
        // diagnostic toggle still gates it.
        await bus.emit('bus.emit.done', {});
        expect(sinked).toHaveLength(0);
    });

    test('uncataloged names reach the sink with the raw payload; emit still resolves', async () => {
        const bus = makeBus();
        const seen: Array<{ name: string; payload: unknown }> = [];
        installSystemEventCatchAll(bus, async (name, payload) => {
            seen.push({ name, payload });
        });

        await bus.emit('db.connection.error', { reason: 'boom' });

        expect(seen).toEqual([{ name: 'db.connection.error', payload: { reason: 'boom' } }]);
    });

    test('re-install is a no-op via the marker and never double-wraps (Q4)', async () => {
        const bus = makeBus();
        let count = 0;
        const sink = async (): Promise<void> => {
            count += 1;
        };
        expect(installSystemEventCatchAll(bus, sink).installed).toBe(true);

        const second = installSystemEventCatchAll(bus, sink);
        expect(second.installed).toBe(false);

        await bus.emit('dbx.thing', {});
        expect(count).toBe(1);

        // The returned no-op handle still drains safely.
        await second.flush();

        await bus.emit('dbx.thing', {});
        expect(count).toBe(2);
    });

    test('a rejected sink never breaks the emit path (R9)', async () => {
        const bus = makeBus();
        const handle = installSystemEventCatchAll(bus, async () => {
            throw new Error('synthetic sink failure');
        });

        await expect(bus.emit('dbx.thing', {})).resolves.toBeUndefined();
        await handle.flush();
    });

    test('flush drains in-flight catch-all persists', async () => {
        const bus = makeBus();
        const seen: string[] = [];
        const handle = installSystemEventCatchAll(bus, async (name) => {
            await Bun.sleep(2);
            seen.push(name);
        });

        void bus.emit('dbx.a', {});
        void bus.emit('dbx.b', {});
        await handle.flush();

        expect(seen.sort()).toEqual(['dbx.a', 'dbx.b']);
    });

    test('a cataloged name still resolves its catalog entry after install', () => {
        // Guard against an accidental generic shadowing of the catalog lookup.
        expect(systemEventCatalogEntry('task.created')?.prefix).toBe('task');
        expect(systemEventCatalogEntry('db.connection.error')).toBeUndefined();
    });
});

describe('buildSystemEventEnvelope with a generic entry', () => {
    test('projects only the bounded core metadata allow-list (metadata-only)', () => {
        const entry = genericSystemEventCatalogEntry('dbx.event');
        const envelope = buildSystemEventEnvelope(
            entry,
            { reason: 'boom', actor: { name: 'runtime' }, customField: 'drop-me' },
            systemEventProjectContext('/repo'),
            [],
            'runtime',
        );
        const data = envelope.data as Record<string, unknown>;
        expect(data.reason).toBe('boom');
        expect(data.actor).toEqual({ name: 'runtime' });
        expect(data.customField).toBeUndefined();
    });
});

describe('uncataloged retention against a real DAO (R10)', () => {
    test('prunes an uncataloged prefix to the ensured quota; a second prefix stays untouched', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);
        try {
            const base = Date.parse('2026-01-01T00:00:00.000Z');
            const seed = async (name: string, index: number): Promise<void> => {
                await dao.insert({
                    id: `sev_seed_${name}_${index}`,
                    event_name: name,
                    occurred_at: new Date(base + index * 60_000).toISOString(),
                });
            };
            // Two uncataloged prefixes, both seeded past a quota of 3.
            for (let i = 0; i < 6; i++) await seed('dbx.event', i);
            for (let i = 0; i < 6; i++) await seed('other.thing', i);

            const sink = createSystemEventCatchAllSink({
                dao,
                logger: new CapturingLogger(),
                retention: { default: 3 },
            });
            await sink('dbx.event', { reason: 'newest' });

            // The written prefix is bounded to the quota (newest kept).
            const dbx = await dao.query({ name: 'dbx.event', limit: 100 });
            expect(dbx).toHaveLength(3);
            expect(
                dbx.some(
                    (row) =>
                        (parsePayload(row.payload_json)?.data as Record<string, unknown> | undefined)?.reason ===
                        'newest',
                ),
            ).toBe(true);
            // The other uncataloged prefix is untouched: the prune is scoped
            // to the just-written prefix (D3c), never a cross-prefix sweep.
            const other = await dao.query({ name: 'other.thing', limit: 100 });
            expect(other).toHaveLength(6);

            // Its own persist bounds it in turn.
            await sink('other.thing', {});
            expect(await dao.query({ name: 'other.thing', limit: 100 })).toHaveLength(3);
        } finally {
            adapter.close();
        }
    });
});
