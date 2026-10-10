import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import {
    type Diffstat,
    main,
    runDiffstat,
    sensitiveReasonForPath,
    TASK_DIFFSTAT_USAGE,
} from '../scripts/task-diffstat';

/**
 * 0943 R2a/R2c: the diffstat producer's evidence contract, exercised against a real temp
 * git repo (the counts feed the deterministic safety guard, so "git says so" is the point).
 * Fail-safe direction (missing base, git failure → sensitive true) is asserted, never assumed.
 */

let repoCount = 0;

function makeRepo(): string {
    const cwd = mkdtempSync(join(tmpdir(), `task-diffstat-${repoCount++}-`));
    const git = (args: string[]): void => {
        const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
        if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
    };
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    mkdirSync(join(cwd, 'apps/cli/src'), { recursive: true });
    writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const start = 1;\n');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
    return cwd;
}

function anchorBase(cwd: string, wbs = '0943'): void {
    const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
    mkdirSync(join(cwd, '.spur/run'), { recursive: true });
    writeFileSync(join(cwd, '.spur/run', `${wbs}-base.sha`), `${sha}\n`);
}

function readRow(cwd: string, wbs = '0943'): Record<string, unknown> {
    return JSON.parse(spawnSync('cat', [join(cwd, '.spur/run', `${wbs}-diffstat.json`)], { encoding: 'utf8' }).stdout);
}

/**
 * A fail-safe case's diagnostic is the operator's, not the test runner's: capture the write
 * so the assertion still pins the message without leaking it into the suite output.
 */
function capturingStderr<T>(body: () => T): { result: T; stderr: string } {
    const seen: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: unknown): boolean => {
        seen.push(String(chunk));
        return true;
    }) as typeof process.stderr.write;
    try {
        return { result: body(), stderr: seen.join('') };
    } finally {
        process.stderr.write = original;
    }
}

