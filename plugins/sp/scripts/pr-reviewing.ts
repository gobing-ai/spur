#!/usr/bin/env bun
/**
 * pr-reviewing.ts — deterministic spine for the sp:pr-reviewing skill (/sp:dev-pr-review).
 *
 * Owns every git/gh interaction of the GitHub Codex PR-review loop: preflight, push,
 * find-or-create PR, submission hygiene scan, `@codex review` request with per-HEAD dedupe,
 * bounded polling, findings collection, and a composite status read. All model-bearing work
 * (finding triage, fixes, AGENTS.md rules authoring) stays in the skill; this script is the
 * testable core that `.spur/workflows/pr-review.yaml` (the workflow SSOT) shells out to.
 *
 * Subcommands: preflight | push | ensure-pr | hygiene | request | wait | collect | status
 * Flags: --json (single JSON object on stdout), --status-file <path> (one-word verdict),
 * plus per-subcommand flags documented in --help.
 *
 * Exit codes: 0 success (including WARN / ALREADY_REVIEWED / UP_TO_DATE verdicts),
 * 1 usage error, 2 hard failure, 3 wait timeout (pending — never a failure).
 *
 * Non-negotiable routing: the external review goes through the GitHub PR and an
 * `@codex review` comment. This script never invokes a local Codex CLI as a substitute.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CmdResult {
    code: number;
    stdout: string;
    stderr: string;
    error?: string;
}

interface GhUser {
    login?: string;
    type?: string;
}

interface GhReview {
    user?: GhUser;
    commit_id?: string;
    submitted_at?: string;
    state?: string;
    body?: string;
    html_url?: string;
}

interface GhIssueComment {
    user?: GhUser;
    created_at?: string;
    commit_id?: string;
    body?: string;
    html_url?: string;
}

interface GhReviewComment {
    user?: GhUser;
    created_at?: string;
    commit_id?: string;
    path?: string;
    line?: number | null;
    body?: string;
    html_url?: string;
}

interface GhPr {
    number: number;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    title: string;
    headRefOid: string;
}

interface GhCheck {
    bucket?: string;
}

interface PreflightContext {
    repoRoot: string;
    nameWithOwner: string;
    branch: string;
    head: string;
    shortHead: string;
    defaultBranch: string;
}

interface Finding {
    kind: 'review' | 'inline' | 'comment';
    severity: string;
    path: string | null;
    line: number | null;
    body: string;
    url: string;
    at: string;
}

interface ParsedArgs {
    subcommand: string;
    flags: Map<string, string>;
    booleans: Set<string>;
}

// ─── Process runner (git/gh resolved from PATH so tests can stub them) ──────

function run(cmd: readonly string[]): CmdResult {
    // Pass env explicitly so both Node and Bun resolve git/gh against the test fixture PATH.
    const proc = spawnSync(cmd[0] ?? '', [...cmd.slice(1)], { encoding: 'utf8', env: process.env });
    return {
        code: proc.status ?? 1,
        stdout: proc.stdout ?? '',
        stderr: proc.stderr ?? '',
        error: proc.error?.message,
    };
}

function runOk(cmd: readonly string[], what: string): string {
    const res = run(cmd);
    if (res.code !== 0) {
        throw new Error(`${what} failed: ${res.stderr.trim() || res.stdout.trim() || res.error || `exit ${res.code}`}`);
    }
    return res.stdout.trim();
}

function parseJson<T>(raw: string, what: string): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        throw new Error(`${what}: unparseable JSON output`);
    }
}

// ─── Argument parsing ───────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['--base', '--focus', '--since', '--head', '--timeout', '--interval', '--status-file']);
const BOOL_FLAGS = new Set(['--json', '--force']);

export function parseArgs(argv: readonly string[]): ParsedArgs {
    const [subcommand = '', ...rest] = argv;
    const flags = new Map<string, string>();
    const booleans = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
        const tok = rest[i];
        if (BOOL_FLAGS.has(tok)) {
            booleans.add(tok);
        } else if (VALUE_FLAGS.has(tok)) {
            const value = rest[i + 1];
            if (value === undefined) throw new Error(`flag ${tok} requires a value`);
            flags.set(tok, value);
            i++;
        } else {
            throw new Error(`unknown argument: ${tok}`);
        }
    }
    return { subcommand, flags, booleans };
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function emit(args: ParsedArgs, payload: Record<string, unknown>, human: string): void {
    if (args.booleans.has('--json')) {
        console.log(JSON.stringify(payload));
    } else {
        console.log(human);
    }
}

/**
 * Carries an intended CLI exit. Thrown anywhere, rendered once by {@link main}; an empty
 * message is a silent exit (the payload was already emitted). Keeps `main` in-process
 * testable — only the `import.meta.main` entrypoint calls `process.exit`.
 */
