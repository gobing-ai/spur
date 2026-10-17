/**
 * builder show-branches E2E (task 1218). Every case builds a throwaway repository with real git under
 * the temp dir and runs the real CLI entry in that directory — no git stubs. Only `gh` is faked: the
 * "present" cases put a script on PATH, and the degradation cases run with a PATH that has no `gh`
 * at all, which is exactly the missing-binary path R5 must survive.
 *
 * The failure list first: no remote/origin HEAD, unknown --base, detached HEAD, single-branch repo,
 * branch names with `/`/`.`/quotes, more branches than --limit, a revert commit, a contained branch,
 * gh absent.
 *
 * A second suite dispatches the verb IN PROCESS (`registerBuilderShowBranchesCommand` + `parseAsync`)
 * against the same real-git fixtures. A spawned child is invisible to this process's coverage
 * instrumentation, so without it the wiring module's own lines and functions read as untested.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { getEnvVars } from '@gobing-ai/spur-config';
import { registerBuilderShowBranchesCommand } from '../../../src/commands/builder/show-branches';
import type { CliContext } from '../../../src/context';

const CLI_ENTRY = join(import.meta.dir, '..', '..', '..', 'src', 'index.ts');

/** Hermetic git: the operator's global config must not decide identity, branch names or signing. */
const GIT_ENV: Record<string, string | undefined> = {
    ...getEnvVars(),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
};

/** Every statement the operator-referenced mermaid syntax subset allows, and nothing else (R3). */
const ALLOWED_STATEMENTS = [
    /^gitGraph$/,
    /^%%\{init: \{ 'theme': '[A-Za-z0-9._/-]+' \} \}%%$/,
    /^ {4}commit id:"[^"]+"( tag:"[^"]+")?( type: (NORMAL|HIGHLIGHT|REVERSE))?$/,
    /^ {4}branch (?:"[^"]+"|[A-Za-z0-9._/-]+)$/,
    /^ {4}checkout (?:"[^"]+"|[A-Za-z0-9._/-]+)$/,
    /^ {4}merge (?:"[^"]+"|[A-Za-z0-9._/-]+)( tag:"[^"]+")?$/,
];

const roots: string[] = [];

afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `spur-${prefix}-`));
    roots.push(dir);
    return dir;
}

function git(cwd: string, args: string[]): string {
    const result = Bun.spawnSync(['git', ...args], { cwd, env: GIT_ENV });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
    return result.stdout.toString();
}

function commit(cwd: string, file: string, message: string): void {
    writeFileSync(join(cwd, file), `${message}\n`);
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-q', '-m', message]);
}

/** A repo on `main` with one commit and a `v0.1.0` tag; no remote and therefore no origin/HEAD. */
function mkRepo(): string {
    const repo = tempDir('sb-repo');
    git(repo, ['init', '-q', '-b', 'main', '.']);
    git(repo, ['config', '--local', 'user.email', 'test@example.com']);
    git(repo, ['config', '--local', 'user.name', 'Test']);
    commit(repo, 'a.txt', 'init');
    git(repo, ['tag', 'v0.1.0']);
    return repo;
}

interface CliRun {
    code: number;
    stdout: string;
    stderr: string;
}

