/**
 * Thin-wrapper tests for `spur builder pr` (script-absorption PR-7). The spine is pinned by
 * packages/app/tests/services/pr-review; this pins argv pass-through and exit codes.
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
import { getEnvVars } from '@gobing-ai/spur-config';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

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
