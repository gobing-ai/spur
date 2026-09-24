import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0804 R8/P2 (SECUA): the inline run setup delegate writes the two-file run record
 * (`.spur/run/<run-id>.state.json` + `.spur/run/<run-id>.md`, task 0927), so `--run-id` must be
 * validated as a single safe filename component BEFORE any outcome write — the same refusal
 * class the task-pipeline route-reason shell action applies to `$__runId` (task 0804 R8):
 * path separators, dot traversal and unresolved interpolation exit nonzero without an artifact.
 */

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'inline-run-setup.ts');

test('an unsafe run id refuses with exit 1 and writes no outcome artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-guard-'));
    try {
        for (const unsafeId of ['../evil', 'a/b', '$(id)', 'run..../../escape', '..']) {
            const proc = spawnSync('bun', [SCRIPT, '--run-id', unsafeId, '--file', 'whatever'], {
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

test('a valid run id passes the guard and reaches the normal fail-closed path (no false refusal)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-guard-valid-'));
    try {
        const runId = '0804-run-setup-guard-valid';
        const proc = spawnSync('bun', [SCRIPT, '--run-id', runId, '--file', 'no-such-workflow'], {
            cwd: dir,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        // The definition cannot resolve, so the run still fails closed — but through the
        // resolver, not the run-id guard.
        expect(proc.status).toBe(1);
        expect(proc.stderr).not.toContain('refusing unsafe run id');
        expect(proc.stderr).toContain('could not resolve the workflow definition');
        const state = JSON.parse(readFileSync(join(dir, '.spur', 'run', `${runId}.state.json`), 'utf8')) as {
            runId: string;
            error?: string;
        };
        expect(state.runId).toBe(runId);
        expect(state.error).toContain('could not resolve the workflow definition');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

// ── Delegate cleanup (task 0809 R2/AC2) ───────────────────────────────────────────
// The REAL delegate must close each opened project DB exactly once BEFORE process
// termination — on setup success (exit 0), a returned `ok: false` refusal (exit 1) and a
// thrown failure after the DB opens (exit 1). The fixture uses the existing app-entry
// resolution seam: a minimal repo-shaped stub (apps/cli/src/index.ts +
// packages/app/src/index.ts) passed via `--spur-bin`, whose fixture app module appends
// ordered open/setup/close markers — the close is proven before the child exits, not
// inferred from a count after OS teardown.

type DelegateBehavior = 'ok' | 'refuse' | 'throw';

function fixtureAppSource(behavior: DelegateBehavior, markerFile: string): string {
    const marker = JSON.stringify(markerFile);
    const outcome =
        behavior === 'refuse'
            ? "    return { ok: false, error: 'fixture returned refusal' };"
            : behavior === 'throw'
              ? "    throw new Error('fixture thrown failure');"
              : "    return { ok: true, attached: false, runId: input.runId, workflowName: 'fixture', definitionDigest: 'sha256:' + 'a'.repeat(64), workflowVersion: null, resolvedPath: 'fixture', layer: 'project', workdir: input.workdir, status: 'running' };";
    return `import { appendFileSync } from 'node:fs';

let closed = false;

export async function openInlineRunProjectDb(_workdir: string) {
    appendFileSync(${marker}, 'open\\n');
    return {
        adapter: {},
        close(): void {
            appendFileSync(${marker}, closed ? 'close-again\\n' : 'close\\n');
            closed = true;
        },
    };
}

export async function createOrAttachInlineRun(input: { runId: string; workdir: string }) {
    appendFileSync(${marker}, 'setup\\n');
${outcome}
}
`;
}

function makeDelegateFixture(behavior: DelegateBehavior) {
    const repoRoot = mkdtempSync(join(tmpdir(), 'inline-run-setup-stub-'));
    const markerFile = join(repoRoot, 'markers.log');
    mkdirSync(join(repoRoot, 'apps', 'cli', 'src'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages', 'app', 'src'), { recursive: true });
    writeFileSync(
        join(repoRoot, 'apps', 'cli', 'src', 'index.ts'),
        // The canary stands in for a secret inside the resolved definition body: the setup
        // delegate receives the inventory but must never copy its contents into the record.
        'console.log(JSON.stringify({ source: { path: "fixture", layer: "project" }, body: "SPUR-CANARY-0927" }));\n',
    );
    writeFileSync(join(repoRoot, 'packages', 'app', 'src', 'index.ts'), fixtureAppSource(behavior, markerFile));
    return {
        repoRoot,
        appEntry: join(repoRoot, 'apps', 'cli', 'src', 'index.ts'),
        markers: () => (existsSync(markerFile) ? readFileSync(markerFile, 'utf8').split('\n').filter(Boolean) : []),
        cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
    };
}

function runDelegate(workdir: string, runId: string, appEntry: string) {
    return spawnSync(
        'bun',
        [SCRIPT, '--run-id', runId, '--file', 'task-pipeline.yaml', '--spur-bin', `bun ${appEntry}`],
        {
            cwd: workdir,
            stdio: 'pipe',
            encoding: 'utf8',
        },
    );
}

function makeDelegateWorkdir(): { workdir: string; cleanup: () => void } {
    const workdir = mkdtempSync(join(tmpdir(), 'inline-run-setup-wd-'));
    return { workdir, cleanup: () => rmSync(workdir, { recursive: true, force: true }) };
}

test('delegate cleanup: setup success closes the DB exactly once and exits 0 (0809 R2)', () => {
    const stub = makeDelegateFixture('ok');
    const { workdir, cleanup } = makeDelegateWorkdir();
    try {
        const runId = '0809-delegate-ok';
        const proc = runDelegate(workdir, runId, stub.appEntry);
        expect(proc.status).toBe(0);
        expect(proc.stderr).toContain('created run');
        expect(stub.markers()).toEqual(['open', 'setup', 'close']);
        // 0927 R1: the setup outcome lives in the run-record pair.
        const state = JSON.parse(readFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), 'utf8')) as Record<
            string,
            unknown
        >;
        expect(state).toMatchObject({
            schemaVersion: 1,
            runId,
            workflowName: 'fixture',
            status: 'running',
            definitionDigest: `sha256:${'a'.repeat(64)}`,
            layer: 'project',
            ok: true,
        });
        expect(readFileSync(join(workdir, '.spur', 'run', `${runId}.md`), 'utf8')).toContain(
            `# spur inline run ${runId} — fixture`,
        );
        // 0927 AC2: the canary in the resolved inventory never reaches the pair.
        expect(readFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), 'utf8')).not.toContain(
            'SPUR-CANARY-0927',
        );
        expect(readFileSync(join(workdir, '.spur', 'run', `${runId}.md`), 'utf8')).not.toContain('SPUR-CANARY-0927');
        // 0927 R4: the retired sidecars stay retired for new runs — a consumer still
        // expecting `<run-id>-inline-setup.json` or `<run-id>.log` fails here.
        expect(existsSync(join(workdir, '.spur', 'run', `${runId}-inline-setup.json`))).toBe(false);
        expect(existsSync(join(workdir, '.spur', 'run', `${runId}.log`))).toBe(false);
        // A re-setup of the same run id rewrites the state but appends no second header.
        const startedBefore = (
            JSON.parse(readFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), 'utf8')) as {
                startedAt?: string;
            }
        ).startedAt;
        // A prior failure's error key must not survive a successful re-setup (0948 R7).
        const seeded = JSON.parse(readFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), 'utf8')) as Record<
            string,
            unknown
        >;
        seeded.error = 'stale failure';
        writeFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), `${JSON.stringify(seeded)}\n`);
        const rerun = runDelegate(workdir, runId, stub.appEntry);
        expect(rerun.status).toBe(0);
        const headers = readFileSync(join(workdir, '.spur', 'run', `${runId}.md`), 'utf8')
            .split('\n')
            .filter((line) => line.startsWith('# spur inline run'));
        expect(headers).toHaveLength(1);
        // 0927 R2: re-setup carries the original startedAt forward instead of resetting it.
        const stateAfter = JSON.parse(readFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), 'utf8')) as {
            startedAt?: string;
        };
        expect(stateAfter.startedAt).toBe(startedBefore);
        expect((stateAfter as { ok?: boolean; error?: string }).ok).toBe(true);
        expect((stateAfter as { error?: string }).error).toBeUndefined();
    } finally {
        cleanup();
        stub.cleanup();
    }
}, 30_000);

