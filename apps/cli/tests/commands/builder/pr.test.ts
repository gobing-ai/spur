/**
 * Tests for `spur builder pr-<verb>` (the four flat composers, task 1219) and its hidden
 * `pr [argv...]` alias (script-absorption PR-7). The spine is pinned by
 * packages/app/tests/services/pr-review; this pins the Commander surface, the per-verb
 * composition against the former op sequence, and the exit-code/verdict contract.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import { type CmdResult, main as runPrReviewMain, setCommandRunner } from '@gobing-ai/spur-app/pr-review';
import { getEnvVars } from '@gobing-ai/spur-config';
import { registerBuilderCommand } from '../../../src/commands/builder';
import type { CliContext } from '../../../src/context';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

/** A context whose output and exit code are captured, so a Command action is observable. */
function makeContext(cwd: string): { context: CliContext; lines: string[]; exitCode: () => number } {
    let code = 0;
    const lines: string[] = [];
    const context = {
        cwd,
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

async function run(argv: string[]) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd: tmpdir(), output, env: { PATH: getEnvVars().PATH } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

describe('spur builder pr', () => {
    test('help subcommand prints the spine usage (exit 0)', async () => {
        const r = await run(['builder', 'pr', 'help']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('spur builder pr');
    });

    test('an unknown subcommand is a usage error (exit 1)', async () => {
        const r = await run(['builder', 'pr', 'bogus']);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('unknown subcommand: bogus');
    });

    test('unknown flags reach the spine parser instead of Commander', async () => {
        // Same as the retired script: a parser throw is a hard failure (exit 2) with the reason.
        const r = await run(['builder', 'pr', 'wait', '--bogus']);
        expect(r.exitCode).toBe(2);
        expect(r.stderr).toContain('unknown argument');
    });
});

// ─── 1215: the adapter forwards its invocation cwd/env to the PR spine ────────
//
// Two real throwaway repositories; only `gh` is faked (no network). The process runs inside the
// checkout while the CLI context selects repository B, so a pre-fix (context-less) adapter would
// resolve the checkout's repository and fail the root assertion.

describe('spur builder pr execution context (1215)', () => {
    let root = '';
    let binDir = '';
    let repoA = '';
    let repoB = '';
    let nonGit = '';
    let origPath = '';

    /** Bare remote belonging to a fixture repo (created by {@link makeRepo}). */
    const remoteOf = (repo: string): string => join(root, `${basename(repo)}-remote.git`);

    const makeRepo = (name: string, branch: string): string => {
        const dir = realpathSync(mkdtempSync(join(root, name)));
        const git = (args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
        git(['init', '-q']);
        git(['checkout', '-q', '-b', branch]);
        writeFileSync(join(dir, 'file.txt'), `${name}\n`);
        git(['add', 'file.txt']);
        git([
            '-c',
            'commit.gpgsign=false',
            '-c',
            'user.email=ctx@example.com',
            '-c',
            'user.name=Ctx',
            'commit',
            '-q',
            '-m',
            'init',
        ]);
        // A real bare remote beside the repo, so a mutation-capable operation can push for
        // real — the mutation itself is not faked, only `gh` is.
        spawnSync('git', ['init', '-q', '--bare', remoteOf(dir)], { encoding: 'utf8' });
        git(['remote', 'add', 'origin', remoteOf(dir)]);
        return dir;
    };

    const fakeGh = [
        '#!/bin/sh',
        'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
        'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then',
        `  printf '{"nameWithOwner":"octo/%s","defaultBranchRef":{"name":"main"}}\\n' "\${PR_REVIEW_FIXTURE_ENV:-none}"`,
        '  exit 0',
        'fi',
        'exit 1',
        '',
    ].join('\n');

    const contextEnv = (marker: string): Record<string, string | undefined> => ({
        ...getEnvVars(),
        PATH: `${binDir}:${origPath}`,
        DATABASE_URL: ':memory:',
        PR_REVIEW_FIXTURE_ENV: marker,
    });

    const runWithContext = async (argv: string[], cwd: string, env: Record<string, string | undefined>) => {
        const output = createCapturedOutput();
        const exitCode = await main(argv, { cwd, output, env });
        return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
    };

    const jsonLine = (stdout: string): string => {
        const line = stdout.split('\n').find((l) => l.trim().startsWith('{'));
        if (line === undefined) throw new Error(`no JSON object in output: ${stdout}`);
        return line.trim();
    };

    beforeEach(() => {
        root = realpathSync(mkdtempSync(join(tmpdir(), 'pr-ctx-')));
        binDir = join(root, 'bin');
        mkdirSync(binDir);
        writeFileSync(join(binDir, 'gh'), fakeGh);
        chmodSync(join(binDir, 'gh'), 0o755);
        repoA = makeRepo('repo-a', 'feat/a');
        repoB = makeRepo('repo-b', 'feat/b');
        nonGit = mkdtempSync(join(tmpdir(), 'pr-nongit-'));
        origPath = getEnvVars().PATH ?? '';
        // Keep the *process* PATH on the fake gh too, so a context-less adapter cannot reach the
        // network — the regression still fails because it resolves the process checkout's root.
        getEnvVars().PATH = `${binDir}:${origPath}`;
    });

    afterEach(() => {
        getEnvVars().PATH = origPath;
        rmSync(root, { recursive: true, force: true });
        rmSync(nonGit, { recursive: true, force: true });
    });

    test('preflight resolves the context cwd repository, not the process checkout', async () => {
        const checkoutRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
            encoding: 'utf8',
            cwd: process.cwd(),
        }).stdout.trim();
        const r = await runWithContext(
            ['builder', 'pr', 'preflight', '--json', '--status-file', 'pr.status'],
            repoB,
            contextEnv('marker-b'),
        );
        expect(r.exitCode).toBe(0);
        const payload = JSON.parse(jsonLine(r.stdout)) as {
            repoRoot: string;
            branch: string;
            nameWithOwner: string;
        };
        expect(payload.repoRoot).toBe(repoB);
        expect(payload.repoRoot).not.toBe(repoA);
        expect(payload.repoRoot).not.toBe(checkoutRoot);
        expect(payload.branch).toBe('feat/b');
        expect(payload.nameWithOwner).toBe('octo/marker-b');
        expect(readFileSync(join(repoB, 'pr.status'), 'utf8').trim()).toBe('PASS');
    });

    test('consecutive invocations bind to their own repository', async () => {
        const a = await runWithContext(['builder', 'pr', 'preflight', '--json'], repoA, contextEnv('marker-a'));
        const b = await runWithContext(['builder', 'pr', 'preflight', '--json'], repoB, contextEnv('marker-b'));
        expect(JSON.parse(jsonLine(a.stdout))).toMatchObject({ repoRoot: repoA, nameWithOwner: 'octo/marker-a' });
        expect(JSON.parse(jsonLine(b.stdout))).toMatchObject({ repoRoot: repoB, nameWithOwner: 'octo/marker-b' });
    });

    test('an explicitly selected non-git directory refuses instead of inspecting the checkout', async () => {
        const checkoutRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
            encoding: 'utf8',
            cwd: process.cwd(),
        }).stdout.trim();
        expect(checkoutRoot).not.toBe('');
        const r = await runWithContext(['builder', 'pr', 'preflight', '--json'], nonGit, contextEnv('marker-b'));
        expect(r.exitCode).toBe(2);
        expect(r.stderr).toContain('not a git repository');
        expect(r.stdout).not.toContain(checkoutRoot);
    });

    test('a mutation-capable operation (push) mutates the context repository, not the process checkout', async () => {
        const r = await runWithContext(
            ['builder', 'pr', 'push', '--json', '--status-file', 'push.status'],
            repoB,
            contextEnv('marker-b'),
        );
        expect(r.exitCode).toBe(0);
        const payload = JSON.parse(jsonLine(r.stdout)) as { pushed: boolean; head: string };
        expect(payload.pushed).toBe(true);
        // The remote mutation landed in B's remote …
        const pushed = spawnSync('git', ['-C', remoteOf(repoB), 'rev-parse', 'refs/heads/feat/b'], {
            encoding: 'utf8',
        });
        expect(pushed.status).toBe(0);
        expect(pushed.stdout.trim()).toBe(payload.head);
        // … not in A's, and the status file landed beneath the context cwd.
        const untouched = spawnSync('git', ['-C', remoteOf(repoA), 'rev-parse', '--verify', 'refs/heads/feat/b'], {
            encoding: 'utf8',
        });
        expect(untouched.status).not.toBe(0);
        expect(readFileSync(join(repoB, 'push.status'), 'utf8').trim()).toBe('PUSHED');
        expect(existsSync(join(repoA, 'push.status'))).toBe(false);
    });
});

