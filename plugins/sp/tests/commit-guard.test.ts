import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parsePorcelainZ } from '../scripts/commit-guard';

/**
 * 1129 R1–R4 / AC1–AC3: the commit guard's evidence contract, exercised against real temp git repos
 * — the guard reads HEAD, porcelain, blob hashes and the index, so "git says so" is the point.
 *
 * AC1 wording note: the AC's "another process edits b.txt" cannot be attributed by git when the path
 * was CLEAN at `start` — content has no author, so a post-start foreign edit and the run's own edit
 * of two clean paths are the same observation. The scenario is encoded in its attributable form: the
 * foreign writer's change is already present when the run fingerprints (b.txt dirty at start) and
 * the run never touches it. Every AC1 assertion holds, including b.txt named as foreign and
 * `check` reporting it. See the `shortcut:` note in scripts/commit-guard.ts.
 */

const ROOT = join(import.meta.dir, '..', '..', '..');
const REFERENCES = join(ROOT, 'plugins', 'sp', 'skills', 'spur-dev', 'references');
const ref = (name: string): string => join(REFERENCES, name);
const DRIVER_DOCS = [
    'execution-batch.md',
    'execution-batch-report.md',
    'execution-worktree-setup.md',
    'execution-worktree-landing.md',
    'execution-parallel-isolation.md',
    'execution-batch-continuation.md',
    'inline-pipeline-driver.md',
    'structured-trace-emission.md',
] as const;
/** Files that MUST define at least one commit step — losing one is a contract loss, not a move. */
const COMMIT_STEP_DOCS = [
    'execution-batch-report.md',
    'execution-worktree-setup.md',
    'execution-worktree-landing.md',
    'inline-pipeline-driver.md',
] as const;

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

/** Capture stdout/stderr around one guard call: the JSON payloads and diagnostics ARE the contract. */
function guard(argv: string[], cwd: string): { code: number; stdout: string; stderr: string } {
    const out: string[] = [];
    const err: string[] = [];
    const [writeOut, writeErr] = [process.stdout.write, process.stderr.write];
    const collect = (sink: string[]): typeof process.stdout.write => {
        return ((chunk: unknown): boolean => {
            sink.push(String(chunk));
            return true;
        }) as typeof process.stdout.write;
    };
    process.stdout.write = collect(out);
    process.stderr.write = collect(err);
    try {
        return { code: main(argv, { cwd }), stdout: out.join(''), stderr: err.join('') };
    } finally {
        process.stdout.write = writeOut;
        process.stderr.write = writeErr;
    }
}

function staged(cwd: string): string[] {
    return git(cwd, ['diff', '--cached', '--name-only'])
        .split('\n')
        .filter((p) => p.length > 0);
}

function startSnapshot(cwd: string, run: string): { head: string; dirty: Array<{ path: string; sha: string }> } {
    return JSON.parse(readFileSync(join(cwd, '.spur', 'run', `${run}-tree-start.json`), 'utf8'));
}