/** Runs the real CLI entry in `cwd`. `:memory:` keeps the boot from creating a `.spur/` in the repo. */
function runCli(cwd: string, args: string[], env: Record<string, string | undefined> = {}): CliRun {
    const result = spawnSync(process.execPath, [CLI_ENTRY, 'builder', 'show-branches', ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...getEnvVars(), DATABASE_URL: ':memory:', ...env },
    });
    return { code: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The single fenced mermaid block body of a markdown report. */
function mermaidBlock(markdown: string): string {
    const lines = markdown.split('\n');
    const start = lines.indexOf('```mermaid');
    expect(start).toBeGreaterThan(-1);
    return lines.slice(start + 1, lines.indexOf('```', start + 1)).join('\n');
}

/** A PATH with no `gh` on it, so the CLI exercises the missing-binary branch — git stays reachable. */
function pathWithoutGh(gitBin: string): string {
    const bin = tempDir('sb-bin');
    const target = join(bin, 'git');
    if (!existsSync(target)) symlinkSync(gitBin, target);
    return bin;
}

function ghShim(body: string): string {
    const bin = tempDir('sb-ghbin');
    const shim = join(bin, 'gh');
    writeFileSync(shim, body);
    chmodSync(shim, 0o755);
    return bin;
}

/** A repo: tagged `main`, `feature/one` two commits ahead, contained `stale`. */
function mkTopologyRepo(): string {
    const repo = mkRepo();
    git(repo, ['checkout', '-q', '-b', 'feature/one']);
    commit(repo, 'b.txt', 'feat: one');
    commit(repo, 'c.txt', 'feat: two');
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['branch', 'stale']);
    return repo;
}

