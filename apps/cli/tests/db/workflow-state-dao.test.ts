import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/db/run-dao';
import { WorkflowStateDao } from '../../src/db/workflow-state-dao';
import { WorkspaceDao } from '../../src/db/workspace-dao';

describe('WorkflowStateDao', () => {
    test('creates a workflow state snapshot', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/db/migrations');
        await applyCliMigrations(adapter);

        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).create({ workspaceId: ws.id, agent: 'pi' });

        const dao = new WorkflowStateDao(adapter);
        const state = await dao.create({ runId: run.id, state: 'running', data: { phase: 1 } });
        expect(state.state).toBe('running');
        expect(JSON.parse(state.dataJson)).toEqual({ phase: 1 });

        adapter.close();
    });
});