describe('task-diffstat (0943)', () => {
    test('counts tracked changes plus untracked files against the anchored run base', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const start = 1;\nexport const end = 2;\n');
        mkdirSync(join(cwd, 'apps/web'));
        writeFileSync(join(cwd, 'apps/web/page.ts'), 'export default 1;\n');
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.exitCode).toBe(0);
        expect(result.sensitive).toBe(false);
        expect(result.paths).toEqual(['apps/cli/src/index.ts', 'apps/web/page.ts']);
        expect(result.files).toBe(2);
        // +1 tracked line, +1 untracked line (newline scan).
        expect(result.insertions).toBe(2);
        expect(result.deletions).toBe(0);
        const row = readRow(cwd);
        expect(row).toMatchObject({ files: 2, insertions: 2, deletions: 0, sensitive: false });
    });

    test('flags every sensitive pattern class (R2c frozen list)', () => {
        expect(sensitiveReasonForPath('drizzle/0050_new-migration.sql')).toContain('drizzle/');
        expect(sensitiveReasonForPath('packages/config/src/index.ts')).toContain('packages/config/');
        expect(sensitiveReasonForPath('apps/server/src/middleware/auth.ts')).toContain('auth');
        expect(sensitiveReasonForPath('apps/server/src/auth.ts')).toContain('auth');
        expect(sensitiveReasonForPath('docs/secret-notes.md')).toContain('secret');
        expect(sensitiveReasonForPath('secret.env')).toContain('secret');
        expect(sensitiveReasonForPath('.github/workflows/ci.yml')).toContain('.github/');
        expect(sensitiveReasonForPath('plugins/sp/hooks/on-task.ts')).toContain('hooks');
        expect(sensitiveReasonForPath('migrations/0001_init.sql')).toContain('.sql');
        expect(sensitiveReasonForPath('apps/cli/src/index.ts')).toBeNull();
    });

    test('a sensitive path anywhere in the diff fails safe to sensitive', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const start = 11;\n');
        mkdirSync(join(cwd, 'drizzle'));
        writeFileSync(join(cwd, 'drizzle/0050_lanes.sql'), 'ALTER TABLE runs ADD COLUMN lane text;\n');
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.sensitive).toBe(true);
        expect(result.files).toBe(2);
    });

    test('rename rows split into both halves, so a rename INTO a sensitive path fails safe (review P3#1)', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const mv = spawnSync('git', ['mv', 'apps/cli/src/index.ts', 'secret.env'], { cwd, encoding: 'utf8' });
        if (mv.status !== 0) throw new Error(`git mv failed: ${mv.stderr}`);
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.sensitive).toBe(true);
        expect(result.paths).toContain('apps/cli/src/index.ts');
        expect(result.paths).toContain('secret.env');
    });

    test('a pure rename counts its line delta once, not once per half (1160 R2)', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'apps/cli/src/other.ts'), 'export const other = 1;\n');
        gitIn(cwd, ['add', '.']);
        gitIn(cwd, ['commit', '-qm', 'add other']);
        anchorBase(cwd);
        // The only churn is the modified sibling; the rename pair contributes 0/0 exactly once.
        writeFileSync(join(cwd, 'apps/cli/src/other.ts'), 'export const other = 1;\nexport const two = 2;\n');
        gitIn(cwd, ['mv', 'apps/cli/src/index.ts', 'secret.env']);
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.paths.sort()).toEqual(['apps/cli/src/index.ts', 'apps/cli/src/other.ts', 'secret.env']);
        expect(result.files).toBe(3);
        expect(result.insertions).toBe(1);
        expect(result.deletions).toBe(0);
        expect(result.sensitive).toBe(true);
    });

    test('a large diff reports its size for the >400-changed-lines guard', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const big = Array.from({ length: 260 }, (_, i) => `export const v${i} = ${i};\n`).join('');
        writeFileSync(join(cwd, 'apps/cli/src/index.ts'), big);
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.sensitive).toBe(false);
        expect(result.insertions).toBe(260);
        expect(result.insertions + result.deletions).toBeGreaterThan(400 - 260);
    });

    test('missing run base fails safe (sensitive, empty diff, exit 0)', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const changed = true;\n');
        const { result, stderr } = capturingStderr(() => runDiffstat({ wbs: '0943' }, { cwd }));
        expect(stderr).toContain('run base .spur/run/<wbs>-base.sha missing or malformed');
        expect(result.exitCode).toBe(0);
        expect(result).toMatchObject({ files: 0, insertions: 0, deletions: 0, sensitive: true });
        expect(readRow(cwd)).toMatchObject({ sensitive: true });
    });

    test('a failing git probe fails safe instead of throwing', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const { result, stderr } = capturingStderr(() =>
            runDiffstat({ wbs: '0943' }, { cwd }, () => ({ status: 128, stdout: '' })),
        );
        expect(stderr).toContain('git diff --numstat failed (status=128)');
        expect(result.exitCode).toBe(0);
        expect(result.sensitive).toBe(true);
    });

    test('an empty wbs is a mis-invocation (exit 1) and stray argv is usage (exit 2)', () => {
        const { result, stderr } = capturingStderr(() => {
            const exitCode = runDiffstat({}, {}).exitCode;
            return { exitCode, usageExit: main(['unexpected'], { wbs: '0943' }) };
        });
        expect(stderr).toContain('wbs is empty — refusing to guess the run artifact path');
        expect(stderr).toContain(TASK_DIFFSTAT_USAGE);
        expect(result.exitCode).toBe(1);
        expect(result.usageExit).toBe(2);
        expect(TASK_DIFFSTAT_USAGE).toContain('wbs');
    });

    test('the workflow wrapper contract: plain `bun` invocation writes the row via env', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const wrapped = true;\n');
        const run = spawnSync('bun', [join(import.meta.dir, '../scripts/task-diffstat.ts')], {
            cwd,
            encoding: 'utf8',
            env: { ...getEnvVars(), wbs: '0943' },
        });
        expect(run.status).toBe(0);
        expect(readRow(cwd)).toMatchObject({ files: 1, sensitive: false });
        rmSync(cwd, { recursive: true, force: true });
    });
});

// ─── 1039: verify dispatch-floor conformance (1033 R1 decision table) ─────────

