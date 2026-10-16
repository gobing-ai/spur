/**
 * branch-topology renderers — pure projections of a collected {@link BranchTopology} (task 1218).
 *
 * No git here: a renderer must produce identical bytes for an identical model, so every git-derived
 * label (ids, tag names, hidden counts) already arrives through the model. The emitted mermaid block
 * uses only the operator-referenced syntax subset — `gitGraph`; `commit id:"…" tag:"…" type: …`;
 * `branch`; `checkout`; `merge`; the optional `%%{init: { 'theme': … } }%%` directive — because that
 * block is rendered by the Board's mermaid version and is checked by an allow-list (`R3`).
 */
import type { BranchCommit, BranchRow, BranchTopology } from './index';

/** Graph knobs. `hideContained` prunes the graph only: json/text/markdown rows stay the same model. */
export interface GraphOptions {
    /** `--max-commits`: commit nodes drawn per branch line. */
    maxCommits: number;
    /** `--hide-contained`: drop contained branches instead of drawing their join. */
    hideContained: boolean;
    /** `--theme`: mermaid theme name; omitted → no init directive. */
    theme?: string;
}

const INDENT = '    ';

/** Mermaid's implicit default branch; a differently named base needs an explicit `branch` statement. */
const MERMAID_DEFAULT_BRANCH = 'main';

const TABLE_HEADERS = ['branch', 'ahead', 'behind', 'contained', 'last commit', 'worktree', 'PR'] as const;

// ─── Markdown / text ────────────────────────────────────────────────────────

/** Default format: title, warnings, the summary table, and one condensed mermaid gitGraph. */
export function renderMarkdown(topology: BranchTopology, graph: GraphOptions): string {
    const lines = [
        `## Branch topology vs \`${markdownCell(topology.base)}\``,
        '',
        `Generated ${topology.generatedAt}.`,
    ];
    for (const warning of topology.warnings) lines.push('', `> warning: ${warning}`);
    lines.push('', ...markdownTable(topology.branches), ...omittedFooter(topology, '_', '_'));
    lines.push('', '```mermaid', renderGitGraph(topology, graph), '```');
    return `${lines.join('\n')}\n`;
}

/** `--format text`: the same rows as the aligned plain table, without mermaid. */
export function renderText(topology: BranchTopology): string {
    const rows = [TABLE_HEADERS.map((header) => header as string), ...topology.branches.map(rowCells)];
    const widths = TABLE_HEADERS.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
    const lines = [`base: ${topology.base}`, `generated: ${topology.generatedAt}`];
    for (const warning of topology.warnings) lines.push(`warning: ${warning}`);
    lines.push('', ...rows.map((row) => alignRow(row, widths)), ...omittedFooter(topology, '', ''));
    return `${lines.join('\n')}\n`;
}

function markdownTable(branches: BranchRow[]): string[] {
    const lines = [`| ${TABLE_HEADERS.join(' | ')} |`, `| ${TABLE_HEADERS.map(() => '---').join(' | ')} |`];
    for (const row of branches) {
        lines.push(`| ${rowCells(row).map(markdownCell).join(' | ')} |`);
    }
    return lines;
}

/** One row's cells in {@link TABLE_HEADERS} order — json rows carry the same eight fields plus detail. */
function rowCells(row: BranchRow): string[] {
    return [
        row.name,
        String(row.ahead),
        String(row.behind),
        row.contained ? 'yes' : 'no',
        row.lastCommitAt.slice(0, 10),
        row.worktree ?? '-',
        row.pr === null
            ? '-'
            : `#${row.pr.number} ${row.pr.state}${row.pr.reviewDecision === null ? '' : ` ${row.pr.reviewDecision}`}`,
    ];
}

