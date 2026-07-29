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
});
