import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, createId, PlanningEventDao } from '../../src/index';

describe('PlanningEventDao', () => {
    test('insert and listByEntity', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);

        await dao.insert({
            id: createId('pev'),
            entity_kind: 'task',
            entity_id: '0001',
            event: 'task.created',
            created_at: '2026-06-13T01:00:00.000Z',
        });

        const rows = await dao.listByEntity('task', '0001', 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.entity_kind).toBe('task');
        expect(rows[0]?.event).toBe('task.created');

        adapter.close();
    });

    test('listByEntity returns empty for unknown entity', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);

        const rows = await dao.listByEntity('task', 'nonexistent', 10);
        expect(rows).toHaveLength(0);

        adapter.close();
    });

    test('listAll returns events ordered by created_at DESC', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);

        await dao.insert({
            id: createId('pev'),
            entity_kind: 'task',
            entity_id: '0001',
            event: 'task.created',
            created_at: '2026-06-13T01:00:00.000Z',
        });
        await dao.insert({
            id: createId('pev'),
            entity_kind: 'feature',
            entity_id: 'A1',
            event: 'feature.created',
            created_at: '2026-06-13T02:00:00.000Z',
        });

        const rows = await dao.listAll(10);
        expect(rows).toHaveLength(2);
        expect(rows[0]?.created_at).toBe('2026-06-13T02:00:00.000Z');
        expect(rows[1]?.created_at).toBe('2026-06-13T01:00:00.000Z');

        adapter.close();
    });

    test('countByEntity returns correct count', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);

        await dao.insert({
            id: createId('pev'),
            entity_kind: 'task',
            entity_id: '0001',
            event: 'task.created',
            created_at: '2026-06-13T01:00:00.000Z',
        });
        await dao.insert({
            id: createId('pev'),
            entity_kind: 'task',
            entity_id: '0001',
            event: 'task.updated',
            created_at: '2026-06-13T02:00:00.000Z',
        });

        const count = await dao.countByEntity('task', '0001');
        expect(count).toBe(2);

        const noCount = await dao.countByEntity('task', '9999');
        expect(noCount).toBe(0);

        adapter.close();
    });

    test('deleteAll removes all rows', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);

        await dao.insert({
            id: createId('pev'),
            entity_kind: 'task',
            entity_id: '0001',
            event: 'task.created',
            created_at: '2026-06-13T01:00:00.000Z',
        });

        await dao.deleteAll();
        const rows = await dao.listAll(10);
        expect(rows).toHaveLength(0);

        adapter.close();
    });
});