test('delegate cleanup: a returned ok:false refusal closes the DB exactly once and exits 1 (0809 R2)', () => {
    const stub = makeDelegateFixture('refuse');
    const { workdir, cleanup } = makeDelegateWorkdir();
    try {
        const runId = '0809-delegate-refuse';
        const proc = runDelegate(workdir, runId, stub.appEntry);
        expect(proc.status).toBe(1);
        expect(proc.stderr).toContain('fixture returned refusal');
        expect(stub.markers()).toEqual(['open', 'setup', 'close']);
        const state = JSON.parse(readFileSync(join(workdir, '.spur', 'run', `${runId}.state.json`), 'utf8')) as {
            runId: string;
            error?: string;
        };
        expect(state.runId).toBe(runId);
        expect(state.error).toContain('fixture returned refusal');
    } finally {
        cleanup();
        stub.cleanup();
    }
}, 30_000);

test('delegate cleanup: a thrown failure after the DB opens still closes it exactly once and exits 1 (0809 R2)', () => {
    const stub = makeDelegateFixture('throw');
    const { workdir, cleanup } = makeDelegateWorkdir();
    try {
        const proc = runDelegate(workdir, '0809-delegate-throw', stub.appEntry);
        expect(proc.status).toBe(1);
        expect(proc.stderr).toContain('fixture thrown failure');
        expect(stub.markers()).toEqual(['open', 'setup', 'close']);
        // A thrown failure keeps the stderr failure behavior and writes no record files.
        expect(existsSync(join(workdir, '.spur', 'run', '0809-delegate-throw.state.json'))).toBe(false);
        expect(existsSync(join(workdir, '.spur', 'run', '0809-delegate-throw.md'))).toBe(false);
    } finally {
        cleanup();
        stub.cleanup();
    }
}, 30_000);

