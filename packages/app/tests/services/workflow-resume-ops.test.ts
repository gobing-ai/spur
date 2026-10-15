import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { ValidationError } from '@gobing-ai/ts-utils';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowEngineFactory } from '../../src/services/workflow-engine-factory';
import { WorkflowResumeOps } from '../../src/services/workflow-resume-ops';
import { WorkflowRunOps } from '../../src/services/workflow-run-ops';
import type { WorkflowAppService, WorkflowAppServiceContext } from '../../src/services/workflow-service';

// WorkflowResumeOps holds `workflow continue` and the read-only pending-gate inspection. The
// answer-flag check goes back through the owning service's public `pendingGate`, so a host that
// forwards to this collaborator makes that routing observable.

let dir: string;
let wfPath: string;
let runOps: WorkflowRunOps;
let resume: WorkflowResumeOps;
let gateLookups: string[];

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
});
