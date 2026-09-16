import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActionRunDao, RunDao } from '@gobing-ai/spur-domain';
import type { WorkflowPersistenceAdapter, WorkflowRunRecord, WorkflowStatus } from '@gobing-ai/ts-dual-workflow-engine';
import { DbWorkflowPersistenceAdapter } from '@gobing-ai/ts-dual-workflow-engine';
import {
    type ActionTraceFailure,
    createRunLogTraceFailureRecorder,
    createWorkflowActionTraceWriter,
    type InlineRunProjectDb,
    openInlineRunProjectDb,
    RunRowNotFoundError,
    WorkflowActionTraceWriter,
    withActionTrace,
} from '../../src';

/**
 * Task 0868 (ADR-117) — the surface-agnostic action trace writer.
 *
 * R4: every executed action gets an `action_runs` row carrying node, kind, status, ok and
 * duration_ms, queryable by run id. R12: an emission failure is recorded and the run still
 * reaches its declared terminal state. R5/R7: the writer routes the action boundary and the
 * run-row closure through the engine's own persistence methods, so the inline driver and the
 * engine runner cannot drift.
 */

const RUN_ID = 'run-0868-trace';

function runRecord() {
    return {
        id: RUN_ID,
        workflow_name: 'inline-smoke',
        mode: 'state-machine',
        status: 'running' as WorkflowStatus,
        started_at: '2026-09-16T00:00:00.000Z',
        completed_at: null,
        metadata_json: '{}',
    };
}

