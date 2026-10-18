/**
 * pr-review — deterministic spine for the sp:pr-reviewing skill (`spur builder pr-<verb>`).
 *
 * Absorbed from plugins/sp/scripts/pr-reviewing.ts (script-absorption PR-7). Owns every
 * git/gh interaction of the GitHub Codex PR-review loop. Model-bearing work stays in the
 * skill; this module is the testable core the skill's verb sequence calls (task 1251 retired
 * the workflow spine that used to shell out to it).
 *
 * Subcommands: preflight | push | ensure | hygiene | request | wait | collect | status
 * (ensure-pr is accepted as an alias of ensure).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CmdResult {
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

interface Upstream {
    ref: string;
    ahead: number;
    behind: number;
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

// ─── Process runner (single seam; every git/gh call routes through run) ─────

/** How an external command is executed. The only seam between this script and git/gh. */
export type CommandRunner = (cmd: readonly string[]) => CmdResult;

/**
 * Optional caller execution context for one spine invocation (1215). The CLI adapter passes its
 * command context so git/gh run in the caller's cwd with the caller's env and relative status
 * paths resolve beneath that cwd. Omitted → process cwd/env defaults (direct callers).
 */
export interface PrReviewContext {
    /** Directory external commands run in and relative status paths resolve against. */
    cwd?: string;
    /** Environment for external commands; defaults to the process environment. */
    env?: Record<string, string | undefined>;
}

/**
 * Real execution bound to one caller context: resolve the binary from PATH and run it in cwd.
 * `cwd`/`env` fall back to the process values when the context omits them, so a bare
 * `createSpawnRunner()` (and {@link spawnRunner}) keeps the direct-call defaults.
 */
export function createSpawnRunner(context: PrReviewContext = {}): CommandRunner {
    return (cmd) => {
        // Pass cwd and env explicitly so both Node and Bun resolve git/gh in the caller's
        // directory against the caller's PATH — never the process's on a context-bearing call.
        const proc = spawnSync(cmd[0] ?? '', [...cmd.slice(1)], {
            encoding: 'utf8',
            cwd: context.cwd,
            env: context.env ?? getEnvVars(),
        });
        return {
            code: proc.status ?? 1,
            stdout: proc.stdout ?? '',
            stderr: proc.stderr ?? '',
            error: proc.error?.message,
        };
    };
}

/** Real execution against the process defaults. The default runner. */
export const spawnRunner: CommandRunner = createSpawnRunner();

/** Test-injected runner; `null` means every invocation binds the context-bound default. */
let injectedRunner: CommandRunner | null = null;

/**
 * Swap the git/gh runner. Tests inject an in-process stub so a suite of CLI cases costs no
 * subprocess spawns; call with no argument to restore real execution.
 */
export function setCommandRunner(next?: CommandRunner): void {
    injectedRunner = next ?? null;
}

/**
 * Per-invocation execution seams: the command runner plus status writes rooted at the context.
 * Built once per {@link main} call so consecutive invocations never share cwd/env state.
 */
interface SpineRuntime {
    run: CommandRunner;
    writeStatus(file: string, content: string): void;
}

/** Bind the runner and status writer for one invocation; process cwd/env are never mutated. */
function createRuntime(context: PrReviewContext): SpineRuntime {
    const baseDir = context.cwd ?? process.cwd();
    return {
        run: injectedRunner ?? createSpawnRunner(context),
        // `resolve` keeps absolute paths absolute and roots relative paths at the invocation cwd.
        writeStatus: (file, content) => writeFileSync(resolve(baseDir, file), content),
    };
}

function run(rt: SpineRuntime, cmd: readonly string[]): CmdResult {
    return rt.run(cmd);
}

