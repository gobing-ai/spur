import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0804 R8/P2 (SECUA): the inline run setup delegate writes
 * `.spur/run/<run-id>-inline-setup.json`, so `--run-id` must be validated as a single safe
 * filename component BEFORE any outcome write — the same refusal class the task-pipeline
 * route-reason shell action applies to `$__runId` (task 0804 R8): path separators, dot
 * traversal and unresolved interpolation exit nonzero without an artifact.
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
            // `.spur/run/<id>-inline-setup.json`, at the traversal target either).
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
        const outcome = JSON.parse(readFileSync(join(dir, '.spur', 'run', `${runId}-inline-setup.json`), 'utf8')) as {
            ok: boolean;
            error?: string;
        };
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toContain('could not resolve the workflow definition');
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
        '// stub CLI entry — proves resolveAppEntry derives the repo root from --spur-bin\n',
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
    return spawnSync('bun', [SCRIPT, '--run-id', runId, '--file', 'task-pipeline.yaml', '--spur-bin', appEntry], {
        cwd: workdir,
        stdio: 'pipe',
        encoding: 'utf8',
    });
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
        const outcome = JSON.parse(
            readFileSync(join(workdir, '.spur', 'run', `${runId}-inline-setup.json`), 'utf8'),
        ) as {
            ok: boolean;
        };
        expect(outcome.ok).toBe(true);
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
        const outcome = JSON.parse(
            readFileSync(join(workdir, '.spur', 'run', `${runId}-inline-setup.json`), 'utf8'),
        ) as {
            ok: boolean;
            error?: string;
        };
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toContain('fixture returned refusal');
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
        // A thrown failure keeps the stderr failure behavior and writes no outcome document.
        expect(existsSync(join(workdir, '.spur', 'run', '0809-delegate-throw-inline-setup.json'))).toBe(false);
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
