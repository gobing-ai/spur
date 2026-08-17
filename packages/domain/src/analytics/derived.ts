/**
 * Derived variables computed from raw forensic queries (task 0554).
 *
 * The registry pattern lets each metric be a pure function of the query rows and the
 * results accumulated so far. Metrics run in registration order; later metrics read
 * results left by earlier ones (bottlenecks reads timeDecomposition). This keeps the
 * dependency chain explicit and testable without a DI graph.
 */

import type { ArtifactSelector, ArtifactWarning } from './artifact';

// ---------------------------------------------------------------------------
// Result types — the DerivedVariables attached to the artifact
// ---------------------------------------------------------------------------

/** A single lifecycle phase extracted from todo-tool calls. */
export interface Phase {
    name: string;
    startedAt: string;
    endedAt: string;
    /** Always `'todo'` for now — todo-tool args are the only phase signal source. */
    source: 'todo';
}

/** Phase support + extracted phases. */
export interface PhaseResult {
    /** `'supported'` if any todo-tool calls with args_raw exist; `'unsupported'` otherwise. */
    phaseSupport: 'supported' | 'unsupported';
    phases: Phase[];
}

/** Per-session / aggregate time decomposition (ms). */
export interface TimeDecomposition {
    /** Sum of assistant `duration_ms`. */
    llmMs: number;
    /** Sum of tool `duration_ms`. */
    toolMs: number;
    /** Wall-clock idle (remainder when all durations measured). */
    idleMs: number;
    /** Remainder when some durations were NULL/unmeasured. */
    unattributedMs: number;
    /** Total wall-clock span across sessions: MAX(ts) - MIN(ts). */
    spanMs: number;
}

/** Ranked bottleneck entry. */
export interface Bottleneck {
    label: string;
    ms: number;
    /** `ms / spanMs`, clamped to [0, 1]. */
    share: number;
}

/** Derived variables block attached to the artifact. */
export interface DerivedVariables {
    phases: PhaseResult;
    timeDecomposition: TimeDecomposition;
    bottlenecks: Bottleneck[];
}

// ---------------------------------------------------------------------------
// Query row types — shapes returned by forensic-query.ts
// ---------------------------------------------------------------------------

/** Per-session timing span (MIN/MAX ts + assistant duration sums). */
export interface SessionSpanRow {
    sessionId: string;
    source: string;
    firstTs: string | null;
    lastTs: string | null;
    assistantDurationMs: number | null;
    assistantDurationUnmeasured: number;
}

/** Per-session tool duration sums. */
export interface SessionToolDurationRow {
    sessionId: string;
    source: string;
    toolDurationMs: number | null;
    toolDurationUnmeasured: number;
}

/** A todo-tool call row with args_raw + message timestamp. */
export interface TodoToolCallRow {
    sessionId: string;
    source: string;
    ts: string;
    toolName: string;
    argsRaw: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Inputs shared by every metric function. */
export interface MetricContext {
    readonly sessionSpans: readonly SessionSpanRow[];
    readonly sessionTools: readonly SessionToolDurationRow[];
    readonly todoCalls: readonly TodoToolCallRow[];
    /** Mutable results — later metrics read earlier metrics' output. */
    readonly results: DerivedVariables;
}

/** A metric computes into `ctx.results`; no return value. */
export type MetricFn = (ctx: MetricContext) => void;

/**
 * Ordered registry of metric functions. Metrics run in registration order; the
 * `compute()` entry point seeds fresh results then folds each metric over them.
 */
export class MetricRegistry {
    private readonly fns: MetricFn[] = [];

    register(name: string, fn: MetricFn): this {
        // Name is for debuggability / future introspection; not used for dispatch.
        void name;
        this.fns.push(fn);
        return this;
    }

    compute(
        sessionSpans: readonly SessionSpanRow[],
        sessionTools: readonly SessionToolDurationRow[],
        todoCalls: readonly TodoToolCallRow[],
    ): DerivedVariables {
        const ctx: MetricContext = {
            sessionSpans,
            sessionTools,
            todoCalls,
            results: emptyDerived(),
        };
        for (const fn of this.fns) {
            fn(ctx);
        }
        return ctx.results;
    }
}

/** Factory for the default-empty derived block. */
export function emptyDerived(): DerivedVariables {
    return {
        phases: { phaseSupport: 'unsupported', phases: [] },
        timeDecomposition: { llmMs: 0, toolMs: 0, idleMs: 0, unattributedMs: 0, spanMs: 0 },
        bottlenecks: [],
    };
}

// ---------------------------------------------------------------------------
// Phase extraction
// ---------------------------------------------------------------------------

/** A todo item — content + status — extracted from a tool call's args. */
interface TodoItem {
    content: string;
    status: string;
}

/**
 * Parse todo items from `args_raw` JSON. Shapes per source (task 0578 R3):
 * - Claude / OMP todo_write / Grok / OpenCode: `{ todos: [{ content, status }] }`
 * - Codex: `{ plan: [{ step, status }] }`
 * - Pi: `{ todoList: [{ title, status }] }` (statuses use hyphens: `in-progress`)
 * - OMP `todo`: `{ ops: [...] }` — `start`/`done` carry `task`; `init`/`append`
 *   introduce items via `list:[{phase,items}]` / `items`.
 */
export function parseTodoItems(source: string, argsRaw: string): TodoItem[] {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(argsRaw) as Record<string, unknown>;
    } catch {
        return [];
    }

