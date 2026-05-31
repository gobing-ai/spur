import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { PhaseRunDao } from '../../src/db/phase-run-dao';
import { RunDao } from '../../src/db/run-dao';
import { WorkspaceDao } from '../../src/db/workspace-dao';

describe('PhaseRunDao', () => {
    test('creates a phase run', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/db/migrations');
        await applyCliMigrations(adapter);

        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).create({ workspaceId: ws.id, agent: 'pi' });

        const dao = new PhaseRunDao(adapter);
        const phase = await dao.create({ runId: run.id, phase: 'implement' });
        expect(phase.phase).toBe('implement');
        expect(phase.status).toBe('pending');

        adapter.close();
    });
});
