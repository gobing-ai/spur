import { createHash } from 'node:crypto';
import type { ReconcileSummary } from '@gobing-ai/ts-llm-jsonl-importer';
import type { DerivedVariables } from './derived';
import type { PairingStat } from './pairings';
import type { TokenTotals } from './types';
import type { SessionState } from './watermark';

/**
 * Version of the history analyze artifact schema (0464 R2). Additive fields do
 * **not** bump it; removing or retyping a field does. A future v2 is the
 * ADR-worthy event, not v1.
 */
export const HISTORY_ARTIFACT_SCHEMA_VERSION = 1;

/**
 * Composable analyze selectors. They are `AND`-joined, narrowing never widening.
 * Run/task scope resolves through the run-session/task-run mapping authorities;
 * `null` means "no predicate" for that axis and `sources: null` means no source filter.
 */
export interface ArtifactSelector {
    /** Inclusive lower bound on `history_message.ts` (ISO). */
    since: string | null;
    /** Inclusive upper bound on `history_message.ts` (ISO). */
    until: string | null;
    /** Source allowlist, or null for no source predicate. */
    sources: readonly string[] | null;
    /** Model allowlist, or null for no model predicate (0628). */
    models?: readonly string[] | null;
    /** Tool name allowlist, or null for no tool predicate (0628). */
    tools?: readonly string[] | null;
    /** Skill name allowlist, or null for no skill predicate (0628). */
    skills?: readonly string[] | null;
    /** Single session id. */
    sessionId: string | null;
    /** Single workflow run id resolved through `history_run_session`. */
    runId: string | null;
    /** Single task WBS resolved through `task_run_links` and `history_run_session`. */
    taskWbs: string | null;
}

/**
 * Per-source coverage entry. `status` is written by this task as `'ok' | 'empty'`
 * (`'failed'` arrives with 0470's per-source fan-out; `'degraded'` arrives with 0504's
 * R2 — a source imported records but also skipped malformed/schema-invalid ones, so it
 * must never read as clean `ok`; `'deferred'` arrives with 0624's R4 — a deferred-set
 * source that scanned 0 files is deliberately not imported, a label rather than a gate:
 * the same source scanning files keeps its import-derived status). `parseErrors` /
 * `validationErrors` are **counts**; their samples are bounded to 20 per source in the
 * artifact, with overflow streamed to the `.errors.jsonl` sidecar (R6).
 */
export interface CoverageEntry {
    source: string;
    status: 'ok' | 'failed' | 'empty' | 'degraded' | 'deferred';
    files: number;
    messages: number;
    toolCalls: number;
    unknownRecords: number;
    lastImportedAt: string | null;
    parseErrors: number;
    validationErrors: number;
    /** First 20 parse-error samples for this source (full detail in the sidecar). */
    parseErrorSamples: string[];
    /** First 20 validation-error samples for this source (full detail in the sidecar). */
    validationErrorSamples: string[];
    /**
     * Full-mode reconciliation outcome passed through from the importer (0505 R1) — present
     * only on `mode: 'full'` runs of importer 0.4.25+. Additive; absent on incremental runs.
     */
    reconciliation?: ReconcileSummary;
}

/**
 * The artifact's totals bucket. `TokenTotals` extended with the forensic dimensions;
 * the artifact shape is the core the 0451 report carried, re-expressed as SQL.
 * Additive fields only — `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 (version bumps are
 * reserved for removed or retyped fields).
 */
export interface ForensicTotals extends TokenTotals {
    /** Sum of `history_message.duration_ms` for role='assistant' rows. 0 when none measured. */
    assistantDurationMs: number;
    /** Assistant messages whose `duration_ms` was NULL — the assistant-duration unavailable count. */
    assistantDurationUnmeasured: number;
}

/** Per-tool forensic stat — Q1 (time) + Q3/Q6 (calls/errors) combined. */
export interface ToolStat {
    toolName: string;
    calls: number;
    errors: number;
    durationMsTotal: number;
    durationMsMean: number;
    durationMsMax: number;
    durationUnmeasured: number;
    resultBytes: number;
}

/** Per-session leaderboard entry — Q5. */
export interface SessionStat {
    sessionId: string;
    source: string;
    startedAt: string | null;
    messages: number;
    toolCalls: number;
    tokens: number;
    costUsd: number;
    topTool: string | null;
    /** Sum of `duration_ms` across role='assistant' rows in this session. */
    assistantDurationMs: number;
    /** role='assistant' rows in this session whose `duration_ms` was NULL. */
    assistantDurationUnmeasured: number;
    /**
     * Watermark completeness state (task 0550, R2) — new, additive. Analyze always sets
     * it; artifacts written before 0550 lack it, so consumers treat absence as unknown.
     */
    sessionState?: SessionState;
}

