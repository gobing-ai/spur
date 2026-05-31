import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/dao/run-dao';
import { WorkflowStateDao } from '../../src/dao/workflow-state-dao';
import { WorkspaceDao } from '../../src/dao/workspace-dao';
import { applyCliMigrations } from '../../src/migrations';

describe('WorkflowStateDao', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).open({ workspaceId: ws.id, agent: 'pi' });
        return { adapter, runId: run.id };
    }

    test('creates a workflow state snapshot', async () => {
        const { adapter, runId } = await setup();
        const dao = new WorkflowStateDao(adapter);
        const state = await dao.snapshot({ runId, state: 'running', data: { phase: 1 } });
        expect(state.state).toBe('running');
        expect(JSON.parse(state.dataJson)).toEqual({ phase: 1 });
        expect(state.runId).toBe(runId);
        expect(state.id).toStartWith('state_');
        adapter.close();
    });

    test('creates state with default empty data', async () => {
        const { adapter, runId } = await setup();
        const dao = new WorkflowStateDao(adapter);
        const state = await dao.snapshot({ runId, state: 'idle' });
        expect(JSON.parse(state.dataJson)).toEqual({});
        adapter.close();
    });

    test('creates state with complex nested data', async () => {
        const { adapter, runId } = await setup();
        const dao = new WorkflowStateDao(adapter);
        const data = { steps: ['plan', 'implement'], meta: { count: 5, active: true } };
        const state = await dao.snapshot({ runId, state: 'active', data });
        expect(JSON.parse(state.dataJson)).toEqual(data);
        adapter.close();
    });

    test('creates multiple states for same run', async () => {
        const { adapter, runId } = await setup();
        const dao = new WorkflowStateDao(adapter);
        const s1 = await dao.snapshot({ runId, state: 'init' });
        const s2 = await dao.snapshot({ runId, state: 'running' });
        expect(s1.id).not.toBe(s2.id);
        expect(s1.state).toBe('init');
        expect(s2.state).toBe('running');
        adapter.close();
    });

    test('sets timestamps', async () => {
        const { adapter, runId } = await setup();
        const before = Date.now();
        const state = await new WorkflowStateDao(adapter).snapshot({ runId, state: 'x' });
        const after = Date.now();
        expect(state.createdAt).toBeGreaterThanOrEqual(before);
        expect(state.createdAt).toBeLessThanOrEqual(after);
        expect(state.updatedAt).toBe(state.createdAt);
        adapter.close();
    });
});
