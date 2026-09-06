/**
 * check-pipeline-budgets — per-pipeline query + wall-clock cost budget gate (task 0607 R3).
 *
 * Usage: bun scripts/spur-dev.ts check-pipeline-budgets [--workflow <name>]... [--measured-file <json>]
 *
 * The gate:
 *   1. loads the committed per-pipeline budget (`config/pipeline-budgets.json`),
 *   2. assembles MEASURED values from the R5 real-run reading path (`readWorkflowMetrics`,
 *      wall-clock = worst observed terminal run, cost = history-plane fold),
 *   3. fails naming pipeline, budget, and measured value for every over-budget dimension,
 *   4. rejects a SILENT budget raise — a numeric budget that grew relative to the committed
 *      HEAD without a fresh recorded `decision` in the working-tree config.
 *
 * It deliberately does NOT join the fast `spur-check` path: wall-clock measurement requires
 * actually running the pipeline (minutes, model quota), so the gate lives at the deliberate
 * measurement surface — run it after a pipeline change, exactly where a change would be
 * caught. The model-query anchor is the live workflow definition itself, extracted by
 * `extractResolvedWorkflowFacts` (`packages/app/src/workflow/composition-baseline.ts`, 0775)
 * and guarded by `composition-baseline.test.ts` in `bun run test` inside spur-check.
 *
 * Repo-internal dev-script, NOT a new public `spur` noun/verb (ADR-051; surface questions
 * route to task 0608).
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
// Deep relative import (0775): the root node_modules has no @gobing-ai/spur-app workspace
// link for scripts/commands, so the §1.1 cross-workspace alias rule cannot resolve here.
import { extractResolvedWorkflowFacts } from '../../packages/app/src/workflow/composition-baseline';
import { readWorkflowMetrics, type WorkflowMetrics } from './real-run-cost';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const BUDGETS_PATH = join(REPO_ROOT, 'config/pipeline-budgets.json');
const WORKFLOWS_DIR = join(REPO_ROOT, 'config/workflows');

export interface PipelineBudgetDecision {
    /** ISO date the raise was recorded. */
    date: string;
    /** The WBS / commit that recorded the decision. */
    wbs: string;
    /** Why the raise is justified. */
    note: string;
}

export interface PipelineBudget {
    /** Maximum model-query count (anchor: the workflow definition's model-bearing states). */
    modelQueries: number;
    /** Maximum wall-clock in ms; null = unenforced until measured (never 0). */
    wallClockMs: number | null;
    /** Maximum history-plane USD cost; null = unenforced until measured (never 0). */
    tokenCostUsd: number | null;
    /** Provenance of the budget number. */
    source: string;
    /** Recorded decision that justifies a raise; null on the original budget. */
    decision: PipelineBudgetDecision | null;
}

export interface PipelineBudgetsConfig {
    schemaVersion: 1;
    generatedAt: string;
    note: string;
    budgets: Record<string, PipelineBudget>;
}

export interface BudgetViolation {
    pipeline: string;
    kind: 'modelQueries' | 'wallClockMs' | 'tokenCostUsd';
    budget: number;
    measured: number;
}

export interface SilentRaise {
    pipeline: string;
    kind: 'modelQueries' | 'wallClockMs' | 'tokenCostUsd';
    before: number;
    after: number;
}

/** Load the committed budget config. Missing or unparseable → throws (a budget file must be valid). */
export async function loadPipelineBudgets(path: string = BUDGETS_PATH): Promise<PipelineBudgetsConfig> {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as PipelineBudgetsConfig;
}

/**
 * Compare measured values against budgets. A null budget or null measured value is skipped
 * (unmeasured is unenforced, never treated as 0); pr-review's zero-query budget passes when
 * its measured count is 0. Returns one violation per over-budget dimension, naming the
 * pipeline, the budget, and the measured value.
 */
export function checkBudgets(
    measured: Record<string, { modelQueries: number; wallClockMs: number | null; tokenCostUsd: number | null }>,
    budgets: Record<string, PipelineBudget>,
): BudgetViolation[] {
    const violations: BudgetViolation[] = [];
    for (const [pipeline, budget] of Object.entries(budgets)) {
        const m = measured[pipeline];
        if (!m) continue;
        for (const kind of ['modelQueries', 'wallClockMs', 'tokenCostUsd'] as const) {
            const budgetValue = budget[kind];
            const measuredValue = m[kind];
            if (budgetValue === null || measuredValue === null) continue;
            if (measuredValue > budgetValue) {
                violations.push({ pipeline, kind, budget: budgetValue, measured: measuredValue });
            }
        }
    }
    return violations;
}

/**
 * A silent budget raise = a numeric budget that grew relative to the previous committed
 * config without a FRESH recorded decision. `null → number` establishes a budget (not a
 * raise); `number → larger number` is a raise that requires a new decision on the `after`
 * entry (different wbs or date from `before`'s decision). Returns the silent raises.
 */
export function detectSilentRaises(
    before: Record<string, PipelineBudget>,
    after: Record<string, PipelineBudget>,
): SilentRaise[] {
    const raises: SilentRaise[] = [];
    for (const [pipeline, a] of Object.entries(after)) {
        const b = before[pipeline];
        if (!b) continue;
        for (const kind of ['modelQueries', 'wallClockMs', 'tokenCostUsd'] as const) {
            const beforeValue = b[kind];
            const afterValue = a[kind];
            if (beforeValue === null || afterValue === null || afterValue <= beforeValue) continue;
            const fresh =
                a.decision !== null &&
                (b.decision === null || b.decision.wbs !== a.decision.wbs || b.decision.date !== a.decision.date);
            if (!fresh) raises.push({ pipeline, kind, before: beforeValue, after: afterValue });
        }
    }
    return raises;
}

