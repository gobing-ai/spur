/**
 * real-run-cost — per-workflow wall-clock and cost from REAL pipeline runs (task 0607 R5;
 * measurement-correctness repairs per task 0730 R2).
 *
 * Usage: bun scripts/spur-dev.ts real-run-cost [--workflow <name>]... [--by-state]
 *                    [--include-bookkeeping] [--since <YYYY-MM-DD>] [--json]
 *
 * 0938 additions: `--by-state` reports per-workflow/per-state rows (`action_runs.node`),
 * workflow rows gain agent.run median + nearest-rank wall p50/p90 + the 0937
 * `terminalReasonMix`, bookkeeping workflows are excluded unless `--include-bookkeeping`,
 * and `--since` filters on `runs.created_at` (integer epoch ms). `--json` emits the
 * byte-stable baseline payload (recursively key-sorted; rows ordered workflow→state; no
 * generation timestamp), so one DB snapshot reproduces the report exactly (0938 R4).
 *
 * Reads the main history plane (`.spur/spur.db`) and aggregates, per in-scope workflow
 * (every definition in `config/workflows/`):
 *   - wall-clock from the `runs` table (`completed_at - started_at`) over TERMINAL,
 *     NON-DRY runs only (0730 R2: dry-run probes and non-terminal rows with a stale
 *     `completed_at` are excluded and counted, never folded into real-work stats);
 *   - cost and tokens independently from `history_run_session` → `history_message`
 *     (exact mappings only), with row coverage reported so null-USD rows are visible
 *     instead of silently folding into the sum as zero (0730 R2);
 *   - active time bounded by `transition_runs` hops when a run has ≥ 2 recorded
 *     transitions (0730 R2: wall-clock includes paused/idle time; the transition bound
 *     is reported alongside, null when the hop evidence is absent).
 *
 * This is the repeatable answer to "what did a real pipeline run cost and how long did
 * it take" — larger and more representative than any fixture, and already paid for. It
 * reuses existing history surfaces (runs / history_run_session / history_message /
 * transition_runs); it is a repo-internal dev-script, NOT a new public `spur` noun/verb
 * (ADR-051; surface questions route to task 0608).
 *
 * The `--workflow` filter defaults to the full in-scope cohort (every definition in
 * `config/workflows/` — 9 after task 0866 retired `basic`, `docs-pipeline` and
 * `feature-dev`, task 0872 added `feature-verification`, and task 0946 retired the
 * `decision-routing-example` authoring sample), 0730 R1; `--json` emits a machine-readable object. `n/a`, never `0`, for
 * an unmeasured duration/cost (0284 invariant).
 */
import { Database } from 'bun:sqlite';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
// Deep relative import (0775, same as workflow-promotion.ts): the root node_modules has no
// @gobing-ai/app workspace link for scripts/commands, so the §1.1 alias cannot resolve here.
import {
    isBookkeepingWorkflow,
    isTerminalReason,
    type TerminalReason,
} from '../../packages/app/src/workflow/terminal-reason';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const DB_PATH = join(REPO_ROOT, '.spur/spur.db');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config/workflows');

/** Engine vocabulary: runs finalize as done/failed (lifecycle-adapter); cancelled is the
 * terminal catch-all state declared by the shipped pipelines. Anything else (running,
 * paused, pending) is non-terminal even when a stale `completed_at` is present. */
const TERMINAL_RUN_STATUSES = ['done', 'failed', 'cancelled'];