/**
 * Transcript of `inline-pipeline-driver.md` condition-5 diffstat arm (verify only):
 * Counts must be numeric; `.files <= 3 and (.insertions + .deletions) <= 60 and .sensitive == false`.
 * Hand-transcribed on purpose — this suite pins the contract semantics; the doc text
 * itself is pinned separately by command-flag-parity (fd2ab09f5).
 */
function belowDiffstatFloor(row: {
    files: number;
    insertions: number;
    deletions: number;
    sensitive: boolean;
}): boolean {
    return row.files <= 3 && row.insertions + row.deletions <= 60 && !row.sensitive;
}

/**
 * The driver reads `.spur/run/<wbs>-diffstat.json` with jq; a missing or unparsable
 * artifact leaves condition 5 as-above (floor — failure mode is more isolation, never
 * less). This mirrors that read, including the defensive shape check.
 */
function belowFloorFromArtifact(cwd: string, wbs = '1039'): boolean {
    let row: unknown;
    try {
        row = JSON.parse(readFileSync(join(cwd, '.spur/run', `${wbs}-diffstat.json`), 'utf8'));
    } catch {
        return false;
    }
    const candidate = row as Partial<Diffstat> | null;
    if (
        candidate === null ||
        typeof candidate !== 'object' ||
        typeof candidate.files !== 'number' ||
        typeof candidate.insertions !== 'number' ||
        typeof candidate.deletions !== 'number' ||
        typeof candidate.sensitive !== 'boolean'
    ) {
        return false;
    }
    return belowDiffstatFloor(candidate as Diffstat);
}

/** Transcript of the driver's below-floor run-log line (1039 R3 — exact template). */
function floorLogLine(sessionId: string, row: Diffstat): string {
    return `stage verify executed inline in session ${sessionId} (below dispatch floor: diffstat files ${row.files} lines ${row.insertions + row.deletions})`;
}

function changedLines(cwd: string, lineCount: number): void {
    writeFileSync(
        join(cwd, 'apps/cli/src/index.ts'),
        Array.from({ length: lineCount }, (_, i) => `export const v${i} = ${i};\n`).join(''),
    );
}

