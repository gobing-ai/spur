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

    test('prune keeps only the N newest rows', async () => {
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

        const deleted = await dao.prune(3);
        expect(deleted).toBe(2);

        const rows = await dao.query();
        expect(rows).toHaveLength(3);
        // Oldest two (T00, T01) pruned; T02, T03, T04 remain.
        const times = rows.map((r) => r.occurred_at);
        expect(times).toContain('2026-07-04T02:00:00.000Z');
        expect(times).not.toContain('2026-07-04T00:00:00.000Z');

        adapter.close();
    });

    test('prune is a no-op when row count <= cap', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new SystemEventDao(adapter);

        await dao.insert({
            id: createId('sev'),
            event_name: 'task.created',
            occurred_at: '2026-07-04T01:00:00.000Z',
        });

        const deleted = await dao.prune(100);
        expect(deleted).toBe(0);

        const rows = await dao.query();
        expect(rows).toHaveLength(1);

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
});