export interface WorkflowMetrics {
    workflow: string;
    /** All runs with both time bounds recorded (dry + non-dry, terminal + not). */
    runs: number;
    /** Terminal, non-dry runs — the real-work population behind every stat below. */
    terminalRuns: number;
    /** Dry-run probes excluded from real-work claims (counted, not silently dropped). */
    dryRuns: number;
    /** Non-terminal runs (running/paused/pending) with bounds — excluded, counted. */
    nonTerminalRuns: number;
    /** Wall-clock stats (ms) over terminal non-dry runs, or null when none. */
    wallClockMs: { mean: number; median: number; min: number; max: number } | null;
    /** Active-time stats (ms) bounded by first→last transition hop (≥ 2 hops); a LOWER
     * bound — transitions do not record pause intervals, so a mid-run pause inside the
     * first→last span is not separable. Null when the hop evidence is absent. */
    activeMs: { mean: number; median: number; min: number; max: number } | null;
    /** Terminal non-dry runs whose active time was derivable from transition hops. */
    activeRuns: number;
    /** Summed history-plane USD across exact-mapped terminal non-dry runs (null when no
     * run has a non-null USD value — unmeasured, never 0). */
    tokenCostUsd: number | null;
    /** Summed input+output tokens over the same fold, independent of USD (0730 R2: a
     * token row with null USD still measures tokens). */
    tokens: number | null;
    /** Exact-mapped terminal non-dry runs (cost-fold denominator). */
    mappedRuns: number;
    /** Total history_message rows joined through exact mappings (numerator basis). */
    historyRows: number;
    /** Of those rows, how many carried a non-null cost_usd. `historyRows - usdRows` rows
     * fold into the sum as zero — the unknown-as-zero exposure, reported not hidden. */
    usdRows: number;
    /** Nearest-rank p50 of per-run `agent.run` action counts over terminal non-dry runs
     * (zero-action runs count as 0; same measure as promotion's readAgentRunHistory).
     * Null when the workflow has no terminal non-dry run — never 0 for missing data. */
    agentRunCountMedian: number | null;
    /** Nearest-rank wall p50/p90 (ms) over the same samples as wallClockMs (deterministic,
     * no interpolation — 0938 R2). Null when there are no samples. */
    wallMsP50: number | null;
    wallMsP90: number | null;
    /** Closed-run counts keyed by the 0937 `TerminalReason` vocabulary plus `unclassified`
     * (null/legacy reason). Population: non-dry runs with bounds whose status is terminal
     * OR whose `terminal_reason` is set — so `interrupted` closes show up here (their only
     * reporting surface), not in the terminal-status stats above. */
    terminalReasonMix: Partial<Record<TerminalReason | 'unclassified', number>>;
}

interface WorkflowRunRow {
    workflow: string;
    runId: string;
    status: string;
    dryRun: boolean;
    startedAt: string;
    wallClockMs: number | null;
    tokenCostUsd: number | null;
    tokens: number | null;
    historyRows: number;
    usdRows: number;
    transitionHops: number;
    firstTransitionMs: number | null;
    lastTransitionMs: number | null;
    /** The 0937 closed terminal reason on the run row (null = legacy/pre-0937 or open run). */
    terminalReason: string | null;
    /** Recorded `agent.run` actions in the run (0 when none — same measure as promotion). */
    agentRunCount: number;
}

/** All runs of the named workflows that have both time bounds, with classification and
 * mapped-session folds (history plane, mirroring attributeActionCost). Dry-run and
 * non-terminal rows are returned too — exclusion decisions and their counts belong to
 * the aggregation, where they stay visible. One parameterized query per workflow: no
 * SQL string assembly, and per-workflow volume is tiny. `opts.sinceMs` (0938 R4) narrows
 * to runs created at/after the epoch-ms instant (`runs.created_at` is INTEGER — never a
 * string compare). */
