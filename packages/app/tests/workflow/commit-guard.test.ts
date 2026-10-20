import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    COMMIT_GUARD_USAGE,
    type CommitGuardOptions,
    type CommitGuardReport,
    commitGuardCheck,
    commitGuardStage,
    commitGuardStart,
    commitGuardUsage,
    conflictMarkerLine,
    currentHostSessionId as currentHostSessionIdForTest,
    type GitRunner,
    parsePorcelainZ,
} from '../../src/workflow/commit-guard';

/**
 * 1129 R1–R4 / AC1–AC3 and 1209: the commit guard's evidence contract against real temp git repos —
 * the guard reads HEAD, porcelain, blob hashes and the index, so "git says so" is the point.
 * Ported from `plugins/sp/tests/commit-guard.test.ts` when the script became
 * `spur workflow commit-guard` (script-absorption PR-4).
 *
 * AC1 wording note: a post-start foreign edit of a path that was CLEAN at `start` cannot be
 * attributed by git (content has no author), so the scenario is encoded in its attributable form:
 * the foreign writer's change is already present when the run fingerprints.
 */

let repoCount = 0;

function git(cwd: string, args: string[]): string {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
    return run.stdout;
}

/** A committed a.txt + b.txt on a branch whose name git chose (main vs master). */
function makeRepo(): string {
    const cwd = mkdtempSync(join(tmpdir(), `commit-guard-${repoCount++}-`));
    git(cwd, ['init', '-q']);
    git(cwd, ['config', 'user.email', 'test@example.com']);
    git(cwd, ['config', 'user.name', 'test']);
    writeFileSync(join(cwd, 'a.txt'), 'a\n');
    writeFileSync(join(cwd, 'b.txt'), 'b\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-qm', 'base']);
    return cwd;
}

/** Report lines joined like the CLI prints them (one line each). */
const out = (r: CommitGuardReport): string => r.stdout.join('\n');
const err = (r: CommitGuardReport): string => r.stderr.join('\n');

/** Real git underneath, with one probe kind forced to status 1 on its Nth call (1-based); counts adds. */
function probeRunner(
    cwd: string,
    fail: (args: string[], nth: number) => boolean,
): { runner: GitRunner; adds: () => number } {
    const seen = new Map<string, number>();
    let adds = 0;
    const runner: GitRunner = (args) => {
        if (args[0] === 'add') adds++;
        const nth = (seen.get(args.join(' ')) ?? 0) + 1;
        seen.set(args.join(' '), nth);
        if (fail(args, nth)) return { status: 1, stdout: '' };
        const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
        return { status: run.status ?? 1, stdout: run.stdout ?? '' };
    };
    return { runner, adds: () => adds };
}

const isChangedProbe = (args: string[]): boolean => args[0] === 'diff' && !args.includes('--diff-filter=U');
const isUnmergedProbe = (args: string[]): boolean => args.includes('--diff-filter=U');

function staged(cwd: string): string[] {
    return git(cwd, ['diff', '--cached', '--name-only'])
        .split('\n')
        .filter((p) => p.length > 0);
}

function startSnapshot(cwd: string, run: string): { head: string; dirty: Array<{ path: string; sha: string }> } {
    return JSON.parse(readFileSync(join(cwd, '.spur', 'run', `${run}-tree-start.json`), 'utf8'));
}

const start = (cwd: string, run: string): number => commitGuardStart(run, { cwd }).exitCode;