// ─── 1219: the four flat pr-<verb> composers ────────────────────────────────
//
// Each verb is a composition of the absorbed ops. Every case runs BOTH sides against the same
// stubbed git/gh responses — the verb through the CLI, the former op sequence through the service
// `main()` — and compares stdout JSON, the `--status-file` verdict and the exit code (R2).
// The failure list first: a preflight FAIL stops before hygiene, a rejected push stops before
// ensure, ALREADY_REVIEWED collects without a new request, `--no-wait` stops at PENDING, a wait
// timeout exits 3 with PENDING, and usage errors write no status file.

/** Mutable git/gh state behind the stub runner; each side of a comparison gets its own. */
interface PrFixture {
    dir: string;
    branch: string;
    head: string;
    upstream: string | null;
    remoteHead: string | null;
    dirty: string;
    diffFiles: string;
    diffText: string;
    pr: Record<string, unknown> | null;
    reviews: unknown[];
    inline: unknown[];
    comments: unknown[];
    checks: unknown[] | null;
    reviewAfterRequest: unknown[];
    /** `gh pr comment` argv, so a case can prove whether a request was posted. */
    posted: string[];
    calls: string[];
}

const PR_HEAD = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const PR_RECORD = {
    number: 7,
    url: 'https://github.com/octo/repo/pull/7',
    state: 'OPEN',
    isDraft: false,
    headRefName: 'feat/x',
    baseRefName: 'main',
    title: 'feat: x',
    headRefOid: PR_HEAD,
};
const CLEAN_REVIEW = {
    user: { login: 'chatgpt-codex-connector[bot]', type: 'Bot' },
    commit_id: PR_HEAD,
    submitted_at: '2999-01-01T00:00:00Z',
    state: 'COMMENTED',
    body: 'No actionable findings.',
};
const INLINE_FINDING = {
    user: { login: 'codex[bot]', type: 'Bot' },
    commit_id: PR_HEAD,
    created_at: '2999-01-01T00:00:00Z',
    path: 'src/a.ts',
    line: 42,
    body: '**P1** bug',
    html_url: 'https://github.com/octo/repo/pull/7#discussion_r1',
};
const PENDING_REQUEST_COMMENT = {
    user: { login: 'robin', type: 'User' },
    created_at: '2999-01-01T00:00:00Z',
    body: `@codex review\n\n<!-- spur-pr-review head:${PR_HEAD} -->`,
    html_url: 'https://github.com/octo/repo/pull/7#issuecomment-1',
};

