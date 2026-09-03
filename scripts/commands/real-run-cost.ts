/**
 * real-run-cost — per-workflow wall-clock and cost from REAL pipeline runs (task 0607 R5;
 * measurement-correctness repairs per task 0730 R2).
 *
 * Usage: bun scripts/spur-dev.ts real-run-cost [--workflow <name>]... [--json]
 *
 * Reads the main history plane (`.spur/spur.db`) and aggregates, per in-scope workflow
 * (every definition in `config/workflows/` plus the composition-baseline keys):
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
 * The `--workflow` filter defaults to the full in-scope cohort (all 11 repository
 * workflows, 0730 R1); `--json` emits a machine-readable object. `n/a`, never `0`, for
 * an unmeasured duration/cost (0284 invariant).
 */
import { Database } from 'bun:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const DB_PATH = join(REPO_ROOT, '.spur/spur.db');
const BASELINE_PATH = join(REPO_ROOT, 'config/workflow-composition-baseline.json');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config/workflows');

/** Engine vocabulary: runs finalize as done/failed (lifecycle-adapter); cancelled is the
 * terminal catch-all state declared by the shipped pipelines. Anything else (running,
 * paused, pending) is non-terminal even when a stale `completed_at` is present. */
const TERMINAL_RUN_STATUSES = new Set(['done', 'failed', 'cancelled']);

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
}

/** All runs of the named workflows that have both time bounds, with classification and
 * mapped-session folds (history plane, mirroring attributeActionCost). Dry-run and
 * non-terminal rows are returned too — exclusion decisions and their counts belong to
 * the aggregation, where they stay visible. One parameterized query per workflow: no
 * SQL string assembly, and per-workflow volume is tiny. */
export function readWorkflowRuns(dbPath: string, workflows: string[]): WorkflowRunRow[] {
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
                    (SELECT MAX(t.created_at) FROM transition_runs t WHERE t.run_id = r.id) AS lastTransitionMs
               FROM runs r
              WHERE r.workflow_name = ?
                AND r.started_at IS NOT NULL AND r.completed_at IS NOT NULL
                AND r.completed_at >= r.started_at`,
        );
        const rows: WorkflowRunRow[] = [];
        for (const workflow of workflows) {
            const found = statement.all(workflow) as Array<{
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

/** Aggregate per-workflow wall/active/cost over terminal non-dry runs, with every
 * exclusion and coverage denominator reported (0730 R2/R4). */
export function readWorkflowMetrics(dbPath: string, workflows: string[]): WorkflowMetrics[] {
    const runs = readWorkflowRuns(dbPath, workflows);
    const byWorkflow = new Map<string, WorkflowRunRow[]>();
    for (const r of runs) {
        const list = byWorkflow.get(r.workflow) ?? [];
        list.push(r);
        byWorkflow.set(r.workflow, list);
    }
    return workflows.map((workflow) => {
        const list = byWorkflow.get(workflow) ?? [];
        const dryRuns = list.filter((r) => r.dryRun).length;
        const terminal = list.filter((r) => !r.dryRun && TERMINAL_RUN_STATUSES.has(r.status));
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
        };
    });
}

/**
 * The in-scope cohort (0730 R1/R2: all repository workflows, not the baseline subset):
 * the union of the composition-baseline keys and the definitions in
 * `config/workflows/`. Sorted; duplicates collapse.
 */
export async function inScopeWorkflows(
    baselinePath: string = BASELINE_PATH,
    workflowsDir: string = WORKFLOWS_DIR,
): Promise<string[]> {
    const names = new Set<string>();
    try {
        const parsed = JSON.parse(await readFile(baselinePath, 'utf-8')) as {
            workflows?: Record<string, unknown>;
        };
        for (const key of Object.keys(parsed.workflows ?? {})) names.add(key);
    } catch {
        // baseline unreadable — the definitions directory still scopes the cohort
    }
    try {
        for (const entry of await readdir(workflowsDir)) {
            const m = /^(.+)\.ya?ml$/.exec(entry);
            const name = m?.[1];
            if (name) names.add(name);
        }
    } catch {
        // no project-local definitions dir — baseline keys only
    }
    return [...names].sort();
}

/** CLI entry — `bun scripts/spur-dev.ts real-run-cost [--workflow <name>]... [--json]`. */
export async function realRunCost(argv: string[]): Promise<number> {
    const filters: string[] = [];
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--workflow') {
            const value = argv[++i];
            if (value === undefined) throw new Error('real-run-cost: --workflow requires a value');
            filters.push(value);
        } else if (argv[i] === '--json') {
            json = true;
        } else {
            throw new Error(`real-run-cost: unknown argument ${argv[i]}`);
        }
    }
    const targets = filters.length > 0 ? filters : await inScopeWorkflows();
    const metrics = readWorkflowMetrics(DB_PATH, targets);
    if (json) {
        console.log(JSON.stringify(metrics, null, 2));
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
