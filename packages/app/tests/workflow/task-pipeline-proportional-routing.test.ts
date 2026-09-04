import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';

const REPO_ROOT = join(import.meta.dir, '../../../../');
const PIPELINE_PATH = join(REPO_ROOT, 'config', 'workflows', 'task-pipeline.yaml');

interface StateDef {
    id: string;
    onEnter?: Array<{ kind: string; options?: Record<string, unknown> }>;
}

interface TransitionDef {
    from: string;
    to: string;
    description?: string;
    guard?: { kind: string; options?: Record<string, unknown> };
}

interface WorkflowYaml {
    name: string;
    iterationBound?: number;
    vars?: Record<string, string>;
    states: StateDef[];
    transitions: TransitionDef[];
}

describe('task-pipeline proportional routing (task 0759, S5)', () => {
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

    test('R1/R2: test state branches proportionally while keeping safety floor', () => {
        const fromTest = def.transitions.filter((t) => t.from === 'test');
        expect(fromTest.length).toBeGreaterThanOrEqual(4);

        // Fast path on green quality gate: bypasses review, goes directly to verify
        const fastEdge = fromTest.find((t) => t.to === 'verify');
        expect(fastEdge).toBeDefined();
        const fastCmd = String(fastEdge?.guard?.options?.command ?? '');
        expect(fastCmd).toContain('$wbs-test-gate.status');
        expect(fastCmd).toContain('$mode" = fast');

        // Safety path on green quality gate: proceeds to review
        const safetyEdge = fromTest.find((t) => t.to === 'review');
        expect(safetyEdge).toBeDefined();
        const safetyCmd = String(safetyEdge?.guard?.options?.command ?? '');
        expect(safetyCmd).toContain('$wbs-test-gate.status');
        expect(safetyCmd).toContain('$mode" != fast');

        // Red quality gate still routes to test-fix
        const redEdge = fromTest.find(
            (t) => t.to === 'test-fix' && String(t.guard?.options?.command ?? '').includes('FAIL'),
        );
        expect(redEdge).toBeDefined();
    });

    test('R1/R2: test-recheck state branches proportionally after fixall loop', () => {
        const fromRecheck = def.transitions.filter((t) => t.from === 'test-recheck');

        const fastEdge = fromRecheck.find((t) => t.to === 'verify');
        expect(fastEdge).toBeDefined();
        expect(String(fastEdge?.guard?.options?.command ?? '')).toContain('$mode" = fast');

        const safetyEdge = fromRecheck.find((t) => t.to === 'review');
        expect(safetyEdge).toBeDefined();
        expect(String(safetyEdge?.guard?.options?.command ?? '')).toContain('$mode" != fast');
    });

    test('R2: safety floor holds — proof bracket and verify are never bypassed', () => {
        // verify state exists and has observe-only agent.run
        const verify = def.states.find((s) => s.id === 'verify');
        expect(verify).toBeDefined();
        const agentRun = verify?.onEnter?.find((a) => a.kind === 'agent.run');
        expect(String(agentRun?.options?.input ?? '')).toContain('--fix none');

        // verify -> record requires PASS verdict and valid proof
        const verifyTransitions = def.transitions.filter((t) => t.from === 'verify');
        const toRecord = verifyTransitions.find((t) => t.to === 'record');
        expect(toRecord).toBeDefined();
        const recordCmd = String(toRecord?.guard?.options?.command ?? '');
        expect(recordCmd).toContain('.verdict');
        expect(recordCmd).toContain('= PASS');

        // done requires proofBinding: current
        const done = def.states.find((s) => s.id === 'done');
        const artifact = done?.onEnter?.find((a) => a.kind === 'run.artifact');
        expect(artifact?.options?.proofBinding).toBe('current');
    });

    test('R6: iterative bounds are unchanged (no unmeasured tuning)', () => {
        // iterationBound remains 20 per 0731 §3 (unmeasured bounds left alone)
        expect(def.iterationBound).toBe(20);
    });

    test('R7: migration is revertable as a per-workflow option without touching pilots', () => {
        // task-pipeline is self-contained; mode="" defaults to safety path (identical to pre-migration)
        expect(def.vars?.mode).toBe('');
    });
});

/**
 * 0759 R1/R5 executable check. `__runId` was declared in `vars` and referenced nowhere, and the
 * route reason was written to `.spur/run/$wbs-route-reason.txt` — a task-scoped path a second run
 * of the same wbs silently overwrote, so no route could be attributed to the run that took it.
 * The R1 assertion above only checks that `__runId` is *declared*, which is exactly what a dead
 * variable passes; this runs the writer the engine executes and checks the artifact it leaves.
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
        const res = spawnSync('sh', ['-c', writer], { cwd, env: { ...process.env, ...vars } });
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
                env: { ...process.env, __runId: id, mode, wbs: '0759' },
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