describe('commit-guard (1129 R1–R4, AC1–AC3)', () => {
    test('R1 — start fingerprints HEAD and the porcelain paths with their blob hashes', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'b.txt'), 'foreign\n');
        const report = commitGuardStart('r1', { cwd });
        expect(report).toEqual({ exitCode: 0, stdout: [], stderr: [] });
        const snapshot = startSnapshot(cwd, 'r1');
        expect(snapshot.head).toBe(git(cwd, ['rev-parse', 'HEAD']).trim());
        expect(snapshot.dirty).toEqual([{ path: 'b.txt', sha: git(cwd, ['hash-object', '--', 'b.txt']).trim() }]);
    });

    test('AC1 (R1, R2, R3) — a concurrent writer’s file is excluded and named', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'b.txt'), 'foreign edit\n');
        expect(start(cwd, 'r1')).toBe(0);
        writeFileSync(join(cwd, 'a.txt'), 'run edit\n');

        const stage = commitGuardStage('r1', ['a.txt', 'b.txt'], { cwd });
        expect(JSON.parse(out(stage))).toEqual({ staged: ['a.txt'], foreign: ['b.txt'] });
        expect(stage.exitCode).toBe(2);
        expect(stage.staged).toEqual(['a.txt']);
        expect(stage.foreign).toEqual(['b.txt']);
        expect(staged(cwd)).toEqual(['a.txt']);
        expect(out(commitGuardCheck('r1', { cwd }))).toBe('{"foreign":["b.txt"]}');
    });

    test('AC2 (R2) — a pre-existing dirty file the run then edits is stageable', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'b.txt'), 'pre-existing dirty\n');
        expect(start(cwd, 'r2')).toBe(0);
        writeFileSync(join(cwd, 'b.txt'), 'pre-existing dirty + run edit\n');

        const stage = commitGuardStage('r2', ['b.txt'], { cwd });
        expect(stage.exitCode).toBe(0);
        expect(JSON.parse(out(stage))).toEqual({ staged: ['b.txt'], foreign: [] });
        expect(staged(cwd)).toEqual(['b.txt']);
    });

    test('an unchanged listed path is refused (exit 2) but is not foreign', () => {
        const cwd = makeRepo();
        expect(start(cwd, 'r2u')).toBe(0);
        const stage = commitGuardStage('r2u', ['a.txt'], { cwd });
        expect(stage.exitCode).toBe(2);
        expect(JSON.parse(out(stage))).toEqual({ staged: [], foreign: [] });
        expect(err(stage)).toContain('a.txt');
    });

    test('AC3 (R4) — conflict markers fail closed and nothing is staged', () => {
        const cwd = makeRepo();
        expect(start(cwd, 'r3')).toBe(0);
        writeFileSync(join(cwd, 'c.txt'), 'ok\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n');

        const stage = commitGuardStage('r3', ['c.txt'], { cwd });
        expect(stage.exitCode).toBe(3);
        expect(err(stage)).toContain('c.txt');
        expect(staged(cwd)).toEqual([]);
    });

    test('R4 — an unmerged target is refused through the index probe', () => {
        const cwd = makeRepo();
        const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
        git(cwd, ['checkout', '-q', '-b', 'other']);
        writeFileSync(join(cwd, 'a.txt'), 'theirs\n');
        git(cwd, ['commit', '-qam', 'other']);
        git(cwd, ['checkout', '-q', branch]);
        writeFileSync(join(cwd, 'a.txt'), 'ours\n');
        git(cwd, ['commit', '-qam', 'ours']);
        expect(spawnSync('git', ['merge', 'other'], { cwd, encoding: 'utf8' }).status).not.toBe(0);
        expect(start(cwd, 'r4')).toBe(0);

        const before = git(cwd, ['diff', '--cached', '--name-status']);
        const stage = commitGuardStage('r4', ['a.txt'], { cwd });
        expect(stage.exitCode).toBe(3);
        expect(err(stage)).toContain('(unmerged)');
        expect(git(cwd, ['diff', '--cached', '--name-status'])).toBe(before);
    });

    test('a missing start snapshot fails closed instead of staging, naming the CLI to run', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'a.txt'), 'run edit\n');
        const stage = commitGuardStage('ghost', ['a.txt'], { cwd });
        expect(stage.exitCode).toBe(1);
        expect(err(stage)).toContain('spur workflow commit-guard start --run ghost');
        expect(staged(cwd)).toEqual([]);
        expect(commitGuardCheck('ghost', { cwd }).exitCode).toBe(1);
    });

    test('stage with no paths is the usage line (exit 1)', () => {
        const cwd = makeRepo();
        expect(start(cwd, 'r5')).toBe(0);
        const stage = commitGuardStage('r5', [], { cwd });
        expect(stage).toEqual({ exitCode: 1, stdout: [], stderr: [COMMIT_GUARD_USAGE], staged: [], foreign: [] });
        expect(commitGuardUsage()).toEqual({ exitCode: 1, stdout: [], stderr: [COMMIT_GUARD_USAGE] });
    });

    test('the --base anchor replaces the snapshot HEAD as the diff base', () => {
        const cwd = makeRepo();
        const base = git(cwd, ['rev-parse', 'HEAD']).trim();
        expect(start(cwd, 'r6')).toBe(0);
        writeFileSync(join(cwd, 'a.txt'), 'committed by the run\n');
        git(cwd, ['commit', '-qam', 'run commit']);
        // Against the snapshot HEAD a.txt is unchanged; against the precheck base it is the run's.
        expect(JSON.parse(out(commitGuardCheck('r6', { cwd, base })))).toEqual({ foreign: [] });
        writeFileSync(join(cwd, 'a.txt'), 'and edited again\n');
        expect(commitGuardStage('r6', ['a.txt'], { cwd, base }).exitCode).toBe(0);
    });

    test('a start outside a work tree fails the probe (exit 1, nothing written)', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'commit-guard-nogit-'));
        const report = commitGuardStart('r7', { cwd });
        expect(report.exitCode).toBe(1);
        expect(err(report).startsWith('commit-guard:')).toBe(true);
    });

    test('parsePorcelainZ reads XY entries and skips bookkeeping and rename sources', () => {
        expect(parsePorcelainZ(' M a.txt\u0000?? new.txt\u0000R  b.txt\u0000a.txt\u0000')).toEqual([
            'a.txt',
            'new.txt',
            'b.txt',
        ]);
        expect(parsePorcelainZ('?? .spur/run/r1-tree-start.json\u0000')).toEqual([]);
    });

    test('conflictMarkerLine finds a marker on any line, not inside one', () => {
        expect(conflictMarkerLine('ok\n<<<<<<< HEAD\n')).toBe(true);
        expect(conflictMarkerLine('<<<<<<< ours\nx\n=======\n')).toBe(true);
        expect(conflictMarkerLine('Title\n=======\n')).toBe(false); // a setext underline, no opener
        expect(conflictMarkerLine('>>>>>>> other')).toBe(true);
        expect(conflictMarkerLine('text <<<<<<< not at start\n')).toBe(false);
    });
});

