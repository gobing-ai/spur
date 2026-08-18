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
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function writeStubBins(dir: string): void {
    const git = `#!/bin/sh
FIX="${dir}"
printf 'git %s\\n' "$*" >> "$FIX/calls.txt"
[ -f "$FIX/git_fail" ] && { printf '%s\\n' 'git fixture failure' >&2; exit 1; }
case "$*" in
  "rev-parse --show-toplevel") printf '%s\\n' "$FIX/repo" ;;
  "branch --show-current") cat "$FIX/branch" 2>/dev/null || true ;;
  "rev-parse HEAD") cat "$FIX/head" ;;
  "status --porcelain")
    if [ -f "$FIX/git_status_fail" ]; then printf '%s\\n' 'status failure' >&2; exit 1; fi
    cat "$FIX/dirty" 2>/dev/null || true ;;
  "rev-parse --abbrev-ref --symbolic-full-name @{u}")
    if [ -f "$FIX/upstream" ]; then cat "$FIX/upstream"; else exit 1; fi ;;
  "rev-list --count @{u}..HEAD") cat "$FIX/ahead" 2>/dev/null || printf '0\n' ;;
  "rev-list --count HEAD..@{u}") cat "$FIX/behind" 2>/dev/null || printf '0\n' ;;
  "rev-parse @{u}") cat "$FIX/remotehead" ;;
  "push -u origin HEAD") printf '%s\\n' HEAD > "$FIX/remotehead"; printf '%s\\n' 'origin/main' > "$FIX/upstream" ;;
  "push") cat "$FIX/head" > "$FIX/remotehead" ;;
  "log --oneline "*)
    if [ -f "$FIX/git_log_fail" ]; then printf '%s\\n' 'log failure' >&2; exit 1; fi
    cat "$FIX/commits" 2>/dev/null || true ;;
  "diff --name-only --diff-filter=AMCR "*)
    if [ -f "$FIX/diff_files_fail" ]; then printf '%s\\n' 'diff files failure' >&2; exit 1; fi
    cat "$FIX/diff_files" 2>/dev/null || true ;;
  "diff "*)
    if [ -f "$FIX/diff_text_fail" ]; then printf '%s\\n' 'diff text failure' >&2; exit 1; fi
    cat "$FIX/diff_text" 2>/dev/null || true ;;
  *) exit 1 ;;
esac
`;
    const gh = `#!/bin/sh
FIX="${dir}"
printf 'gh %s\\n' "$*" >> "$FIX/calls.txt"
case "$*" in
  "auth status")
    if [ -f "$FIX/no_auth" ]; then exit 1; fi
    printf 'Logged in\\n' ;;
  "repo view --json nameWithOwner,defaultBranchRef")
    printf '%s\\n' '{"nameWithOwner":"octo/repo","defaultBranchRef":{"name":"main"}}' ;;
  "pr view --json number,url,state,isDraft,headRefName,baseRefName,title,headRefOid")
    if [ -f "$FIX/pr.json" ]; then cat "$FIX/pr.json"; else printf '%s\\n' 'no pull requests found for branch' >&2; exit 1; fi ;;
  "pr create --fill --base "*)
    cp "$FIX/pr_created.json" "$FIX/pr.json"
    printf '%s\\n' 'https://github.com/octo/repo/pull/7' ;;
  "pr comment "*)
    printf '%s\\n' "$*" >> "$FIX/comments_posted.txt" ;;
  "pr checks "*)
    cat "$FIX/checks" 2>/dev/null || exit 1
    if [ -f "$FIX/checks_exit" ]; then exit "$(cat "$FIX/checks_exit")"; fi ;;
  "api user --jq .login") printf '%s\n' 'robin' ;;
  "api --method GET repos/octo/repo/pulls/"*"/reviews --paginate --slurp")
    printf '['; cat "$FIX/reviews.json" 2>/dev/null || printf '[]'; printf ']\\n' ;;
  "api --method GET repos/octo/repo/pulls/"*"/comments --paginate --slurp")
    printf '['; cat "$FIX/inline.json" 2>/dev/null || printf '[]'; printf ']\\n' ;;
  "api --method GET repos/octo/repo/issues/"*"/comments --paginate --slurp")
    printf '['; cat "$FIX/issue_comments.json" 2>/dev/null || printf '[]'; printf ']\\n' ;;
  *) exit 1 ;;
esac
`;
    writeFileSync(join(dir, 'git'), git);
    writeFileSync(join(dir, 'gh'), gh);
    chmodSync(join(dir, 'git'), 0o755);
    chmodSync(join(dir, 'gh'), 0o755);
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
    writeStubBins(fix);
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
