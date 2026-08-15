import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, createId, SystemEventDao } from '../../src/index';

describe('SystemEventDao', () => {
    test('insert and query returns events newest-first', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T01:00:00.000Z',
            actor: null,
            payload_json: JSON.stringify({ entityId: '0001' }),
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T02:00:00.000Z',
            actor: 'operator',
            payload_json: JSON.stringify({ entityId: '0001' }),
        });

        const rows = await dao.query({ limit: 10 });
        expect(rows).toHaveLength(2);
        // Newest first.
        expect(rows[0]?.event_name).toBe('task.updated');
        expect(rows[1]?.event_name).toBe('task.created');

        adapter.close();
    });

    test('query filters by name', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T02:00:00.000Z',
        });

        const rows = await dao.query({ name: 'task.created' });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.event_name).toBe('task.created');

        adapter.close();
    });

    test('query filters by since (exclusive)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T02:00:00.000Z',
        });

        const rows = await dao.query({ since: '2026-07-04T01:00:00.000Z' });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.event_name).toBe('task.updated');

        adapter.close();
    });

    test('query combines name + since', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T02:00:00.000Z',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T03:00:00.000Z',
        });

        const rows = await dao.query({ name: 'task.updated', since: '2026-07-04T01:00:00.000Z' });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.event_name).toBe('task.updated');
        expect(rows[0]?.occurred_at).toBe('2026-07-04T02:00:00.000Z');

        adapter.close();
    });

    test('query respects limit (newest N)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        for (let i = 0; i < 5; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'task.updated',
                occurred_at: `2026-07-04T0${i}:00:00.000Z`,
            });
        }

        const rows = await dao.query({ limit: 2 });
        expect(rows).toHaveLength(2);
        // Two newest: T04 then T03.
        expect(rows[0]?.occurred_at).toBe('2026-07-04T04:00:00.000Z');
        expect(rows[1]?.occurred_at).toBe('2026-07-04T03:00:00.000Z');

        adapter.close();
    });

    test('pruneQuotas keeps only the N newest rows for the prefix', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        for (let i = 0; i < 5; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'task.updated',
                occurred_at: `2026-07-04T0${i}:00:00.000Z`,
            });
        }

        const deleted = await dao.pruneQuotas([{ prefix: 'task', quota: 3 }]);
        expect(deleted).toBe(2);

        const rows = await dao.query();
        expect(rows).toHaveLength(3);
        // Oldest two (T00, T01) pruned; T02, T03, T04 remain.
        const times = rows.map((r) => r.occurred_at);
        expect(times).toContain('2026-07-04T02:00:00.000Z');
        expect(times).not.toContain('2026-07-04T00:00:00.000Z');

        adapter.close();
    });

    test('pruneQuotas is a no-op when row count <= quota', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });

        const deleted = await dao.pruneQuotas([{ prefix: 'task', quota: 100 }]);
        expect(deleted).toBe(0);

        const rows = await dao.query();
        expect(rows).toHaveLength(1);

        adapter.close();
    });

    test('pruneQuotas scopes eviction per-prefix — one prefix never evicts another', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // task.* over quota; feature.* under quota. A flat cap would evict
        // across both; per-prefix must only touch task.*.
        for (let i = 0; i < 5; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'task.updated',
                occurred_at: `2026-07-04T0${i}:00:00.000Z`,
            });
        }
        for (let i = 0; i < 2; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'feature.created',
                occurred_at: `2026-07-04T0${i}:00:00.000Z`,
            });
        }

        const deleted = await dao.pruneQuotas([
            { prefix: 'task', quota: 3 },
            { prefix: 'feature', quota: 10 },
        ]);
        expect(deleted).toBe(2); // only task.* overflow

        const rows = await dao.query();
        const taskRows = rows.filter((r) => r.event_name.startsWith('task.'));
        const featureRows = rows.filter((r) => r.event_name.startsWith('feature.'));
        expect(taskRows).toHaveLength(3);
        expect(featureRows).toHaveLength(2); // untouched

        adapter.close();
    });

    test('pruneQuotas prefix filter narrows to a single prefix', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        for (let i = 0; i < 5; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'task.updated',
                occurred_at: `2026-07-04T0${i}:00:00.000Z`,
            });
        }
        for (let i = 0; i < 5; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'feature.created',
                occurred_at: `2026-07-05T0${i}:00:00.000Z`,
            });
        }

        // Only the task prefix is enforced even though feature is over quota.
        const deleted = await dao.pruneQuotas(
            [
                { prefix: 'task', quota: 3 },
                { prefix: 'feature', quota: 3 },
            ],
            'task',
        );
        expect(deleted).toBe(2);

        const rows = await dao.query();
        const taskRows = rows.filter((r) => r.event_name.startsWith('task.'));
        const featureRows = rows.filter((r) => r.event_name.startsWith('feature.'));
        expect(taskRows).toHaveLength(3);
        expect(featureRows).toHaveLength(5); // filter skipped feature

        adapter.close();
    });

    test('pruneQuotas returns 0 when the table is absent', async () => {
        // A bare :memory: DB without migrations — system_events does not exist.
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao = new SystemEventDao(adapter);

        const deleted = await dao.pruneQuotas([{ prefix: 'task', quota: 3 }]);
        expect(deleted).toBe(0);

        adapter.close();
    });

    test('query returns [] when the table is absent', async () => {
        // A bare :memory: DB without migrations — system_events does not exist.
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao = new SystemEventDao(adapter);

        const rows = await dao.query();
        expect(rows).toEqual([]);

        adapter.close();
    });

    test('follow yields rows with sequence > cursor in ascending order', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        for (let sequence = 1; sequence <= 5; sequence += 1) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'task.created',
                occurred_at: `2026-07-04T00:0${sequence}:00.000Z`,
                sequence,
            });
        }

        const rows = await dao.follow(2);
        expect(rows.map((r) => r.sequence)).toEqual([3, 4, 5]);
        // Cursor is exclusive and the limit caps the page.
        expect((await dao.follow(4, 1)).map((r) => r.sequence)).toEqual([5]);

        adapter.close();
    });

    test('follow returns [] when the table is absent', async () => {
        // A bare :memory: DB without migrations — system_events does not exist.
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao = new SystemEventDao(adapter);

        await expect(dao.follow(0)).resolves.toEqual([]);

        adapter.close();
    });

    test('insert auto-assigns a global monotonic sequence when omitted (0531 follow cursor)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'agent.invoke.start',
            occurred_at: '2026-07-04T01:00:00.000Z',
            run_id: 'run_abc',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'agent.invoke.exit',
            occurred_at: '2026-07-04T01:01:00.000Z',
            run_id: 'run_abc',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'agent.invoke.start',
            occurred_at: '2026-07-04T01:02:00.000Z',
            run_id: 'run_other',
        });

        // Global cursor, not per-run: run_other's row advances past run_abc's.
        const rows = await dao.query();
        expect(rows.map((r) => r.sequence).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3]);

        adapter.close();
    });

    test('auto-assigned sequences stay monotonic alongside explicit ones', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'a',
            occurred_at: '2026-07-04T01:00:00.000Z',
            sequence: 10,
        });
        await dao.insert({ id: createId('sev'), event_name: 'b', occurred_at: '2026-07-04T01:01:00.000Z' });
        await dao.insert({ id: createId('sev'), event_name: 'c', occurred_at: '2026-07-04T01:02:00.000Z' });

        const rows = await dao.query();
        expect(rows.map((r) => r.sequence).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([10, 11, 12]);

        adapter.close();
    });

    test('deleteAll clears all rows', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });
        await dao.deleteAll();

        const rows = await dao.query();
        expect(rows).toHaveLength(0);

        adapter.close();
    });

    test('persists and reads back run correlation from the 0365 envelope', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'workflow.phase',
            occurred_at: '2026-07-04T01:00:00.000Z',
            run_id: 'run_abc',
            sequence: 7,
        });

        const rows = await dao.query();
        expect(rows[0]?.run_id).toBe('run_abc');
        expect(rows[0]?.sequence).toBe(7);
        // Disjoint identity: a run event carries no entity.
        expect(rows[0]?.entity_kind).toBeNull();
        expect(rows[0]?.entity_id).toBeNull();

        adapter.close();
    });

    test('persists and reads back entity correlation from a planning event', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T01:00:00.000Z',
            entity_kind: 'task',
            entity_id: '0369',
        });

        const rows = await dao.query();
        expect(rows[0]?.entity_kind).toBe('task');
        expect(rows[0]?.entity_id).toBe('0369');
        expect(rows[0]?.run_id).toBeNull();
        // Ledger cursor auto-assigned at persist (0531), independent of correlation.
        expect(rows[0]?.sequence).toBe(1);

        adapter.close();
    });

    test('an event with no correlation persists and reads back with nulls', async () => {
        // R4: correlation is optional — the pre-0369 insert shape still works.
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'queue.job.enqueued',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });

        const rows = await dao.query();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.run_id).toBeNull();
        expect(rows[0]?.entity_kind).toBeNull();
        expect(rows[0]?.entity_id).toBeNull();
        // Ledger cursor auto-assigned at persist (0531), independent of correlation.
        expect(rows[0]?.sequence).toBe(1);

        adapter.close();
    });

    test('query filters by run_id', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        for (const runId of ['run_a', 'run_b', 'run_a']) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'workflow.phase',
                occurred_at: '2026-07-04T01:00:00.000Z',
                run_id: runId,
            });
        }
        // An uncorrelated row must not leak into a run-scoped query.
        await dao.insert({
            id: createId('sev'),
            event_name: 'workflow.phase',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });

        const rows = await dao.query({ run_id: 'run_a' });
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.run_id === 'run_a')).toBe(true);

        adapter.close();
    });

    test('query filters by the entity_kind + entity_id pair', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // Same id under two kinds — the pair, not either column alone, selects one stream.
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T01:00:00.000Z',
            entity_kind: 'task',
            entity_id: 'J3',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'feature.updated',
            occurred_at: '2026-07-04T02:00:00.000Z',
            entity_kind: 'feature',
            entity_id: 'J3',
        });

        const rows = await dao.query({ entity_kind: 'task', entity_id: 'J3' });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.event_name).toBe('task.updated');

        adapter.close();
    });

    test('query composes correlation filters with name, since, and limit', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        for (let i = 0; i < 4; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'task.updated',
                occurred_at: `2026-07-04T0${i}:00:00.000Z`,
                entity_kind: 'task',
                entity_id: '0369',
            });
        }
        // Same entity, different name — must be excluded by the name filter.
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T05:00:00.000Z',
            entity_kind: 'task',
            entity_id: '0369',
        });

        const rows = await dao.query({
            name: 'task.updated',
            since: '2026-07-04T00:00:00.000Z',
            entity_kind: 'task',
            entity_id: '0369',
            limit: 2,
        });
        expect(rows).toHaveLength(2);
        // Newest two of the three matching rows (T03, T02).
        expect(rows.map((r) => r.occurred_at)).toEqual(['2026-07-04T03:00:00.000Z', '2026-07-04T02:00:00.000Z']);

        adapter.close();
    });

    test('R6 — seeded 90/10 noise ratio: low-volume rows survive high-volume pressure', async () => {
        // Mirror the observed production histogram: ~90% heartbeat noise
        // (queue.*, scheduler.*) against ~10% signal (task.*, feature.*).
        // With per-prefix quotas, pruning the high-volume prefix must NOT
        // evict low-volume signal rows from other prefixes.
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // Seed 90 "noise" rows (queue prefix) + 10 signal rows (task prefix).
        for (let i = 0; i < 90; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'queue.job.enqueued',
                occurred_at: new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString(),
            });
        }
        for (let i = 0; i < 10; i++) {
            await dao.insert({
                id: createId('sev'),
                event_name: 'task.updated',
                occurred_at: new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString(),
            });
        }

        // Prune with a realistic per-prefix quota of 20 per prefix. 70 queue
        // rows evicted (90 → 20); 0 task rows evicted (10 ≤ 20).
        const deleted = await dao.pruneQuotas([
            { prefix: 'queue', quota: 20 },
            { prefix: 'task', quota: 20 },
        ]);
        expect(deleted).toBe(70);

        // All 10 low-volume task rows survive the high-volume queue pressure.
        const taskRows = await dao.query({ name: 'task.updated' });
        expect(taskRows).toHaveLength(10);

        const queueRows = await dao.query({ name: 'queue.job.enqueued' });
        expect(queueRows).toHaveLength(20);

        adapter.close();
    });

    test('query filters by prefix in SQL (R18)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: 'sev_task',
            event_name: 'task.created',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });
        await dao.insert({
            id: 'sev_workflow',
            event_name: 'workflow.phase',
            occurred_at: '2026-07-04T02:00:00.000Z',
        });
        await dao.insert({
            id: 'sev_queue',
            event_name: 'queue.job.enqueued',
            occurred_at: '2026-07-04T03:00:00.000Z',
        });

        const rows = await dao.query({ prefix: 'task' });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.event_name).toBe('task.created');

        adapter.close();
    });

    test('query filters by multi-value names (R18)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        for (const name of ['task.created', 'task.updated', 'feature.created']) {
            await dao.insert({
                id: createId('sev'),
                event_name: name,
                occurred_at: '2026-07-04T01:00:00.000Z',
            });
        }

        const rows = await dao.query({ names: ['task.created', 'feature.created'] });
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.event_name).sort()).toEqual(['feature.created', 'task.created']);

        adapter.close();
    });

    test('query filters by actor (R19)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T01:00:00.000Z',
            actor: 'operator',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T02:00:00.000Z',
            actor: 'agent-1',
        });
        await dao.insert({
            id: createId('sev'),
            event_name: 'task.updated',
            occurred_at: '2026-07-04T03:00:00.000Z',
            actor: null,
        });

        const rows = await dao.query({ actor: 'operator' });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.actor).toBe('operator');

        adapter.close();
    });

    test('keyset cursor is stable under concurrent newer inserts (R20)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // Seed five rows in ascending time so page1 = newest two.
        for (let i = 1; i <= 5; i++) {
            await dao.insert({
                id: `sev_${i}`,
                event_name: 'task.updated',
                occurred_at: `2026-07-04T0${i}:00:00.000Z`,
            });
        }

        const page1 = await dao.query({ limit: 2 });
        expect(page1.map((r) => r.id)).toEqual(['sev_5', 'sev_4']);
        const page1Last = page1[1];
        expect(page1Last).toBeDefined();
        if (!page1Last) throw new Error('expected page1 last row');
        const cursor = { occurred_at: page1Last.occurred_at, id: page1Last.id };

        // Concurrent write: a brand-new event newer than everything on page 1.
        await dao.insert({
            id: 'sev_new',
            event_name: 'task.updated',
            occurred_at: '2026-07-04T09:00:00.000Z',
        });

        const page2 = await dao.query({ before: cursor, limit: 2 });
        // No already-returned event reappears; no older event is skipped.
        expect(page2.map((r) => r.id)).toEqual(['sev_3', 'sev_2']);
        expect(page2.every((r) => r.id !== 'sev_5' && r.id !== 'sev_4' && r.id !== 'sev_new')).toBe(true);

        const page2Last = page2[1];
        expect(page2Last).toBeDefined();
        if (!page2Last) throw new Error('expected page2 last row');
        const page3 = await dao.query({
            before: { occurred_at: page2Last.occurred_at, id: page2Last.id },
            limit: 2,
        });
        expect(page3.map((r) => r.id)).toEqual(['sev_1']);

        adapter.close();
    });

    test('keyset cursor tie-breaks equal timestamps by id', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        const ts = '2026-07-04T12:00:00.000Z';
        // Lexicographic id order: a < b < c → DESC page order is c, b, a.
        for (const id of ['sev_a', 'sev_b', 'sev_c']) {
            await dao.insert({ id, event_name: 'task.updated', occurred_at: ts });
        }

        const page1 = await dao.query({ limit: 2 });
        expect(page1.map((r) => r.id)).toEqual(['sev_c', 'sev_b']);
        const page1Last = page1[1];
        expect(page1Last).toBeDefined();
        if (!page1Last) throw new Error('expected page1 last row');

        const page2 = await dao.query({
            before: { occurred_at: page1Last.occurred_at, id: page1Last.id },
            limit: 2,
        });
        expect(page2.map((r) => r.id)).toEqual(['sev_a']);

        adapter.close();
    });
});