describe('spur builder show-branches — topology report', () => {
    test('reports every branch against the default base and leaves the repository untouched', () => {
        const repo = mkTopologyRepo();
        const refsBefore = git(repo, ['for-each-ref']);
        const worktreesBefore = git(repo, ['worktree', 'list', '--porcelain']);
        const toplevel = git(repo, ['rev-parse', '--show-toplevel']).trim();

        const run = runCli(repo, []);
        const worktreesAfter = git(repo, ['worktree', 'list', '--porcelain']);

        expect(run.code).toBe(0);
        expect(run.stderr).toBe('');
        expect(run.stdout).toContain('## Branch topology vs `main`');
        // base defaults to main with no origin/HEAD in the repo
        expect(run.stdout).toContain('| feature/one | 2 | 0 | no |');
        expect(run.stdout).toContain('| stale | 0 | 0 | yes |');
        expect(run.stdout).toContain(`| ${toplevel} |`);
        // read-only: no ref, worktree or working-tree change
        expect(git(repo, ['for-each-ref'])).toBe(refsBefore);
        expect(worktreesAfter).toBe(worktreesBefore);
        expect(git(repo, ['status', '--porcelain'])).toBe('');
    });

    test('markdown is the default format and carries one gitGraph block inside the allowed syntax', () => {
        const repo = mkTopologyRepo();
        const explicit = runCli(repo, ['--format', 'markdown']);
        const base = mermaidBlock(explicit.stdout);

        expect(explicit.code).toBe(0);
        expect(runCli(repo, []).stdout.replace(/Generated [^\n]+/, 'Generated X')).toBe(
            explicit.stdout.replace(/Generated [^\n]+/, 'Generated X'),
        );
        expect(base.split('\n')[0]).toBe('gitGraph');
        expect(base).toContain('    branch feature/one');
        expect(base).toContain('    merge stale');
        expect(base).toContain('tag:"v0.1.0"');
        expect(base).toContain('type: HIGHLIGHT');
        for (const line of base.split('\n')) {
            expect(ALLOWED_STATEMENTS.some((pattern) => pattern.test(line))).toBe(true);
        }
    });

    test('--json is byte-identical to --format json and exposes the frozen top-level shape', () => {
        const repo = mkTopologyRepo();
        const json = runCli(repo, ['--format', 'json']);
        const alias = runCli(repo, ['--json']);

        expect(json.code).toBe(0);
        // Two runs, so only the generated timestamp may differ.
        expect(alias.stdout.replace(/"generatedAt": "[^"]+"/, '"generatedAt": "X"')).toBe(
            json.stdout.replace(/"generatedAt": "[^"]+"/, '"generatedAt": "X"'),
        );
        const parsed = JSON.parse(json.stdout) as {
            base: string;
            generatedAt: string;
            branches: Array<{ name: string; ahead: number; contained: boolean; commits: unknown[] }>;
            omitted: number;
            warnings: string[];
        };
        expect(Object.keys(parsed).sort()).toEqual(['base', 'branches', 'generatedAt', 'omitted', 'warnings']);
        expect(parsed.base).toBe('main');
        expect(parsed.warnings).toEqual([]);
        expect(parsed.branches.map((row) => row.name)).toEqual(['feature/one', 'main', 'stale']);
        expect(parsed.branches[0]).toMatchObject({ ahead: 2, contained: false });
        expect(parsed.branches[0]?.commits).toHaveLength(3);
    });

    test('--format text prints the aligned table with no mermaid', () => {
        const repo = mkTopologyRepo();
        const text = runCli(repo, ['--format', 'text']);

        expect(text.code).toBe(0);
        expect(text.stdout).toContain('base: main');
        expect(text.stdout).toContain('branch');
        expect(text.stdout).not.toContain('gitGraph');
        expect(text.stdout).not.toContain('```');
        expect(text.stdout).toContain('feature/one');
    });

    test('--base overrides the base and an unknown base exits 1', () => {
        const repo = mkTopologyRepo();
        git(repo, ['checkout', '-q', 'main']);
        const overridden = runCli(repo, ['--base', 'stale', '--format', 'json']);

        expect(overridden.code).toBe(0);
        expect((JSON.parse(overridden.stdout) as { base: string }).base).toBe('stale');

        const unknown = runCli(repo, ['--base', 'no-such-ref', '--no-logo']);
        expect(unknown.code).toBe(1);
        expect(unknown.stderr).toContain("unknown base ref 'no-such-ref'");
        expect(unknown.stdout).toBe('');
    });

    test('a detached HEAD is reported as a row named by its short sha', () => {
        const repo = mkTopologyRepo();
        git(repo, ['checkout', '-q', '--detach', 'main']);
        const head = git(repo, ['rev-parse', '--short', 'HEAD']).trim();

        const run = runCli(repo, ['--format', 'json']);
        const rows = (JSON.parse(run.stdout) as { branches: Array<{ name: string; kind: string }> }).branches;

        expect(run.code).toBe(0);
        expect(rows.some((row) => row.kind === 'detached' && row.name === head.slice(0, 7))).toBe(true);
    });

    test('a single-branch repository renders the base line only', () => {
        const repo = mkRepo();
        const run = runCli(repo, []);

        expect(run.code).toBe(0);
        expect(mermaidBlock(run.stdout)).not.toContain('branch ');
        expect(run.stdout).toContain('| main | 0 | 0 | yes |');
    });

    test('branch names with slashes, dots and quotes render sanitized', () => {
        const repo = mkTopologyRepo();
        git(repo, ['checkout', '-q', '-b', 'fix/quote"name', 'main']);
        commit(repo, 'd.txt', 'feat: quote');
        git(repo, ['checkout', '-q', 'main']);
        git(repo, ['branch', '1.x']);
        git(repo, ['branch', 'stale.branch']);

        const run = runCli(repo, ['--format', 'json']);
        const names = (JSON.parse(run.stdout) as { branches: Array<{ name: string }> }).branches.map((row) => row.name);
        const graph = mermaidBlock(runCli(repo, []).stdout);

        expect(names).toContain('fix/quote"name');
        expect(graph).toContain('    branch fix/quote-name');
        // `1.x` cannot start a mermaid token, so it is quoted rather than renamed.
        expect(graph).toContain('    branch "1.x"');
        expect(graph).toContain('    merge "1.x"');
        expect(graph).toContain('    branch stale.branch');
        // The allow-list is checked on this real rendered graph, not only on hand-written fixtures.
        for (const line of graph.split('\n')) {
            expect(ALLOWED_STATEMENTS.some((pattern) => pattern.test(line))).toBe(true);
        }
    });

    test('a revert commit renders REVERSE while the branch tip stays HIGHLIGHT', () => {
        const repo = mkTopologyRepo();
        git(repo, ['checkout', '-q', 'feature/one']);
        git(repo, ['revert', '--no-edit', 'HEAD']);
        commit(repo, 'e.txt', 'feat: after revert');

        const graph = mermaidBlock(runCli(repo, []).stdout);

        expect(graph).toContain('type: REVERSE');
        expect(graph).toContain('type: HIGHLIGHT');
    });

    test('more branches than --limit prints the omitted footer and the json count', () => {
        const repo = mkTopologyRepo();
        for (const name of ['a', 'b', 'c']) git(repo, ['branch', name]);

        const markdown = runCli(repo, ['--limit', '2']);
        const json = runCli(repo, ['--limit', '2', '--format', 'json']);

        expect(markdown.code).toBe(0);
        expect(markdown.stdout).toContain('_Omitted: 4 branches beyond --limit._');
        expect((JSON.parse(json.stdout) as { omitted: number }).omitted).toBe(4);
        expect((JSON.parse(json.stdout) as { branches: unknown[] }).branches).toHaveLength(2);
    });

    test('--max-commits, --hide-contained and --theme shape the graph', () => {
        const repo = mkTopologyRepo();
        git(repo, ['checkout', '-q', 'feature/one']);
        for (const name of ['f1', 'f2', 'f3']) commit(repo, `${name}.txt`, `feat: ${name}`);
        git(repo, ['checkout', '-q', 'main']);

        const capped = mermaidBlock(runCli(repo, ['--max-commits', '1']).stdout);
        const themed = mermaidBlock(runCli(repo, ['--theme', 'neutral']).stdout);
        const hidden = mermaidBlock(runCli(repo, ['--hide-contained']).stdout);

        expect(capped).toContain('commit id:"+4 earlier"');
        expect(themed.split('\n')[0]).toBe("%%{init: { 'theme': 'neutral' } }%%");
        expect(hidden).not.toContain('branch stale');
        expect(hidden).toContain('branch feature/one');
        // --hide-contained narrows the graph only; the table still flags the stale branch.
        expect(runCli(repo, ['--hide-contained']).stdout).toContain('| stale | 0 | 0 | yes |');
    });

    test('usage errors exit 1 naming the offending flag', () => {
        const repo = mkTopologyRepo();
        const cases: Array<[string[], string]> = [
            [['--format', 'yaml'], "unknown --format 'yaml'"],
            [['--limit', '0'], '--limit expects a positive integer'],
            [['--max-commits', 'x'], '--max-commits expects a positive integer'],
            [['--local', '--remote'], 'mutually exclusive'],
            [['--json', '--format', 'text'], '--json conflicts with --format text'],
        ];
        for (const [args, message] of cases) {
            const run = runCli(repo, args);
            expect(run.code).toBe(1);
            expect(run.stderr).toContain(message);
        }
    });

    test('a directory that is not a repository exits 2', () => {
        const notARepo = tempDir('sb-notrepo');
        const run = runCli(notARepo, []);

        expect(run.code).toBe(2);
        expect(run.stderr).toContain('not a git repository');
    });
});

