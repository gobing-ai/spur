/**
 * pr-reviewing.test — unit + stubbed-CLI coverage for the /sp:dev-pr-review spine script.
 *
 * Pure logic (arg parsing, Codex-author detection, per-HEAD dedupe, request-body building,
 * hygiene scan, findings normalization) is imported directly. Subcommand wiring is exercised
 * end-to-end through fake `git`/`gh` binaries on PATH that read canned state from a fixture
 * directory and record argv — no real GitHub or git repository is touched (history-load pattern).
 */

import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CmdResult, CommandRunner } from '../scripts/pr-reviewing';
import {
    buildRequestBody,
    extractSeverity,
    hasCodeReviewRules,
    hasCurrentCleanReview,
    isCodexAuthor,
    isExplicitCleanReview,
    isHeadReviewed,
    main,
    normalizeFindings,
    parseArgs,
    renderFindings,
    scanHygiene,
    setCommandRunner,
    spawnRunner,
} from '../scripts/pr-reviewing';

// ─── Pure: argument parsing ─────────────────────────────────────────────────

describe('parseArgs', () => {
    test('splits subcommand, value flags, and boolean flags', () => {
        const parsed = parseArgs(['request', '--force', '--focus', 'security boundaries', '--json']);
        expect(parsed.subcommand).toBe('request');
        expect(parsed.booleans.has('--force')).toBe(true);
        expect(parsed.booleans.has('--json')).toBe(true);
        expect(parsed.flags.get('--focus')).toBe('security boundaries');
    });

    test('rejects unknown arguments and value-less value flags', () => {
        expect(() => parseArgs(['wait', '--bogus'])).toThrow('unknown argument');
        expect(() => parseArgs(['wait', '--timeout'])).toThrow('requires a value');
    });

    test('staged TypeScript entrypoint runs under Bun', () => {
        const result = spawnSync('bun', [join(import.meta.dir, '..', 'scripts', 'pr-reviewing.ts'), '--help'], {
            encoding: 'utf8',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Installed usage: bun');
    });

    test('the default runner really spawns, and reports a missing binary instead of throwing', () => {
        // The other CLI cases inject an in-process stub, so this is what keeps the real
        // PATH-resolving spawn path covered.
        const okResult = spawnRunner(['/bin/sh', '-c', 'printf hi']);
        expect(okResult.code).toBe(0);
        expect(okResult.stdout).toBe('hi');

        const missing = spawnRunner(['spur-no-such-binary-xyz']);
        expect(missing.code).not.toBe(0);
        expect(missing.error ?? '').not.toBe('');
    });

    test('workflow carries request freshness through wait/collect and records composite status', () => {
        const workflow = readFileSync(
            join(import.meta.dir, '..', '..', '..', 'config', 'workflows', 'pr-review.yaml'),
            'utf8',
        );
        expect(workflow.match(/--since "\$SINCE"/g)?.length).toBe(3);
        expect(workflow.match(/--head "\$REQUEST_HEAD"/g)?.length).toBe(3);
        expect(workflow).toContain('pr-reviewing.ts)" status --since "$SINCE" --head "$REQUEST_HEAD" --json');
        expect(workflow).not.toContain('node -e');
        expect(workflow).toContain('-pr-status.json');
        expect(workflow).toContain('sh -c "$preReviewCmd"');
    });
});

// ─── Pure: Codex identity + dedupe ──────────────────────────────────────────

describe('Codex identity and per-HEAD dedupe', () => {
    test('matches any codex-containing bot login, not one hard-coded name', () => {
        expect(isCodexAuthor('chatgpt-codex-connector[bot]')).toBe(true);
        expect(isCodexAuthor('codex-review[bot]')).toBe(true);
        expect(isCodexAuthor('codex-reviewer', 'Bot')).toBe(true);
        expect(isCodexAuthor('codex-reviewer', 'User')).toBe(false);
        expect(isCodexAuthor('codex-user')).toBe(false);
        expect(isCodexAuthor('Copilot')).toBe(false);
        expect(isCodexAuthor(undefined)).toBe(false);
    });

    test('isHeadReviewed requires a Codex review on the exact pushed HEAD', () => {
        const reviews = [
            {
                user: { login: 'chatgpt-codex-connector[bot]' },
                commit_id: 'aaa',
                submitted_at: '2026-08-01T00:00:00Z',
            },
            { user: { login: 'human-reviewer' }, commit_id: 'bbb' },
            { user: { login: 'codex[bot]' }, commit_id: 'pending', state: 'PENDING' },
        ];
        expect(isHeadReviewed(reviews, 'aaa')).toBe(true);
        // A human review of the same commit does not count as a Codex review.
        expect(isHeadReviewed(reviews, 'bbb')).toBe(false);
        expect(isHeadReviewed(reviews, 'ccc')).toBe(false);
        expect(isHeadReviewed(reviews, 'pending')).toBe(false);
    });

    test('recognizes only an explicit clean review for the current HEAD', () => {
        const clean = {
            user: { login: 'codex[bot]' },
            commit_id: 'head',
            submitted_at: '2026-08-02T00:00:00Z',
            state: 'COMMENTED',
            body: 'No actionable findings.',
        };
        expect(isExplicitCleanReview(clean, 'head')).toBe(true);
        expect(hasCurrentCleanReview([clean], '2026-08-01T00:00:00Z', 'head')).toBe(true);
        expect(hasCurrentCleanReview([clean], '2026-08-03T00:00:00Z', 'head')).toBe(false);
        expect(isExplicitCleanReview({ ...clean, commit_id: 'old' }, 'head')).toBe(false);
        expect(isExplicitCleanReview({ ...clean, body: '**P1** bug' }, 'head')).toBe(false);
        expect(isExplicitCleanReview({ ...clean, state: 'COMMENTED', body: '' }, 'head')).toBe(false);
        expect(isExplicitCleanReview({ ...clean, state: 'DISMISSED' }, 'head')).toBe(false);
        expect(isExplicitCleanReview({ ...clean, submitted_at: undefined }, 'head')).toBe(false);
    });
});

// ─── Pure: request body ─────────────────────────────────────────────────────

describe('buildRequestBody', () => {
    test('stays concise when the repo carries Code Review Rules', () => {
        expect(buildRequestBody(true, '')).toBe('@codex review');
    });

    test('falls back to the default actionable-issues focus without repo rules', () => {
        const body = buildRequestBody(false, '');
        expect(body).toContain('@codex review for correctness and regressions');
        expect(body).toContain('actionable issues over style or nits');
    });

    test('appends user focus without weakening the base request', () => {
        expect(buildRequestBody(true, 'transaction idempotency')).toBe(
            '@codex review Focus especially on transaction idempotency.',
        );
        expect(buildRequestBody(false, 'migration safety')).toContain('Focus especially on migration safety.');
    });
});

describe('hasCodeReviewRules', () => {
    let dir = '';
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pr-rules-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    test('detects the exact section heading and tolerates its absence', () => {
        expect(hasCodeReviewRules(dir)).toBe(false);
        writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\n## Code Review Rules\n\n- atomic writes\n');
        expect(hasCodeReviewRules(dir)).toBe(true);
    });
});

// ─── Pure: severity + hygiene ───────────────────────────────────────────────

describe('extractSeverity', () => {
    test('reads P0-P3 badges and falls back to unrated', () => {
        expect(extractSeverity('**P1** Duplicate retry')).toBe('P1');
        expect(extractSeverity('P3 nit')).toBe('P3');
        expect(extractSeverity('looks fine')).toBe('unrated');
    });
});

describe('scanHygiene', () => {
    const added = (lines: readonly string[]): string =>
        ['diff --git a/x b/x', '+++ b/x', ...lines.map((l) => `+${l}`)].join('\n');

    test('blocks secrets, .env files, private keys, and conflict markers', () => {
        expect(scanHygiene(added(['<<<<<<< HEAD']), []).verdict).toBe('BLOCK');
        expect(scanHygiene(added(['-----BEGIN OPENSSH PRIVATE KEY-----']), []).verdict).toBe('BLOCK');
        expect(scanHygiene(added(['const k = "AKIAIOSFODNN7EXAMPLE";']), []).verdict).toBe('BLOCK');
        expect(scanHygiene(added(['token = "ghp_abcdefghij1234567890abcd"']), []).verdict).toBe('BLOCK');
        expect(scanHygiene(added(['']), ['config/.env']).verdict).toBe('BLOCK');
        // .env.example is a template, not a leak.
        expect(scanHygiene(added(['']), ['config/.env.example']).verdict).toBe('PASS');
    });

    test('redacts matched secret material from the result', () => {
        const secret = 'ghp_abcdefghij1234567890abcd';
        const result = scanHygiene(added([`console.log("${secret}");`]), []);
        expect(result.verdict).toBe('BLOCK');
        expect(JSON.stringify(result)).not.toContain(secret);
        expect(JSON.stringify(result)).toContain('redacted');
    });

    test('warns on debug residue without blocking', () => {
        const result = scanHygiene(added(['console.log("dbg");', 'debugger;']), []);
        expect(result.verdict).toBe('WARN');
        expect(result.warnings.length).toBe(2);
    });

    test('ignores context lines and removed lines', () => {
        expect(scanHygiene('-console.log("old");\n clean context', []).verdict).toBe('PASS');
    });
});

// ─── Pure: findings normalization ───────────────────────────────────────────

describe('normalizeFindings + renderFindings', () => {
    const since = '2026-08-01T00:00:00Z';
    const head = 'head123';

    test('keeps fresh Codex output on the current HEAD; drops stale, human, and pre-since output', () => {
        const findings = normalizeFindings(
            [
                {
                    user: { login: 'chatgpt-codex-connector[bot]' },
                    commit_id: head,
                    submitted_at: '2026-08-02T00:00:00Z',
                    body: 'summary',
                },
                {
                    user: { login: 'chatgpt-codex-connector[bot]' },
                    commit_id: 'old',
                    submitted_at: '2026-08-02T00:00:00Z',
                    body: 'stale',
                },
                { user: { login: 'human' }, commit_id: head, submitted_at: '2026-08-02T00:00:00Z', body: 'human' },
                {
                    user: { login: 'chatgpt-codex-connector[bot]' },
                    commit_id: head,
                    submitted_at: '2026-07-01T00:00:00Z',
                    body: 'old',
                },
            ],
            [
                {
                    user: { login: 'codex[bot]' },
                    commit_id: head,
                    created_at: '2026-08-03T00:00:00Z',
                    path: 'src/a.ts',
                    line: 42,
                    body: '**P1** bug',
                    html_url: 'u1',
                },
            ],
            [{ user: { login: 'codex[bot]' }, commit_id: head, created_at: '2026-08-04T00:00:00Z', body: 'overall' }],
            since,
            head,
        );
        expect(findings.map((f) => f.kind)).toEqual(['review', 'inline', 'comment']);
        expect(findings[1].path).toBe('src/a.ts');
        expect(findings[1].severity).toBe('P1');
        const rendered = renderFindings(findings);
        expect(rendered).toContain('Findings (3)');
        expect(rendered).toContain('[P1] src/a.ts:42');
    });

    test('empty findings render as a clean review, never as a failure', () => {
        expect(normalizeFindings([], [], [], since, head)).toEqual([]);
        expect(renderFindings([])).toContain('without actionable findings');
    });

    test('treats GitHub second-precision timestamps as fresh within the request second', () => {
        const findings = normalizeFindings(
            [],
            [
                {
                    user: { login: 'codex[bot]' },
                    commit_id: head,
                    created_at: '2026-08-02T00:00:00Z',
                    body: '**P1** fast response',
                },
            ],
            [],
            '2026-08-02T00:00:00.900Z',
            head,
        );
        expect(findings).toHaveLength(1);
    });
});

// ─── Stubbed CLI: fake git/gh on PATH, main() invoked in-process ────────────
//
// The script resolves `git`/`gh` from PATH at spawn time, so pointing PATH at a fixture
// bin directory intercepts every external call. main() returns the exit code instead of
// calling process.exit, which keeps the whole run in-process (real coverage, no subprocess
// startup) while the entrypoint stays a plain `process.exit(main(...))`.

let fix = '';
let origPath = '';
let logs: string[] = [];
let errs: string[] = [];
let logSpy: Mock<(...data: unknown[]) => void>;
let errSpy: Mock<(...data: unknown[]) => void>;

/**
 * In-process stand-in for the fixture `git`/`gh` binaries.
 *
 * Reads exactly the same fixture files the old shell stubs did (`$FIX/branch`, `$FIX/head`,
 * sentinel files like `$FIX/git_fail`, …) and appends to the same `calls.txt`, so every test body
 * and `calls()` assertion is unchanged. Replacing the shell scripts removes ~2 subprocess spawns
 * per git/gh call across 37 CLI cases — the dominant cost of this file.
 */
function makeStubRunner(dir: string): CommandRunner {
    const fixPath = (name: string): string => join(dir, name);
    const has = (name: string): boolean => existsSync(fixPath(name));
    const read = (name: string, fallback = ''): string => (has(name) ? readFileSync(fixPath(name), 'utf8') : fallback);
    const ok = (stdout = ''): CmdResult => ({ code: 0, stdout, stderr: '' });
    const fail = (stderr: string): CmdResult => ({ code: 1, stdout: '', stderr });

    const git = (argv: string): CmdResult => {
        if (has('git_fail')) return fail('git fixture failure\n');
        if (argv === 'rev-parse --show-toplevel') return ok(`${fixPath('repo')}\n`);
        if (argv === 'branch --show-current') return ok(read('branch'));
        if (argv === 'rev-parse HEAD') return ok(read('head'));
        if (argv === 'status --porcelain') {
            if (has('git_status_fail')) return fail('status failure\n');
            return ok(read('dirty'));
        }
        if (argv === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') {
            return has('upstream') ? ok(read('upstream')) : fail('');
        }
        if (argv === 'rev-list --count @{u}..HEAD') return ok(read('ahead', '0\n'));
        if (argv === 'rev-list --count HEAD..@{u}') return ok(read('behind', '0\n'));
        if (argv === 'rev-parse @{u}') return ok(read('remotehead'));
        if (argv === 'push -u origin HEAD') {
            writeFileSync(fixPath('remotehead'), 'HEAD\n');
            writeFileSync(fixPath('upstream'), 'origin/main\n');
            return ok();
        }
        if (argv === 'push') {
            writeFileSync(fixPath('remotehead'), read('head'));
            return ok();
        }
        if (argv.startsWith('log --oneline ')) {
            if (has('git_log_fail')) return fail('log failure\n');
            return ok(read('commits'));
        }
        if (argv.startsWith('diff --name-only --diff-filter=AMCR ')) {
            if (has('diff_files_fail')) return fail('diff files failure\n');
            return ok(read('diff_files'));
        }
        if (argv.startsWith('diff ')) {
            if (has('diff_text_fail')) return fail('diff text failure\n');
            return ok(read('diff_text'));
        }
        return fail('');
    };

    const gh = (argv: string): CmdResult => {
        if (argv === 'auth status') return has('no_auth') ? fail('') : ok('Logged in\n');
        if (argv === 'repo view --json nameWithOwner,defaultBranchRef') {
            return ok('{"nameWithOwner":"octo/repo","defaultBranchRef":{"name":"main"}}\n');
        }
        if (argv === 'pr view --json number,url,state,isDraft,headRefName,baseRefName,title,headRefOid') {
            return has('pr.json') ? ok(read('pr.json')) : fail('no pull requests found for branch\n');
        }
        if (argv.startsWith('pr create --fill --base ')) {
            writeFileSync(fixPath('pr.json'), read('pr_created.json'));
            return ok('https://github.com/octo/repo/pull/7\n');
        }
        if (argv.startsWith('pr comment ')) {
            appendFileSync(fixPath('comments_posted.txt'), `${argv}\n`);
            return ok();
        }
        if (argv.startsWith('pr checks ')) {
            if (!has('checks')) return fail('');
            const out = read('checks');
            const code = has('checks_exit') ? Number.parseInt(read('checks_exit').trim(), 10) : 0;
            return { code, stdout: out, stderr: '' };
        }
        if (argv === 'api user --jq .login') return ok('robin\n');
        const slurp = (file: string): CmdResult => ok(`[${read(file, '[]').trim() || '[]'}]\n`);
        if (/^api --method GET repos\/octo\/repo\/pulls\/.*\/reviews --paginate --slurp$/.test(argv)) {
            return slurp('reviews.json');
        }
        if (/^api --method GET repos\/octo\/repo\/pulls\/.*\/comments --paginate --slurp$/.test(argv)) {
            return slurp('inline.json');
        }
        if (/^api --method GET repos\/octo\/repo\/issues\/.*\/comments --paginate --slurp$/.test(argv)) {
            return slurp('issue_comments.json');
        }
        return fail('');
    };

    return (cmd) => {
        const [bin, ...rest] = cmd;
        const argv = rest.join(' ');
        appendFileSync(fixPath('calls.txt'), `${bin} ${argv}\n`);
        if (bin === 'git') return git(argv);
        if (bin === 'gh') return gh(argv);
        return fail('');
    };
}

/** Seed the default healthy fixture state; individual tests override pieces. */
function seedHealthy(dir: string): void {
    writeFileSync(join(dir, 'branch'), 'feat/x\n');
    writeFileSync(join(dir, 'head'), 'aaaa1111bbbb2222cccc3333dddd4444eeee5555\n');
    writeFileSync(join(dir, 'remotehead'), 'aaaa1111bbbb2222cccc3333dddd4444eeee5555\n');
    writeFileSync(join(dir, 'upstream'), 'origin/feat/x\n');
    writeFileSync(join(dir, 'ahead'), '0\n');
    writeFileSync(join(dir, 'behind'), '0\n');
    writeFileSync(join(dir, 'commits'), 'aaaa111 feat: x\n');
    writeFileSync(
        join(dir, 'pr.json'),
        `${JSON.stringify({
            number: 7,
            url: 'https://github.com/octo/repo/pull/7',
            state: 'OPEN',
            isDraft: false,
            headRefName: 'feat/x',
            baseRefName: 'main',
            title: 'feat: x',
            headRefOid: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
        })}\n`,
    );
}

/** Invoke the script in-process; returns exit code plus captured stdout/stderr text. */
function runScript(argv: readonly string[]): { code: number; stdout: string; stderr: string } {
    logs = [];
    errs = [];
    const code = main(argv);
    return { code, stdout: logs.join('\n'), stderr: errs.join('\n') };
}

function calls(): string {
    return readFileSync(join(fix, 'calls.txt'), 'utf8');
}

beforeEach(() => {
    fix = mkdtempSync(join(tmpdir(), 'pr-review-'));
    writeFileSync(join(fix, 'calls.txt'), '');
    setCommandRunner(makeStubRunner(fix));
    seedHealthy(fix);
    origPath = process.env.PATH ?? '';
    process.env.PATH = `${fix}:${origPath}`;
    logSpy = spyOn(console, 'log').mockImplementation((...data: unknown[]) => {
        logs.push(data.map(String).join(' '));
    });
    errSpy = spyOn(console, 'error').mockImplementation((...data: unknown[]) => {
        errs.push(data.map(String).join(' '));
    });
});

afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    setCommandRunner();
    process.env.PATH = origPath;
    rmSync(fix, { recursive: true, force: true });
});

