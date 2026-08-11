import { createHash } from 'node:crypto';
import type { ReconcileSummary } from '@gobing-ai/ts-llm-jsonl-importer';
import type { TokenTotals } from './types';

/**
 * Version of the history analyze artifact schema (0464 R2). Additive fields do
 * **not** bump it; removing or retyping a field does. A future v2 is the
 * ADR-worthy event, not v1.
 */
export const HISTORY_ARTIFACT_SCHEMA_VERSION = 1;

/**
 * The six composable analyze selectors. Each maps to an indexed column; `AND`-joined,
 * narrowing never widening. `null` means "no predicate" for that axis; `sources: null`
 * means no source filter (equivalent to `--source all`).
 */
export interface ArtifactSelector {
    /** Inclusive lower bound on `history_message.ts` (ISO). */
    since: string | null;
    /** Inclusive upper bound on `history_message.ts` (ISO). */
    until: string | null;
    /** Source allowlist, or null for no source predicate. */
    sources: readonly string[] | null;
    /** Single session id. */
    sessionId: string | null;
    /** Single workflow run id (`provenance='spur-run'`). */
    runId: string | null;
    /** Single task WBS. */
    taskWbs: string | null;
}

/**
 * Per-source coverage entry. `status` is written by this task as `'ok' | 'empty'`
 * (`'failed'` arrives with 0470's per-source fan-out; `'degraded'` arrives with 0504's
 * R2 — a source imported records but also skipped malformed/schema-invalid ones, so it
 * must never read as clean `ok`). `parseErrors` / `validationErrors` are **counts**;
 * their samples are bounded to 20 per source in the artifact, with overflow streamed to
 * the `.errors.jsonl` sidecar (R6).
 */
export interface CoverageEntry {
    source: string;
    status: 'ok' | 'failed' | 'empty' | 'degraded';
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
        sources: selector.sources ? [...selector.sources].sort() : null,
        taskWbs: selector.taskWbs ?? null,
        until: selector.until ?? null,
    };
    const json = JSON.stringify(canonical);
    return createHash('sha256').update(json).digest('hex').slice(0, 8);
}
