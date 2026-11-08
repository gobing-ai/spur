import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, RunDao } from '@gobing-ai/spur-domain';
import { ValidationError } from '@gobing-ai/ts-utils';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowEngineFactory } from '../../src/services/workflow-engine-factory';
import { WorkflowResumeOps } from '../../src/services/workflow-resume-ops';
import { WorkflowRunOps } from '../../src/services/workflow-run-ops';
import type { WorkflowAppService, WorkflowAppServiceContext } from '../../src/services/workflow-service';
import { rowToTraceEntry } from '../../src/services/workflow-trace-projection';
import { buildStepProfile } from '../../src/workflow/step-profile';

// WorkflowResumeOps holds `workflow continue` and the read-only pending-gate inspection. The
// answer-flag check goes back through the owning service's public `pendingGate`, so a host that
// forwards to this collaborator makes that routing observable.

let dir: string;
let wfPath: string;
let runOps: WorkflowRunOps;
let resume: WorkflowResumeOps;
let gateLookups: string[];
let getDb: WorkflowAppServiceContext['getDb'];

const CONFIRM_GATE = `name: confirm-gate
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: gate
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Approve?"
  - id: done
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spur-wf-resume-ops-'));
    const wfDir = join(dir, '.spur', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    wfPath = join(wfDir, 'confirm-gate.yaml');
    writeFileSync(wfPath, CONFIRM_GATE);
    let db: ReturnType<typeof createMigratedDb> | undefined;
    const ctx = {
        cwd: dir,
        getDb: async () => {
            db ??= createMigratedDb({ url: ':memory:' });
            return db;
        },
        agentService: () => ({ run: async () => 0 }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    } as WorkflowAppServiceContext;
    getDb = ctx.getDb;
    const engine = new WorkflowEngineFactory(ctx);
    runOps = new WorkflowRunOps(ctx, engine);
    gateLookups = [];
    const host = {
        pendingGate: (runId: string) => {
            gateLookups.push(runId);
            return resume.pendingGate(runId);
        },
    } as unknown as WorkflowAppService;
    resume = new WorkflowResumeOps(host, ctx, engine, runOps);
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('WorkflowResumeOps', () => {
    test('pendingGate names the paused confirm gate; unknown and terminal runs have none', async () => {
        expect((await runOps.run(wfPath, { runId: 'rs-1' })).status).toBe('paused');
        expect(await resume.pendingGate('rs-1')).toEqual({
            stateId: 'gate',
            kind: 'hitl.confirm',
            answerVar: '__hitlAnswer',
        });
        expect(await resume.pendingGate('no-such-run')).toBeNull();
    });

    test('continuePaused refuses a run that is not paused or interrupted', async () => {
        await expect(resume.continuePaused('no-such-run')).rejects.toThrow('is not resumable (status: missing)');
    });

    test('an answer flag mismatched to the gate kind is refused via host.pendingGate before resuming', async () => {
        await runOps.run(wfPath, { runId: 'rs-2' });
        await expect(resume.continuePaused('rs-2', { answerText: 'free text' })).rejects.toBeInstanceOf(
            ValidationError,
        );
        await expect(resume.continuePaused('rs-2', { answerText: 'x', hitlAnswer: 'yes' })).rejects.toThrow('not both');
        expect(gateLookups).toEqual(['rs-2']);
        // The run is still paused at the gate after the refusals.
        expect((await resume.pendingGate('rs-2'))?.stateId).toBe('gate');
    });

    test('a matching --answer resumes the paused run to its terminal state', async () => {
        await runOps.run(wfPath, { runId: 'rs-3' });
        const resumed = await resume.continuePaused('rs-3', { hitlAnswer: 'yes' });
        expect(resumed.status).toBe('done');
        expect(resumed.finalState).toBe('done');
        expect(gateLookups).toEqual(['rs-3']);
        expect(await resume.pendingGate('rs-3')).toBeNull();
    });

    // 1319 R8 on a real paused row (`runs.updated_at` is INTEGER epoch ms — the shape a string-only
    // parser silently dropped). Failure modes: a stale paused run goes unlabelled; a fresh or
    // terminal one gets labelled; the hint stops naming `workflow continue`; the profile misses
    // hostMs or grows it on a node that never paused.
    test('a paused run past its budget is labelled stalled with the resume hint; the label is derived', async () => {
        await runOps.run(wfPath, { runId: 'rs-4' });
        const before = await new RunDao(await getDb()).traceRowById('rs-4');
        if (before === undefined) throw new Error('run row missing');
        const pausedSince = Number(before.updated_at);
        expect(Number.isFinite(pausedSince)).toBe(true);

        const stale = rowToTraceEntry(before, dir, pausedSince + 2 * 60 * 60 * 1000);
        expect(stale.status).toBe('paused');
        expect(stale.stalled).toBe(true);
        expect(stale.stalledMs).toBe(2 * 60 * 60 * 1000);
        expect(stale.nextAction).toEqual({
            label: 'Resume stalled run',
            kind: 'command',
            value: 'spur workflow continue rs-4',
        });
        expect(rowToTraceEntry(before, dir, pausedSince + 1000).stalled).toBeUndefined();

        // The label never mutated the run: it still resumes, and a finished run is never stalled.
        expect((await resume.continuePaused('rs-4', { hitlAnswer: 'yes' })).status).toBe('done');
        const after = await new RunDao(await getDb()).traceRowById('rs-4');
        if (after === undefined) throw new Error('run row missing');
        expect(rowToTraceEntry(after, dir, pausedSince + 10 * 60 * 60 * 1000).stalled).toBeUndefined();
    });

    test('the step profile folds measured host pauses into hostMs on the paused action row only', () => {
        const profile = buildStepProfile({
            workflow: 'confirm-gate',
            windowSec: 3600,
            runs: [
                {
                    runId: 'rs-5',
                    events: [
                        { kind: 'action', node: 'gate', actionKind: 'hitl.confirm', durationMs: 2 },
                        { kind: 'action', node: 'gate', actionKind: 'agent.run', durationMs: 2 },
                        { kind: 'action', node: 'gate', actionKind: 'shell', durationMs: 3 },
                        { kind: 'action', node: 'start', actionKind: 'note', durationMs: 1 },
                    ],
                    hostPauses: [
                        { node: 'gate', action: 'hitl.confirm', hostDurationMs: 60_000 },
                        { node: 'gate', action: 'hitl.confirm', hostDurationMs: 5_000 },
                        // A legacy record without `action` was an agent.run pause.
                        { node: 'gate', hostDurationMs: 7_000 },
                    ],
                },
            ],
        });
        const gate = (kind: string) => profile.rows.find((row) => row.node === 'gate' && row.actionKind === kind);
        expect(gate('hitl.confirm')?.hostMs).toBe(65_000);
        // The sibling action of the same node never inherits another action's pause.
        expect(gate('agent.run')?.hostMs).toBe(7_000);
        expect(gate('shell')?.hostMs).toBeUndefined();
        expect(profile.rows.find((row) => row.node === 'start')?.hostMs).toBeUndefined();
    });
});
