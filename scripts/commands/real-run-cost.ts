/**
 * real-run-cost — per-workflow wall-clock and cost from REAL pipeline runs (task 0607 R5).
 *
 * Usage: bun scripts/spur-dev.ts real-run-cost [--workflow <name>]... [--json]
 *
 * Reads the main history plane (`.spur/spur.db`) and aggregates, per in-scope workflow
 * (the eight in `config/workflow-composition-baseline.json`):
 *   - wall-clock from the `runs` table (`completed_at - started_at`) over terminal runs;
 *   - cost from `history_run_session` → `history_message` (summed `cost_usd`, exact
 *     observed mappings only), the same history-plane fold `attributeActionCost` uses.
 *
 * This is the repeatable answer to "what did a real pipeline run cost and how long did
 * it take" — larger and more representative than any fixture, and already paid for. It
 * reuses existing history surfaces (runs / history_run_session / history_message); it is
 * a repo-internal dev-script, NOT a new public `spur` noun/verb (ADR-051; surface
 * questions route to task 0608).
 *
 * The `--workflow` filter defaults to the in-scope pipelines from the baseline; `--json` emits an
 * machine-readable object. `n/a`, never `0`, for an unmeasured duration/cost (0284
 * invariant).
 */
import { Database } from 'bun:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const DB_PATH = join(REPO_ROOT, '.spur/spur.db');
const BASELINE_PATH = join(REPO_ROOT, 'config/workflow-composition-baseline.json');

export interface WorkflowMetrics {
    workflow: string;
    runs: number;
    /** Wall-clock stats (ms) over terminal runs, or null when no run has both bounds. */
    wallClockMs: { mean: number; median: number; min: number; max: number } | null;
    /** Summed history-plane USD cost across the workflow's exact-mapped runs. */
    tokenCostUsd: number | null;
    /** Summed input+output tokens across the same fold. */
    tokens: number | null;
}

/** All terminal runs of the named workflows, with wall-clock and mapped-session cost. */
export function readWorkflowRuns(
    dbPath: string,
    workflows: string[],
): Array<{ workflow: string; wallClockMs: number | null; tokenCostUsd: number | null; tokens: number | null }> {
    const db = new Database(dbPath, { readonly: true });
    try {
        const ph = workflows.map(() => '?').join(',');
        // Per-run: a run with no exact run→session mapping yields NULL cost (unmeasured, never 0);
        // a run with mappings folds the typed columns of its mapped sessions (history-plane fold,
        // mirroring attributeActionCost). The correlated subqueries are bounded by the run's own
        // mapped sessions, never a full history_message scan.
        const rows = db
            .query(
                `SELECT r.workflow_name AS workflow,
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
                            AS tokens
                 FROM runs r
                 WHERE r.workflow_name IN (${ph})
                   AND r.started_at IS NOT NULL AND r.completed_at IS NOT NULL
                   AND r.completed_at >= r.started_at
                 ORDER BY r.started_at`,
            )
            .all(...workflows) as Array<{
            workflow: string;
            wallClockMs: number;
            tokenCostUsd: number | null;
            tokens: number | null;
        }>;
        // SUM over an empty join is NULL: a run whose mapped sessions carry no cost/token
        // columns is UNMEASURED (null), never a free run (0) — the 0284 invariant.
        return rows.map((r) => ({
            workflow: r.workflow,
            wallClockMs: r.wallClockMs,
            tokenCostUsd: r.tokenCostUsd,
            tokens: r.tokens,
        }));
    } finally {
        db.close();
    }
}

function median(values: number[]): number {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Aggregate per-workflow wall-clock + cost over terminal runs (R5 reading path). */
export function readWorkflowMetrics(dbPath: string, workflows: string[]): WorkflowMetrics[] {
    const runs = readWorkflowRuns(dbPath, workflows);
    const byWorkflow = new Map<string, typeof runs>();
    for (const r of runs) {
        const list = byWorkflow.get(r.workflow) ?? [];
        list.push(r);
        byWorkflow.set(r.workflow, list);
    }
    return workflows.map((workflow) => {
        const list = byWorkflow.get(workflow) ?? [];
        // A terminal run whose span exceeds 24h is an abandoned run (started at launch,
        // completed_at stamped by a later session) — not a real execution. Exclude it from
        // wall-clock stats so an orphaned row cannot blow the budget (ponytail: hard 24h
        // ceiling; the per-hop stepTimeoutMs is 30 min, so no live run legitimately crosses it).
        const walls = list
            .filter((r) => r.wallClockMs !== null && r.wallClockMs <= 86_400_000)
            .map((r) => r.wallClockMs as number);
        const costs = list.filter((r) => r.tokenCostUsd !== null);
        const measured = costs.length > 0;
        return {
            workflow,
            runs: list.length,
            wallClockMs:
                walls.length === 0
                    ? null
                    : {
                          mean: Math.round(walls.reduce((a, b) => a + b, 0) / walls.length),
                          median: Math.round(median(walls)),
                          min: Math.round(Math.min(...walls)),
                          max: Math.round(Math.max(...walls)),
                      },
            tokenCostUsd: measured ? costs.reduce((a, r) => a + (r.tokenCostUsd ?? 0), 0) : null,
            tokens: measured ? costs.reduce((a, r) => a + (r.tokens ?? 0), 0) : null,
        };
    });
}

/** The in-scope pipelines from the composition baseline (their baseline keys). */
export async function inScopeWorkflows(baselinePath: string = BASELINE_PATH): Promise<string[]> {
    try {
        const parsed = JSON.parse(await readFile(baselinePath, 'utf-8')) as {
            workflows?: Record<string, unknown>;
        };
        return Object.keys(parsed.workflows ?? {}).sort();
    } catch {
        return [];
    }
}

/** CLI entry — `bun scripts/spur-dev.ts real-run-cost [--workflow <name>]... [--json]`. */
export async function realRunCost(argv: string[]): Promise<number> {
    const workflows = inScopeWorkflows();
    const filters: string[] = [];
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--workflow') filters.push(argv[++i]);
        else if (argv[i] === '--json') json = true;
        else throw new Error(`real-run-cost: unknown argument ${argv[i]}`);
    }
    const targets = filters.length > 0 ? filters : await workflows;
    const metrics = readWorkflowMetrics(DB_PATH, targets);
    if (json) {
        console.log(JSON.stringify(metrics, null, 2));
        return 0;
    }
    for (const m of metrics) {
        const wall = m.wallClockMs
            ? `n=${m.runs} mean=${Math.round(m.wallClockMs.mean / 1000)}s median=${Math.round(m.wallClockMs.median / 1000)}s ` +
              `min=${Math.round(m.wallClockMs.min / 1000)}s max=${Math.round(m.wallClockMs.max / 1000)}s`
            : 'n/a (no terminal run with bounds)';
        const cost = m.tokenCostUsd !== null ? `$${m.tokenCostUsd.toFixed(4)} (${m.tokens ?? 0} tokens)` : 'n/a';
        console.log(`${m.workflow}: wall=${wall} cost=${cost}`);
    }
    return 0;
}
