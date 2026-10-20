import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';

// Task 0759 (proportional routing) as re-keyed by D65 1239: the lane decision, its deterministic
// safety floor and the run-attributed route claim survive the seven-state rewrite; the four
// gate-PASS edges and the `triage`/`test-recheck` states do not. Routing is now:
//   gate (lane decide + typed gate) → review (focus from the lane) → done | failed
//   gate (red) → remediate → gate (recheck)  — one gate state, mode by visit.

const REPO_ROOT = join(import.meta.dir, '../../../../');
const PIPELINE_PATH = join(REPO_ROOT, 'config', 'workflows', 'task-pipeline.yaml');

/** The literal YAML var template (`${vars.x}`) the definition carries — asserted, never interpolated. */
const VAR = (name: string): string => ['$', '{vars.', name, '}'].join('');

interface StateDef {
    id: string;
    onEnter?: Array<{ kind: string; options?: Record<string, unknown> }>;
}

interface TransitionDef {
    from: string;
    to: string;
    description?: string;
    terminalReason?: string;
    guard?: { kind: string; options?: Record<string, unknown> };
}

interface WorkflowYaml {
    name: string;
    iterationBound?: number;
    vars?: Record<string, string>;
    states: StateDef[];
    transitions: TransitionDef[];
}

describe('task-pipeline proportional routing (task 0759, S5; re-keyed by D65 1239)', () => {
    const raw = readFileSync(PIPELINE_PATH, 'utf8');
    const def = loadWorkflowDefFromText(raw, PIPELINE_PATH) as unknown as WorkflowYaml;

    test('R1: declares mode and __runId in vars', () => {
        expect(def.vars).toBeDefined();
        expect(def.vars?.mode).toBe('');
        expect(def.vars?.__runId).toBe('');
    });

    test('R1/R4: precheck evaluates closed route table and writes bounded reason', () => {
        const precheck = def.states.find((s) => s.id === 'precheck');
        expect(precheck).toBeDefined();
        const shell = precheck?.onEnter?.find(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('route-reason.txt'),
        );
        expect(shell).toBeDefined();
        const cmd = String(shell?.options?.command ?? '');
        expect(cmd).toContain('fast:evidence complete+consistent');
        expect(cmd).toContain('safety:standard verification');
        expect(cmd).toContain('safety:unknown evidence quality');
        expect(cmd).toContain('safety:conflicting evidence');
        expect(cmd).toContain('task-pipeline-routes.log');
    });

    test('R1/R2: the lane decision lives in the gate state, not a routing state', () => {
        // 1239 R1: triage/test-fail-triage/review-fail-triage are gone; the catalog decisions run
        // inside the state that produced the evidence.
        for (const retired of ['triage', 'test-fail-triage', 'review-fail-triage']) {
            expect(
                def.states.find((s) => s.id === retired),
                retired,
            ).toBeUndefined();
        }
        const gate = def.states.find((s) => s.id === 'gate');
        const decide = gate?.onEnter?.find((a) => a.kind === 'decide' && a.options?.id === 'task-semantic-risk');
        expect(decide).toBeDefined();
        expect(decide?.options?.decision).toBe('task-semantic-risk');
        // The deterministic safety floor runs BEFORE the decide: a caller-set mode wins, and a
        // sensitive path or >400 lines pins safety without a model call.
        const kinds = (gate?.onEnter ?? []).map((a) => a.kind);
        const preGuard = (gate?.onEnter ?? []).findIndex(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('sensitive == true'),
        );
        const decideIndex = (gate?.onEnter ?? []).findIndex((a) => a.kind === 'decide');
        expect(preGuard).toBeGreaterThanOrEqual(0);
        expect(preGuard).toBeLessThan(decideIndex);
        expect(kinds.length).toBeGreaterThan(decideIndex);
    });

    test('R1/R2: the resolved lane sets the review depth and never skips certification', () => {
        // 1239 R2: verify merged into review, so there is no lane that bypasses it. The fast lane
        // narrows the review to the traceability pass, which is the certification input.
        const review = def.states.find((s) => s.id === 'review');
        const agentRun = review?.onEnter?.find((a) => a.kind === 'agent.run');
        expect(String(agentRun?.options?.input)).toContain(`--focus ${VAR('reviewFocus')}`);
        expect(def.vars?.reviewFocus).toBe('');
        // The projection is a gate-state shell (where the lane resolves): fast → functional,
        // everything else → all. A missing projection is an empty var, never a skipped review.
        const focusShell = (def.states.find((s) => s.id === 'gate')?.onEnter ?? []).find(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-review-focus.txt'),
        );
        const focusCmd = String(focusShell?.options?.command ?? '');
        expect(focusCmd).toContain("'functional");
        expect(focusCmd).toContain("'all");
        // And the depth var is read back into the workflow vars the agent.run template uses.
        expect(
            (def.states.find((s) => s.id === 'gate')?.onEnter ?? []).some(
                (a) => a.kind === 'file.read.into-var' && a.options?.var === 'reviewFocus',
            ),
        ).toBe(true);
    });

    test('R1/R2: the gate forks on its typed outcome, then on the failure class', () => {
        const fromGate = def.transitions.filter((t) => t.from === 'gate');
        expect(fromGate.map((t) => t.to)).toEqual([
            'review',
            'review',
            'failed',
            'failed',
            'failed',
            'remediate',
            'failed',
        ]);
        // Green: the typed PASS + the gate's own full-tier token.
        const passCmd = String(fromGate[0]?.guard?.options?.command ?? '');
        expect(passCmd).toContain('-gate.status');
        expect(passCmd).toContain('= PASS');
        expect(passCmd).toContain('-test-gate.status');
        // Opt-in batch policy: DEFERRED rides its own edge, gated on the var.
        expect(String(fromGate[1]?.guard?.options?.command ?? '')).toContain('$deferQualityGate');
        // BLOCKED is never read as red.
        expect(String(fromGate[2]?.guard?.options?.command ?? '')).toContain('= BLOCKED');
        // Red: stop → cap → fix → fail-closed defense, in that declaration order.
        expect(fromGate[3]?.terminalReason).toBe('failed-check');
        expect(fromGate[4]?.terminalReason).toBe('retry-exhausted');
        expect(String(fromGate[5]?.guard?.options?.command ?? '')).toContain('.value == "fix"');
        expect(fromGate[6]?.guard?.kind).toBe('always');
        // 0943 review P3#2: no red gate reaches remediation except through the failure class.
        expect(
            fromGate.find((t) => t.to === 'remediate' && String(t.guard?.options?.command ?? '').includes('FAIL')),
        ).toBeUndefined();
    });

    test('R1/R2: remediation re-enters the same gate (mode by visit), never a second gate state', () => {
        expect(def.transitions.filter((t) => t.from === 'remediate').map((t) => t.to)).toEqual(['gate']);
        // The old test-recheck fork is gone; the one gate state owns both visits.
        expect(def.states.find((s) => s.id === 'test-recheck')).toBeUndefined();
        const modeShells = (def.states.find((s) => s.id === 'gate')?.onEnter ?? []).filter(
            (a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('-gate-mode.txt'),
        );
        expect(modeShells).toHaveLength(1);
    });

    test('R2: the safety floor holds — certification is never bypassed on any lane', () => {
        // Every terminal path out of the working graph passes review except failed ones.
        const toDone = def.transitions.filter((t) => t.to === 'done');
        expect(toDone.map((t) => t.from)).toEqual(['review']);
        const review = def.states.find((s) => s.id === 'review');
        const verdictGate = review?.onEnter?.find((a) => a.kind === 'command.gate');
        expect(String(JSON.stringify(verdictGate?.options))).toContain('task","verdict');
        expect(String(JSON.stringify(verdictGate?.options))).toContain('--from-answer');
    });

    test('R6: iterative bounds are unchanged (no unmeasured tuning)', () => {
        expect(def.iterationBound).toBe(20);
    });

    test('R7: migration is revertable as a per-workflow option without touching pilots', () => {
        expect(def.vars?.mode).toBe('');
    });
});

/**
 * 0759 R1/R5 executable check. `__runId` was declared in `vars` and referenced nowhere, and the
 * route reason was written to `.spur/run/$wbs-route-reason.txt` — a task-scoped path a second run
 * of the same wbs silently overwrote. The R1 assertion above only checks that `__runId` is
 * *declared*, which is exactly what a dead variable passes; this runs the writer the engine
 * executes and checks the artifact it leaves.
 */
describe('precheck route writer is run-attributed (0759 R1/R5)', () => {
    const raw = readFileSync(PIPELINE_PATH, 'utf8');
    const def = loadWorkflowDefFromText(raw, PIPELINE_PATH) as unknown as WorkflowYaml;
    const precheck = def.states.find((s) => s.id === 'precheck');
    const writer = String(
        precheck?.onEnter?.find((a) => a.kind === 'shell' && String(a.options?.command ?? '').includes('route-reason'))
            ?.options?.command ?? '',
    );

    const run = (vars: Record<string, string>): string => {
        const cwd = mkdtempSync(join(tmpdir(), 'tp-route-'));
        const res = spawnSync('sh', ['-c', writer], { cwd, env: { ...getEnvVars(), ...vars } });
        expect(res.status).toBe(0);
        return cwd;
    };

    test('the reason artifact is keyed by run id, not by wbs', () => {
        const cwd = run({ __runId: 'run_alpha', mode: 'conflict', wbs: '0759' });
        expect(readFileSync(join(cwd, '.spur/run/run_alpha-route-reason.txt'), 'utf8').trim()).toBe(
            'safety:conflicting evidence',
        );
        expect(existsSync(join(cwd, '.spur/run/0759-route-reason.txt'))).toBe(false);
        expect(readFileSync(join(cwd, '.spur/memory/task-pipeline-routes.log'), 'utf8').trim()).toBe(
            'run_alpha 0759 safety:conflicting evidence',
        );
    });

    test('two runs of the same wbs keep separate route claims', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'tp-route-'));
        for (const [id, mode] of [
            ['run_one', 'fast'],
            ['run_two', ''],
        ]) {
            const res = spawnSync('sh', ['-c', writer], {
                cwd,
                env: { ...getEnvVars(), __runId: id, mode, wbs: '0759' },
            });
            expect(res.status).toBe(0);
        }
        expect(readFileSync(join(cwd, '.spur/run/run_one-route-reason.txt'), 'utf8').trim()).toBe(
            'fast:evidence complete+consistent',
        );
        expect(readFileSync(join(cwd, '.spur/run/run_two-route-reason.txt'), 'utf8').trim()).toBe(
            'safety:standard verification',
        );
        expect(readFileSync(join(cwd, '.spur/memory/task-pipeline-routes.log'), 'utf8').trimEnd().split('\n')).toEqual([
            'run_one 0759 fast:evidence complete+consistent',
            'run_two 0759 safety:standard verification',
        ]);
    });

    test('a driver-less invocation falls back to a wbs-named artifact, never a bare filename', () => {
        const cwd = run({ __runId: '', mode: 'unknown', wbs: '0759' });
        expect(readFileSync(join(cwd, '.spur/run/pipeline-0759-route-reason.txt'), 'utf8').trim()).toBe(
            'safety:unknown evidence quality',
        );
        expect(existsSync(join(cwd, '.spur/run/-route-reason.txt'))).toBe(false);
    });
});
