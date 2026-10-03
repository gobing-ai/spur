import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { compareTrees, defaultInvokeRoot, listObligations, main, wbsOfTaskFile } from '../scripts/persist-out-check';

/**
 * 1067 R1/R4: the WT-4 pre-removal assertion. A landing without persist-out must surface
 * a named warning/block before `git worktree remove`; fixtures stand in for the trees.
 */

let fixtureCount = 0;

function makeTrees(): { wt: string; invoke: string } {
    const base = mkdtempSync(join(tmpdir(), `persist-out-check-${fixtureCount++}-`));
    const wt = join(base, 'wt');
    const invoke = join(base, 'invoke');
    mkdirSync(join(wt, '.spur', 'run'), { recursive: true });
    mkdirSync(join(wt, '.spur', 'memory', 'evidence', 'runs'), { recursive: true });
    mkdirSync(join(invoke, '.spur', 'run'), { recursive: true });
    return { wt, invoke };
}

describe('persist-out-check', () => {
    test('wbsOfTaskFile takes leading digits before underscore', () => {
        expect(wbsOfTaskFile('/x/1065_fold-freshness.md')).toBe('1065');
        expect(wbsOfTaskFile('/x/not-a-task.md')).toBeNull();
    });

    test('landing without persist-out is blocked, naming the abandoned evidence (AC1)', () => {
        const { wt, invoke } = makeTrees();
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', 'runs', '1058-verdict.json'), 'v1');
        writeFileSync(join(wt, '.spur', 'run', '1058-test-gate.log'), 'PASS\n');
        const files = listObligations(wt, ['1058'], []);
        expect(files).not.toBeNull();
        const { missing } = compareTrees(wt, invoke, files ?? []);
        expect(missing).toContain(join('.spur', 'memory', 'evidence', 'runs', '1058-verdict.json'));
        expect(missing).toContain(join('.spur', 'run', '1058-test-gate.log'));
        expect(main(['--from', wt, '--task-file', '/merged/docs/tasks5/1058_x.md'], invoke)).toBe(1);
    });

    test('after persist-out copies byte-identical evidence the check passes', () => {
        const { wt, invoke } = makeTrees();
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', 'd63-receipt.md'), 'receipt');
        writeFileSync(join(wt, '.spur', 'run', '1058-verdict.json'), 'v1');
        mkdirSync(join(invoke, '.spur', 'memory', 'evidence'), { recursive: true });
        writeFileSync(join(invoke, '.spur', 'memory', 'evidence', 'd63-receipt.md'), 'receipt');
        writeFileSync(join(invoke, '.spur', 'run', '1058-verdict.json'), 'v1');
        expect(main(['--from', wt, '--task-file', '/t/1058_a.md'], invoke)).toBe(0);
    });

    test('divergent evidence blocks (persist-out never overwrites)', () => {
        const { wt, invoke } = makeTrees();
        writeFileSync(join(wt, '.spur', 'run', '1058-verdict.json'), 'wt-copy');
        writeFileSync(join(invoke, '.spur', 'run', '1058-verdict.json'), 'invoke-copy');
        expect(main(['--from', wt, '--task-file', '/t/1058_a.md'], invoke)).toBe(1);
    });

    test('evidence cap overrun refuses by name-capable failure', () => {
        const { wt } = makeTrees();
        const evDir = join(wt, '.spur', 'memory', 'evidence');
        for (let i = 0; i < 257; i++) writeFileSync(join(evDir, `f${i}.txt`), 'x');
        expect(listObligations(wt, [], [])).toBeNull();
        rmSync(evDir, { recursive: true, force: true });
    });

    test('missing --from is a usage error', () => {
        expect(main([], '/tmp')).toBe(2);
    });

    test('usage errors: unknown argv, absent --from path, non-directory --from', () => {
        const { wt } = makeTrees();
        writeFileSync(join(wt, '.spur', 'run', '1058-verdict.json'), 'v');
        expect(main(['--from', wt, '--bogus'], '/tmp')).toBe(2);
        expect(main(['--from', join(dirname(wt), 'nope')], '/tmp')).toBe(2);
        expect(main(['--from', join(wt, '.spur', 'run', '1058-verdict.json')], '/tmp')).toBe(2);
    });

    test('run-id cap (65 same-prefix run files) refuses; unnumbered task-file args are ignored', () => {
        const { wt, invoke } = makeTrees();
        for (let i = 0; i < 65; i++) writeFileSync(join(wt, '.spur', 'run', `1058-f${i}.log`), 'x');
        expect(listObligations(wt, [], ['1058'])).toBeNull();
        expect(main(['--from', wt, '--task-file', '/t/no-digits.md'], invoke)).toBe(0); // nothing owned
    });

    test('finding lists are capped at 32 named files plus a +N more line', () => {
        const { wt, invoke } = makeTrees();
        for (let i = 0; i < 40; i++) writeFileSync(join(wt, '.spur', 'run', `1058-f${i}.log`), `v${i}`);
        const seen: string[] = [];
        const original = process.stdout.write;
        process.stdout.write = ((chunk: unknown): boolean => {
            seen.push(String(chunk));
            return true;
        }) as typeof process.stdout.write;
        let code: number;
        try {
            code = main(['--from', wt, '--task-file', '/t/1058_a.md'], invoke);
        } finally {
            process.stdout.write = original;
        }
        expect(code).toBe(1);
        expect(seen.filter((l) => l.startsWith('MISSING '))).toHaveLength(32);
        expect(seen.join('')).toContain('+8 more');
    });

    test('flag plumbing: --spur-bin consumed, --root honored, empty --run-id ignored', () => {
        const { wt, invoke } = makeTrees();
        expect(main(['--spur-bin', 'ignored', '--from', wt, '--run-id', ''], invoke)).toBe(0);
        // --root overrides the git-derived default: pointing at a tree without the evidence blocks.
        writeFileSync(join(wt, '.spur', 'memory', 'evidence', 'note.md'), 'n');
        expect(main(['--from', wt, '--root', '/tmp'], wt)).toBe(1);
    });

    test('default invoke root is the MAIN repo, never the worktree cwd (vacuous-pass guard)', () => {
        const repo = makeTrees();
        // Promote the fixture pair to a real git repo + linked worktree.
        const git = (args: string[], cwd: string): void => {
            const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
            if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
        };
        git(['init', '-q'], repo.wt);
        git(['config', 'user.email', 't@e.st'], repo.wt);
        git(['config', 'user.name', 't'], repo.wt);
        writeFileSync(join(repo.wt, 'seed.txt'), 'seed');
        git(['add', '.'], repo.wt);
        git(['commit', '-qm', 'seed'], repo.wt);
        git(['worktree', 'add', join(dirname(repo.wt), 'linked'), 'HEAD'], repo.wt);
        const mainTree = realpathSync(repo.wt);
        expect(realpathSync(defaultInvokeRoot(repo.wt))).toBe(mainTree); // inside main tree → itself
        expect(realpathSync(defaultInvokeRoot(join(dirname(repo.wt), 'linked')))).toBe(mainTree); // linked worktree → main tree
        rmSync(dirname(repo.wt), { recursive: true, force: true });
    });
});