/** A repeated-call loop finding — Q4 (`args_digest` repeated >= 3 times). */
export interface LoopFinding {
    sessionId: string;
    toolName: string;
    argsDigest: string;
    repeats: number;
    firstSeq: number;
    lastSeq: number;
}

/**
 * One assistant step in the 0581 per-step rankings - raw `history_message` columns,
 * nulls preserved so consumers can distinguish unmeasured from zero.
 */
export interface StepStat {
    sessionId: string;
    source: string;
    ts: string | null;
    model: string | null;
    /** Raw `input_tokens`; on Anthropic-convention sources (omp) this is fresh, non-cached input. */
    inputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    durationMs: number | null;
}

/** Per-source support for the per-step sections, derived from assistant rows (0581 R5). */
export interface StepSupportEntry {
    source: string;
    assistantSteps: number;
    stepsWithUsage: number;
    stepsWithDuration: number;
    stepsWithCacheRead: number;
}

/** Cache re-send waste (0581 R3): full-selection aggregate plus the bounded offender ranking. */
export interface CacheWasteStat {
    /** Assistant steps matching the waste filter - full count, not bounded by `top`. */
    steps: number;
    /** Total fresh input tokens re-sent by matching steps. */
    inputTokens: number;
    /** Largest offenders, bounded by the same `top` as the other rankings. */
    topSteps: StepStat[];
}

/**
 * One executor on the capability ladder, snapshotted at analyze time (feature J8 R2).
 *
 * Read from project config (`agent.executors`) by the app layer and embedded in
 * the artifact so the pure report renderers (report-modes.ts) never read config.
 * `order` is the executor's array index — the diff target for the pairings
 * renderer (0574). `tier` is the resolved capability tier (declared or inferred).
 */
export interface LadderEntry {
    /** Executor name (`agent.executors[].name`). */
    name: string;
    /** Resolved capability tier (cheap | standard | capable-1 | capable-2 | capable-3). */
    tier: string;
    /** Array index in the config's executor list — the ranking anchor. */
    order: number;
}

/** An advisory note attached to the artifact (e.g. source-empty, drift alarm). */
export interface ArtifactWarning {
    code: string;
    source?: string;
    detail: string;
}

/** The versioned JSON artifact `spur history analyze` writes (0464 R2). */
export interface HistoryArtifact {
    schemaVersion: number;
    generatedAt: string;
    spurVersion: string;
    selector: ArtifactSelector;
    coverage: CoverageEntry[];
    totals: ForensicTotals;
    bySource: Record<string, ForensicTotals>;
    byModel: Record<string, ForensicTotals>;
    daily: Array<{ date: string } & ForensicTotals>;
    byTool: ToolStat[];
    bySession: SessionStat[];
    loops: LoopFinding[];
    warnings: ArtifactWarning[];
    /**
     * Per-(executor, role) pairing aggregation (feature J8 R1) — additive, absent
     * on pre-0573 artifacts so consumers treat absence as unknown (never fabricate).
     */
    pairings?: PairingStat[];
    /**
     * Executor capability ladder snapshotted from config at analyze time (feature
     * J8 R2) — additive, absent on pre-0573 artifacts.
     */
    ladderSnapshot?: LadderEntry[];
    /** Derived variables (phases, time decomposition, bottlenecks) from task 0554. Absent on pre-0554 artifacts. */
    derived?: DerivedVariables;
    /**
     * Top assistant steps by total tokens (input + cache-read) - additive, absent on
     * pre-0581 artifacts so consumers treat absence as unknown (task 0581 R1).
     */
    topStepsByTokens?: StepStat[];
    /** Top assistant steps by measured duration - additive (0581). Unmeasured steps excluded. */
    topStepsByDuration?: StepStat[];
    /** Cache re-send waste aggregate + bounded ranking - additive (0581 R3). */
    cacheWaste?: CacheWasteStat;
    /** Per-source per-step section support, derived from data - additive (0581 R5). */
    stepSupport?: StepSupportEntry[];
}

/**
 * First 8 hex chars of sha256 over the **canonicalized** selector: keys sorted,
 * `undefined` normalized to `null`, source list sorted. Canonicalization is what makes
 * yesterday's and today's artifacts diffable — an unstable digest silently breaks the
 * whole daily loop, so the digest must not depend on key order or source-list order.
 */
export function selectorDigest(selector: ArtifactSelector): string {
    const canonical: Record<string, unknown> = {
        runId: selector.runId ?? null,
        sessionId: selector.sessionId ?? null,
        since: selector.since ?? null,
        skills: selector.skills ? [...selector.skills].sort() : null,
        sources: selector.sources ? [...selector.sources].sort() : null,
        taskWbs: selector.taskWbs ?? null,
        tools: selector.tools ? [...selector.tools].sort() : null,
        until: selector.until ?? null,
        models: selector.models ? [...selector.models].sort() : null,
    };
    const json = JSON.stringify(canonical);
    return createHash('sha256').update(json).digest('hex').slice(0, 8);
}
