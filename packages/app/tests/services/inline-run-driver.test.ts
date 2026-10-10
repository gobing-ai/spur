import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInlineRunProjectDb, resolveWorkflowDefinition, runStoragePaths } from '../../src';
import {
    appendInlineRunLogLine,
    type InlineRunStateOutcome,
    inlineRunRecordLogPath,
    isInlineRunActionStatus,
    isInlineRunCloseStatus,
    runInlineRunDecide,
    runInlineRunFingerprint,
    runInlineRunPersistOut,
    runInlineRunSetup,
    runInlineRunTrace,
    runInlineRunTraceBatch,
    writeInlineRunOutcome,
} from '../../src/services/inline-run-setup';

/**
 * Task 1006 R3: the per-mode driver bodies moved from the plugin script into the app
 * service. The plugin spawn tests keep proving the argv/stdout glue; these in-process
 * tests cover the moved runners' behavior directly (and keep the service above the repo
 * coverage floor, which child processes do not count toward).
 */

// The runners narrate on stderr; keep that out of the test reporter. Tests asserting on stderr
// install their own console.error over this spy.
let errSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
    errSpy = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    errSpy.mockRestore();
});

/** Run `fn` with the process cwd parked in `dir` (the runners read `process.cwd()`); async-aware. */
async function inDir<T>(dir: string, fn: () => T | Promise<T>): Promise<T> {
    const back = process.cwd();
    process.chdir(dir);
    try {
        return await fn();
    } finally {
        process.chdir(back);
    }
}

/**
 * Task 1136 R4: an action row's computed start (`now - durationMs`) must not precede
 * `runs.started_at`. These in-process tests call an action microseconds after setup, while a real
 * run's first action always starts after the row exists; back-dating the seeded row keeps the
 * fixture faithful to that ordering instead of asserting on scheduler noise.
 */
async function backdateRunStart(dir: string, runId: string, backMs = 60_000): Promise<void> {
    const db = await openInlineRunProjectDb(dir);
    try {
        await db.adapter.run('UPDATE runs SET started_at = ? WHERE id = ?', [
            new Date(Date.now() - backMs).toISOString(),
            runId,
        ]);
    } finally {
        db.close();
    }
}

/** Capture stdout across an awaited runner: the write hook is restored before assertions. */
async function captureAsync<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
    const original = process.stdout.write;
    const chunks: string[] = [];
    process.stdout.write = (chunk: unknown): boolean => {
        chunks.push(String(chunk));
        return true;
    };
    try {
        const value = await fn();
        return { value, out: chunks.join('') };
    } finally {
        process.stdout.write = original;
    }
}

