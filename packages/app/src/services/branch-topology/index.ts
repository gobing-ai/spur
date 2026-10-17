/**
 * branch-topology — read-only branch-report spine behind `spur builder show-branches` (task 1218).
 *
 * Every git/gh call routes through the pr-review `CommandRunner` seam and nothing here writes a
 * ref, a config entry, the index or a worktree: the verb only reports. The collector owns what the
 * pure renderers in `./render` cannot fetch for themselves — the row set, the tag names carried by
 * the commits a graph may show, and the degradation warnings.
 *
 * Exit-code split for the CLI transport: `BranchTopologyUsageError` (bad ref) → 1, everything git
 * itself failed to answer → `BranchTopologyGitError` → 2.
 *
 * External contracts this module reads (sp:source-driven-development claim confidence; each is HIGH,
 * measured this session against the pinned source, and the anchor is named on the line):
 * - `git 2.55.0` porcelain: `for-each-ref`/`log` NUL fields, `rev-list --left-right --count`
 *   `<behind>	<ahead>` order, `%cI`, `merge-base`, `worktree list --porcelain` — re-measured end to
 *   end against real repositories by apps/cli/tests/commands/builder/show-branches.test.ts.
 * - `gh 2.102.0`: `pr list --json number,headRefName,state,reviewDecision --limit` accepts exactly
 *   these fields (its own "Available fields" list), `headRefName` is the local branch name with no
 *   remote prefix, and `state` is upper-case (`OPEN`, `MERGED`). An undecided pull request reports
 *   `reviewDecision: ""`, not null — measured against this repo's PRs, which is why
 *   {@link BranchPr.reviewDecision} normalizes the empty string.
 */
import type { CmdResult, CommandRunner } from '../pr-review';
import { isBaseRow } from './render';

/** Commits fetched per ref for the graph; `--max-commits` renders a prefix of this window. */
export const GRAPH_COMMIT_WINDOW = 10;

/**
 * The NUL separator the `log` formats expand to (`%x00`) and the `for-each-ref` format emits (`%00`);
 * a NUL cannot appear in a subject, a refname or argv, so the fields always split unambiguously.
 */
const FIELD_SEP = '\u0000';

/** Inputs of one collection pass; mirrors the `spur builder show-branches` flags. */
export interface BranchTopologyOptions {
    /** `--base <ref>`; omitted → origin/HEAD target, then `main`. */
    base?: string;
    scope: 'all' | 'local' | 'remote';
    /** `--pr`: enrich rows from one `gh pr list` call. The only network path. */
    pr: boolean;
    /** `--limit <n>`: maximum rows kept, most recent last-commit first. */
    limit: number;
}

/** One commit a graph may draw for a ref: newest first in {@link BranchRow.commits}. */
export interface BranchCommit {
    sha: string;
    subject: string;
    tags: string[];
}

/** Open pull-request state attached to a branch (`gh pr list`, task 1218 R5). */
export interface BranchPr {
    number: number;
    state: string;
    reviewDecision: string | null;
}

/** One reported branch: local, remote-only, or the detached HEAD. */
export interface BranchRow {
    name: string;
    kind: 'local' | 'remote' | 'detached';
    tip: string;
    /** Merge base with the resolved base ref; empty when the histories are unrelated. */
    forkPoint: string;
    ahead: number;
    behind: number;
    /** `ahead === 0`: nothing in the base is missing from this branch. */
    contained: boolean;
    lastCommitAt: string;
    subject: string;
    worktree: string | null;
    pr: BranchPr | null;
    /**
     * Newest {@link GRAPH_COMMIT_WINDOW} commits, newest first, tags resolved by the collector. A ref
     * with fewer own commits also carries the base commits it sits on, so a renderer must cap by
     * `ahead` before drawing. Populated for the branches a graph draws (non-contained rows that
     * survive `--limit`, plus the base row itself); contained branches render as a join back into the
     * base, so they stay empty.
     */
    commits: BranchCommit[];
}

/** The whole report; the `--format json` payload verbatim. */
export interface BranchTopology {
    base: string;
    generatedAt: string;
    branches: BranchRow[];
    /** Rows dropped by `--limit`. */
    omitted: number;
    warnings: string[];
}

/** Caller misuse that names a ref or flag problem; the CLI maps it to exit 1. */
export class BranchTopologyUsageError extends Error {}

/** git could not run or could not answer (missing binary, no repository); the CLI maps it to exit 2. */
export class BranchTopologyGitError extends Error {}

interface RefRecord {
    name: string;
    kind: BranchRow['kind'];
    sha: string;
}

interface ResolvedBase {
    name: string;
    sha: string;
}

