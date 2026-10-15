import { expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test here spawns one or more `bun` processes; at bun's default `--max-concurrency=20` the
// file's 22 `test.concurrent` cases oversubscribe the host, so the multi-spawn cases can outrun the
// 5 s default timeout (they pass under the gate's lower concurrency). Raise the file's budget rather
// than serializing the file, which would make it one of the slowest in the gate again.
setDefaultTimeout(30_000);

/**
 * Task 0804 R8/P2 (SECUA): the inline run setup delegate writes the two-file run record
 * (`.spur/run/<run-id>.state.json` + `.spur/run/<run-id>.md`, task 0927), so `--run-id` must be
 * validated as a single safe filename component BEFORE any outcome write — the same refusal
 * class the task-pipeline route-reason shell action applies to `$__runId` (task 0804 R8):
 * path separators, dot traversal and unresolved interpolation exit nonzero without an artifact.
 */

// Script-absorption PR-4: the plugin script became `spur workflow inline <op>`. This suite kept its
// legacy-argv bodies; the shim translates them (tests/workflow-inline/legacy-argv.ts) and runs the
// real CLI entry, so every case now exercises the installed transport.
const SCRIPT = join(import.meta.dir, '..', '..', 'workflow-inline', 'legacy-inline-shim.ts');

/**
 * Async stand-in for `await spawnAsync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' })` so the
 * file's tests can run as `test.concurrent`: each test owns its temp tree, and the ~0.4 s
 * per-spawn bundle load made the serial file one of the slowest in the gate.
 */
async function spawnAsync(
    cmd: string,
    args: readonly string[],
    options: { cwd?: string; stdio?: 'pipe'; encoding?: 'utf8' } = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
    const proc = Bun.spawn([cmd, ...args], { cwd: options.cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, status] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { status, stdout, stderr };
}

test.concurrent('an unsafe run id refuses with exit 1 and writes no outcome artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-guard-'));
    try {
        for (const unsafeId of ['../evil', 'a/b', '$(id)', 'run..../../escape', '..']) {
            const proc = await spawnAsync('bun', [SCRIPT, '--run-id', unsafeId, '--file', 'whatever'], {
                cwd: dir,
                stdio: 'pipe',
                encoding: 'utf8',
            });
            expect(proc.status, `expected refusal for ${unsafeId}`).toBe(1);
            expect(proc.stderr, `expected actionable refusal for ${unsafeId}`).toContain('refusing unsafe run id');

            // The guard fires before any file work: no `.spur` tree (and therefore no
            // `.spur/run/<id>.state.json` / `<id>.md`, at the traversal target either).
            expect(existsSync(join(dir, '.spur')), `no artifact for ${unsafeId}`).toBe(false);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test.concurrent('a valid run id passes the guard and reaches the normal fail-closed path (no false refusal)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-guard-valid-'));
    try {
        const runId = '0804-run-setup-guard-valid';
        const proc = await spawnAsync('bun', [SCRIPT, '--run-id', runId, '--file', 'no-such-workflow'], {
            cwd: dir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        // The definition cannot resolve, so the run still fails closed — but through the
        // resolver, not the run-id guard.
        expect(proc.status).toBe(1);
        expect(proc.stderr).not.toContain('refusing unsafe run id');
        expect(proc.stderr).toContain('could not resolve the workflow definition');
        const state = JSON.parse(readFileSync(join(dir, '.spur', 'memory', 'runs', `${runId}.state.json`), 'utf8')) as {
            runId: string;
            error?: string;
        };
        expect(state.runId).toBe(runId);
        expect(state.error).toContain('could not resolve the workflow definition');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

// ── 0948 R7 — inline-seam items ───────────────────────────────────────────────────

/** Minimal resolvable workflow so a setup can reach the success path. */
const MINIMAL_WF = `name: inline-setup-r7
kind: state-machine
initialState: start
terminalStates: [done]
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard:
      kind: always
`;

test.concurrent('0948 R7: a successful re-setup drops the stale error key and projects ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-r7-'));
    try {
        const runId = 'r7-resetup';
        const statePath = join(dir, '.spur', 'memory', 'runs', `${runId}.state.json`);
        const markdownPath = join(dir, '.spur', 'memory', 'runs', `${runId}.md`);

        // 1. A failing setup records the failure.
        const failed = await spawnAsync('bun', [SCRIPT, '--run-id', runId, '--file', 'no-such-workflow'], {
            cwd: dir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(failed.status).toBe(1);
        const first = JSON.parse(readFileSync(statePath, 'utf8')) as { ok?: boolean; error?: string };
        expect(first.ok).toBe(false);
        expect(first.error).toContain('could not resolve the workflow definition');

        // 2. A successful re-setup under the SAME run id must not carry the old error.
        writeFileSync(join(dir, 'wf.yaml'), MINIMAL_WF);
        const ok = await spawnAsync('bun', [SCRIPT, '--run-id', runId, '--file', 'wf.yaml'], {
            cwd: dir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(ok.status).toBe(0);
        const second = JSON.parse(readFileSync(statePath, 'utf8')) as { ok?: boolean; error?: string };
        expect(second.ok).toBe(true);
        expect('error' in second).toBe(false);

        // 3. Exactly ONE header: the exclusive create is idempotent across setups.
        const headers = readFileSync(markdownPath, 'utf8')
            .split('\n')
            .filter((line) => line.startsWith('# spur inline run '));
        expect(headers.length).toBe(1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

// ─── --fingerprint mode (0862 R5) ────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..');
/** CLI entry passed as `--spur-bin`: `resolveAppEntry` derives the repo root and app entry from it. */
const REAL_APP_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
/** The app barrel the script dynamically imports — the direct-call comparison target. */
const APP_ENTRY = join(REPO_ROOT, 'packages', 'app', 'src', 'index.ts');

/** Temp git repo holding one real task-spec file (the digest capture needs `HEAD` plus a task shape). */
async function makeFingerprintFixture(): Promise<{ dir: string; cleanup: () => void }> {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-fingerprint-'));
    writeFileSync(
        join(dir, 'task.md'),
        '## 0862. Fixture task\n\n### Requirements\n\n- **R1** — fixture requirement\n',
    );
    await spawnAsync(
        'sh',
        [
            '-c',
            'git init -q && git config user.email t@example.com && git config user.name t && git add -A && git commit -qm init',
        ],
        { cwd: dir, stdio: 'pipe' },
    );
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function runFingerprint(dir: string, args: string[]) {
    return await spawnAsync('bun', [SCRIPT, '--fingerprint', ...args, '--spur-bin', `bun ${REAL_APP_ENTRY}`], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
    });
}

test.concurrent('--fingerprint prints the same digest as a direct computeProofInputFingerprint (0862 R5)', async () => {
    const { dir, cleanup } = await makeFingerprintFixture();
    try {
        const proc = await runFingerprint(dir, ['--task-file', 'task.md']);
        expect(proc.status).toBe(0);
        expect(proc.stdout.trim()).toMatch(/^sha256:[a-f0-9]{64}$/);

        const app = (await import(APP_ENTRY)) as {
            readProofInputContents: (
                fileSystem: unknown,
                workdir: string,
                options: { taskFile?: unknown; featureFile?: unknown },
            ) => Promise<{ ok: true; taskContent?: string } | { ok: false; error: string }>;
            computeProofInputFingerprint: (options: Record<string, unknown>) => Promise<string>;
        };
        const inputs = await app.readProofInputContents(undefined, dir, { taskFile: 'task.md' });
        if (!inputs.ok) throw new Error(inputs.error);
        const expected = await app.computeProofInputFingerprint({ cwd: dir, taskContent: inputs.taskContent });

        expect(proc.stdout.trim()).toBe(expected);
    } finally {
        cleanup();
    }
}, 30_000);

test.concurrent('--fingerprint fails closed on an unreadable task file and creates no run', async () => {
    const { dir, cleanup } = await makeFingerprintFixture();
    try {
        const proc = await runFingerprint(dir, ['--task-file', 'no-such-task.md']);
        expect(proc.status).toBe(1);
        expect(proc.stderr).toContain('taskFile does not exist');
        expect(existsSync(join(dir, '.spur'))).toBe(false);
    } finally {
        cleanup();
    }
});

test.concurrent('--fingerprint refuses a mixed invocation and a missing task file with usage (exit 2)', async () => {
    const { dir, cleanup } = await makeFingerprintFixture();
    try {
        expect((await runFingerprint(dir, ['--task-file', 'task.md', '--run-id', 'x'])).status).toBe(2);
        expect((await runFingerprint(dir, [])).status).toBe(2);
        expect(existsSync(join(dir, '.spur'))).toBe(false);
    } finally {
        cleanup();
    }
});

// ─── --decide mode (0941 R5) ─────────────────────────────────────────────────

/** Run the delegate in --decide mode inside `dir` (options paths resolve against the cwd). */
async function runDecideMode(dir: string, args: string[]) {
    return await spawnAsync('bun', [SCRIPT, '--decide', ...args, '--spur-bin', `bun ${REAL_APP_ENTRY}`], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
    });
}

/** Write one options JSON file into `dir` and return its relative path. */
function writeDecideOptions(dir: string, options: Record<string, unknown>): string {
    writeFileSync(join(dir, 'decide-options.json'), `${JSON.stringify(options)}\n`);
    return 'decide-options.json';
}

test.concurrent('--decide executes through the app runner: degraded default with the switch off, resultFile written (0941 R4/R5)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-decide-'));
    try {
        // Pin the premise this test's name claims. The merged loader reads the machine-global
        // ~/.config/spur/config.yaml first, so on a host that enabled workflows.decideDecisionMaker
        // the run no longer degrades as 'disabled' and this test fails for an environment reason
        // rather than a behaviour change. A project layer wins over the global one, so the switch
        // is off here on every host — the assertion is now stronger, not weaker.
        mkdirSync(join(dir, '.spur'), { recursive: true });
        writeFileSync(join(dir, '.spur', 'config.yaml'), 'workflows:\n  decideDecisionMaker: false\n');
        const optionsFile = writeDecideOptions(dir, {
            id: 'recovery-classify',
            method: 'choice',
            question: 'retry or stop?',
            choices: ['retry', 'stop'],
            default: 'stop',
            resultFile: '.spur/run/decide-test-recovery.decision.json',
        });
        const proc = await runDecideMode(dir, [
            '--run-id',
            'decide-test-1',
            '--node',
            'classify',
            '--options-json',
            optionsFile,
        ]);
        expect(proc.status).toBe(0);
        const outcome = JSON.parse(proc.stdout.trim().split('\n')[0] ?? '{}') as Record<string, unknown>;
        expect(outcome.ok).toBe(true);
        expect(outcome.degraded).toBe(true);
        expect(outcome.reason).toBe('disabled');
        expect(outcome.value).toBe('stop');
        expect(outcome.runId).toBe('decide-test-1');
        // 0976 R2: provenance is explicit in stdout, the resultFile row, and the run log.
        expect(outcome.source).toBe('default');
        const row = JSON.parse(
            readFileSync(join(dir, '.spur', 'run', 'decide-test-recovery.decision.json'), 'utf8'),
        ) as Record<string, unknown>;
        expect(row.schemaVersion).toBe(1);
        expect(row.value).toBe('stop');
        expect(row.degraded).toBe(true);
        expect(row.source).toBe('default');
        expect(readFileSync(join(dir, '.spur', 'memory', 'runs', 'decide-test-1.md'), 'utf8')).toContain(
            'decide node=classify value=stop source=default reason=disabled',
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

test.concurrent('--decide threads the config switch through the driver boundary: switch on gets past disabled (0941 gate fix)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-decide-cfg-'));
    try {
        // The delegate resolves workflows.decideDecisionMaker at its own boundary; a switched-on
        // config must get PAST the 'disabled' gate. The options declare a MISSING evidence file
        // so the core degrades before any backend ask — deterministic and network-free; the
        // reason is 'error' (factory ok, evidence absent) or 'no-backend' (factory threw).
        mkdirSync(join(dir, '.spur'), { recursive: true });
        writeFileSync(join(dir, '.spur', 'config.yaml'), 'workflows:\n  decideDecisionMaker: true\n');
        const optionsFile = writeDecideOptions(dir, {
            id: 'recovery-classify',
            method: 'choice',
            question: 'retry or stop?',
            choices: ['retry', 'stop'],
            default: 'retry',
            evidence: ['missing-evidence.txt'],
            resultFile: '.spur/run/decide-test-cfg.decision.json',
        });
        const proc = await runDecideMode(dir, [
            '--run-id',
            'decide-test-4',
            '--node',
            'classify',
            '--options-json',
            optionsFile,
        ]);
        expect(proc.status).toBe(0);
        const outcome = JSON.parse(proc.stdout.trim().split('\n')[0] ?? '{}') as Record<string, unknown>;
        expect(outcome.ok).toBe(true);
        expect(outcome.degraded).toBe(true);
        expect(['error', 'no-backend']).toContain(String(outcome.reason));
        expect(outcome.value).toBe('retry');
        const row = JSON.parse(
            readFileSync(join(dir, '.spur', 'run', 'decide-test-cfg.decision.json'), 'utf8'),
        ) as Record<string, unknown>;
        expect(row.degraded).toBe(true);
        expect(row.reason).not.toBe('disabled');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

test.concurrent('--decide fails closed on an invalid options schema (exit 1, ok:false) (0941 R3)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-decide-bad-'));
    try {
        const optionsFile = writeDecideOptions(dir, {
            id: 'x',
            method: 'choice',
            question: 'q',
            choices: ['retry', 'stop'],
            default: 'pause',
            resultFile: 'd.json',
        });
        const proc = await runDecideMode(dir, [
            '--run-id',
            'decide-test-2',
            '--node',
            'classify',
            '--options-json',
            optionsFile,
        ]);
        expect(proc.status).toBe(1);
        const outcome = JSON.parse(proc.stdout.trim().split('\n')[0] ?? '{}') as Record<string, unknown>;
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toContain('invalid options');
        expect(existsSync(join(dir, 'd.json'))).toBe(false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

test.concurrent('--decide refuses usage errors and unsafe run ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-decide-usage-'));
    try {
        const optionsFile = writeDecideOptions(dir, {
            id: 'x',
            method: 'noul',
            question: 'q',
            default: 'no',
            resultFile: 'd.json',
        });
        // Missing --options-json → usage (exit 2).
        expect((await runDecideMode(dir, ['--run-id', 'decide-test-3', '--node', 'classify'])).status).toBe(2);
        // Missing --node → usage (exit 2).
        expect((await runDecideMode(dir, ['--run-id', 'decide-test-3', '--options-json', optionsFile])).status).toBe(2);
        // Unsafe run id (path traversal) → refusal (exit 1).
        expect(
            (await runDecideMode(dir, ['--run-id', '../escape', '--node', 'classify', '--options-json', optionsFile]))
                .status,
        ).toBe(1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

// ── --persist-out (task 0975 R1) ─────────────────────────────────────────────────

import { Database } from 'bun:sqlite';

/** Minimal resolvable workflow so the source worktree can produce a real run row. */
const PERSIST_WF = `name: persist-out-smoke
initialState: start
terminalStates: [done]
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
    guard:
      kind: always
`;

/** Worktree with one fully-traced inline run (setup row + record files + one action row). */
async function makeWorktree(prefix: string, runId: string): Promise<{ dir: string; cleanup: () => void }> {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(dir, '.spur', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.spur', 'workflows', 'persist-out-smoke.yaml'), PERSIST_WF);
    const run = (args: string[]) => spawnAsync('bun', [SCRIPT, ...args], { cwd: dir, stdio: 'pipe', encoding: 'utf8' });
    const setup = await run(['--run-id', runId, '--file', '.spur/workflows/persist-out-smoke.yaml']);
    if (setup.status !== 0) throw new Error(`fixture setup failed: ${setup.stderr}`);
    const action = await run([
        '--action',
        '--run-id',
        runId,
        '--node',
        'start',
        '--kind',
        'shell',
        '--status',
        'done',
        '--ok',
        'true',
        '--duration-ms',
        '5',
    ]);
    if (action.status !== 0) throw new Error(`fixture action failed: ${action.stderr}`);
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test.concurrent('0975 --persist-out: copies the run row, its action rows and the run records into the invoking tree', async () => {
    const from = await makeWorktree('persist-out-from-', 'run-0975-out');
    const to = mkdtempSync(join(tmpdir(), 'persist-out-to-'));
    try {
        const proc = await spawnAsync('bun', [SCRIPT, '--persist-out', '--from', from.dir], {
            cwd: to,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(proc.status, proc.stderr).toBe(0);
        expect(JSON.parse(proc.stdout)).toEqual({ ok: true, persisted: 1, skipped: [] });

        // AC1 shape: the run is queryable in the invoking tree and both record files exist.
        const db = new Database(join(to, '.spur', 'spur.db'), { readonly: true });
        try {
            const run = db
                .query<{ id: string; status: string }, [string]>('SELECT id, status FROM runs WHERE id = ?')
                .get('run-0975-out');
            expect(run?.id).toBe('run-0975-out');
            const actions = db.query('SELECT id FROM action_runs WHERE run_id = ?').all('run-0975-out');
            expect(actions).toHaveLength(1);
        } finally {
            db.close();
        }
        expect(existsSync(join(to, '.spur', 'memory', 'runs', 'run-0975-out.md'))).toBe(true);
        expect(existsSync(join(to, '.spur', 'memory', 'runs', 'run-0975-out.state.json'))).toBe(true);
    } finally {
        from.cleanup();
        rmSync(to, { recursive: true, force: true });
    }
}, 60_000);

test.concurrent('0975 --persist-out: persisting the same worktree twice skips id-exists and leaves counts unchanged', async () => {
    const from = await makeWorktree('persist-out-idem-from-', 'run-0975-idem');
    const to = mkdtempSync(join(tmpdir(), 'persist-out-idem-to-'));
    try {
        const argv = ['--persist-out', '--from', from.dir];
        const first = await spawnAsync('bun', [SCRIPT, ...argv], { cwd: to, stdio: 'pipe', encoding: 'utf8' });
        expect(first.status).toBe(0);
        const second = await spawnAsync('bun', [SCRIPT, ...argv], { cwd: to, stdio: 'pipe', encoding: 'utf8' });
        expect(second.status).toBe(0);
        const out = JSON.parse(second.stdout) as { ok: boolean; persisted: number; skipped: unknown[] };
        expect(out).toEqual({ ok: true, persisted: 0, skipped: [{ id: 'run-0975-idem', reason: 'id-exists' }] });

        const db = new Database(join(to, '.spur', 'spur.db'), { readonly: true });
        try {
            expect(db.query('SELECT id FROM runs').all()).toHaveLength(1);
            expect(db.query('SELECT id FROM action_runs').all()).toHaveLength(1);
        } finally {
            db.close();
        }
    } finally {
        from.cleanup();
        rmSync(to, { recursive: true, force: true });
    }
}, 60_000);

test.concurrent('0975 --persist-out: an unreadable worktree DB exits 1 with {ok:false}', async () => {
    const to = mkdtempSync(join(tmpdir(), 'persist-out-fail-to-'));
    const from = mkdtempSync(join(tmpdir(), 'persist-out-fail-from-'));
    try {
        mkdirSync(join(from, '.spur'), { recursive: true });
        writeFileSync(join(from, '.spur', 'spur.db'), 'not a database');
        const proc = await spawnAsync('bun', [SCRIPT, '--persist-out', '--from', from], {
            cwd: to,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        expect(proc.status).toBe(1);
        const out = JSON.parse(proc.stdout) as { ok: boolean; error?: string };
        expect(out.ok).toBe(false);
        expect(out.error).toBeTruthy();
    } finally {
        rmSync(from, { recursive: true, force: true });
        rmSync(to, { recursive: true, force: true });
    }
}, 60_000);

test.concurrent('0975 --persist-out: usage errors exit 2', async () => {
    const to = mkdtempSync(join(tmpdir(), 'persist-out-usage-'));
    try {
        for (const args of [
            ['--persist-out'],
            // --from missing a value collapses to the next flag / empty → usage.
            ['--persist-out', '--from'],
            // Mixed with another mode.
            ['--persist-out', '--from', '/tmp/x', '--close', '--run-id', 'r', '--status', 'done'],
            ['--persist-out', '--from', '/tmp/x', '--run-id', 'r'],
            // 0984 R2: --task-file belongs to persist-out (repeatable), but a value-less
            // occurrence collapses to an empty path — a usage error, never a silent skip.
            ['--persist-out', '--from', '/tmp/x', '--task-file'],
        ]) {
            const proc = await spawnAsync('bun', [SCRIPT, ...args], { cwd: to, stdio: 'pipe', encoding: 'utf8' });
            expect(proc.status, `expected usage exit 2 for ${args.join(' ')}`).toBe(2);
        }
    } finally {
        rmSync(to, { recursive: true, force: true });
    }
});

test.concurrent('0984 --persist-out: --task-file copies the evidence the merged task file cites into the invoking tree', async () => {
    const from = await makeWorktree('persist-out-cited-from-', 'run-0984-cited');
    const to = mkdtempSync(join(tmpdir(), 'persist-out-cited-to-'));
    try {
        mkdirSync(join(from.dir, '.spur', 'run'), { recursive: true });
        writeFileSync(join(from.dir, '.spur', 'run', '0984-check-receipt.json'), '{"ok":true}\n');
        mkdirSync(join(to, 'docs'), { recursive: true });
        writeFileSync(
            join(to, 'docs', 'task-0984.md'),
            '## Testing\n\nEvidence: `.spur/run/run-0984-cited.md`, `.spur/run/0984-check-receipt.json`\n',
        );
        const proc = await spawnAsync(
            'bun',
            [SCRIPT, '--persist-out', '--from', from.dir, '--task-file', 'docs/task-0984.md'],
            { cwd: to, stdio: 'pipe', encoding: 'utf8' },
        );
        expect(proc.status, proc.stderr).toBe(0);
        expect(JSON.parse(proc.stdout)).toEqual({ ok: true, persisted: 1, skipped: [] });
        // The run-ID record and the WBS-cited artifact both resolve in the invoking tree.
        expect(existsSync(join(to, '.spur', 'memory', 'runs', 'run-0984-cited.md'))).toBe(true);
        expect(existsSync(join(to, '.spur', 'run', '0984-check-receipt.json'))).toBe(true);
    } finally {
        from.cleanup();
        rmSync(to, { recursive: true, force: true });
    }
}, 60_000);

test.concurrent('0984 --persist-out: a citation missing in both trees exits 1 with {ok:false}', async () => {
    const from = await makeWorktree('persist-out-dangle-from-', 'run-0984-dangle');
    const to = mkdtempSync(join(tmpdir(), 'persist-out-dangle-to-'));
    try {
        mkdirSync(join(to, 'docs'), { recursive: true });
        writeFileSync(join(to, 'docs', 'task-0984.md'), '## Testing\n\nEvidence: `.spur/run/0984-vanished.json`\n');
        const proc = await spawnAsync(
            'bun',
            [SCRIPT, '--persist-out', '--from', from.dir, '--task-file', 'docs/task-0984.md'],
            { cwd: to, stdio: 'pipe', encoding: 'utf8' },
        );
        expect(proc.status).toBe(1);
        const out = JSON.parse(proc.stdout) as { ok: boolean; error?: string };
        expect(out.ok).toBe(false);
        expect(out.error).toContain('0984-vanished.json');
    } finally {
        from.cleanup();
        rmSync(to, { recursive: true, force: true });
    }
}, 60_000);

test.concurrent('1012 --persist-out: --task-file copies uncited <wbs>- and <runId>- evidence; unrelated files stay behind', async () => {
    const from = await makeWorktree('persist-out-owned-from-', 'run-1012-owned');
    const to = mkdtempSync(join(tmpdir(), 'persist-out-owned-to-'));
    try {
        mkdirSync(join(from.dir, '.spur', 'run'), { recursive: true });
        writeFileSync(join(from.dir, '.spur', 'run', '1234-verdict.json'), '{"verdict":"PASS"}\n');
        writeFileSync(join(from.dir, '.spur', 'run', 'run-1012-owned-route-reason.txt'), 'inline\n');
        writeFileSync(join(from.dir, '.spur', 'run', '9999-verdict.json'), '{"verdict":"FAIL"}\n');
        mkdirSync(join(to, 'docs'), { recursive: true });
        writeFileSync(join(to, 'docs', '1234_x.md'), '## Testing\n\nno citations here\n');
        const proc = await spawnAsync(
            'bun',
            [SCRIPT, '--persist-out', '--from', from.dir, '--task-file', 'docs/1234_x.md'],
            {
                cwd: to,
                stdio: 'pipe',
                encoding: 'utf8',
            },
        );
        expect(proc.status, proc.stderr).toBe(0);
        expect(JSON.parse(proc.stdout)).toEqual({ ok: true, persisted: 1, skipped: [] });
        expect(readFileSync(join(to, '.spur', 'run', '1234-verdict.json'), 'utf8')).toBe('{"verdict":"PASS"}\n');
        expect(readFileSync(join(to, '.spur', 'run', 'run-1012-owned-route-reason.txt'), 'utf8')).toBe('inline\n');
        expect(existsSync(join(to, '.spur', 'run', '9999-verdict.json'))).toBe(false);
    } finally {
        from.cleanup();
        rmSync(to, { recursive: true, force: true });
    }
}, 60_000);

test.concurrent('1012 --persist-out: a source evidence dir that cannot be listed exits 1 with {ok:false} and writes nothing', async () => {
    const from = await makeWorktree('persist-out-enotdir-from-', 'run-1012-enotdir');
    const to = mkdtempSync(join(tmpdir(), 'persist-out-enotdir-to-'));
    try {
        // Replace the evidence dir with a regular file: listing fails ENOTDIR.
        rmSync(join(from.dir, '.spur', 'run'), { recursive: true, force: true });
        writeFileSync(join(from.dir, '.spur', 'run'), 'not a directory\n');
        mkdirSync(join(to, 'docs'), { recursive: true });
        writeFileSync(join(to, 'docs', '1234_x.md'), '## Testing\n\nno citations here\n');
        const proc = await spawnAsync(
            'bun',
            [SCRIPT, '--persist-out', '--from', from.dir, '--task-file', 'docs/1234_x.md'],
            {
                cwd: to,
                stdio: 'pipe',
                encoding: 'utf8',
            },
        );
        expect(proc.status).toBe(1);
        const out = JSON.parse(proc.stdout) as { ok: boolean; error?: string };
        expect(out.ok).toBe(false);
        expect(out.error).toContain('ENOTDIR');
        expect(existsSync(join(to, '.spur'))).toBe(false);
    } finally {
        from.cleanup();
        rmSync(to, { recursive: true, force: true });
    }
}, 60_000);
