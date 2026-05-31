import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { WorkspaceDao } from '../../src/db/workspace-dao';

describe('WorkspaceDao', () => {
    test('creates and lists workspaces', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/db/migrations');
        await applyCliMigrations(adapter);

        const dao = new WorkspaceDao(adapter);
        const workspace = await dao.add({ name: 'test-ws', root: '/tmp/test' });
        expect(workspace.name).toBe('test-ws');

        const list = await dao.list();
        expect(list).toHaveLength(1);
        expect(list[0]?.name).toBe('test-ws');

        adapter.close();
    });
});