class ScriptExit extends Error {
    constructor(
        message: string,
        readonly code: number,
        readonly json: boolean,
    ) {
        super(message);
    }
}

function fail(args: ParsedArgs | null, message: string, code: number): never {
    throw new ScriptExit(message, code, args?.booleans.has('--json') ?? false);
}

function writeStatus(args: ParsedArgs, verdict: string): void {
    const file = args.flags.get('--status-file');
    if (file) writeFileSync(file, `${verdict}\n`);
}

/** Record FAIL for an uncaught hard failure when a status artifact was requested. */
function writeFailureStatus(args: ParsedArgs | null): void {
    const file = args?.flags.get('--status-file');
    if (!file) return;
    try {
        writeFileSync(file, 'FAIL\n');
    } catch {
        // Keep the original command error; a missing/unwritable status path is secondary.
    }
}

// ─── Codex identity + review correlation ────────────────────────────────────

/** Codex bot logins vary; require the Codex name plus GitHub's bot identity signal. */
export function isCodexAuthor(login: string | undefined, type?: string): boolean {
    return /codex/i.test(login ?? '') && (type === 'Bot' || /\[bot\]$/i.test(login ?? ''));
}

/** True when a Codex review already covers this exact pushed HEAD. */
export function isHeadReviewed(reviews: readonly GhReview[], head: string): boolean {
    return reviews.some(
        (review) =>
            isCodexAuthor(review.user?.login, review.user?.type) &&
            review.commit_id === head &&
            isCompletedReview(review),
    );
}

function isCompletedReview(review: GhReview): boolean {
    const state = (review.state ?? '').toUpperCase();
    return review.submitted_at !== undefined && state !== 'DISMISSED' && state !== 'PENDING';
}

const CLEAN_REVIEW_RE =
    /\b(?:no|zero)\s+(?:actionable\s+)?(?:findings?|issues?|problems?)\b|\b(?:looks|seems)\s+good\b|\blgtm\b|\bno\s+concerns\b/i;

/** True only for an explicit Codex clean result attached to this exact HEAD. */
export function isExplicitCleanReview(review: GhReview, head: string): boolean {
    if (
        !isCodexAuthor(review.user?.login, review.user?.type) ||
        review.commit_id !== head ||
        !isCompletedReview(review)
    ) {
        return false;
    }
    const body = (review.body ?? '').trim();
    if (/\bP[0-3]\b/i.test(body)) return false;
    const state = (review.state ?? '').toUpperCase();
    if (!['APPROVED', 'CLEAN', 'COMMENTED'].includes(state)) return false;
    return state === 'CLEAN' || (state === 'APPROVED' && body === '') || CLEAN_REVIEW_RE.test(body);
}

function isFresh(at: string | undefined, since: string): boolean {
    if (at === undefined) return false;
    if (since === '') return true;
    const atMs = Date.parse(at);
    const sinceMs = Date.parse(since);
    return Number.isFinite(atMs) && Number.isFinite(sinceMs) && atMs >= Math.floor(sinceMs / 1000) * 1000;
}

/** True when a fresh, explicit, current-HEAD Codex clean review exists. */
export function hasCurrentCleanReview(reviews: readonly GhReview[], since: string, head: string): boolean {
    return reviews.some((review) => isFresh(review.submitted_at, since) && isExplicitCleanReview(review, head));
}

/** Extract a severity badge from a Codex comment body (`**P1**`, `P2`, …) else `unrated`. */
export function extractSeverity(body: string): string {
    const match = body.match(/\bP([0-3])\b/);
    return match ? `P${match[1]}` : 'unrated';
}