const verbDirs: string[] = [];

function makeFixture(overrides: Partial<PrFixture> = {}): PrFixture {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pr-verb-')));
    verbDirs.push(dir);
    return {
        dir,
        branch: 'feat/x',
        head: PR_HEAD,
        upstream: 'origin/feat/x',
        remoteHead: PR_HEAD,
        dirty: '',
        diffFiles: 'src/a.ts\n',
        diffText: 'diff --git a/src/a.ts b/src/a.ts\n+const a = 1;\n',
        pr: { ...PR_RECORD },
        reviews: [],
        inline: [],
        comments: [],
        checks: [],
        reviewAfterRequest: [],
        posted: [],
        calls: [],
        ...overrides,
    };
}

/** In-process git/gh stub: same responses for the CLI verb and the legacy op sequence. */
function makeRunner(state: PrFixture) {
    const ok = (stdout = ''): CmdResult => ({ code: 0, stdout, stderr: '' });
    const fail = (stderr: string): CmdResult => ({ code: 1, stdout: '', stderr });
    const json = (value: unknown): CmdResult => ok(`${JSON.stringify(value)}\n`);
    const git = (argv: string): CmdResult => {
        if (argv === 'rev-parse --show-toplevel') return ok(`${state.dir}\n`);
        if (argv === 'branch --show-current') return ok(`${state.branch}\n`);
        if (argv === 'rev-parse HEAD') return ok(`${state.head}\n`);
        if (argv === 'status --porcelain') return ok(state.dirty);
        if (argv === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
            return state.upstream === null ? fail('') : ok(`${state.upstream}\n`);
        }
        if (argv === 'rev-parse @{u}') return ok(`${state.remoteHead ?? ''}\n`);
        if (argv === 'push' || argv === 'push -u origin HEAD') {
            state.remoteHead = state.head;
            state.upstream = `origin/${state.branch}`;
            return ok();
        }
        if (argv.startsWith('log --oneline ')) return ok(`${state.head.slice(0, 7)} feat: x\n`);
        if (argv.startsWith('diff --name-only --diff-filter=AMCR ')) return ok(state.diffFiles);
        if (argv.startsWith('diff ')) return ok(state.diffText);
        return fail(`unexpected git call: ${argv}\n`);
    };
    const gh = (argv: string): CmdResult => {
        if (argv === 'auth status') return ok('Logged in to github.com\n');
        if (argv === 'repo view --json nameWithOwner,defaultBranchRef') {
            return json({ nameWithOwner: 'octo/repo', defaultBranchRef: { name: 'main' } });
        }
        if (argv === 'pr view --json number,url,state,isDraft,headRefName,baseRefName,title,headRefOid') {
            return state.pr === null ? fail('no pull requests found for branch\n') : json(state.pr);
        }
        if (argv.startsWith('pr create --fill --base ')) {
            state.pr = { ...PR_RECORD };
            return ok('https://github.com/octo/repo/pull/7\n');
        }
        if (argv.startsWith('pr comment ')) {
            state.posted.push(argv);
            state.reviews = [...state.reviewAfterRequest];
            return ok();
        }
        if (argv.startsWith('pr checks ')) return state.checks === null ? fail('') : json(state.checks);
        if (argv === 'api user --jq .login') return ok('robin\n');
        if (/^api --method GET repos\/octo\/repo\/issues\/\d+\/comments --paginate --slurp$/.test(argv)) {
            return ok(`[${JSON.stringify(state.comments)}]\n`);
        }
        if (/^api --method GET repos\/octo\/repo\/pulls\/\d+\/comments --paginate --slurp$/.test(argv)) {
            return ok(`[${JSON.stringify(state.inline)}]\n`);
        }
        if (/^api --method GET repos\/octo\/repo\/pulls\/\d+\/reviews --paginate --slurp$/.test(argv)) {
            return ok(`[${JSON.stringify(state.reviews)}]\n`);
        }
        return fail(`unexpected gh call: ${argv}\n`);
    };
    return (cmd: readonly string[]): CmdResult => {
        const [bin, ...rest] = cmd;
        const argv = rest.join(' ');
        state.calls.push(`${bin} ${argv}`);
        if (bin === 'git') return git(argv);
        if (bin === 'gh') return gh(argv);
        return fail(`unexpected call: ${cmd.join(' ')}\n`);
    };
}