describe('CLI subcommands over stubbed git/gh', () => {
    test('preflight passes on a clean tree and emits repo context JSON', () => {
        const res = runScript(['preflight', '--json']);
        expect(res.code).toBe(0);
        const payload = JSON.parse(res.stdout);
        expect(payload.ok).toBe(true);
        expect(payload.nameWithOwner).toBe('octo/repo');
        expect(payload.branch).toBe('feat/x');
    });

    test('preflight fails loud on a dirty tree and on detached HEAD', () => {
        writeFileSync(join(fix, 'dirty'), ' M src/a.ts\n');
        const dirty = runScript(['preflight']);
        expect(dirty.code).toBe(2);
        expect(dirty.stderr).toContain('working tree is dirty');

        rmSync(join(fix, 'dirty'));
        writeFileSync(join(fix, 'branch'), '');
        const detached = runScript(['preflight']);
        expect(detached.code).toBe(2);
        expect(detached.stderr).toContain('detached');
    });

    test('preflight fails when gh is unauthenticated', () => {
        writeFileSync(join(fix, 'no_auth'), '');
        const res = runScript(['preflight']);
        expect(res.code).toBe(2);
        expect(res.stderr).toContain('gh auth login');
    });

    test('preflight refuses on the base branch in all three sub-states, before any push', () => {
        // (a) commits ahead of upstream on the default branch — the dogfood P1
        writeFileSync(join(fix, 'branch'), 'main\n');
        writeFileSync(join(fix, 'upstream'), 'origin/main\n');
        writeFileSync(join(fix, 'ahead'), '2\n');
        const ahead = runScript(['preflight', '--json']);
        expect(ahead.code).toBe(2);
        expect(ahead.stderr).toContain('base branch');
        expect(JSON.parse(ahead.stdout).error).toContain('base branch');
        expect(calls()).not.toContain('git push');

        // (b) no upstream on the default branch
        rmSync(join(fix, 'upstream'));
        const noUp = runScript(['preflight']);
        expect(noUp.code).toBe(2);
        expect(noUp.stderr).toContain('base branch');

        // (c) up to date with upstream on the default branch
        writeFileSync(join(fix, 'upstream'), 'origin/main\n');
        writeFileSync(join(fix, 'ahead'), '0\n');
        const upToDate = runScript(['preflight']);
        expect(upToDate.code).toBe(2);
        expect(upToDate.stderr).toContain('base branch');
    });

    test('preflight refuses when the resolved --base equals the current branch', () => {
        // Branch is not the repo default, but the overridden base matches it — the
        // same refusal ensure-pr applies, now before any push can fire (R1 override path).
        const res = runScript(['preflight', '--base', 'feat/x', '--json']);
        expect(res.code).toBe(2);
        expect(res.stderr).toContain('base branch');
        expect(calls()).not.toContain('git push');
    });

    test('preflight passes on a feature branch and reports upstream divergence', () => {
        writeFileSync(join(fix, 'ahead'), '2\n');
        writeFileSync(join(fix, 'behind'), '1\n');
        const res = runScript(['preflight', '--json']);
        expect(res.code).toBe(0);
        const payload = JSON.parse(res.stdout);
        expect(payload.upstream).toEqual({ ref: 'origin/feat/x', ahead: 2, behind: 1 });
        const human = runScript(['preflight']);
        expect(human.code).toBe(0);
        expect(human.stdout).toContain('ahead 2, behind 1');
    });

    test('preflight reports a missing upstream as none', () => {
        rmSync(join(fix, 'upstream'));
        const res = runScript(['preflight']);
        expect(res.code).toBe(0);
        const payload = JSON.parse(runScript(['preflight', '--json']).stdout);
        expect(payload.upstream).toBeNull();
        expect(res.stdout).toContain('Upstream:   none');
    });

    test('preflight fails closed when git status cannot be read', () => {
        writeFileSync(join(fix, 'git_status_fail'), '');
        const res = runScript(['preflight', '--json']);
        expect(res.code).toBe(2);
        expect(JSON.parse(res.stdout).error).toContain('git status failed');
    });

    test('push is a no-op when the remote already carries HEAD', () => {
        const res = runScript(['push', '--json', '--status-file', join(fix, 'push.status')]);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).pushed).toBe(false);
        expect(readFileSync(join(fix, 'push.status'), 'utf8').trim()).toBe('UP_TO_DATE');
        expect(calls()).not.toContain('git push\n');
    });

    test('push sets upstream when missing — never force', () => {
        rmSync(join(fix, 'upstream'));
        const res = runScript(['push', '--json']);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).pushed).toBe(true);
        expect(calls()).toContain('git push -u origin HEAD');
        expect(calls()).not.toContain('--force');
    });

    test('ensure-pr reuses an existing PR; creates one only when absent', () => {
        const reuse = runScript(['ensure-pr', '--json']);
        expect(reuse.code).toBe(0);
        expect(JSON.parse(reuse.stdout).created).toBe(false);
        expect(calls()).not.toContain('gh pr create');

        rmSync(join(fix, 'pr.json'));
        writeFileSync(
            join(fix, 'pr_created.json'),
            `${JSON.stringify({
                number: 8,
                url: 'https://github.com/octo/repo/pull/8',
                state: 'OPEN',
                isDraft: false,
                headRefName: 'feat/x',
                baseRefName: 'main',
                title: 'feat: x',
                headRefOid: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
            })}\n`,
        );
        const created = runScript(['ensure-pr', '--json']);
        expect(created.code).toBe(0);
        const payload = JSON.parse(created.stdout);
        expect(payload.created).toBe(true);
        expect(payload.pr.number).toBe(8);
        expect(calls()).toContain('gh pr create --fill --base main');
    });

    test('ensure-pr refuses when the branch has no commits beyond the base', () => {
        rmSync(join(fix, 'pr.json'));
        writeFileSync(join(fix, 'commits'), '');
        const res = runScript(['ensure-pr']);
        expect(res.code).toBe(2);
        expect(res.stderr).toContain('nothing to review');
    });

    test('ensure-pr reports a failed commit probe instead of treating it as no commits', () => {
        rmSync(join(fix, 'pr.json'));
        writeFileSync(join(fix, 'git_log_fail'), '');
        const res = runScript(['ensure-pr', '--json']);
        expect(res.code).toBe(2);
        expect(JSON.parse(res.stdout).error).toContain('git log failed');
    });

    test('hygiene exits 2 on blockers and writes the BLOCK verdict', () => {
        writeFileSync(join(fix, 'diff_text'), '+++ b/src/a.ts\n+<<<<<<< HEAD\n');
        const statusFile = join(fix, 'hygiene.status');
        const res = runScript(['hygiene', '--json', '--status-file', statusFile]);
        expect(res.code).toBe(2);
        expect(JSON.parse(res.stdout).verdict).toBe('BLOCK');
        expect(readFileSync(statusFile, 'utf8').trim()).toBe('BLOCK');
    });

    test('hygiene passes a clean diff', () => {
        writeFileSync(join(fix, 'diff_text'), '+++ b/src/a.ts\n+const x = 1;\n');
        const res = runScript(['hygiene', '--json']);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).verdict).toBe('PASS');
    });

    test('hygiene fails closed when either git diff probe fails', () => {
        const filesStatus = join(fix, 'diff-files.status');
        writeFileSync(join(fix, 'diff_files_fail'), '');
        let res = runScript(['hygiene', '--json', '--status-file', filesStatus]);
        expect(res.code).toBe(2);
        expect(JSON.parse(res.stdout)).toMatchObject({ ok: false });
        expect(readFileSync(filesStatus, 'utf8').trim()).toBe('FAIL');

        rmSync(join(fix, 'diff_files_fail'));
        const textStatus = join(fix, 'diff-text.status');
        writeFileSync(join(fix, 'diff_text_fail'), '');
        res = runScript(['hygiene', '--json', '--status-file', textStatus]);
        expect(res.code).toBe(2);
        expect(JSON.parse(res.stdout)).toMatchObject({ ok: false });
        expect(readFileSync(textStatus, 'utf8').trim()).toBe('FAIL');
    });

    test('hygiene never echoes a matched secret in JSON output', () => {
        const secret = 'ghp_abcdefghij1234567890abcd';
        writeFileSync(join(fix, 'diff_text'), `+++ b/src/a.ts\n+token = "${secret}"\n`);
        const res = runScript(['hygiene', '--json']);
        expect(res.code).toBe(2);
        expect(res.stdout).not.toContain(secret);
        expect(res.stderr).not.toContain(secret);
    });

    test('external command failures under JSON emit an error and write FAIL', () => {
        writeFileSync(join(fix, 'git_fail'), '');
        const statusFile = join(fix, 'preflight.status');
        const res = runScript(['preflight', '--json', '--status-file', statusFile]);
        expect(res.code).toBe(2);
        expect(JSON.parse(res.stdout)).toMatchObject({ ok: false });
        expect(readFileSync(statusFile, 'utf8').trim()).toBe('FAIL');
    });

    test('request posts @codex review and records the request', () => {
        const res = runScript(['request', '--focus', 'security boundaries', '--json']);
        expect(res.code).toBe(0);
        const payload = JSON.parse(res.stdout);
        expect(payload.requested).toBe(true);
        expect(payload.body).toContain('@codex review for correctness and regressions');
        expect(payload.body).toContain('Focus especially on security boundaries.');
        expect(readFileSync(join(fix, 'comments_posted.txt'), 'utf8')).toContain('@codex review');
    });

    test('request dedupes when Codex already reviewed the pushed HEAD; --force overrides', () => {
        writeFileSync(
            join(fix, 'reviews.json'),
            `${JSON.stringify([
                {
                    user: { login: 'chatgpt-codex-connector[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    submitted_at: '2026-08-10T00:00:00Z',
                },
            ])}\n`,
        );
        const dupe = runScript(['request', '--json']);
        expect(dupe.code).toBe(0);
        expect(JSON.parse(dupe.stdout).alreadyReviewed).toBe(true);
        expect(existsSync(join(fix, 'comments_posted.txt'))).toBe(false);

        const forced = runScript(['request', '--force', '--json']);
        expect(forced.code).toBe(0);
        expect(JSON.parse(forced.stdout).requested).toBe(true);
        expect(existsSync(join(fix, 'comments_posted.txt'))).toBe(true);
    });

    test('request dedupes an in-flight request for the pushed HEAD', () => {
        writeFileSync(
            join(fix, 'issue_comments.json'),
            `${JSON.stringify([
                {
                    user: { login: 'robin' },
                    body: '<!-- spur-pr-review head:aaaa1111bbbb2222cccc3333dddd4444eeee5555 -->',
                },
            ])}\n`,
        );
        const statusFile = join(fix, 'request.status');
        const res = runScript(['request', '--json', '--status-file', statusFile]);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout)).toMatchObject({ requested: false, pending: true });
        expect(readFileSync(statusFile, 'utf8').trim()).toBe('ALREADY_REQUESTED');
        expect(existsSync(join(fix, 'comments_posted.txt'))).toBe(false);
    });

    test('wait finds fresh Codex output and exits 0', () => {
        writeFileSync(
            join(fix, 'inline.json'),
            `${JSON.stringify([
                {
                    user: { login: 'codex[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    created_at: '2026-08-12T00:00:00Z',
                    path: 'src/a.ts',
                    line: 9,
                    body: '**P2** race',
                    html_url: 'u',
                },
            ])}\n`,
        );
        const res = runScript([
            'wait',
            '--since',
            '2026-08-01T00:00:00Z',
            '--timeout',
            '5',
            '--interval',
            '1',
            '--json',
        ]);
        expect(res.code).toBe(0);
        const payload = JSON.parse(res.stdout);
        expect(payload.verdict).toBe('FOUND');
        expect(payload.findings[0].path).toBe('src/a.ts');
    });

    test('wait completes on an explicit clean review for the current HEAD', () => {
        writeFileSync(
            join(fix, 'reviews.json'),
            `${JSON.stringify([
                {
                    user: { login: 'chatgpt-codex-connector[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    submitted_at: '2026-08-12T00:00:00Z',
                    state: 'COMMENTED',
                    body: 'No actionable findings.',
                },
            ])}\n`,
        );
        const statusFile = join(fix, 'wait.status');
        const res = runScript([
            'wait',
            '--since',
            '2026-08-01T00:00:00Z',
            '--timeout',
            '1',
            '--interval',
            '1',
            '--json',
            '--status-file',
            statusFile,
        ]);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout)).toMatchObject({ verdict: 'CLEAN', findings: [] });
        expect(readFileSync(statusFile, 'utf8').trim()).toBe('CLEAN');
    });

    test('wait timeout is pending (exit 3), never a failure', () => {
        const res = runScript(['wait', '--since', '2026-08-01T00:00:00Z', '--timeout', '1', '--interval', '1']);
        expect(res.code).toBe(3);
        expect(res.stdout).toContain('pending');
    });

    test('wait rejects invalid polling budgets instead of spinning', () => {
        const res = runScript(['wait', '--timeout', 'not-a-number', '--json']);
        expect(res.code).toBe(1);
        expect(JSON.parse(res.stdout).error).toContain('--timeout');
    });

    test('collect normalizes the latest Codex findings for the current HEAD', () => {
        writeFileSync(
            join(fix, 'reviews.json'),
            `${JSON.stringify([
                {
                    user: { login: 'chatgpt-codex-connector[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    submitted_at: '2026-08-12T00:00:00Z',
                    body: '2 findings',
                    html_url: 'ru',
                },
            ])}\n`,
        );
        const res = runScript(['collect', '--json', '--status-file', join(fix, 'collect.status')]);
        expect(res.code).toBe(0);
        const payload = JSON.parse(res.stdout);
        expect(payload.verdict).toBe('FINDINGS');
        expect(payload.findings[0].kind).toBe('review');
        expect(readFileSync(join(fix, 'collect.status'), 'utf8').trim()).toBe('FINDINGS');
    });

    test('collect with no current-HEAD Codex output reports pending', () => {
        const res = runScript(['collect', '--json']);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).verdict).toBe('PENDING');
    });

    test('collect fails when the PR HEAD moved after the request', () => {
        const res = runScript(['collect', '--head', 'old-head', '--json']);
        expect(res.code).toBe(2);
        expect(JSON.parse(res.stdout).error).toContain('PR HEAD moved');
    });

    test('collect reports clean only for an explicit current-HEAD review', () => {
        writeFileSync(
            join(fix, 'reviews.json'),
            `${JSON.stringify([
                {
                    user: { login: 'codex[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    submitted_at: '2026-08-12T00:00:00Z',
                    state: 'APPROVED',
                    body: '',
                },
            ])}\n`,
        );
        const res = runScript(['collect', '--json', '--status-file', join(fix, 'collect.status')]);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).verdict).toBe('CLEAN');
        expect(readFileSync(join(fix, 'collect.status'), 'utf8').trim()).toBe('CLEAN');
    });

    test('collect excludes stale and uncorrelated conversation comments', () => {
        writeFileSync(
            join(fix, 'issue_comments.json'),
            `${JSON.stringify([
                {
                    user: { login: 'codex[bot]' },
                    created_at: '2026-08-12T00:00:00Z',
                    body: '**P1** stale conversation finding',
                },
                {
                    user: { login: 'codex[bot]' },
                    commit_id: 'old',
                    created_at: '2026-08-13T00:00:00Z',
                    body: '**P1** wrong-head conversation finding',
                },
            ])}\n`,
        );
        const res = runScript(['collect', '--json']);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout)).toMatchObject({ verdict: 'PENDING', findings: [] });
    });

    test('status composes repo, PR, CI, and Codex state read-only', () => {
        writeFileSync(join(fix, 'checks'), '[{"bucket":"pass"}]\n');
        writeFileSync(
            join(fix, 'reviews.json'),
            `${JSON.stringify([
                {
                    user: { login: 'chatgpt-codex-connector[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    submitted_at: '2026-08-12T00:00:00Z',
                    state: 'COMMENTED',
                    body: 'No actionable findings.',
                },
            ])}\n`,
        );
        const res = runScript(['status', '--json']);
        expect(res.code).toBe(0);
        const payload = JSON.parse(res.stdout);
        expect(payload).toMatchObject({
            repo: 'octo/repo',
            branch: 'feat/x',
            local: 'clean',
            ci: 'passing',
            codex: 'clean',
        });
        expect(payload.pr.number).toBe(7);
        // Read-only: no comments posted, no pushes.
        expect(existsSync(join(fix, 'comments_posted.txt'))).toBe(false);
    });

    test('status reports a current-HEAD review body as findings', () => {
        writeFileSync(
            join(fix, 'reviews.json'),
            `${JSON.stringify([
                {
                    user: { login: 'codex[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    submitted_at: '2026-08-12T00:00:00Z',
                    state: 'COMMENTED',
                    body: '**P1** data loss',
                },
            ])}\n`,
        );
        const res = runScript(['status', '--json']);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).codex).toBe('findings');
    });

    test('status applies the request window to same-HEAD Codex reviews', () => {
        writeFileSync(
            join(fix, 'reviews.json'),
            `${JSON.stringify([
                {
                    user: { login: 'codex[bot]' },
                    commit_id: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
                    submitted_at: '2026-08-12T00:00:00Z',
                    state: 'COMMENTED',
                    body: '**P1** old finding',
                },
            ])}\n`,
        );
        const res = runScript(['status', '--since', '2026-08-13T00:00:00Z', '--json']);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).codex).toBe('pending');
    });

    test('status leaves CI unavailable when GitHub reports no checks', () => {
        writeFileSync(join(fix, 'checks'), '[]\n');
        const res = runScript(['status', '--json']);
        expect(res.code).toBe(0);
        expect(JSON.parse(res.stdout).ci).toBe('unavailable');
    });

    test('status parses failing and pending CI JSON even when gh uses nonzero semantic exits', () => {
        for (const [bucket, exitCode, expected] of [
            ['fail', '1', 'failing'],
            ['pending', '8', 'pending'],
        ] as const) {
            writeFileSync(join(fix, 'checks'), `${JSON.stringify([{ bucket }])}\n`);
            writeFileSync(join(fix, 'checks_exit'), exitCode);
            const res = runScript(['status', '--json']);
            expect(res.code).toBe(0);
            expect(JSON.parse(res.stdout).ci).toBe(expected);
        }
    });

    test('status never treats skipped or unknown CI buckets as passing', () => {
        for (const bucket of ['skipping', 'mystery']) {
            writeFileSync(join(fix, 'checks'), `${JSON.stringify([{ bucket }])}\n`);
            const res = runScript(['status', '--json']);
            expect(res.code).toBe(0);
            expect(JSON.parse(res.stdout).ci).toBe('unavailable');
        }
    });

    test('usage errors exit 1 and unknown subcommands are rejected', () => {
        const bad = runScript(['frobnicate']);
        expect(bad.code).toBe(1);
        expect(bad.stderr).toContain('unknown subcommand');
        const help = runScript(['--help']);
        expect(help.code).toBe(0);
        expect(help.stdout).toContain('Subcommands:');
    });
});
