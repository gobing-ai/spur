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
 * The reusable measurement (run/state queries + cost aggregation) lives in
 * `packages/domain/src/analytics/workflow-measurements.ts` (SQL) and
 * `packages/app/src/workflow/run-measurements.ts` (aggregation, task 1178 R1). This
 * repository module keeps cohort selection, stable JSON formatting and CLI dispatch; the
 * exported wrappers below open the project DB by path and delegate to the app owner.
 *
 * The `--workflow` filter defaults to the full in-scope cohort (every definition in
 * `config/workflows/`) 0730 R1. `n/a`, never `0`, for an unmeasured duration/cost
 * (0284 invariant).
 *
 * Repo-internal dev-script, NOT a new public `spur` noun/verb (ADR-051; surface questions
 * route to task 0608).
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    readStateMetrics as readStateMetricsWithDb,
    readWorkflowMetrics as readWorkflowMetricsWithDb,
} from '../../packages/app/src/workflow/run-measurements';
// Deep relative import (0775, same as workflow-promotion.ts): the root node_modules has no
// @gobing-ai/app workspace link for scripts/commands, so the §1.1 alias cannot resolve here.
import { isBookkeepingWorkflow } from '../../packages/app/src/workflow/terminal-reason';

export {
    nearestRankPercentile,
    type StateMetrics,
    type WorkflowMetrics,
} from '../../packages/app/src/workflow/run-measurements';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DB_PATH = join(REPO_ROOT, '.spur/spur.db');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config/workflows');

/** Aggregate per-workflow metrics from the project history plane at `dbPath` (delegates to
 * the app measurement owner; the adapter is opened here because the repository owns the
 * database path). */
export async function readWorkflowMetrics(
    dbPath: string,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<Awaited<ReturnType<typeof readWorkflowMetricsWithDb>>> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
    try {
        return await readWorkflowMetricsWithDb(db, workflows, opts);
    } finally {
        db.close();
    }
}

/** Read per-state metrics from the project history plane at `dbPath` (delegates to the app
 * measurement owner). */
export async function readStateMetrics(
    dbPath: string,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<Awaited<ReturnType<typeof readStateMetricsWithDb>>> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
    try {
        return await readStateMetricsWithDb(db, workflows, opts);
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

/** The baseline payload (0938 R4/R5): workflow rows plus (always) state rows, serialized
 * with the stable writer — byte-identical for one DB snapshot. The report file is this
 * string redirected to `docs/reports/2026-09-workflow-cost-baseline.json`. */
export async function buildReportJson(
    dbPath: string,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<string> {
    return stableJson({
        workflows: await readWorkflowMetrics(dbPath, workflows, opts),
        states: await readStateMetrics(dbPath, workflows, opts),
    });
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
        console.log(await buildReportJson(DB_PATH, targets, { sinceMs }));
        return 0;
    }
    const metrics = await readWorkflowMetrics(DB_PATH, targets, { sinceMs });
    if (byState) {
        for (const s of await readStateMetrics(DB_PATH, targets, { sinceMs })) {
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