// ---------------------------------------------------------------------------
// Tests: routingSummary — role→executor aggregate (task 0546 R1/R2/R4/R5)
// ---------------------------------------------------------------------------
// Rows are shaped exactly as the J5 tap persists them: payload_json is the v2
// envelope, routing rides `data.routing.{role,tier,executor,source}` on
// `agent.invoke.start`, escalations ride `data.fromExecutor` on
// `agent.invoke.escalated`, and `run_id` is the indexed join column.

/** Envelope wrapper matching buildSystemEventEnvelope's persisted shape. */
function envelope(data: Record<string, unknown>): string {
    return JSON.stringify({ schemaVersion: 2, data, context: {}, presentation: {} });
}

/** Start payload with (optional) routing attribution, as the invoke bridge stamps it. */
function startPayload(role: string | undefined, executor: string, source: string): string {
    const routing: Record<string, unknown> = { tier: 'standard', executor, source };
    if (role !== undefined) routing.role = role;
    return envelope({ agent: 'pi', operation: 'prompt', routing });
}

/** Escalation payload with fromExecutor, as the agent-service bridge emits it. */
function escalatedPayload(fromExecutor: string, trigger = 'gate-fail'): string {
    return envelope({
        runId: 'r',
        fromExecutor,
        fromTier: 'standard',
        toExecutor: 'capable-exec',
        toTier: 'capable-1',
        trigger,
    });
}