describe('spur builder show-branches — pull-request enrichment', () => {
    const PR_LIST =
        '[{"number":581,"headRefName":"feature/one","state":"OPEN","reviewDecision":"APPROVED"},' +
        '{"number":590,"headRefName":"main","state":"OPEN","reviewDecision":null}]';

    test('--pr enriches rows from the gh report', () => {
        const repo = mkTopologyRepo();
        const bin = ghShim(`#!/bin/sh\nprintf '%s\\n' '${PR_LIST}'\n`);
        const run = runCli(repo, ['--pr', '--format', 'json'], { PATH: `${bin}:${getEnvVars().PATH ?? ''}` });
        const rows = (JSON.parse(run.stdout) as { branches: Array<{ name: string; pr: unknown }> }).branches;

        expect(run.code).toBe(0);
        expect(run.stderr).toBe('');
        expect(rows.find((row) => row.name === 'feature/one')?.pr).toEqual({
            number: 581,
            state: 'OPEN',
            reviewDecision: 'APPROVED',
        });
        expect(rows.find((row) => row.name === 'stale')?.pr).toBeNull();
        expect(rows.find((row) => row.name === 'main')?.pr).toEqual({
            number: 590,
            state: 'OPEN',
            reviewDecision: null,
        });
    });

    test('gh missing degrades to null PR fields plus one warning, never a failure', () => {
        const repo = mkTopologyRepo();
        const gitBin = (Bun.which('git') ?? '/usr/bin/git') as string;
        const run = runCli(repo, ['--pr'], { PATH: pathWithoutGh(gitBin) });

        expect(run.code).toBe(0);
        expect(run.stdout).toContain('warning: --pr: gh pr list failed:');
        // Fixture commits carry the wall-clock date; read it back rather than pinning the authoring day.
        const day = git(repo, ['log', '-1', '--format=%cs', 'feature/one']).trim();
        expect(run.stdout).toContain(`| feature/one | 2 | 0 | no | ${day} | - | - |`);

        const json = runCli(repo, ['--pr', '--format', 'json'], { PATH: pathWithoutGh(gitBin) });
        const parsed = JSON.parse(json.stdout) as { warnings: string[]; branches: Array<{ pr: unknown }> };
        expect(parsed.warnings).toHaveLength(1);
        expect(parsed.branches.every((row) => row.pr === null)).toBe(true);
    });

    test('gh unauthenticated degrades with the reason and never a failure', () => {
        const repo = mkTopologyRepo();
        const bin = ghShim('#!/bin/sh\necho "gh: To get started with GitHub CLI, run: gh auth login" >&2\nexit 1\n');
        const run = runCli(repo, ['--pr', '--format', 'json'], { PATH: `${bin}:${getEnvVars().PATH ?? ''}` });
        const parsed = JSON.parse(run.stdout) as { warnings: string[]; branches: Array<{ pr: unknown }> };

        expect(run.code).toBe(0);
        expect(parsed.warnings).toHaveLength(1);
        expect(parsed.warnings[0]).toContain('gh auth login');
        expect(parsed.branches.every((row) => row.pr === null)).toBe(true);
    });
});

