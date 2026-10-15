/**
 * `spur workflow commit-guard <start|stage|check>` — in-process coverage of the thin adapter over
 * `@gobing-ai/spur-app/commit-guard` (script-absorption PR-4), driven through `main()`'s early
 * dispatch against a real temp repo. Behaviour is pinned by the app tests and the golden parity
 * suite; this asserts argv mapping, line routing and exit codes.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMIT_GUARD_USAGE } from '@gobing-ai/spur-app/commit-guard';
import { main } from '../../../src/index';

function git(cwd: string, args: string[]): void {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
}

function makeRepo(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-wf-commit-guard-'));
    git(cwd, ['init', '-q']);
    git(cwd, ['config', 'user.email', 'test@example.com']);
    git(cwd, ['config', 'user.name', 'test']);
    writeFileSync(join(cwd, 'a.txt'), 'a\n');
    writeFileSync(join(cwd, 'b.txt'), 'b\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-qm', 'base']);
    return cwd;
}

async function guard(cwd: string, args: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(['workflow', 'commit-guard', ...args], {
        cwd,
        env: {},
        output: { write: (m) => out.push(m), error: (m) => err.push(m) },
    });
    return { code, out, err };
}

describe('spur workflow commit-guard', () => {
    test('start → stage → check over a real repo, never booting a database', async () => {
        const cwd = makeRepo();
        try {
            writeFileSync(join(cwd, 'b.txt'), 'foreign\n');
            expect(await guard(cwd, ['start', '--run', 'r1'])).toEqual({ code: 0, out: [], err: [] });
            writeFileSync(join(cwd, 'a.txt'), 'run edit\n');
            const stage = await guard(cwd, ['stage', '--run', 'r1', '--', 'a.txt', 'b.txt']);
            expect(stage.code).toBe(2);
            expect(stage.out).toEqual(['{"staged":["a.txt"],"foreign":["b.txt"]}']);
            expect(stage.err.join('\n')).toContain('b.txt');
            expect(await guard(cwd, ['check', '--run', 'r1'])).toEqual({
                code: 0,
                out: ['{"foreign":["b.txt"]}'],
                err: [],
            });
            const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim();
            expect((await guard(cwd, ['check', '--run', 'r1', '--base', head])).code).toBe(0);
            expect((await guard(cwd, ['stage', '--run', 'r1', '--base', head, 'a.txt'])).code).toBe(0);
            expect(existsSync(join(cwd, '.spur', 'spur.db'))).toBe(false);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('a missing --run is the usage line with exit 1 for every op', async () => {
        const cwd = makeRepo();
        try {
            for (const op of ['start', 'stage', 'check']) {
                expect(await guard(cwd, [op])).toEqual({ code: 1, out: [], err: [COMMIT_GUARD_USAGE] });
            }
            expect((await guard(cwd, ['stage', '--run', 'r1'])).err).toEqual([COMMIT_GUARD_USAGE]);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    test('excess arguments and unknown ops are mis-invocations (exit 1)', async () => {
        const cwd = makeRepo();
        try {
            expect((await guard(cwd, ['start', '--run', 'r1', 'extra'])).code).toBe(1);
            expect((await guard(cwd, ['check', '--run', 'r1', 'extra'])).code).toBe(1);
            expect((await guard(cwd, ['bogus'])).code).toBe(1);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
