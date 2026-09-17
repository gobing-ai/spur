/**
 * Wrapup-pipeline truthfulness pins (feature D61 task 0770, R8; feature D6
 * task 0783, R1-R5).
 *
 * WHY these exist: wrap-up used to absorb failures as success — malformed
 * wrap input re-parsed as an empty list by sibling guards (silent skip), a
 * missing metrics row vanished, a failed sync/gate was printed and ignored,
 * and the shared `.spur/run/wrapup-learnings.md` capture was overwritten by
 * whichever run finished last. 0770 pinned the replacement contract: input is
 * validated exactly once at task-resolve, siblings consume the normalized
 * run-scoped artifact, every failure records a run-scoped PASS/FAIL status
 * that a declared-first `failed` edge consumes. 0783 (audit 0781 F-04)
 * tightens the consumers: validation accepts only canonical four-digit WBS
 * strings (whitespace rejected, not trimmed), everything after resolution
 * reads the capture instead of raw `vars.tasks`, metrics revalidate the
 * capture, require well-shaped lookups, serialize rows with jq, and PASS only
 * after every append succeeds, and feature sync succeeds only for a valid
 * matching unblocked proposal whose target status is freshly observed —
 * blocked/partial/unreadable results fail explicitly.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';

const REPO_ROOT = join(import.meta.dir, '../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config', 'workflows');
/** 0824: the wrapup-steps plugin script the wrappers delegate to (exec pins live in its suite). */
const WRAPUP_STEPS = join(REPO_ROOT, 'plugins', 'sp', 'scripts', 'wrapup-steps.ts');

interface ShellAction {
    kind: string;
    onError?: string;
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
    trigger?: string;
    guard?: { kind: string; options?: Record<string, unknown> };
}