describe('spur builder show-branches — scopes, remotes and worktrees', () => {
    /** Adds `origin` plus a remote-only branch and points origin/HEAD at origin/main. */
    function withRemote(repo: string): void {
        const origin = tempDir('sb-origin');
        git(origin, ['init', '-q', '--bare', '.']);
        git(repo, ['remote', 'add', 'origin', origin]);
        git(repo, ['push', '-q', 'origin', 'main', 'feature/one']);
        git(repo, ['branch', 'only-remote', 'main']);
        git(repo, ['push', '-q', 'origin', 'only-remote']);
        git(repo, ['branch', '-D', 'only-remote']);
        git(repo, ['fetch', '-q', '--prune', 'origin']);
        git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    }

    test('the base comes from origin/HEAD and a remote twin folds into one local row', () => {
        const repo = mkTopologyRepo();
        withRemote(repo);
        const report = JSON.parse(runCli(repo, ['--format', 'json']).stdout) as {
            base: string;
            branches: Array<{ name: string; kind: string }>;
        };

        expect(report.base).toBe('origin/main');
        expect(report.branches.map((row) => row.name)).toEqual(['feature/one', 'main', 'origin/only-remote', 'stale']);
        expect(report.branches.find((row) => row.name === 'origin/only-remote')?.kind).toBe('remote');
    });

    test('--local and --remote select the ref namespace', () => {
        const repo = mkTopologyRepo();
        withRemote(repo);

        const local = JSON.parse(runCli(repo, ['--local', '--format', 'json']).stdout) as {
            branches: Array<{ name: string; kind: string }>;
        };
        const remote = JSON.parse(runCli(repo, ['--remote', '--format', 'json']).stdout) as {
            branches: Array<{ name: string; kind: string }>;
        };

        expect(local.branches.map((row) => row.name)).toEqual(['feature/one', 'main', 'stale']);
        expect(local.branches.every((row) => row.kind === 'local')).toBe(true);
        expect(remote.branches.map((row) => row.name)).toEqual([
            'origin/feature/one',
            'origin/main',
            'origin/only-remote',
        ]);
    });

    test('a branch checked out in a linked worktree reports that path, and none reports none', () => {
        const repo = mkTopologyRepo();
        const linked = join(tempDir('sb-linked'), 'tree');
        git(repo, ['worktree', 'add', '-q', linked, 'stale']);
        const report = JSON.parse(runCli(repo, ['--format', 'json']).stdout) as {
            branches: Array<{ name: string; worktree: string | null }>;
        };

        const stale = report.branches.find((row) => row.name === 'stale');
        // git reports the worktree by realpath, which on macOS resolves /var to /private/var.
        expect(stale?.worktree).toBe(realpathSync(linked));
        expect(report.branches.find((row) => row.name === 'feature/one')?.worktree).toBeNull();
    });
});

