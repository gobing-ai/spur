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

interface SyncStubOptions {
    syncOut: string;
    syncRc?: number;
    showStatus?: string;
    checkRc?: number;
}

/**
 * Stub environment for the feature-transition shell: a spurBin dispatching
 * `feature sync` / `feature show` / `feature check`, plus a failing
 * `superskill` on PATH so the producer chain deterministically takes the
 * plain `spur feature sync` branch (the temp cwd has no plugins/ scaffold).
 */
function stubSyncEnv(cwd: string, opts: SyncStubOptions): Record<string, string> {
    const { syncOut, syncRc = 0, showStatus = 'active', checkRc = 0 } = opts;
    const stub = join(cwd, 'stub-spur');
    writeFileSync(
        stub,
        [
            '#!/bin/sh',
            'case "$1 $2" in',
            `  "feature sync") printf '%s' '${syncOut}'; exit ${syncRc};;`,
            `  "feature show") printf '{"status":"${showStatus}"}\\n';;`,
            `  "feature check") exit ${checkRc};;`,
            'esac',
            'exit 99',
            '',
        ].join('\n'),
    );
    chmodSync(stub, 0o755);
    const superskill = join(cwd, 'superskill');
    writeFileSync(superskill, '#!/bin/sh\nexit 1\n');
    chmodSync(superskill, 0o755);
    return { spurBin: stub, PATH: `${cwd}:${process.env.PATH ?? ''}` };
}

function runSyncShell(def: WorkflowYaml, cwd: string, env: Record<string, string>) {
    return spawnSync('sh', ['-c', String(shellOf(def, 'feature-transition', 0).options?.command ?? '')], {
        cwd,
        encoding: 'utf8',
        // The engine injects vars.featureGateCmd at run time; tests default to the pipeline value
        // (an unset variable would make `sh -c ""` trivially pass and hide gate outcomes).
        env: { ...process.env, featureGateCmd: '$spurBin feature check "$feature"', ...env },
    });
}

const syncResult = (proposal: Record<string, unknown>, applied: boolean): string =>
    JSON.stringify({ proposal, applied, appliedHops: applied ? ['active->done'] : [] });

