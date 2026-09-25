import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';
import {
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
        const result = runDiffstat({ wbs: '0943' }, { cwd });
        expect(result.exitCode).toBe(0);
        expect(result).toMatchObject({ files: 0, insertions: 0, deletions: 0, sensitive: true });
        expect(readRow(cwd)).toMatchObject({ sensitive: true });
    });

    test('a failing git probe fails safe instead of throwing', () => {
        const cwd = makeRepo();
        anchorBase(cwd);
        const result = runDiffstat({ wbs: '0943' }, { cwd }, () => ({ status: 128, stdout: '' }));
        expect(result.exitCode).toBe(0);
        expect(result.sensitive).toBe(true);
    });

    test('an empty wbs is a mis-invocation (exit 1) and stray argv is usage (exit 2)', () => {
        expect(runDiffstat({}, {}).exitCode).toBe(1);
        expect(main(['unexpected'], { wbs: '0943' })).toBe(2);
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