// ─── In-process dispatch ────────────────────────────────────────────────────
//
// Same verb, same real-git fixtures, no child process: registration and `parseAsync` run here, so
// every line and function of the wiring module is measured (the spawn-based suite above is coverage-
// blind by construction). Cases mirror the E2E list — flag validation, the three formats, gh
// degradation and both failure classes.

interface InProcessRun {
    lines: string[];
    exitCode: number;
}

/** Capture sink + exit code, mirroring the builder.test.ts context. */
function makeContext(
    cwd: string,
    env: Record<string, string | undefined> = getEnvVars(),
): { context: CliContext; lines: string[]; exitCode: () => number } {
    let code = 0;
    const lines: string[] = [];
    const context = {
        cwd,
        env,
        output: {
            write: (message: string) => lines.push(message),
            error: (message: string) => lines.push(`ERR ${message}`),
        },
        setExitCode: (next: number) => {
            code = next;
        },
    } as unknown as CliContext;
    return { context, lines, exitCode: () => code };
}

/** Register `show-branches` on a bare parent command and parse argv in this process. */
async function dispatch(cwd: string, args: string[], env?: Record<string, string | undefined>): Promise<InProcessRun> {
    const { context, lines, exitCode } = makeContext(cwd, env);
    const builder = new Command();
    builder.exitOverride();
    registerBuilderShowBranchesCommand(builder, context);
    await builder.parseAsync(['show-branches', ...args], { from: 'user' });
    return { lines, exitCode: exitCode() };
}