/** Numbers right-aligned, text left-aligned; `|-` escapes are markdown-only, so text strips them. */
function alignRow(cells: string[], widths: number[]): string {
    return cells
        .map((cell, column) => {
            const width = widths[column] ?? cell.length;
            return column === 0 ? cell.padEnd(width) : cell.padStart(width);
        })
        .join('  ')
        .trimEnd();
}

function omittedFooter(topology: BranchTopology, open: string, close: string): string[] {
    if (topology.omitted === 0) return [];
    const noun = topology.omitted === 1 ? 'branch' : 'branches';
    return ['', `${open}Omitted: ${topology.omitted} ${noun} beyond --limit.${close}`];
}

/** Table cells must survive a pipe-split and inline-code parsing; refnames may carry either token. */
function markdownCell(value: string): string {
    return value.replaceAll('|', '\\|').replaceAll('`', "'");
}

// ─── Mermaid ────────────────────────────────────────────────────────────────

/**
 * One condensed gitGraph: the base line, then one branch statement per non-contained row with up to
 * `maxCommits` commit nodes, and a merge-back line per contained row. The base line is strictly
 * increasing in age — fork points older than the shown window first (deepest first), then the window
 * oldest to newest — because mermaid draws commits in statement order. Ids and labels are sanitized
 * and de-duplicated because a branch name may carry quotes, dots or slashes and node ids must stay
 * unique.
 *
 * Mermaid-side constraints the emitted text must satisfy (proved by the heavy parse proof): every
 * branch needs a commit of its own before it can merge back (a merge whose heads are equal is
 * rejected), a `tag:` value may appear only once in one diagram (a repeat renders duplicate labels),
 * a branch name may be created only once (so sanitized collisions get a suffix), and mermaid's
 * implicit `main` branch cannot be re-created — it is only ever checked out.
 *
 * Claim confidence (sp:source-driven-development): all four are HIGH — measured this session against
 * the pinned source, `mermaid@11.15.0` (`apps/web/package.json:28`), with the CLI-rendered fixture;
 * the anchor is the assertion that pins each one in `apps/web/tests/branch-topology-graph.heavy.test.ts`
 * (`REJECTED_SHAPES` for the four statements, the rendered-label count for the tag rule).
 */
