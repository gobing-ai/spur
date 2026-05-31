import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/db/run-dao';
import { TransitionRunDao } from '../../src/db/transition-run-dao';
import { WorkspaceDao } from '../../src/db/workspace-dao';

describe('TransitionRunDao', () => {
    test('creates a transition run', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { applyCliMigrations } = await import('../../src/db/migrations');
        await applyCliMigrations(adapter);

        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).create({ workspaceId: ws.id, agent: 'pi' });

        const dao = new TransitionRunDao(adapter);
        const transition = await dao.create({ runId: run.id, fromState: 'plan', toState: 'implement' });
        expect(transition.fromState).toBe('plan');
        expect(transition.toState).toBe('implement');
        expect(transition.status).toBe('pending');

        adapter.close();
    });
});
