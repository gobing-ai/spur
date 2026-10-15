/**
 * `spur workflow cost` — per-workflow wall-clock and cost from REAL pipeline runs, plus the
 * optional per-pipeline budget gate (`--budget <file>`). Absorbed from the repository scripts
 * `scripts/commands/real-run-cost.ts` (task 0607 R5, 0730 R2, 0938) and
 * `scripts/commands/pipeline-budgets.ts` (0607 R3, 0826 R2) by script-absorption PR-9.
 *
 * The reusable measurement (run/state queries + cost aggregation) lives in
 * `run-measurements.ts`; this module owns cohort selection, the byte-stable JSON baseline
 * payload (0938 R4), the text renderers, and the budget comparison / silent-raise rules.
 * `n/a`, never `0`, for an unmeasured duration/cost (0284 invariant).
 *
 * I/O goes through injected seams (`FileSystem`, a `git show` reader, a DB opener) so the
 * module is testable without a repository checkout.
 */
import { join } from 'node:path';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem, type FileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { parse } from 'yaml';
import { extractResolvedWorkflowFacts } from './composition-baseline';
import { readStateMetrics, readWorkflowMetrics, type StateMetrics, type WorkflowMetrics } from './run-measurements';
import { isBookkeepingWorkflow } from './terminal-reason';

export {
    nearestRankPercentile,
    readStateMetrics,
    readWorkflowMetrics,
    type StateMetrics,
    type WorkflowMetrics,
} from './run-measurements';

// ── Deterministic serialization + cohort scoping (0938 R3/R4) ────────────────────

/** Recursively key-sorted compact JSON — the same DB snapshot serializes byte-identically
 * (0938 R4): sorted object keys at every depth, array order preserved, no timestamp. */
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

/** Workflow names defined in `workflowsDir` (`<name>.yaml|yml`). Sorted; duplicates collapse;
 * a missing directory is an empty cohort. */
export async function inScopeWorkflows(
    workflowsDir: string,
    fs: FileSystem = createNodeFileSystem(),
): Promise<string[]> {
    const names = new Set<string>();
    try {
        for (const entry of await fs.readDir(workflowsDir)) {
            const name = /^(.+)\.ya?ml$/.exec(entry)?.[1];
            if (name) names.add(name);
        }
    } catch {
        // no definitions dir — empty cohort
    }
    return [...names].sort();
}

/** The report cohort (0938 R3): `--workflow` filters win when given, else the full
 * definitions cohort; bookkeeping workflows drop out unless `includeBookkeeping` is set. */
export async function scopedWorkflows(
    filters: string[],
    opts: { includeBookkeeping: boolean; workflowsDir: string; fs?: FileSystem },
): Promise<string[]> {
    const cohort = filters.length > 0 ? filters : await inScopeWorkflows(opts.workflowsDir, opts.fs);
    return opts.includeBookkeeping ? cohort : cohort.filter((w) => !isBookkeepingWorkflow(w));
}

/** The baseline payload (0938 R4/R5): workflow rows plus state rows, serialized with the
 * stable writer — byte-identical for one DB snapshot. */
export async function buildReportJson(
    db: DbAdapter,
    workflows: string[],
    opts: { sinceMs?: number } = {},
): Promise<string> {
    return stableJson({
        workflows: await readWorkflowMetrics(db, workflows, opts),
        states: await readStateMetrics(db, workflows, opts),
    });
}

/** One text line per state row (`--by-state`). */
export function renderStateLines(rows: StateMetrics[]): string[] {
    return rows.map((s) => {
        const wall = s.wallMsP50 === null || s.wallMsP90 === null ? 'n/a' : `p50=${s.wallMsP50}ms p90=${s.wallMsP90}ms`;
        return `${s.workflow}/${s.state}: visits=${s.visits} agent.run=${s.agentRunCount} wall=${wall} retries=${s.retries}`;
    });
}

/** One text line per workflow row (the default report). */
export function renderWorkflowLines(rows: WorkflowMetrics[]): string[] {
    return rows.map((m) => {
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
        return `${m.workflow}: wall=${wall} cost=${cost}${excluded}`;
    });
}

/** Parse a `--since` date (YYYY-MM-DD parses as UTC midnight) into epoch ms; throws on junk. */
export function parseSince(value: string): number {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) throw new Error(`--since needs a date (YYYY-MM-DD), got ${value}`);
    return ms;
}

// ── Budget gate (0607 R3, 0826 R2) ───────────────────────────────────────────────

/** A recorded decision that justifies a budget raise. */
export interface PipelineBudgetDecision {
    /** ISO date the raise was recorded. */
    date: string;
    /** The WBS / commit that recorded the decision. */
    wbs: string;
    /** Why the raise is justified. */
    note: string;
}

/** One pipeline's committed budget. */
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

/** The budget file shape (`config/pipeline-budgets.json`). */
export interface PipelineBudgetsConfig {
    schemaVersion: 1;
    generatedAt: string;
    note: string;
    budgets: Record<string, PipelineBudget>;
}

