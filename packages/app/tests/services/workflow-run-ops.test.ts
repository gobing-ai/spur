import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, RunDao } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowEngineFactory } from '../../src/services/workflow-engine-factory';
import { WorkflowRunOps } from '../../src/services/workflow-run-ops';
import type { WorkflowAppServiceContext } from '../../src/services/workflow-service';

// WorkflowRunOps holds the run-lifecycle verbs (`workflow run`, `workflow cancel`, the paused-run
// lookup and the run-row stamps). Driven with a real engine over an in-memory DB and a
// shell-free workflow, so the run row it writes is the one cancel/stamp then act on.

let dir: string;
let ctx: WorkflowAppServiceContext;
let ops: WorkflowRunOps;
let wfPath: string;

const LINEAR = `name: linear
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: done
transitions:
  - from: start
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spur-wf-run-ops-'));
    const wfDir = join(dir, '.spur', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    wfPath = join(wfDir, 'linear.yaml');
    writeFileSync(wfPath, LINEAR);
    let db: ReturnType<typeof createMigratedDb> | undefined;
    ctx = {
        cwd: dir,
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    } as WorkflowAppServiceContext;
    ops = new WorkflowRunOps(ctx, new WorkflowEngineFactory(ctx));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('WorkflowRunOps', () => {
    test('run drives a workflow to its terminal state and records the run row', async () => {
        const result = await ops.run(wfPath, { runId: 'ro-1' });
        expect(result.status).toBe('done');
        expect(result.finalState).toBe('done');
        expect((await new RunDao(await ctx.getDb()).traceRowById('ro-1'))?.status).toBe('done');
        expect(await ops.latestPausedRun()).toBeNull();
    });

    test('cancel: unknown run → not_found; a terminal run is never finalized or signalled', async () => {
        expect(await ops.cancel('nope')).toEqual({
            runId: 'nope',
            finalized: false,
            status: 'not_found',
            killed: false,
        });
        await ops.run(wfPath, { runId: 'ro-2' });
        expect(await ops.cancel('ro-2')).toEqual({ runId: 'ro-2', finalized: false, status: 'done', killed: false });
    });

    test('stampPlanArtifactPath merges metadata; stampFailureReason ignores non-failed results', async () => {
        await ops.run(wfPath, { runId: 'ro-3' });
        await ops.stampPlanArtifactPath('ro-3', '.spur/run/plan.md');
        await ops.stampFailureReason('ro-3', { status: 'done' } as never);
        await ops.stampFailureReason('ro-3', { status: 'failed', reason: '' } as never);
        const row = await new RunDao(await ctx.getDb()).traceRowById('ro-3');
        const meta = JSON.parse(row?.metadata_json || '{}') as Record<string, unknown>;
        expect(meta.planArtifactPath).toBe('.spur/run/plan.md');
        expect(meta.failureReason).toBeUndefined();
        await ops.stampFailureReason('ro-3', { status: 'failed', reason: 'boom' } as never);
        const after = await new RunDao(await ctx.getDb()).traceRowById('ro-3');
        expect(after?.metadata_json ?? '').toContain('boom');
    });
});
