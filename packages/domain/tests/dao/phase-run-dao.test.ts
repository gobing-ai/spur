import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { PhaseRunDao } from '../../src/dao/phase-run-dao';
import { RunDao } from '../../src/dao/run-dao';
import { WorkspaceDao } from '../../src/dao/workspace-dao';
import { applyCliMigrations } from '../../src/migrations';

describe('PhaseRunDao', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
        const run = await new RunDao(adapter).open({ workspaceId: ws.id, agent: 'pi' });
        const otherRun = await new RunDao(adapter).open({ workspaceId: ws.id, agent: 'pi' });
        return { adapter, runId: run.id, otherRunId: otherRun.id };
    }

    test('creates a phase run', async () => {
        const { adapter, runId } = await setup();
        const dao = new PhaseRunDao(adapter);
        const phase = await dao.open({ runId, phase: 'implement' });
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
        const phase = await dao.open({ runId, phase: 'test', status: 'running' });
        expect(phase.status).toBe('running');
        adapter.close();
    });

    test('creates multiple phase runs for same run', async () => {
        const { adapter, runId } = await setup();
        const dao = new PhaseRunDao(adapter);
        const p1 = await dao.open({ runId, phase: 'plan' });
        const p2 = await dao.open({ runId, phase: 'implement' });
        const p3 = await dao.open({ runId, phase: 'verify' });
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
        const phase = await new PhaseRunDao(adapter).open({ runId, phase: 'plan' });
        const after = Date.now();
        expect(phase.createdAt).toBeGreaterThanOrEqual(before);
        expect(phase.createdAt).toBeLessThanOrEqual(after);
        expect(phase.updatedAt).toBe(phase.createdAt);
        adapter.close();
    });

    test('returns raw phase rows ordered by created_at for a given run', async () => {
        const { adapter, runId, otherRunId } = await setup();
        const dao = new PhaseRunDao(adapter);

        const p1 = await dao.open({ runId, phase: 'plan' });
        const p2 = await dao.open({ runId, phase: 'implement' });
        // A phase on a different run should be filtered out.
        await dao.open({ runId: otherRunId, phase: 'test' });

        const rows = await dao.phaseRowsByRunId(runId);
        expect(rows).toHaveLength(2);
        expect(rows[0]?.phase).toBe('plan');
        expect(rows[0]?.status).toBe('pending');
        expect(rows[1]?.phase).toBe('implement');
        // Timestamps are null until the engine starts/completes the phase.
        expect(rows[0]?.started_at).toBeNull();
        expect(rows[0]?.completed_at).toBeNull();
        expect(rows[0]?.created_at).toBeLessThanOrEqual(p2.createdAt);
        expect(p1.createdAt).toBeLessThanOrEqual(p2.createdAt);
        adapter.close();
    });

    test('returns empty array for a run id with no phases', async () => {
        const { adapter, runId, otherRunId } = await setup();
        const dao = new PhaseRunDao(adapter);

        // A different run has phases, but the queried run does not.
        await dao.open({ runId: otherRunId, phase: 'plan' });

        const rows = await dao.phaseRowsByRunId(runId);
        expect(rows).toEqual([]);
        adapter.close();
    });
});
