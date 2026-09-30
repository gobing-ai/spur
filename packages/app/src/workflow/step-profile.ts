/**
 * Step profile — per-node step evidence for `sp:spur-doctor` (task 0827, feature I21; task 1005 R1).
 *
 * ADR-115 sets step boundaries by the provider cache window, not the clock, and satellite §10 owns
 * the four budgets that follow from it. `spur workflow trace --json` records each action event's
 * `durationMs`, `startedAt`/`completedAt`, `invocation` and `cost`; this module is the pure
 * aggregation core over those events — per node/action-kind rows with durations, idle gaps, session
 * mode and `cacheHit` coverage, plus the four cache-window flags the doctor turns into proposals.
 *
 * Moved from `plugins/sp/scripts/workflow-step-profile.ts` (task 1005 R1, ADR-130 lib rule): the
 * plugin script keeps argv/IO glue and reaches this module through the generated standalone bundle
 * `plugins/sp/lib/step-profile.generated.mjs` — node-builtin only, so the script's committed `.mjs`
 * twin runs under bare `node`. Regenerate with `bun run build:plugin-lib`; do not hand-edit
 * generated files.
 */
// ── Input shapes (a subset of the live `spur workflow trace --json` payload) ─────────────

/** One `cost.exact` / `cost.estimated` bucket; only `cacheHit` is read. */
export interface ActionCostLike {
    cacheHit: number | null;
}

/**
 * `ActionCostAttribution` as trace emits it. Both classes are read structurally so the script
 * carries no import of the domain package (twins must stay self-contained).
 */
export interface ActionCostAttributionLike {
    exact: ActionCostLike | null;
    estimated: ActionCostLike | null;
}

/** One timeline event. Non-`action` events are ignored; the rest is optional on purpose. */
export interface TraceActionEvent {
    kind: string;
    node?: string;
    actionKind?: string;
    durationMs?: number | null;
    startedAt?: string | null;
    completedAt?: string | null;
    invocation?: Record<string, string | number | boolean> | null;
    cost?: ActionCostAttributionLike | null;
}

/** One sampled run: the run id plus its timeline events. */
export interface StepProfileRun {
    runId: string;
    events: readonly TraceActionEvent[];
}

/** A `spur workflow trace --json` list entry (the fields the profile needs). */
export interface TraceRunEntry {
    runId: string;
    isDryRun?: boolean;
    status?: string;
    workflowName?: string;
}

/** How a run's agent sessions were started: all fresh, all resumed, or both. */
export type SessionMode = 'fresh' | 'resumed' | 'mixed';

// ── Output shapes ──────────────────────────────────────────────────────────────────────

/** One execution of a node's action kind inside one run. */
export interface StepProfileExecution {
    runId: string;
    node: string;
    actionKind: string;
    durationMs: number | null;
    idleGapMs: number | null;
    /** `invocation.continue` as recorded; null when the event predates the field. */
    session: 'fresh' | 'resumed' | null;
    cacheHit: number | null;
}

/** One (node, actionKind) row — the R1 grain. */
export interface StepProfileRow {
    node: string;
    actionKind: string;
    runs: number;
    executions: number;
    durationMs: { p50: number | null; max: number | null };
    idleGapMs: { p50: number | null };
    session: SessionMode | null;
    cacheHit: { p50: number | null; known: number; of: number };
    flags: string[];
}

/** The `--json` envelope. */
export interface StepProfile {
    workflow: string;
    windowSec: number;
    sampledRuns: number;
    rows: StepProfileRow[];
}

// ── Aggregation ────────────────────────────────────────────────────────────────────────

/** Default `--last` run sample size when the caller does not pass one. */
export const DEFAULT_LAST = 20;
/** §10 window `W`: the shortest common provider cache default, in seconds. */
export const DEFAULT_WINDOW_SEC = 300;

/**
 * Nearest-rank median: `sorted[Math.ceil(n / 2) - 1]`, so every reported value is one that was
 * actually observed. Empty input is unknown (`null`), never 0.
 */
export function nearestRankP50(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length / 2) - 1] ?? null;
}

