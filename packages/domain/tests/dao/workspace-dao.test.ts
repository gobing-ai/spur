import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { WorkspaceDao } from '../../src/dao/workspace-dao';

describe('WorkspaceDao', () => {
    test('creates and lists workspaces', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/migrations');
        await applyCliMigrations(adapter);

        const dao = new WorkspaceDao(adapter);
        const workspace = await dao.add({ name: 'test-ws', root: '/tmp/test' });
        expect(workspace.name).toBe('test-ws');

        const list = await dao.list();
        expect(list).toHaveLength(1);
        expect(list[0]?.name).toBe('test-ws');

        adapter.close();
    });

    test('lists workspaces sorted by name for deterministic CLI output', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/migrations');
        await applyCliMigrations(adapter);

        const dao = new WorkspaceDao(adapter);
        await dao.add({ name: 'charlie', root: '/tmp/c' });
        await dao.add({ name: 'alpha', root: '/tmp/a' });
        await dao.add({ name: 'bravo', root: '/tmp/b' });

        const names = (await dao.list()).map((workspace) => workspace.name);
        expect(names).toEqual(['alpha', 'bravo', 'charlie']);

        adapter.close();
    });

    test('upserts an existing workspace by name', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/migrations');
        await applyCliMigrations(adapter);

        const dao = new WorkspaceDao(adapter);
        const first = await dao.add({ name: 'dup', root: '/tmp/one', defaultAgent: 'pi' });
        const second = await dao.add({ name: 'dup', root: '/tmp/two', defaultAgent: 'claude' });

        expect(second.id).toBe(first.id);
        expect(second.root).toBe('/tmp/two');
        expect(second.defaultAgent).toBe('claude');
        expect(await dao.list()).toHaveLength(1);

        adapter.close();
    });
});