    if (source === 'codex') return itemsFromList(parsed.plan, 'step');
    if (source === 'pi') return itemsFromList(parsed.todoList, 'title');
    if (source === 'omp' && Array.isArray(parsed.ops)) return itemsFromOps(parsed.ops);
    return itemsFromList(parsed.todos, 'content');
}

/** Normalize a `todos`/`plan`/`todoList` array; `in-progress` → `in_progress` for Pi. */
function itemsFromList(list: unknown, nameKey: string): TodoItem[] {
    const items: TodoItem[] = [];
    if (!Array.isArray(list)) return items;
    for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) continue;
        const rec = entry as Record<string, unknown>;
        const content = rec[nameKey];
        if (typeof content !== 'string' || content.length === 0) continue;
        const status = typeof rec.status === 'string' ? rec.status.replaceAll('-', '_') : '';
        items.push({ content, status });
    }
    return items;
}

/** Flatten OMP `todo` ops into items: `start`/`done` mutate one task, `init`/`append` introduce. */
function itemsFromOps(ops: readonly unknown[]): TodoItem[] {
    const items: TodoItem[] = [];
    const push = (content: unknown, status: string): void => {
        if (typeof content === 'string' && content.length > 0) items.push({ content, status });
    };
    const pushAll = (list: unknown): void => {
        if (Array.isArray(list)) for (const item of list) push(item, 'pending');
    };
    for (const op of ops) {
        if (typeof op !== 'object' || op === null) continue;
        const rec = op as Record<string, unknown>;
        if (rec.op === 'start') push(rec.task, 'in_progress');
        else if (rec.op === 'done') push(rec.task, 'completed');
        else if (rec.op === 'init' || rec.op === 'append') {
            if (Array.isArray(rec.list)) {
                for (const phase of rec.list) {
                    if (typeof phase === 'object' && phase !== null) {
                        pushAll((phase as Record<string, unknown>).items);
                    }
                }
            }
            pushAll(rec.items);
        }
    }
    return items;
}

/**
 * Extract lifecycle phases from todo-tool calls. Process chronologically per session;
 * for each distinct content string, track the first `in_progress` timestamp (startedAt)
 * and the first `completed` timestamp (endedAt). If never completed, endedAt = the
 * session's last todo-call timestamp.
 */
export function extractPhases(todoCalls: readonly TodoToolCallRow[]): Phase[] {
    // Group by session, already ordered by session_id, ts from the query.
    const sessions = new Map<string, TodoToolCallRow[]>();
    for (const call of todoCalls) {
        let arr = sessions.get(call.sessionId);
        if (!arr) {
            arr = [];
            sessions.set(call.sessionId, arr);
        }
        arr.push(call);
    }

    const phases: Phase[] = [];

    for (const [, calls] of sessions) {
        // Track per-content first-seen timestamps.
        const started = new Map<string, string>(); // content → first in_progress ts
        const ended = new Map<string, string>(); // content → first completed ts
        const seen = new Set<string>(); // all contents seen in this session

        for (const call of calls) {
            const items = parseTodoItems(call.source, call.argsRaw);
            for (const item of items) {
                seen.add(item.content);
                if (item.status === 'in_progress' && !started.has(item.content)) {
                    started.set(item.content, call.ts);
                }
                if (item.status === 'completed' && !ended.has(item.content)) {
                    ended.set(item.content, call.ts);
                }
            }
        }

        // Fallback: sessions with calls but no in_progress status — use first call ts.
        const lastCallTs = calls[calls.length - 1]?.ts ?? '';
        for (const content of seen) {
            phases.push({
                name: content,
                startedAt: started.get(content) ?? lastCallTs,
                endedAt: ended.get(content) ?? lastCallTs,
                source: 'todo',
            });
        }
    }

    return phases;
}