/** A budget dimension name. */
export type BudgetKind = 'modelQueries' | 'wallClockMs' | 'tokenCostUsd';

/** One over-budget dimension. */
export interface BudgetViolation {
    pipeline: string;
    kind: BudgetKind;
    budget: number;
    measured: number;
}

/** A numeric budget that grew without a fresh recorded decision. */
export interface SilentRaise {
    pipeline: string;
    kind: BudgetKind;
    before: number;
    after: number;
}

/** Measured values per pipeline, compared against the budgets. */
export type MeasuredBudgets = Record<
    string,
    { modelQueries: number; wallClockMs: number | null; tokenCostUsd: number | null }
>;

const BUDGET_KINDS: readonly BudgetKind[] = ['modelQueries', 'wallClockMs', 'tokenCostUsd'];

/** Load a budget config. Missing or unparseable → throws (a budget file must be valid). */
export async function loadPipelineBudgets(
    path: string,
    fs: FileSystem = createNodeFileSystem(),
): Promise<PipelineBudgetsConfig> {
    return JSON.parse(await fs.readFile(path)) as PipelineBudgetsConfig;
}

/**
 * Compare measured values against budgets. A null budget or null measured value is skipped
 * (unmeasured is unenforced, never 0). One violation per over-budget dimension.
 */
export function checkBudgets(measured: MeasuredBudgets, budgets: Record<string, PipelineBudget>): BudgetViolation[] {
    const violations: BudgetViolation[] = [];
    for (const [pipeline, budget] of Object.entries(budgets)) {
        const m = measured[pipeline];
        if (!m) continue;
        for (const kind of BUDGET_KINDS) {
            const budgetValue = budget[kind];
            const measuredValue = m[kind];
            if (budgetValue === null || measuredValue === null) continue;
            if (measuredValue > budgetValue)
                violations.push({ pipeline, kind, budget: budgetValue, measured: measuredValue });
        }
    }
    return violations;
}

/**
 * A silent raise = a numeric budget that grew relative to the previous committed config
 * without a FRESH recorded decision (different wbs or date). `null → number` establishes a
 * budget and is not a raise.
 */
