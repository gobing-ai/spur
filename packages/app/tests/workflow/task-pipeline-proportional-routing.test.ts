import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
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
