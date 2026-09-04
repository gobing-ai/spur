import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';
import {
    evaluateLifecycleRoute,
    evaluateWrapupRoute,
    type RouteInput,
    safetyFloorHolds,
} from '../../../../config/proportional-route-table';
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
            expect(cmd).toContain('wrapup-route-reason.txt');
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

    describe('task-lifecycle closed route table & safety floor (R1, R2, R3)', () => {
        const lifecyclePath = join(WORKFLOWS_DIR, 'task-lifecycle.yaml');
        const lifecycleText = readFileSync(lifecyclePath, 'utf8');
        const lifecycleDef = loadWorkflowDefFromText(lifecycleText, lifecyclePath) as unknown as WorkflowYaml;

        test('declares mode and __runId in vars', () => {
            expect(lifecycleDef.vars?.mode).toBe('');
            expect(lifecycleDef.vars?.__runId).toBe('');
        });

        test('both fast and safety transitions preserve safety floor checks (R3)', () => {
            // wip -> testing transitions
            const wipTesting = lifecycleDef.transitions.filter(
                (t: TransitionDef) => t.from === 'wip' && t.to === 'testing',
            );
            expect(wipTesting).toHaveLength(2);
            for (const t of wipTesting) {
                const cmd = String(t.guard?.options?.command ?? '');
                expect(cmd).toContain('$spurBin task check $wbs --as testing');
            }

            // testing -> done transitions
            const testingDone = lifecycleDef.transitions.filter(
                (t: TransitionDef) => t.from === 'testing' && t.to === 'done',
            );
            expect(testingDone).toHaveLength(2);
            for (const t of testingDone) {
                const cmd = String(t.guard?.options?.command ?? '');
                expect(cmd).toContain('$spurBin task check $wbs --as done');
            }
        });

        test('evaluateLifecycleRoute routes to fast or safety', () => {
            expect(evaluateLifecycleRoute({ mode: 'fast' }).route).toBe('fast');
            expect(evaluateLifecycleRoute({}).route).toBe('safety');
            expect(evaluateLifecycleRoute({ mode: 'unknown' }).route).toBe('safety');
        });

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
