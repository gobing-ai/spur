import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// 0931 AC3/AC4 — the git mechanics behind execution-batch.md § Parallel isolation's
// `integrate(t)`: rebase onto the current base tip, then `git merge --ff-only` — linear history,
// no merge commits, worktree + branch removed after the FF; a conflicting rebase aborts and
// leaves the worktree clean on its original tip (retained, branch intact, nothing auto-resolved).
// Git runs only inside this test (Bun.spawnSync), mirroring plugins/sp/tests/task-pipeline-resilience.test.ts.

interface GitResult {
    exitCode: number;
    out: string;
}

function git(cwd: string, args: string[]): GitResult {
    const result = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return { exitCode: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` };
}

function initRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-parallel-int-'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@spur.local']);
    git(dir, ['config', 'user.name', 'spur test']);
    return dir;
}

function baseCommit(dir: string, files: Record<string, string>): void {
    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(dir, name), body);
    }
    git(dir, ['add', '.']);
    git(dir, ['commit', '-qm', 'base']);
}

function baseRef(dir: string): string {
    const r = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (r.exitCode !== 0) throw new Error(`rev-parse --abbrev-ref HEAD failed: ${r.out}`);
    return r.out.trim();
}

/** WT-2: cut a per-task worktree + branch from the base-ref tip (sibling of the unique temp repo). */
function cutWorktree(repo: string, name: string, branch: string): string {
    const wt = join(dirname(repo), `${basename(repo)}-${name}-wt`);
    const r = git(repo, ['worktree', 'add', wt, '-b', branch, baseRef(repo)]);
    if (r.exitCode !== 0) throw new Error(`worktree add failed: ${r.out}`);
    return wt;
}

/** commit one file inside a worktree (WT-3b equivalent). */
function commitIn(wt: string, files: Record<string, string>, message: string): void {
    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(wt, name), body);
    }
    git(wt, ['add', '.']);
    git(wt, ['commit', '-qm', message]);
}

/**
 * integrate(t) exactly as execution-batch.md § Parallel isolation specifies it:
 * rebase onto the CURRENT base tip, then (from the main tree) checkout base + `git merge --ff-only`.
 * Returns the rebase result so the conflict case can drive the abort path.
 */
function integrate(repo: string, wt: string, branch: string): GitResult {
    const rebase = git(wt, ['rebase', baseRef(repo)]);
    if (rebase.exitCode !== 0) return rebase;
    const checkout = git(repo, ['checkout', baseRef(repo)]);
    if (checkout.exitCode !== 0) throw new Error(`checkout failed: ${checkout.out}`);
    const ff = git(repo, ['merge', '--ff-only', branch]);
    if (ff.exitCode !== 0) throw new Error(`ff-only failed: ${ff.out}`);
    return rebase;
}

describe('task 0931 — parallel integration git mechanics (AC3/AC4)', () => {
    test('AC3 — disjoint parallel tasks integrate by rebase + fast-forward: linear history, no merge commits, tree + branch removed', () => {
        const repo = initRepo();
        const wts: string[] = [];
        try {
            baseCommit(repo, { 'base.md': 'shared base\n' });
            const br1 = 'sp/run-0040-a1';
            const br2 = 'sp/run-0050-b2';
            const wt1 = cutWorktree(repo, 'run-0040', br1);
            const wt2 = cutWorktree(repo, 'run-0050', br2);
            wts.push(wt1, wt2);
            expect(existsSync(wt1)).toBe(true);
            expect(existsSync(wt2)).toBe(true);

            commitIn(wt1, { 'task-0040.md': 'task 0040 writes only its own file\n' }, '0040 work');
            commitIn(wt2, { 'task-0050.md': 'task 0050 writes only its own file\n' }, '0050 work');

            const head = baseRef(repo);
            // Integrate 0040, THEN 0050 — the second rebases over the first (serialized, base moved).
            expect(integrate(repo, wt1, br1).exitCode).toBe(0);
            expect(integrate(repo, wt2, br2).exitCode).toBe(0);

            // Linear history: base + two task commits, zero merge commits.
            expect(git(repo, ['rev-list', '--merges', '--count', head]).out.trim()).toBe('0');
            expect(git(repo, ['rev-list', '--count', head]).out.trim()).toBe('3');
            expect(readFileSync(join(repo, 'task-0040.md'), 'utf8')).toContain('0040');
            expect(readFileSync(join(repo, 'task-0050.md'), 'utf8')).toContain('0050');

            // WT-4 cleanup: after the FF the worktree is removed and the branch deleted.
            expect(git(repo, ['worktree', 'remove', wt1]).exitCode).toBe(0);
            expect(git(repo, ['branch', '-d', br1]).exitCode).toBe(0);
            expect(git(repo, ['worktree', 'remove', wt2]).exitCode).toBe(0);
            expect(git(repo, ['branch', '-d', br2]).exitCode).toBe(0);
            expect(existsSync(wt1)).toBe(false);
            expect(existsSync(wt2)).toBe(false);
            expect(git(repo, ['branch', '--list', br1]).out.trim()).toBe('');
            expect(git(repo, ['branch', '--list', br2]).out.trim()).toBe('');
        } finally {
            for (const wt of wts) rmSync(wt, { recursive: true, force: true });
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('AC4 — a conflicting rebase is aborted: worktree retained clean on its original tip, branch intact, base untouched', () => {
        const repo = initRepo();
        const wts: string[] = [];
        try {
            baseCommit(repo, { 'base.md': 'line one\nline two\n' });
            const branch = 'sp/run-0060-c3';
            const wt = cutWorktree(repo, 'run-0060', branch);
            wts.push(wt);
            commitIn(wt, { 'base.md': 'task edit of line one\nline two\n' }, '0060 edits base.md');
            const branchTip = git(wt, ['rev-parse', 'HEAD']).out.trim();

            // Sibling integration advances the base over the same line — the rebase must conflict.
            writeFileSync(join(repo, 'base.md'), 'sibling edit of line one\nline two\n');
            git(repo, ['add', '.']);
            git(repo, ['commit', '-qm', 'sibling integration']);
            const baseTip = git(repo, ['rev-parse', 'HEAD']).out.trim();

            const rebase = integrate(repo, wt, branch);
            expect(rebase.exitCode).not.toBe(0); // conflict is real, not a silent pass

            // R4 response: abort only — no resolution attempted, nothing staged, tip restored.
            expect(git(wt, ['rebase', '--abort']).exitCode).toBe(0);
            expect(git(wt, ['rev-parse', 'HEAD']).out.trim()).toBe(branchTip);
            expect(git(wt, ['status', '--porcelain']).out.trim()).toBe('');

            // WT-5 retain: the worktree and branch survive; the base was never merged into.
            expect(existsSync(wt)).toBe(true);
            expect(git(repo, ['branch', '--list', branch]).out.trim()).toContain(branch);
            expect(git(repo, ['rev-parse', 'HEAD']).out.trim()).toBe(baseTip);
            expect(git(repo, ['rev-list', '--merges', '--count', baseTip]).out.trim()).toBe('0');
            expect(readFileSync(join(repo, 'base.md'), 'utf8')).toContain('sibling edit');
        } finally {
            for (const wt of wts) rmSync(wt, { recursive: true, force: true });
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('AC3 guard — a non-fast-forward base refuses --ff-only instead of creating a merge commit', () => {
        const repo = initRepo();
        const wts: string[] = [];
        try {
            baseCommit(repo, { 'base.md': 'base\n' });
            const branch = 'sp/run-0070-d4';
            const wt = cutWorktree(repo, 'run-0070', branch);
            wts.push(wt);
            commitIn(wt, { 'task-0070.md': '0070\n' }, '0070 work');

            // Base moves AFTER the task branch was cut and BEFORE integration, with no rebase.
            writeFileSync(join(repo, 'post.md'), 'advance base\n');
            git(repo, ['add', '.']);
            git(repo, ['commit', '-qm', 'advance base']);

            const checkout = git(repo, ['checkout', baseRef(repo)]);
            expect(checkout.exitCode).toBe(0);
            const ff = git(repo, ['merge', '--ff-only', branch]);
            // Without the rebase step the FF is refused — the driver's cue to treat it as a conflict
            // (R4), never to fall back to a merge commit.
            expect(ff.exitCode).not.toBe(0);
            expect(git(repo, ['rev-list', '--merges', '--count', 'HEAD']).out.trim()).toBe('0');
            expect(existsSync(wt)).toBe(true); // still retained; cleanup never ran
        } finally {
            for (const wt of wts) rmSync(wt, { recursive: true, force: true });
            rmSync(repo, { recursive: true, force: true });
        }
    });
});