describe('spur builder show-branches — in-process dispatch', () => {
    test('default format is markdown: table plus one mermaid block, exit 0', async () => {
        const repo = mkTopologyRepo();
        const report = await dispatch(repo, []);

        expect(report.exitCode).toBe(0);
        const output = report.lines.join('\n');
        expect(output).toContain('## Branch topology vs `main`');
        expect(output).toContain('| branch | ahead | behind | contained | last commit | worktree | PR |');
        expect(output).toContain('| feature/one | 2 | 0 | no |');
        expect(mermaidBlock(output).split('\n')[0]).toBe('gitGraph');
    });

    test('--format json and its --json alias emit the same raw topology object', async () => {
        const repo = mkTopologyRepo();
        const json = await dispatch(repo, ['--format', 'json']);
        const alias = await dispatch(repo, ['--json']);

        expect(json.exitCode).toBe(0);
        expect(alias.exitCode).toBe(0);
        const parsed = JSON.parse(json.lines.join('\n')) as { base: string; branches: unknown[] };
        expect(parsed.base).toBe('main');
        expect(parsed.branches).toHaveLength(3);
        expect(alias.lines.join('\n').replace(/"generatedAt": "[^"]+"/, '"generatedAt": "X"')).toBe(
            json.lines.join('\n').replace(/"generatedAt": "[^"]+"/, '"generatedAt": "X"'),
        );
    });

    test('--format text prints the aligned table without mermaid', async () => {
        const repo = mkTopologyRepo();
        const text = await dispatch(repo, ['--format', 'text']);

        expect(text.exitCode).toBe(0);
        expect(text.lines.join('\n')).toContain('base: main');
        expect(text.lines.join('\n')).not.toContain('gitGraph');
    });

    test('--json conflicts with an explicit non-json --format', async () => {
        const repo = mkTopologyRepo();
        const report = await dispatch(repo, ['--json', '--format', 'markdown']);

        expect(report.exitCode).toBe(1);
        expect(report.lines.join('\n')).toContain('ERR --json conflicts with --format markdown');
    });

    test('an unknown --format names the three allowed values', async () => {
        const repo = mkTopologyRepo();
        const report = await dispatch(repo, ['--format', 'xml']);

        expect(report.exitCode).toBe(1);
        expect(report.lines.join('\n')).toContain("ERR unknown --format 'xml': expected markdown | json | text");
    });

    test.each([
        ['--limit', '0'],
        ['--limit', 'abc'],
        ['--max-commits', '0'],
    ])('%s %s is rejected as a usage error', async (flag, value) => {
        const repo = mkTopologyRepo();
        const report = await dispatch(repo, [flag, value]);

        expect(report.exitCode).toBe(1);
        expect(report.lines.join('\n')).toContain(`ERR ${flag} expects a positive integer, got '${value}'`);
    });

    test('--local with --remote is rejected', async () => {
        const repo = mkTopologyRepo();
        const report = await dispatch(repo, ['--local', '--remote']);

        expect(report.exitCode).toBe(1);
        expect(report.lines.join('\n')).toContain('ERR --local and --remote are mutually exclusive');
    });

    test('--pr degrades to a warning when gh is missing, exit 0', async () => {
        const repo = mkTopologyRepo();
        const gitBin = Bun.which('git') ?? '/usr/bin/git';
        const report = await dispatch(repo, ['--pr'], { ...getEnvVars(), PATH: pathWithoutGh(gitBin) });
        const output = report.lines.join('\n');

        expect(report.exitCode).toBe(0);
        expect(output).toContain('warning: --pr: gh pr list failed:');
        expect(output).toContain('| feature/one | 2 | 0 | no |');
    });

    test('--theme and --hide-contained shape the markdown graph', async () => {
        const repo = mkTopologyRepo();
        const report = await dispatch(repo, ['--theme', 'dark', '--hide-contained']);
        const graph = mermaidBlock(report.lines.join('\n'));

        expect(report.exitCode).toBe(0);
        expect(graph.split('\n')[0]).toBe("%%{init: { 'theme': 'dark' } }%%");
        expect(graph).not.toContain('branch stale');
        expect(report.lines.join('\n')).toContain('| stale | 0 | 0 | yes |');
    });

    test('an unknown --base is a usage error from the service', async () => {
        const repo = mkTopologyRepo();
        const report = await dispatch(repo, ['--base', 'no-such-ref']);

        expect(report.exitCode).toBe(1);
        expect(report.lines.join('\n')).toContain("ERR unknown base ref 'no-such-ref'");
    });

    test('a non-repository cwd is a git failure, exit 2', async () => {
        const notARepo = tempDir('sb-inprocess-notrepo');
        const report = await dispatch(notARepo, []);

        expect(report.exitCode).toBe(2);
        expect(report.lines.join('\n')).toContain('ERR not a git repository');
    });

    test.each([
        [new Error('sink exploded'), 'sink exploded'],
        ['boom', 'boom'],
    ])('a failure outside git (%s) is reported as exit 2', async (thrown, message) => {
        // The last catch arm is reachable only by an unexpected failure — a throwing output sink is
        // the one such path this module has, and it must degrade instead of crashing the CLI.
        const repo = mkTopologyRepo();
        let code = 0;
        const reported: string[] = [];
        const context = {
            cwd: repo,
            env: getEnvVars(),
            output: {
                write: () => {
                    throw thrown;
                },
                error: (text: string) => reported.push(text),
            },
            setExitCode: (next: number) => {
                code = next;
            },
        } as unknown as CliContext;
        const builder = new Command();
        builder.exitOverride();
        registerBuilderShowBranchesCommand(builder, context);

        await builder.parseAsync(['show-branches'], { from: 'user' });

        expect(code).toBe(2);
        expect(reported.join('\n')).toContain(message);
    });
});