function runOk(rt: SpineRuntime, cmd: readonly string[], what: string): string {
    const res = run(rt, cmd);
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

/** Parse `spur builder pr <op>` argv into the op, its value flags and its boolean flags. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
    const [subcommand = '', ...rest] = argv;
    const flags = new Map<string, string>();
    const booleans = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
        const tok = rest[i];
        if (tok === undefined) continue;
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

/** Line sink for every spine write; each call is one line (the sink adds the terminator). */
export interface PrReviewIo {
    out(line: string): void;
    err(line: string): void;
}

/** The caller's sink, installed by {@link main} for the duration of one op. */
let io: PrReviewIo | null = null;

function emit(args: ParsedArgs, payload: Record<string, unknown>, human: string): void {
    if (args.booleans.has('--json')) {
        io?.out(JSON.stringify(payload));
    } else {
        io?.out(human);
    }
}

/**
 * Carries an intended CLI exit. Thrown anywhere, rendered once by {@link main}; an empty
 * message is a silent exit (the payload was already emitted). Keeps `main` in-process
 * testable — the CLI adapter maps the returned code onto the process exit code.
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

function writeStatus(rt: SpineRuntime, args: ParsedArgs, verdict: string): void {
    const file = args.flags.get('--status-file');
    if (file) rt.writeStatus(file, `${verdict}\n`);
}

/** Record FAIL for an uncaught hard failure when a status artifact was requested. */
function writeFailureStatus(rt: SpineRuntime, args: ParsedArgs | null): void {
    const file = args?.flags.get('--status-file');
    if (!file) return;
    try {
        rt.writeStatus(file, 'FAIL\n');
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

/** True when the repo's AGENTS.md carries a `## Code Review Rules` section. */
export function hasCodeReviewRules(repoRoot: string): boolean {
    const agentsPath = join(repoRoot, 'AGENTS.md');
    if (!existsSync(agentsPath)) return false;
    return /^## Code Review Rules\s*$/m.test(readFileSync(agentsPath, 'utf8'));
}

/** The `@codex review` request comment, with the default focus unless the repo has its own rules. */
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

/** Render collected review findings as the numbered human summary. */
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

function preflightContext(rt: SpineRuntime): PreflightContext {
    const repoRoot = runOk(rt, ['git', 'rev-parse', '--show-toplevel'], 'git rev-parse --show-toplevel');
    const branch = runOk(rt, ['git', 'branch', '--show-current'], 'git branch --show-current');
    if (branch === '') throw new Error('HEAD is detached — check out a branch before requesting a PR review');
    const head = runOk(rt, ['git', 'rev-parse', 'HEAD'], 'git rev-parse HEAD');
    const auth = run(rt, ['gh', 'auth', 'status']);
    if (auth.code !== 0) {
        throw new Error('gh CLI missing or unauthenticated — install gh and run `gh auth login` (no browser fallback)');
    }
    const repo = parseJson<{ nameWithOwner: string; defaultBranchRef: { name: string } }>(
        runOk(rt, ['gh', 'repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], 'gh repo view'),
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

/** Upstream divergence, non-fatal: a missing upstream is a normal state, not an error. */
function resolveUpstream(rt: SpineRuntime): Upstream | null {
    const refRes = run(rt, ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (refRes.code !== 0) return null;
    const ref = refRes.stdout.trim();
    const count = (res: CmdResult): number => {
        const n = Number(res.stdout.trim());
        return res.code === 0 && Number.isFinite(n) ? n : 0;
    };
    return {
        ref,
        ahead: count(run(rt, ['git', 'rev-list', '--count', '@{u}..HEAD'])),
        behind: count(run(rt, ['git', 'rev-list', '--count', 'HEAD..@{u}'])),
    };
}

function viewPr(rt: SpineRuntime): GhPr | null {
    const res = run(rt, [
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

function fetchReviews(rt: SpineRuntime, ctx: PreflightContext, pr: number): GhReview[] {
    return fetchPaginated<GhReview>(rt, `repos/${ctx.nameWithOwner}/pulls/${pr}/reviews`, 'gh api reviews');
}

function fetchInlineComments(rt: SpineRuntime, ctx: PreflightContext, pr: number): GhReviewComment[] {
    return fetchPaginated<GhReviewComment>(
        rt,
        `repos/${ctx.nameWithOwner}/pulls/${pr}/comments`,
        'gh api review comments',
    );
}

function fetchIssueComments(rt: SpineRuntime, ctx: PreflightContext, pr: number): GhIssueComment[] {
    return fetchPaginated<GhIssueComment>(
        rt,
        `repos/${ctx.nameWithOwner}/issues/${pr}/comments`,
        'gh api issue comments',
    );
}

function fetchPaginated<T>(rt: SpineRuntime, endpoint: string, what: string): T[] {
    const pages = parseJson<T[][]>(
        runOk(rt, ['gh', 'api', '--method', 'GET', endpoint, '--paginate', '--slurp'], what),
        what,
    );
    return pages.flat();
}

const requestMarker = (head: string): string => `<!-- spur-pr-review head:${head} -->`;

function hasPendingRequest(comments: readonly GhIssueComment[], head: string, login: string): boolean {
    const marker = requestMarker(head);
    return comments.some((comment) => comment.user?.login === login && (comment.body ?? '').includes(marker));
}

function requireExpectedHead(rt: SpineRuntime, args: ParsedArgs, pr: GhPr): void {
    // 0771: head pinning only protects when the flag actually carries a SHA — an empty or
    // missing --head must fail loud instead of silently reviewing whatever HEAD is current.
    const expected = args.flags.get('--head');
    if (!expected) {
        writeStatus(rt, args, 'FAIL');
        fail(args, '--head <sha> is required and must match the reviewed request HEAD', 2);
    }
    if (expected !== pr.headRefOid) {
        writeStatus(rt, args, 'FAIL');
        fail(
            args,
            `PR HEAD moved from ${expected.slice(0, 7)} to ${pr.headRefOid.slice(0, 7)} — request a new review`,
            2,
        );
    }
}

// ─── Subcommands ────────────────────────────────────────────────────────────

function cmdPreflight(rt: SpineRuntime, args: ParsedArgs): void {
    const ctx = preflightContext(rt);
    const dirty = run(rt, ['git', 'status', '--porcelain']);
    if (dirty.code !== 0)
        fail(args, `git status failed: ${dirty.stderr.trim() || dirty.error || `exit ${dirty.code}`}`, 2);
    const dirtyFiles = dirty.stdout.split('\n').filter((l) => l.trim() !== '');
    if (dirtyFiles.length > 0) {
        writeStatus(rt, args, 'FAIL');
        fail(
            args,
            `working tree is dirty (${dirtyFiles.length} entries) — a PR only reviews pushed commits; ` +
                'commit or stash first, or let the skill triage the changes interactively',
            2,
        );
    }
    const base = (args.flags.get('--base') ?? '').trim() || ctx.defaultBranch;
    const upstream = resolveUpstream(rt);
    if (ctx.branch === base) {
        writeStatus(rt, args, 'FAIL');
        fail(
            args,
            `current branch is the base branch (${base}) — a PR reviews a feature branch against it; ` +
                'check out a feature branch (nothing on the base branch is reviewable)',
            2,
        );
    }
    writeStatus(rt, args, 'PASS');
    emit(
        args,
        { ok: true, ...ctx, upstream },
        [
            `Repository: ${ctx.nameWithOwner}`,
            `Branch:     ${ctx.branch}`,
            `HEAD:       ${ctx.shortHead}`,
            `Default:    ${ctx.defaultBranch}`,
            `Upstream:   ${upstream ? `${upstream.ref} (ahead ${upstream.ahead}, behind ${upstream.behind})` : `none (publishing would create origin/${ctx.branch})`}`,
            'Local:      clean',
        ].join('\n'),
    );
}

function cmdPush(rt: SpineRuntime, args: ParsedArgs): void {
    const ctx = preflightContext(rt);
    const upstream = run(rt, ['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream.code !== 0) {
        runOk(rt, ['git', 'push', '-u', 'origin', 'HEAD'], 'git push -u origin HEAD');
        writeStatus(rt, args, 'PUSHED');
        emit(args, { ok: true, pushed: true, head: ctx.head }, `Pushed ${ctx.branch} and set upstream to origin/HEAD.`);
        return;
    }
    const remoteHead = runOk(rt, ['git', 'rev-parse', '@{u}'], 'git rev-parse @{u}');
    if (remoteHead === ctx.head) {
        writeStatus(rt, args, 'UP_TO_DATE');
        emit(args, { ok: true, pushed: false, head: ctx.head }, `Remote already at ${ctx.shortHead}.`);
        return;
    }
    runOk(rt, ['git', 'push'], 'git push (fast-forward only — never force)');
    writeStatus(rt, args, 'PUSHED');
    emit(args, { ok: true, pushed: true, head: ctx.head }, `Pushed ${ctx.branch} -> ${ctx.shortHead}.`);
}

function cmdEnsurePr(rt: SpineRuntime, args: ParsedArgs): void {
    const ctx = preflightContext(rt);
    const existing = viewPr(rt);
    if (existing) {
        writeStatus(rt, args, 'FOUND');
        emit(
            args,
            { ok: true, created: false, pr: existing },
            `PR #${existing.number} ${existing.url}\nBase: ${existing.baseRefName}  State: ${existing.state}`,
        );
        return;
    }
    const base = (args.flags.get('--base') ?? '').trim() || ctx.defaultBranch;
    if (ctx.branch === base) {
        writeStatus(rt, args, 'FAIL');
        fail(args, `current branch is the base branch (${base}) — nothing to review`, 2);
    }
    const commits = run(rt, ['git', 'log', '--oneline', `${base}..HEAD`]);
    if (commits.code !== 0)
        fail(args, `git log failed: ${commits.stderr.trim() || commits.error || `exit ${commits.code}`}`, 2);
    if (commits.stdout.trim() === '') {
        writeStatus(rt, args, 'FAIL');
        fail(args, `no commits on ${ctx.branch} beyond ${base} — nothing to review`, 2);
    }
    runOk(rt, ['gh', 'pr', 'create', '--fill', '--base', base], 'gh pr create');
    const pr = viewPr(rt);
    if (!pr) {
        writeStatus(rt, args, 'FAIL');
        fail(args, 'gh pr create reported success but the PR is not visible', 2);
    }
    writeStatus(rt, args, 'CREATED');
    emit(args, { ok: true, created: true, pr }, `Created PR #${pr.number} ${pr.url}\nBase: ${pr.baseRefName}`);
}

function cmdHygiene(rt: SpineRuntime, args: ParsedArgs): void {
    const ctx = preflightContext(rt);
    const pr = viewPr(rt);
    const base = (args.flags.get('--base') ?? '').trim() || pr?.baseRefName || ctx.defaultBranch;
    const filesRaw = run(rt, ['git', 'diff', '--name-only', '--diff-filter=AMCR', `${base}...HEAD`]);
    if (filesRaw.code !== 0) {
        writeStatus(rt, args, 'FAIL');
        fail(args, `git diff --name-only failed (exit ${filesRaw.code})`, 2);
    }
    const changedFiles = filesRaw.stdout.split('\n').filter((l) => l.trim() !== '');
    const diffRaw = run(rt, ['git', 'diff', `${base}...HEAD`]);
    if (diffRaw.code !== 0) {
        writeStatus(rt, args, 'FAIL');
        fail(args, `git diff failed (exit ${diffRaw.code})`, 2);
    }
    const diff = diffRaw.stdout;
    const result = scanHygiene(diff, changedFiles);
    writeStatus(rt, args, result.verdict);
    const human = [
        `Hygiene (${base}...HEAD): ${result.verdict}`,
        ...result.blockers.map((b) => `  BLOCK ${b}`),
        ...result.warnings.map((w) => `  WARN  ${w}`),
    ].join('\n');
    emit(args, { ok: result.verdict !== 'BLOCK', ...result }, human);
    if (result.verdict === 'BLOCK') throw new ScriptExit('', 2, args.booleans.has('--json'));
}

function cmdRequest(rt: SpineRuntime, args: ParsedArgs): void {
    const ctx = preflightContext(rt);
    const pr = viewPr(rt);
    if (!pr) {
        writeStatus(rt, args, 'FAIL');
        fail(args, 'no PR for the current branch — run ensure-pr first', 2);
    }
    const force = args.booleans.has('--force');
    const reviews = fetchReviews(rt, ctx, pr.number);
    if (!force && isHeadReviewed(reviews, pr.headRefOid)) {
        writeStatus(rt, args, 'ALREADY_REVIEWED');
        emit(
            args,
            { ok: true, requested: false, alreadyReviewed: true, pr: pr.number, url: pr.url, head: pr.headRefOid },
            `PR #${pr.number}: current HEAD ${pr.headRefOid.slice(0, 7)} already has a Codex review — not requesting a duplicate.`,
        );
        return;
    }
    if (!force) {
        const login = runOk(rt, ['gh', 'api', 'user', '--jq', '.login'], 'gh api user');
        if (hasPendingRequest(fetchIssueComments(rt, ctx, pr.number), pr.headRefOid, login)) {
            writeStatus(rt, args, 'ALREADY_REQUESTED');
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
    runOk(rt, ['gh', 'pr', 'comment', String(pr.number), '--body', body], 'gh pr comment (@codex review)');
    writeStatus(rt, args, 'REQUESTED');
    emit(
        args,
        { ok: true, requested: true, pr: pr.number, url: pr.url, head: pr.headRefOid, requestedAt, body },
        `Requested GitHub Codex review on PR #${pr.number} (${pr.url}) at HEAD ${pr.headRefOid.slice(0, 7)}.`,
    );
}

/**
 * 1161 R1: re-read the PR and re-assert the pinned identity + expected head. Called at the start of
 * every poll and again immediately before any FOUND/CLEAN/TIMEOUT status or output, because a head
 * captured once at wait start lets a later push return CLEAN for an old commit. A vanished PR, a
 * different PR on the branch, or a moved head is FAIL/exit2 through the existing error channel.
 */
function revalidateWaitTarget(rt: SpineRuntime, args: ParsedArgs, number: number): GhPr {
    const fresh = viewPr(rt);
    if (!fresh || fresh.number !== number) {
        writeStatus(rt, args, 'FAIL');
        fail(
            args,
            `PR #${number} is no longer the branch's PR (view reports ${fresh ? `#${fresh.number}` : 'none'}) — request a fresh review`,
            2,
        );
    }
    requireExpectedHead(rt, args, fresh);
    return fresh;
}

function cmdWait(rt: SpineRuntime, args: ParsedArgs): void {
    const since = args.flags.get('--since') ?? new Date().toISOString();
    const timeoutSec = Number(args.flags.get('--timeout') ?? '600');
    const intervalSec = Number(args.flags.get('--interval') ?? '30');
    if (!Number.isFinite(timeoutSec) || timeoutSec < 0) fail(args, '--timeout must be a non-negative number', 1);
    if (!Number.isFinite(intervalSec) || intervalSec <= 0) fail(args, '--interval must be a positive number', 1);
    const ctx = preflightContext(rt);
    const pr = viewPr(rt);
    if (!pr) {
        writeStatus(rt, args, 'FAIL');
        fail(args, 'no PR for the current branch', 2);
    }
    const number = pr.number; // 1161 R1: pinned — a switched PR number is a failure, not a retarget.
    requireExpectedHead(rt, args, pr);
    const deadline = Date.now() + timeoutSec * 1000; // fixed once; validation never resets it
    for (;;) {
        const observed = revalidateWaitTarget(rt, args, number);
        const reviews = fetchReviews(rt, ctx, number);
        const findings = normalizeFindings(
            reviews,
            fetchInlineComments(rt, ctx, number),
            fetchIssueComments(rt, ctx, number),
            since,
            observed.headRefOid,
        );
        if (findings.length > 0) {
            revalidateWaitTarget(rt, args, number); // pre-return recheck: never FOUND for a moved head
            writeStatus(rt, args, 'FOUND');
            emit(args, { ok: true, verdict: 'FOUND', findings }, renderFindings(findings));
            return;
        }
        if (hasCurrentCleanReview(reviews, since, observed.headRefOid)) {
            const fresh = revalidateWaitTarget(rt, args, number); // pre-return recheck: never CLEAN for a moved head
            writeStatus(rt, args, 'CLEAN');
            emit(
                args,
                { ok: true, verdict: 'CLEAN', pr: fresh.number, url: fresh.url, head: fresh.headRefOid, findings: [] },
                `Codex review completed cleanly for HEAD ${fresh.headRefOid.slice(0, 7)}.`,
            );
            return;
        }
        if (Date.now() >= deadline) {
            revalidateWaitTarget(rt, args, number); // a head moved while pending is a failure, not a timeout
            writeStatus(rt, args, 'TIMEOUT');
            emit(
                args,
                { ok: true, verdict: 'TIMEOUT', pr: number, url: pr.url },
                `No Codex review within ${timeoutSec}s — still pending. Collect later with /sp:dev-pr-review collect.\nPR: ${pr.url}`,
            );
            throw new ScriptExit('', 3, args.booleans.has('--json'));
        }
        const sleepMs = intervalSec * 1000;
        if (sleepMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
    }
}

function cmdCollect(rt: SpineRuntime, args: ParsedArgs): void {
    const ctx = preflightContext(rt);
    const pr = viewPr(rt);
    if (!pr) {
        fail(args, 'no PR for the current branch', 2);
    }
    requireExpectedHead(rt, args, pr);
    const since = args.flags.get('--since') ?? '';
    const reviews = fetchReviews(rt, ctx, pr.number);
    const findings = normalizeFindings(
        reviews,
        fetchInlineComments(rt, ctx, pr.number),
        fetchIssueComments(rt, ctx, pr.number),
        since,
        pr.headRefOid,
    );
    const verdict =
        findings.length > 0 ? 'FINDINGS' : hasCurrentCleanReview(reviews, since, pr.headRefOid) ? 'CLEAN' : 'PENDING';
    writeStatus(rt, args, verdict);
    const header = `PR #${pr.number} ${pr.url}\nHEAD ${pr.headRefOid.slice(0, 7)} — Codex: ${verdict === 'FINDINGS' ? 'findings' : verdict.toLowerCase()}`;
    const summary =
        verdict === 'PENDING' ? 'No current-HEAD Codex review result yet — still pending.' : renderFindings(findings);
    emit(
        args,
        { ok: true, verdict, pr: pr.number, url: pr.url, head: pr.headRefOid, findings },
        `${header}\n\n${summary}`,
    );
}

function cmdStatus(rt: SpineRuntime, args: ParsedArgs): void {
    const ctx = preflightContext(rt);
    const pr = viewPr(rt);
    if (pr) requireExpectedHead(rt, args, pr);
    const dirtyResult = run(rt, ['git', 'status', '--porcelain']);
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
        const checks = run(rt, ['gh', 'pr', 'checks', String(pr.number), '--json', 'bucket']);
        if ([0, 1, 8].includes(checks.code) && checks.stdout.trim() !== '') {
            const buckets = parseJson<GhCheck[]>(checks.stdout, 'gh pr checks').map((check) => check.bucket ?? '');
            if (buckets.some((bucket) => bucket === 'fail' || bucket === 'cancel')) ci = 'failing';
            else if (buckets.some((bucket) => bucket === 'pending')) ci = 'pending';
            else if (buckets.length > 0 && buckets.every((bucket) => bucket === 'pass')) ci = 'passing';
        }
        const reviews = fetchReviews(rt, ctx, pr.number);
        const codexReviews = reviews.filter((r) => isCodexAuthor(r.user?.login, r.user?.type));
        if (codexReviews.length > 0) {
            const inline = fetchInlineComments(rt, ctx, pr.number);
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

export const PR_REVIEW_HELP = `spur builder pr — deterministic spine for /sp:dev-pr-review (sp:pr-reviewing)

Usage: spur builder pr <subcommand> [flags]

Subcommands:
  preflight            git/gh/repo checks; FAILs on detached HEAD or a dirty tree
  push                 push the branch (never force); sets upstream when missing
  ensure [--base b]    reuse the branch's PR or create one with gh pr create --fill
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

/**
 * Run one spine op. Every line goes to `sink`; the CLI passes its command output so
 * `spur builder pr` writes through the shared output seam. The optional `context` binds external
 * commands and status writes to the caller's cwd/env for this invocation only.
 */
export function main(argv: readonly string[], sink: PrReviewIo, context: PrReviewContext = {}): number {
    const previous = io;
    io = sink;
    try {
        return runSpine(argv, createRuntime(context));
    } finally {
        io = previous;
    }
}

function runSpine(argv: readonly string[], rt: SpineRuntime): number {
    let args: ParsedArgs | null = null;
    try {
        args = parseArgs(argv);
        switch (args.subcommand) {
            case 'preflight':
                cmdPreflight(rt, args);
                return 0;
            case 'push':
                cmdPush(rt, args);
                return 0;
            case 'ensure':
            case 'ensure-pr':
                cmdEnsurePr(rt, args);
                return 0;
            case 'hygiene':
                cmdHygiene(rt, args);
                return 0;
            case 'request':
                cmdRequest(rt, args);
                return 0;
            case 'wait':
                cmdWait(rt, args);
                return 0;
            case 'collect':
                cmdCollect(rt, args);
                return 0;
            case 'status':
                cmdStatus(rt, args);
                return 0;
            case '':
            case '--help':
            case 'help':
                io?.out(PR_REVIEW_HELP);
                return 0;
            default:
                fail(args, `unknown subcommand: ${args.subcommand}`, 1);
        }
    } catch (error) {
        if (error instanceof ScriptExit) {
            if (error.code === 2 && error.message !== '') writeFailureStatus(rt, args);
            if (error.message !== '') {
                if (error.json) io?.out(JSON.stringify({ ok: false, error: error.message }));
                io?.err(`error: ${error.message}`);
            }
            return error.code;
        }
        const message = error instanceof Error ? error.message : String(error);
        writeFailureStatus(rt, args);
        if (args?.booleans.has('--json')) io?.out(JSON.stringify({ ok: false, error: message }));
        io?.err(`error: ${message}`);
        return 2;
    }
}

// ─── Composed verbs (task 1219) ─────────────────────────────────────────────
//
// `spur builder pr-<verb>` replaces the `pr <op>` pass-through with four flat verbs. Sequencing
// lives here, not in the CLI and not in workflow shell (1251): each verb runs the existing ops in
// order inside ONE runtime, so a verb's stdout JSON, `--status-file` verdict and exit code equal
// the composition of the former operations it replaces.
//
// The ops always run with `--json`: their JSON records are the only lossless interface for the
// composition (the request record feeds wait/collect in-process, so the workflow no longer needs
// the `prSince`/`prHead` file-var plumbing). Human mode renders the composed record instead of the
// per-op text. Exit 2 is a hard failure and carries verdict FAIL; exit 3 is a wait timeout and
// always carries verdict PENDING.

/** The four flat composer verbs registered under `spur builder`. */
export type PrVerb = 'status' | 'check' | 'open' | 'review';

/** Flags of the composer verbs. `runPrVerb` owns the mapping onto the ops it composes. */
export interface PrVerbOptions {
    /** `pr-check`/`pr-open`: base branch for the diff and a newly created PR. */
    base?: string;
    /** `pr-status`: only count review output submitted at or after this time. */
    since?: string;
    /** `pr-status`: explicit commit pin; defaults to the current local HEAD. */
    head?: string;
    /** `pr-review`: extra focus appended to the `@codex review` request. */
    focus?: string;
    /** `pr-review`: re-request even when the head is already reviewed (`mode=rerun`). */
    force?: boolean;
    /** `pr-review`: post the request and return PENDING without polling (`mode=submit`). */
    noWait?: boolean;
    /** `pr-review`: wait budget in seconds (the op's own default applies when omitted). */
    timeout?: string;
    /** `pr-review`: poll interval in seconds (the op's own default applies when omitted). */
    interval?: string;
    /** `pr-check`: run hygiene only, skipping preflight (a dirty tree is expected). */
    scanOnly?: boolean;
    /** Emit the composed JSON object instead of the human summary. */
    json?: boolean;
    /** Verdict path for the composed result; `pr-status` is read-only and writes none. */
    statusFile?: string;
}

/** One composed op run: its exit code and the JSON record it reported, if any. */
interface VerbOpRun {
    code: number;
    payload: Record<string, unknown> | null;
}

/** The composed result: the verb's exit code plus the object it reports. */
interface VerbResult {
    code: number;
    payload: Record<string, unknown>;
}

/** A composed payload field as an object; an absent or null field reads as empty. */
function obj(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** A composed payload field as text. */
function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** A composed payload field as a list. */
function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/** The verdict word an op recorded, else `FAIL` — the op's own word, never a re-derived one. */
function word(payload: Record<string, unknown> | null, fallback = 'FAIL'): string {
    const verdict = payload?.verdict;
    return typeof verdict === 'string' && verdict !== '' ? verdict : fallback;
}

/** An op's findings, typed for the spine's own renderer. */
function findingsArg(value: unknown): Parameters<typeof renderFindings>[0] {
    return list(value) as Parameters<typeof renderFindings>[0];
}

/**
 * Run one spine op in-process: stdout is buffered so the composition can read the record, while
 * stderr streams straight through. `true`-exit errors are already rendered by `runSpine`.
 */
function runVerbOp(argv: readonly string[], rt: SpineRuntime, sink: PrReviewIo): VerbOpRun {
    const out: string[] = [];
    const previous = io;
    io = { out: (line) => out.push(line), err: (line) => sink.err(line) };
    try {
        const code = runSpine(argv, rt);
        let payload: Record<string, unknown> | null = null;
        for (let i = out.length - 1; i >= 0; i--) {
            const line = (out[i] ?? '').trim();
            if (!line.startsWith('{')) continue;
            try {
                payload = JSON.parse(line) as Record<string, unknown>;
            } catch {
                payload = null;
            }
            break;
        }
        return { code, payload };
    } finally {
        io = previous;
    }
}

/** `--timeout`/`--interval` as the `wait` op reads them; a bad value is a usage error (exit 1). */
function validPollBudget(opts: PrVerbOptions, sink: PrReviewIo): boolean {
    if (opts.timeout !== undefined && !(Number.isFinite(Number(opts.timeout)) && Number(opts.timeout) >= 0)) {
        sink.err('error: --timeout must be a non-negative number');
        return false;
    }
    if (opts.interval !== undefined && !(Number.isFinite(Number(opts.interval)) && Number(opts.interval) > 0)) {
        sink.err('error: --interval must be a positive number');
        return false;
    }
    return true;
}

/** Write the composed verdict; `PENDING` overrides are the verb's contract, not the op's word. */
function writeVerbStatus(rt: SpineRuntime, opts: PrVerbOptions, verdict: string): void {
    if (opts.statusFile !== undefined) rt.writeStatus(opts.statusFile, `${verdict}\n`);
}

/**
 * The commit `pr-status` reads when the caller pins no `--head`: the current local HEAD, so a bare
 * read-only status answers for the branch the caller is on. A pin the caller does supply stays
 * strict — the op compares it against the PR head and fails loud (exit 2) instead of attributing a
 * review to a moved commit (0771).
 */
function currentHead(rt: SpineRuntime): string | undefined {
    const res = run(rt, ['git', 'rev-parse', 'HEAD']);
    const head = res.stdout.trim();
    return res.code === 0 && head !== '' ? head : undefined;
}

/** `pr-status`: status + collect, with the collect record as `review` (read-only, no verdict). */
function composeStatus(rt: SpineRuntime, opts: PrVerbOptions, sink: PrReviewIo): VerbResult {
    const flags = ['--json'];
    if (opts.since !== undefined) flags.push('--since', opts.since);
    const head = opts.head ?? currentHead(rt);
    if (head !== undefined) flags.push('--head', head);
    const status = runVerbOp(['status', ...flags], rt, sink);
    if (status.code !== 0) return { code: status.code, payload: { ...obj(status.payload), review: null } };
    if (status.payload?.pr === null || status.payload?.pr === undefined) {
        return { code: 0, payload: { ...obj(status.payload), review: null } };
    }
    const collect = runVerbOp(['collect', ...flags], rt, sink);
    return { code: collect.code, payload: { ...obj(status.payload), review: collect.payload } };
}

/** `pr-check`: preflight then hygiene; a preflight FAIL stops the sequence (verdict FAIL). */
function composeCheck(rt: SpineRuntime, opts: PrVerbOptions, sink: PrReviewIo): VerbResult {
    const flags = ['--json'];
    if (opts.statusFile !== undefined) flags.push('--status-file', opts.statusFile);
    if (opts.base !== undefined) flags.push('--base', opts.base);
    const preflight = opts.scanOnly === true ? null : runVerbOp(['preflight', ...flags], rt, sink);
    if (preflight !== null && preflight.code !== 0) {
        return {
            code: preflight.code,
            payload: { ok: false, verdict: 'FAIL', preflight: preflight.payload, hygiene: null },
        };
    }
    const hygiene = runVerbOp(['hygiene', ...flags], rt, sink);
    const opWord = word(hygiene.payload, 'PASS');
    const verdict = hygiene.code === 0 ? opWord : opWord === 'BLOCK' ? 'BLOCK' : 'FAIL';
    return {
        code: hygiene.code,
        payload: { ok: hygiene.code === 0, verdict, preflight: preflight?.payload ?? null, hygiene: hygiene.payload },
    };
}

/** `pr-open`: push then ensure; a rejected push stops the sequence (verdict FAIL, never a force). */
function composeOpen(rt: SpineRuntime, opts: PrVerbOptions, sink: PrReviewIo): VerbResult {
    const flags = ['--json'];
    if (opts.statusFile !== undefined) flags.push('--status-file', opts.statusFile);
    const push = runVerbOp(['push', ...flags], rt, sink);
    if (push.code !== 0) {
        return { code: push.code, payload: { ok: false, verdict: 'FAIL', push: push.payload, pr: null } };
    }
    const ensureFlags = [...flags];
    if (opts.base !== undefined) ensureFlags.push('--base', opts.base);
    const ensure = runVerbOp(['ensure', ...ensureFlags], rt, sink);
    const verdict = ensure.code === 0 ? (ensure.payload?.created === true ? 'CREATED' : 'FOUND') : 'FAIL';
    return {
        code: ensure.code,
        payload: { ok: ensure.code === 0, verdict, push: push.payload, pr: ensure.payload?.pr ?? null },
    };
}

/**
 * `pr-review`: request, then route on its record — ALREADY_REVIEWED collects without a new request,
 * ALREADY_REQUESTED and `--no-wait` report PENDING, REQUESTED waits and then collects. The request
 * record stays in-process, so wait/collect correlate on it without the workflow's file-var plumbing.
 */
function composeReview(rt: SpineRuntime, opts: PrVerbOptions, sink: PrReviewIo): VerbResult {
    const statusFlags = opts.statusFile !== undefined ? ['--status-file', opts.statusFile] : [];
    // Reject a bad poll budget before the request posts anything: a usage error (exit 1) must not
    // leave a half-run review behind, and it writes no status file.
    if (!validPollBudget(opts, sink)) {
        return { code: 1, payload: { ok: false, verdict: 'FAIL', request: null, findings: [] } };
    }
    const requestFlags = ['--json', ...statusFlags];
    if (opts.force === true) requestFlags.push('--force');
    if (opts.focus !== undefined) requestFlags.push('--focus', opts.focus);
    const request = runVerbOp(['request', ...requestFlags], rt, sink);
    if (request.code !== 0) {
        return { code: request.code, payload: { ok: false, verdict: 'FAIL', request: request.payload, findings: [] } };
    }
    const record = obj(request.payload);
    const correlation: string[] = [];
    if (text(record.requestedAt) !== '') correlation.push('--since', text(record.requestedAt));
    if (text(record.head) !== '') correlation.push('--head', text(record.head));

    const collected = (): VerbResult => {
        const collect = runVerbOp(['collect', ...correlation, '--json', ...statusFlags], rt, sink);
        return {
            code: collect.code,
            payload: {
                ok: collect.code === 0,
                verdict: collect.code === 0 ? word(collect.payload) : 'FAIL',
                request: request.payload,
                findings: collect.code === 0 ? list(collect.payload?.findings) : [],
            },
        };
    };
    const pending = (code: number): VerbResult => {
        writeVerbStatus(rt, opts, 'PENDING');
        return { code, payload: { ok: true, verdict: 'PENDING', request: request.payload, findings: [] } };
    };

    if (record.alreadyReviewed === true) return collected();
    if (record.pending === true || (record.requested === true && opts.noWait === true)) return pending(0);

    const waitFlags = [...correlation, '--json', ...statusFlags];
    if (opts.timeout !== undefined) waitFlags.push('--timeout', opts.timeout);
    if (opts.interval !== undefined) waitFlags.push('--interval', opts.interval);
    const waited = runVerbOp(['wait', ...waitFlags], rt, sink);
    if (waited.code === 3) return pending(3); // pending, never failure
    if (waited.code !== 0) {
        return { code: waited.code, payload: { ok: false, verdict: 'FAIL', request: request.payload, findings: [] } };
    }
    return collected();
}

/** The human summary of a composed result; the ops' own text exists only in JSON-only runs. */
function renderPrVerb(verb: PrVerb, payload: Record<string, unknown>): string[] {
    if (verb === 'status') {
        const pr = payload.pr === null || payload.pr === undefined ? null : obj(payload.pr);
        const review = payload.review === null || payload.review === undefined ? null : obj(payload.review);
        const lines = [
            `Repository: ${text(payload.repo) || 'unknown'}`,
            `PR:         ${pr === null ? 'none' : `#${String(pr.number ?? '')} ${text(pr.url)}`}`,
            `Branch:     ${text(payload.branch)}`,
            `HEAD:       ${text(payload.head)}`,
            `Base:       ${text(payload.base)}`,
            `Local:      ${text(payload.local)}`,
            `CI:         ${text(payload.ci)}`,
            `Codex:      ${text(payload.codex)}`,
        ];
        if (review === null) return [...lines, 'Review:     no PR — nothing collected'];
        lines.push(`Review:     ${text(review.verdict) || 'unknown'}`);
        const findings = findingsArg(review.findings);
        if (findings.length > 0) lines.push('', renderFindings(findings));
        return lines;
    }
    if (verb === 'check') {
        const preflight = payload.preflight === null || payload.preflight === undefined ? null : obj(payload.preflight);
        const hygiene = payload.hygiene === null || payload.hygiene === undefined ? null : obj(payload.hygiene);
        const lines = [
            preflight === null
                ? 'Preflight:  skipped (--scan-only)'
                : preflight.ok === true
                  ? `Preflight:  ${text(preflight.nameWithOwner)} ${text(preflight.branch)} @ ${text(preflight.shortHead)}`
                  : `Preflight:  FAIL — ${text(preflight.error) || 'probe failed'}`,
        ];
        if (hygiene === null) return lines;
        lines.push(`Hygiene:    ${text(hygiene.verdict) || 'FAIL'}`);
        for (const blocker of list(hygiene.blockers)) lines.push(`  BLOCK ${String(blocker)}`);
        for (const warning of list(hygiene.warnings)) lines.push(`  WARN  ${String(warning)}`);
        return lines;
    }
    if (verb === 'open') {
        const push = obj(payload.push);
        const pr = payload.pr === null || payload.pr === undefined ? null : obj(payload.pr);
        return [
            `Push:       ${push.pushed === true ? 'PUSHED' : 'UP_TO_DATE'} ${text(push.head).slice(0, 7)}`,
            `PR:         ${pr === null ? 'none' : `#${String(pr.number ?? '')} ${text(pr.url)} (${text(payload.verdict)})`}`,
        ];
    }
    const request = obj(payload.request);
    const outcome =
        request.requested === true
            ? 'REQUESTED'
            : request.alreadyReviewed === true
              ? 'ALREADY_REVIEWED'
              : request.pending === true
                ? 'ALREADY_REQUESTED'
                : 'FAIL';
    const lines = [
        `Request:    ${outcome} PR #${String(request.pr ?? '?')} ${text(request.url)}`,
        `HEAD:       ${text(request.head).slice(0, 7)}`,
        `Review:     ${text(payload.verdict) || 'unknown'}`,
    ];
    const findings = findingsArg(payload.findings);
    if (findings.length > 0) lines.push('', renderFindings(findings));
    return lines;
}

/** The four composers, one entry per verb — a new verb must add its own sequencer. */
const PR_VERB_COMPOSERS: Readonly<
    Record<PrVerb, (rt: SpineRuntime, opts: PrVerbOptions, sink: PrReviewIo) => VerbResult>
> = { status: composeStatus, check: composeCheck, open: composeOpen, review: composeReview };

/**
 * Run one flat composer verb (task 1219). Every line goes to `sink`: the composed report
 * (human summary, or one JSON object with `--json`). Exit codes: 0 ok · 1 usage · 2 hard failure
 * (verdict FAIL) · 3 wait timeout (verdict PENDING — pending, never failure).
 */
export function runPrVerb(verb: PrVerb, opts: PrVerbOptions, sink: PrReviewIo, context: PrReviewContext = {}): number {
    const rt = createRuntime(context);
    const result = PR_VERB_COMPOSERS[verb](rt, opts, sink);
    if (opts.json === true) sink.out(JSON.stringify(result.payload));
    else for (const line of renderPrVerb(verb, result.payload)) sink.out(line);
    return result.code;
}
