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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CmdResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface GhUser {
    login?: string;
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
    // `env: process.env` is load-bearing beyond inheritance: Bun.spawnSync resolves the
    // executable against a startup PATH snapshot unless env is passed explicitly, and tests
    // intercept git/gh by pointing a mutated PATH at fixture stub binaries.
    const proc = Bun.spawnSync([...cmd], { stdout: 'pipe', stderr: 'pipe', env: process.env });
    return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function runOk(cmd: readonly string[], what: string): string {
    const res = run(cmd);
    if (res.code !== 0) {
        throw new Error(`${what} failed: ${res.stderr.trim() || res.stdout.trim() || `exit ${res.code}`}`);
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

// ─── Codex identity + review correlation ────────────────────────────────────

/** Codex bot logins vary (`chatgpt-codex-connector[bot]`, …) — match the invariant substring. */
export function isCodexAuthor(login: string | undefined): boolean {
    return /codex/i.test(login ?? '');
}

/** True when a Codex review already covers this exact pushed HEAD. */
export function isHeadReviewed(reviews: readonly GhReview[], head: string): boolean {
    return reviews.some((r) => isCodexAuthor(r.user?.login) && r.commit_id === head);
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
export function scanHygiene(diffText: string, addedFiles: readonly string[]): HygieneResult {
    const blockers: string[] = [];
    const warnings: string[] = [];
    for (const file of addedFiles) {
        if (/(^|\/)\.env(\.[^/]+)?$/.test(file) && !/\.(example|sample|template)$/.test(file)) {
            blockers.push(`${file}: committed .env file`);
        }
    }
    for (const line of diffText.split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        const added = line.slice(1);
        for (const [pattern, label] of BLOCK_LINE_PATTERNS) {
            if (pattern.test(added)) {
                blockers.push(`${label}: ${added.trim().slice(0, 80)}`);
                break;
            }
        }
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
    const fresh = (at: string | undefined): boolean => at !== undefined && at > since;
    const onHead = (commitId: string | undefined): boolean => commitId === undefined || commitId === head;
    for (const r of reviews) {
        if (!isCodexAuthor(r.user?.login) || !fresh(r.submitted_at) || !onHead(r.commit_id)) continue;
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
        if (!isCodexAuthor(c.user?.login) || !fresh(c.created_at) || !onHead(c.commit_id)) continue;
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
        if (!isCodexAuthor(c.user?.login) || !fresh(c.created_at)) continue;
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
    if (res.code !== 0) return null;
    return parseJson<GhPr>(res.stdout, 'gh pr view');
}

function fetchReviews(ctx: PreflightContext, pr: number): GhReview[] {
    return parseJson<GhReview[]>(
        runOk(['gh', 'api', '--method', 'GET', `repos/${ctx.nameWithOwner}/pulls/${pr}/reviews`], 'gh api reviews'),
        'gh api reviews',
    );
}

function fetchInlineComments(ctx: PreflightContext, pr: number): GhReviewComment[] {
    return parseJson<GhReviewComment[]>(
        runOk(
            ['gh', 'api', '--method', 'GET', `repos/${ctx.nameWithOwner}/pulls/${pr}/comments`],
            'gh api review comments',
        ),
        'gh api review comments',
    );
}

function fetchIssueComments(ctx: PreflightContext, pr: number): GhIssueComment[] {
    return parseJson<GhIssueComment[]>(
        runOk(
            ['gh', 'api', '--method', 'GET', `repos/${ctx.nameWithOwner}/issues/${pr}/comments`],
            'gh api issue comments',
        ),
        'gh api issue comments',
    );
}

// ─── Subcommands ────────────────────────────────────────────────────────────

function cmdPreflight(args: ParsedArgs): void {
    const ctx = preflightContext();
    const dirty = run(['git', 'status', '--porcelain']);
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
    const filesRaw = run(['git', 'diff', '--name-only', '--diff-filter=A', `${base}...HEAD`]);
    const addedFiles = filesRaw.stdout.split('\n').filter((l) => l.trim() !== '');
    const diff = run(['git', 'diff', `${base}...HEAD`]).stdout;
    const result = scanHygiene(diff, addedFiles);
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
    const body = buildRequestBody(hasCodeReviewRules(ctx.repoRoot), args.flags.get('--focus') ?? '');
    runOk(['gh', 'pr', 'comment', String(pr.number), '--body', body], 'gh pr comment (@codex review)');
    const requestedAt = new Date().toISOString();
    writeStatus(args, 'REQUESTED');
    emit(
        args,
        { ok: true, requested: true, pr: pr.number, url: pr.url, head: pr.headRefOid, requestedAt, body },
        `Requested GitHub Codex review on PR #${pr.number} (${pr.url}) at HEAD ${pr.headRefOid.slice(0, 7)}.`,
    );
}

function cmdWait(args: ParsedArgs): void {
    const ctx = preflightContext();
    const pr = viewPr();
    if (!pr) {
        writeStatus(args, 'FAIL');
        fail(args, 'no PR for the current branch', 2);
    }
    const since = args.flags.get('--since') ?? new Date().toISOString();
    const timeoutSec = Number(args.flags.get('--timeout') ?? '600');
    const intervalSec = Number(args.flags.get('--interval') ?? '30');
    const deadline = Date.now() + timeoutSec * 1000;
    for (;;) {
        const findings = normalizeFindings(
            fetchReviews(ctx, pr.number),
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
        if (Date.now() >= deadline) {
            writeStatus(args, 'TIMEOUT');
            emit(
                args,
                { ok: true, verdict: 'TIMEOUT', pr: pr.number, url: pr.url },
                `No Codex review within ${timeoutSec}s — still pending. Collect later with /sp:dev-pr-review collect.\nPR: ${pr.url}`,
            );
            throw new ScriptExit('', 3, args.booleans.has('--json'));
        }
        Bun.sleepSync(intervalSec * 1000);
    }
}

function cmdCollect(args: ParsedArgs): void {
    const ctx = preflightContext();
    const pr = viewPr();
    if (!pr) {
        fail(args, 'no PR for the current branch', 2);
    }
    const since = args.flags.get('--since') ?? '';
    const findings = normalizeFindings(
        fetchReviews(ctx, pr.number),
        fetchInlineComments(ctx, pr.number),
        fetchIssueComments(ctx, pr.number),
        since,
        pr.headRefOid,
    );
    const verdict = findings.length > 0 ? 'FINDINGS' : 'NONE';
    writeStatus(args, verdict);
    const header = `PR #${pr.number} ${pr.url}\nHEAD ${pr.headRefOid.slice(0, 7)} — Codex: ${verdict === 'FINDINGS' ? 'findings' : 'clean'}`;
    emit(
        args,
        { ok: true, verdict, pr: pr.number, url: pr.url, head: pr.headRefOid, findings },
        `${header}\n\n${renderFindings(findings)}`,
    );
}

function cmdStatus(args: ParsedArgs): void {
    const ctx = preflightContext();
    const pr = viewPr();
    const dirty = run(['git', 'status', '--porcelain']).stdout.trim();
    let ci = 'unavailable';
    let codex = 'not requested';
    if (pr) {
        const checks = run(['gh', 'pr', 'checks', String(pr.number)]);
        if (checks.code === 0) {
            const out = checks.stdout;
            ci = /fail/i.test(out) ? 'failing' : /pending|queued|in_progress/i.test(out) ? 'pending' : 'passing';
        }
        const reviews = fetchReviews(ctx, pr.number);
        const codexReviews = reviews.filter((r) => isCodexAuthor(r.user?.login));
        if (codexReviews.length > 0) {
            const latest = codexReviews
                .sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''))
                .at(-1);
            const inline = fetchInlineComments(ctx, pr.number).filter(
                (c) => isCodexAuthor(c.user?.login) && c.commit_id === latest?.commit_id,
            );
            const stale = latest?.commit_id !== pr.headRefOid ? ' (stale — HEAD moved)' : '';
            codex = `${inline.length > 0 ? 'findings' : 'clean'}${stale}`;
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

Usage: bun plugins/sp/scripts/pr-reviewing.ts <subcommand> [flags]

Subcommands:
  preflight            git/gh/repo checks; FAILs on detached HEAD or a dirty tree
  push                 push the branch (never force); sets upstream when missing
  ensure-pr [--base b] reuse the branch's PR or create one with gh pr create --fill
  hygiene  [--base b]  scan base...HEAD for secrets/.env/conflict markers (BLOCK) and debug residue (WARN)
  request  [--force] [--focus text]
                       post @codex review (dedupes when HEAD already reviewed unless --force)
  wait     [--since iso] [--timeout 600] [--interval 30]
                       poll for Codex output; exit 3 on timeout (pending, not failed)
  collect  [--since iso]
                       fetch and normalize the latest Codex findings
  status               composite repo/PR/CI/Codex status (read-only)

Global flags: --json (single JSON object)  --status-file <path> (one-word verdict)
Exit codes: 0 ok · 1 usage · 2 hard failure · 3 wait timeout`;

export function main(argv: readonly string[]): number {
    try {
        const args = parseArgs(argv);
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
            if (error.message !== '') {
                if (error.json) console.log(JSON.stringify({ ok: false, error: error.message }));
                console.error(`error: ${error.message}`);
            }
            return error.code;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`error: ${message}`);
        return 2;
    }
}

if (import.meta.main) {
    process.exit(main(Bun.argv.slice(2)));
}
