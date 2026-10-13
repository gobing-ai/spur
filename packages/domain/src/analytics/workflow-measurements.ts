import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Workflow run/state measurement SQL (task 1178 R1). Sole owner of the queries the
 * `real-run-cost` and `workflow-promotion` repository commands used to read directly:
 * reusable run/action/history folds over the main history plane.
 *
 * The measurement/aggregation sits one layer up in
 * `packages/app/src/workflow/run-measurements.ts`; the repository keeps cohort
 * selection, budget thresholds and promotion policy, and calls these read-only
 * queries. Every function takes an explicit {@link DbAdapter} so callers choose the
 * database (project history plane or an in-memory fixture) — no pinned path here.
 */

/**
 * Engine vocabulary: runs finalize as done/failed (lifecycle-adapter); cancelled is the
 * terminal catch-all state declared by the shipped pipelines. Anything else (running,
 * paused, pending) is non-terminal even when a stale `completed_at` is present.
 */
export const TERMINAL_RUN_STATUSES = ['done', 'failed', 'cancelled'];

/** All runs of the named workflows that have both time bounds, with classification and
 * mapped-session folds (history plane, mirroring attributeActionCost). Dry-run and
 * non-terminal rows are returned too — exclusion decisions and their counts belong to
 * the aggregation, where they stay visible. One parameterized query per workflow: no
 * SQL string assembly, and per-workflow volume is tiny. `opts.sinceMs` narrows to runs
 * created at/after the epoch-ms instant (`runs.created_at` is INTEGER — never a string
 * compare). */
