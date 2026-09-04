import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';
import { evaluateWrapupRoute, type RouteInput, safetyFloorHolds } from '../../../../config/proportional-route-table';
import { computeDefinitionDigest } from '../../src/workflow/composition-baseline';

const REPO_ROOT = join(import.meta.dir, '../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config', 'workflows');

interface StateDef {
    id: string;
    onEnter?: Array<{ kind: string; options?: Record<string, unknown> }>;
}

interface TransitionDef {
    from: string;
    to: string;
    guard?: { kind: string; options?: Record<string, unknown> };
}

interface WorkflowYaml {
    name: string;
    vars?: Record<string, string>;
    states: StateDef[];
    transitions: TransitionDef[];
}

describe('proportional routing pilots (task 0758)', () => {
    describe('wrapup-pipeline closed route table (R1, R2, R4, R5)', () => {
        const wrapupPath = join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml');
        const wrapupText = readFileSync(wrapupPath, 'utf8');
        const wrapupDef = loadWorkflowDefFromText(wrapupText, wrapupPath) as unknown as WorkflowYaml;

        test('declares mode and __runId in vars', () => {
            expect(wrapupDef.vars).toBeDefined();
            expect(wrapupDef.vars?.mode).toBe('');
            expect(wrapupDef.vars?.__runId).toBe('');
        });

        test('task-resolve state writes bounded route reason', () => {
            const taskResolve = wrapupDef.states.find((s: StateDef) => s.id === 'task-resolve');
            expect(taskResolve).toBeDefined();
            const shellAction = taskResolve?.onEnter?.find((a) => a.kind === 'shell');
            expect(shellAction).toBeDefined();
            const cmd = String(shellAction?.options?.command ?? '');
            expect(cmd).toContain('fast:evidence complete+consistent');
            expect(cmd).toContain('safety:missing evidence (mode empty)');
            expect(cmd).toContain('safety:unknown evidence quality');
            expect(cmd).toContain('safety:conflicting evidence');
            expect(cmd).toContain('skipped:empty task list');
            // 0758 R3/R5: the reason artifact is run-scoped. The earlier fixed-path copy
            // (`.spur/run/wrapup-route-reason.txt`) had no reader and was overwritten by whichever
            // run finished last, so a claim read from it belonged to no particular run.
            expect(cmd).toContain('REASON_FILE=".spur/run/$RUN_ID-route-reason.txt"');
            expect(cmd).not.toContain('.spur/run/wrapup-route-reason.txt');
            expect(cmd).toContain('mkdir -p .spur/run .spur/memory');
        });

        test('transitions form a closed, mutually exhaustive table over (tasks, mode)', () => {
            const resolveTransitions = wrapupDef.transitions.filter((t: TransitionDef) => t.from === 'task-resolve');
            expect(resolveTransitions.length).toBeGreaterThanOrEqual(3);

            // 1. empty tasks -> skipped
            const emptyEdge = resolveTransitions.find(
                (t: TransitionDef) => t.to === 'skipped' && t.guard?.kind === 'shell',
            );
            expect(emptyEdge).toBeDefined();
            expect(String(emptyEdge?.guard?.options?.command ?? '')).toContain('-eq 0');

            // 2. non-empty + fast -> metrics-record (fast path)
            const fastEdge = resolveTransitions.find(
                (t: TransitionDef) => t.to === 'metrics-record' && t.guard?.kind === 'shell',
            );
            expect(fastEdge).toBeDefined();
            expect(String(fastEdge?.guard?.options?.command ?? '')).toContain('-gt 0');
            expect(String(fastEdge?.guard?.options?.command ?? '')).toContain('$mode" = fast');

            // 3. non-empty + not fast -> doc-sync (safety path)
            const safetyEdge = resolveTransitions.find(
                (t: TransitionDef) => t.to === 'doc-sync' && t.guard?.kind === 'shell',
            );
            expect(safetyEdge).toBeDefined();
            expect(String(safetyEdge?.guard?.options?.command ?? '')).toContain('-gt 0');
            expect(String(safetyEdge?.guard?.options?.command ?? '')).toContain('$mode" != fast');

            // 4. defense -> skipped
            const defenseEdge = resolveTransitions.find(
                (t: TransitionDef) => t.to === 'skipped' && t.guard?.kind === 'always',
            );
            expect(defenseEdge).toBeDefined();
        });

        test('evaluateWrapupRoute matches the YAML guard logic', () => {
            expect(evaluateWrapupRoute({ tasks: [] }).route).toBe('skipped');
            expect(evaluateWrapupRoute({ tasks: ['0001'], mode: 'fast' }).route).toBe('fast');
            expect(evaluateWrapupRoute({ tasks: ['0001'], mode: '' }).route).toBe('safety');
            expect(evaluateWrapupRoute({ tasks: ['0001'], mode: 'unknown' }).route).toBe('safety');
            expect(evaluateWrapupRoute({ tasks: ['0001'], mode: 'conflict' }).route).toBe('safety');
        });
    });

    describe('safety floor (R2, R3)', () => {
        // task-lifecycle's proportional edges were reverted (0758): `requestTransition`
        // resolves one transition per (from, to) pair, so a guard-paired fast/safety split
        // denied every forward hop. The safety floor itself is route-table-level and stands.
        test('safetyFloorHolds enforces immutable invariants', () => {
            const valid: RouteInput = {
                runId: 'r1',
                definitionDigest: 'd1',
                evidenceRefs: ['v.json'],
                costCoverage: 1.0,
                proofBinding: 'current',
                reviewerIndependent: true,
                runIdConfined: true,
            };
            expect(safetyFloorHolds(valid)).toBe(true);
            expect(safetyFloorHolds({ ...valid, proofBinding: 'missing' })).toBe(false);
            expect(safetyFloorHolds({ ...valid, reviewerIndependent: false })).toBe(false);
            expect(safetyFloorHolds({ ...valid, runIdConfined: false })).toBe(false);
        });
    });

    describe('task-lifecycle version both-forms exercise (R7)', () => {
        test('unversioned and explicit version take identical routes but differ in digest', () => {
            const raw = readFileSync(join(WORKFLOWS_DIR, 'task-lifecycle.yaml'), 'utf8');
            const unversionedDef = loadWorkflowDefFromText(raw, 'task-lifecycle.yaml');
            const versionedDef = loadWorkflowDefFromText(`${raw}\nversion: "1.2.3"`, 'task-lifecycle-v.yaml');

            // 1. Structure is identical
            const uYaml = unversionedDef as unknown as WorkflowYaml;
            const vYaml = versionedDef as unknown as WorkflowYaml;
            expect(uYaml.states.map((s) => s.id)).toEqual(vYaml.states.map((s) => s.id));
            expect(uYaml.transitions.length).toBe(vYaml.transitions.length);
            for (let i = 0; i < uYaml.transitions.length; i++) {
                expect(uYaml.transitions[i]?.from).toBe(vYaml.transitions[i]?.from);
                expect(uYaml.transitions[i]?.to).toBe(vYaml.transitions[i]?.to);
            }

            // 2. Digests differ
            const unversionedDigest = computeDefinitionDigest(unversionedDef);
            const versionedDigest = computeDefinitionDigest(versionedDef);
            expect(unversionedDigest).not.toBe(versionedDigest);
            expect(unversionedDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
            expect(versionedDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
        });
    });

    describe('pilot revertability (R8)', () => {
        test('wrapup-pipeline and task-lifecycle route tables are self-contained in their YAMLs', () => {
            const wrapupRaw = readFileSync(join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), 'utf8');
            const lifecycleRaw = readFileSync(join(WORKFLOWS_DIR, 'task-lifecycle.yaml'), 'utf8');

            // Neither pilot imports or references the other
            expect(wrapupRaw).not.toContain('task-lifecycle');
            expect(lifecycleRaw).not.toContain('wrapup-pipeline');

            // Reverting either YAML is completely independent
            expect(wrapupRaw).toContain('name: wrapup-pipeline');
            expect(lifecycleRaw).toContain('name: task-lifecycle');
        });
    });
});

/**
 * 0758 R4/R5 executable check. The route writers were previously asserted only by reading the
 * YAML string, which is how three real defects stayed green: wrapup-pipeline copied its reason to
 * a fixed `.spur/run/wrapup-route-reason.txt` every run overwrote, task-lifecycle's three
 * onEnter blocks appended bare reason strings that named neither the run nor the state, and one
 * live artifact landed under the literal filename `${vars.__runId}-route-reason.txt`. R5 requires
 * route facts be provable from run-bound evidence rather than scraped from a log, so this runs the
 * writers the engine actually executes and checks the artifact each one leaves behind.
 */
describe('route reason writers are run-attributed (0758 R4/R5)', () => {
    const shellOf = (def: WorkflowYaml, stateId: string): string => {
        const state = def.states.find((s: StateDef) => s.id === stateId);
        const action = state?.onEnter?.find((a) => a.kind === 'shell');
        return String(action?.options?.command ?? '');
    };

    const runWriter = (command: string, vars: Record<string, string>): { cwd: string } => {
        const cwd = mkdtempSync(join(tmpdir(), 'route-writer-'));
        const res = spawnSync('sh', ['-c', command], { cwd, env: { ...process.env, ...vars } });
        expect(res.status).toBe(0);
        return { cwd };
    };

    const wrapupDef = loadWorkflowDefFromText(
        readFileSync(join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), 'utf8'),
        join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'),
    ) as unknown as WorkflowYaml;
    test('wrapup-pipeline writes the reason under the run id and attributes the log line', () => {
        const { cwd } = runWriter(shellOf(wrapupDef, 'task-resolve'), {
            __runId: 'run_alpha',
            mode: 'unknown',
            tasks: '["0001"]',
        });
        expect(readFileSync(join(cwd, '.spur/run/run_alpha-route-reason.txt'), 'utf8').trim()).toBe(
            'safety:unknown evidence quality',
        );
        expect(readFileSync(join(cwd, '.spur/memory/wrapup-routes.log'), 'utf8').trim()).toBe(
            'run_alpha safety:unknown evidence quality',
        );
    });

    test('a second wrapup run does not overwrite the first run route claim', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'route-writer-'));
        const cmd = shellOf(wrapupDef, 'task-resolve');
        for (const [id, mode] of [
            ['run_one', 'fast'],
            ['run_two', 'conflict'],
        ]) {
            const res = spawnSync('sh', ['-c', cmd], {
                cwd,
                env: { ...process.env, __runId: id, mode, tasks: '["0001"]' },
            });
            expect(res.status).toBe(0);
        }
        expect(readFileSync(join(cwd, '.spur/run/run_one-route-reason.txt'), 'utf8').trim()).toBe(
            'fast:evidence complete+consistent',
        );
        expect(readFileSync(join(cwd, '.spur/run/run_two-route-reason.txt'), 'utf8').trim()).toBe(
            'safety:conflicting evidence',
        );
        expect(readFileSync(join(cwd, '.spur/memory/wrapup-routes.log'), 'utf8').trimEnd().split('\n')).toEqual([
            'run_one fast:evidence complete+consistent',
            'run_two safety:conflicting evidence',
        ]);
    });
});