function numeric(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function msBetween(from: string | null | undefined, to: string | null | undefined): number | null {
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    return end - start;
}

function sessionOf(event: TraceActionEvent): 'fresh' | 'resumed' | null {
    const value = event.invocation?.continue;
    if (value === true) return 'resumed';
    if (value === false) return 'fresh';
    return null;
}

function cacheHitOf(event: TraceActionEvent): number | null {
    // `cost.estimated` is deliberately unread: retroactive mappings never mix with exact evidence.
    return numeric(event.cost?.exact?.cacheHit);
}

/** Sort key: a parseable `startedAt`, with the unknown (`unavailable` / null) ordering last. */
function startKey(event: TraceActionEvent): number {
    const parsed = typeof event.startedAt === 'string' ? Date.parse(event.startedAt) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * The executions of one run: `kind === 'action'` events in `startedAt` order (trace emits them in
 * row-creation order), each carrying its idle gap (from the previous action's `completedAt` in the
 * same run), session mode and cacheHit. The run's first action has no previous action, so its gap
 * is unknown — never 0.
 */
export function extractExecutions(runId: string, events: readonly TraceActionEvent[]): StepProfileExecution[] {
    const actions = events
        .filter((e) => e.kind === 'action')
        .sort((a, b) => {
            const left = startKey(a);
            const right = startKey(b);
            return left === right ? 0 : left - right;
        });
    const executions: StepProfileExecution[] = [];
    for (const [index, event] of actions.entries()) {
        const previous = index === 0 ? undefined : actions[index - 1];
        executions.push({
            runId,
            node: event.node ?? '',
            actionKind: event.actionKind ?? '',
            durationMs: numeric(event.durationMs),
            idleGapMs: msBetween(previous?.completedAt, event.startedAt),
            session: sessionOf(event),
            cacheHit: cacheHitOf(event),
        });
    }
    return executions;
}

function foldSession(executions: readonly StepProfileExecution[]): SessionMode | null {
    const known = new Set(executions.map((e) => e.session).filter((s): s is 'fresh' | 'resumed' => s !== null));
    if (known.size === 0) return null;
    if (known.size === 1) return [...known][0] ?? null;
    return 'mixed';
}

/**
 * The four §10 cache-window flags for one row. `W` is in seconds and durations compare as
 * `ms > W * 1000`, so a step exactly at the budget is inside it.
 */
export function rowFlags(row: StepProfileRow, windowSec: number): string[] {
    const wMs = windowSec * 1000;
    const flags: string[] = [];
    const agentRun = row.actionKind === 'agent.run';
    const resumed = row.session === 'resumed' || row.session === 'mixed';
    const p50 = row.durationMs.p50;
    if (!agentRun && p50 !== null && p50 > wMs) flags.push('step-over-window');
    const idle = row.idleGapMs.p50;
    if (agentRun && resumed && idle !== null && idle > wMs) flags.push('resume-after-idle');
    const hit = row.cacheHit.p50;
    if (agentRun && resumed && row.cacheHit.known > 0 && hit !== null && hit < 0.5) flags.push('resume-cold-cache');
    if (agentRun && p50 !== null && p50 > 2 * wMs) flags.push('agent-run-over-2w');
    return flags;
}

/** Fold per-run executions into the sorted (node, actionKind) rows. */
export function buildRows(executions: readonly StepProfileExecution[], windowSec: number): StepProfileRow[] {
    const grouped = new Map<string, StepProfileExecution[]>();
    for (const execution of executions) {
        const key = `${execution.node}\u0000${execution.actionKind}`;
        const bucket = grouped.get(key);
        if (bucket === undefined) grouped.set(key, [execution]);
        else bucket.push(execution);
    }

    const rows: StepProfileRow[] = [];
    for (const bucket of grouped.values()) {
        const first = bucket[0];
        if (first === undefined) continue;
        const durations = bucket.map((e) => e.durationMs).filter((d): d is number => d !== null);
        const gaps = bucket.map((e) => e.idleGapMs).filter((g): g is number => g !== null);
        const hits = bucket.map((e) => e.cacheHit).filter((h): h is number => h !== null);
        const row: StepProfileRow = {
            node: first.node,
            actionKind: first.actionKind,
            runs: new Set(bucket.map((e) => e.runId)).size,
            executions: bucket.length,
            durationMs: {
                p50: nearestRankP50(durations),
                max: durations.length === 0 ? null : Math.max(...durations),
            },
            idleGapMs: { p50: nearestRankP50(gaps) },
            session: first.actionKind === 'agent.run' ? foldSession(bucket) : null,
            cacheHit: {
                p50: nearestRankP50(hits),
                known: hits.length,
                of: bucket.length,
            },
            flags: [],
        };
        row.flags = rowFlags(row, windowSec);
        rows.push(row);
    }

    return rows.sort((a, b) =>
        a.node === b.node ? a.actionKind.localeCompare(b.actionKind) : a.node.localeCompare(b.node),
    );
}

/** Build the profile over the sampled (already dry-run-filtered) runs. */
export function buildStepProfile(input: {
    workflow: string;
    windowSec: number;
    runs: readonly StepProfileRun[];
}): StepProfile {
    const executions = input.runs.flatMap((run) => extractExecutions(run.runId, run.events));
    return {
        workflow: input.workflow,
        windowSec: input.windowSec,
        sampledRuns: input.runs.length,
        rows: buildRows(executions, input.windowSec),
    };
}

/** Drop `isDryRun: true` entries (and anything without a run id) before sampling. */
export function nonDryRuns(entries: readonly TraceRunEntry[]): TraceRunEntry[] {
    return entries.filter((e) => e.isDryRun !== true && typeof e.runId === 'string' && e.runId.length > 0);
}

// ── Output rendering ───────────────────────────────────────────────────────────────────

function seconds(value: number | null): string {
    return value === null ? '?' : `${(value / 1000).toFixed(1)}s`;
}

function ratio(value: number | null): string {
    return value === null ? '?' : value.toFixed(2);
}

/** One line per row; seconds carry one decimal and `?` marks an unknown value. */
export function formatStepProfileHuman(profile: StepProfile): string {
    const lines = [
        `step profile — ${profile.workflow} (window ${profile.windowSec}s, ${profile.sampledRuns} sampled runs)`,
    ];
    for (const row of profile.rows) {
        lines.push(
            [
                row.node.padEnd(20),
                row.actionKind.padEnd(14),
                `${row.runs}/${row.executions}`.padEnd(8),
                `p50=${seconds(row.durationMs.p50)}`.padEnd(12),
                `max=${seconds(row.durationMs.max)}`.padEnd(12),
                `idle=${seconds(row.idleGapMs.p50)}`.padEnd(12),
                `session=${row.session ?? '?'}`.padEnd(15),
                `cacheHit=${ratio(row.cacheHit.p50)} (${row.cacheHit.known}/${row.cacheHit.of})`.padEnd(20),
                `flags=${row.flags.length === 0 ? '-' : row.flags.join(',')}`,
            ].join(' '),
        );
    }
    return `${lines.join('\n')}\n`;
}