export interface WorkflowRunRow {
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

interface WorkflowRunRawRow {
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
}

/**
 * Read all runs of the named workflows that have both time bounds
 * (`started_at`/`completed_at` recorded, `completed_at >= started_at`), with their
 * classification and mapped-session folds, ordered by `startedAt`. Per-run: a run with
 * no exact run→session mapping yields NULL cost/tokens (unmeasured, never 0); mapped
 * sessions fold the typed columns. `historyRows`/`usdRows` expose coverage so null-USD
 * rows cannot silently pass as measured. `json_extract` on unparseable/empty metadata
 * returns NULL → treated as NOT a dry run (same conservative reading as
 * workflow-service's trace labeling).
 */
export async function readWorkflowRuns(
    db: DbAdapter,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<WorkflowRunRow[]> {
    const sql = `SELECT r.id AS runId,
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
                AND r.completed_at >= r.started_at${opts.sinceMs !== undefined ? ' AND r.created_at >= ?' : ''}`;
    const rows: WorkflowRunRow[] = [];
    for (const workflow of workflows) {
        const found = await db.queryAll<WorkflowRunRawRow>(
            sql,
            workflow,
            ...(opts.sinceMs !== undefined ? [opts.sinceMs] : []),
        );
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
}

/** Per-(run, state) action fold: summed action wall ms (null when no action carried a
 * duration) and recorded `agent.run` count. `action_runs.node` carries the state id. */
export interface WorkflowStateActionRow {
    workflow: string;
    state: string;
    wallMs: number | null;
    agentRunCount: number;
}

/** Per-(state, run) state-visit count from `transition_runs.to_state` — the engine's
 * state-visit record; retries = Σ max(0, visitsInRun − 1) in the aggregation. */
export interface WorkflowStateVisitRow {
    workflow: string;
    state: string;
    visitsInRun: number;
}

/** Build the terminal non-dry run predicate shared by the per-state queries. */
function perStatePopulation(sinceMs: number | undefined): string {
    return `r.status IN (${TERMINAL_RUN_STATUSES.map(() => '?').join(',')})
        AND json_extract(r.metadata_json, '$.dryRun') IS NOT 1
        AND r.started_at IS NOT NULL AND r.completed_at IS NOT NULL
        AND r.completed_at >= r.started_at${sinceMs !== undefined ? ' AND r.created_at >= ?' : ''}`;
}

/**
 * Read per-(run, state) action folds over the terminal non-dry runs (same run population
 * and `opts.sinceMs` window as {@link readWorkflowRuns}). Finer than (workflow, state) so
 * the percentile samples survive the fold. Rows are tagged with their workflow.
 */
export async function readWorkflowStateActionRows(
    db: DbAdapter,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<WorkflowStateActionRow[]> {
    const sql = `SELECT a.node AS state,
                    SUM(a.duration_ms) AS wallMs,
                    SUM(CASE WHEN a.kind = 'agent.run' THEN 1 ELSE 0 END) AS agentRunCount
               FROM action_runs a
               JOIN runs r ON r.id = a.run_id
              WHERE r.workflow_name = ?
                AND ${perStatePopulation(opts.sinceMs)}
              GROUP BY a.run_id, a.node`;
    const rows: WorkflowStateActionRow[] = [];
    for (const workflow of workflows) {
        const found = await db.queryAll<{ state: string; wallMs: number | null; agentRunCount: number | null }>(
            sql,
            workflow,
            ...TERMINAL_RUN_STATUSES,
            ...(opts.sinceMs !== undefined ? [opts.sinceMs] : []),
        );
        for (const r of found) {
            rows.push({ workflow, state: r.state, wallMs: r.wallMs, agentRunCount: r.agentRunCount ?? 0 });
        }
    }
    return rows;
}

/**
 * Read per-(state, run) state-visit counts over the terminal non-dry runs (same run
 * population and window as {@link readWorkflowStateActionRows}).
 */
export async function readWorkflowStateVisitRows(
    db: DbAdapter,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<WorkflowStateVisitRow[]> {
    const sql = `SELECT t.to_state AS state, COUNT(*) AS visitsInRun
               FROM transition_runs t
               JOIN runs r ON r.id = t.run_id
              WHERE r.workflow_name = ?
                AND ${perStatePopulation(opts.sinceMs)}
              GROUP BY t.to_state, t.run_id`;
    const rows: WorkflowStateVisitRow[] = [];
    for (const workflow of workflows) {
        const found = await db.queryAll<{ state: string; visitsInRun: number }>(
            sql,
            workflow,
            ...TERMINAL_RUN_STATUSES,
            ...(opts.sinceMs !== undefined ? [opts.sinceMs] : []),
        );
        for (const r of found) {
            rows.push({ workflow, state: r.state, visitsInRun: r.visitsInRun });
        }
    }
    return rows;
}

/** Per-run `agent.run` action count and summed duration over terminal non-dry runs. */
export interface AgentRunHistoryRow {
    runId: string;
    count: number;
    durationMs: number | null;
}

/**
 * Read the recorded real-run inputs for a workflow: per terminal non-dry run, the number of
 * `agent.run` actions and their summed `duration_ms`, from the `action_runs`/`runs` history. A
 * run with no `agent.run` rows counts as zero actions with an unmeasured duration (null, never 0
 * — the 0284 invariant). `runIds` narrows the replay to specific recorded runs. This predicate
 * excludes numeric `dryRun=1` and requires valid timestamps; it is intentionally distinct from
 * {@link readRealTerminalRunCounts}, which has no timestamp gate.
 */
export async function readAgentRunHistoryRows(
    db: DbAdapter,
    workflow: string,
    runIds?: string[],
): Promise<AgentRunHistoryRow[]> {
    const inClause = runIds && runIds.length > 0 ? ` AND r.id IN (${runIds.map(() => '?').join(',')})` : '';
    const sql = `SELECT r.id AS runId,
                        COUNT(a.id) AS count,
                        SUM(a.duration_ms) AS durationMs
                   FROM runs r
                   LEFT JOIN action_runs a ON a.run_id = r.id AND a.kind = 'agent.run'
                  WHERE r.workflow_name = ?
                    AND r.status IN (${TERMINAL_RUN_STATUSES.map(() => '?').join(',')})
                    AND json_extract(r.metadata_json, '$.dryRun') IS NOT 1
                    AND r.started_at IS NOT NULL
                    AND r.completed_at IS NOT NULL
                    AND r.completed_at >= r.started_at${inClause}
                  GROUP BY r.id`;
    const params: (string | number)[] = [workflow, ...TERMINAL_RUN_STATUSES];
    if (runIds && runIds.length > 0) params.push(...runIds);
    const rows = await db.queryAll<{ runId: string; count: number; durationMs: number | null }>(sql, ...params);
    return rows.map((r) => ({ runId: r.runId, count: r.count, durationMs: r.durationMs }));
}

/** Real (non-dry) terminal run count per workflow name. */
export interface WorkflowRunCountRow {
    workflow: string;
    count: number;
}

/**
 * Real (non-dry) terminal run counts per workflow name, from `runs × metadata_json.dryRun`.
 * dryRun absent, 0, or 'false' counts as real (0866: a `done` row carrying `dryRun: 1` is not a
 * real completion). No timestamp gate — this counts every recorded terminal row regardless of
 * bounds, unlike {@link readAgentRunHistoryRows}.
 */
export async function readRealTerminalRunCounts(db: DbAdapter): Promise<WorkflowRunCountRow[]> {
    const rows = await db.queryAll<{ workflow_name: string | null; n: number }>(
        `SELECT workflow_name, COUNT(*) AS n FROM runs
         WHERE status IN ('done', 'failed', 'cancelled')
           AND (json_extract(metadata_json, '$.dryRun') IS NULL
                OR json_extract(metadata_json, '$.dryRun') IN (0, '0', 'false'))
         GROUP BY workflow_name`,
    );
    return rows
        .filter((r): r is { workflow_name: string; n: number } => r.workflow_name !== null && r.workflow_name !== '')
        .map((r) => ({ workflow: r.workflow_name, count: r.n }));
}
