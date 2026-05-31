import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/db/run-dao';
import { WorkspaceDao } from '../../src/db/workspace-dao';

describe('RunDao', () => {
    test('creates and finds a run', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/db/migrations');
        await applyCliMigrations(adapter);

        const wsDao = new WorkspaceDao(adapter);
        const ws = await wsDao.add({ name: 'test-ws', root: '/tmp/test' });

        const dao = new RunDao(adapter);
        const run = await dao.create({ workspaceId: ws.id, agent: 'pi' });
        expect(run.agent).toBe('pi');
        expect(run.workspaceId).toBe(ws.id);

        const found = await dao.findById(run.id);
        expect(found?.id).toBe(run.id);

        adapter.close();
    });
});