interface WorkflowYaml {
    name: string;
    vars?: Record<string, string>;
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

function cleanup(cwd: string): void {
    rmSync(cwd, { recursive: true, force: true });
}

/**
 * Stub spurBin that resolves any task show to a completed status.
 */
function stubSpur(cwd: string, json: string): string {
    const stub = join(cwd, 'stub-spur');
    writeFileSync(stub, `#!/bin/sh\necho '${json}'\n`);
    chmodSync(stub, 0o755);
    return stub;
}

/**
 * 0824: task-capture, metrics and feature-sync execution moved into the wrapup-steps plugin
 * script — `plugins/sp/tests/wrapup-steps.test.ts` spawns it with the exec pins. This file
 * pins the workflow definition: wrapper delegation, the route writer, guards, and the
 * fail-closed wrapper contract.
 */

describe('wrapup-pipeline truthfulness (task 0770, feature R8; task 0783, R1-R5)', () => {
    const def = loadDef('wrapup-pipeline');

    test('identity: the definition carries an explicit version tag', () => {
        expect(def.version).toBe('4');
    });

    test('default feature gate checks only the selected feature and permits explicit override', () => {
        expect(def.vars?.featureGateCmd).toBe('$spurBin feature check "$feature"');
        const cwd = mkdtempSync(join(tmpdir(), 'wrapup-feature-gate-'));
        try {
            const stub = join(cwd, 'spur-stub');
            writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
            chmodSync(stub, 0o755);
            const env = { ...getEnvVars(), spurBin: stub, feature: 'D61' };
            const result = spawnSync('sh', ['-c', def.vars?.featureGateCmd ?? 'exit 99'], { env, encoding: 'utf8' });
            expect(result.status).toBe(0);
            expect(result.stdout).toBe('feature\ncheck\nD61\n');
            // 0824: the feature-transition shell is a locator wrapper; the gate itself is spawned
            // by the wrapup-steps script (the script suite pins `sh -c` with $featureGateCmd).
            const command = String(shellsOf(def, 'feature-transition')[0]?.options?.command ?? '');
            expect(command).toContain('wrapup-steps');
            expect(command).toContain('feature-transition');
        } finally {
            cleanup(cwd);
        }
    });

    test('0770 definitions are all explicitly versioned (identity tag, not absence)', () => {
        // Exact per-definition pins: a silent version bump fails here. wrapup-pipeline is '4'
        // since 0871 added the contract-violation repair edge (ADR-118 pilot).
        // (feature-dev was pinned '3' until task 0866 retired the definition.)
        const expectedVersions: Record<string, string> = {
            'task-lifecycle': '1',
            'feature-lifecycle': '1',
            'wrapup-pipeline': '4',
        };
        for (const [name, version] of Object.entries(expectedVersions)) {
            expect(loadDef(name).version).toBe(version);
        }
    });

    test('failed is a declared state whose description promises preserved artifacts', () => {
        expect(def.states.map((s) => s.id)).toContain('failed');
        const failed = def.states.find((s) => s.id === 'failed');
        expect(failed?.description).toContain('preserved');
    });

    describe('task-resolve validates wrap input exactly once', () => {
        test('the validation shell is the wrapup-steps locator; the route writer reads the validated capture', () => {
            const shells = shellsOf(def, 'task-resolve');
            expect(shells.length).toBeGreaterThanOrEqual(2);
            // 0824: shells[0] locates the wrapup-steps script (monorepo first, registered twin
            // under node) and fails closed to FAIL — it never re-parses raw vars.tasks. The
            // canonical-id validation lives in the script (wrapup-steps suite pins the regex).
            const validate = String(shells[0]?.options?.command ?? '');
            expect(validate).toContain('wrapup-steps');
            expect(validate).toContain('resolve');
            expect(validate).toContain('wrapup-resolve.status');
            expect(validate).toContain('failed closed');
            expect(validate).not.toContain('"$tasks"');
            // 0783 R2/R5: the route writer consumes the capture, never raw input.
            const route = String(shells[1]?.options?.command ?? '');
            expect(route).toContain('skipped:empty task list');
            expect(route).toContain('wrapup-tasks.json');
            expect(route).not.toContain('"$tasks"');
        });

        test('the failed edge is declared before the route edges and keys on the resolve status', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'task-resolve');
            expect(edges[0]?.to).toBe('failed');
            const command = String(edges[0]?.guard?.options?.command ?? '');
            expect(command).toContain('wrapup-resolve.status');
            expect(command).toContain('= FAIL');
            // The skip edge keys on the validated run-scoped capture (0783 R2) —
            // never raw vars.tasks — and the failed edge is tried first, so a
            // FAILED resolve can never fall through to it.
            const skipEdge = edges.find((t) => t.to === 'skipped' && t.guard?.kind === 'shell');
            const skipCommand = String(skipEdge?.guard?.options?.command ?? '');
            expect(skipCommand).toContain('-eq 0');
            expect(skipCommand).toContain('wrapup-tasks.json');
            expect(skipCommand).not.toContain('$tasks');
        });

        test('the always-defense routes to failed, not skipped', () => {
            const defense = def.transitions.find(
                (t: TransitionDef) => t.from === 'task-resolve' && t.guard?.kind === 'always',
            );
            expect(defense?.to).toBe('failed');
        });
    });

