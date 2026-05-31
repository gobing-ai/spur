import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { ArtifactDao } from '../../src/dao/artifact-dao';
import { RunDao } from '../../src/dao/run-dao';
import { WorkspaceDao } from '../../src/dao/workspace-dao';

describe('ArtifactDao', () => {
    test('creates an artifact record', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/migrations');
        await applyCliMigrations(adapter);

        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).open({ workspaceId: ws.id, agent: 'pi' });

        const dao = new ArtifactDao(adapter);
        const artifact = await dao.record({ path: '/tmp/test.txt', kind: 'config' });
        expect(artifact.path).toBe('/tmp/test.txt');
        expect(artifact.kind).toBe('config');

        const artifact2 = await dao.record({ path: '/tmp/test2.txt', kind: 'output', runId: run.id });
        expect(artifact2.runId).toBe(run.id);

        adapter.close();
    });
});