export function readWorkflowRuns(
    dbPath: string,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): WorkflowRunRow[] {
    const db = new Database(dbPath, { readonly: true });
    try {
        // Per-run: a run with no exact run→session mapping yields NULL cost/tokens
        // (unmeasured, never 0); mapped sessions fold the typed columns. historyRows /
        // usdRows expose coverage so null-USD rows can't silently pass as measured.
        // json_extract on unparseable/empty metadata returns NULL → treated as NOT a
        // dry run (same conservative reading as workflow-service's trace labeling).
        const statement = db.query(
            `SELECT r.id AS runId,
                    r.status AS status,
                    json_extract(r.metadata_json, '$.dryRun') AS dryRunFlag,
                    r.started_at AS startedAt,
                    (unixepoch(r.completed_at) - unixepoch(r.started_at)) * 1000 AS wallClockMs,
                    (SELECT SUM(m.cost_usd)
                       FROM history_run_session s
                       JOIN history_message m ON m.source = s.source AND m.session_id = s.session_id
                      WHERE s.run_id = r.id AND s.session_id IS NOT NULL AND s.exactness = 'exact')
                        AS tokenCostUsd,
                    (SELECT SUM(m.input_tokens + m.output_tokens)
                       FROM history_run_session s
                       JOIN history_message m ON m.source = s.source AND m.session_id = s.session_id
                      WHERE s.run_id = r.id AND s.session_id IS NOT NULL AND s.exactness = 'exact')
                        AS tokens,
                    (SELECT COUNT(*)
                       FROM history_run_session s
                       JOIN history_message m ON m.source = s.source AND m.session_id = s.session_id
                      WHERE s.run_id = r.id AND s.session_id IS NOT NULL AND s.exactness = 'exact')
                        AS historyRows,
                    (SELECT COUNT(*)
                       FROM history_run_session s
                       JOIN history_message m ON m.source = s.source AND m.session_id = s.session_id
                      WHERE s.run_id = r.id AND s.session_id IS NOT NULL AND s.exactness = 'exact'
                        AND m.cost_usd IS NOT NULL)
                        AS usdRows,
                    (SELECT COUNT(*) FROM transition_runs t WHERE t.run_id = r.id) AS transitionHops,
                    (SELECT MIN(t.created_at) FROM transition_runs t WHERE t.run_id = r.id) AS firstTransitionMs,
                    (SELECT MAX(t.created_at) FROM transition_runs t WHERE t.run_id = r.id) AS lastTransitionMs,
                    r.terminal_reason AS terminalReason,
                    (SELECT COUNT(*) FROM action_runs a WHERE a.run_id = r.id AND a.kind = 'agent.run') AS agentRunCount
               FROM runs r
              WHERE r.workflow_name = ?
                AND r.started_at IS NOT NULL AND r.completed_at IS NOT NULL
                AND r.completed_at >= r.started_at${opts.sinceMs !== undefined ? ' AND r.created_at >= ?' : ''}`,
        );
        const rows: WorkflowRunRow[] = [];
        for (const workflow of workflows) {
            const found = statement.all(workflow, ...(opts.sinceMs !== undefined ? [opts.sinceMs] : [])) as Array<{
                runId: string;
                status: string;
                dryRunFlag: number | null;
                startedAt: string;
                wallClockMs: number;
                tokenCostUsd: number | null;
                tokens: number | null;
                historyRows: number;
                usdRows: number;
                transitionHops: number;
                firstTransitionMs: number | null;
                lastTransitionMs: number | null;
                terminalReason: string | null;
                agentRunCount: number;
            }>;
            for (const r of found) {
                rows.push({
                    workflow,
                    runId: r.runId,
                    status: r.status,
                    dryRun: r.dryRunFlag === 1,
                    startedAt: r.startedAt,
                    wallClockMs: r.wallClockMs,
                    tokenCostUsd: r.tokenCostUsd,
                    tokens: r.tokens,
                    historyRows: r.historyRows,
                    usdRows: r.usdRows,
                    transitionHops: r.transitionHops,
                    firstTransitionMs: r.firstTransitionMs,
                    lastTransitionMs: r.lastTransitionMs,
                    terminalReason: r.terminalReason,
                    agentRunCount: r.agentRunCount,
                });
            }
        }
        // SUM over an empty join is NULL: a run whose mapped sessions carry no cost/token
        // columns is UNMEASURED (null), never a free run (0) — the 0284 invariant.
        return rows.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
    } finally {
        db.close();
    }
}

function median(values: number[]): number {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const lower = sorted[mid - 1] ?? sorted[mid] ?? NaN;
    const upper = sorted[mid] ?? NaN;
    return sorted.length % 2 === 0 ? (lower + upper) / 2 : lower;
}

function stats(values: number[]) {
    return {
        mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
        median: Math.round(median(values)),
        min: Math.round(Math.min(...values)),
        max: Math.round(Math.max(...values)),
    };
}

/** Nearest-rank percentile (0938 Design): the `⌈p/100 × n⌉`-th smallest value — a sample
 * member, so it stays an integer and is deterministic with no interpolation. Null on an
 * empty sample (the 0284 invariant: n/a, never 0, for missing data). */
export function nearestRankPercentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(Math.max(Math.ceil((p / 100) * sorted.length), 1), sorted.length);
    return sorted[rank - 1];
}

/** Aggregate per-workflow wall/active/cost over terminal non-dry runs, with every
 * exclusion and coverage denominator reported (0730 R2/R4); plus the 0938 R2 additions
 * (agent.run median, nearest-rank wall p50/p90, terminalReasonMix). `opts.sinceMs`
 * narrows the run window (0938 R4). */
