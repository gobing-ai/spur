import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/dao/run-dao';
import { TransitionRunDao } from '../../src/dao/transition-run-dao';
import { WorkspaceDao } from '../../src/dao/workspace-dao';
import { applyCliMigrations } from '../../src/migrations';

describe('TransitionRunDao', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).open({ workspaceId: ws.id, agent: 'pi' });
        return { adapter, runId: run.id };
    }

    test('creates a transition run', async () => {
        const { adapter, runId } = await setup();
        const dao = new TransitionRunDao(adapter);
        const transition = await dao.open({ runId, fromState: 'plan', toState: 'implement' });
        expect(transition.fromState).toBe('plan');
        expect(transition.toState).toBe('implement');
        expect(transition.status).toBe('pending');
        expect(transition.runId).toBe(runId);
        expect(transition.id).toStartWith('transition_');
        adapter.close();
    });

    test('creates transition with custom status', async () => {
        const { adapter, runId } = await setup();
        const dao = new TransitionRunDao(adapter);
        const transition = await dao.open({ runId, fromState: 'implement', toState: 'verify', status: 'completed' });
        expect(transition.status).toBe('completed');
        adapter.close();
    });

    test('creates multiple transitions for same run', async () => {
        const { adapter, runId } = await setup();
        const dao = new TransitionRunDao(adapter);
        const t1 = await dao.open({ runId, fromState: 'init', toState: 'plan' });
        const t2 = await dao.open({ runId, fromState: 'plan', toState: 'implement' });
        expect(t1.id).not.toBe(t2.id);
        expect(t1.fromState).toBe('init');
        expect(t2.fromState).toBe('plan');
        adapter.close();
    });

    test('sets timestamps', async () => {
        const { adapter, runId } = await setup();
        const before = Date.now();
        const transition = await new TransitionRunDao(adapter).open({ runId, fromState: 'a', toState: 'b' });
        const after = Date.now();
        expect(transition.createdAt).toBeGreaterThanOrEqual(before);
        expect(transition.createdAt).toBeLessThanOrEqual(after);
        expect(transition.updatedAt).toBe(transition.createdAt);
        adapter.close();
    });
});