describe('task-diffstat → verify dispatch floor (1039)', () => {
    test('small clean diffstat dispatches verify host-inline and renders the exact floor log line', () => {
        const cwd = makeRepo();
        anchorBase(cwd, '1039');
        changedLines(cwd, 2);
        const result = runDiffstat({ wbs: '1039' }, { cwd });
        expect(result.sensitive).toBe(false);
        expect(belowDiffstatFloor(result)).toBe(true);
        expect(belowFloorFromArtifact(cwd)).toBe(true);
        expect(floorLogLine('sess-1', result)).toBe(
            'stage verify executed inline in session sess-1 (below dispatch floor: diffstat files 1 lines 3)',
        );
        const driver = readFileSync(
            join(import.meta.dir, '../skills/spur-dev/references/inline-pipeline-driver.md'),
            'utf8',
        );
        expect(driver.replace(/\s+/g, ' ')).toContain(
            'stage verify executed inline in session <session-id> (below dispatch floor: diffstat files <f> lines <n>)',
        );
        expect(driver.replace(/\s+/g, ' ')).toContain(
            '([.files, .insertions, .deletions] | all(type == "number")) and .files <= 3 and (.insertions + .deletions) <= 60 and .sensitive == false',
        );
        rmSync(cwd, { recursive: true, force: true });
    });

    test('3 changed files ride below the floor; 4 do not', () => {
        for (const [files, inline] of [
            [3, true],
            [4, false],
        ] as const) {
            const cwd = makeRepo();
            try {
                anchorBase(cwd, '1039');
                for (let i = 0; i < files; i++) {
                    writeFileSync(join(cwd, `apps/cli/src/fixture-${i}.ts`), 'export const value = 1;\n');
                }
                const result = runDiffstat({ wbs: '1039' }, { cwd });
                expect(result.files).toBe(files);
                expect(result.sensitive).toBe(false);
                expect(belowDiffstatFloor(result)).toBe(inline);
                expect(belowFloorFromArtifact(cwd)).toBe(inline);
            } finally {
                rmSync(cwd, { recursive: true, force: true });
            }
        }
    });

    test('60 changed lines ride below the floor; 61 do not (threshold boundary bites)', () => {
        const atFloor = makeRepo();
        anchorBase(atFloor, '1039');
        changedLines(atFloor, 59); // rewrite of the 1-line base: +59 −1 = exactly 60.
        const small = runDiffstat({ wbs: '1039' }, { cwd: atFloor });
        expect(small.insertions + small.deletions).toBe(60);
        expect(belowDiffstatFloor(small)).toBe(true);
        rmSync(atFloor, { recursive: true, force: true });

        const overFloor = makeRepo();
        anchorBase(overFloor, '1039');
        changedLines(overFloor, 60); // +60 −1 = 61.
        const large = runDiffstat({ wbs: '1039' }, { cwd: overFloor });
        expect(large.insertions + large.deletions).toBe(61);
        expect(belowDiffstatFloor(large)).toBe(false);
        rmSync(overFloor, { recursive: true, force: true });
    });

    test('a sensitive diffstat keeps the floor even when tiny', () => {
        const cwd = makeRepo();
        anchorBase(cwd, '1039');
        writeFileSync(join(cwd, 'secret.env'), 'TOKEN=1\n');
        const result = runDiffstat({ wbs: '1039' }, { cwd });
        expect(result.sensitive).toBe(true);
        expect(result.insertions + result.deletions).toBeLessThanOrEqual(60);
        expect(belowDiffstatFloor(result)).toBe(false);
        expect(belowFloorFromArtifact(cwd)).toBe(false);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('a large clean diffstat keeps the floor even with few files', () => {
        const cwd = makeRepo();
        anchorBase(cwd, '1039');
        changedLines(cwd, 500);
        const result = runDiffstat({ wbs: '1039' }, { cwd });
        expect(result.files).toBe(1);
        expect(result.sensitive).toBe(false);
        expect(belowDiffstatFloor(result)).toBe(false);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('missing or unparsable diffstat artifact keeps the floor (defensive)', () => {
        const cwd = makeRepo();
        anchorBase(cwd, '1039');
        // No diffstat written yet at all.
        expect(belowFloorFromArtifact(cwd)).toBe(false);
        // Unparsable garbage where the driver expects the jq row.
        writeFileSync(join(cwd, '.spur/run', '1039-diffstat.json'), 'not-json');
        expect(belowFloorFromArtifact(cwd)).toBe(false);
        // Parsable but shape-broken (null fields) — still floor.
        writeFileSync(
            join(cwd, '.spur/run', '1039-diffstat.json'),
            '{"files":null,"insertions":1,"deletions":0,"sensitive":false}',
        );
        expect(belowFloorFromArtifact(cwd)).toBe(false);
        for (const field of ['files', 'insertions', 'deletions']) {
            for (const value of [null, undefined]) {
                const row = { files: 1, insertions: 1, deletions: 0, sensitive: false, [field]: value };
                writeFileSync(join(cwd, '.spur/run', '1039-diffstat.json'), JSON.stringify(row));
                expect(belowFloorFromArtifact(cwd)).toBe(false);
            }
        }
        rmSync(cwd, { recursive: true, force: true });
    });
});

describe('task-diffstat stdout-redirect guard (1067 R3)', () => {
    test('redirecting stdout onto the artifact keeps the artifact correct and exits nonzero (AC3)', () => {
        const cwd = makeRepo();
        anchorBase(cwd, '1067');
        writeFileSync(join(cwd, 'apps/cli/src/index.ts'), 'export const start = 1;\nexport const end = 2;\n');
        const artifact = join(cwd, '.spur/run', '1067-diffstat.json');
        writeFileSync(artifact, 'stale-from-an-earlier-attempt');
        // The shell-equivalent: open the artifact for write (truncating) and hand the fd as stdout.
        const fd = openSync(artifact, 'w');
        try {
            const run = spawnSync(process.execPath, [join(import.meta.dir, '../scripts/task-diffstat.ts')], {
                cwd,
                encoding: 'utf8',
                env: { ...getEnvVars(), wbs: '1067' },
                stdio: ['ignore', fd, 'pipe'],
            });
            expect(run.status).toBe(1);
            expect(run.stderr).toContain('redirect stdout elsewhere');
        } finally {
            closeSync(fd);
        }
        const row = JSON.parse(readFileSync(artifact, 'utf8')) as Record<string, unknown>;
        expect(row.files).toBe(1);
        expect(row.sensitive).toBe(false);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('normal invocation stays silent and exits zero', () => {
        const cwd = makeRepo();
        anchorBase(cwd, '1067');
        const run = spawnSync(process.execPath, [join(import.meta.dir, '../scripts/task-diffstat.ts')], {
            cwd,
            encoding: 'utf8',
            env: { ...getEnvVars(), wbs: '1067' },
        });
        expect(run.status).toBe(0);
        expect(run.stdout).toBe('');
        rmSync(cwd, { recursive: true, force: true });
    });
});

// ─── 1160: raw NUL numstat framing + raw-path sensitive matching ─────────────

const gitIn = (cwd: string, args: string[]): void => {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
};

describe('task-diffstat -z numstat parsing (1160)', () => {
    const NUL = '\u0000';

    test('tracked diff argv carries -z and raw NUL records survive intact', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const seen: string[][] = [];
        const { result } = capturingStderr(() =>
            runDiffstat({ wbs: '0943' }, { cwd }, (args) => {
                seen.push(args);
                if (args[0] === 'diff')
                    return { status: 0, stdout: `3\t1\tplugins/sp/hooks/保護.ts${NUL}2\t0\tdrizzle/a.sql${NUL}` };
                return { status: 0, stdout: '' };
            }),
        );
        expect(seen[0]).toEqual(['diff', '--numstat', '-z', expect.any(String)]);
        expect(result.paths).toEqual(['drizzle/a.sql', 'plugins/sp/hooks/保護.ts']);
        expect(result.files).toBe(2);
        expect(result.sensitive).toBe(true);
        expect(result.insertions).toBe(5);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('a rename record contributes both raw paths and its counts exactly once', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const { result } = capturingStderr(() =>
            runDiffstat({ wbs: '0943' }, { cwd }, (args) =>
                args[0] === 'diff'
                    ? {
                          status: 0,
                          stdout: `0\t0\t${NUL}apps/cli/src/index.ts${NUL}drizzle/renamed.sql${NUL}4\t2\thooks/x.ts${NUL}`,
                      }
                    : { status: 0, stdout: '' },
            ),
        );
        expect(result.paths).toEqual(['apps/cli/src/index.ts', 'drizzle/renamed.sql', 'hooks/x.ts']);
        expect(result.files).toBe(3);
        // One count header → 4/2 once; the rename pair adds nothing.
        expect(result.insertions).toBe(4);
        expect(result.deletions).toBe(2);
        expect(result.sensitive).toBe(true);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('paths containing tabs, newlines and literal arrows stay byte-exact', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const { result } = capturingStderr(() =>
            runDiffstat({ wbs: '0943' }, { cwd }, (args) =>
                args[0] === 'diff'
                    ? {
                          status: 0,
                          stdout: `1\t0\tdir\twith-tab/x.sql${NUL}1\t0\tdir\nnewline/x.sql${NUL}1\t0\ta => b{c}.ts${NUL}`,
                      }
                    : { status: 0, stdout: '' },
            ),
        );
        expect(result.paths).toEqual(['a => b{c}.ts', 'dir\twith-tab/x.sql', 'dir\nnewline/x.sql']);
        // dotAll in globToRegex (R4): `**/*.sql` must span the newline-bearing directory.
        expect(sensitiveReasonForPath('dir\nnewline/x.sql')).toBe('matches sensitive pattern **/*.sql');
        expect(result.sensitive).toBe(true);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('binary and untracked rows keep working under -z', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const { result } = capturingStderr(() =>
            runDiffstat({ wbs: '0943' }, { cwd }, (args) =>
                args[0] === 'diff'
                    ? { status: 0, stdout: `-\t-\tassets/logo.png${NUL}` }
                    : { status: 0, stdout: `apps/cli/src/untracked.ts${NUL}` },
            ),
        );
        expect(result.paths).toEqual(['apps/cli/src/untracked.ts', 'assets/logo.png']);
        expect(result.files).toBe(2);
        // `-` contributes no lines; the untracked file's newline count comes from disk (absent → 0).
        expect(result.insertions).toBe(0);
        expect(result.deletions).toBe(0);
        expect(result.sensitive).toBe(false);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('empty output is an empty diff, not a framing error', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const { result, stderr } = capturingStderr(() =>
            runDiffstat({ wbs: '0943' }, { cwd }, (_args) => ({ status: 0, stdout: '' })),
        );
        expect(stderr).toBe('');
        expect(result).toMatchObject({ files: 0, insertions: 0, deletions: 0, sensitive: false });
        rmSync(cwd, { recursive: true, force: true });
    });

    test.each([
        ['an unterminated record', `1\t0\ta/x.ts`],
        ['a record missing its path separator', `1\t0${NUL}`],
        ['a non-numeric count', `x\t0\ta/x.ts${NUL}`],
        ['a rename with one half', `0\t0\t${NUL}a/x.ts${NUL}`],
        ['a rename with an empty half', `0\t0\t${NUL}${NUL}a/x.ts${NUL}`],
    ])('%s fails safe with a named diagnostic', (_label, stdout) => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const { result, stderr } = capturingStderr(() =>
            runDiffstat({ wbs: '0943' }, { cwd }, (args) =>
                args[0] === 'diff' ? { status: 0, stdout } : { status: 0, stdout: '' },
            ),
        );
        expect(stderr).toContain('git diff --numstat -z');
        expect(result.exitCode).toBe(0);
        expect(result).toMatchObject({ files: 0, sensitive: true });
        rmSync(cwd, { recursive: true, force: true });
    });

    test('a C-quoted non-ASCII hook path is sensitive with core.quotepath=true (the a71c reproduction)', () => {
        const cwd = makeRepo();
        gitIn(cwd, ['config', 'core.quotepath', 'true']);
        anchorBase(cwd);
        mkdirSync(join(cwd, 'plugins/sp/hooks'), { recursive: true });
        writeFileSync(join(cwd, 'plugins/sp/hooks/保護.ts'), 'export const hook = 1;\n');
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.paths).toEqual(['plugins/sp/hooks/保護.ts']);
        expect(result.sensitive).toBe(true);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('a rename into and out of a sensitive directory classifies on both raw paths', () => {
        const cwd = makeRepo();
        const from = join(cwd, 'apps/cli/src/index.ts');
        mkdirSync(join(cwd, 'drizzle'), { recursive: true });
        gitIn(cwd, ['mv', 'apps/cli/src/index.ts', 'drizzle/moved.sql']);
        spawnSync('git', ['add', '.'], { cwd });
        spawnSync('git', ['commit', '-qm', 'move into drizzle'], { cwd });
        anchorBase(cwd);
        // Rename back OUT of the sensitive directory: the old path must still classify.
        gitIn(cwd, ['mv', 'drizzle/moved.sql', 'apps/cli/src/index.ts']);
        writeFileSync(from, 'export const start = 2;\n');
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.paths).toContain('drizzle/moved.sql');
        expect(result.paths).toContain('apps/cli/src/index.ts');
        expect(result.sensitive).toBe(true);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('the Node twin parses the same -z fixture identically', () => {
        const cwd = makeRepo();
        gitIn(cwd, ['config', 'core.quotepath', 'true']);
        anchorBase(cwd);
        mkdirSync(join(cwd, 'plugins/sp/hooks'), { recursive: true });
        writeFileSync(join(cwd, 'plugins/sp/hooks/保護.ts'), 'export const hook = 1;\n');
        const twin = spawnSync('node', [join(import.meta.dir, '../scripts/task-diffstat.mjs')], {
            cwd,
            encoding: 'utf8',
            env: { ...getEnvVars(), wbs: '0943' },
        });
        expect(twin.status).toBe(0);
        const source = runDiffstat({ wbs: '0943' }, { cwd });
        expect(readRow(cwd)).toMatchObject({
            paths: source.paths,
            files: source.files,
            sensitive: source.sensitive,
        });
        rmSync(cwd, { recursive: true, force: true });
    });
});