export function renderGitGraph(topology: BranchTopology, graph: GraphOptions): string {
    const lines: string[] = [];
    if (graph.theme !== undefined && graph.theme.length > 0) {
        lines.push(`%%{init: { 'theme': '${sanitizeId(graph.theme)}' } }%%`);
    }
    lines.push('gitGraph');

    const baseId = sanitizeId(topology.base);
    const usedRefs = new Set<string>();
    const base = refToken(topology.base, usedRefs);
    const baseRow = baseRowOf(topology);
    if (baseId !== MERMAID_DEFAULT_BRANCH) lines.push(`${INDENT}branch ${base}`);

    const tagsBySha = collectTags(topology.branches);
    const emittedShas = new Set<string>();
    const usedIds = new Set<string>();
    const usedTags = new Set<string>();

    // The base line reads left to right in age, because mermaid places commit statements in
    // statement order: a fork point deeper than the window is emitted before it, deepest first, so no
    // base-line commit is ever drawn to the right of a newer one (a fork point inside the window is
    // one of its commits and is de-duplicated below).
    //
    // Claim confidence (sp:source-driven-development, all HIGH = measured this session):
    // - statement-order layout is `mermaid@11.15.0` behaviour, pinned at `apps/web/package.json:28`
    //   and asserted by `apps/web/tests/branch-topology-graph.heavy.test.ts:298` (x increasing in
    //   statement order, and a deep fork drawn left of every window commit).
    // - `behind` is the left count of `git rev-list --left-right --count <base>...<ref>`, which the
    //   installed `git rev-list` 2.55.0 documents as "commits from the left side are prefixed with <";
    //   the mapping is exercised by `packages/app/tests/services/branch-topology/index.test.ts:139`.
    const window = (baseRow?.commits ?? []).slice(0, Math.max(graph.maxCommits, 0));
    for (const { sha } of deepForkPoints(topology, baseRow, window.length, graph.hideContained)) {
        lines.push(
            `${INDENT}${commitStatement(
                { sha, subject: '', tags: tagsBySha.get(sha) ?? [] },
                usedIds,
                emittedShas,
                usedTags,
                undefined,
            )}`,
        );
    }
    for (const [index, commit] of window.slice().reverse().entries()) {
        const isTip = index === window.length - 1;
        lines.push(
            `${INDENT}${commitStatement(commit, usedIds, emittedShas, usedTags, isTip ? 'HIGHLIGHT' : commitType(commit))}`,
        );
    }

    for (const row of topology.branches) {
        if (row === baseRow) continue;
        if (row.contained && graph.hideContained) continue;

        lines.push(`${INDENT}checkout ${base}`);
        // No fork node here: every fork point is already on the base line above — hoisted when it is
        // older than the window, drawn by the window itself when it is inside it — so a branch never
        // introduces a base-line commit after the base tip.
        const branch = refToken(row.name, usedRefs);
        // mermaid creates `main` itself; re-creating it is an error, so a row named `main` (possible
        // when the base is `origin/main`) is drawn by checking that branch out instead.
        lines.push(branch === MERMAID_DEFAULT_BRANCH ? `${INDENT}checkout ${branch}` : `${INDENT}branch ${branch}`);

        if (row.contained) {
            // Joined back on purpose: a contained branch is integrated, not an open line. It still
            // needs the commit it is contained at, or mermaid refuses the merge (equal heads).
            lines.push(
                `${INDENT}${commitStatement(
                    { sha: row.tip, subject: '', tags: tagsBySha.get(row.tip) ?? [] },
                    usedIds,
                    emittedShas,
                    usedTags,
                    undefined,
                )}`,
            );
            lines.push(`${INDENT}checkout ${base}`);
            // No merge tag: the branch's tip node above already carries the joined commit's tag.
            lines.push(`${INDENT}merge ${branch}`);
            continue;
        }

        const shown = row.commits.slice(0, Math.max(Math.min(graph.maxCommits, row.ahead), 0)).reverse();
        const hidden = Math.max(row.ahead - shown.length, 0);
        if (hidden > 0) {
            // A literal summary label, not a git token: outside the sanitized ref/naming charset on purpose.
            lines.push(`${INDENT}commit id:"+${hidden} earlier"`);
        }
        for (const [index, commit] of shown.entries()) {
            const isTip = index === shown.length - 1;
            lines.push(
                `${INDENT}${commitStatement(commit, usedIds, emittedShas, usedTags, isTip ? 'HIGHLIGHT' : commitType(commit))}`,
            );
        }
    }

    return lines.join('\n');
}

/** `commit id:"…" [tag:"…"] [type: …]` — the frozen statement shape and field order. */
function commitStatement(
    commit: BranchCommit,
    usedIds: Set<string>,
    emittedShas: Set<string>,
    usedTags: Set<string>,
    type: 'HIGHLIGHT' | 'REVERSE' | undefined,
): string {
    const sha = short(commit.sha);
    const id = uniqueId(sanitizeId(sha), usedIds);
    emittedShas.add(sha);
    // One statement carries one tag; the first tag name in refname order keeps output deterministic.
    const tag = claimTag(commit.tags[0], usedTags);
    let line = `commit id:"${id}"`;
    if (tag !== undefined) line += ` tag:"${tag}"`;
    if (type !== undefined) line += ` type: ${type}`;
    return line;
}

/** Reserve a tag value for this diagram; the first statement to name it keeps it. */
function claimTag(name: string | undefined, usedTags: Set<string>): string | undefined {
    if (name === undefined) return undefined;
    const sanitized = sanitizeId(name);
    if (usedTags.has(sanitized)) return undefined;
    usedTags.add(sanitized);
    return sanitized;
}