async function insertInvokeRow(
    dao: SystemEventDao,
    id: string,
    eventName: string,
    at: string,
    payload: string,
    runId: string | null,
): Promise<void> {
    await dao.insert({ id, event_name: eventName, occurred_at: at, payload_json: payload, run_id: runId });
}

describe('SystemEventDao.routingSummary (task 0546)', () => {
    test('R1: a known dataset yields expected per-pair run and escalation counts', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // (scribe, cheap-exec, role): 2 runs, 1 escalation (run-2 escalated away).
        await insertInvokeRow(
            dao,
            's1',
            'agent.invoke.start',
            '2026-08-13T01:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-1',
        );
        await insertInvokeRow(
            dao,
            's2',
            'agent.invoke.start',
            '2026-08-13T02:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-2',
        );
        await insertInvokeRow(
            dao,
            'e2',
            'agent.invoke.escalated',
            '2026-08-13T02:01:00.000Z',
            escalatedPayload('cheap-exec'),
            'run-2',
        );
        // (scribe, capable-3, explicit): 1 pinned run, never escalated.
        await insertInvokeRow(
            dao,
            's3',
            'agent.invoke.start',
            '2026-08-13T03:00:00.000Z',
            startPayload('scribe', 'capable-3', 'explicit'),
            'run-3',
        );
        // (null, std-exec, explicit): 1 pure pin (no role).
        await insertInvokeRow(
            dao,
            's4',
            'agent.invoke.start',
            '2026-08-13T04:00:00.000Z',
            startPayload(undefined, 'std-exec', 'explicit'),
            'run-4',
        );
        // (planner, std-exec, default): 1 run, 1 escalation.
        await insertInvokeRow(
            dao,
            's6',
            'agent.invoke.start',
            '2026-08-13T06:00:00.000Z',
            startPayload('planner', 'std-exec', 'default'),
            'run-6',
        );
        await insertInvokeRow(
            dao,
            'e6',
            'agent.invoke.escalated',
            '2026-08-13T06:01:00.000Z',
            escalatedPayload('std-exec', 'timeout'),
            'run-6',
        );
        // Outside the window: must not appear.
        await insertInvokeRow(
            dao,
            's7',
            'agent.invoke.start',
            '2026-07-01T00:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-7',
        );
        await insertInvokeRow(
            dao,
            'e7',
            'agent.invoke.escalated',
            '2026-07-01T00:01:00.000Z',
            escalatedPayload('cheap-exec'),
            'run-7',
        );
        // Unrelated event family inside the window: must not appear.
        await insertInvokeRow(dao, 't1', 'task.created', '2026-08-13T07:00:00.000Z', envelope({}), null);

        const result = await dao.routingSummary({
            since: '2026-08-12T00:00:00.000Z',
            until: '2026-08-14T00:00:00.000Z',
        });
        expect(result.window).toEqual({ since: '2026-08-12T00:00:00.000Z', until: '2026-08-14T00:00:00.000Z' });
        expect(result.pairs).toEqual([
            { role: 'scribe', executor: 'cheap-exec', source: 'role', runs: 2, escalations: 1 },
            { role: 'scribe', executor: 'capable-3', source: 'explicit', runs: 1, escalations: 0 },
            { role: null, executor: 'std-exec', source: 'explicit', runs: 1, escalations: 0 },
            { role: 'planner', executor: 'std-exec', source: 'default', runs: 1, escalations: 1 },
        ]);

        adapter.close();
    });

    test('R4: pinned and role-resolved runs to the same executor report separately', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // Same executor, two sources: role-routed vs pinned.
        await insertInvokeRow(
            dao,
            'a1',
            'agent.invoke.start',
            '2026-08-13T01:00:00.000Z',
            startPayload('coder', 'claude-exec', 'role'),
            'run-a',
        );
        await insertInvokeRow(
            dao,
            'a2',
            'agent.invoke.start',
            '2026-08-13T02:00:00.000Z',
            startPayload('coder', 'claude-exec', 'explicit'),
            'run-b',
        );
        await insertInvokeRow(
            dao,
            'a3',
            'agent.invoke.start',
            '2026-08-13T03:00:00.000Z',
            startPayload('coder', 'claude-exec', 'explicit'),
            'run-c',
        );

        const result = await dao.routingSummary({
            since: '2026-08-12T00:00:00.000Z',
            until: '2026-08-14T00:00:00.000Z',
        });
        expect(result.pairs).toEqual([
            { role: 'coder', executor: 'claude-exec', source: 'explicit', runs: 2, escalations: 0 },
            { role: 'coder', executor: 'claude-exec', source: 'role', runs: 1, escalations: 0 },
        ]);

        adapter.close();
    });

    test('R5: pre-attribution rows are excluded and the covered window is reported', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // Attributed row (post-0545).
        await insertInvokeRow(
            dao,
            'b1',
            'agent.invoke.start',
            '2026-08-13T01:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-x',
        );
        // Pre-attribution row: no routing metadata, same event name, in window.
        await insertInvokeRow(
            dao,
            'b2',
            'agent.invoke.start',
            '2026-08-13T02:00:00.000Z',
            envelope({ agent: 'pi', operation: 'prompt' }),
            'run-y',
        );
        // Legacy raw payload (not even an envelope): still excluded, no throw.
        await insertInvokeRow(dao, 'b3', 'agent.invoke.start', '2026-08-13T03:00:00.000Z', '{not json', 'run-z');
        // Escalation row without fromExecutor: excluded from the escalation count.
        await insertInvokeRow(
            dao,
            'b4',
            'agent.invoke.escalated',
            '2026-08-13T03:01:00.000Z',
            envelope({ runId: 'run-x' }),
            'run-x',
        );

        const result = await dao.routingSummary({
            since: '2026-08-12T00:00:00.000Z',
            until: '2026-08-14T00:00:00.000Z',
        });
        expect(result.window).toEqual({ since: '2026-08-12T00:00:00.000Z', until: '2026-08-14T00:00:00.000Z' });
        expect(result.pairs).toEqual([
            { role: 'scribe', executor: 'cheap-exec', source: 'role', runs: 1, escalations: 0 },
        ]);

        adapter.close();
    });

    test('R5: omitted window defaults to a bounded recent range ending now', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        const before = Date.now();
        await insertInvokeRow(
            dao,
            'c1',
            'agent.invoke.start',
            new Date().toISOString(),
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-now',
        );
        // Far outside the default 7-day window.
        await insertInvokeRow(
            dao,
            'c2',
            'agent.invoke.start',
            '2026-01-01T00:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-old',
        );

        const result = await dao.routingSummary();
        const after = Date.now();
        expect(result.window.until).toBeDefined();
        expect(new Date(result.window.since).getTime()).toBeGreaterThanOrEqual(before - 7 * 24 * 60 * 60 * 1000);
        expect(new Date(result.window.until).getTime()).toBeLessThanOrEqual(after);
        expect(result.pairs).toEqual([
            { role: 'scribe', executor: 'cheap-exec', source: 'role', runs: 1, escalations: 0 },
        ]);

        adapter.close();
    });

    test('R2: the query filters on the indexed event_name column in SQL — no client sifting', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);
        await insertInvokeRow(
            dao,
            'd1',
            'agent.invoke.start',
            '2026-08-13T01:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-1',
        );
        await insertInvokeRow(dao, 'd2', 'task.created', '2026-08-13T02:00:00.000Z', envelope({}), null);

        // Capture the SQL the DAO sends — the aggregate must be shaped in SQL
        // against the indexed correlation column, never fetched-then-sifted.
        const captured: string[] = [];
        const originalQueryAll = adapter.queryAll.bind(adapter);
        adapter.queryAll = (async (sql: string, ...params: unknown[]) => {
            captured.push(sql);
            return originalQueryAll(sql, ...params);
        }) as typeof adapter.queryAll;

        await dao.routingSummary({ since: '2026-08-12T00:00:00.000Z', until: '2026-08-14T00:00:00.000Z' });

        expect(captured).toHaveLength(1); // one round trip
        const sql = captured[0];
        expect(sql).toContain("event_name = 'agent.invoke.start'");
        expect(sql).toContain("event_name = 'agent.invoke.escalated'");
        expect(sql).toContain('occurred_at >= ?1 AND occurred_at <= ?2');
        expect(sql).toContain('GROUP BY');

        adapter.close();
    });

    test('P3: an escalation is attributed to a single dispatch, never fanned across pairs', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // One run, same executor dispatched twice with different sources
        // (role-routed then pinned — re-pin / re-dispatch pattern), plus one
        // escalation from that executor. The escalation names only
        // (run_id, fromExecutor); it must count once, on the earliest
        // dispatch's pair, not on every pair sharing the executor.
        await insertInvokeRow(
            dao,
            'p1',
            'agent.invoke.start',
            '2026-08-13T01:00:00.000Z',
            startPayload('coder', 'std-exec', 'role'),
            'run-p',
        );
        await insertInvokeRow(
            dao,
            'p2',
            'agent.invoke.start',
            '2026-08-13T02:00:00.000Z',
            startPayload('coder', 'std-exec', 'explicit'),
            'run-p',
        );
        await insertInvokeRow(
            dao,
            'p3',
            'agent.invoke.escalated',
            '2026-08-13T02:30:00.000Z',
            escalatedPayload('std-exec'),
            'run-p',
        );

        const result = await dao.routingSummary({
            since: '2026-08-12T00:00:00.000Z',
            until: '2026-08-14T00:00:00.000Z',
        });
        // Escalation attributed to the earliest dispatch (role source); the
        // later pinned dispatch carries zero escalations — no double-count.
        // Order is deterministic: runs DESC, executor ASC, role ASC, source ASC
        // → 'explicit' precedes 'role'.
        expect(result.pairs).toEqual([
            { role: 'coder', executor: 'std-exec', source: 'explicit', runs: 1, escalations: 0 },
            { role: 'coder', executor: 'std-exec', source: 'role', runs: 1, escalations: 1 },
        ]);

        adapter.close();
    });

    test('P3: a routing block without source groups under source null, typed not string', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        // A routing block may carry executor + tier but omit source (or role):
        // json_extract yields NULL, which must group cleanly rather than
        // violate the pair's declared type.
        await insertInvokeRow(
            dao,
            'q1',
            'agent.invoke.start',
            '2026-08-13T01:00:00.000Z',
            envelope({ agent: 'pi', operation: 'prompt', routing: { tier: 'standard', executor: 'no-src-exec' } }),
            'run-q',
        );

        const result = await dao.routingSummary({
            since: '2026-08-12T00:00:00.000Z',
            until: '2026-08-14T00:00:00.000Z',
        });
        expect(result.pairs).toEqual([{ role: null, executor: 'no-src-exec', source: null, runs: 1, escalations: 0 }]);

        adapter.close();
    });

    test('R2: the routing query plan drives from the composite (event_name, occurred_at) index', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);
        // Seed enough rows that the optimizer has to choose an access path.
        await insertInvokeRow(
            dao,
            'i1',
            'agent.invoke.start',
            '2026-08-13T01:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-1',
        );
        await insertInvokeRow(
            dao,
            'i2',
            'agent.invoke.start',
            '2026-08-13T02:00:00.000Z',
            startPayload('scribe', 'cheap-exec', 'role'),
            'run-2',
        );
        await insertInvokeRow(dao, 'i3', 'heartbeat', '2026-08-13T03:00:00.000Z', envelope({}), null);

        const captured: string[] = [];
        const originalQueryAll = adapter.queryAll.bind(adapter);
        adapter.queryAll = (async (sql: string, ...params: unknown[]) => {
            captured.push(sql);
            return originalQueryAll(sql, ...params);
        }) as typeof adapter.queryAll;

        const result = await dao.routingSummary({
            since: '2026-08-12T00:00:00.000Z',
            until: '2026-08-14T00:00:00.000Z',
        });
        expect(result.pairs).toHaveLength(1);

        // EXPLAIN QUERY PLAN must name the composite index for the routed CTE —
        // the family filter drives the access path, not the window walk (task
        // 0546 R2; 0546 review P2).
        const explain = await adapter.queryAll<{ detail: string }>(
            `EXPLAIN QUERY PLAN ${captured[0] as string}`,
            '2026-08-12T00:00:00.000Z',
            '2026-08-14T00:00:00.000Z',
        );
        const plan = explain.map((row) => row.detail).join('\n');
        expect(plan).toContain('idx_system_events_name_occurred');

        adapter.close();
    });
});