// ---------------------------------------------------------------------------
// Metric implementations
// ---------------------------------------------------------------------------

/** Metric: phase support + phase extraction from todo-tool calls. */
function phasesMetric(ctx: MetricContext): void {
    if (ctx.todoCalls.length === 0) {
        ctx.results.phases = { phaseSupport: 'unsupported', phases: [] };
        return;
    }
    ctx.results.phases = {
        phaseSupport: 'supported',
        phases: extractPhases(ctx.todoCalls),
    };
}

/** Metric: per-session time decomposition, aggregated across sessions. */
function decompositionMetric(ctx: MetricContext): void {
    // Build a lookup from sessionTools keyed by sessionId+source for fast join.
    const toolMap = new Map<string, SessionToolDurationRow>();
    for (const row of ctx.sessionTools) {
        toolMap.set(`${row.sessionId}\0${row.source}`, row);
    }

    let llmMs = 0;
    let toolMs = 0;
    let idleMs = 0;
    let unattributedMs = 0;
    let spanMs = 0;

    for (const span of ctx.sessionSpans) {
        if (span.firstTs == null || span.lastTs == null) continue;
        const ms = new Date(span.lastTs).getTime() - new Date(span.firstTs).getTime();
        if (ms <= 0) continue;
        spanMs += ms;

        const llm = span.assistantDurationMs ?? 0;
        const llmUnmeasured = span.assistantDurationUnmeasured;
        const key = `${span.sessionId}\0${span.source}`;
        const toolRow = toolMap.get(key);
        const tool = toolRow?.toolDurationMs ?? 0;
        const toolUnmeasured = toolRow?.toolDurationUnmeasured ?? 0;

        llmMs += llm;
        toolMs += tool;

        const remainder = Math.max(0, ms - llm - tool);
        if (llmUnmeasured > 0 || toolUnmeasured > 0) {
            unattributedMs += remainder;
        } else {
            idleMs += remainder;
        }
    }

    ctx.results.timeDecomposition = { llmMs, toolMs, idleMs, unattributedMs, spanMs };
}

/** Metric: rank bottlenecks by ms descending, computed from timeDecomposition. */
function bottlenecksMetric(ctx: MetricContext): void {
    const { llmMs, toolMs, idleMs, unattributedMs, spanMs } = ctx.results.timeDecomposition;
    const entries: Array<{ label: string; ms: number }> = [
        { label: 'llm', ms: llmMs },
        { label: 'tool', ms: toolMs },
        { label: 'idle', ms: idleMs },
        { label: 'unattributed', ms: unattributedMs },
    ];

    ctx.results.bottlenecks = entries
        .filter((e) => e.ms > 0)
        .sort((a, b) => b.ms - a.ms)
        .map((e) => ({
            label: e.label,
            ms: e.ms,
            share: spanMs > 0 ? Math.min(1, e.ms / spanMs) : 0,
        }));
}

// ---------------------------------------------------------------------------
// Default registry factory
// ---------------------------------------------------------------------------

/**
 * The default metric set. Order matters: phases and decomposition are independent,
 * but bottlenecks reads decomposition results.
 */
export function createDefaultRegistry(): MetricRegistry {
    return new MetricRegistry()
        .register('phases', phasesMetric)
        .register('decomposition', decompositionMetric)
        .register('bottlenecks', bottlenecksMetric);
}

// ---------------------------------------------------------------------------
// Artifact integration
// ---------------------------------------------------------------------------

/**
 * Compute derived variables and any associated warnings from the raw query rows.
 * Called by `history-service.analyze()` alongside the existing fold pipeline.
 */
export function computeDerived(
    sessionSpans: readonly SessionSpanRow[],
    sessionTools: readonly SessionToolDurationRow[],
    todoCalls: readonly TodoToolCallRow[],
): DerivedVariables {
    return createDefaultRegistry().compute(sessionSpans, sessionTools, todoCalls);
}

/**
 * Produce warnings for the derived block. Currently only flags unmeasured durations
 * that inflated `unattributedMs` — the signal that the source lacks per-tool timing.
 */
export function derivedWarnings(derived: DerivedVariables): ArtifactWarning[] {
    const warnings: ArtifactWarning[] = [];
    if (derived.timeDecomposition.unattributedMs > 0) {
        warnings.push({
            code: 'derived-unattributed-time',
            detail: `${derived.timeDecomposition.unattributedMs}ms could not be attributed to llm/tool/idle because some durations were unmeasured.`,
        });
    }
    return warnings;
}

// Re-export the selector type for callers that import from this module.
export type { ArtifactSelector };