    describe('0783 R1: only canonical four-digit task ids validate', () => {
        test('two run ids produce independent run-scoped captures and attributed route lines', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-two-runs-'));
            try {
                const spurBin = stubSpur(cwd, '{"frontmatter":{"status":"done"}}');
                const route = shellOf(def, 'task-resolve', 1);
                // 0824: the resolve step runs through the wrapup-steps script; the route writer
                // stays a workflow shell, so run attribution stays a definition-level pin.
                const runThrough = (runId: string, wbs: string): void => {
                    const script = spawnSync(process.execPath, [WRAPUP_STEPS, 'resolve'], {
                        cwd,
                        encoding: 'utf8',
                        env: { ...getEnvVars(), __runId: runId, tasks: `["${wbs}"]`, spurBin },
                    });
                    expect(script.status).toBe(0);
                    const writer = spawnSync('sh', ['-c', String(route.options?.command ?? '')], {
                        cwd,
                        encoding: 'utf8',
                        env: { ...getEnvVars(), __runId: runId, tasks: `["${wbs}"]`, spurBin, mode: '' },
                    });
                    expect(writer.status).toBe(0);
                };
                runThrough('r-a', '0783');
                runThrough('r-b', '0784');
                expect(readFileSync(join(cwd, '.spur/run/r-a-wrapup-tasks.json'), 'utf8').trim()).toBe('["0783"]');
                expect(readFileSync(join(cwd, '.spur/run/r-b-wrapup-tasks.json'), 'utf8').trim()).toBe('["0784"]');
                const log = readFileSync(join(cwd, '.spur/memory/wrapup-routes.log'), 'utf8');
                expect(log).toContain('r-a safety');
                expect(log).toContain('r-b safety');
            } finally {
                cleanup(cwd);
            }
        });
    });

    describe('0783 R2: routes after resolution consume the capture, never raw tasks', () => {
        test('route guards refuse a missing or corrupted capture and only a validated [] skips', () => {
            const guardCommand = (to: string): string => {
                const edge = def.transitions.find(
                    (t: TransitionDef) => t.from === 'task-resolve' && t.to === to && t.guard?.kind === 'shell',
                );
                return String(edge?.guard?.options?.command ?? '');
            };
            const runGuard = (command: string, cwd: string, env: Record<string, string>): boolean =>
                spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...getEnvVars(), ...env } }).status ===
                0;
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-guards-'));
            try {
                // Missing capture: no numeric edge fires; the defense edge owns the run.
                expect(runGuard(guardCommand('skipped'), cwd, { __runId: 'g1', mode: '' })).toBe(false);
                expect(runGuard(guardCommand('metrics-record'), cwd, { __runId: 'g1', mode: 'fast' })).toBe(false);
                // Corrupted capture: refused as well.
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, '.spur/run/g2-wrapup-tasks.json'), '{oops');
                expect(runGuard(guardCommand('skipped'), cwd, { __runId: 'g2', mode: '' })).toBe(false);
                // A validated empty list is the only skip.
                writeFileSync(join(cwd, '.spur/run/g3-wrapup-tasks.json'), '[]');
                expect(runGuard(guardCommand('skipped'), cwd, { __runId: 'g3', mode: '' })).toBe(true);
                // Non-empty capture opens fast/safety.
                writeFileSync(join(cwd, '.spur/run/g4-wrapup-tasks.json'), '["0783"]');
                expect(runGuard(guardCommand('metrics-record'), cwd, { __runId: 'g4', mode: 'fast' })).toBe(true);
                expect(runGuard(guardCommand('doc-sync'), cwd, { __runId: 'g4', mode: '' })).toBe(true);
            } finally {
                cleanup(cwd);
            }
        });

        test('the doc-sync model prompt points at the capture, not raw vars.tasks', () => {
            const state = def.states.find((s) => s.id === 'doc-sync');
            const agent = state?.onEnter?.find((a) => a.kind === 'agent.run');
            const options = agent?.options as Record<string, string> | undefined;
            expect(options?.input).toContain('wrapup-tasks.json');
            expect(options?.input).not.toMatch(/\$\{vars\.tasks\}/);
            expect(options?.answerFile).toContain('__runId');
            expect(options?.answerFile).toContain('wrapup-learnings.md');
            expect(options?.expectFile).toBe(options?.answerFile);
        });

        test('post-resolution operator notes and the cleanup prompt reference the capture', () => {
            const done = def.states.find((s) => s.id === 'done');
            const doneNote = done?.onEnter?.find((a) => a.kind === 'note');
            expect(String((doneNote?.options as Record<string, string> | undefined)?.message ?? '')).toContain(
                'wrapup-tasks.json',
            );
            expect(String((doneNote?.options as Record<string, string> | undefined)?.message ?? '')).not.toMatch(
                /\$\{vars\.tasks\}/,
            );
            const cleanupState = def.states.find((s) => s.id === 'branch-cleanup');
            const prompt = cleanupState?.onEnter?.find((a) => a.kind === 'hitl.confirm');
            expect(String((prompt?.options as Record<string, string> | undefined)?.prompt ?? '')).toContain(
                'wrapup-tasks.json',
            );
        });
    });

    describe('metrics-record consumes the normalized artifact', () => {
        test('the shell is the wrapup-steps locator; it never re-parses raw $tasks or writes rows itself', () => {
            const cmd = String(shellsOf(def, 'metrics-record')[0]?.options?.command ?? '');
            expect(cmd).toContain('wrapup-steps');
            expect(cmd).toContain('metrics');
            expect(cmd).toContain('wrapup-metrics.status');
            expect(cmd).toContain('failed closed');
            // 0783 R2/R3: neither the wrapper nor (via the suite) the script re-parses raw
            // vars.tasks — both consume the run-scoped capture only.
            expect(cmd).not.toContain('$tasks');
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
        test('the feature-transition shell is the wrapup-steps locator and writes a sync status', () => {
            const cmd = String(shellsOf(def, 'feature-transition')[0]?.options?.command ?? '');
            // 0824: proposal-based classification moved into the script (its suite pins
            // gateBlocked / requiresConfirm / explicit no-change); the wrapper only locates
            // and fails closed.
            expect(cmd).toContain('wrapup-steps');
            expect(cmd).toContain('feature-transition');
            expect(cmd).toContain('wrapup-sync.status');
            expect(cmd).toContain('failed closed');
            expect(cmd).not.toContain('has("applied")');
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

    test('route reason writers remain run-attributed (0758 R4/R5 pins survive; 0783 R5 drops the fixed fallback)', () => {
        // 0824: shells[0] is the wrapup-steps locator wrapper; only the route writer (index 1)
        // writes reasons.
        const route = String(shellOf(def, 'task-resolve', 1)?.options?.command ?? '');
        expect(route).toContain('REASON_FILE=".spur/run/$RUN_ID-route-reason.txt"');
        expect(route).not.toContain('.spur/run/wrapup-route-reason.txt');
        expect(route).not.toContain('RUN_ID="wrapup"');
        // The locator wrapper writes no reason at all — fixed-path or otherwise.
        const wrapper = String(shellOf(def, 'task-resolve', 0)?.options?.command ?? '');
        expect(wrapper).not.toContain('route-reason');
    });

    describe('0824 wrapper fail-closed contract', () => {
        test('each wrap-up wrapper writes FAIL and exits 0 when neither the monorepo script nor the twin exists', () => {
            const cases: Array<{ state: string; statusFile: string }> = [
                { state: 'task-resolve', statusFile: 'wrapup-resolve.status' },
                { state: 'metrics-record', statusFile: 'wrapup-metrics.status' },
                { state: 'feature-transition', statusFile: 'wrapup-sync.status' },
            ];
            for (const { state, statusFile } of cases) {
                const cwd = mkdtempSync(join(tmpdir(), 'wrapup-failclosed-'));
                try {
                    // Temp cwd has no plugins/ scaffold; a failing superskill stub keeps the
                    // registered-twin branch deterministic.
                    const superskill = join(cwd, 'superskill');
                    writeFileSync(superskill, '#!/bin/sh\nexit 1\n');
                    chmodSync(superskill, 0o755);
                    const result = spawnSync('sh', ['-c', String(shellOf(def, state, 0).options?.command ?? '')], {
                        cwd,
                        encoding: 'utf8',
                        env: {
                            ...getEnvVars(),
                            __runId: `r-fc-${state}`,
                            spurBin: 'true',
                            featureGateCmd: '$spurBin feature check "$feature"',
                            feature: 'D61',
                            PATH: `${cwd}:${getEnvVar('PATH') ?? ''}`,
                        },
                    });
                    expect(result.status, state).toBe(0);
                    expect(result.stderr, state).toContain('failed closed');
                    expect(readFileSync(join(cwd, `.spur/run/r-fc-${state}-${statusFile}`), 'utf8'), state).toContain(
                        'FAIL',
                    );
                } finally {
                    cleanup(cwd);
                }
            }
        });
    });

    test('0783 R5: contradictory soft-success comments are gone; truthful routing stays', () => {
        const raw = readFileSync(join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), 'utf8');
        expect(raw).not.toContain('never hard-fails');
        expect(raw).not.toContain('Genuinely soft');
        expect(raw).toContain('cannot convert a failed sync into');
    });

    describe('0871 contract-first routing (ADR-118 pilot)', () => {
        test('doc-sync declares onError: continue so transition guards read the agent result', () => {
            const state = def.states.find((s) => s.id === 'doc-sync');
            const agent = state?.onEnter?.find((a) => a.kind === 'agent.run');
            expect(agent?.onError).toBe('continue');
            expect((state?.onEnter ?? []).map((a) => a.kind)).toEqual(['agent.run']);
        });

        test('doc-sync routes contract violation → repair, success → learnings-append, failure → failed', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'doc-sync');
            // Declaration order is load-bearing: the discriminating contract-violation
            // edge is tried first, then action-ok success, then the always defense.
            expect(edges.map((e) => [e.to, e.guard?.kind, e.trigger ?? null])).toEqual([
                ['repair', 'contract-violation', 'contract-violation'],
                ['learnings-append', 'action-ok', null],
                ['failed', 'always', 'executor-failure'],
            ]);
        });

        test('repair is cheap (shell only) and never re-dispatches the agent', () => {
            const state = def.states.find((s) => s.id === 'repair');
            const kinds = (state?.onEnter ?? []).map((a) => a.kind);
            expect(kinds).toEqual(['shell']);
            const cmd = String(state?.onEnter?.[0]?.options?.command ?? '');
            expect(cmd).toContain('wrapup-repair.status');
            expect(cmd).toContain('skipped re-dispatch');
            expect(cmd).not.toContain('wrapup-steps');
            // The repair path never re-enters doc-sync: it flows straight to metrics-record.
            expect(def.transitions.filter((t: TransitionDef) => t.from === 'repair').map((e) => e.to)).toEqual([
                'metrics-record',
            ]);
        });

        test('learnings-append holds the soft append shell and flows to metrics-record', () => {
            const state = def.states.find((s) => s.id === 'learnings-append');
            const cmd = String(state?.onEnter?.[0]?.options?.command ?? '');
            expect(cmd).toContain('.spur/memory/learnings.md');
            expect(
                def.transitions.filter((t: TransitionDef) => t.from === 'learnings-append').map((e) => e.to),
            ).toEqual(['metrics-record']);
        });

        test('R4: only wrapup-pipeline declares the contract-violation edge (opt-in)', () => {
            const others = [
                'task-lifecycle',
                'feature-lifecycle',
                'feature-verification',
                'idea-pipeline',
                'task-pipeline',
                'pr-review',
                'wayfinder-resolution',
                'history-anatomy',
            ];
            for (const name of others) {
                const other = loadDef(name);
                const uses = other.transitions.some((t: TransitionDef) => t.guard?.kind === 'contract-violation');
                expect(uses, `${name} must not declare a contract-violation edge`).toBe(false);
            }
        });
    });

    test('every terminal state is reachable (closed table still holds with failed)', () => {
        const targets = new Set(def.transitions.map((t: TransitionDef) => t.to));
        for (const terminal of ['done', 'skipped', 'failed']) {
            expect(targets.has(terminal)).toBe(true);
        }
    });
});