describe('commit-guard (1209 R1) — a failed changed-path probe cannot certify a clean tree', () => {
    for (const [probe, scan] of [
        ['diff', 1],
        ['diff', 2],
        ['ls-files', 1],
        ['ls-files', 2],
    ] as const) {
        test(`AC1 — ${probe} probe fails in scan ${scan}: exit 1, no JSON`, () => {
            const cwd = makeRepo();
            expect(start(cwd, 'r1')).toBe(0);
            const { runner } = probeRunner(cwd, (args, nth) => {
                if (nth !== scan) return false;
                return probe === 'diff' ? isChangedProbe(args) : args[0] === 'ls-files';
            });
            const res = commitGuardCheck('r1', { cwd, git: runner });
            expect(res.exitCode).toBe(1);
            expect(err(res).startsWith('commit-guard:')).toBe(true);
            expect(err(res)).toContain(probe);
            expect(err(res)).toContain('failed (status 1)');
            expect(res.stdout).toEqual([]);
        });
    }

    test('an invalid --base check exits 1 without success JSON (real git, unknown revision)', () => {
        const cwd = makeRepo();
        expect(start(cwd, 'r1b')).toBe(0);
        const res = commitGuardCheck('r1b', { cwd, base: 'not-a-rev' });
        expect(res.exitCode).toBe(1);
        expect(err(res).startsWith('commit-guard:')).toBe(true);
        expect(res.stdout).toEqual([]);
    });
});