/** Last JSON object on a sink's lines — every op emits exactly one in `--json` mode. */
function payloadOf(lines: readonly string[]): Record<string, unknown> | null {
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = (lines[i] ?? '').trim();
        if (!line.startsWith('{')) continue;
        try {
            return JSON.parse(line) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
    return null;
}

function readStatus(state: PrFixture, name: string): string {
    const path = join(state.dir, name);
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : 'NO-STATUS-FILE';
}

/** Invoke one flat verb through the CLI against a fixture-bound stub runner. */
async function runVerb(state: PrFixture, argv: string[]) {
    setCommandRunner(makeRunner(state));
    try {
        const output = createCapturedOutput();
        const exitCode = await main(argv, { cwd: state.dir, output, env: { PATH: getEnvVars().PATH } });
        return {
            exitCode,
            stdout: output.messages.join('\n'),
            stderr: output.errors.join('\n'),
            payload: payloadOf(output.messages),
        };
    } finally {
        setCommandRunner();
    }
}

/** Run the former op sequence in-process; the shell driver's file-var plumbing is test-local. */
function runOp(state: PrFixture, op: string[]) {
    setCommandRunner(makeRunner(state));
    const lines: string[] = [];
    const errs: string[] = [];
    const code = runPrReviewMain(
        op,
        { out: (line) => lines.push(line), err: (line) => errs.push(line) },
        {
            cwd: state.dir,
            env: {},
        },
    );
    return { code, lines, errs, payload: payloadOf(lines) };
}

/** `repoRoot`/`requestedAt` name the fixture, not the composition — normalize before comparing. */
function stable(payload: unknown): unknown {
    if (payload === null || payload === undefined) return payload ?? null;
    const { repoRoot, requestedAt, ...rest } = payload as Record<string, unknown>;
    void repoRoot;
    void requestedAt;
    return rest;
}

/** The former `request → wait → collect` route, rebuilding the argv from the request record. */
function legacyReviewOps(state: PrFixture, mode: { force?: boolean; noWait?: boolean; timeout?: string } = {}) {
    const statusFile = 'review.status';
    const request = runOp(state, [
        'request',
        '--json',
        '--status-file',
        statusFile,
        ...(mode.force === true ? ['--force'] : []),
    ]);
    if (request.code !== 0) return { code: request.code, request: request.payload, collected: null, waited: null };
    const requestRecord = request.payload ?? {};
    const since = typeof requestRecord.requestedAt === 'string' ? requestRecord.requestedAt : '';
    const head = typeof requestRecord.head === 'string' ? requestRecord.head : '';
    const collected = () =>
        runOp(state, ['collect', '--since', since, '--head', head, '--json', '--status-file', statusFile]);
    if (requestRecord.alreadyReviewed === true)
        return { code: 0, request: request.payload, collected: collected(), waited: null };
    if (requestRecord.pending === true || (requestRecord.requested === true && mode.noWait === true)) {
        return { code: 0, request: request.payload, collected: null, waited: null };
    }
    const waited = runOp(state, [
        'wait',
        '--since',
        since,
        '--head',
        head,
        '--timeout',
        mode.timeout ?? '600',
        '--interval',
        '1',
        '--json',
        '--status-file',
        statusFile,
    ]);
    if (waited.code !== 0)
        return { code: waited.code, request: request.payload, collected: null, waited: waited.payload };
    return { code: 0, request: request.payload, collected: collected(), waited: waited.payload };
}

afterEach(() => {
    setCommandRunner();
    for (const dir of verbDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('spur builder pr-<verb> composition parity (1219)', () => {
    test('pr-check equals preflight → hygiene (stdout JSON parts, verdict, exit)', async () => {
        const legacy = makeFixture();
        const next = makeFixture();
        const preflight = runOp(legacy, ['preflight', '--base', 'main', '--json', '--status-file', 'check.status']);
        const hygiene = runOp(legacy, ['hygiene', '--base', 'main', '--json', '--status-file', 'check.status']);
        const verb = await runVerb(next, [
            'builder',
            'pr-check',
            '--base',
            'main',
            '--json',
            '--status-file',
            'check.status',
        ]);

        expect(hygiene.code).toBe(0);
        expect(verb.exitCode).toBe(0);
        expect(stable(verb.payload?.preflight)).toEqual(stable(preflight.payload));
        expect(stable(verb.payload?.hygiene)).toEqual(stable(hygiene.payload));
        expect(verb.payload?.verdict).toBe('PASS');
        expect(verb.payload?.ok).toBe(true);
        expect(readStatus(next, 'check.status')).toBe(readStatus(legacy, 'check.status'));
        expect(readStatus(next, 'check.status')).toBe('PASS');
    });

    test('pr-check stops after a preflight FAIL: no hygiene probe, verdict FAIL, exit 2', async () => {
        const state = makeFixture({ dirty: ' M src/a.ts\n' });
        const verb = await runVerb(state, [
            'builder',
            'pr-check',
            '--base',
            'main',
            '--json',
            '--status-file',
            'check.status',
        ]);

        expect(verb.exitCode).toBe(2);
        expect(readStatus(state, 'check.status')).toBe('FAIL');
        expect(verb.payload?.verdict).toBe('FAIL');
        expect(verb.payload?.hygiene).toBeNull();
        expect(stable(verb.payload?.preflight)).toMatchObject({ ok: false });
        expect(state.calls.some((call) => call.startsWith('git diff'))).toBe(false);
    });

    test('pr-check BLOCK is a verdict: BLOCK status, hygiene part, exit 2', async () => {
        const state = makeFixture({ diffFiles: '.env\n', diffText: '+AKIAIOSFODNN7EXAMPLE\n' });
        const verb = await runVerb(state, [
            'builder',
            'pr-check',
            '--base',
            'main',
            '--json',
            '--status-file',
            'check.status',
        ]);

        expect(verb.exitCode).toBe(2);
        expect(readStatus(state, 'check.status')).toBe('BLOCK');
        expect(verb.payload?.verdict).toBe('BLOCK');
        expect((verb.payload?.hygiene as { verdict?: string } | null)?.verdict).toBe('BLOCK');
    });

    test('pr-check --scan-only skips preflight on a dirty tree', async () => {
        const state = makeFixture({ dirty: ' M src/a.ts\n' });
        const verb = await runVerb(state, [
            'builder',
            'pr-check',
            '--scan-only',
            '--json',
            '--status-file',
            'check.status',
        ]);

        expect(verb.exitCode).toBe(0);
        expect(readStatus(state, 'check.status')).toBe('PASS');
        expect(verb.payload?.preflight).toBeNull();
        // Preflight's clean-tree probe is the only call that separates the two modes.
        expect(state.calls.filter((call) => call === 'git status --porcelain')).toEqual([]);
    });

    test('pr-open equals push → ensure (stdout JSON parts, verdict, exit)', async () => {
        const legacy = makeFixture({ pr: null, upstream: null, remoteHead: null });
        const next = makeFixture({ pr: null, upstream: null, remoteHead: null });
        const push = runOp(legacy, ['push', '--json', '--status-file', 'open.status']);
        const ensure = runOp(legacy, ['ensure', '--base', 'main', '--json', '--status-file', 'open.status']);
        const verb = await runVerb(next, [
            'builder',
            'pr-open',
            '--base',
            'main',
            '--json',
            '--status-file',
            'open.status',
        ]);

        expect(ensure.code).toBe(0);
        expect(verb.exitCode).toBe(0);
        expect(stable(verb.payload?.push)).toEqual(stable(push.payload));
        expect(verb.payload?.pr).toEqual(ensure.payload?.pr);
        expect(verb.payload?.verdict).toBe('CREATED');
        expect(readStatus(next, 'open.status')).toBe(readStatus(legacy, 'open.status'));
        expect(readStatus(next, 'open.status')).toBe('CREATED');
    });

    test('pr-open reuses an existing PR (FOUND)', async () => {
        const state = makeFixture();
        const verb = await runVerb(state, [
            'builder',
            'pr-open',
            '--base',
            'main',
            '--json',
            '--status-file',
            'open.status',
        ]);

        expect(verb.exitCode).toBe(0);
        expect(readStatus(state, 'open.status')).toBe('FOUND');
        expect(verb.payload?.verdict).toBe('FOUND');
        expect(state.calls.some((call) => call.startsWith('gh pr create'))).toBe(false);
    });

    test('pr-open stops after a rejected push: no ensure call, verdict FAIL, exit 2', async () => {
        const state = makeFixture({ remoteHead: 'ffff0000ffff0000ffff0000ffff0000ffff0000' });
        // A non-fast-forward push: the stub rejects it through the runner's error channel.
        const runner = makeRunner(state);
        setCommandRunner((cmd) =>
            cmd.join(' ') === 'git push' ? { code: 1, stdout: '', stderr: 'rejected\n' } : runner(cmd),
        );
        const output = createCapturedOutput();
        const exitCode = await main(['builder', 'pr-open', '--json', '--status-file', 'open.status'], {
            cwd: state.dir,
            output,
            env: { PATH: getEnvVars().PATH },
        });
        setCommandRunner();

        expect(exitCode).toBe(2);
        expect(readStatus(state, 'open.status')).toBe('FAIL');
        expect(state.calls.some((call) => call.startsWith('gh pr view'))).toBe(false);
    });

    test('pr-status equals status + collect, with the collect result as `review`', async () => {
        const legacy = makeFixture({ inline: [INLINE_FINDING] });
        const next = makeFixture({ inline: [INLINE_FINDING] });
        const status = runOp(legacy, ['status', '--head', PR_HEAD, '--json']);
        const collect = runOp(legacy, ['collect', '--head', PR_HEAD, '--json']);
        const verb = await runVerb(next, ['builder', 'pr-status', '--head', PR_HEAD, '--json']);

        expect(collect.code).toBe(0);
        expect(verb.exitCode).toBe(0);
        expect(verb.payload).toMatchObject(status.payload as object);
        expect(verb.payload?.review).toEqual(collect.payload);
        expect((verb.payload?.review as { verdict?: string } | null)?.verdict).toBe('FINDINGS');
    });

    test('pr-status is read-only: no PR means review null, exit 0, no verdict file', async () => {
        const state = makeFixture({ pr: null, reviews: [], checks: null });
        const verb = await runVerb(state, ['builder', 'pr-status', '--json', '--status-file', 'status.status']);

        expect(verb.exitCode).toBe(0);
        expect(verb.payload?.review).toBeNull();
        expect(readStatus(state, 'status.status')).toBe('NO-STATUS-FILE');
        expect(state.calls.some((call) => call.startsWith('gh pr comment'))).toBe(false);
    });

    test('pr-status fails loud when the pinned head no longer matches the PR head', async () => {
        const state = makeFixture();
        const verb = await runVerb(state, [
            'builder',
            'pr-status',
            '--head',
            'ffff0000ffff0000ffff0000ffff0000ffff0000',
            '--json',
        ]);

        expect(verb.exitCode).toBe(2);
        expect(verb.stderr).toContain('PR HEAD moved');
    });

    test('pr-review equals request → wait → collect on a clean review', async () => {
        const legacy = makeFixture({ reviewAfterRequest: [CLEAN_REVIEW] });
        const next = makeFixture({ reviewAfterRequest: [CLEAN_REVIEW] });
        const ops = legacyReviewOps(legacy);
        const verb = await runVerb(next, ['builder', 'pr-review', '--json', '--status-file', 'review.status']);

        expect(ops.code).toBe(0);
        expect(ops.collected?.code).toBe(0);
        expect(verb.exitCode).toBe(0);
        expect(verb.payload?.verdict).toBe('CLEAN');
        expect(verb.payload?.findings).toEqual([]);
        expect(stable(verb.payload?.request)).toEqual(stable(ops.request));
        expect(verb.payload?.findings).toEqual(ops.collected?.payload?.findings ?? []);
        expect(readStatus(next, 'review.status')).toBe(readStatus(legacy, 'review.status'));
        expect(readStatus(next, 'review.status')).toBe('CLEAN');
    });

    test('pr-review returns FINDINGS with the collected findings', async () => {
        const legacy = makeFixture({ inline: [INLINE_FINDING] });
        const next = makeFixture({ inline: [INLINE_FINDING] });
        const ops = legacyReviewOps(legacy);
        const verb = await runVerb(next, ['builder', 'pr-review', '--json', '--status-file', 'review.status']);

        expect(ops.code).toBe(0);
        expect(verb.exitCode).toBe(0);
        expect(verb.payload?.verdict).toBe('FINDINGS');
        expect(verb.payload?.findings).toEqual(ops.collected?.payload?.findings ?? []);
        expect(readStatus(next, 'review.status')).toBe('FINDINGS');
    });

    test('pr-review collects an already-reviewed head without posting a second request', async () => {
        const legacy = makeFixture({ reviews: [CLEAN_REVIEW] });
        const next = makeFixture({ reviews: [CLEAN_REVIEW] });
        const ops = legacyReviewOps(legacy);
        const verb = await runVerb(next, ['builder', 'pr-review', '--json', '--status-file', 'review.status']);

        expect(ops.request?.alreadyReviewed).toBe(true);
        expect(verb.exitCode).toBe(0);
        expect(verb.payload?.verdict).toBe('CLEAN');
        expect(verb.payload?.request).toMatchObject({ alreadyReviewed: true });
        expect(next.posted).toEqual([]);
        expect(next.calls.some((call) => call.startsWith('git rev-parse @{u}'))).toBe(false);
        expect(readStatus(next, 'review.status')).toBe(readStatus(legacy, 'review.status'));
    });

    test('pr-review --no-wait stops at PENDING right after the request', async () => {
        const next = makeFixture();
        const verb = await runVerb(next, [
            'builder',
            'pr-review',
            '--no-wait',
            '--json',
            '--status-file',
            'review.status',
        ]);

        expect(verb.exitCode).toBe(0);
        expect(verb.payload?.verdict).toBe('PENDING');
        expect(verb.payload?.findings).toEqual([]);
        expect(next.posted).toHaveLength(1);
        // Pending is the verb's verdict word, not the request op's REQUESTED.
        expect(readStatus(next, 'review.status')).toBe('PENDING');
        // The request op polls reviews once for its per-HEAD dedupe; a wait would poll again.
        expect(next.calls.filter((call) => call.includes('pulls/7/reviews --paginate'))).toHaveLength(1);
    });

    test('pr-review reports an in-flight request as PENDING without polling', async () => {
        const state = makeFixture({ comments: [PENDING_REQUEST_COMMENT] });
        const verb = await runVerb(state, ['builder', 'pr-review', '--json', '--status-file', 'review.status']);

        expect(verb.exitCode).toBe(0);
        expect(verb.payload?.verdict).toBe('PENDING');
        expect(verb.payload?.request).toMatchObject({ pending: true });
        expect(readStatus(state, 'review.status')).toBe('PENDING');
        expect(state.posted).toEqual([]);
    });

    test('pr-review exit 3 on a wait timeout carries the PENDING verdict, never FAIL', async () => {
        const legacy = makeFixture();
        const next = makeFixture();
        const ops = legacyReviewOps(legacy, { timeout: '0' });
        const verb = await runVerb(next, [
            'builder',
            'pr-review',
            '--timeout',
            '0',
            '--interval',
            '1',
            '--json',
            '--status-file',
            'review.status',
        ]);

        expect(ops.code).toBe(3);
        expect(readStatus(legacy, 'review.status')).toBe('TIMEOUT');
        expect(verb.exitCode).toBe(3);
        expect(verb.payload?.verdict).toBe('PENDING');
        expect(readStatus(next, 'review.status')).toBe('PENDING');
        expect(next.posted).toHaveLength(1);
    });

    test('an unknown flag is a usage error naming the flag, with no status file', async () => {
        const state = makeFixture();
        const verb = await runVerb(state, [
            'builder',
            'pr-check',
            '--bogus',
            '--json',
            '--status-file',
            'check.status',
        ]);

        expect(verb.exitCode).toBe(1);
        expect(verb.stderr).toContain('--bogus');
        expect(readStatus(state, 'check.status')).toBe('NO-STATUS-FILE');
        expect(state.calls).toEqual([]);
    });

    test('a bad --timeout value is a usage error with no status file', async () => {
        const state = makeFixture();
        const verb = await runVerb(state, [
            'builder',
            'pr-review',
            '--timeout',
            'soon',
            '--json',
            '--status-file',
            'review.status',
        ]);

        expect(verb.exitCode).toBe(1);
        expect(verb.stderr).toContain('--timeout must be a non-negative number');
        expect(readStatus(state, 'review.status')).toBe('NO-STATUS-FILE');
    });
});

describe('spur builder pr-<verb> surface (1219)', () => {
    test('builder registers the four flat verbs and hides the deprecating pr alias', () => {
        const program = new Command();
        const { context } = makeContext(tmpdir());
        registerBuilderCommand(program, context);
        const builder = program.commands.find((c) => c.name() === 'builder');
        const verbs = builder?.commands.map((c) => c.name()) ?? [];

        expect(verbs).toEqual(expect.arrayContaining(['pr-status', 'pr-check', 'pr-open', 'pr-review', 'pr']));
        const names = new Set(verbs);
        expect(names.size).toBe(verbs.length);
        // The alias is registered but hidden: it is absent from `builder --help` while the four
        // replacement verbs are listed.
        const help = builder?.helpInformation() ?? '';
        expect(help).toContain('pr-status');
        expect(help).not.toMatch(/^\s+pr \[options\]/m);
    });

    test('each verb advertises its own flags in help', () => {
        const program = new Command();
        const { context } = makeContext(tmpdir());
        registerBuilderCommand(program, context);
        const builder = program.commands.find((c) => c.name() === 'builder');
        const help = (name: string) => builder?.commands.find((c) => c.name() === name)?.helpInformation() ?? '';

        expect(help('pr-check')).toContain('--scan-only');
        expect(help('pr-check')).toContain('--status-file');
        expect(help('pr-status')).toContain('--head');
        expect(help('pr-open')).toContain('--base');
        expect(help('pr-review')).toContain('--no-wait');
        expect(help('pr-review')).toContain('--interval');
        expect(help('pr-review')).not.toContain('--scan-only');
    });

    test('the hidden pr alias prints one deprecation line naming the replacement verb', async () => {
        const state = makeFixture();
        const verb = await runVerb(state, ['builder', 'pr', 'preflight', '--json', '--status-file', 'alias.status']);

        expect(verb.exitCode).toBe(0);
        expect(verb.stderr.split('\n').filter((line) => line.includes('deprecated'))).toHaveLength(1);
        expect(verb.stderr).toContain('spur builder pr preflight is deprecated; use spur builder pr-check');
        expect(readStatus(state, 'alias.status')).toBe('PASS');
    });

    test('the hidden pr alias still passes the ops through unchanged', async () => {
        const legacy = makeFixture();
        const next = makeFixture();
        const op = runOp(legacy, ['request', '--focus', 'migration safety', '--json', '--status-file', 'alias.status']);
        const verb = await runVerb(next, [
            'builder',
            'pr',
            'request',
            '--focus',
            'migration safety',
            '--json',
            '--status-file',
            'alias.status',
        ]);

        expect(verb.exitCode).toBe(op.code);
        expect(stable(verb.payload)).toEqual(stable(op.payload));
        expect(readStatus(next, 'alias.status')).toBe(readStatus(legacy, 'alias.status'));
    });
});