interface WorktreeIndex {
    byBranch: Map<string, string>;
    bySha: Map<string, string>;
}

// ─── Collection ─────────────────────────────────────────────────────────────

/** Collect the read-only branch report for one resolved base. */
export function collectBranchTopology(runner: CommandRunner, opts: BranchTopologyOptions): BranchTopology {
    const warnings: string[] = [];
    const base = resolveBase(runner, opts.base);
    const refs = listRefs(runner, opts.scope);
    const worktrees = readWorktrees(runner, warnings);
    const tagIndex = readTagIndex(runner, warnings);

    const rows: BranchRow[] = refs.map((ref) => buildRow(runner, base.sha, ref));
    const detached = detachedHead(runner, base.sha);
    if (detached !== null && opts.scope !== 'remote') rows.push(detached);
    for (const row of rows) {
        row.worktree =
            row.kind === 'detached'
                ? (worktrees.bySha.get(row.tip) ?? null)
                : (worktrees.byBranch.get(row.name) ?? null);
    }

    if (opts.pr) attachPullRequests(rows, readOpenPullRequests(runner, warnings));

    const sorted = sortRows(rows);
    const branches = sorted.slice(0, Math.max(opts.limit, 0));
    const omitted = sorted.length - branches.length;
    for (const row of branches) {
        // The base is contained by definition, yet it is the line the graph draws and the carrier of
        // the base-side commit tags, so it keeps its window. Contained *branches* render as a join.
        if (row.contained && !isBaseRow(base.name, row)) continue;
        row.commits = readCommits(runner, row.tip, tagIndex, warnings);
    }

    return { base: base.name, generatedAt: new Date().toISOString(), branches, omitted, warnings };
}

// ─── Base resolution ────────────────────────────────────────────────────────

