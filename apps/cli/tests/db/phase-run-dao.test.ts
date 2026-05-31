import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations } from '../../src/db/migrations';
import { PhaseRunDao } from '../../src/db/phase-run-dao';
import { RunDao } from '../../src/db/run-dao';
import { WorkspaceDao } from '../../src/db/workspace-dao';

describe('PhaseRunDao', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).create({ workspaceId: ws.id, agent: 'pi' });
        return { adapter, runId: run.id };
    }

    test('creates a phase run', async () => {
        const { adapter, runId } = await setup();
        const dao = new PhaseRunDao(adapter);
        const phase = await dao.create({ runId, phase: 'implement' });
        expect(phase.phase).toBe('implement');
        expect(phase.status).toBe('pending');
        expect(phase.runId).toBe(runId);
        expect(phase.startedAt).toBeNull();
        expect(phase.completedAt).toBeNull();
        expect(phase.id).toStartWith('phase_');
        adapter.close();
    });

    test('creates phase run with custom status', async () => {
        const { adapter, runId } = await setup();
        const dao = new PhaseRunDao(adapter);
        const phase = await dao.create({ runId, phase: 'test', status: 'running' });
        expect(phase.status).toBe('running');
        adapter.close();
    });

    test('creates multiple phase runs for same run', async () => {
        const { adapter, runId } = await setup();
        const dao = new PhaseRunDao(adapter);
        const p1 = await dao.create({ runId, phase: 'plan' });
        const p2 = await dao.create({ runId, phase: 'implement' });
        const p3 = await dao.create({ runId, phase: 'verify' });
        expect(p1.id).not.toBe(p2.id);
        expect(p2.id).not.toBe(p3.id);
        expect(p1.phase).toBe('plan');
        expect(p2.phase).toBe('implement');
        expect(p3.phase).toBe('verify');
        adapter.close();
    });

    test('sets timestamps', async () => {
        const { adapter, runId } = await setup();
        const before = Date.now();
        const phase = await new PhaseRunDao(adapter).create({ runId, phase: 'plan' });
        const after = Date.now();
        expect(phase.createdAt).toBeGreaterThanOrEqual(before);
        expect(phase.createdAt).toBeLessThanOrEqual(after);
        expect(phase.updatedAt).toBe(phase.createdAt);
        adapter.close();
    });
});