// ─── Request body ───────────────────────────────────────────────────────────

const DEFAULT_FOCUS =
    'for correctness and regressions, security boundaries, data-loss risks, concurrency or race conditions, ' +
    'API/backward compatibility, migration safety, error handling, and missing high-value tests. ' +
    'Prioritize actionable issues over style or nits.';

export function hasCodeReviewRules(repoRoot: string): boolean {
    const agentsPath = join(repoRoot, 'AGENTS.md');
    if (!existsSync(agentsPath)) return false;
    return /^## Code Review Rules\s*$/m.test(readFileSync(agentsPath, 'utf8'));
}

export function buildRequestBody(rulesPresent: boolean, focus: string): string {
    const base = rulesPresent ? '@codex review' : `@codex review ${DEFAULT_FOCUS}`;
    const trimmed = focus.trim();
    return trimmed === '' ? base : `${base} Focus especially on ${trimmed}.`;
}

// ─── Hygiene scan ───────────────────────────────────────────────────────────

interface HygieneResult {
    verdict: 'PASS' | 'WARN' | 'BLOCK';
    blockers: string[];
    warnings: string[];
}

const BLOCK_LINE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [/^(<{7}|={7}|>{7})(\s|$)/, 'merge-conflict marker'],
    [/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'private key material'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
    [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, 'GitHub token'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'GitHub fine-grained PAT'],
    [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'API secret key'],
    [/\bxox[bapors]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
];

const WARN_LINE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
    [/\bdebugger\b/, 'debugger statement'],
    [/\bconsole\.(log|debug|trace)\(/, 'debug logging'],
];

/** Scan added lines (+) and added file names of a `base...HEAD` diff for submission mistakes. */
export function scanHygiene(diffText: string, changedFiles: readonly string[]): HygieneResult {
    const blockers: string[] = [];
    const warnings: string[] = [];
    for (const file of changedFiles) {
        if (/(^|\/)\.env(\.[^/]+)?$/.test(file) && !/\.(example|sample|template)$/.test(file)) {
            blockers.push(`${file}: committed .env file`);
        }
    }
    for (const line of diffText.split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        const added = line.slice(1);
        let blocked = false;
        for (const [pattern, label] of BLOCK_LINE_PATTERNS) {
            if (pattern.test(added)) {
                blockers.push(`${label}: redacted`);
                blocked = true;
                break;
            }
        }
        if (blocked) continue;
        for (const [pattern, label] of WARN_LINE_PATTERNS) {
            if (pattern.test(added)) {
                warnings.push(`${label}: ${added.trim().slice(0, 80)}`);
                break;
            }
        }
    }
    const verdict = blockers.length > 0 ? 'BLOCK' : warnings.length > 0 ? 'WARN' : 'PASS';
    return { verdict, blockers, warnings };
}

// ─── Findings normalization ─────────────────────────────────────────────────

export function normalizeFindings(
    reviews: readonly GhReview[],
    inline: readonly GhReviewComment[],
    comments: readonly GhIssueComment[],
    since: string,
    head: string,
): Finding[] {
    const findings: Finding[] = [];
    const fresh = (at: string | undefined): boolean => isFresh(at, since);
    const onHead = (commitId: string | undefined): boolean => commitId === head;
    for (const r of reviews) {
        if (
            !isCodexAuthor(r.user?.login, r.user?.type) ||
            !isCompletedReview(r) ||
            !fresh(r.submitted_at) ||
            !onHead(r.commit_id)
        )
            continue;
        if (isExplicitCleanReview(r, head)) continue;
        if ((r.body ?? '').trim() === '') continue;
        findings.push({
            kind: 'review',
            severity: extractSeverity(r.body ?? ''),
            path: null,
            line: null,
            body: r.body ?? '',
            url: r.html_url ?? '',
            at: r.submitted_at ?? '',
        });
    }
    for (const c of inline) {
        if (!isCodexAuthor(c.user?.login, c.user?.type) || !fresh(c.created_at) || !onHead(c.commit_id)) continue;
        findings.push({
            kind: 'inline',
            severity: extractSeverity(c.body ?? ''),
            path: c.path ?? null,
            line: c.line ?? null,
            body: c.body ?? '',
            url: c.html_url ?? '',
            at: c.created_at ?? '',
        });
    }
    for (const c of comments) {
        if (!isCodexAuthor(c.user?.login, c.user?.type) || !fresh(c.created_at) || !onHead(c.commit_id)) continue;
        findings.push({
            kind: 'comment',
            severity: extractSeverity(c.body ?? ''),
            path: null,
            line: null,
            body: c.body ?? '',
            url: c.html_url ?? '',
            at: c.created_at ?? '',
        });
    }
    return findings.sort((a, b) => a.at.localeCompare(b.at));
}

export function renderFindings(findings: readonly Finding[]): string {
    if (findings.length === 0) return 'Codex review completed without actionable findings.';
    const lines: string[] = [`Findings (${findings.length})`, ''];
    findings.forEach((f, i) => {
        const where = f.path ? `${f.path}${f.line ? `:${f.line}` : ''}` : f.kind;
        lines.push(`${i + 1}. [${f.severity}] ${where}`);
        lines.push(`   ${f.body.split('\n')[0]}`);
        if (f.url) lines.push(`   ${f.url}`);
    });
    return lines.join('\n');
}

// ─── git/gh primitives ──────────────────────────────────────────────────────

function preflightContext(): PreflightContext {
    const repoRoot = runOk(['git', 'rev-parse', '--show-toplevel'], 'git rev-parse --show-toplevel');
    const branch = runOk(['git', 'branch', '--show-current'], 'git branch --show-current');
    if (branch === '') throw new Error('HEAD is detached — check out a branch before requesting a PR review');
    const head = runOk(['git', 'rev-parse', 'HEAD'], 'git rev-parse HEAD');
    const auth = run(['gh', 'auth', 'status']);
    if (auth.code !== 0) {
        throw new Error('gh CLI missing or unauthenticated — install gh and run `gh auth login` (no browser fallback)');
    }
    const repo = parseJson<{ nameWithOwner: string; defaultBranchRef: { name: string } }>(
        runOk(['gh', 'repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], 'gh repo view'),
        'gh repo view',
    );
    return {
        repoRoot,
        nameWithOwner: repo.nameWithOwner,
        branch,
        head,
        shortHead: head.slice(0, 7),
        defaultBranch: repo.defaultBranchRef.name,
    };
}

function viewPr(): GhPr | null {
    const res = run([
        'gh',
        'pr',
        'view',
        '--json',
        'number,url,state,isDraft,headRefName,baseRefName,title,headRefOid',
    ]);
    if (res.code !== 0) {
        const detail = `${res.stderr}\n${res.stdout}`;
        if (/no pull requests? found|no pull request associated|could not find pull request/i.test(detail)) return null;
        throw new Error(
            `gh pr view failed: ${res.stderr.trim() || res.stdout.trim() || res.error || `exit ${res.code}`}`,
        );
    }
    return parseJson<GhPr>(res.stdout, 'gh pr view');
}

function fetchReviews(ctx: PreflightContext, pr: number): GhReview[] {
    return fetchPaginated<GhReview>(`repos/${ctx.nameWithOwner}/pulls/${pr}/reviews`, 'gh api reviews');
}

function fetchInlineComments(ctx: PreflightContext, pr: number): GhReviewComment[] {
    return fetchPaginated<GhReviewComment>(`repos/${ctx.nameWithOwner}/pulls/${pr}/comments`, 'gh api review comments');
}

function fetchIssueComments(ctx: PreflightContext, pr: number): GhIssueComment[] {
    return fetchPaginated<GhIssueComment>(`repos/${ctx.nameWithOwner}/issues/${pr}/comments`, 'gh api issue comments');
}

function fetchPaginated<T>(endpoint: string, what: string): T[] {
    const pages = parseJson<T[][]>(
        runOk(['gh', 'api', '--method', 'GET', endpoint, '--paginate', '--slurp'], what),
        what,
    );
    return pages.flat();
}

const requestMarker = (head: string): string => `<!-- spur-pr-review head:${head} -->`;

function hasPendingRequest(comments: readonly GhIssueComment[], head: string, login: string): boolean {
    const marker = requestMarker(head);
    return comments.some((comment) => comment.user?.login === login && (comment.body ?? '').includes(marker));
}

function requireExpectedHead(args: ParsedArgs, pr: GhPr): void {
    const expected = args.flags.get('--head');
    if (expected && expected !== pr.headRefOid) {
        writeStatus(args, 'FAIL');
        fail(
            args,
            `PR HEAD moved from ${expected.slice(0, 7)} to ${pr.headRefOid.slice(0, 7)} — request a new review`,
            2,
        );
    }
}

// ─── Subcommands ────────────────────────────────────────────────────────────

function cmdPreflight(args: ParsedArgs): void {
    const ctx = preflightContext();
    const dirty = run(['git', 'status', '--porcelain']);
    if (dirty.code !== 0)
        fail(args, `git status failed: ${dirty.stderr.trim() || dirty.error || `exit ${dirty.code}`}`, 2);
    const dirtyFiles = dirty.stdout.split('\n').filter((l) => l.trim() !== '');
    if (dirtyFiles.length > 0) {
        writeStatus(args, 'FAIL');
        fail(
            args,
            `working tree is dirty (${dirtyFiles.length} entries) — a PR only reviews pushed commits; ` +
                'commit or stash first, or let the skill triage the changes interactively',
            2,
        );
    }
    writeStatus(args, 'PASS');
    emit(
        args,
        { ok: true, ...ctx },
        [
            `Repository: ${ctx.nameWithOwner}`,
            `Branch:     ${ctx.branch}`,
            `HEAD:       ${ctx.shortHead}`,
            `Default:    ${ctx.defaultBranch}`,
            'Local:      clean',
        ].join('\n'),
    );
}

function cmdPush(args: ParsedArgs): void {
    const ctx = preflightContext();
    const upstream = run(['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream.code !== 0) {
        runOk(['git', 'push', '-u', 'origin', 'HEAD'], 'git push -u origin HEAD');
        writeStatus(args, 'PUSHED');
        emit(args, { ok: true, pushed: true, head: ctx.head }, `Pushed ${ctx.branch} and set upstream to origin/HEAD.`);
        return;
    }
    const remoteHead = runOk(['git', 'rev-parse', '@{u}'], 'git rev-parse @{u}');
    if (remoteHead === ctx.head) {
        writeStatus(args, 'UP_TO_DATE');
        emit(args, { ok: true, pushed: false, head: ctx.head }, `Remote already at ${ctx.shortHead}.`);
        return;
    }
    runOk(['git', 'push'], 'git push (fast-forward only — never force)');
    writeStatus(args, 'PUSHED');
    emit(args, { ok: true, pushed: true, head: ctx.head }, `Pushed ${ctx.branch} -> ${ctx.shortHead}.`);
}

function cmdEnsurePr(args: ParsedArgs): void {
    const ctx = preflightContext();
    const existing = viewPr();
    if (existing) {
        writeStatus(args, 'FOUND');
        emit(
            args,
            { ok: true, created: false, pr: existing },
            `PR #${existing.number} ${existing.url}\nBase: ${existing.baseRefName}  State: ${existing.state}`,
        );
        return;
    }
    const base = (args.flags.get('--base') ?? '').trim() || ctx.defaultBranch;
    if (ctx.branch === base) {
        writeStatus(args, 'FAIL');
        fail(args, `current branch is the base branch (${base}) — nothing to review`, 2);
    }
    const commits = run(['git', 'log', '--oneline', `${base}..HEAD`]);
    if (commits.code !== 0)
        fail(args, `git log failed: ${commits.stderr.trim() || commits.error || `exit ${commits.code}`}`, 2);
    if (commits.stdout.trim() === '') {
        writeStatus(args, 'FAIL');
        fail(args, `no commits on ${ctx.branch} beyond ${base} — nothing to review`, 2);
    }
    runOk(['gh', 'pr', 'create', '--fill', '--base', base], 'gh pr create');
    const pr = viewPr();
    if (!pr) {
        writeStatus(args, 'FAIL');
        fail(args, 'gh pr create reported success but the PR is not visible', 2);
    }
    writeStatus(args, 'CREATED');
    emit(args, { ok: true, created: true, pr }, `Created PR #${pr.number} ${pr.url}\nBase: ${pr.baseRefName}`);
}

function cmdHygiene(args: ParsedArgs): void {
    const ctx = preflightContext();
    const pr = viewPr();
    const base = (args.flags.get('--base') ?? '').trim() || pr?.baseRefName || ctx.defaultBranch;
    const filesRaw = run(['git', 'diff', '--name-only', '--diff-filter=AMCR', `${base}...HEAD`]);
    if (filesRaw.code !== 0) {
        writeStatus(args, 'FAIL');
        fail(args, `git diff --name-only failed (exit ${filesRaw.code})`, 2);
    }
    const changedFiles = filesRaw.stdout.split('\n').filter((l) => l.trim() !== '');
    const diffRaw = run(['git', 'diff', `${base}...HEAD`]);
    if (diffRaw.code !== 0) {
        writeStatus(args, 'FAIL');
        fail(args, `git diff failed (exit ${diffRaw.code})`, 2);
    }
    const diff = diffRaw.stdout;
    const result = scanHygiene(diff, changedFiles);
    writeStatus(args, result.verdict);
    const human = [
        `Hygiene (${base}...HEAD): ${result.verdict}`,
        ...result.blockers.map((b) => `  BLOCK ${b}`),
        ...result.warnings.map((w) => `  WARN  ${w}`),
    ].join('\n');
    emit(args, { ok: result.verdict !== 'BLOCK', ...result }, human);
    if (result.verdict === 'BLOCK') throw new ScriptExit('', 2, args.booleans.has('--json'));
}

function cmdRequest(args: ParsedArgs): void {
    const ctx = preflightContext();
    const pr = viewPr();
    if (!pr) {
        writeStatus(args, 'FAIL');
        fail(args, 'no PR for the current branch — run ensure-pr first', 2);
    }
    const force = args.booleans.has('--force');
    const reviews = fetchReviews(ctx, pr.number);
    if (!force && isHeadReviewed(reviews, pr.headRefOid)) {
        writeStatus(args, 'ALREADY_REVIEWED');
        emit(
            args,
            { ok: true, requested: false, alreadyReviewed: true, pr: pr.number, url: pr.url, head: pr.headRefOid },
            `PR #${pr.number}: current HEAD ${pr.headRefOid.slice(0, 7)} already has a Codex review — not requesting a duplicate.`,
        );
        return;
    }
    if (!force) {
        const login = runOk(['gh', 'api', 'user', '--jq', '.login'], 'gh api user');
        if (hasPendingRequest(fetchIssueComments(ctx, pr.number), pr.headRefOid, login)) {
            writeStatus(args, 'ALREADY_REQUESTED');
            emit(
                args,
                { ok: true, requested: false, pending: true, pr: pr.number, url: pr.url, head: pr.headRefOid },
                `PR #${pr.number}: current HEAD ${pr.headRefOid.slice(0, 7)} already has a pending Codex request.`,
            );
            return;
        }
    }
    const body = `${buildRequestBody(hasCodeReviewRules(ctx.repoRoot), args.flags.get('--focus') ?? '')}\n\n${requestMarker(pr.headRefOid)}`;
    const requestedAt = new Date().toISOString();
    runOk(['gh', 'pr', 'comment', String(pr.number), '--body', body], 'gh pr comment (@codex review)');
    writeStatus(args, 'REQUESTED');
    emit(
        args,
        { ok: true, requested: true, pr: pr.number, url: pr.url, head: pr.headRefOid, requestedAt, body },
        `Requested GitHub Codex review on PR #${pr.number} (${pr.url}) at HEAD ${pr.headRefOid.slice(0, 7)}.`,
    );
}

function cmdWait(args: ParsedArgs): void {
    const since = args.flags.get('--since') ?? new Date().toISOString();
    const timeoutSec = Number(args.flags.get('--timeout') ?? '600');
    const intervalSec = Number(args.flags.get('--interval') ?? '30');
    if (!Number.isFinite(timeoutSec) || timeoutSec < 0) fail(args, '--timeout must be a non-negative number', 1);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) fail(args, '--interval must be a positive number', 1);
    const ctx = preflightContext();
    const pr = viewPr();
    if (!pr) {
        writeStatus(args, 'FAIL');
        fail(args, 'no PR for the current branch', 2);
    }
    requireExpectedHead(args, pr);
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
        const reviews = fetchReviews(ctx, pr.number);
        const findings = normalizeFindings(
            reviews,
            fetchInlineComments(ctx, pr.number),
            fetchIssueComments(ctx, pr.number),
            since,
            pr.headRefOid,
        );
        if (findings.length > 0) {
            writeStatus(args, 'FOUND');
            emit(args, { ok: true, verdict: 'FOUND', findings }, renderFindings(findings));
            return;
        }
        if (hasCurrentCleanReview(reviews, since, pr.headRefOid)) {
            writeStatus(args, 'CLEAN');
            emit(
                args,
                { ok: true, verdict: 'CLEAN', pr: pr.number, url: pr.url, head: pr.headRefOid, findings: [] },
                `Codex review completed cleanly for HEAD ${pr.headRefOid.slice(0, 7)}.`,
            );
            return;
        }
        if (Date.now() >= deadline) {
            writeStatus(args, 'TIMEOUT');
            emit(
                args,
                { ok: true, verdict: 'TIMEOUT', pr: pr.number, url: pr.url },
                `No Codex review within ${timeoutSec}s — still pending. Collect later with /sp:dev-pr-review collect.\nPR: ${pr.url}`,
            );
            throw new ScriptExit('', 3, args.booleans.has('--json'));
        }
        const sleepMs = intervalSec * 1000;
        if (sleepMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
    }
}

function cmdCollect(args: ParsedArgs): void {
    const ctx = preflightContext();
    const pr = viewPr();
    if (!pr) {
        fail(args, 'no PR for the current branch', 2);
    }
    requireExpectedHead(args, pr);
    const since = args.flags.get('--since') ?? '';
    const reviews = fetchReviews(ctx, pr.number);
    const findings = normalizeFindings(
        reviews,
        fetchInlineComments(ctx, pr.number),
        fetchIssueComments(ctx, pr.number),
        since,
        pr.headRefOid,
    );
    const verdict =
        findings.length > 0 ? 'FINDINGS' : hasCurrentCleanReview(reviews, since, pr.headRefOid) ? 'CLEAN' : 'PENDING';
    writeStatus(args, verdict);
    const header = `PR #${pr.number} ${pr.url}\nHEAD ${pr.headRefOid.slice(0, 7)} — Codex: ${verdict === 'FINDINGS' ? 'findings' : verdict.toLowerCase()}`;
    const summary =
        verdict === 'PENDING' ? 'No current-HEAD Codex review result yet — still pending.' : renderFindings(findings);
    emit(
        args,
        { ok: true, verdict, pr: pr.number, url: pr.url, head: pr.headRefOid, findings },
        `${header}\n\n${summary}`,
    );
}

function cmdStatus(args: ParsedArgs): void {
    const ctx = preflightContext();
    const pr = viewPr();
    if (pr) requireExpectedHead(args, pr);
    const dirtyResult = run(['git', 'status', '--porcelain']);
    if (dirtyResult.code !== 0) {
        fail(
            args,
            `git status failed: ${dirtyResult.stderr.trim() || dirtyResult.error || `exit ${dirtyResult.code}`}`,
            2,
        );
    }
    const dirty = dirtyResult.stdout.trim();
    let ci = 'unavailable';
    let codex = 'not requested';
    const since = args.flags.get('--since') ?? '';
    if (pr) {
        const checks = run(['gh', 'pr', 'checks', String(pr.number), '--json', 'bucket']);
        if ([0, 1, 8].includes(checks.code) && checks.stdout.trim() !== '') {
            const buckets = parseJson<GhCheck[]>(checks.stdout, 'gh pr checks').map((check) => check.bucket ?? '');
            if (buckets.some((bucket) => bucket === 'fail' || bucket === 'cancel')) ci = 'failing';
            else if (buckets.some((bucket) => bucket === 'pending')) ci = 'pending';
            else if (buckets.length > 0 && buckets.every((bucket) => bucket === 'pass')) ci = 'passing';
        }
        const reviews = fetchReviews(ctx, pr.number);
        const codexReviews = reviews.filter((r) => isCodexAuthor(r.user?.login, r.user?.type));
        if (codexReviews.length > 0) {
            const inline = fetchInlineComments(ctx, pr.number);
            const findings = normalizeFindings(reviews, inline, [], since, pr.headRefOid);
            if (findings.length > 0) codex = 'findings';
            else if (hasCurrentCleanReview(reviews, since, pr.headRefOid)) codex = 'clean';
            else if (codexReviews.some((review) => review.commit_id === pr.headRefOid)) codex = 'pending';
            else codex = 'stale — HEAD moved';
        }
    }
    const payload = {
        ok: true,
        repo: ctx.nameWithOwner,
        branch: ctx.branch,
        head: ctx.shortHead,
        base: pr?.baseRefName ?? ctx.defaultBranch,
        pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : null,
        local: dirty === '' ? 'clean' : 'modified',
        ci,
        codex,
    };
    emit(
        args,
        payload,
        [
            `Repository: ${payload.repo}`,
            `PR:         ${pr ? `#${pr.number} ${pr.url}` : 'none'}`,
            `Branch:     ${payload.branch}`,
            `HEAD:       ${payload.head}`,
            `Base:       ${payload.base}`,
            `Local:      ${payload.local}`,
            `CI:         ${payload.ci}`,
            `Codex:      ${payload.codex}`,
        ].join('\n'),
    );
}

// ─── Entrypoint ─────────────────────────────────────────────────────────────

const HELP = `pr-reviewing.ts — deterministic spine for /sp:dev-pr-review (sp:pr-reviewing)

Installed usage: bun "$(superskill script path sp pr-reviewing.ts)" <subcommand> [flags]
Source-tree usage: bun plugins/sp/scripts/pr-reviewing.ts <subcommand> [flags]

Subcommands:
  preflight            git/gh/repo checks; FAILs on detached HEAD or a dirty tree
  push                 push the branch (never force); sets upstream when missing
  ensure-pr [--base b] reuse the branch's PR or create one with gh pr create --fill
  hygiene  [--base b]  scan base...HEAD for secrets/.env/conflict markers (BLOCK) and debug residue (WARN)
  request  [--force] [--focus text]
                       post @codex review (dedupes reviewed/in-flight HEAD unless --force)
  wait     [--since iso] [--head sha] [--timeout 600] [--interval 30]
                       poll for Codex output; exit 3 on timeout (pending, not failed)
  collect  [--since iso] [--head sha]
                       fetch the current-HEAD Codex result (FINDINGS, CLEAN, or PENDING)
  status   [--since iso] [--head sha] composite repo/PR/CI/Codex status (read-only)

Global flags: --json (single JSON object)  --status-file <path> (one-word verdict)
Exit codes: 0 ok · 1 usage · 2 hard failure · 3 wait timeout`;

export function main(argv: readonly string[]): number {
    let args: ParsedArgs | null = null;
    try {
        args = parseArgs(argv);
        switch (args.subcommand) {
            case 'preflight':
                cmdPreflight(args);
                return 0;
            case 'push':
                cmdPush(args);
                return 0;
            case 'ensure-pr':
                cmdEnsurePr(args);
                return 0;
            case 'hygiene':
                cmdHygiene(args);
                return 0;
            case 'request':
                cmdRequest(args);
                return 0;
            case 'wait':
                cmdWait(args);
                return 0;
            case 'collect':
                cmdCollect(args);
                return 0;
            case 'status':
                cmdStatus(args);
                return 0;
            case '':
            case '--help':
            case 'help':
                console.log(HELP);
                return 0;
            default:
                fail(args, `unknown subcommand: ${args.subcommand}`, 1);
        }
    } catch (error) {
        if (error instanceof ScriptExit) {
            if (error.code === 2 && error.message !== '') writeFailureStatus(args);
            if (error.message !== '') {
                if (error.json) console.log(JSON.stringify({ ok: false, error: error.message }));
                console.error(`error: ${error.message}`);
            }
            return error.code;
        }
        const message = error instanceof Error ? error.message : String(error);
        writeFailureStatus(args);
        if (args?.booleans.has('--json')) console.log(JSON.stringify({ ok: false, error: message }));
        console.error(`error: ${message}`);
        return 2;
    }
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
