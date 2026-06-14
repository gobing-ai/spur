import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, createId, TaskRunLinkDao } from '../../src/index';

describe('TaskRunLinkDao', () => {
    test('insert and listByWbs', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new TaskRunLinkDao(adapter);

        await dao.insert({
            id: createId('trl'),
            wbs: '0001',
            run_id: 'run_abc',
            kind: 'lifecycle',
            created_at: '2026-06-13T01:00:00.000Z',
        });

        const rows = await dao.listByWbs('0001', 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.wbs).toBe('0001');
        expect(rows[0]?.run_id).toBe('run_abc');
        expect(rows[0]?.kind).toBe('lifecycle');

        adapter.close();
    });

    test('listByRun returns links for a given run', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new TaskRunLinkDao(adapter);

        await dao.insert({
            id: createId('trl'),
            wbs: '0001',
            run_id: 'run_abc',
            kind: 'lifecycle',
            created_at: '2026-06-13T01:00:00.000Z',
        });
        await dao.insert({
            id: createId('trl'),
            wbs: '0002',
            run_id: 'run_abc',
            kind: 'pipeline',
            created_at: '2026-06-13T02:00:00.000Z',
        });

        const rows = await dao.listByRun('run_abc', 10);
        expect(rows).toHaveLength(2);
        expect(rows[0]?.run_id).toBe('run_abc');

        adapter.close();
    });

    test('listByWbs returns empty for unknown WBS', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new TaskRunLinkDao(adapter);

        const rows = await dao.listByWbs('9999', 10);
        expect(rows).toHaveLength(0);

        adapter.close();
    });

    test('deleteAll removes all rows', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new TaskRunLinkDao(adapter);

        await dao.insert({
            id: createId('trl'),
            wbs: '0001',
            run_id: 'run_abc',
            kind: 'lifecycle',
            created_at: '2026-06-13T01:00:00.000Z',
        });

        await dao.deleteAll();
        const rows = await dao.listByWbs('0001', 10);
        expect(rows).toHaveLength(0);

        adapter.close();
    });
});
