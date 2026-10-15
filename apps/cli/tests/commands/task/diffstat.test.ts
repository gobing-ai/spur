/**
 * Thin-wrapper tests for `spur task diffstat` (apps/cli/src/commands/task/diffstat.ts). The
 * producer's behavioral suite lives in packages/app/tests/workflow/task-diffstat.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;

const git = (args: string[]): string => {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
    return run.stdout;
};

beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'spur-task-diffstat-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'test']);
    writeFileSync(join(cwd, 'a.ts'), 'export const a = 1;\n');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
});

afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
});

const row = (wbs: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(cwd, '.spur', 'run', `${wbs}-diffstat.json`), 'utf8'));

describe('spur task diffstat', () => {
    test('writes the row against the anchored run base and exits 0', async () => {
        mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
        writeFileSync(join(cwd, '.spur', 'run', '3001-base.sha'), git(['rev-parse', 'HEAD']));
        writeFileSync(join(cwd, 'a.ts'), 'export const a = 2;\nexport const b = 3;\n');
        const output = createCapturedOutput();
        expect(await main(['task', 'diffstat', '3001'], { cwd, output, env: {} })).toBe(0);
        expect(row('3001')).toMatchObject({ files: 1, insertions: 2, deletions: 1, sensitive: false });
        expect(output.errors).toEqual([]);
    });

    test('a missing run base fails safe to sensitive with the diagnostic on stderr', async () => {
        const output = createCapturedOutput();
        expect(await main(['task', 'diffstat', '3002'], { cwd, output, env: {} })).toBe(0);
        expect(row('3002')).toMatchObject({ files: 0, sensitive: true });
        expect(output.errors.join('\n')).toContain('task-diffstat: run base');
    });
});
