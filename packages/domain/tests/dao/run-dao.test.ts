import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/dao/run-dao';
import { WorkspaceDao } from '../../src/dao/workspace-dao';
import { applyCliMigrations } from '../../src/migrations';

describe('RunDao', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return adapter;
    }

    test('creates and finds a run', async () => {
        const adapter = await setup();
        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });

        const dao = new RunDao(adapter);
        const run = await dao.open({ workspaceId: ws.id, agent: 'pi' });
        expect(run.agent).toBe('pi');
        expect(run.workspaceId).toBe(ws.id);
        expect(run.status).toBe('pending');
        expect(run.completedAt).toBeNull();
        expect(run.id).toStartWith('run_');

        const found = await dao.findById(run.id);
        expect(found?.id).toBe(run.id);
        expect(found?.agent).toBe('pi');

        adapter.close();
    });

    test('creates run with default values', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const run = await dao.open({});
        expect(run.workspaceId).toBeNull();
        expect(run.agent).toBeNull();
        expect(run.status).toBe('pending');
        expect(run.startedAt).toBeGreaterThan(0);
        expect(run.createdAt).toBeGreaterThan(0);
        expect(run.updatedAt).toBeGreaterThan(0);
        adapter.close();
    });

    test('creates run with custom status', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const run = await dao.open({ status: 'running' });
        expect(run.status).toBe('running');
        adapter.close();
    });

    test('returns undefined for non-existent run', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const found = await dao.findById('run_nonexistent');
        expect(found).toBeUndefined();
        adapter.close();
    });

    test('creates multiple runs', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const r1 = await dao.open({ agent: 'pi' });
        const r2 = await dao.open({ agent: 'claude' });
        expect(r1.id).not.toBe(r2.id);
        expect(await dao.findById(r1.id)).toBeDefined();
        expect(await dao.findById(r2.id)).toBeDefined();
        adapter.close();
    });

    // Stale-run finalization (orphaned-run cleanup): the engine writes `started_at` as
    // a TEXT ISO string, so these tests insert rows in that representation to exercise
    // the real comparison path the `spur workflow clean` command relies on.
    describe('stale runs', () => {
        async function insertRun(
            adapter: Awaited<ReturnType<typeof setup>>,
            id: string,
            status: string,
            startedAtIso: string,
        ) {
            await adapter.run(
                `INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at)
                 VALUES (?, 'task-pipeline', 'state-machine', ?, ?, '{}', 0, 0)`,
                id,
                status,
                startedAtIso,
            );
        }

        test('listStaleRuns returns only non-terminal runs older than the cutoff', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const old = '2026-06-01T00:00:00.000Z';
            const recent = new Date().toISOString();
            await insertRun(adapter, 'run_old_running', 'running', old);
            await insertRun(adapter, 'run_old_pending', 'pending', old);
            await insertRun(adapter, 'run_old_done', 'done', old); // terminal — excluded
            await insertRun(adapter, 'run_recent_running', 'running', recent); // not stale — excluded

            const cutoff = '2026-06-15T00:00:00.000Z';
            const stale = await dao.listStaleRuns(cutoff);
            expect(stale.map((r) => r.id).sort()).toEqual(['run_old_pending', 'run_old_running']);
            adapter.close();
        });

        test('finalizeStale marks a running run failed with a stamped reason', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            await insertRun(adapter, 'run_x', 'running', '2026-06-01T00:00:00.000Z');

            await dao.finalizeStale('run_x', 'timeout');

            const row = await dao.traceRowById('run_x');
            expect(row?.status).toBe('failed');
            expect(row?.completed_at).not.toBeNull();
            expect(JSON.parse(row?.metadata_json ?? '{}').staleReason).toBe('timeout');
            adapter.close();
        });

        test('finalizeStale does not clobber an already-terminal run', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            await insertRun(adapter, 'run_done', 'done', '2026-06-01T00:00:00.000Z');

            await dao.finalizeStale('run_done', 'should-not-apply');

            const row = await dao.traceRowById('run_done');
            expect(row?.status).toBe('done'); // unchanged — status guard in WHERE
            adapter.close();
        });
    });

    describe('trace queries', () => {
        test('traceRows returns runs matching status filter', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const r1 = await dao.open({ agent: 'pi', status: 'running' });
            await dao.open({ agent: 'claude', status: 'done' });

            const rows = await dao.traceRows({ status: 'running', limit: 10 });
            expect(rows.length).toBeGreaterThanOrEqual(1);
            expect(rows.some((r) => r.id === r1.id)).toBe(true);
            adapter.close();
        });

        test('traceRows filters by workflow when specified', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            await adapter.run(
                `INSERT INTO runs (id, workflow_name, mode, status, started_at, created_at, updated_at)
                 VALUES ('run_wf', 'deploy', 'state-machine', 'running', 0, 0, 0)`,
            );

            const rows = await dao.traceRows({ workflow: 'deploy', limit: 10 });
            expect(rows.length).toBe(1);
            expect(rows[0]?.id).toBe('run_wf');
            adapter.close();
        });

        test('traceRows applies limit', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            await dao.open({ agent: 'pi' });
            await dao.open({ agent: 'pi' });

            const rows = await dao.traceRows({ limit: 1 });
            expect(rows.length).toBe(1);
            adapter.close();
        });

        test('traceRows projects agent and supports exclusive keyset before (task 0373)', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            await adapter.run(
                `INSERT INTO runs (id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json, created_at, updated_at)
                 VALUES
                   ('run_a', 'pipe', 'state-machine', 'done', 'omp', '2026-07-01T10:00:00.000Z', '2026-07-01T10:01:00.000Z', '{}', 1, 1),
                   ('run_b', 'pipe', 'state-machine', 'done', 'pi', '2026-07-01T11:00:00.000Z', '2026-07-01T11:01:00.000Z', '{}', 2, 2),
                   ('run_c', 'pipe', 'state-machine', 'running', 'claude', '2026-07-01T12:00:00.000Z', NULL, '{}', 3, 3)`,
            );

            const first = await dao.traceRows({ limit: 1 });
            expect(first).toHaveLength(1);
            const head = first[0];
            expect(head?.id).toBe('run_c');
            expect(head?.agent).toBe('claude');
            expect(head).toBeDefined();

            const next = await dao.traceRows({
                limit: 10,
                before: { started_at: head?.started_at ?? '', id: head?.id ?? '' },
            });
            expect(next.map((r) => r.id)).toEqual(['run_b', 'run_a']);
            expect(next[0]?.agent).toBe('pi');
            adapter.close();
        });

        test('traceRowById returns run-level fields', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });
            const run = await dao.open({ workspaceId: ws.id, agent: 'pi', status: 'running' });

            const row = await dao.traceRowById(run.id);
            expect(row).toBeDefined();
            expect(row?.id).toBe(run.id);
            expect(row?.status).toBe('running');
            expect(row?.workflow_name).toBeDefined();
            expect(row?.agent).toBe('pi');
            adapter.close();
        });

        test('traceRowById returns undefined for missing run', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const row = await dao.traceRowById('run_nonexistent');
            // queryFirst returns undefined for no row (SQLite null → undefined).
            expect(row).toBeFalsy();
            adapter.close();
        });
    });

    describe('metadata and pid', () => {
        test('stampMetadata writes and persists JSON metadata', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const run = await dao.open({ agent: 'pi' });

            await dao.stampMetadata(run.id, { dryRun: true, version: 2 });

            const found = await dao.findById(run.id);
            const meta = JSON.parse(found?.metadataJson ?? '{}');
            expect(meta.dryRun).toBe(true);
            expect(meta.version).toBe(2);
            adapter.close();
        });

        test('stampFailureReason merges with existing metadata', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const run = await dao.open({ agent: 'pi' });
            await dao.stampMetadata(run.id, { dryRun: true });

            await dao.stampFailureReason(run.id, 'no-passing-transition');

            const row = await dao.traceRowById(run.id);
            expect(JSON.parse(row?.metadata_json ?? '{}')).toEqual({
                dryRun: true,
                failureReason: 'no-passing-transition',
            });
            adapter.close();
        });

        test('setPid and getPid round-trip', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const run = await dao.open({ agent: 'pi' });

            await dao.setPid(run.id, 12345);

            const pid = await dao.getPid(run.id);
            expect(pid).toBe(12345);
            adapter.close();
        });

        test('getPid returns null for unset pid', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const run = await dao.open({ agent: 'pi' });

            const pid = await dao.getPid(run.id);
            expect(pid).toBeNull();
            adapter.close();
        });

        test('setPid accepts null to clear', async () => {
            const adapter = await setup();
            const dao = new RunDao(adapter);
            const run = await dao.open({ agent: 'pi' });
            await dao.setPid(run.id, 12345);
            await dao.setPid(run.id, null);

            const pid = await dao.getPid(run.id);
            expect(pid).toBeNull();
            adapter.close();
        });
    });
});