describe('wrapup-pipeline truthfulness (task 0770, feature R8; task 0783, R1-R5)', () => {
    const def = loadDef('wrapup-pipeline');

    test('identity: the definition carries an explicit version tag', () => {
        expect(def.version).toBe('2');
    });

    test('default feature gate checks only the selected feature and permits explicit override', () => {
        expect(def.vars?.featureGateCmd).toBe('$spurBin feature check "$feature"');
        const cwd = mkdtempSync(join(tmpdir(), 'wrapup-feature-gate-'));
        try {
            const stub = join(cwd, 'spur-stub');
            writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
            chmodSync(stub, 0o755);
            const env = { ...process.env, spurBin: stub, feature: 'D61' };
            const result = spawnSync('sh', ['-c', def.vars?.featureGateCmd ?? 'exit 99'], { env, encoding: 'utf8' });
            expect(result.status).toBe(0);
            expect(result.stdout).toBe('feature\ncheck\nD61\n');
            const command = String(shellsOf(def, 'feature-transition')[0]?.options?.command ?? '');
            expect(command).toContain('sh -c "$featureGateCmd"');
        } finally {
            cleanup(cwd);
        }
    });

    test('0770 definitions are all explicitly versioned (identity tag, not absence)', () => {
        // Exact per-definition pins: a silent version bump fails here. feature-dev is '2' since
        // task 0782 redefined it as existing-feature reuse (frozen design, see
        // feature-dev-definition.test.ts and docs/design/essential-workflow-checks.md).
        // wrapup-pipeline is '2' since task 0783 redefined its consumers (validated
        // inputs, truthful sync outcomes).
        const expectedVersions: Record<string, string> = {
            'task-lifecycle': '1',
            'feature-lifecycle': '1',
            'feature-dev': '2',
            'wrapup-pipeline': '2',
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
        test('the validation shell is the FIRST action; the route writer reads the validated capture', () => {
            const shells = shellsOf(def, 'task-resolve');
            expect(shells.length).toBeGreaterThanOrEqual(2);
            // 0783 R1/R5: validation parses raw vars.tasks exactly once, here.
            const validate = String(shells[0]?.options?.command ?? '');
            expect(validate).toContain('wrapup-resolve.status');
            expect(validate).toContain('wrapup-tasks.json');
            expect(validate).toContain('test("^[0-9]{4}$")');
            // 0783 R2/R5: the route writer consumes the capture, never raw input.
            const route = String(shells[1]?.options?.command ?? '');
            expect(route).toContain('skipped:empty task list');
            expect(route).toContain('wrapup-tasks.json');
            expect(route).not.toContain('"$tasks"');
        });

        test('malformed JSON records FAIL and never produces a normalized list', () => {
            const run = runShell(shellOf(def, 'task-resolve', 0), {
                __runId: 'r-bad',
                tasks: '{oops',
                spurBin: 'true',
            });
            try {
                expect(run.status).toBe(0);
                expect(run.stderr).toContain('canonical four-digit WBS strings');
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
            const run = runShell(shellOf(def, 'task-resolve', 0), { __runId: '', tasks: '[]', spurBin: 'true' });
            cleanup(run.cwd);
            expect(run.status).toBe(1);
            expect(run.stderr).toContain('__runId is empty');
        });

        test('a task that does not resolve to a completed status records FAIL', () => {
            const run = runShell(shellOf(def, 'task-resolve', 0), {
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
                const shell = shellOf(def, 'task-resolve', 0);
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
        test('malformed, non-array, non-string, whitespace and non-canonical entries all FAIL', () => {
            const badInputs = [
                '"0770"', // JSON string, not array
                '["0770", 770]', // non-string entry
                '["0770 "]', // trailing whitespace
                '[" 0770"]', // leading whitespace
                '["  "]', // whitespace-only
                '["07a0"]', // non-digit
                '["07700"]', // five digits
                '["770"]', // three digits
                '[]', // empty entries cannot exist, but an empty array is validated below
            ];
            for (const tasks of badInputs.slice(0, -1)) {
                const run = runShell(shellOf(def, 'task-resolve', 0), {
                    __runId: 'r-shape',
                    tasks,
                    spurBin: 'true',
                });
                try {
                    expect(readFileSync(join(run.cwd, '.spur/run/r-shape-wrapup-resolve.status'), 'utf8')).toContain(
                        'FAIL',
                    );
                    expect(() => readFileSync(join(run.cwd, '.spur/run/r-shape-wrapup-tasks.json'))).toThrow();
                } finally {
                    cleanup(run.cwd);
                }
            }
        });

        test('duplicate valid ids keep first-seen order (not sorted)', () => {
            const run = runShell(shellOf(def, 'task-resolve', 0), {
                __runId: 'r-order',
                tasks: '["0772","0770","0772"]',
                spurBin: 'true',
            });
            try {
                expect(readFileSync(join(run.cwd, '.spur/run/r-order-wrapup-tasks.json'), 'utf8').trim()).toBe(
                    '["0772","0770"]',
                );
            } finally {
                cleanup(run.cwd);
            }
        });

        test('two run ids produce independent run-scoped captures and attributed route lines', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-two-runs-'));
            try {
                const spurBin = stubSpur(cwd, '{"frontmatter":{"status":"done"}}');
                const shell = shellOf(def, 'task-resolve', 0);
                const route = shellOf(def, 'task-resolve', 1);
                for (const runId of ['r-a', 'r-b']) {
                    for (const action of [shell, route]) {
                        const result = spawnSync('sh', ['-c', String(action.options?.command ?? '')], {
                            cwd,
                            encoding: 'utf8',
                            env: {
                                ...process.env,
                                __runId: runId,
                                tasks: `["0${runId === 'r-a' ? 783 : 784}"]`,
                                spurBin,
                                mode: '',
                            },
                        });
                        expect(result.status).toBe(0);
                    }
                }
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
                spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).status ===
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
        test('the shell never re-parses raw $tasks, revalidates the capture, and serializes rows with jq', () => {
            const cmd = String(shellsOf(def, 'metrics-record')[0]?.options?.command ?? '');
            expect(cmd).toContain('wrapup-tasks.json');
            expect(cmd).not.toContain("'$tasks'");
            expect(cmd).toContain('wrapup-metrics.status');
            // 0783 R3: jq serialization, no interpolated printf JSON.
            expect(cmd).toContain('jq -cn');
            expect(cmd).not.toContain(`printf '{"wbs"`);
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

        test('0783 R3: a missing or corrupted capture refuses to record metrics', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-mcap-'));
            try {
                const shell = shellOf(def, 'metrics-record', 0);
                const spurBin = stubSpur(cwd, '{"frontmatter":{"status":"done"}}');
                const run = (runId: string, capture?: string): string => {
                    if (capture !== undefined) {
                        mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                        writeFileSync(join(cwd, `.spur/run/${runId}-wrapup-tasks.json`), capture);
                    }
                    const result = spawnSync('sh', ['-c', String(shell.options?.command ?? '')], {
                        cwd,
                        encoding: 'utf8',
                        env: { ...process.env, __runId: runId, spurBin },
                    });
                    expect(result.status).toBe(0);
                    return readFileSync(join(cwd, `.spur/run/${runId}-wrapup-metrics.status`), 'utf8');
                };
                expect(run('r-missing')).toContain('FAIL');
                expect(run('r-corrupt', '{oops')).toContain('FAIL');
                expect(run('r-noncanon', '["0783","x1"]')).toContain('FAIL');
                expect(() => readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'))).toThrow();
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R3: a malformed lookup output records FAIL instead of a row', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-mbad-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, '.spur/run/r-badlookup-wrapup-tasks.json'), '["0783"]\n');
                const spurBin = stubSpur(cwd, '<html>service unavailable</html>');
                const shell = shellOf(def, 'metrics-record', 0);
                const result = spawnSync('sh', ['-c', String(shell.options?.command ?? '')], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...process.env, __runId: 'r-badlookup', spurBin },
                });
                expect(result.status).toBe(0);
                expect(readFileSync(join(cwd, '.spur/run/r-badlookup-wrapup-metrics.status'), 'utf8')).toContain(
                    'FAIL',
                );
                expect(() => readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'))).toThrow();
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R3: an append failure records FAIL and prior valid rows survive', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-mappend-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                mkdirSync(join(cwd, '.spur/memory'), { recursive: true });
                writeFileSync(join(cwd, '.spur/run/r-appfail-wrapup-tasks.json'), '["0783"]\n');
                const prior = '{"wbs":"0770","feature_id":"D61","status":"done","verdict":"PASS","timestamp":"t"}\n';
                const metricsPath = join(cwd, '.spur/memory/wrapup-metrics.jsonl');
                writeFileSync(metricsPath, prior);
                chmodSync(metricsPath, 0o444);
                const spurBin = stubSpur(cwd, '{"frontmatter":{"status":"done"}}');
                const shell = shellOf(def, 'metrics-record', 0);
                const result = spawnSync('sh', ['-c', String(shell.options?.command ?? '')], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...process.env, __runId: 'r-appfail', spurBin },
                });
                expect(result.status).toBe(0);
                expect(result.stderr).toContain('append failed');
                expect(readFileSync(join(cwd, '.spur/run/r-appfail-wrapup-metrics.status'), 'utf8')).toContain('FAIL');
                expect(readFileSync(metricsPath, 'utf8')).toBe(prior);
            } finally {
                cleanup(cwd);
            }
        });

        test('a resolvable task appends exactly one well-formed metrics row and PASSes', () => {
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
                // 0783 R3: a missing verdict is UNKNOWN telemetry, never proof of completion.
                expect(JSON.parse(row)).toMatchObject({
                    wbs: '0770',
                    feature_id: 'D61',
                    status: 'done',
                    verdict: 'UNKNOWN',
                });
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R3: escaped JSON fields survive serialization as parseable rows', () => {
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-mesc-'));
            try {
                mkdirSync(join(cwd, '.spur/run'), { recursive: true });
                writeFileSync(join(cwd, '.spur/run/r-esc-wrapup-tasks.json'), '["0783"]\n');
                const payload = JSON.stringify({ frontmatter: { status: 'done', feature_id: 'D"61\\x' } });
                const jsonFile = join(cwd, 'stub-payload.json');
                writeFileSync(jsonFile, payload);
                const stub = join(cwd, 'stub-spur');
                writeFileSync(stub, '#!/bin/sh\ncase "$1 $2" in "task show") cat "$STUB_JSON";; esac\nexit 0\n');
                chmodSync(stub, 0o755);
                const shell = shellOf(def, 'metrics-record', 0);
                const result = spawnSync('sh', ['-c', String(shell.options?.command ?? '')], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...process.env, __runId: 'r-esc', spurBin: stub, STUB_JSON: jsonFile },
                });
                expect(result.status).toBe(0);
                expect(readFileSync(join(cwd, '.spur/run/r-esc-wrapup-metrics.status'), 'utf8')).toContain('PASS');
                const row = JSON.parse(readFileSync(join(cwd, '.spur/memory/wrapup-metrics.jsonl'), 'utf8').trim());
                expect(row.feature_id).toBe('D"61\\x');
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
        test('feature-transition validates the sync result and writes a sync status', () => {
            const cmd = String(shellsOf(def, 'feature-transition')[0]?.options?.command ?? '');
            // 0783 R4: proposal-based classification, not a bare has("applied") probe.
            expect(cmd).toContain('.proposal.gateBlocked');
            expect(cmd).toContain('requiresConfirm');
            expect(cmd).toContain('wrapup-sync.status');
            expect(cmd).toContain('explicit no-change');
            expect(cmd).not.toContain('has("applied")');
        });

        test('0783 R4: an applied, verified sync passes', () => {
            const def2 = loadDef('wrapup-pipeline');
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-sync-ok-'));
            try {
                const env = stubSyncEnv(cwd, {
                    syncOut: syncResult({ featureId: 'D6', from: 'active', to: 'done', reason: 'wrap' }, true),
                    showStatus: 'done',
                });
                const result = runSyncShell(def2, cwd, { ...env, __runId: 's-ok', feature: 'D6' });
                expect(result.status).toBe(0);
                expect(result.stdout).toContain('feature gate PASS');
                expect(readFileSync(join(cwd, '.spur/run/s-ok-wrapup-sync.status'), 'utf8')).toContain('PASS');
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R4: a gate-blocked rc=0 sync is a failure, not a no-change success (F-04)', () => {
            const def2 = loadDef('wrapup-pipeline');
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-sync-blocked-'));
            try {
                const env = stubSyncEnv(cwd, {
                    syncOut: syncResult(
                        { featureId: 'D6', from: 'active', to: 'done', reason: 'L4 gate blocked', gateBlocked: true },
                        false,
                    ),
                    showStatus: 'active',
                });
                const result = runSyncShell(def2, cwd, { ...env, __runId: 's-blocked', feature: 'D6' });
                expect(result.status).toBe(0);
                expect(result.stderr).toContain('gate-blocked');
                expect(readFileSync(join(cwd, '.spur/run/s-blocked-wrapup-sync.status'), 'utf8')).toContain('FAIL');
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R4: confirmation-required and mismatched-proposal results fail explicitly', () => {
            const def2 = loadDef('wrapup-pipeline');
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-sync-mismatch-'));
            try {
                const confirm = runSyncShell(def2, cwd, {
                    ...stubSyncEnv(cwd, {
                        syncOut: syncResult(
                            { featureId: 'D6', from: 'active', to: 'done', reason: 'r', requiresConfirm: true },
                            false,
                        ),
                        showStatus: 'active',
                    }),
                    __runId: 's-confirm',
                    feature: 'D6',
                });
                expect(readFileSync(join(cwd, '.spur/run/s-confirm-wrapup-sync.status'), 'utf8')).toContain('FAIL');
                runSyncShell(def2, cwd, {
                    ...stubSyncEnv(cwd, {
                        syncOut: syncResult({ featureId: 'D99', from: 'active', to: 'done', reason: 'r' }, true),
                        showStatus: 'done',
                    }),
                    __runId: 's-mismatch',
                    feature: 'D6',
                });
                expect(readFileSync(join(cwd, '.spur/run/s-mismatch-wrapup-sync.status'), 'utf8')).toContain('FAIL');
                expect(confirm.stderr).toContain('confirmation');
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R4: a partial sync fails even when the affected-feature gate passes', () => {
            const def2 = loadDef('wrapup-pipeline');
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-sync-partial-'));
            try {
                const env = stubSyncEnv(cwd, {
                    syncOut: syncResult({ featureId: 'D6', from: 'active', to: 'done', reason: 'partial' }, true),
                    showStatus: 'active', // applied claimed done; observed status never reached the target
                    checkRc: 0, // gate PASS cannot convert a failed sync into success
                });
                const result = runSyncShell(def2, cwd, { ...env, __runId: 's-partial', feature: 'D6' });
                expect(result.status).toBe(0);
                expect(result.stderr).toContain('did not land on the proposal target');
                expect(readFileSync(join(cwd, '.spur/run/s-partial-wrapup-sync.status'), 'utf8')).toContain('FAIL');
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R4: applied:false is a successful explicit no-change only for from==to observed', () => {
            const def2 = loadDef('wrapup-pipeline');
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-sync-noop-'));
            try {
                const env = stubSyncEnv(cwd, {
                    syncOut: syncResult({ featureId: 'D6', from: 'done', to: 'done', reason: 'noop' }, false),
                    showStatus: 'done',
                });
                const result = runSyncShell(def2, cwd, { ...env, __runId: 's-noop', feature: 'D6' });
                expect(result.status).toBe(0);
                expect(result.stdout).toContain('explicit no-change');
                expect(readFileSync(join(cwd, '.spur/run/s-noop-wrapup-sync.status'), 'utf8')).toContain('PASS');
                // Same proposal shape but the observed status is not the target: failure.
                const env2 = stubSyncEnv(cwd, {
                    syncOut: syncResult({ featureId: 'D6', from: 'done', to: 'done', reason: 'noop' }, false),
                    showStatus: 'active',
                });
                runSyncShell(def2, cwd, { ...env2, __runId: 's-noop-bad', feature: 'D6' });
                expect(readFileSync(join(cwd, '.spur/run/s-noop-bad-wrapup-sync.status'), 'utf8')).toContain('FAIL');
            } finally {
                cleanup(cwd);
            }
        });

        test('0783 R4: malformed stdout (rc 0), a nonzero sync, and a failing gate all fail', () => {
            const def2 = loadDef('wrapup-pipeline');
            const cwd = mkdtempSync(join(tmpdir(), 'wrapup-0783-sync-bad-'));
            try {
                const malformed = runSyncShell(def2, cwd, {
                    ...stubSyncEnv(cwd, { syncOut: 'ok tuned (plain text)', showStatus: 'done' }),
                    __runId: 's-malformed',
                    feature: 'D6',
                });
                expect(readFileSync(join(cwd, '.spur/run/s-malformed-wrapup-sync.status'), 'utf8')).toContain('FAIL');
                const nonzero = runSyncShell(def2, cwd, {
                    ...stubSyncEnv(cwd, {
                        syncOut: '{"proposal":{"featureId":"D6","from":"active","to":"done"},"applied":true}',
                        syncRc: 3,
                        showStatus: 'done',
                    }),
                    __runId: 's-nonzero',
                    feature: 'D6',
                });
                expect(readFileSync(join(cwd, '.spur/run/s-nonzero-wrapup-sync.status'), 'utf8')).toContain('FAIL');
                runSyncShell(def2, cwd, {
                    ...stubSyncEnv(cwd, {
                        syncOut: syncResult({ featureId: 'D6', from: 'active', to: 'done', reason: 'r' }, true),
                        showStatus: 'done',
                        checkRc: 7,
                    }),
                    __runId: 's-gatefail',
                    feature: 'D6',
                });
                expect(readFileSync(join(cwd, '.spur/run/s-gatefail-wrapup-sync.status'), 'utf8')).toContain('FAIL');
                expect(malformed.stderr + nonzero.stderr).toContain('malformed or unreadable');
            } finally {
                cleanup(cwd);
            }
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
        for (const shell of shellsOf(def, 'task-resolve')) {
            const cmd = String(shell.options?.command ?? '');
            expect(cmd).toContain('REASON_FILE=".spur/run/$RUN_ID-route-reason.txt"');
            expect(cmd).not.toContain('.spur/run/wrapup-route-reason.txt');
            expect(cmd).not.toContain('RUN_ID="wrapup"');
        }
    });

    test('0783 R5: contradictory soft-success comments are gone; truthful routing stays', () => {
        const raw = readFileSync(join(WORKFLOWS_DIR, 'wrapup-pipeline.yaml'), 'utf8');
        expect(raw).not.toContain('never hard-fails');
        expect(raw).not.toContain('Genuinely soft');
        expect(raw).toContain('cannot convert a failed sync into');
    });

    test('every terminal state is reachable (closed table still holds with failed)', () => {
        const targets = new Set(def.transitions.map((t: TransitionDef) => t.to));
        for (const terminal of ['done', 'skipped', 'failed']) {
            expect(targets.has(terminal)).toBe(true);
        }
    });
});