describe('WorkflowActionTraceWriter (task 0868 R4/R12)', () => {
    let base: string;
    let projectDb: InlineRunProjectDb;

    beforeAll(async () => {
        base = mkdtempSync(join(tmpdir(), 'spur-0868-trace-'));
        projectDb = await openInlineRunProjectDb(base);
    });

    afterAll(() => {
        projectDb.close();
        rmSync(base, { recursive: true, force: true });
    });

    beforeEach(async () => {
        await projectDb.adapter.run('DELETE FROM action_runs');
        await projectDb.adapter.run('DELETE FROM runs');
    });

    test('R4: recordAction writes an action_runs row (node, kind, status, ok, duration_ms) queryable by run id', async () => {
        const writer = createWorkflowActionTraceWriter(projectDb.adapter);
        await writer.createRun(runRecord());

        const result = await writer.recordAction({
            runId: RUN_ID,
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            ok: true,
            durationMs: 1234,
        });
        expect(result).toMatchObject({ ok: true });

        // Queryable by run id through the domain DAO — no `.spur/run/<run-id>.log` read.
        const rows = await new ActionRunDao(projectDb.adapter).actionRowsByRunId(RUN_ID);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            duration_ms: 1234,
            ok: 1,
        });
    });

    test('R4: a failed action records ok=0 with its own duration, one row per boundary', async () => {
        const writer = createWorkflowActionTraceWriter(projectDb.adapter);
        await writer.createRun(runRecord());

        await writer.recordAction({
            runId: RUN_ID,
            node: 'test',
            kind: 'shell',
            status: 'failed',
            ok: false,
            durationMs: 42,
        });
        await writer.recordAction({
            runId: RUN_ID,
            node: 'review',
            kind: 'agent.run',
            status: 'done',
            ok: true,
            durationMs: 7,
        });

        const rows = await new ActionRunDao(projectDb.adapter).actionRowsByRunId(RUN_ID);
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => [r.node, r.kind, r.status, r.ok, r.duration_ms])).toEqual([
            ['test', 'shell', 'failed', 0, 42],
            ['review', 'agent.run', 'done', 1, 7],
        ]);
    });

    test('R6/R7: closeRun marks the run row terminal through the shared finalizeRun path', async () => {
        const writer = createWorkflowActionTraceWriter(projectDb.adapter);
        await writer.createRun(runRecord());
        expect((await new RunDao(projectDb.adapter).traceRowById(RUN_ID))?.status).toBe('running');

        const result = await writer.closeRun(RUN_ID, 'done');
        expect(result).toEqual({ ok: true });

        const row = await new RunDao(projectDb.adapter).traceRowById(RUN_ID);
        expect(row?.status).toBe('done');
        expect(row?.completed_at).not.toBeNull();
    });

    test('R5/R7: the writer delegates the action boundary and run closure to the wrapped adapter', async () => {
        const calls: string[] = [];
        const inner = {
            saveActionStart: async () => {
                calls.push('start');
                return 'inner-action-id';
            },
            saveActionFinalize: async () => {
                calls.push('finish');
            },
            loadRun: async () => {
                calls.push('loadRun');
                return runRecord();
            },
            finalizeRun: async () => {
                calls.push('close');
            },
        } as unknown as WorkflowPersistenceAdapter;

        const writer = withActionTrace(inner);
        await writer.recordAction({
            runId: RUN_ID,
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            ok: true,
            durationMs: 1,
        });
        await writer.closeRun(RUN_ID, 'done');

        expect(calls).toEqual(['start', 'finish', 'loadRun', 'close']);
    });

    test('R12: an action-emission failure is recorded and swallowed, and the run still closes terminal', async () => {
        const failures: ActionTraceFailure[] = [];
        // The action boundary fails; the run-row closure keeps working — the AC's
        // "the workflow reaches its declared terminal state".
        const real = new DbWorkflowPersistenceAdapter(projectDb.adapter);
        const inner = {
            saveActionStart: async () => {
                throw new Error('injected action-start failure');
            },
            loadRun: (runId: string) => real.loadRun(runId),
            finalizeRun: (runId: string, status: WorkflowStatus, completedAt: string) =>
                real.finalizeRun(runId, status, completedAt),
        } as unknown as WorkflowPersistenceAdapter;
        // A working run row exists; only the action write fails.
        await createWorkflowActionTraceWriter(projectDb.adapter).createRun(runRecord());

        const writer = new WorkflowActionTraceWriter(inner, (failure) => failures.push(failure));
        const action = await writer.recordAction({
            runId: RUN_ID,
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            ok: true,
            durationMs: 9,
        });

        expect(action.ok).toBe(false);
        expect(failures).toHaveLength(1);
        const failure = failures[0];
        expect(failure).toMatchObject({ operation: 'action.start', runId: RUN_ID, node: 'implement' });
        expect(failure?.error).toContain('injected action-start failure');
        // No row, no throw.
        expect(await new ActionRunDao(projectDb.adapter).actionRowsByRunId(RUN_ID)).toHaveLength(0);

        // The run still reaches its declared terminal state.
        expect(await writer.closeRun(RUN_ID, 'done')).toEqual({ ok: true });
        expect((await new RunDao(projectDb.adapter).traceRowById(RUN_ID))?.status).toBe('done');
    });

    test('R6/R7: a run-closure persistence failure propagates — the closure is bookkeeping, not best-effort', async () => {
        const inner = {
            loadRun: async () => runRecord(),
            finalizeRun: async () => {
                throw new Error('injected close failure');
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = new WorkflowActionTraceWriter(inner);

        await expect(writer.closeRun(RUN_ID, 'done')).rejects.toThrow('injected close failure');
    });

    test('finalizeRun propagates a persistence failure directly (finding #1 — engine/lifecycle closure)', async () => {
        const inner = {
            finalizeRun: async () => {
                throw new Error('injected close failure');
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = new WorkflowActionTraceWriter(inner);

        await expect(writer.finalizeRun(RUN_ID, 'done', '2026-09-16T00:00:00.000Z')).rejects.toThrow(
            'injected close failure',
        );
    });

    test('closeRun raises RunRowNotFoundError for a run id with no row (finding #4)', async () => {
        const writer = createWorkflowActionTraceWriter(projectDb.adapter);

        await expect(writer.closeRun('run-0868-does-not-exist', 'done')).rejects.toMatchObject({
            name: 'RunRowNotFoundError',
            runId: 'run-0868-does-not-exist',
        });
        expect(RunRowNotFoundError).toBeDefined();
    });

    test('R12: a throwing failure recorder does not turn best-effort emission into a throw', async () => {
        const inner = {
            saveActionStart: async () => {
                throw new Error('injected start failure');
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = new WorkflowActionTraceWriter(inner, () => {
            throw new Error('recorder exploded');
        });

        const result = await writer.recordAction({
            runId: RUN_ID,
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            ok: true,
            durationMs: 1,
        });
        expect(result.ok).toBe(false);
    });

    test('saveActionStart keeps the engine control loop alive by returning a synthetic id on failure', async () => {
        const inner = {
            saveActionStart: async () => {
                throw new Error('injected start failure');
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = new WorkflowActionTraceWriter(inner);
        const actionId = await writer.saveActionStart(RUN_ID, 'implement', 'agent.run');
        expect(actionId).toMatch(/^trace-unpersisted:/);
        // Finalizing the synthetic id is a no-op that never throws either.
        await writer.saveActionFinalize(actionId, 'done', 1, true, 'agent.run');
    });

    test('a finalize whose start this instance never observed keeps the run id in the failure record (finding #3)', async () => {
        const failures: ActionTraceFailure[] = [];
        const inner = {
            saveActionStart: async () => {
                throw new Error('injected start failure');
            },
            saveActionFinalize: async () => {
                throw new Error('injected finish failure');
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = new WorkflowActionTraceWriter(inner, (failure) => failures.push(failure));

        // Start fails → synthetic id; the engine passes that id back to finalize.
        const actionId = await writer.saveActionStart(RUN_ID, 'implement', 'agent.run');
        expect(actionId).toMatch(/^trace-unpersisted:/);
        await writer.saveActionFinalize(actionId, 'done', 1, true, 'agent.run');

        expect(failures).toHaveLength(2);
        expect(failures[0]).toMatchObject({ operation: 'action.start', runId: RUN_ID });
        expect(failures[1]).toMatchObject({
            operation: 'action.finish',
            runId: RUN_ID,
            node: 'implement',
            kind: 'agent.run',
        });
    });

    test('the engine call sequence — saveActionStart → saveActionFinalize → finalizeRun — flows through the guarded boundary', async () => {
        const calls: Array<string[]> = [];
        const inner = {
            saveActionStart: async (runId: string, node: string, kind: string) => {
                calls.push(['start', runId, node, kind]);
                return 'engine-action-id';
            },
            saveActionFinalize: async (actionId: string, status: string, durationMs: number, ok: boolean) => {
                calls.push(['finish', actionId, status, String(durationMs), String(ok)]);
            },
            finalizeRun: async (runId: string, status: string) => {
                calls.push(['close', runId, status]);
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = withActionTrace(inner);

        const actionId = await writer.saveActionStart(RUN_ID, 'implement', 'agent.run');
        expect(actionId).toBe('engine-action-id');
        await writer.saveActionFinalize(actionId, 'done', 1234, true, 'agent.run');
        await writer.finalizeRun(RUN_ID, 'done', '2026-09-16T00:00:00.000Z');

        expect(calls).toEqual([
            ['start', RUN_ID, 'implement', 'agent.run'],
            ['finish', 'engine-action-id', 'done', '1234', 'true'],
            ['close', RUN_ID, 'done'],
        ]);
    });

    test('recordAction: a finalize failure after a successful start records operation=action.finish and never throws', async () => {
        const failures: ActionTraceFailure[] = [];
        const inner = {
            saveActionStart: async () => 'real-action-id',
            saveActionFinalize: async () => {
                throw new Error('injected finish failure');
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = new WorkflowActionTraceWriter(inner, (failure) => failures.push(failure));

        const result = await writer.recordAction({
            runId: RUN_ID,
            node: 'implement',
            kind: 'agent.run',
            status: 'done',
            ok: true,
            durationMs: 9,
        });

        expect(result.ok).toBe(false);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
            operation: 'action.finish',
            runId: RUN_ID,
            node: 'implement',
            kind: 'agent.run',
        });
    });

    test('non-action lifecycle and read methods pass straight through to the wrapped adapter', async () => {
        const calls: string[] = [];
        const inner = {
            createRun: async () => calls.push('createRun'),
            savePhase: async () => calls.push('savePhase'),
            saveTransition: async () => calls.push('saveTransition'),
            saveWorkflowState: async () => calls.push('saveWorkflowState'),
            commitTransition: async () => calls.push('commitTransition'),
            loadRun: async () => {
                calls.push('loadRun');
                return undefined;
            },
            listRuns: async () => {
                calls.push('listRuns');
                return [];
            },
            findRunByKey: async () => {
                calls.push('findRunByKey');
                return undefined;
            },
            createOrAttachRun: async (record: WorkflowRunRecord) => {
                calls.push('createOrAttachRun');
                return record;
            },
            reseedRun: async () => {
                calls.push('reseedRun');
                return {};
            },
            loadCurrentState: async () => {
                calls.push('loadCurrentState');
                return undefined;
            },
            loadLatestStateSnapshot: async () => {
                calls.push('loadLatestStateSnapshot');
                return undefined;
            },
            listPausedRuns: async () => {
                calls.push('listPausedRuns');
                return [];
            },
        } as unknown as WorkflowPersistenceAdapter;
        const writer = withActionTrace(inner);

        await writer.createRun(runRecord());
        await writer.savePhase(RUN_ID, 'phase', 'running');
        await writer.saveTransition(RUN_ID, 'a', 'b', 'trigger');
        await writer.saveWorkflowState(RUN_ID, 'a', {});
        await writer.commitTransition(RUN_ID, 'a', 'b', 'trigger', 'a', {});
        await writer.loadRun(RUN_ID);
        await writer.listRuns();
        await writer.findRunByKey('wf', 'key');
        await writer.createOrAttachRun(runRecord());
        await writer.reseedRun(RUN_ID, 'a');
        await writer.loadCurrentState(RUN_ID);
        await writer.loadLatestStateSnapshot(RUN_ID);
        await writer.listPausedRuns({ workflowName: 'wf', limit: 1 });

        expect(calls).toEqual([
            'createRun',
            'savePhase',
            'saveTransition',
            'saveWorkflowState',
            'commitTransition',
            'loadRun',
            'listRuns',
            'findRunByKey',
            'createOrAttachRun',
            'reseedRun',
            'loadCurrentState',
            'loadLatestStateSnapshot',
            'listPausedRuns',
        ]);
    });
});

describe('createRunLogTraceFailureRecorder (task 0868 R3/R4)', () => {
    let base: string;

    beforeAll(() => {
        base = mkdtempSync(join(tmpdir(), 'spur-0868-recorder-'));
    });

    afterAll(() => {
        rmSync(base, { recursive: true, force: true });
    });

    async function waitForLog(runId: string, timeoutMs = 3000): Promise<string> {
        const path = join(base, '.spur', 'run', `${runId.replace(/[^A-Za-z0-9._-]/g, '_')}.log`);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const content = readFileSync(path, 'utf8');
                if (content.trim() !== '') return content;
            } catch {
                // not written yet
            }
            await Bun.sleep(20);
        }
        throw new Error(`timed out waiting for ${path}`);
    }

    test('appends a trace-emission-failed line to the run log, demoting the text log to a convenience record', async () => {
        const recorder = createRunLogTraceFailureRecorder(base);
        recorder({
            operation: 'action.finish',
            runId: 'run/unsafe-id',
            node: 'implement',
            kind: 'agent.run',
            error: 'injected failure',
            at: '2026-09-16T00:00:00Z',
        });

        const log = await waitForLog('run/unsafe-id');
        expect(log).toContain('trace-emission-failed');
        expect(log).toContain('operation=action.finish');
        expect(log).toContain('run=run/unsafe-id');
        expect(log).toContain('node=implement kind=agent.run');
        expect(log).toContain('injected failure');
    });

    test('omits the node/kind segment when neither is present', async () => {
        const recorder = createRunLogTraceFailureRecorder(base);
        recorder({
            operation: 'run.close',
            runId: 'plain-id',
            error: 'boom',
            at: '2026-09-16T00:00:00Z',
        });

        const log = await waitForLog('plain-id');
        expect(log).toContain('trace-emission-failed operation=run.close run=plain-id: boom');
        expect(log).not.toContain('node=');
    });
});