describe('commit-guard (1129 R1–R4, AC1–AC3)', () => {
    test('R1 — start fingerprints HEAD and the porcelain paths with their blob hashes', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'b.txt'), 'foreign\n');
        expect(guard(['start', '--run', 'r1'], cwd).code).toBe(0);
        const snapshot = startSnapshot(cwd, 'r1');
        expect(snapshot.head).toBe(git(cwd, ['rev-parse', 'HEAD']).trim());
        expect(snapshot.dirty).toEqual([{ path: 'b.txt', sha: git(cwd, ['hash-object', '--', 'b.txt']).trim() }]);
    });

    test('AC1 (R1, R2, R3) — a concurrent writer’s file is excluded and named', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'b.txt'), 'foreign edit\n'); // the other writer got there first
        expect(guard(['start', '--run', 'r1'], cwd).code).toBe(0);
        writeFileSync(join(cwd, 'a.txt'), 'run edit\n'); // the run writes a.txt only

        const stage = guard(['stage', '--run', 'r1', '--', 'a.txt', 'b.txt'], cwd);
        expect(JSON.parse(stage.stdout)).toEqual({ staged: ['a.txt'], foreign: ['b.txt'] });
        expect(stage.code).toBe(2);
        expect(staged(cwd)).toEqual(['a.txt']);
        expect(guard(['check', '--run', 'r1'], cwd).stdout.trim()).toBe('{"foreign":["b.txt"]}');
    });

    test('AC2 (R2) — a pre-existing dirty file the run then edits is stageable', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'b.txt'), 'pre-existing dirty\n');
        expect(guard(['start', '--run', 'r2'], cwd).code).toBe(0);
        writeFileSync(join(cwd, 'b.txt'), 'pre-existing dirty + run edit\n');

        const stage = guard(['stage', '--run', 'r2', '--', 'b.txt'], cwd);
        expect(stage.code).toBe(0);
        expect(JSON.parse(stage.stdout)).toEqual({ staged: ['b.txt'], foreign: [] });
        expect(staged(cwd)).toEqual(['b.txt']);
    });

    test('AC3 (R4) — conflict markers fail closed and nothing is staged', () => {
        const cwd = makeRepo();
        expect(guard(['start', '--run', 'r3'], cwd).code).toBe(0);
        writeFileSync(join(cwd, 'c.txt'), 'ok\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> other\n');

        const stage = guard(['stage', '--run', 'r3', '--', 'c.txt'], cwd);
        expect(stage.code).toBe(3);
        expect(stage.stderr).toContain('c.txt');
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
        expect(guard(['start', '--run', 'r4'], cwd).code).toBe(0);

        // A conflicted index is non-empty by construction — "nothing staged" is proved by the
        // index being byte-identical before and after the refusal.
        const before = git(cwd, ['diff', '--cached', '--name-status']);
        const stage = guard(['stage', '--run', 'r4', '--', 'a.txt'], cwd);
        expect(stage.code).toBe(3);
        expect(stage.stderr).toContain('(unmerged)');
        expect(git(cwd, ['diff', '--cached', '--name-status'])).toBe(before);
    });

    test('a missing start snapshot fails closed instead of staging', () => {
        const cwd = makeRepo();
        writeFileSync(join(cwd, 'a.txt'), 'run edit\n');
        const stage = guard(['stage', '--run', 'ghost', '--', 'a.txt'], cwd);
        expect(stage.code).toBe(1);
        expect(stage.stderr).toContain('start --run ghost');
        expect(staged(cwd)).toEqual([]);
    });

    test('parsePorcelainZ reads XY entries and skips bookkeeping and rename sources', () => {
        expect(parsePorcelainZ(' M a.txt\u0000?? new.txt\u0000R  b.txt\u0000a.txt\u0000')).toEqual([
            'a.txt',
            'new.txt',
            'b.txt',
        ]);
        expect(parsePorcelainZ('?? .spur/run/r1-tree-start.json\u0000')).toEqual([]);
    });
});

/**
 * AC4 (R5) — the runbooks route every driver commit through the guard. The contract is mechanical:
 * the word in the doc is what the driver executes, so a free-form `git add` cannot come back.
 *
 * A commit step is the contiguous non-blank command region around each `git commit` line (fenced-
 * block pairing is unreliable in these files: they contain nested fences).
 */
describe('commit-guard (1129 AC4) — runbook commit-step contract', () => {
    const docs = DRIVER_DOCS.map((name) => [name, readFileSync(ref(name), 'utf8')] as const);

    /** Every command region that ends in a `git commit` invocation. */
    function commitSteps(doc: string): string[] {
        const lines = doc.split('\n');
        const steps: string[] = [];
        lines.forEach((line, index) => {
            if (!/git commit\b/.test(line)) return;
            let start = index;
            while (start > 0 && (lines[start - 1] ?? '').trim().length > 0) start--;
            steps.push(lines.slice(start, index + 1).join('\n'));
        });
        return steps;
    }

    /** The guard call, literally or through the resolved `$GUARD` the runbook pins first. */
    function invokesGuard(step: string): boolean {
        return /\$GUARD"?\s+stage|commit-guard(\.mjs)?["']?\s+stage/.test(step);
    }

    test('every commit step invokes commit-guard stage', () => {
        for (const [name, doc] of docs) {
            const steps = commitSteps(doc);
            if (COMMIT_STEP_DOCS.includes(name as (typeof COMMIT_STEP_DOCS)[number])) {
                expect([name, steps.length > 0]).toEqual([name, true]);
            }
            for (const step of steps) {
                if (!invokesGuard(step)) throw new Error(`${name}: commit step without the guard:\n${step}`);
            }
        }
    });

    test('git add -A and git add . appear only in a forbidden sentence', () => {
        for (const [name, doc] of docs) {
            for (const line of doc.split('\n')) {
                if (!/git add (-A|\.)(?![\w/])/.test(line)) continue;
                expect([name, /forbidden/i.test(line)]).toEqual([name, true]);
            }
        }
    });

    test('the guard is documented wherever a commit step lives, with the incidents that motivated it', () => {
        const corpus = docs.map(([, doc]) => doc).join('\n');
        // Both incidents ride the guard wiring that the 1128 split scattered across the runbook set.
        expect(corpus.includes('a94f9f431') && corpus.includes('36f274590')).toBe(true);
        for (const name of COMMIT_STEP_DOCS) {
            const doc = docs.find(([n]) => n === name)?.[1] ?? '';
            expect([name, doc.includes('commit-guard')]).toEqual([name, true]);
            expect([name, doc.includes('git add -A')]).toEqual([name, true]);
        }
    });
});