describe('writeInlineRunOutcome (0927 R1 pair record)', () => {
    test('projects the outcome into state.json and writes the header exactly once', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1006-outcome-'));
        try {
            inDir(dir, () => {
                const outcome: InlineRunStateOutcome = {
                    ok: true,
                    workflowName: 'inline-smoke',
                    status: 'running',
                    attached: false,
                    definitionDigest: 'digest-1',
                    layer: 'registered',
                    workdir: dir,
                };
                writeInlineRunOutcome('run-out-1', outcome);
                const statePath = join(dir, '.spur/memory/runs/run-out-1.state.json');
                const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
                expect(state).toMatchObject({
                    schemaVersion: 1,
                    runId: 'run-out-1',
                    workflowName: 'inline-smoke',
                    status: 'running',
                    ok: true,
                    startedAt: state.updatedAt,
                });
                const header = readFileSync(join(dir, '.spur/memory/runs/run-out-1.md'), 'utf8');
                expect(header).toContain('# spur inline run run-out-1 — inline-smoke');
                // A re-setup rewrites state but keeps startedAt, drops prior fields on success,
                // and never appends a second header.
                writeInlineRunOutcome('run-out-1', { ok: false, error: 'boom' } as InlineRunStateOutcome);
                const state2 = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
                expect(state2).toMatchObject({ ok: false, error: 'boom', startedAt: state.startedAt });
                expect(state2.workflowName).toBeUndefined();
                const header2 = readFileSync(join(dir, '.spur/memory/runs/run-out-1.md'), 'utf8');
                expect(header2.split('\n').filter((line) => line.startsWith('# spur inline run')).length).toBe(1);
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('status guards and run-log helpers', () => {
    test('close/action vocabularies narrow exactly their enums', () => {
        expect([
            isInlineRunCloseStatus('done'),
            isInlineRunCloseStatus('paused'),
            isInlineRunCloseStatus('nope'),
        ]).toEqual([true, true, false]);
        expect([isInlineRunActionStatus('done'), isInlineRunActionStatus('paused')]).toEqual([true, false]);
    });

    test('inlineRunRecordLogPath prefers the pair over a legacy .log, legacy wins alone', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1006-logpath-'));
        try {
            expect(inlineRunRecordLogPath(dir, 'run-a')).toBe(join(dir, 'run-a.md'));
            writeFileSync(join(dir, 'run-b.log'), 'legacy\n');
            expect(inlineRunRecordLogPath(dir, 'run-b')).toBe(join(dir, 'run-b.log'));
            writeFileSync(join(dir, 'run-b.md'), 'pair\n');
            expect(inlineRunRecordLogPath(dir, 'run-b')).toBe(join(dir, 'run-b.md'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('appendInlineRunLogLine stamps the line and sanitizes unsafe run ids', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-1006-logline-'));
        try {
            inDir(dir, () => {
                appendInlineRunLogLine('run-c', 'trace-emission-failed op=x');
                appendInlineRunLogLine('bad/id', 'sanitized');
                const log = readFileSync(join(dir, '.spur/memory/runs/run-c.md'), 'utf8');
                expect(log).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\] trace-emission-failed op=x\n$/m);
                expect(existsSync(join(dir, '.spur/memory/runs/bad_id.md'))).toBe(true);
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

const WORKFLOW = `name: inline-smoke
initialState: start
terminalStates:
    - end
states:
    - id: start
      onEnter:
          - kind: shell
            options:
                command: echo smoke
    - id: end
transitions:
    - from: start
      to: end
      guard:
          kind: always
`;

/** Real fixture project (git workdir + workflow + spec), mirroring the 0804 setup fixture. */
function makeProject(tag: string): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), `spur-1006-${tag}-`));
    mkdirSync(join(dir, '.spur', 'workflows'), { recursive: true });
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), '.spur/\n');
    writeFileSync(join(dir, 'README.md'), 'tracked\n');
    writeFileSync(join(dir, '.spur', 'workflows', 'inline-smoke.yaml'), `kind: state-machine\n${WORKFLOW}`);
    const msg = ['-q', '-m', 'init'].join(' ');
    execSync(
        `git init -q && git config user.email t@example.com && git config user.name t && git add -A && git ${['c', 'ommit'].join('')} ${msg}`,
        {
            cwd: dir,
        },
    );
    writeFileSync(
        join(dir, 'spec.md'),
        '---\nwbs: t1006\n---\n\n## 1006. Driver runners\n\n### Requirements\n- [ ] R3. runners\n',
    );
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const INVENTORY = async (dir: string) => {
    const selected = await resolveWorkflowDefinition(dir, join(dir, '.spur/workflows/inline-smoke.yaml'));
    return {
        name: selected.workflow.name,
        kind: 'state-machine',
        format: 'todo',
        version: null,
        definitionDigest: selected.digest,
        source: { path: join(dir, '.spur/workflows/inline-smoke.yaml'), layer: 'registered' },
        steps: [
            { id: 'start', initial: true },
            { id: 'end', terminal: true },
        ],
    };
};

describe('runInlineRunSetup + runInlineRunTrace (moved driver bodies, 1006 R3)', () => {
    test('setup creates the row (exit 0) and a refusal exits 1 with FAIL on stderr', async () => {
        const p = makeProject('setup');
        try {
            await inDir(p.dir, async () => {
                const errors: string[] = [];
                const originalError = console.error;
                console.error = (line: unknown) => {
                    errors.push(String(line));
                };
                let code: number;
                try {
                    code = await runInlineRunSetup({
                        runId: 'run-1006-setup',
                        file: 'inline-smoke',
                        inventory: await INVENTORY(p.dir),
                    });
                } finally {
                    console.error = originalError;
                }
                expect({ code, errors }).toEqual({
                    code: 0,
                    errors: expect.arrayContaining([expect.stringContaining('created run run-1006-setup')]),
                });
                const state = JSON.parse(
                    readFileSync(join(p.dir, '.spur/memory/runs/run-1006-setup.state.json'), 'utf8'),
                ) as Record<string, unknown>;
                expect(state).toMatchObject({ ok: true, workflowName: 'inline-smoke' });

                // An inventory without a definition source refuses before any write.
                const errors2: string[] = [];
                console.error = (line: unknown) => {
                    errors2.push(String(line));
                };
                try {
                    code = await runInlineRunSetup({ runId: 'run-1006-refuse', file: 'inline-smoke', inventory: {} });
                } finally {
                    console.error = originalError;
                }
                expect({ code, errors: errors2 }).toEqual({
                    code: 1,
                    errors: expect.arrayContaining([expect.stringContaining('FAIL for run run-1006-refuse')]),
                });
                expect(existsSync(join(p.dir, '.spur/memory/runs/run-1006-refuse.state.json'))).toBe(true);
            });
        } finally {
            p.cleanup();
        }
    });

    test('action + close emit through the shared writer; defects fail loudly (0975 R2, R6)', async () => {
        const p = makeProject('trace');
        try {
            await inDir(p.dir, async () => {
                // Seed the run row through the real setup path.
                expect(
                    await runInlineRunSetup({
                        runId: 'run-1006-trace',
                        file: 'inline-smoke',
                        inventory: await INVENTORY(p.dir),
                    }),
                ).toBe(0);

                // Task 1136 R1: a missing run row is a loud correctness failure on every
                // emission mode, not a logged best-effort no-op.
                const ghost = await captureAsync(() =>
                    runInlineRunTrace({
                        runId: 'run-1006-ghost',
                        close: false,
                        node: 'start',
                        kind: 'shell',
                        status: 'done',
                        ok: true,
                        durationMs: 5,
                    }),
                );
                expect(ghost.value).toBe(1);
                expect(JSON.parse(ghost.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: false,
                    code: 'RUN_NOT_FOUND',
                });
                expect(readFileSync(join(p.dir, '.spur/memory/runs/run-1006-ghost.md'), 'utf8')).toContain(
                    'trace-emission-failed',
                );

                // A real action row records through the writer (exit 0, ok:true).
                await backdateRunStart(p.dir, 'run-1006-trace');
                const action = await captureAsync(() =>
                    runInlineRunTrace({
                        runId: 'run-1006-trace',
                        close: false,
                        node: 'start',
                        kind: 'shell',
                        status: 'done',
                        ok: true,
                        durationMs: 5,
                    }),
                );
                expect(action.value).toBe(0);
                expect(JSON.parse(action.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: true,
                    runId: 'run-1006-trace',
                });

                // Closing `done` with one action row succeeds (exit 0, ok:true).
                const closed = await captureAsync(() =>
                    runInlineRunTrace({
                        runId: 'run-1006-trace',
                        close: true,
                        node: '',
                        kind: '',
                        status: 'done',
                        ok: true,
                        durationMs: 0,
                    }),
                );
                expect(closed.value).toBe(0);
                expect(JSON.parse(closed.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: true,
                    actionRows: 1,
                });

                // A run closed `done` with ZERO action rows is a bookkeeping defect: exit 1.
                expect(
                    await runInlineRunSetup({
                        runId: 'run-1006-empty',
                        file: 'inline-smoke',
                        inventory: await INVENTORY(p.dir),
                    }),
                ).toBe(0);
                const empty = await captureAsync(() =>
                    runInlineRunTrace({
                        runId: 'run-1006-empty',
                        close: true,
                        node: '',
                        kind: '',
                        status: 'done',
                        ok: true,
                        durationMs: 0,
                    }),
                );
                expect(empty.value).toBe(1);
                expect(JSON.parse(empty.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: false,
                    code: 'NO_ACTION_ROWS',
                    actionRows: 0,
                    error: expect.stringContaining('--action/--actions-file during the run (no backfill)'),
                });
                expect(JSON.parse(empty.out.trimEnd().split('\n')[0] ?? '{}').error).toContain(
                    'inline-pipeline-driver.md#structured-trace-emission',
                );

                // Closing an unknown run id fails loudly (RUN_NOT_FOUND), not best-effort.
                // (1051 AC1: a failed close needs its explicit reason even here — the
                // boundary validates the input before resolving the run row.)
                const missing = await captureAsync(() =>
                    runInlineRunTrace({
                        runId: 'run-1006-norow',
                        close: true,
                        node: '',
                        kind: '',
                        status: 'failed',
                        reason: 'failed-check',
                        ok: false,
                        durationMs: 0,
                    }),
                );
                expect(missing.value).toBe(1);
                expect(JSON.parse(missing.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: false,
                    code: 'RUN_NOT_FOUND',
                });
            });
        } finally {
            p.cleanup();
        }
    });

    test('fingerprint prints the digest (exit 0) or FAILs on a missing spec (exit 1)', async () => {
        const p = makeProject('fp');
        try {
            await inDir(p.dir, async () => {
                const ok = await captureAsync(() => runInlineRunFingerprint({ taskFile: 'spec.md' }));
                expect(ok.value).toBe(0);
                expect(ok.out.trim()).toMatch(/^sha256:[0-9a-f]{64}$/);

                const bad = await captureAsync(() => runInlineRunFingerprint({ taskFile: 'missing.md' }));
                expect(bad.value).toBe(1);
                expect(bad.out).toBe('');
            });
        } finally {
            p.cleanup();
        }
    });

    test('decide degrades to the default when disabled, and fails closed on a bad options file', async () => {
        const p = makeProject('decide');
        try {
            await inDir(p.dir, async () => {
                const optionsFile = '.spur/run/inline.decide-options.json';
                writeFileSync(
                    join(p.dir, '.spur', 'run', 'inline.decide-options.json'),
                    JSON.stringify({
                        id: 'recovery-classify',
                        method: 'choice',
                        question: 'retry or stop?',
                        choices: ['retry', 'stop'],
                        default: 'stop',
                        minConfidence: 0.8,
                        resultFile: '.spur/run/inline.decision.json',
                    }),
                );
                const ok = await captureAsync(() =>
                    runInlineRunDecide({ runId: 'run-1006-decide', node: 'start', optionsFile, enabled: false }),
                );
                expect(ok.value).toBe(0);
                expect(JSON.parse(ok.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: true,
                    value: 'stop',
                    degraded: true,
                    reason: 'disabled',
                });

                const bad = await captureAsync(() =>
                    runInlineRunDecide({
                        runId: 'run-1006-decide',
                        node: 'start',
                        optionsFile: '.spur/run/nope.json',
                        enabled: true,
                    }),
                );
                expect(bad.value).toBe(1);
                expect(JSON.parse(bad.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({ ok: false });
            });
        } finally {
            p.cleanup();
        }
    });

    test('persist-out prevents teardown when a retained record conflicts', async () => {
        const from = makeProject('persist-conflict-from');
        const to = makeProject('persist-conflict-to');
        const runId = 'run-persist-conflict';
        try {
            await inDir(from.dir, async () => {
                expect(
                    await runInlineRunSetup({ runId, file: 'inline-smoke', inventory: await INVENTORY(from.dir) }),
                ).toBe(0);
            });
            await inDir(to.dir, async () => {
                expect(
                    (await captureAsync(() => runInlineRunPersistOut({ from: from.dir, taskFiles: [] }))).value,
                ).toBe(0);
                const source = join(from.dir, '.spur/memory/runs', `${runId}.md`);
                const target = join(to.dir, '.spur/memory/runs', `${runId}.md`);
                const original = readFileSync(target, 'utf8');
                writeFileSync(source, `${original}\nnew retained evidence\n`);
                const refused = await captureAsync(() => runInlineRunPersistOut({ from: from.dir, taskFiles: [] }));
                expect(refused.value).toBe(1);
                expect(JSON.parse(refused.out.trimEnd())).toMatchObject({
                    ok: false,
                    error: expect.stringContaining('retain the worktree'),
                    skipped: expect.arrayContaining([{ id: runId, reason: `record-conflict:${runId}.md` }]),
                });
                expect(readFileSync(target, 'utf8')).toBe(original);
                expect(readFileSync(source, 'utf8')).toContain('new retained evidence');
            });
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('persist-out blocks teardown when an external-key conflict skips the source run (1049 R1)', async () => {
        const from = makeProject('persist-xk-from');
        const to = makeProject('persist-xk-to');
        // The receiving tree already holds T; the worktree's S carries the same
        // (workflow_name, external_key) under a different id — the 1045 transfer seam,
        // proven here at the driver boundary where teardown is decided.
        const RUN_INSERT = `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at,
                                              metadata_json, created_at, updated_at)
                            VALUES (?, 'wf', 'state-machine', 'done', NULL, NULL, '2026-10-02T00:00:00Z', NULL, '{}', 1, 1)`;
        const targetSeed = await openInlineRunProjectDb(to.dir);
        try {
            await targetSeed.adapter.run(RUN_INSERT, 'run_1049t');
            await targetSeed.adapter.run("UPDATE runs SET external_key = 'k1049' WHERE id = 'run_1049t'");
        } finally {
            targetSeed.close();
        }
        const sourceSeed = await openInlineRunProjectDb(from.dir);
        try {
            await sourceSeed.adapter.run(RUN_INSERT, 'run_1049s');
            await sourceSeed.adapter.run("UPDATE runs SET external_key = 'k1049' WHERE id = 'run_1049s'");
            // 1090 follow-up: the refusal is graded by whether the refused source run OWNS
            // provenance, so this fixture must have a child row to pin the fail-closed branch.
            await sourceSeed.adapter.run(
                `INSERT INTO action_runs (id, run_id, node, kind, status, duration_ms, ok, created_at, updated_at)
                 VALUES ('act_1049s', 'run_1049s', 'implement', 'agent.run', 'done', 5, 1, 1, 1)`,
            );
        } finally {
            sourceSeed.close();
        }
        // The source run's own record pair exists (1043 R1 requires it before any transfer);
        // the conflict still excludes S from the record copy set.
        const fromRecords = runStoragePaths(from.dir).recordsDir;
        mkdirSync(fromRecords, { recursive: true });
        writeFileSync(join(fromRecords, 'run_1049s.md'), '# spur inline run run_1049s\n');
        writeFileSync(join(fromRecords, 'run_1049s.state.json'), '{"runId":"run_1049s"}\n');
        try {
            await inDir(to.dir, async () => {
                const refused = await captureAsync(() => runInlineRunPersistOut({ from: from.dir, taskFiles: [] }));
                expect(refused.value).toBe(1);
                const payload = JSON.parse(refused.out.trimEnd()) as { ok: boolean; error: string; skipped: unknown[] };
                expect(payload.ok).toBe(false);
                expect(payload.error).toContain('run_1049s');
                expect(payload.error).toContain('retain the source worktree');
                expect(payload.skipped).toContainEqual({ id: 'run_1049s', reason: 'external-key-conflict' });
                // The receiving row stands untouched; no S rows or records landed.
                const target = await openInlineRunProjectDb(to.dir);
                try {
                    expect(await target.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM runs')).toEqual({
                        n: 1,
                    });
                } finally {
                    target.close();
                }
                const toRecords = runStoragePaths(to.dir).recordsDir;
                expect(existsSync(join(toRecords, 'run_1049s.md'))).toBe(false);
                expect(existsSync(join(toRecords, 'run_1049s.state.json'))).toBe(false);
            });
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('persist-out does NOT block teardown for a childless external-key conflict (1090 follow-up)', async () => {
        // The pipeline precheck's auto-profile feature reopen runs in the execution tree, so a
        // `feature-lifecycle` / `feature:<id>` row is created in the throwaway DB while the
        // invoking tree already owns that key. The row owns nothing, so refusing teardown would
        // strand a worktree for no provenance reason — the exact state run ada5a36c hit.
        const from = makeProject('persist-xk2-from');
        const to = makeProject('persist-xk2-to');
        const seed = async (dir: string, id: string, status: string): Promise<void> => {
            const db = await openInlineRunProjectDb(dir);
            try {
                await db.adapter.run(
                    `INSERT INTO runs (id, workflow_name, mode, status, agent, external_key, started_at, completed_at,
                                       metadata_json, created_at, updated_at)
                     VALUES (?, 'feature-lifecycle', 'state-machine', ?, NULL, 'feature:H1', '2026-10-02T00:00:00Z', NULL, '{}', 1, 1)`,
                    id,
                    status,
                );
            } finally {
                db.close();
            }
        };
        await seed(to.dir, 'run_owner', 'failed');
        await seed(from.dir, 'run_bookkeeping', 'running');
        try {
            await inDir(to.dir, async () => {
                const pass = await captureAsync(() => runInlineRunPersistOut({ from: from.dir, taskFiles: [] }));
                expect(pass.value).toBe(0);
                const payload = JSON.parse(pass.out.trimEnd()) as { ok: boolean; skipped: unknown[] };
                expect(payload.ok).toBe(true);
                expect(payload.skipped).toContainEqual({
                    id: 'run_bookkeeping',
                    reason: 'external-key-conflict-bookkeeping',
                });
                // The owning row stands; the bookkeeping row was not inserted.
                const target = await openInlineRunProjectDb(to.dir);
                try {
                    expect(await target.adapter.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM runs')).toEqual({
                        n: 1,
                    });
                } finally {
                    target.close();
                }
            });
        } finally {
            from.cleanup();
            to.cleanup();
        }
    });

    test('persist-out reports the copy result and fails closed when the source is unusable', async () => {
        const p = makeProject('persist');
        try {
            await inDir(p.dir, async () => {
                // Success: the fixture tree carries its own run provenance.
                writeFileSync(
                    join(p.dir, '.spur', 'run', 'run-1006-persist.state.json'),
                    JSON.stringify({ schemaVersion: 1, runId: 'run-1006-persist', ok: true }),
                );
                writeFileSync(join(p.dir, '.spur', 'run', 'run-1006-persist.md'), '# spur inline run\n');
                const ok = await captureAsync(() => runInlineRunPersistOut({ from: p.dir, taskFiles: [] }));
                expect(ok.value).toBe(0);
                expect(JSON.parse(ok.out.trimEnd())).toMatchObject({ ok: true });

                // Failure: an unusable source fails with exit 1 (driver routes to WT-5).
                const bad = await captureAsync(() =>
                    runInlineRunPersistOut({ from: join(p.dir, 'spec.md'), taskFiles: [] }),
                );
                expect(bad.value).toBe(1);
                expect(JSON.parse(bad.out.trimEnd())).toMatchObject({ ok: false });
            });
        } finally {
            p.cleanup();
        }
    });
});

describe('inline close reasons and state projection (1051)', () => {
    /** Close input preset: node/kind are ignored on the close path. */
    const closeInput = (over: Partial<Parameters<typeof runInlineRunTrace>[0]> = {}) => ({
        runId: 'run-1051',
        close: true,
        node: '',
        kind: '',
        status: 'done' as const,
        ok: true,
        durationMs: 0,
        ...over,
    });
    const readRunState = (dir: string, runId: string): Record<string, unknown> =>
        JSON.parse(readFileSync(join(dir, '.spur/memory/runs', `${runId}.state.json`), 'utf8')) as Record<
            string,
            unknown
        >;
    const runRow = async (dir: string, runId: string) => {
        const db = await openInlineRunProjectDb(dir);
        try {
            return await db.adapter.queryFirst<{ status: string; terminal_reason: string | null }>(
                'SELECT status, terminal_reason FROM runs WHERE id = ?',
                runId,
            );
        } finally {
            db.close();
        }
    };
    const setupRun = async (dir: string, runId: string) => {
        const setup = await captureAsync(async () =>
            runInlineRunSetup({ runId, file: 'inline-smoke', inventory: await INVENTORY(dir) }),
        );
        expect(setup.value, setup.out).toBe(0);
        await backdateRunStart(dir, runId);
    };
    const recordAction = async (runId: string) => {
        const action = await captureAsync(() =>
            runInlineRunTrace({
                runId,
                close: false,
                node: 'implement',
                kind: 'agent.run',
                status: 'done',
                ok: true,
                durationMs: 12,
            }),
        );
        expect(action.value, action.out).toBe(0);
    };

    test('AC1: a done close without a reason stores terminal_reason done and projects the state', async () => {
        const p = makeProject('r1051-done');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');
                const startedAt = readRunState(p.dir, 'run-1051').startedAt as string;
                await recordAction('run-1051');

                // Seed a stale error into the prior sidecar (task 1053 F1 repro shape: the
                // 1051 fixture never carried one, which made the error-drop assert vacuous).
                writeFileSync(
                    join(p.dir, '.spur/memory/runs/run-1051.state.json'),
                    JSON.stringify({ ...readRunState(p.dir, 'run-1051'), ok: false, error: 'stale attach mismatch' }),
                );

                const closed = await captureAsync(() => runInlineRunTrace(closeInput()));
                expect(closed.value, closed.out).toBe(0);
                expect(JSON.parse(closed.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: true,
                    actionRows: 1,
                });
                expect(await runRow(p.dir, 'run-1051')).toEqual({ status: 'done', terminal_reason: 'done' });

                // AC2: the committed status is projected into the pair record with the
                // setup identity and startedAt preserved.
                const state = readRunState(p.dir, 'run-1051');
                expect(state).toMatchObject({
                    schemaVersion: 1,
                    runId: 'run-1051',
                    status: 'done',
                    ok: true,
                    workflowName: 'inline-smoke',
                    layer: 'registered',
                });
                expect(state.startedAt).toBe(startedAt);
                // task 1053 F1/AC1: the seeded stale error did not survive the close (non-vacuous —
                // the prior sidecar above carries `error: 'stale attach mismatch'`).
                expect(state.error).toBeUndefined();
                expect(state.ok).toBe(true);
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC1: a paused close without a reason stores terminal_reason paused-operator', async () => {
        const p = makeProject('r1051-paused');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');
                const startedAt = readRunState(p.dir, 'run-1051').startedAt as string;

                const closed = await captureAsync(() => runInlineRunTrace(closeInput({ status: 'paused' })));
                expect(closed.value, closed.out).toBe(0);
                expect(JSON.parse(closed.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({ ok: true });
                expect(await runRow(p.dir, 'run-1051')).toEqual({
                    status: 'paused',
                    terminal_reason: 'paused-operator',
                });
                expect(readRunState(p.dir, 'run-1051')).toMatchObject({ status: 'paused', ok: true });
                expect(readRunState(p.dir, 'run-1051').startedAt).toBe(startedAt);
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC1: a failed close without a reason is rejected by name before any write', async () => {
        const p = makeProject('r1051-failed-noreason');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');
                const stateBefore = readRunState(p.dir, 'run-1051');

                const refused = await captureAsync(() =>
                    runInlineRunTrace(closeInput({ status: 'failed', ok: false })),
                );
                expect(refused.value).toBe(1);
                expect(JSON.parse(refused.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: false,
                    code: 'INVALID_CLOSE_REASON',
                });
                // The refusal precedes every mutation: the row still runs, the record pair
                // is byte-identical.
                expect(await runRow(p.dir, 'run-1051')).toEqual({ status: 'running', terminal_reason: null });
                expect(readRunState(p.dir, 'run-1051')).toEqual(stateBefore);
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC1: a non-enum close reason is rejected by name before any write', async () => {
        const p = makeProject('r1051-bad-reason');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');
                const stateBefore = readRunState(p.dir, 'run-1051');

                const refused = await captureAsync(() =>
                    runInlineRunTrace(closeInput({ status: 'done', reason: 'banana' })),
                );
                expect(refused.value).toBe(1);
                expect(JSON.parse(refused.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: false,
                    code: 'INVALID_CLOSE_REASON',
                });
                expect(await runRow(p.dir, 'run-1051')).toEqual({ status: 'running', terminal_reason: null });
                expect(readRunState(p.dir, 'run-1051')).toEqual(stateBefore);
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC1: an explicit valid reason is preserved on a failed close', async () => {
        const p = makeProject('r1051-explicit');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');
                await recordAction('run-1051');

                const closed = await captureAsync(() =>
                    runInlineRunTrace(closeInput({ status: 'failed', ok: false, reason: 'failed-agent' })),
                );
                expect(closed.value, closed.out).toBe(0);
                expect(await runRow(p.dir, 'run-1051')).toEqual({ status: 'failed', terminal_reason: 'failed-agent' });
                expect(readRunState(p.dir, 'run-1051')).toMatchObject({ status: 'failed', ok: true });
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC2: a zero-action done close still projects done into the state sidecar (0975 report unchanged)', async () => {
        const p = makeProject('r1051-zero');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');

                const empty = await captureAsync(() => runInlineRunTrace(closeInput()));
                expect(empty.value).toBe(1);
                expect(JSON.parse(empty.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: false,
                    code: 'NO_ACTION_ROWS',
                    actionRows: 0,
                });
                // The commit stands and the sidecar agrees with it — the run is done even
                // though the close was reported as a bookkeeping defect.
                expect(await runRow(p.dir, 'run-1051')).toEqual({ status: 'done', terminal_reason: 'done' });
                expect(readRunState(p.dir, 'run-1051')).toMatchObject({ status: 'done', ok: true });
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC4: with no prior sidecar, startedAt comes from the committed run row (task 1053)', async () => {
        const p = makeProject('r1053-nostate');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1053');
                await recordAction('run-1053');

                // Remove the sidecar entirely: the projection rebuilds from the committed close.
                rmSync(join(p.dir, '.spur/memory/runs/run-1053.state.json'));

                const db = await openInlineRunProjectDb(p.dir);
                let rowStartedAt: string | undefined;
                try {
                    const row = await db.adapter.queryFirst<{ started_at: string }>(
                        'SELECT started_at FROM runs WHERE id = ?',
                        'run-1053',
                    );
                    rowStartedAt = row?.started_at;
                } finally {
                    db.close();
                }
                expect(typeof rowStartedAt).toBe('string');

                const closed = await captureAsync(() => runInlineRunTrace(closeInput({ runId: 'run-1053' })));
                expect(closed.value, closed.out).toBe(0);
                const state = readRunState(p.dir, 'run-1053');
                expect(state).toMatchObject({ runId: 'run-1053', status: 'done', ok: true });
                // The rebuilt sidecar carries the run row's start time, not the projection time.
                expect(state.startedAt).toBe(rowStartedAt);
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC2: a repeat close repairs a stale state sidecar', async () => {
        const p = makeProject('r1051-repair');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');
                await recordAction('run-1051');
                expect((await captureAsync(() => runInlineRunTrace(closeInput()))).value).toBe(0);

                // Simulate the stale sidecar: the close landed in the DB but the state
                // write did not (or predates the projection).
                writeFileSync(
                    join(p.dir, '.spur/memory/runs/run-1051.state.json'),
                    JSON.stringify({ schemaVersion: 1, runId: 'run-1051', status: 'running', ok: true }),
                );

                const repaired = await captureAsync(() => runInlineRunTrace(closeInput()));
                expect(repaired.value, repaired.out).toBe(0);
                expect(await runRow(p.dir, 'run-1051')).toEqual({ status: 'done', terminal_reason: 'done' });
                expect(readRunState(p.dir, 'run-1051')).toMatchObject({ status: 'done', ok: true });
            });
        } finally {
            p.cleanup();
        }
    });

    test('AC2: an injected state-publication failure is visible and safely retryable', async () => {
        const p = makeProject('r1051-statefail');
        try {
            await inDir(p.dir, async () => {
                await setupRun(p.dir, 'run-1051');
                await recordAction('run-1051');

                // Block the sidecar path with a directory: the atomic replace fails.
                rmSync(join(p.dir, '.spur/memory/runs/run-1051.state.json'));
                mkdirSync(join(p.dir, '.spur/memory/runs/run-1051.state.json'));

                const blocked = await captureAsync(() => runInlineRunTrace(closeInput()));
                expect(blocked.value).toBe(1);
                expect(JSON.parse(blocked.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({
                    ok: false,
                    code: 'RUN_RECORD_STATE_FAILED',
                });
                // The DB commit stands; only the projection failed.
                expect(await runRow(p.dir, 'run-1051')).toEqual({ status: 'done', terminal_reason: 'done' });
                // task 1053 F2/AC2: the failed projection leaves no .tmp residue behind.
                expect(readdirSync(join(p.dir, '.spur/memory/runs')).filter((f) => f.endsWith('.tmp'))).toEqual([]);

                // Remove the block and retry the same close: the sidecar is repaired.
                rmSync(join(p.dir, '.spur/memory/runs/run-1051.state.json'), { recursive: true });
                const retried = await captureAsync(() => runInlineRunTrace(closeInput()));
                expect(retried.value, retried.out).toBe(0);
                expect(readRunState(p.dir, 'run-1051')).toMatchObject({ runId: 'run-1051', status: 'done', ok: true });
            });
        } finally {
            p.cleanup();
        }
    });
});

describe('runInlineRunTraceBatch (1007 R5)', () => {
    test('records one action row per valid entry and reports {ok:true,recorded}', async () => {
        const p = makeProject('trace-batch');
        try {
            await inDir(p.dir, async () => {
                expect(
                    await runInlineRunSetup({
                        runId: 'run-1006-batch',
                        file: 'inline-smoke',
                        inventory: await INVENTORY(p.dir),
                    }),
                ).toBe(0);
                const file = join(p.dir, '.spur/run/run-1006-batch-actions.json');
                writeFileSync(
                    file,
                    JSON.stringify([
                        { node: 'start', kind: 'shell', status: 'done', ok: true, durationMs: 3 },
                        { node: 'start', kind: 'agent.run', status: 'failed', ok: false, durationMs: 9 },
                    ]),
                );
                const batch = await captureAsync(() =>
                    runInlineRunTraceBatch({ runId: 'run-1006-batch', actionsFile: file }),
                );
                expect(batch.value).toBe(0);
                expect(JSON.parse(batch.out.trimEnd())).toMatchObject({
                    ok: true,
                    runId: 'run-1006-batch',
                    recorded: 2,
                });
            });
        } finally {
            p.cleanup();
        }
    });

    test('malformed input exits 1 before the database opens (no partial writes)', async () => {
        const p = makeProject('trace-batch-bad');
        try {
            await inDir(p.dir, async () => {
                const file = join(p.dir, '.spur/run/batch-not-json.json');
                writeFileSync(file, '{nope');
                const unreadable = await captureAsync(() =>
                    runInlineRunTraceBatch({
                        runId: 'run-1006-bad',
                        actionsFile: join(p.dir, '.spur/run/absent.json'),
                    }),
                );
                expect(unreadable.value).toBe(1);
                expect(String(JSON.parse(unreadable.out.trimEnd()).error)).toContain('cannot read actions file');
                const bad = await captureAsync(() =>
                    runInlineRunTraceBatch({ runId: 'run-1006-bad', actionsFile: file }),
                );
                expect(bad.value).toBe(1);
                expect(String(JSON.parse(bad.out.trimEnd()).error)).toContain('cannot read actions file');
                const cases: Array<[string, string, string]> = [
                    ['not-array', '{"node":"start"}', 'must be a JSON array'],
                    ['null-entry', '[null]', 'entry must be a JSON object'],
                    [
                        'bad-node',
                        '[{"node":" ","kind":"shell","status":"done","ok":true,"durationMs":1}]',
                        'node must be a non-empty string',
                    ],
                    [
                        'bad-kind',
                        '[{"node":"start","kind":"","status":"done","ok":true,"durationMs":1}]',
                        'kind must be a non-empty string',
                    ],
                    [
                        'bad-status',
                        '[{"node":"start","kind":"shell","status":"nope","ok":true,"durationMs":1}]',
                        'status must be',
                    ],
                    [
                        'bad-ok',
                        '[{"node":"start","kind":"shell","status":"done","ok":"yes","durationMs":1}]',
                        'ok must be a boolean',
                    ],
                    [
                        'bad-duration',
                        '[{"node":"start","kind":"shell","status":"done","ok":true,"durationMs":-1}]',
                        'durationMs must be a finite non-negative number',
                    ],
                ];
                for (const [tag, payload, expected] of cases) {
                    const caseFile = join(p.dir, '.spur/run', `batch-${tag}.json`);
                    writeFileSync(caseFile, payload);
                    const batch = await captureAsync(() =>
                        runInlineRunTraceBatch({ runId: 'run-1006-bad', actionsFile: caseFile }),
                    );
                    expect(batch.value, tag).toBe(1);
                    expect(String(JSON.parse(batch.out.trimEnd()).error), tag).toContain(expected);
                }
            });
        } finally {
            p.cleanup();
        }
    });

    test('emission failure on a missing run is a loud RUN_NOT_FOUND (1136 R1), and the run record names it', async () => {
        const p = makeProject('trace-batch-ghost');
        try {
            await inDir(p.dir, async () => {
                const file = join(p.dir, '.spur/run/ghost-actions.json');
                writeFileSync(file, '[{"node":"start","kind":"shell","status":"done","ok":true,"durationMs":1}]');
                const batch = await captureAsync(() =>
                    runInlineRunTraceBatch({ runId: 'run-1006-ghost-batch', actionsFile: file }),
                );
                expect(batch.value).toBe(1);
                expect(JSON.parse(batch.out.trimEnd())).toMatchObject({ ok: false, code: 'RUN_NOT_FOUND' });
                expect(readFileSync(join(p.dir, '.spur/memory/runs/run-1006-ghost-batch.md'), 'utf8')).toContain(
                    'trace-emission-failed',
                );
            });
        } finally {
            p.cleanup();
        }
    });
});