describe('commit-guard (1209 R2) — failed safety probes never reach git add', () => {
    for (const probe of ['diff', 'ls-files']) {
        test(`AC2 — a failed changed-path (${probe}) probe refuses an otherwise stageable file`, () => {
            const cwd = makeRepo();
            expect(start(cwd, 'r2')).toBe(0);
            writeFileSync(join(cwd, 'a.txt'), 'run edit\n');
            const { runner, adds } = probeRunner(cwd, (args) =>
                probe === 'diff' ? isChangedProbe(args) : args[0] === 'ls-files',
            );
            const result = commitGuardStage('r2', ['a.txt'], { cwd, git: runner });
            expect(result.exitCode).toBe(1);
            expect([result.staged, result.foreign, result.stdout]).toEqual([[], [], []]);
            expect(err(result).startsWith('commit-guard:')).toBe(true);
            expect(err(result)).toContain(probe);
            expect(adds()).toBe(0);
            expect(staged(cwd)).toEqual([]);
        });
    }

    test('AC2 — a failed unmerged probe refuses an otherwise stageable ordinary file', () => {
        const cwd = makeRepo();
        expect(start(cwd, 'r2b')).toBe(0);
        writeFileSync(join(cwd, 'a.txt'), 'run edit\n');
        const { runner, adds } = probeRunner(cwd, isUnmergedProbe);
        const result = commitGuardStage('r2b', ['a.txt'], { cwd, git: runner });
        expect([result.exitCode, result.staged, result.foreign]).toEqual([1, [], []]);
        expect(err(result)).toContain('--diff-filter=U');
        expect(adds()).toBe(0);
        expect(staged(cwd)).toEqual([]);
    });

    test('AC2 — a failed git add stages nothing and exits 1', () => {
        const cwd = makeRepo();
        expect(start(cwd, 'r2d')).toBe(0);
        writeFileSync(join(cwd, 'a.txt'), 'run edit\n');
        const { runner } = probeRunner(cwd, (args) => args[0] === 'add');
        const result = commitGuardStage('r2d', ['a.txt'], { cwd, git: runner });
        expect([result.exitCode, result.staged, result.foreign]).toEqual([1, [], []]);
        expect(err(result)).toContain('git add failed');
    });

    test('AC2 — a thrown GitRunner failure surfaces as exit 1 for stage and check', () => {
        const cwd = makeRepo();
        expect(start(cwd, 'r2c')).toBe(0);
        writeFileSync(join(cwd, 'a.txt'), 'run edit\n');
        const boom: GitRunner = () => {
            throw new Error('runner exploded');
        };
        const options: CommitGuardOptions = { cwd, git: boom };
        for (const res of [commitGuardStage('r2c', ['a.txt'], options), commitGuardCheck('r2c', options)]) {
            expect(res.exitCode).toBe(1);
            expect(err(res).startsWith('commit-guard:')).toBe(true);
            expect(err(res)).toContain('runner exploded');
            expect(res.stdout).toEqual([]);
        }
        expect(staged(cwd)).toEqual([]);
        // `start` has nothing to protect yet: a throwing runner propagates (the CLI reports it, exit 1).
        expect(() => commitGuardStart('r2x', options)).toThrow('runner exploded');
    });
});

describe('commit-guard — foreign session owner (task 1265 session finding)', () => {
    // Two peer agent sessions in one checkout committed over each other on 2026-10-20: a second
    // session committed this run's working files and rewrote a shared test file mid-run. The
    // registry already records the owner; `check` now names it instead of staying silent.
    const seedSession = (cwd: string, owner: { host: string; sessionId: string } | null): void => {
        const dir = join(cwd, '.spur', 'context');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, '.session.json'), JSON.stringify(owner === null ? {} : { owner }));
    };

    test('a pointer owned by another session is reported on stderr and in the JSON', () => {
        const cwd = makeRepo();
        commitGuardStart('run-foreign', { cwd });
        seedSession(cwd, { host: 'pi', sessionId: 'someone-else' });
        const result = commitGuardCheck('run-foreign', { cwd });
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(out(result))).toMatchObject({ foreignSession: { sessionId: 'someone-else' } });
        expect(err(result)).toContain('another session owns this tree');
    });

    test('the current session and an ownerless pointer stay silent', () => {
        const cwd = makeRepo();
        commitGuardStart('run-owned', { cwd });
        seedSession(cwd, { host: 'pi', sessionId: 'me' });
        // No env manipulation: the fixture owns a session id that cannot match this process's
        // own host session, so a matching owner is simulated by writing ITS id below.
        const self = currentHostSessionIdForTest();
        seedSession(cwd, { host: 'pi', sessionId: self === '' ? 'nobody' : self });
        expect(err(commitGuardCheck('run-owned', { cwd }))).not.toContain('another session');
        seedSession(cwd, null);
        expect(err(commitGuardCheck('run-owned', { cwd }))).not.toContain('another session');
    });
});
