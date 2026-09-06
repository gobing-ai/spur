/**
 * Wrapup-pipeline truthfulness pins (feature D61 task 0770, R8).
 *
 * WHY these exist: wrap-up used to absorb failures as success — malformed
 * wrap input re-parsed as an empty list by sibling guards (silent skip), a
 * missing metrics row vanished, a failed sync/gate was printed and ignored,
 * and the shared `.spur/run/wrapup-learnings.md` capture was overwritten by
 * whichever run finished last. These tests pin the replacement contract:
 * input is validated exactly once at task-resolve, siblings consume the
 * normalized run-scoped artifact, every failure records a run-scoped PASS/FAIL
 * status that a declared-first `failed` edge consumes, and the only clean
 * evidence is the collected verdict — never a request-state string.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';

const REPO_ROOT = join(import.meta.dir, '../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config', 'workflows');

interface ShellAction {
    kind: string;
    options?: { command?: string };
}

interface StateDef {
    id: string;
    description?: string;
    onEnter?: ShellAction[];
}

interface TransitionDef {
    from: string;
    to: string;
    guard?: { kind: string; options?: Record<string, unknown> };
}

interface WorkflowYaml {
    name: string;
    version?: string;
    states: StateDef[];
    transitions: TransitionDef[];
}

function loadDef(name: string): WorkflowYaml {
    const path = join(WORKFLOWS_DIR, `${name}.yaml`);
    return loadWorkflowDefFromText(readFileSync(path, 'utf8'), path) as unknown as WorkflowYaml;
}

function shellsOf(def: WorkflowYaml, stateId: string): ShellAction[] {
    const state = def.states.find((s) => s.id === stateId);
    return (state?.onEnter ?? []).filter((a) => a.kind === 'shell');
}

function shellOf(def: WorkflowYaml, stateId: string, index: number): ShellAction {
    const shell = shellsOf(def, stateId)[index];
    if (!shell) throw new Error(`no shell action at ${stateId}:onEnter:${index}`);
    return shell;
}

/** Runs one shell action in a fresh temp dir with the given env; returns cwd for artifact reads. */
function runShell(
    action: ShellAction,
    env: Record<string, string>,
): { status: number; stdout: string; stderr: string; cwd: string } {
    const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0770-'));
    const result = spawnSync('sh', ['-c', String(action.options?.command ?? '')], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...env },
    });
    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', cwd };
}

function cleanup(cwd: string): void {
    rmSync(cwd, { recursive: true, force: true });
}

/** Stub spurBin that resolves any task show to a completed status. */
function stubSpur(cwd: string, json: string): string {
    const stub = join(cwd, 'stub-spur');
    writeFileSync(stub, `#!/bin/sh\necho '${json}'\n`);
    chmodSync(stub, 0o755);
    return stub;
}

