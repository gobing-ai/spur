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
 * and PASS only
 * after every append succeeds. 1249 R1 removed the feature write path: wrap-up owns post-task
 * knowledge work only, and feature state belongs to feature-lifecycle (ADR-142).
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { loadWorkflowDefFromText } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';

const REPO_ROOT = join(import.meta.dir, '../../../../');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config', 'workflows');
/** 0824: the wrapup steps the wrappers delegate to (exec pins live in tests/workflow/wrapup/). */
const WRAPUP_STEPS = join(REPO_ROOT, 'packages', 'app', 'src', 'workflow', 'wrapup', 'steps.ts');
/** Script-absorption PR-5: the wrappers call `$spurBin task wrapup <op>`; this is that CLI. */
const CLI = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');

/**
 * A spurBin shim that runs `task wrapup …` through the real CLI and forwards every other call
 * (the steps' nested `task show` / `feature …` lookups) to `stub`. The CLI hands its own env —
 * including spurBin = this shim — to the nested calls.
 */
function wrapupShim(cwd: string, stub: string): string {
    const shim = join(cwd, 'spur-shim');
    writeFileSync(
        shim,
        `#!/bin/sh\ncase "$1 $2" in "task wrapup") exec '${process.execPath}' '${CLI}' "$@";; esac\nexec '${stub}' "$@"\n`,
    );
    chmodSync(shim, 0o755);
    return shim;
}

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
    terminalReason?: string;
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
 * 0824: task-capture, metrics and feature-sync execution moved into the wrapup steps
 * (`spur task wrapup <op>` since script-absorption PR-5) — `tests/workflow/wrapup/steps.test.ts`
 * holds the exec pins. This file
 * pins the workflow definition: wrapper delegation, the route writer, guards, and the
 * fail-closed wrapper contract.
 */

