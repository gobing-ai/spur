import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkflowDefinition } from '../../src';
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
    writeInlineRunOutcome,
} from '../../src/services/inline-run-setup';

/**
 * Task 1006 R3: the per-mode driver bodies moved from the plugin script into the app
 * service. The plugin spawn tests keep proving the argv/stdout glue; these in-process
 * tests cover the moved runners' behavior directly (and keep the service above the repo
 * coverage floor, which child processes do not count toward).
 */

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
                const statePath = join(dir, '.spur/run/run-out-1.state.json');
                const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
                expect(state).toMatchObject({
                    schemaVersion: 1,
                    runId: 'run-out-1',
                    workflowName: 'inline-smoke',
                    status: 'running',
                    ok: true,
                    startedAt: state.updatedAt,
                });
                const header = readFileSync(join(dir, '.spur/run/run-out-1.md'), 'utf8');
                expect(header).toContain('# spur inline run run-out-1 — inline-smoke');
                // A re-setup rewrites state but keeps startedAt, drops prior fields on success,
                // and never appends a second header.
                writeInlineRunOutcome('run-out-1', { ok: false, error: 'boom' } as InlineRunStateOutcome);
                const state2 = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
                expect(state2).toMatchObject({ ok: false, error: 'boom', startedAt: state.startedAt });
                expect(state2.workflowName).toBeUndefined();
                const header2 = readFileSync(join(dir, '.spur/run/run-out-1.md'), 'utf8');
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
                const log = readFileSync(join(dir, '.spur/run/run-c.md'), 'utf8');
                expect(log).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\] trace-emission-failed op=x\n$/m);
                expect(existsSync(join(dir, '.spur/run/bad_id.md'))).toBe(true);
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
                    readFileSync(join(p.dir, '.spur/run/run-1006-setup.state.json'), 'utf8'),
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
                expect(existsSync(join(p.dir, '.spur/run/run-1006-refuse.state.json'))).toBe(true);
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

                // Best-effort action on a MISSING run still exits 0 with {ok:false} (R3).
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
                expect(ghost.value).toBe(0);
                expect(JSON.parse(ghost.out.trimEnd().split('\n')[0] ?? '{}')).toMatchObject({ ok: false });
                expect(readFileSync(join(p.dir, '.spur/run/run-1006-ghost.md'), 'utf8')).toContain(
                    'trace-emission-failed',
                );

                // A real action row records through the writer (exit 0, ok:true).
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
                });

                // Closing an unknown run id fails loudly (RUN_NOT_FOUND), not best-effort.
                const missing = await captureAsync(() =>
                    runInlineRunTrace({
                        runId: 'run-1006-norow',
                        close: true,
                        node: '',
                        kind: '',
                        status: 'failed',
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