export function readWorkflowMetrics(
    dbPath: string,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): WorkflowMetrics[] {
    const runs = readWorkflowRuns(dbPath, workflows, opts);
    const byWorkflow = new Map<string, WorkflowRunRow[]>();
    for (const r of runs) {
        const list = byWorkflow.get(r.workflow) ?? [];
        list.push(r);
        byWorkflow.set(r.workflow, list);
    }
    return workflows.map((workflow) => {
        const list = byWorkflow.get(workflow) ?? [];
        const dryRuns = list.filter((r) => r.dryRun).length;
        const terminal = list.filter((r) => !r.dryRun && TERMINAL_RUN_STATUSES.includes(r.status));
        const nonTerminalRuns = list.length - dryRuns - terminal.length;
        // 0730 R2: no blanket long-run ceiling. The former 24h wall filter silently
        // dropped long-but-legitimate terminal runs while `runs` kept counting them
        // (denominator lie); abandoned-run protection now comes from the terminal-status
        // filter, and an outlier stays visible in `max` instead of vanishing.
        const walls = terminal.map((r) => r.wallClockMs).filter((w): w is number => w !== null);
        // Active-time bound: a run needs ≥ 2 transition hops for first→last to mean
        // anything; one hop bounds a single instant, not an interval.
        const actives = terminal
            .filter((r) => r.transitionHops >= 2 && r.firstTransitionMs !== null && r.lastTransitionMs !== null)
            .map((r) => (r.lastTransitionMs as number) - (r.firstTransitionMs as number));
        const mapped = terminal.filter((r) => r.historyRows > 0);
        const historyRows = mapped.reduce((a, r) => a + r.historyRows, 0);
        const usdRows = mapped.reduce((a, r) => a + r.usdRows, 0);
        // Cost and tokens fold independently (0730 R2): token rows with null USD keep
        // their token counts; USD null stays null (unmeasured ≠ free).
        const costRuns = mapped.filter((r) => r.tokenCostUsd !== null);
        const tokenRuns = mapped.filter((r) => r.tokens !== null);
        // 0938 R2: closed runs keyed by the 0937 reason. A closed run is terminal-status OR
        // carries a terminal_reason (interrupted closes surface only here); a null/unknown
        // reason lands in 'unclassified' — never guessed, per 0937 R6.
        const closed = list.filter(
            (r) => !r.dryRun && (TERMINAL_RUN_STATUSES.includes(r.status) || r.terminalReason !== null),
        );
        const terminalReasonMix: Partial<Record<TerminalReason | 'unclassified', number>> = {};
        for (const r of closed) {
            const key =
                r.terminalReason !== null && isTerminalReason(r.terminalReason) ? r.terminalReason : 'unclassified';
            terminalReasonMix[key] = (terminalReasonMix[key] ?? 0) + 1;
        }
        return {
            workflow,
            runs: list.length,
            terminalRuns: terminal.length,
            dryRuns,
            nonTerminalRuns,
            wallClockMs: walls.length === 0 ? null : stats(walls),
            activeMs: actives.length === 0 ? null : stats(actives),
            activeRuns: actives.length,
            tokenCostUsd: costRuns.length === 0 ? null : costRuns.reduce((a, r) => a + (r.tokenCostUsd ?? 0), 0),
            tokens: tokenRuns.length === 0 ? null : tokenRuns.reduce((a, r) => a + (r.tokens ?? 0), 0),
            mappedRuns: mapped.length,
            historyRows,
            usdRows,
            agentRunCountMedian: nearestRankPercentile(
                terminal.map((r) => r.agentRunCount),
                50,
            ),
            wallMsP50: nearestRankPercentile(walls, 50),
            wallMsP90: nearestRankPercentile(walls, 90),
            terminalReasonMix,
        };
    });
}

// ── Per-state metrics (0938 R1) ──────────────────────────────────────────────────────

/** Per-workflow, per-state row (`action_runs.node` carries the state id). `visits` and
 * `retries` come from `transition_runs.to_state` (the engine's state-visit record); a
 * retry is a state visited more than once within one run, counted as visits − 1 per run.
 * `agentRunCount` is the recorded `agent.run` actions in the state; wall p50/p90 are
 * nearest-rank over per-(run, state) summed action durations — null when no action
 * carried a duration (0284: n/a, never 0). */
export interface StateMetrics {
    workflow: string;
    state: string;
    visits: number;
    agentRunCount: number;
    wallMsP50: number | null;
    wallMsP90: number | null;
    retries: number;
}

/** Read per-state metrics over the terminal non-dry runs (same run population and
 * `opts.sinceMs` window as {@link readWorkflowMetrics}). Two parameterized read-only
 * queries per workflow — per-(run, state) action folds (finer than (workflow, state) so
 * the percentile samples survive) and per-(state, run) transition visit counts — folded
 * in TS. Rows are ordered by workflow then state (0938 R4). */