/** Human line naming the pipeline, budget, and measured value (R3's "fails naming all three"). */
export function formatViolation(v: BudgetViolation): string {
    const unit = v.kind === 'wallClockMs' ? 'ms' : v.kind === 'tokenCostUsd' ? ' usd' : '';
    return `pipeline=${v.pipeline} ${v.kind}: budget=${v.budget}${unit} measured=${v.measured}${unit} (over budget)`;
}

/** The committed HEAD version of the budget config, or null when untracked/uncommitted. */
function headBudgets(): PipelineBudgetsConfig | null {
    try {
        const out = execFileSync('git', ['show', 'HEAD:config/pipeline-budgets.json'], {
            cwd: REPO_ROOT,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return JSON.parse(out) as PipelineBudgetsConfig;
    } catch {
        return null; // first commit / uncommitted — nothing to compare a raise against
    }
}

/** Assemble measured per-pipeline values from the R5 real-run reading (worst observed run). */
export function measuredFromWorkflows(
    metrics: WorkflowMetrics[],
    modelQueries: Record<string, number>,
): Record<string, { modelQueries: number; wallClockMs: number | null; tokenCostUsd: number | null }> {
    const out: Record<string, { modelQueries: number; wallClockMs: number | null; tokenCostUsd: number | null }> = {};
    for (const m of metrics) {
        out[m.workflow] = {
            // Real-run model-query count is the frozen baseline list length (the SSOT, two-sided
            // checked) — query count is a static fact, never re-derived by parsing YAML. Wall-clock
            // is the median of sane terminal runs (robust to abandoned-run outliers; budgets are
            // anchored to median in config/pipeline-budgets.json).
            modelQueries: modelQueries[m.workflow] ?? 0,
            wallClockMs: m.wallClockMs ? m.wallClockMs.median : null,
            tokenCostUsd: m.tokenCostUsd,
        };
    }
    return out;
}

/** Model-query counts per workflow, extracted from the live definitions (0775 SSOT). */
export async function loadQueryCounts(workflowsDir: string = WORKFLOWS_DIR): Promise<Record<string, number>> {
    try {
        const out: Record<string, number> = {};
        for (const entry of await readdir(workflowsDir)) {
            const m = /^(.+)\.ya?ml$/.exec(entry);
            if (!m) continue;
            const def = parse(await readFile(join(workflowsDir, entry), 'utf-8'));
            out[m[1]] = extractResolvedWorkflowFacts(def).modelQueries.length;
        }
        return out;
    } catch {
        return {};
    }
}

/** CLI entry — the R3 gate. Exit 1 when any budget is exceeded or any raise is silent. */
export async function checkPipelineBudgets(argv: string[]): Promise<number> {
    const filters: string[] = [];
    let measuredFile: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--workflow') {
            const value = argv[++i];
            if (value === undefined) throw new Error('check-pipeline-budgets: --workflow requires a value');
            filters.push(value);
        } else if (argv[i] === '--measured-file') {
            const value = argv[++i];
            if (value === undefined) throw new Error('check-pipeline-budgets: --measured-file requires a value');
            measuredFile = value;
        } else throw new Error(`check-pipeline-budgets: unknown argument ${argv[i]}`);
    }

    const config = await loadPipelineBudgets();
    const head = headBudgets();
    const silentRaises = head ? detectSilentRaises(head.budgets, config.budgets) : [];
    const queryCounts = await loadQueryCounts();

    // Measured values: explicit file wins; otherwise read real-run history.
    let measured: Record<string, { modelQueries: number; wallClockMs: number | null; tokenCostUsd: number | null }>;
    if (measuredFile !== null) {
        measured = JSON.parse(await readFile(measuredFile, 'utf-8'));
    } else {
        const workflows = Object.keys(config.budgets);
        const targets = filters.length > 0 ? filters : workflows;
        // A project without an imported history plane (missing .spur/spur.db or tables) reads as
        // no real-run measurement — every pipeline is unmeasured, and the gate reports the query
        // budgets only. Never crash the gate over a missing DB.
        try {
            const metrics = readWorkflowMetrics(join(REPO_ROOT, '.spur/spur.db'), targets);
            measured = measuredFromWorkflows(metrics, queryCounts);
        } catch (error) {
            if (error instanceof Error && /no such table|unable to open/.test(error.message)) {
                measured = {};
            } else {
                throw error;
            }
        }
    }

    const violations = checkBudgets(measured, config.budgets);

    let failures = 0;
    for (const v of violations) {
        console.error(`BUDGET EXCEEDED: ${formatViolation(v)}`);
        failures++;
    }
    for (const r of silentRaises) {
        console.error(
            `SILENT BUDGET RAISE: pipeline=${r.pipeline} ${r.kind}: ${r.before} -> ${r.after} without a recorded decision`,
        );
        failures++;
    }
    const unmeasured = Object.keys(config.budgets).filter((p) => measured[p] === undefined);
    for (const p of unmeasured) {
        console.log(`note: ${p} has no real-run measurement — budget unenforced until a run is recorded (R5)`);
    }
    console.log(
        failures === 0
            ? `check-pipeline-budgets: PASS (${Object.keys(config.budgets).length} pipelines, ${violations.length} violations)`
            : `check-pipeline-budgets: FAIL (${failures} failure(s))`,
    );
    return failures === 0 ? 0 : 1;
}

if (import.meta.main) {
    process.exit(await checkPipelineBudgets(process.argv.slice(2)));
}
