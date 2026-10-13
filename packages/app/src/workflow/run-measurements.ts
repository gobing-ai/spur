import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    readWorkflowRuns,
    readWorkflowStateActionRows,
    readWorkflowStateVisitRows,
    TERMINAL_RUN_STATUSES,
    type WorkflowRunRow,
} from '@gobing-ai/spur-domain';
import { isTerminalReason, type TerminalReason } from './terminal-reason';

/**
 * Workflow run/state measurement (task 1178 R1) — the reusable aggregation over the
 * domain run/state queries, previously inlined in `scripts/commands/real-run-cost.ts`.
 *
 * The database input is explicit (a {@link DbAdapter}) so callers pick the project
 * history plane or an in-memory fixture; there is no pinned repository path here. The
 * repository keeps cohort selection, budget thresholds and promotion policy and consumes
 * these measurements.
 */

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
    return sorted[rank - 1] ?? null;
}

function foldWorkflow(workflow: string, list: WorkflowRunRow[]): WorkflowMetrics {
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
        const key = r.terminalReason !== null && isTerminalReason(r.terminalReason) ? r.terminalReason : 'unclassified';
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
}

/** Aggregate per-workflow wall/active/cost over terminal non-dry runs, with every
 * exclusion and coverage denominator reported (0730 R2/R4); plus the 0938 R2 additions
 * (agent.run median, nearest-rank wall p50/p90, terminalReasonMix). `opts.sinceMs`
 * narrows the run window (0938 R4). */
export async function readWorkflowMetrics(
    db: DbAdapter,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<WorkflowMetrics[]> {
    const runs = await readWorkflowRuns(db, workflows, opts);
    const byWorkflow = new Map<string, WorkflowRunRow[]>();
    for (const r of runs) {
        const list = byWorkflow.get(r.workflow) ?? [];
        list.push(r);
        byWorkflow.set(r.workflow, list);
    }
    return workflows.map((workflow) => foldWorkflow(workflow, byWorkflow.get(workflow) ?? []));
}

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

interface StateFold {
    visits: number;
    retries: number;
    agentRunCount: number;
    wallSamples: number[];
}

/** Read per-state metrics over the terminal non-dry runs (same run population and
 * `opts.sinceMs` window as {@link readWorkflowMetrics}). Two read-only queries per
 * workflow — per-(run, state) action folds (finer than (workflow, state) so the
 * percentile samples survive) and per-(state, run) transition visit counts — folded
 * here. Rows are ordered by workflow then state (0938 R4). */
export async function readStateMetrics(
    db: DbAdapter,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<StateMetrics[]> {
    const actions = await readWorkflowStateActionRows(db, workflows, opts);
    const transitions = await readWorkflowStateVisitRows(db, workflows, opts);
    const byWorkflow = new Map<string, Map<string, StateFold>>();
    const rowFor = (workflow: string, state: string): StateFold => {
        let states = byWorkflow.get(workflow);
        if (!states) {
            states = new Map();
            byWorkflow.set(workflow, states);
        }
        let row = states.get(state);
        if (!row) {
            row = { visits: 0, retries: 0, agentRunCount: 0, wallSamples: [] };
            states.set(state, row);
        }
        return row;
    };
    for (const a of actions) {
        const row = rowFor(a.workflow, a.state);
        row.agentRunCount += a.agentRunCount;
        if (a.wallMs !== null) row.wallSamples.push(a.wallMs);
    }
    for (const t of transitions) {
        const row = rowFor(t.workflow, t.state);
        row.visits += t.visitsInRun;
        row.retries += Math.max(0, t.visitsInRun - 1);
    }
    const rows: StateMetrics[] = [];
    for (const [workflow, states] of byWorkflow) {
        for (const [state, row] of states) {
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
}