export function readStateMetrics(dbPath: string, workflows: string[], opts: { sinceMs?: number } = {}): StateMetrics[] {
    const db = new Database(dbPath, { readonly: true });
    try {
        const sinceClause = opts.sinceMs !== undefined ? ' AND r.created_at >= ?' : '';
        const sinceParams = opts.sinceMs !== undefined ? [opts.sinceMs] : [];
        const terminalNonDry = `r.status IN (${TERMINAL_RUN_STATUSES.map(() => '?').join(',')})
        AND json_extract(r.metadata_json, '$.dryRun') IS NOT 1
        AND r.started_at IS NOT NULL AND r.completed_at IS NOT NULL
        AND r.completed_at >= r.started_at`;
        // Per (run, state): summed action wall ms (null when no action carries a duration)
        // and agent.run count — the promotion measurement shape (refine correction 2).
        const actionStatement = db.query(
            `SELECT a.node AS state,
                    SUM(a.duration_ms) AS wallMs,
                    SUM(CASE WHEN a.kind = 'agent.run' THEN 1 ELSE 0 END) AS agentRunCount
               FROM action_runs a
               JOIN runs r ON r.id = a.run_id
              WHERE r.workflow_name = ?
                AND ${terminalNonDry}${sinceClause}
              GROUP BY a.run_id, a.node`,
        );
        // Per (state, run): state visits — retries = Σ max(0, visitsInRun − 1) (0938 R1).
        const transitionStatement = db.query(
            `SELECT t.to_state AS state, COUNT(*) AS visitsInRun
               FROM transition_runs t
               JOIN runs r ON r.id = t.run_id
              WHERE r.workflow_name = ?
                AND ${terminalNonDry}${sinceClause}
              GROUP BY t.to_state, t.run_id`,
        );
        const rows: StateMetrics[] = [];
        for (const workflow of workflows) {
            const params = [workflow, ...TERMINAL_RUN_STATUSES, ...sinceParams];
            const byState = new Map<
                string,
                { visits: number; retries: number; agentRunCount: number; wallSamples: number[] }
            >();
            const rowFor = (state: string) => {
                let row = byState.get(state);
                if (!row) {
                    row = { visits: 0, retries: 0, agentRunCount: 0, wallSamples: [] };
                    byState.set(state, row);
                }
                return row;
            };
            const actions = actionStatement.all(...params) as Array<{
                state: string;
                wallMs: number | null;
                agentRunCount: number | null;
            }>;
            for (const a of actions) {
                const row = rowFor(a.state);
                row.agentRunCount += a.agentRunCount ?? 0;
                if (a.wallMs !== null) row.wallSamples.push(a.wallMs);
            }
            const transitions = transitionStatement.all(...params) as Array<{
                state: string;
                visitsInRun: number;
            }>;
            for (const t of transitions) {
                const row = rowFor(t.state);
                row.visits += t.visitsInRun;
                row.retries += Math.max(0, t.visitsInRun - 1);
            }
            for (const [state, row] of byState) {
                rows.push({
                    workflow,
                    state,
                    visits: row.visits,
                    agentRunCount: row.agentRunCount,
                    wallMsP50: nearestRankPercentile(row.wallSamples, 50),
                    wallMsP90: nearestRankPercentile(row.wallSamples, 90),
                    retries: row.retries,
                });
            }
        }
        return rows.sort((a, b) =>
            a.workflow === b.workflow
                ? a.state < b.state
                    ? -1
                    : a.state > b.state
                      ? 1
                      : 0
                : a.workflow < b.workflow
                  ? -1
                  : 1,
        );
    } finally {
        db.close();
    }
}

// ── Deterministic serialization + cohort scoping (0938 R3/R4) ────────────────────

/** Recursively key-sorted compact JSON — the same DB snapshot serializes byte-identically
 * (0938 R4): sorted object keys at every depth, array order preserved (rows are already
 * ordered), and no wall-clock timestamp anywhere in the body. */
export function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
        );
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/** The report cohort (0938 R3): `--workflow` filters win when given, else the full
 * definitions cohort; bookkeeping workflows (0937 `BOOKKEEPING_WORKFLOWS`) drop out
 * unless `includeBookkeeping` is set. */
export async function scopedWorkflows(
    filters: string[],
    opts: { includeBookkeeping: boolean; workflowsDir?: string },
): Promise<string[]> {
    const cohort = filters.length > 0 ? filters : await inScopeWorkflows(opts.workflowsDir);
    return opts.includeBookkeeping ? cohort : cohort.filter((w) => !isBookkeepingWorkflow(w));
}

