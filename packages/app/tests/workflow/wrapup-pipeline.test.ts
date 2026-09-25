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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
        // 0944: task-resolve gained the drift-probe + mode projection actions and the
        // route-reason writer moved behind the wrapup-steps locator (composition caps).
        expect(def.version).toBe('5');
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
        // Exact per-definition pins: a silent version bump fails here. wrapup-pipeline is '5'
        // since 0944 added the drift probe + mode projection and moved the route-reason
        // writer behind the wrapup-steps locator ('4' since 0871's repair edge).
        // (feature-dev was pinned '3' until task 0866 retired the definition.)
        const expectedVersions: Record<string, string> = {
            'task-lifecycle': '1',
            'feature-lifecycle': '1',
            'wrapup-pipeline': '5',
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
            // 0783 R2/R5: the route-reason writer consumes the capture, never raw input.
            // 0944: the writer moved behind the wrapup-steps locator (composition caps) and
            // also reads the drift probe verdict; the capture + reason pins hold against the
            // script source.
            const route = String(shells[2]?.options?.command ?? '');
            expect(route).toContain('wrapup-steps');
            expect(route).toContain('route-reason');
            // The route-reason writer lives in wrapup-steps.ts (0944): pin its body, not the
            // whole script (resolve legitimately parses env.tasks; route-reason must not).
            const script = readFileSync(WRAPUP_STEPS, 'utf8');
            const fn = script.slice(
                script.indexOf('export function writeRouteReason'),
                script.indexOf('function readFileSyncSafe'),
            );
            expect(fn).toContain('skipped:empty task list');
            expect(fn).toContain('wrapup-tasks.json');
            expect(fn).not.toContain('env.tasks');
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
                // 0824: the resolve step and the 0944 route-reason writer both run through the
                // wrapup-steps script; run attribution stays a script-level pin.
                const runThrough = (runId: string, wbs: string): void => {
                    for (const sub of ['resolve', 'route-reason'] as const) {
                        const step = spawnSync(process.execPath, [WRAPUP_STEPS, sub], {
                            cwd,
                            encoding: 'utf8',
                            env: { ...getEnvVars(), __runId: runId, tasks: `["${wbs}"]`, spurBin, mode: '' },
                        });
                        expect(step.status).toBe(0);
                    }
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
        // 0824: shells[0] is the wrapup-steps locator wrapper. 0944: the route-reason writer
        // also moved behind a locator (index 2, after the drift probe + mode projection) to
        // stay inside the ADR-115 shell caps; only the script writes reasons.
        const route = String(shellOf(def, 'task-resolve', 2)?.options?.command ?? '');
        expect(route).toContain('wrapup-steps');
        expect(route).toContain('route-reason');
        expect(route).not.toContain('.spur/run/wrapup-route-reason.txt');
        expect(route).not.toContain('RUN_ID="wrapup"');
        const script = readFileSync(WRAPUP_STEPS, 'utf8');
        expect(script).toContain('route-reason.txt`');
        expect(script).not.toContain('.spur/run/wrapup-route-reason.txt');
        // The resolve locator wrapper writes no reason at all — fixed-path or otherwise.
        const wrapper = String(shellOf(def, 'task-resolve', 0)?.options?.command ?? '');
        expect(wrapper).not.toContain('route-reason');
    });

    describe('0944 drift-probe routing (clean passes skip doc-sync; any doubt stays safe)', () => {
        const taskShow = (solution: string): string =>
            JSON.stringify({ status: 'done', content: `# 0944\n\n### Solution\n\n${solution}\n` });

        interface RouteOutcome {
            projectedMode: string;
            probe: { clean: boolean; reasons: string[] } | null;
            reason: string;
            fastGuardRc: number;
            safetyGuardRc: number;
        }

        /**
         * Runs the task-resolve onEnter shells against a scaffolded temp cwd (symlinked
         * plugin scripts + stub spur), simulating file.read.into-var between the probe
         * wrapper and the route-reason writer (vars.mode := projected mode file content).
         */
        const runTaskResolve = (cwd: string, runId: string, spurBin: string, callerMode: string): RouteOutcome => {
            const runShell = (index: number, mode: string): void => {
                const result = spawnSync(
                    'sh',
                    ['-c', String(shellOf(def, 'task-resolve', index).options?.command ?? '')],
                    {
                        cwd,
                        encoding: 'utf8',
                        env: {
                            ...getEnvVars(),
                            __runId: runId,
                            tasks: '["0944"]',
                            spurBin,
                            mode,
                            PATH: `${cwd}:${getEnvVar('PATH') ?? ''}`,
                        },
                    },
                );
                expect(result.status, `shell ${index}`).toBe(0);
            };
            runShell(0, callerMode); // resolve: validates and writes the capture
            runShell(1, callerMode); // probe + mode projection (no-op projection when mode set)
            const raw = readFileSync(join(cwd, '.spur/run', `${runId}-mode.txt`), 'utf8');
            const projectedMode = raw.trim();
            let probe: RouteOutcome['probe'] = null;
            try {
                probe = JSON.parse(readFileSync(join(cwd, '.spur/run', `${runId}-drift-probe.json`), 'utf8'));
            } catch {
                // no probe artifact — the caller mode was set, so the probe never ran
            }
            runShell(2, projectedMode); // route-reason writer, now seeing the projected mode
            const reason = readFileSync(join(cwd, '.spur/run', `${runId}-route-reason.txt`), 'utf8').trim();
            const guardRc = (edge: string): number => {
                const command = String(
                    def.transitions.find((t: TransitionDef) => t.from === 'task-resolve' && t.to === edge)?.guard
                        ?.options?.command ?? 'exit 99',
                );
                return (
                    spawnSync('sh', ['-c', command], {
                        cwd,
                        encoding: 'utf8',
                        env: { ...getEnvVars(), __runId: runId, mode: projectedMode },
                    }).status ?? 1
                );
            };
            return {
                projectedMode,
                probe,
                reason,
                fastGuardRc: guardRc('metrics-record'),
                safetyGuardRc: guardRc('doc-sync'),
            };
        };

        const scaffold = (cwd: string, stubBody: string): string => {
            mkdirSync(join(cwd, 'plugins', 'sp'), { recursive: true });
            symlinkSync(join(REPO_ROOT, 'plugins', 'sp', 'scripts'), join(cwd, 'plugins', 'sp', 'scripts'));
            const stub = join(cwd, 'stub-spur');
            writeFileSync(stub, stubBody);
            chmodSync(stub, 0o755);
            return stub;
        };

        // sh echo interprets the JSON's \n escapes; the stubs below use printf %s instead.

        test('a clean change map projects mode=fast, claims fast:drift-probe-clean, and routes metrics-record', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0944-clean-'));
            try {
                const stub = scaffold(
                    cwd,
                    `#!/bin/sh\ncase "$1 $2" in\n  "task show") printf '%s\\n' '${taskShow('- `packages/app/src/workflow/engine.ts:120`')}'; exit 0;;\nesac\nexit 99\n`,
                );
                const outcome = runTaskResolve(cwd, 'r-0944-clean', stub, '');
                expect(outcome.probe?.clean).toBe(true);
                expect(outcome.projectedMode).toBe('fast');
                expect(outcome.reason).toBe('fast:drift-probe-clean');
                expect(outcome.fastGuardRc).toBe(0); // metrics-record
                expect(outcome.safetyGuardRc).not.toBe(0); // doc-sync declined
                expect(readFileSync(join(cwd, '.spur/memory/wrapup-routes.log'), 'utf8')).toContain(
                    'r-0944-clean fast:drift-probe-clean',
                );
            } finally {
                cleanup(cwd);
            }
        });

        test('a doc-owned changed path stays dirty and routes doc-sync', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0944-docowned-'));
            try {
                const wfPath = `${join('config', 'workflows', 'wrapup-pipeline.yaml')}:12`;
                const solution = [`- \`${wfPath}\``, '- `packages/app/src/index.ts:3`'].join('\n');
                const stub = scaffold(
                    cwd,
                    `#!/bin/sh\ncase "$1 $2" in\n  "task show") printf '%s\\n' '${taskShow(solution)}'; exit 0;;\nesac\nexit 99\n`,
                );
                const outcome = runTaskResolve(cwd, 'r-0944-dirty', stub, '');
                expect(outcome.probe?.clean).toBe(false);
                expect(outcome.probe?.reasons.join(' ')).toContain('matches doc-owned surface');
                expect(outcome.projectedMode).toBe('');
                expect(outcome.reason).toBe('safety:missing evidence (mode empty)');
                expect(outcome.fastGuardRc).not.toBe(0);
                expect(outcome.safetyGuardRc).toBe(0); // doc-sync
            } finally {
                cleanup(cwd);
            }
        });

        test('a caller mode=safety is never overridden and still routes doc-sync', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0944-safety-'));
            try {
                const stub = scaffold(
                    cwd,
                    `#!/bin/sh\ncase "$1 $2" in\n  "task show") printf '%s\\n' '${taskShow('- `packages/app/src/index.ts:3`')}'; exit 0;;\nesac\nexit 99\n`,
                );
                const outcome = runTaskResolve(cwd, 'r-0944-safety', stub, 'safety');
                expect(outcome.probe).toBeNull(); // the probe never ran
                expect(outcome.projectedMode).toBe('safety');
                expect(outcome.reason).toBe('safety:operator-forced doc-sync');
                expect(outcome.safetyGuardRc).toBe(0); // doc-sync
            } finally {
                cleanup(cwd);
            }
        });

        test('an empty or unparseable Solution fails safe and routes doc-sync', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0944-emptysol-'));
            try {
                const stub = scaffold(
                    cwd,
                    `#!/bin/sh\ncase "$1 $2" in\n  "task show") printf '%s\\n' '${taskShow('(no change map yet)')}'; exit 0;;\nesac\nexit 99\n`,
                );
                const outcome = runTaskResolve(cwd, 'r-0944-empty', stub, '');
                expect(outcome.probe?.clean).toBe(false);
                expect(outcome.probe?.reasons).toEqual(['0944: Solution empty or unparseable']);
                expect(outcome.projectedMode).toBe('');
                expect(outcome.safetyGuardRc).toBe(0); // doc-sync
            } finally {
                cleanup(cwd);
            }
        });

        test('caller-mode-wins is YAML-level: the probe runs only behind the -n "$mode" gate', () => {
            const probeShell = String(shellOf(def, 'task-resolve', 1)?.options?.command ?? '');
            expect(probeShell).toContain('wrapup-drift-probe');
            expect(probeShell.indexOf('[ -n "$mode" ]')).toBeGreaterThanOrEqual(0);
            expect(probeShell.indexOf('[ -n "$mode" ]')).toBeLessThan(probeShell.indexOf('wrapup-drift-probe'));
            expect(probeShell).not.toContain('jq');
            // The projection is read into vars.mode by a declared file.read.into-var action.
            const actions = (def.states.find((s) => s.id === 'task-resolve')?.onEnter ?? []) as Array<{
                kind: string;
                options?: Record<string, unknown>;
            }>;
            const intoVar = actions.find((a) => a.kind === 'file.read.into-var');
            expect(intoVar?.options?.var).toBe('mode');
            expect(String(intoVar?.options?.path)).toContain('-mode.txt');
            expect(actions.map((a) => a.kind)).toEqual(['note', 'shell', 'shell', 'file.read.into-var', 'shell']);
        });
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