test('delegate cleanup: an unsafe run id never opens the DB and writes no artifact (0809 R2)', () => {
    const stub = makeDelegateFixture('ok');
    const { workdir, cleanup } = makeDelegateWorkdir();
    try {
        const proc = runDelegate(workdir, '../evil', stub.appEntry);
        expect(proc.status).toBe(1);
        expect(proc.stderr).toContain('refusing unsafe run id');
        expect(stub.markers()).toEqual([]);
        expect(existsSync(join(workdir, '.spur'))).toBe(false);
    } finally {
        cleanup();
        stub.cleanup();
    }
}, 30_000);

// ─── --fingerprint mode (0862 R5) ────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
/** CLI entry passed as `--spur-bin`: `resolveAppEntry` derives the repo root and app entry from it. */
const REAL_APP_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
/** The app barrel the script dynamically imports — the direct-call comparison target. */
const APP_ENTRY = join(REPO_ROOT, 'packages', 'app', 'src', 'index.ts');

/** Temp git repo holding one real task-spec file (the digest capture needs `HEAD` plus a task shape). */
function makeFingerprintFixture(): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'inline-run-setup-fingerprint-'));
    writeFileSync(
        join(dir, 'task.md'),
        '## 0862. Fixture task\n\n### Requirements\n\n- **R1** — fixture requirement\n',
    );
    spawnSync(
        'sh',
        [
            '-c',
            'git init -q && git config user.email t@example.com && git config user.name t && git add -A && git commit -qm init',
        ],
        { cwd: dir, stdio: 'pipe' },
    );
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runFingerprint(dir: string, args: string[]) {
    return spawnSync('bun', [SCRIPT, '--fingerprint', ...args, '--spur-bin', `bun ${REAL_APP_ENTRY}`], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
    });
}

test('--fingerprint prints the same digest as a direct computeProofInputFingerprint (0862 R5)', async () => {
    const { dir, cleanup } = makeFingerprintFixture();
    try {
        const proc = runFingerprint(dir, ['--task-file', 'task.md']);
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

test('--fingerprint fails closed on an unreadable task file and creates no run', () => {
    const { dir, cleanup } = makeFingerprintFixture();
    try {
        const proc = runFingerprint(dir, ['--task-file', 'no-such-task.md']);
        expect(proc.status).toBe(1);
        expect(proc.stderr).toContain('taskFile does not exist');
        expect(existsSync(join(dir, '.spur'))).toBe(false);
    } finally {
        cleanup();
    }
});

test('--fingerprint refuses a mixed invocation and a missing task file with usage (exit 2)', () => {
    const { dir, cleanup } = makeFingerprintFixture();
    try {
        expect(runFingerprint(dir, ['--task-file', 'task.md', '--run-id', 'x']).status).toBe(2);
        expect(runFingerprint(dir, []).status).toBe(2);
        expect(existsSync(join(dir, '.spur'))).toBe(false);
    } finally {
        cleanup();
    }
});