/** The baseline payload (0938 R4/R5): workflow rows plus (always) state rows, serialized
 * with the stable writer — byte-identical for one DB snapshot. The report file is this
 * string redirected to `docs/reports/2026-09-workflow-cost-baseline.json`. */
export function buildReportJson(dbPath: string, workflows: string[], opts: { sinceMs?: number } = {}): string {
    return stableJson({
        workflows: readWorkflowMetrics(dbPath, workflows, opts),
        states: readStateMetrics(dbPath, workflows, opts),
    });
}

/**
 * The in-scope cohort (0730 R1/R2: all repository workflows): the definitions in
 * `config/workflows/`. Sorted; duplicates collapse. (0775: the composition-baseline
 * union is gone with the snapshot.)
 */
export async function inScopeWorkflows(workflowsDir: string = WORKFLOWS_DIR): Promise<string[]> {
    const names = new Set<string>();
    try {
        for (const entry of await readdir(workflowsDir)) {
            const m = /^(.+)\.ya?ml$/.exec(entry);
            const name = m?.[1];
            if (name) names.add(name);
        }
    } catch {
        // no definitions dir — empty cohort
    }
    return [...names].sort();
}

/** CLI entry — `bun scripts/spur-dev.ts real-run-cost [--workflow <name>]... [--by-state]
 * [--include-bookkeeping] [--since <YYYY-MM-DD>] [--json]`. */
export async function realRunCost(argv: string[]): Promise<number> {
    const filters: string[] = [];
    let json = false;
    let byState = false;
    let includeBookkeeping = false;
    let sinceMs: number | undefined;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--workflow') {
            const value = argv[++i];
            if (value === undefined) throw new Error('real-run-cost: --workflow requires a value');
            filters.push(value);
        } else if (argv[i] === '--json') {
            json = true;
        } else if (argv[i] === '--by-state') {
            byState = true;
        } else if (argv[i] === '--include-bookkeeping') {
            includeBookkeeping = true;
        } else if (argv[i] === '--since') {
            const value = argv[++i];
            if (value === undefined) throw new Error('real-run-cost: --since requires a value');
            // Date-only YYYY-MM-DD parses as UTC midnight (deterministic); the window is
            // integer epoch ms on runs.created_at — never a string compare (0938 R4).
            sinceMs = Date.parse(value);
            if (!Number.isFinite(sinceMs))
                throw new Error(`real-run-cost: --since needs a date (YYYY-MM-DD), got ${value}`);
        } else {
            throw new Error(`real-run-cost: unknown argument ${argv[i]}`);
        }
    }
    const targets = await scopedWorkflows(filters, { includeBookkeeping });
    if (json) {
        console.log(buildReportJson(DB_PATH, targets, { sinceMs }));
        return 0;
    }
    const metrics = readWorkflowMetrics(DB_PATH, targets, { sinceMs });
    if (byState) {
        for (const s of readStateMetrics(DB_PATH, targets, { sinceMs })) {
            const wall =
                s.wallMsP50 === null || s.wallMsP90 === null ? 'n/a' : `p50=${s.wallMsP50}ms p90=${s.wallMsP90}ms`;
            console.log(
                `${s.workflow}/${s.state}: visits=${s.visits} agent.run=${s.agentRunCount} wall=${wall} retries=${s.retries}`,
            );
        }
        return 0;
    }
    for (const m of metrics) {
        const excluded =
            m.dryRuns > 0 || m.nonTerminalRuns > 0
                ? ` [excluded ${m.dryRuns} dry, ${m.nonTerminalRuns} non-terminal]`
                : '';
        const wall = m.wallClockMs
            ? `n=${m.terminalRuns} mean=${Math.round(m.wallClockMs.mean / 1000)}s median=${Math.round(m.wallClockMs.median / 1000)}s ` +
              `min=${Math.round(m.wallClockMs.min / 1000)}s max=${Math.round(m.wallClockMs.max / 1000)}s`
            : 'n/a (no terminal non-dry run with bounds)';
        const cost =
            m.tokenCostUsd !== null
                ? `$${m.tokenCostUsd.toFixed(4)} (${m.tokens !== null ? m.tokens : 'n/a'} tokens, ` +
                  `${m.usdRows}/${m.historyRows} rows with USD)`
                : 'n/a';
        console.log(`${m.workflow}: wall=${wall} cost=${cost}${excluded}`);
    }
    return 0;
}

if (import.meta.main) {
    process.exit(await realRunCost(process.argv.slice(2)));
}