describe('wrapup-pipeline truthfulness (task 0770, feature R8; task 0783, R1-R5)', () => {
    const def = loadDef('wrapup-pipeline');

    test('identity: the definition carries an explicit version tag', () => {
        // 1037: doc-tripwire inserted between the doc-sync exits and metrics-record.
        // (0986: learnings-validate inserted between doc-sync and learnings-append.
        // 0944: task-resolve gained the drift-probe + mode projection actions and the
        // route-reason writer moved behind the wrapup-steps locator (composition caps).
        // 1147: doc-sync gained the entry snapshot + write-scope check + supersession-pin
        // re-run, with two named fail edges. v9 declares those fail edges before the
        // contract-violation edge, so a compound miss fails the step. v10 (1224) routes the
        // doc tripwire through the SDLC action map. v11 (1229) makes the unbound skip print a
        // stderr note instead of passing silently.)
        expect(def.version).toBe('12');
    });

    test('1249: wrap-up is bounded and has no feature state or variable', () => {
        const raw = readFileSync(join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), 'utf8');
        expect(raw.trimEnd().split('\n').length).toBeLessThanOrEqual(250);
        expect(def.states.some((state) => state.id.startsWith('feature'))).toBe(false);
        expect(Object.keys(def.vars ?? {}).some((key) => key.startsWith('feature'))).toBe(false);
    });

    test('0770 definitions are all explicitly versioned (identity tag, not absence)', () => {
        // Exact per-definition pins: a silent version bump fails here. wrapup-pipeline is '9'
        // since the doc-sync scope/supersession edges moved ahead of contract-violation
        // ('10' since 1224 moved the doc-tripwire probe onto the action list, '9' since 1147's
        // doc-sync edges, '7' since 1037 added the
        // doc-tripwire hop, '6' since 0986 added the learnings shape gate, '5' since 0944 added
        // the drift probe + mode projection and moved the route-reason writer behind the
        // wrapup-steps locator; '4' since 0871's repair edge). feature-lifecycle is '3' since
        // 1179 added the ADR-136 `deprecated` state and its deprecate/un-deprecate edges ('2'
        // since 1147 cleared the inherited nested-run marker at its one nested invocation).
        // (feature-dev was pinned '3' until task 0866 retired the definition.)
        const expectedVersions: Record<string, string> = {
            'task-lifecycle': '1',
            'feature-lifecycle': '3',
            'wrapup-pipeline': '12',
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
        test('the resolver is one typed gate; the route writer reads the validated capture', () => {
            const actions = def.states.find((state) => state.id === 'task-resolve')?.onEnter ?? [];
            const gates = actions.filter((action) => action.kind === 'command.gate');
            expect(gates).toHaveLength(1);
            expect(gates[0]?.options).toMatchObject({
                executable: `\${vars.spurBin}`,
                args: ['task', 'wrapup', 'resolve', '--no-logo'],
                resultFile: `.spur/run/\${vars.__runId}-wrapup-resolve.status`,
                softFail: true,
            });
            const shells = shellsOf(def, 'task-resolve');
            // 0783 R2/R5: the route-reason writer consumes the capture, never raw input.
            // 0944: the writer moved behind `spur task wrapup` (composition caps) and also reads
            // the drift probe verdict; the capture + reason pins hold against the step source.
            const route = String(shells[1]?.options?.command ?? '');
            expect(route).toContain('$spurBin task wrapup');
            expect(route).toContain('route-reason');
            // The route-reason writer lives in wrapup/steps.ts (0944): pin its body, not the
            // whole module (resolve legitimately parses env.tasks; route-reason must not).
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
                // 0824: the resolve step and the 0944 route-reason writer both run through
                // `spur task wrapup`; run attribution stays a step-level pin.
                const runThrough = (runId: string, wbs: string): void => {
                    for (const sub of ['resolve', 'route-reason'] as const) {
                        const step = spawnSync(process.execPath, [CLI, 'task', 'wrapup', sub, '--no-logo'], {
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
        test('the shell is the `task wrapup` wrapper; it never re-parses raw $tasks or writes rows itself', () => {
            const cmd = String(shellsOf(def, 'metrics-record')[0]?.options?.command ?? '');
            expect(cmd).toContain('$spurBin task wrapup');
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

    describe('doc-sync records truthful outcomes', () => {
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
        // 0824: the resolve step is the first action (a `command.gate` since 1249). 0944: the
        // route-reason writer moved behind `task wrapup` (the last shell, after the drift probe +
        // mode projection) to stay inside the ADR-115 shell caps; only the step writes reasons.
        const route = String(shellOf(def, 'task-resolve', 1)?.options?.command ?? '');
        expect(route).toContain('$spurBin task wrapup');
        expect(route).toContain('route-reason');
        expect(route).not.toContain('.spur/run/wrapup-route-reason.txt');
        expect(route).not.toContain('RUN_ID="wrapup"');
        const script = readFileSync(WRAPUP_STEPS, 'utf8');
        expect(script).toContain('route-reason.txt`');
        expect(script).not.toContain('.spur/run/wrapup-route-reason.txt');
        // The resolve wrapper writes no reason at all — fixed-path or otherwise.
        const wrapper = JSON.stringify(
            def.states
                .find((state) => state.id === 'task-resolve')
                ?.onEnter?.find((action) => action.kind === 'command.gate'),
        );
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
         * Runs the task-resolve onEnter shells against a temp cwd (the real `spur task wrapup`
         * behind a shim, stub spur for the lookups), simulating file.read.into-var between the probe
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
            mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
            const resolved = spawnSync(process.execPath, [CLI, 'task', 'wrapup', 'resolve', '--no-logo'], {
                cwd,
                encoding: 'utf8',
                env: { ...getEnvVars(), __runId: runId, tasks: '["0944"]', spurBin },
            });
            expect(resolved.status).toBe(0);
            runShell(0, callerMode); // probe + mode projection (no-op projection when mode set)
            const raw = readFileSync(join(cwd, '.spur/run', `${runId}-mode.txt`), 'utf8');
            const projectedMode = raw.trim();
            let probe: RouteOutcome['probe'] = null;
            try {
                probe = JSON.parse(readFileSync(join(cwd, '.spur/run', `${runId}-drift-probe.json`), 'utf8'));
            } catch {
                // no probe artifact — the caller mode was set, so the probe never ran
            }
            runShell(1, projectedMode); // route-reason writer, now seeing the projected mode
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
            const stub = join(cwd, 'stub-spur');
            writeFileSync(stub, stubBody);
            chmodSync(stub, 0o755);
            return wrapupShim(cwd, stub);
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
            const probeShell = String(shellOf(def, 'task-resolve', 0)?.options?.command ?? '');
            expect(probeShell).toContain('$spurBin task wrapup drift-probe');
            expect(probeShell.indexOf('[ -n "$mode" ]')).toBeGreaterThanOrEqual(0);
            expect(probeShell.indexOf('[ -n "$mode" ]')).toBeLessThan(probeShell.indexOf('task wrapup drift-probe'));
            // 0944: no inline parsing of the capture/probe output (PR-5 also dropped the 1007 R4
            // script-root identity read the plugin-script locator needed).
            expect(probeShell.match(/jq /g)?.length ?? 0).toBe(0);
            // The projection is read into vars.mode by a declared file.read.into-var action.
            const actions = (def.states.find((s) => s.id === 'task-resolve')?.onEnter ?? []) as Array<{
                kind: string;
                options?: Record<string, unknown>;
            }>;
            const intoVar = actions.find((a) => a.kind === 'file.read.into-var');
            expect(intoVar?.options?.var).toBe('mode');
            expect(String(intoVar?.options?.path)).toContain('-mode.txt');
            expect(actions.map((a) => a.kind)).toEqual([
                'note',
                'command.gate',
                'shell',
                'file.read.into-var',
                'shell',
            ]);
        });
    });

    describe('0824 wrapper fail-closed contract', () => {
        test('each wrap-up wrapper writes FAIL and exits 0 when `spur task wrapup` exits nonzero', () => {
            const cases: Array<{ state: string; statusFile: string; marker?: string }> = [
                { state: 'metrics-record', statusFile: 'wrapup-metrics.status' },
                // 1147: the two post-doc-sync checks name their own violation in the status file
                // (the guard routes on the marker, not on the word FAIL).
                {
                    state: 'doc-sync',
                    statusFile: 'wrapup-doc-sync-scope.status',
                    marker: 'scope-violation: task wrapup doc-sync-scope failed',
                },
                { state: 'doc-sync', statusFile: 'wrapup-doc-supersession.status', marker: 'supersession-pin-failed' },
            ];
            for (const [index, { state, statusFile, marker }] of cases.entries()) {
                const cwd = mkdtempSync(join(tmpdir(), 'wrapup-failclosed-'));
                try {
                    const actionIndex = state === 'doc-sync' ? index : 0;
                    const result = spawnSync(
                        'sh',
                        ['-c', String(shellOf(def, state, actionIndex).options?.command ?? '')],
                        {
                            cwd,
                            encoding: 'utf8',
                            env: {
                                ...getEnvVars(),
                                __runId: `r-fc-${state}`,
                                // A spur that fails every call: each wrapper must fail closed.
                                spurBin: 'false',
                                PATH: `${cwd}:${getEnvVar('PATH') ?? ''}`,
                            },
                        },
                    );
                    expect(result.status, state).toBe(0);
                    expect(result.stderr, state).toContain('failed closed');
                    const status = readFileSync(join(cwd, `.spur/run/r-fc-${state}-${statusFile}`), 'utf8');
                    expect(status, state).toContain(marker ?? 'FAIL');
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
        // 1249 R1: the feature sync path (and its soft-success language) is gone with it.
        expect(raw).not.toContain('feature-transition');
        expect(raw).not.toContain('cannot convert a failed sync into');
        // Truthful routing stays: the typed resolve-gate status is the only claim a route can make.
        expect(raw).toContain('-wrapup-resolve.status');
    });

    describe('0871 contract-first routing (ADR-118 pilot)', () => {
        test('doc-sync declares onError: continue so transition guards read the agent result', () => {
            const state = def.states.find((s) => s.id === 'doc-sync');
            const agent = state?.onEnter?.find((a) => a.kind === 'agent.run');
            expect(agent?.onError).toBe('continue');
            // 1147 R1: the entry snapshot runs BEFORE the model query, so only doc-sync's own
            // writes are attributable; the two deterministic checks run AFTER it.
            expect((state?.onEnter ?? []).map((a) => a.kind)).toEqual(['shell', 'agent.run', 'shell', 'shell']);
            const shells = shellsOf(def, 'doc-sync');
            expect(String(shells[0]?.options?.command ?? '')).toContain('doc-sync-snapshot');
            expect(String(shells[1]?.options?.command ?? '')).toContain('doc-sync-scope');
            expect(String(shells[2]?.options?.command ?? '')).toContain('doc-supersession');
        });

        test('1147 R1/R2: doc-sync states the write scope and the intentional delinked row in its prompt', () => {
            const state = def.states.find((s) => s.id === 'doc-sync');
            const input = String(
                (state?.onEnter?.find((a) => a.kind === 'agent.run')?.options as Record<string, string> | undefined)
                    ?.input ?? '',
            );
            expect(input).toContain('Write ONLY inside docs/');
            expect(input).toContain('superseded satellite is intentional');
        });

        test('1147 R1/R2: the scope and supersession checks fail the step before doc-tripwire', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'doc-sync');
            // Declaration order is load-bearing: the two deterministic post-doc-sync
            // checks first (a compound miss fails the step), then contract violation,
            // then action-ok success, then always defense.
            expect(edges.map((e) => [e.to, e.guard?.kind, e.trigger ?? null])).toEqual([
                ['failed', 'shell', null],
                ['failed', 'shell', null],
                ['repair', 'contract-violation', 'contract-violation'],
                ['learnings-validate', 'action-ok', null],
                ['failed', 'always', 'executor-failure'],
            ]);
            const [scopeEdge, pinEdge] = edges;
            expect(String(scopeEdge?.guard?.options?.command ?? '')).toContain('wrapup-doc-sync-scope.status');
            expect(String(scopeEdge?.guard?.options?.command ?? '')).toContain('scope-violation');
            expect(String(pinEdge?.guard?.options?.command ?? '')).toContain('wrapup-doc-supersession.status');
            expect(String(pinEdge?.guard?.options?.command ?? '')).toContain('supersession-pin-failed');
            // Both failure edges declare a valid terminal reason (0937 R3) and the tripwire
            // backstop is untouched: doc-tripwire still runs docTripwireCmd and routes FAIL.
            expect(scopeEdge?.terminalReason).toBe('failed-check');
            expect(pinEdge?.terminalReason).toBe('failed-check');
            expect(def.transitions.filter((t: TransitionDef) => t.from === 'doc-tripwire').map((e) => e.to)).toEqual([
                'failed',
                'metrics-record',
            ]);
        });

        test('doc-sync routes contract violation → repair, success → learnings-validate, failure → failed', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'doc-sync');
            const repair = edges.find((e) => e.trigger === 'contract-violation');
            expect(repair?.to).toBe('repair');
            expect(edges.indexOf(repair as TransitionDef)).toBeGreaterThan(1);
            expect(edges.find((e) => e.to === 'learnings-validate')?.guard?.kind).toBe('action-ok');
            const last = edges[edges.length - 1];
            expect(last?.to).toBe('failed');
            expect(last?.guard?.kind).toBe('always');
            expect(last?.trigger).toBe('executor-failure');
        });

        test('repair is cheap (shell only) and never re-dispatches the agent', () => {
            const state = def.states.find((s) => s.id === 'repair');
            const kinds = (state?.onEnter ?? []).map((a) => a.kind);
            expect(kinds).toEqual(['shell']);
            const cmd = String(state?.onEnter?.[0]?.options?.command ?? '');
            expect(cmd).toContain('wrapup-repair.status');
            expect(cmd).toContain('skipped re-dispatch');
            expect(cmd).not.toContain('task wrapup');
            // The repair path never re-enters doc-sync: it flows to doc-tripwire (1037).
            expect(def.transitions.filter((t: TransitionDef) => t.from === 'repair').map((e) => e.to)).toEqual([
                'doc-tripwire',
            ]);
        });

        test('learnings-append holds the soft append shell and flows to doc-tripwire', () => {
            const state = def.states.find((s) => s.id === 'learnings-append');
            const cmd = String(state?.onEnter?.[0]?.options?.command ?? '');
            expect(cmd).toContain('.spur/memory/learnings.md');
            expect(
                def.transitions.filter((t: TransitionDef) => t.from === 'learnings-append').map((e) => e.to),
            ).toEqual(['doc-tripwire']);
        });

        test('R4: only wrapup-pipeline declares the contract-violation edge (opt-in)', () => {
            const others = [
                'task-lifecycle',
                'feature-lifecycle',
                // 1246 R5: feature-verification is retired.
                'idea-pipeline',
                'task-pipeline',
                // 1251 R1: pr-review and wayfinder-resolution are retired.
                'history-anatomy',
            ];
            for (const name of others) {
                const other = loadDef(name);
                const uses = other.transitions.some((t: TransitionDef) => t.guard?.kind === 'contract-violation');
                expect(uses, `${name} must not declare a contract-violation edge`).toBe(false);
            }
        });
    });

    describe('0986: learnings shape gate before append', () => {
        const validateCmd = (): string => String(shellOf(def, 'learnings-validate', 0).options?.command ?? '');
        const appendCmd = (): string => String(shellOf(def, 'learnings-append', 0).options?.command ?? '');
        const repairCmd = (): string => String(shellOf(def, 'repair', 0).options?.command ?? '');
        const guardCommand = (from: string, to: string): string => {
            const edge = def.transitions.find(
                (t: TransitionDef) => t.from === from && t.to === to && t.guard?.kind === 'shell',
            );
            return String(edge?.guard?.options?.command ?? '');
        };
        const runShell = (command: string, cwd: string, env: Record<string, string>) =>
            spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...getEnvVars(), ...env } });
        const statusOf = (cwd: string, runId: string): string =>
            readFileSync(join(cwd, `.spur/run/${runId}-wrapup-learnings.status`), 'utf8').trim();
        const runId = 'r0986';

        test('learnings-validate is a shell-only structural gate that names its status file', () => {
            const state = def.states.find((s) => s.id === 'learnings-validate');
            expect((state?.onEnter ?? []).map((a) => a.kind)).toEqual(['shell']);
            expect(validateCmd()).toContain('wrapup-learnings.status');
            // R1 predicates: a date, a four-digit WBS, and a markdown bullet.
            expect(validateCmd()).toContain('[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
            expect(validateCmd()).toContain('[-*] ');
        });

        test('R1/R2: a narration-only capture fails the gate, routes to repair, and never appends', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0986-narration-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                mkdirSync(join(cwd, '.spur/memory'), { recursive: true });
                writeFileSync(
                    join(cwd, `.spur/run/${runId}-wrapup-learnings.md`),
                    'Single task WBS `0966`. Let me read the task, the constitution, and the current state of the docs that need drift repair.\nThe task was run on a worktree branch. Let me find the task file and read the current docs to assess drift.\n',
                );
                expect(runShell(validateCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(statusOf(cwd, runId)).toBe('invalid-learnings-shape');
                // Invalid shape routes to repair; the append guard declines.
                expect(runShell(guardCommand('learnings-validate', 'repair'), cwd, { __runId: runId }).status).toBe(0);
                expect(
                    runShell(guardCommand('learnings-validate', 'learnings-append'), cwd, { __runId: runId }).status,
                ).not.toBe(0);
                // Memory untouched — narration was never appended.
                expect(existsSync(join(cwd, '.spur/memory/learnings.md'))).toBe(false);
                // Repair status distinguishes the shape failure from the missing-file violation.
                expect(runShell(repairCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(readFileSync(join(cwd, `.spur/run/${runId}-wrapup-repair.status`), 'utf8')).toContain(
                    'invalid-learnings-shape',
                );
            } finally {
                cleanup(cwd);
            }
        });

        test('R3: a dated WBS bullet passes and appends once, byte-for-byte', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0986-valid-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                const capture =
                    '## 2026-09-27 — Task 0986\n\n- expectFile proves existence, never shape\n- validate before append\n';
                writeFileSync(join(cwd, `.spur/run/${runId}-wrapup-learnings.md`), capture);
                expect(runShell(validateCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(statusOf(cwd, runId)).toBe('PASS');
                expect(
                    runShell(guardCommand('learnings-validate', 'learnings-append'), cwd, { __runId: runId }).status,
                ).toBe(0);
                expect(runShell(guardCommand('learnings-validate', 'repair'), cwd, { __runId: runId }).status).not.toBe(
                    0,
                );
                expect(runShell(appendCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(readFileSync(join(cwd, '.spur/memory/learnings.md'), 'utf8')).toBe(`${capture}\n`);
            } finally {
                cleanup(cwd);
            }
        });

        test('R1: a dated bullet without a WBS fails — the date year is not a WBS', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0986-nowbs-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, `.spur/run/${runId}-wrapup-learnings.md`), '- 2026-09-28: learned x\n');
                expect(runShell(validateCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(statusOf(cwd, runId)).toBe('invalid-learnings-shape');
            } finally {
                cleanup(cwd);
            }
        });

        test('R3: empty and missing captures keep the soft skip', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0986-empty-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                // Missing capture: PASS, append is a no-op.
                expect(runShell(validateCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(statusOf(cwd, runId)).toBe('PASS');
                expect(runShell(appendCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(existsSync(join(cwd, '.spur/memory/learnings.md'))).toBe(false);
                // Empty capture: same soft skip.
                writeFileSync(join(cwd, `.spur/run/${runId}-wrapup-learnings.md`), '');
                expect(runShell(validateCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(statusOf(cwd, runId)).toBe('PASS');
                expect(runShell(appendCmd(), cwd, { __runId: runId }).status).toBe(0);
                expect(existsSync(join(cwd, '.spur/memory/learnings.md'))).toBe(false);
            } finally {
                cleanup(cwd);
            }
        });

        test('an unclassifiable status fails loud instead of appending', () => {
            const defense = def.transitions.find(
                (t: TransitionDef) => t.from === 'learnings-validate' && t.to === 'failed',
            );
            expect(defense?.guard?.kind).toBe('always');
            expect(defense?.terminalReason).toBe('failed-check');
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0986-defense-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                // A missing status satisfies neither discriminating guard.
                expect(runShell(guardCommand('learnings-validate', 'repair'), cwd, { __runId: runId }).status).not.toBe(
                    0,
                );
                expect(
                    runShell(guardCommand('learnings-validate', 'learnings-append'), cwd, { __runId: runId }).status,
                ).not.toBe(0);
            } finally {
                cleanup(cwd);
            }
        });
    });

    describe('1152: repair step tolerates missing learnings status (contract-violation entry)', () => {
        const repairCmd = (): string => String(shellOf(def, 'repair', 0).options?.command ?? '');
        const runShell = (command: string, cwd: string, env: Record<string, string>) =>
            spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...getEnvVars(), ...env } });

        test('AC1 / R1: absent learnings status exits 0 and records contract-violation', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-1152-absent-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                const r = runShell(repairCmd(), cwd, { __runId: 'r1' });
                expect(r.status).toBe(0);
                const content = readFileSync(join(cwd, '.spur/run/r1-wrapup-repair.status'), 'utf8');
                expect(content.startsWith('contract-violation:')).toBe(true);
            } finally {
                cleanup(cwd);
            }
        });

        test('R1 / R2: empty, whitespace, and non-shape values record contract-violation and exit 0', () => {
            for (const [val, tag] of [
                ['', 'empty'],
                ['   \n  ', 'whitespace'],
                ['PASS', 'pass'],
                ['random-error', 'other'],
            ] as const) {
                const cwd = mkdtempSync(join(tmpdir(), `wrapup-1152-${tag}-`));
                try {
                    mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                    writeFileSync(join(cwd, '.spur/run/r1-wrapup-learnings.status'), val);
                    const r = runShell(repairCmd(), cwd, { __runId: 'r1' });
                    expect(r.status, `expected exit 0 for ${tag}`).toBe(0);
                    const content = readFileSync(join(cwd, '.spur/run/r1-wrapup-repair.status'), 'utf8');
                    expect(content.startsWith('contract-violation:')).toBe(true);
                } finally {
                    cleanup(cwd);
                }
            }
        });

        test('AC2 / R2: invalid-learnings-shape records invalid-learnings-shape and exits 0', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-1152-invalid-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, '.spur/run/r2-wrapup-learnings.status'), 'invalid-learnings-shape\n');
                const r = runShell(repairCmd(), cwd, { __runId: 'r2' });
                expect(r.status).toBe(0);
                const content = readFileSync(join(cwd, '.spur/run/r2-wrapup-repair.status'), 'utf8');
                expect(content.startsWith('invalid-learnings-shape:')).toBe(true);
            } finally {
                cleanup(cwd);
            }
        });

        test('AC4 / R4: write failure stays loud (directory collision on status output)', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-1152-failwrite-'));
            try {
                mkdirSync(join(cwd, '.spur/run/r4-wrapup-repair.status'), { recursive: true });
                const r = runShell(repairCmd(), cwd, { __runId: 'r4' });
                expect(r.status).not.toBe(0);
            } finally {
                cleanup(cwd);
            }
        });
    });

    describe('1037: repo-wide doc tripwire between the doc-sync exits and metrics-record', () => {
        test('doc-tripwire runs docTripwireCmd via sh -c and records PASS/FAIL to a run-scoped status file', () => {
            const cmd = String(shellOf(def, 'doc-tripwire', 0).options?.command ?? '');
            expect(cmd).toContain('sh -c "$docTripwireCmd"');
            expect(cmd).toContain('wrapup-doc-tripwire.status');
            expect(cmd).toContain("printf 'PASS\\n'");
            expect(cmd).toContain("printf 'FAIL\\n'");
            // Status truth lives in the file (0783 R4): the action exits 0 on both branches.
        });

        test('the FAIL edge is declared first and only a recorded PASS reaches metrics-record', () => {
            const edges = def.transitions.filter((t: TransitionDef) => t.from === 'doc-tripwire');
            expect(edges.map((e: TransitionDef) => e.to)).toEqual(['failed', 'metrics-record']);
            expect(edges[0]?.terminalReason).toBe('failed-check');
            expect(String(edges[0]?.guard?.options?.command ?? '')).toContain('= FAIL');
            expect(String(edges[1]?.guard?.options?.command ?? '')).toContain('= PASS');
            // A missing status satisfies neither guard (0783 status-file pattern).
            expect(String(edges[0]?.guard?.options?.command ?? '')).toContain('2>/dev/null');
            expect(String(edges[1]?.guard?.options?.command ?? '')).toContain('2>/dev/null');
        });

        test('learnings-append and repair both enter doc-tripwire; the no-doc-sync fast path does not', () => {
            for (const from of ['learnings-append', 'repair']) {
                expect(def.transitions.filter((t: TransitionDef) => t.from === from).map((e) => e.to)).toEqual([
                    'doc-tripwire',
                ]);
            }
            const fast = def.transitions.filter(
                (t: TransitionDef) => t.from === 'task-resolve' && t.to === 'metrics-record',
            );
            expect(fast).toHaveLength(1);
            expect(fast[0]?.guard?.kind).toBe('shell');
        });

        test('the default docTripwireCmd carries the action-list probe and the trusted-config contract', () => {
            expect(def.vars?.docTripwireCmd).toBe(
                'if $spurBin self exec --list --json 2>/dev/null | jq -e \'.[] | select(.name == "test-repo-wide" and .source != "unbound")\' >/dev/null 2>&1; then $spurBin self exec test-repo-wide; else echo "wrapup: doc tripwire skipped — the test-repo-wide action is unbound; declare builder.actions.test-repo-wide to enable it" >&2; fi',
            );
            const raw = readFileSync(join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), 'utf8');
            const at = raw.indexOf('docTripwireCmd:');
            expect(raw.slice(at - 300, at)).toContain('TRUSTED CONFIG ONLY');
        });

        test('1229: an unbound tripwire action announces the skip instead of passing silently', () => {
            const cmd = def.vars?.docTripwireCmd ?? '';
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-1229-note-'));
            try {
                writeFileSync(
                    join(cwd, 'fake-spur'),
                    '#!/bin/sh\n[ "$1" = self ] && [ "$2" = exec ] || exit 1\nshift 2\n' +
                        'if [ "$1" = --list ]; then printf \'%s\\n\' \'[{"name":"test-repo-wide","reserved":false,"source":"unbound"}]\'; exit 0; fi\nexit 2\n',
                );
                chmodSync(join(cwd, 'fake-spur'), 0o755);
                const r = spawnSync('sh', ['-c', cmd], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...getEnvVars(), spurBin: join(cwd, 'fake-spur') },
                });
                expect(r.status).toBe(0);
                expect(r.stderr).toContain('doc tripwire skipped');
                expect(r.stderr).toContain('builder.actions.test-repo-wide');
            } finally {
                cleanup(cwd);
            }
        });

        test('behavior: no script is a PASS no-op, a failing script records FAIL, empty cmd still PASS (AC1/AC4, R2)', () => {
            const onEnter = String(shellOf(def, 'doc-tripwire', 0).options?.command ?? '');
            const runHop = (dir: string, extraEnv: Record<string, string> = {}): string => {
                const r = spawnSync('sh', ['-c', onEnter], {
                    cwd: dir,
                    encoding: 'utf8',
                    env: {
                        ...getEnvVars(),
                        __runId: 'trip',
                        docTripwireCmd: def.vars?.docTripwireCmd ?? '',
                        spurBin: join(dir, 'fake-spur'),
                        FAKE_ACTIONS: BOUND_ACTIONS,
                        ...extraEnv,
                    },
                });
                // The action always exits 0 — status truth lives in the file (0783 R4).
                expect(r.status).toBe(0);
                return readFileSync(join(dir, '.spur/run/trip-wrapup-doc-tripwire.status'), 'utf8');
            };
            const BOUND_ACTIONS = '[{"name":"test-repo-wide","reserved":false,"source":"config"}]';
            const UNBOUND_ACTIONS = '[{"name":"test-repo-wide","reserved":false,"source":"unbound"}]';
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-1037-tripwire-'));
            try {
                // The action map is the probe surface (1224 R6): a stub `spur` reports the
                // binding for `--list --json` and maps `self exec test-repo-wide` to the script.
                writeFileSync(
                    join(cwd, 'fake-spur'),
                    '#!/bin/sh\n[ "$1" = self ] && [ "$2" = exec ] || exit 1\nshift 2\n' +
                        'if [ "$1" = --list ]; then printf \'%s\\n\' "$FAKE_ACTIONS"; exit 0; fi\n' +
                        'if [ "$1" = test-repo-wide ]; then exec bun run test-repo-wide; fi\nexit 2\n',
                );
                chmodSync(join(cwd, 'fake-spur'), 0o755);
                // AC4: a project whose action resolves unbound is a PASS no-op.
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, 'package.json'), '{"name":"plain","scripts":{}}');
                expect(runHop(cwd, { FAKE_ACTIONS: UNBOUND_ACTIONS })).toBe('PASS\n');
                // Exercise the real ADR tripwire against a clean snapshot, then a historical decision edit.
                mkdirSync(join(cwd, 'docs'));
                mkdirSync(join(cwd, 'docs/design'));
                mkdirSync(join(cwd, 'repo-wide-tests'));
                const adr = readFileSync(join(REPO_ROOT, 'docs/00_ADR.md'), 'utf8');
                writeFileSync(join(cwd, 'docs/00_ADR.md'), adr);
                // The G72 R4 doc-surface assertions read these satellites too, so the fixture
                // copies them exactly as it copies the ADR corpus.
                for (const rel of [
                    'docs/03_ARCHITECTURE.md',
                    'docs/04_DESIGN.md',
                    'docs/design/spur-team-mode-design.md',
                ]) {
                    writeFileSync(join(cwd, rel), readFileSync(join(REPO_ROOT, rel)));
                }
                writeFileSync(
                    join(cwd, 'repo-wide-tests/adr-supersession.test.ts'),
                    readFileSync(join(REPO_ROOT, 'repo-wide-tests/adr-supersession.test.ts')),
                );
                for (const args of [
                    ['init', '-q'],
                    ['add', 'docs/00_ADR.md'],
                    [
                        '-c',
                        'user.name=Tripwire test',
                        '-c',
                        'user.email=tripwire@example.invalid',
                        'commit',
                        '-qm',
                        'snapshot',
                    ],
                ]) {
                    expect(spawnSync('git', args, { cwd, encoding: 'utf8' }).status).toBe(0);
                }
                writeFileSync(
                    join(cwd, 'package.json'),
                    '{"name":"tripped","scripts":{"test-repo-wide":"bun test repo-wide-tests"}}',
                );
                expect(runHop(cwd)).toBe('PASS\n');
                const edited = adr.replace(
                    '**Decision:** Use `agent.team.<teamId>`',
                    '**Decision:** Use a rewritten owner',
                );
                expect(edited).not.toBe(adr);
                writeFileSync(join(cwd, 'docs/00_ADR.md'), edited);
                expect(runHop(cwd)).toBe('FAIL\n');
                // R2: an empty docTripwireCmd disables the check while still writing PASS.
                expect(runHop(cwd, { docTripwireCmd: '' })).toBe('PASS\n');
            } finally {
                cleanup(cwd);
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

// 1249: run the shipped graph with real CLI task resolution and persisted engine evidence.
describe('1249: wrap-up typed resolution end to end', () => {
    for (const [name, tasks, taskStatus, expected, token] of [
        ['done-feature-task', '["1249"]', 'done', 'done', 'PASS'],
        ['malformed', '{broken', 'done', 'failed', 'FAIL'],
        ['unknown-wbs', '["9999"]', 'done', 'failed', 'FAIL'],
        ['unfinished-task', '["1249"]', 'todo', 'failed', 'FAIL'],
        ['empty', '[]', 'done', 'skipped', 'PASS'],
        ['crash', '["1249"]', 'done', 'failed', 'BLOCKED'],
    ] as const) {
        test(name, async () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-1249-'));
            const { createMigratedDb } = await import('@gobing-ai/spur-domain');
            const { WorkflowAppService } = await import('../../src/services/workflow-service');
            const { NodeProcessExecutor } = await import('@gobing-ai/ts-runtime');
            const db = await createMigratedDb({ url: ':memory:' });
            try {
                mkdirSync(join(cwd, 'docs/tasks'), { recursive: true });
                mkdirSync(join(cwd, 'docs/features'), { recursive: true });
                const taskFile = join(cwd, 'docs/tasks/1249_wrap.md');
                const featureFile = join(cwd, 'docs/features/D66_wrap.md');
                const task = `---\nname: Wrap fixture\nstatus: ${taskStatus}\nfeature_id: D66\n---\n\n## 1249. Wrap fixture\n\n### Testing\n\nVerdict: PASS\n`;
                const feature = '---\nid: D66\nname: Wrap fixture\nstatus: active\n---\n\n# D66\n';
                writeFileSync(taskFile, task);
                writeFileSync(featureFile, feature);
                const stub = join(cwd, 'source-spur');
                writeFileSync(
                    stub,
                    name === 'crash'
                        ? '#!/bin/sh\nkill -TERM $$\n'
                        : `#!/bin/sh\nexec '${process.execPath}' '${CLI}' "$@"\n`,
                );
                chmodSync(stub, 0o755);
                const svc = new WorkflowAppService({
                    cwd,
                    getDb: async () => db,
                    agentService: () =>
                        ({
                            run: async () => {
                                throw new Error('fast path must never dispatch an agent');
                            },
                        }) as unknown as AgentService,
                    ruleService: () =>
                        ({
                            evaluate: async () => {
                                throw new Error('wrap must never evaluate task rules');
                            },
                        }) as unknown as RuleService,
                    hitlResponder: () => ({ respond: async () => ({ value: 'no' }) }),
                    processExecutor: () => new NodeProcessExecutor(),
                });
                const result = await svc.run(join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), {
                    runId: name,
                    vars: { tasks, mode: 'fast', spurBin: stub, feature: 'D66' },
                });
                expect(result.finalState).toBe(expected);
                expect(readFileSync(join(cwd, `.spur/run/${name}-wrapup-resolve.status`), 'utf8').trim()).toBe(token);
                expect(readFileSync(taskFile, 'utf8')).toBe(task);
                expect(readFileSync(featureFile, 'utf8')).toBe(feature);
                const rows = await db.queryAll<{ kind: string; result_json: string }>(
                    "SELECT kind, result_json FROM action_runs WHERE run_id = ? AND node = 'task-resolve' AND kind = 'command.gate'",
                    name,
                );
                expect(rows).toHaveLength(1);
                expect(JSON.parse(rows[0]?.result_json ?? '{}').data.status).toBe(token);
                if (expected === 'failed' && token === 'FAIL') {
                    expect(readFileSync(join(cwd, `.spur/run/${name}-route-reason.txt`), 'utf8')).toContain('failed:');
                }
                if (expected === 'done') {
                    expect(
                        JSON.parse(readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'), 'utf8')),
                    ).toMatchObject({ wbs: '1249', status: 'done', verdict: 'PASS' });
                }
            } finally {
                await db.close();
                cleanup(cwd);
            }
        }, 20000);
    }
});