/** `--base` → `origin/HEAD` symbolic target → `main`, resolved to a commit both can be measured against. */
function resolveBase(runner: CommandRunner, explicit: string | undefined): ResolvedBase {
    const trimmed = explicit?.trim();
    // An empty `--base ''` is the same usage as no flag at all, so it gets the fallback + its hint.
    const requested = trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
    let candidate = requested ?? '';
    if (candidate.length === 0) {
        const originHead = runner(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
        const target = originHead.code === 0 ? originHead.stdout.trim() : '';
        candidate = target.length > 0 ? target : 'main';
    }
    const resolved = runner(['git', 'rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (resolved.code !== 0) {
        if ((resolved.error ?? '').length > 0) {
            throw new BranchTopologyGitError(`git is not available: ${resolved.error}`);
        }
        if (/not a git repository/i.test(resolved.stderr)) {
            throw new BranchTopologyGitError(`not a git repository: ${failureDetail(resolved)}`);
        }
        throw new BranchTopologyUsageError(
            requested === undefined
                ? `unknown base ref '${candidate}' (no --base given; tried origin/HEAD, then main)`
                : `unknown base ref '${candidate}'`,
        );
    }
    return { name: candidate, sha: resolved.stdout.trim() };
}

// ─── Refs ───────────────────────────────────────────────────────────────────

function listRefs(runner: CommandRunner, scope: BranchTopologyOptions['scope']): RefRecord[] {
    const namespaces =
        scope === 'local' ? ['refs/heads'] : scope === 'remote' ? ['refs/remotes'] : ['refs/heads', 'refs/remotes'];
    const res = runner(['git', 'for-each-ref', '--format=%(refname)%00%(objectname)', ...namespaces]);
    if (res.code !== 0) throw gitFailure(res, 'git for-each-ref');

    const refs: RefRecord[] = [];
    for (const line of res.stdout.split('\n')) {
        if (line.length === 0) continue;
        const [refname, sha] = line.split(FIELD_SEP);
        if (refname === undefined || sha === undefined || sha.length === 0) continue;
        // `origin/HEAD` is a symbolic ref to another branch, not a branch of its own.
        if (refname.endsWith('/HEAD')) continue;
        if (refname.startsWith('refs/heads/')) {
            refs.push({ name: refname.slice('refs/heads/'.length), kind: 'local', sha });
        } else if (refname.startsWith('refs/remotes/')) {
            refs.push({ name: refname.slice('refs/remotes/'.length), kind: 'remote', sha });
        }
    }

    if (scope !== 'all') return refs;
    const localTips = new Map(refs.filter((ref) => ref.kind === 'local').map((ref) => [ref.name, ref.sha]));
    // A remote ref whose local twin sits on the same commit is the same branch twice; fold it.
    return refs.filter((ref) => {
        if (ref.kind !== 'remote') return true;
        const twin = ref.name.slice(ref.name.indexOf('/') + 1);
        return localTips.get(twin) !== ref.sha;
    });
}

// ─── Rows ───────────────────────────────────────────────────────────────────

function buildRow(runner: CommandRunner, baseSha: string, ref: RefRecord): BranchRow {
    const mergeBase = runner(['git', 'merge-base', baseSha, ref.sha]);
    // Unrelated histories have no fork point (`merge-base` exits 1); the counts below still answer.
    const forkPoint = mergeBase.code === 0 ? mergeBase.stdout.trim() : '';

    const counts = runner(['git', 'rev-list', '--left-right', '--count', `${baseSha}...${ref.sha}`]);
    if (counts.code !== 0) throw gitFailure(counts, `git rev-list for ${ref.name}`);
    const [behindRaw, aheadRaw] = counts.stdout.trim().split(/\s+/);
    const behind = parseCount(behindRaw, ref.name);
    const ahead = parseCount(aheadRaw, ref.name);

    const log = runner(['git', 'log', '-1', '--format=%H%x00%cI%x00%s', ref.sha]);
    if (log.code !== 0) throw gitFailure(log, `git log for ${ref.name}`);
    const [tip, lastCommitAt, ...subjectParts] = log.stdout.replace(/\n$/, '').split(FIELD_SEP);

    return {
        name: ref.name,
        kind: ref.kind,
        tip: tip ?? ref.sha,
        forkPoint,
        ahead,
        behind,
        contained: ahead === 0,
        lastCommitAt: lastCommitAt ?? '',
        subject: subjectParts.join(FIELD_SEP),
        worktree: null,
        pr: null,
        commits: [],
    };
}

/** `rev-list --left-right --count` prints `<behind>\t<ahead>`; anything else is a git-side surprise. */
function parseCount(raw: string | undefined, ref: string): number {
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isInteger(parsed)) {
        throw new BranchTopologyGitError(`git rev-list for ${ref} returned '${raw ?? ''}'`);
    }
    return parsed;
}

/** A detached HEAD is reported as a row named by its short sha; an unborn HEAD has nothing to report. */
function detachedHead(runner: CommandRunner, baseSha: string): BranchRow | null {
    const symbolic = runner(['git', 'symbolic-ref', '--short', '-q', 'HEAD']);
    if (symbolic.code === 0) return null;
    const head = runner(['git', 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    if (head.code !== 0) return null;
    const tip = head.stdout.trim();
    return buildRow(runner, baseSha, { name: shortSha(tip), kind: 'detached', sha: tip });
}

/** Most recent last-commit first, then name; parses the ISO offsets, which string order gets wrong. */
function sortRows(rows: BranchRow[]): BranchRow[] {
    const time = (row: BranchRow): number => {
        const parsed = Date.parse(row.lastCommitAt);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return [...rows].sort((a, b) => {
        const byTime = time(b) - time(a);
        if (byTime !== 0) return byTime;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
}

// ─── Git side data ──────────────────────────────────────────────────────────

/** `git worktree list --porcelain` → branch→path (and detached-HEAD sha→path) bindings. */
function readWorktrees(runner: CommandRunner, warnings: string[]): WorktreeIndex {
    const index: WorktreeIndex = { byBranch: new Map(), bySha: new Map() };
    const res = runner(['git', 'worktree', 'list', '--porcelain']);
    if (res.code !== 0) {
        warnings.push(`git worktree list failed: ${failureDetail(res)}`);
        return index;
    }

    let path = '';
    let head = '';
    let detached = false;
    const flush = (): void => {
        if (detached && head.length > 0 && path.length > 0) index.bySha.set(head, path);
        path = '';
        head = '';
        detached = false;
    };
    for (const line of res.stdout.split('\n')) {
        if (line.length === 0) {
            flush();
        } else if (line.startsWith('worktree ')) {
            flush();
            path = line.slice('worktree '.length).trim();
        } else if (line.startsWith('HEAD ')) {
            head = line.slice('HEAD '.length).trim();
        } else if (line === 'detached') {
            detached = true;
        } else if (line.startsWith('branch refs/heads/')) {
            index.byBranch.set(line.slice('branch refs/heads/'.length).trim(), path);
        }
    }
    flush();
    return index;
}

/**
 * Tag name index keyed by the commit a tag points at (annotated tags peel through `%(*objectname)`).
 * A tag name is empty of spaces by git's refname rules, so the third field can be re-joined verbatim.
 */
function readTagIndex(runner: CommandRunner, warnings: string[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    const res = runner(['git', 'for-each-ref', '--format=%(objectname) %(*objectname) %(refname:short)', 'refs/tags']);
    if (res.code !== 0) {
        warnings.push(`git for-each-ref refs/tags failed: ${failureDetail(res)}`);
        return index;
    }
    for (const line of res.stdout.split('\n')) {
        if (line.length === 0) continue;
        const [object, peeled, ...nameParts] = line.split(' ');
        const name = nameParts.join(' ');
        if (object === undefined || name.length === 0) continue;
        const target = (peeled ?? '').length > 0 ? (peeled as string) : object;
        index.set(target, [...(index.get(target) ?? []), name]);
    }
    return index;
}

/** Newest `GRAPH_COMMIT_WINDOW` commits of one ref, newest first, with their tag names. */
function readCommits(
    runner: CommandRunner,
    sha: string,
    tagIndex: Map<string, string[]>,
    warnings: string[],
): BranchCommit[] {
    const res = runner(['git', 'log', '-n', String(GRAPH_COMMIT_WINDOW), '--format=%H%x00%s', sha]);
    if (res.code !== 0) {
        warnings.push(`git log for ${shortSha(sha)} failed: ${failureDetail(res)}`);
        return [];
    }
    const commits: BranchCommit[] = [];
    for (const line of res.stdout.split('\n')) {
        if (line.length === 0) continue;
        const [commitSha, ...subjectParts] = line.split(FIELD_SEP);
        if (commitSha === undefined || commitSha.length === 0) continue;
        commits.push({
            sha: commitSha,
            subject: subjectParts.join(FIELD_SEP),
            tags: tagIndex.get(commitSha) ?? [],
        });
    }
    return commits;
}

// ─── Pull-request enrichment ────────────────────────────────────────────────

/** One `gh pr list` call; any failure degrades to no state plus one warning naming the reason. */
function readOpenPullRequests(runner: CommandRunner, warnings: string[]): Map<string, BranchPr> {
    const index = new Map<string, BranchPr>();
    const res = runner([
        'gh',
        'pr',
        'list',
        '--state',
        'open',
        '--json',
        'number,headRefName,state,reviewDecision',
        '--limit',
        '200',
    ]);
    if (res.code !== 0 || res.stdout.trim().length === 0) {
        warnings.push(`--pr: gh pr list failed: ${failureDetail(res)}`);
        return index;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(res.stdout);
    } catch {
        warnings.push('--pr: gh pr list returned unparseable JSON');
        return index;
    }
    if (!Array.isArray(parsed)) {
        warnings.push('--pr: gh pr list returned unparseable JSON');
        return index;
    }
    for (const entry of parsed as Array<Record<string, unknown>>) {
        const { number, headRefName, state, reviewDecision } = entry;
        if (typeof number !== 'number' || typeof headRefName !== 'string') continue;
        const pr: BranchPr = {
            number,
            state: typeof state === 'string' ? state : '',
            // gh reports an undecided pull request as `""`; the report's contract is string | null,
            // and an empty cell must read as "no decision" in every format.
            reviewDecision: typeof reviewDecision === 'string' && reviewDecision.length > 0 ? reviewDecision : null,
        };
        const existing = index.get(headRefName);
        // Lowest PR number wins so the report does not depend on `gh`'s ordering.
        if (existing === undefined || pr.number < existing.number) index.set(headRefName, pr);
    }
    return index;
}

function attachPullRequests(rows: BranchRow[], index: Map<string, BranchPr>): void {
    for (const row of rows) {
        if (row.kind === 'detached') continue;
        // `gh` reports a branch by its local name, so a remote-only row also tries its twin.
        const keys = row.kind === 'remote' ? [row.name, row.name.replace(/^[^/]+\//, '')] : [row.name];
        row.pr = keys.map((key) => index.get(key)).find((pr) => pr !== undefined) ?? null;
    }
}

// ─── Small helpers ──────────────────────────────────────────────────────────

/** The first 7 characters of a sha — the abbreviation the report and the graph both print. */
export function shortSha(sha: string): string {
    return sha.slice(0, 7);
}

function gitFailure(res: CmdResult, what: string): BranchTopologyGitError {
    return new BranchTopologyGitError(`${what} failed: ${failureDetail(res)}`);
}

/** Why a command failed: first stderr line, else first stdout line, else the spawn error, else the code. */
function failureDetail(res: CmdResult): string {
    const first = (res.stderr.trim() || res.stdout.trim()).split('\n')[0] ?? '';
    if (first.length > 0) return first;
    return (res.error ?? '').length > 0 ? (res.error as string) : `exit ${res.code}`;
}

export { type GraphOptions, isBaseRow, renderGitGraph, renderMarkdown, renderText } from './render';