describe('wrapup-pipeline truthfulness (task 0770, feature R8)', () => {
    const def = loadDef('wrapup-pipeline');

    test('identity: the definition carries an explicit version tag', () => {
        expect(def.version).toBe('1');
    });

    test('0770 definitions are all explicitly versioned (identity tag, not absence)', () => {
        for (const name of ['task-lifecycle', 'feature-lifecycle', 'feature-dev', 'wrapup-pipeline']) {
            expect(loadDef(name).version).toBe('1');
        }
    });

    test('failed is a declared state whose description promises preserved artifacts', () => {
        expect(def.states.map((s) => s.id)).toContain('failed');
        const failed = def.states.find((s) => s.id === 'failed');
        expect(failed?.description).toContain('preserved');
    });

    describe('task-resolve validates wrap input exactly once', () => {
        test('the validation shell is the SECOND action — the 0758 route shell stays first', () => {
            const shells = shellsOf(def, 'task-resolve');
            expect(shells.length).toBeGreaterThanOrEqual(2);
            expect(String(shells[0]?.options?.command ?? '')).toContain('skipped:empty task list');
            const cmd = String(shells[1]?.options?.command ?? '');
            expect(cmd).toContain('wrapup-resolve.status');
            expect(cmd).toContain('wrapup-tasks.json');
        });

        test('malformed JSON records FAIL and never produces a normalized list', () => {
            const run = runShell(shellOf(def, 'task-resolve', 1), {
                __runId: 'r-bad',
                tasks: '{oops',
                spurBin: 'true',
            });
            try {
                expect(run.status).toBe(0);
                expect(run.stderr).toContain('non-empty WBS strings');
                expect(readFileSync(join(run.cwd, '.spur/run/r-bad-wrapup-resolve.status'), 'utf8')).toContain('FAIL');
                expect(readFileSync(join(run.cwd, '.spur/run/r-bad-route-reason.txt'), 'utf8')).toContain(
                    'failed:tasks is not a JSON array',
                );
                expect(() => readFileSync(join(run.cwd, '.spur/run/r-bad-wrapup-tasks.json'))).toThrow();
            } finally {
                cleanup(run.cwd);
            }
        });

        test('an empty run id fails loud instead of the legacy fixed-path fallback', () => {
            const run = runShell(shellOf(def, 'task-resolve', 1), { __runId: '', tasks: '[]', spurBin: 'true' });
            cleanup(run.cwd);
            expect(run.status).toBe(1);
            expect(run.stderr).toContain('__runId is empty');
        });

        test('a task that does not resolve to a completed status records FAIL', () => {
            const run = runShell(shellOf(def, 'task-resolve', 1), {
                __runId: 'r-unres',
                tasks: '["0001"]',
                spurBin: 'true',
            });
            try {
                expect(run.status).toBe(0);
                expect(readFileSync(join(run.cwd, '.spur/run/r-unres-wrapup-resolve.status'), 'utf8')).toContain(
                    'FAIL',
                );
                expect(readFileSync(join(run.cwd, '.spur/run/r-unres-route-reason.txt'), 'utf8')).toContain(
                    'failed:unresolved or non-completed task',
                );
            } finally {
                cleanup(run.cwd);
            }
        });

        test('a done task normalizes and dedupes into the run-scoped artifact with PASS', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0770-ok-'));
            try {
                const spurBin = stubSpur(cwd, '{"frontmatter":{"status":"done"}}');
                const shell = shellOf(def, 'task-resolve', 1);
                const result = spawnSync('sh', ['-c', String(shell.options?.command ?? '')], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...process.env, __runId: 'r-ok', tasks: '["0770","0770","0772"]', spurBin },
                });
                expect(result.status).toBe(0);
                expect(readFileSync(join(cwd, '.spur/run/r-ok-wrapup-tasks.json'), 'utf8').trim()).toBe(
                    '["0770","0772"]',
                );
                expect(readFileSync(join(cwd, '.spur/run/r-ok-wrapup-resolve.status'), 'utf8')).toContain('PASS');
            } finally {
                cleanup(cwd);
            }
        });

        test('the failed edge is declared before the route edges and keys on the resolve status', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'task-resolve');
            expect(edges[0]?.to).toBe('failed');
            const command = String(edges[0]?.guard?.options?.command ?? '');
            expect(command).toContain('wrapup-resolve.status');
            expect(command).toContain('= FAIL');
            // The skip edge keeps its raw-tasks pin — a FAILED resolve can never
            // fall through to it because the failed edge is tried first.
            const skipEdge = edges.find((t) => t.to === 'skipped' && t.guard?.kind === 'shell');
            expect(String(skipEdge?.guard?.options?.command ?? '')).toContain('-eq 0');
        });

        test('the always-defense routes to failed, not skipped', () => {
            const defense = def.transitions.find(
                (t: TransitionDef) => t.from === 'task-resolve' && t.guard?.kind === 'always',
            );
            expect(defense?.to).toBe('failed');
        });
    });

    describe('metrics-record consumes the normalized artifact', () => {
        test('the shell never re-parses raw $tasks and keys its outcome on the status file', () => {
            const cmd = String(shellsOf(def, 'metrics-record')[0]?.options?.command ?? '');
            expect(cmd).toContain('wrapup-tasks.json');
            expect(cmd).not.toContain("'$tasks'");
            expect(cmd).toContain('wrapup-metrics.status');
        });

        test('an unresolvable task records FAIL — a missing row is not silently absorbed', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0770-miss-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, '.spur/run/r-miss-wrapup-tasks.json'), '["0001"]\n');
                const shell = shellOf(def, 'metrics-record', 0);
                const result = spawnSync('sh', ['-c', String(shell.options?.command ?? '')], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...process.env, __runId: 'r-miss', spurBin: 'true' },
                });
                expect(result.status).toBe(0);
                expect(result.stderr).toContain('recording FAIL');
                expect(readFileSync(join(cwd, '.spur/run/r-miss-wrapup-metrics.status'), 'utf8')).toContain('FAIL');
            } finally {
                cleanup(cwd);
            }
        });

        test('a resolvable task appends exactly one metrics row and PASSes', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0770-m-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, '.spur/run/r-m-ok-wrapup-tasks.json'), '["0770"]\n');
                const spurBin = stubSpur(cwd, '{"frontmatter":{"status":"done","feature_id":"D61"}}');
                const shell = shellOf(def, 'metrics-record', 0);
                const result = spawnSync('sh', ['-c', String(shell.options?.command ?? '')], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...process.env, __runId: 'r-m-ok', spurBin },
                });
                expect(result.status).toBe(0);
                expect(readFileSync(join(cwd, '.spur/run/r-m-ok-wrapup-metrics.status'), 'utf8')).toContain('PASS');
                const row = readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'), 'utf8').trim();
                expect(JSON.parse(row)).toMatchObject({ wbs: '0770', feature_id: 'D61', status: 'done' });
            } finally {
                cleanup(cwd);
            }
        });

        test('the FAIL edge is declared first among metrics-record edges', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'metrics-record');
            expect(edges[0]?.to).toBe('failed');
            expect(String(edges[0]?.guard?.options?.command ?? '')).toContain('wrapup-metrics.status');
            for (const edge of edges.slice(1)) {
                expect(String(edge.guard?.options?.command ?? '')).toContain('= PASS');
            }
        });
    });

    describe('doc-sync and feature-transition record truthful outcomes', () => {
        test('learnings capture is run-scoped expectFile — an empty capture aborts the action', () => {
            const state = def.states.find((s) => s.id === 'doc-sync');
            const agent = state?.onEnter?.find((a) => a.kind === 'agent.run');
            const options = agent?.options as Record<string, string> | undefined;
            expect(options?.answerFile).toContain('__runId');
            expect(options?.answerFile).toContain('wrapup-learnings.md');
            expect(options?.expectFile).toBe(options?.answerFile);
        });

        test('feature-transition validates the sync result and writes a sync status', () => {
            const cmd = String(shellsOf(def, 'feature-transition')[0]?.options?.command ?? '');
            expect(cmd).toContain('has("applied")');
            expect(cmd).toContain('wrapup-sync.status');
            expect(cmd).toContain('explicit no-change');
        });

        test('feature-transition fail edge is first; sibling edges require sync PASS', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'feature-transition');
            expect(edges[0]?.to).toBe('failed');
            expect(String(edges[0]?.guard?.options?.command ?? '')).toContain('wrapup-sync.status');
            for (const edge of edges.slice(1)) {
                expect(String(edge.guard?.options?.command ?? '')).toContain('= PASS');
            }
        });

        test('branch cleanup is consent-only — decisions recorded, no git operation', () => {
            const state = def.states.find((s) => s.id === 'branch-cleanup');
            expect(state?.description).toContain('consent-only');
            expect(state?.description).toContain('NO git operation');
            const done = def.states.find((s) => s.id === 'done');
            expect(done?.description).toContain('no git operation');
            for (const shell of shellsOf(def, 'branch-cleanup')) {
                expect(String(shell.options?.command ?? '')).not.toContain('git ');
            }
        });
    });

    test('route reason writers remain run-attributed (0758 R4/R5 pins survive)', () => {
        const cmd = String(shellsOf(def, 'task-resolve')[0]?.options?.command ?? '');
        expect(cmd).toContain('REASON_FILE=".spur/run/$RUN_ID-route-reason.txt"');
        expect(cmd).not.toContain('.spur/run/wrapup-route-reason.txt');
    });

    test('every terminal state is reachable (closed table still holds with failed)', () => {
        const targets = new Set(def.transitions.map((t: TransitionDef) => t.to));
        for (const terminal of ['done', 'skipped', 'failed']) {
            expect(targets.has(terminal)).toBe(true);
        }
    });
});