export function detectSilentRaises(
    before: Record<string, PipelineBudget>,
    after: Record<string, PipelineBudget>,
): SilentRaise[] {
    const raises: SilentRaise[] = [];
    for (const [pipeline, a] of Object.entries(after)) {
        const b = before[pipeline];
        if (!b) continue;
        for (const kind of BUDGET_KINDS) {
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

/** Human line naming the pipeline, budget, and measured value. */
export function formatViolation(v: BudgetViolation): string {
    const unit = v.kind === 'wallClockMs' ? 'ms' : v.kind === 'tokenCostUsd' ? ' usd' : '';
    return `pipeline=${v.pipeline} ${v.kind}: budget=${v.budget}${unit} measured=${v.measured}${unit} (over budget)`;
}

/** Assemble measured per-pipeline values: median wall-clock of sane terminal runs, the
 * history-plane cost, and the static model-query count from the definitions. */
export function measuredFromWorkflows(
    metrics: WorkflowMetrics[],
    modelQueries: Record<string, number>,
): MeasuredBudgets {
    const out: MeasuredBudgets = {};
    for (const m of metrics) {
        out[m.workflow] = {
            modelQueries: modelQueries[m.workflow] ?? 0,
            wallClockMs: m.wallClockMs ? m.wallClockMs.median : null,
            tokenCostUsd: m.tokenCostUsd,
        };
    }
    return out;
}

/** Model-query counts per workflow, extracted from the live definitions (0775 SSOT). */
export async function loadQueryCounts(
    workflowsDir: string,
    fs: FileSystem = createNodeFileSystem(),
): Promise<Record<string, number>> {
    try {
        const out: Record<string, number> = {};
        for (const entry of await fs.readDir(workflowsDir)) {
            const name = /^(.+)\.ya?ml$/.exec(entry)?.[1];
            if (!name) continue;
            const def = parse(await fs.readFile(join(workflowsDir, entry)));
            out[name] = extractResolvedWorkflowFacts(def).modelQueries.length;
        }
        return out;
    } catch {
        return {};
    }
}

/** Names with at least one model query and no budget entry (0826 R2). Sorted. */
export function checkBudgetCoverage(
    queryCounts: Record<string, number>,
    budgets: Record<string, PipelineBudget>,
): string[] {
    return Object.entries(queryCounts)
        .filter(([name, count]) => count > 0 && budgets[name] === undefined)
        .map(([name]) => name)
        .sort();
}

/** Reads `HEAD:<relPath>` from git in `cwd`; null when untracked, uncommitted, or not a repo. */
export type GitShowReader = (cwd: string, relPath: string) => Promise<string | null>;

/** Default {@link GitShowReader} through the async process seam. */
export const defaultGitShow: GitShowReader = async (cwd, relPath) => {
    const result = await new NodeProcessExecutor().run({
        command: 'git',
        args: ['show', `HEAD:${relPath}`],
        cwd,
        timeout: null,
        rejectOnError: false,
    });
    return result.exitCode === 0 ? result.stdout : null;
};

/** Opens the project DB at a path (injected so tests can supply an in-memory adapter). */
export type DbOpener = (dbPath: string) => Promise<DbAdapter>;

/** Default {@link DbOpener}: a bun-sqlite adapter at `dbPath`. */
export const defaultDbOpener: DbOpener = (dbPath) => createDbAdapter({ driver: 'bun-sqlite', url: dbPath });

/** Inputs for {@link runBudgetGate}. */
export interface BudgetGateOptions {
    /** Project root (git cwd and base for relative paths). */
    cwd: string;
    /** Budget file path (absolute, or relative to `cwd`). */
    budgetPath: string;
    /** Workflow definitions directory (model-query anchor). */
    workflowsDir: string;
    /** Project DB path; a missing file reads as "no real-run measurement". */
    dbPath: string;
    /** Explicit `--workflow` filters (default: every budgeted pipeline). */
    filters: string[];
    /** `--measured-file` override for measured values (absolute, or relative to `cwd`). */
    measuredFile?: string;
    fs?: FileSystem;
    gitShow?: GitShowReader;
    openDb?: DbOpener;
}

/** Result of {@link runBudgetGate}: stderr lines (failures), stdout lines (notes + verdict), exit code. */
export interface BudgetGateResult {
    errors: string[];
    lines: string[];
    exitCode: 0 | 1;
}

/** The budget gate. Exit 1 when any budget is exceeded, missing, or raised silently. */
export async function runBudgetGate(opts: BudgetGateOptions): Promise<BudgetGateResult> {
    const fs = opts.fs ?? createNodeFileSystem();
    const gitShow = opts.gitShow ?? defaultGitShow;
    const openDb = opts.openDb ?? defaultDbOpener;
    const absBudget = opts.budgetPath.startsWith('/') ? opts.budgetPath : join(opts.cwd, opts.budgetPath);
    const relBudget = absBudget.startsWith(`${opts.cwd}/`) ? absBudget.slice(opts.cwd.length + 1) : opts.budgetPath;

    const config = await loadPipelineBudgets(absBudget, fs);
    let head: PipelineBudgetsConfig | null = null;
    const headText = await gitShow(opts.cwd, relBudget);
    if (headText !== null) {
        try {
            head = JSON.parse(headText) as PipelineBudgetsConfig;
        } catch {
            head = null;
        }
    }
    const silentRaises = head ? detectSilentRaises(head.budgets, config.budgets) : [];
    const queryCounts = await loadQueryCounts(opts.workflowsDir, fs);

    let measured: MeasuredBudgets;
    if (opts.measuredFile !== undefined) {
        const measuredPath = opts.measuredFile.startsWith('/') ? opts.measuredFile : join(opts.cwd, opts.measuredFile);
        measured = JSON.parse(await fs.readFile(measuredPath)) as MeasuredBudgets;
    } else if (!(await fs.exists(opts.dbPath))) {
        // No imported history plane: every pipeline is unmeasured (never create a DB here).
        measured = {};
    } else {
        const targets = opts.filters.length > 0 ? opts.filters : Object.keys(config.budgets);
        const db = await openDb(opts.dbPath);
        try {
            measured = measuredFromWorkflows(await readWorkflowMetrics(db, targets), queryCounts);
        } catch (error) {
            if (error instanceof Error && /no such table|unable to open/.test(error.message)) measured = {};
            else throw error;
        } finally {
            db.close();
        }
    }

    const violations = checkBudgets(measured, config.budgets);
    const missingBudgets = checkBudgetCoverage(queryCounts, config.budgets);
    const errors: string[] = [];
    for (const name of missingBudgets) {
        errors.push(`MISSING BUDGET: pipeline=${name} modelQueries=${queryCounts[name]} has no entry in ${relBudget}`);
    }
    for (const v of violations) errors.push(`BUDGET EXCEEDED: ${formatViolation(v)}`);
    for (const r of silentRaises) {
        errors.push(
            `SILENT BUDGET RAISE: pipeline=${r.pipeline} ${r.kind}: ${r.before} -> ${r.after} without a recorded decision`,
        );
    }
    const lines: string[] = [];
    for (const p of Object.keys(config.budgets).filter((name) => measured[name] === undefined)) {
        lines.push(`note: ${p} has no real-run measurement — budget unenforced until a run is recorded (R5)`);
    }
    lines.push(
        errors.length === 0
            ? `workflow cost --budget: PASS (${Object.keys(config.budgets).length} pipelines, ${violations.length} violations)`
            : `workflow cost --budget: FAIL (${errors.length} failure(s))`,
    );
    return { errors, lines, exitCode: errors.length === 0 ? 0 : 1 };
}