/**
 * Fork points strictly older than the emitted base window, deepest (oldest) first. `behind` counts the
 * base's own commits after the fork point, so `behind >= windowLength` places the fork before every
 * commit the base line draws; rows sharing one fork point contribute it once. (Claim confidence and
 * anchors for both halves sit on the base-line call site in `renderGitGraph`.)
 */
function deepForkPoints(
    topology: BranchTopology,
    baseRow: BranchRow | null,
    windowLength: number,
    hideContained: boolean,
): Array<{ sha: string; behind: number }> {
    const behindBySha = new Map<string, number>();
    for (const row of topology.branches) {
        if (row === baseRow) continue;
        if (row.contained && hideContained) continue;
        if (row.forkPoint.length === 0 || row.forkPoint === row.tip) continue;
        if (row.behind < windowLength) continue;
        if (!behindBySha.has(row.forkPoint)) behindBySha.set(row.forkPoint, row.behind);
    }
    return [...behindBySha]
        .map(([sha, behind]) => ({ sha, behind }))
        .sort((a, b) => b.behind - a.behind || (a.sha < b.sha ? -1 : 1));
}

/** A tip is HIGHLIGHT by contract; anywhere else a revert subject is the one special type. */
function commitType(commit: BranchCommit): 'REVERSE' | undefined {
    return commit.subject.startsWith('Revert "') ? 'REVERSE' : undefined;
}

function collectTags(branches: BranchRow[]): Map<string, string[]> {
    const tags = new Map<string, string[]>();
    for (const row of branches) {
        for (const commit of row.commits) tags.set(commit.sha, commit.tags);
    }
    return tags;
}

/** The row that renders the base line: the exact ref name, else its short local twin. */
export function isBaseRow(base: string, row: BranchRow): boolean {
    if (row.name === base) return true;
    if (row.kind !== 'local') return false;
    return row.name === base.replace(/^[^/]+\//, '');
}

/** 7-character abbreviation shared with the row names and the graph ids. */
function short(sha: string): string {
    return sha.slice(0, 7);
}

/**
 * Mermaid's gitGraph lexer takes a bare REFERENCE token or a quoted string for a branch reference,
 * so a name that cannot start a token (`1.x`, a detached short sha) is quoted instead of renamed.
 * Sanitizing can map two refs onto one token (a real `fix/quote-name` beside `fix/quote"name`), and
 * mermaid refuses a second `branch` of the same name, so tokens are de-duplicated like ids.
 */
function refToken(value: string, usedRefs: Set<string>): string {
    const id = uniqueId(sanitizeRef(value), usedRefs);
    return /^[A-Za-z_]/.test(id) ? id : `"${id}"`;
}

/** Characters outside the ref-safe set become `-`, quotes included; ids cap at 40 characters. */
function sanitizeId(value: string): string {
    return sanitizeRef(value).slice(0, 40);
}

/** Ref labels keep their whole name — truncation is an id rule, and a cut branch name misreports it. */
function sanitizeRef(value: string): string {
    return value.replace(/[^A-Za-z0-9._/-]/g, '-');
}

/**
 * The row that draws the base line: an exact ref-name match first (a diverged local twin is a branch
 * of its own), else the local twin of a base that arrived as `origin/<branch>`.
 */
function baseRowOf(topology: BranchTopology): BranchRow | null {
    return (
        topology.branches.find((row) => row.name === topology.base) ??
        topology.branches.find((row) => isBaseRow(topology.base, row)) ??
        null
    );
}

/** Mermaid node ids must be unique when a fork point or a short sha repeats across rows. */
function uniqueId(id: string, usedIds: Set<string>): string {
    let candidate = id;
    let suffix = 2;
    while (usedIds.has(candidate)) {
        candidate = `${id}-${suffix}`;
        suffix += 1;
    }
    usedIds.add(candidate);
    return candidate;
}
