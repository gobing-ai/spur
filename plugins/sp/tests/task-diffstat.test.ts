import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import {
    type Diffstat,
    expandDiffPath,
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
        expect(expandDiffPath('apps/cli/src/index.ts => drizzle/schema.sql')).toEqual([
            'apps/cli/src/index.ts',
            'drizzle/schema.sql',
        ]);
        expect(expandDiffPath('apps/cli/src{i.ts => /auth.ts}')).toEqual(['apps/cli/srci.ts', 'apps/cli/src/auth.ts']);
        expect(expandDiffPath('apps/cli/src/index.ts')).toEqual(['apps/cli/src/index.ts']);
        const cwd = makeRepo();
        anchorBase(cwd);
        const mv = spawnSync('git', ['mv', 'apps/cli/src/index.ts', 'secret.env'], { cwd, encoding: 'utf8' });
        if (mv.status !== 0) throw new Error(`git mv failed: ${mv.stderr}`);
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.sensitive).toBe(true);
        expect(result.paths).toContain('apps/cli/src/index.ts');
        expect(result.paths).toContain('secret.env');
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
 * `.files <= 3 and ((.insertions // 0) + (.deletions // 0)) <= 60 and .sensitive == false`.
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
        rmSync(cwd, { recursive: true, force: true });
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
        rmSync(cwd, { recursive: true, force: true });
    });
});
