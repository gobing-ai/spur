/**
 * Board-side reads over `decision_logs` (task 1100 §3.6): list pages with rates
 * + nearest-rank p95, filter facets, and one full detail row. Mapping to
 * camelCase transport shapes lives here so the server route stays a thin
 * handler over the DAO.
 */

import type { DecisionLogDao, DecisionLogQuery, DecisionLogRow, DecisionLogSummaryRow } from '@gobing-ai/spur-domain';
import { type ConfidenceLevel, confidenceLevel } from './confidence-level';

/** Board list/detail query. Validation of outcome/caller/limit belongs to the caller (400s). */
export interface DecisionLogQuerySpec {
    /** Only rows at or after this ISO timestamp. */
    since?: string;
    decisionId?: string;
    maker?: string;
    outcome?: 'accepted' | 'fallback' | 'rejected';
    caller?: 'cli' | 'workflow' | 'gate';
    runId?: string;
    /** Max rows per page (newest first). */
    limit?: number;
    /** Opaque next-page cursor from a previous response (`started_at|id`). */
    before?: string;
}

/** List row — the full row minus input text, question and phases (§3.6). */
export interface DecisionLogSummaryEntry {
    id: string;
    decisionId: string;
    decisionType: string | null;
    caller: string;
    runId: string | null;
    workflowName: string | null;
    nodeId: string | null;
    wbs: string | null;
    makerName: string | null;
    makerSource: string | null;
    catalogLayer: string | null;
    catalogSource: string | null;
    minConfidence: number | null;
    inputKeys: string[];
    evidenceDigest: string | null;
    outcome: 'accepted' | 'fallback' | 'rejected';
    value: string | null;
    fallbackValue: string | null;
    source: string | null;
    reason: string | null;
    confidence: number | null;
    /** Derived level (HIGH ≥ 0.8, MEDIUM ≥ 0.5, LOW otherwise; absent/out-of-range → LOW). */
    confidenceLevel: ConfidenceLevel;
    error: string | null;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    schemaVersion: number;
}

/** Detail row adds the mode-gated payload: input text, inline question and phase timings. */
export interface DecisionLogDetailEntry extends DecisionLogSummaryEntry {
    question: string | null;
    inputJson: string | null;
    phases: { phase: string; startedAt: number; durationMs: number }[];
}

/** KPI strip over the filtered set (§3.6). Rates are 0 when nothing matched. */
export interface DecisionLogSummary {
    count: number;
    acceptedRate: number;
    fallbackRate: number;
    /** Nearest-rank 95th percentile of `duration_ms`; null when the set is empty. */
    p95DurationMs: number | null;
}

/** Wire envelope for the decision-log list route: page rows plus rollup summary. */
export interface DecisionLogListResponse {
    rows: DecisionLogSummaryEntry[];
    summary: DecisionLogSummary;
    facets: { decisionIds: string[]; makers: string[] };
    /** Cursor for the next older page; null at the end. */
    nextCursor: string | null;
}

/** Nearest-rank p95 (design/decision-observability-and-adoption.md §3.6). */
export function decisionLogP95(durations: number[]): number | null {
    if (durations.length === 0) return null;
    const sorted = [...durations].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil(0.95 * sorted.length));
    return sorted[Math.min(rank, sorted.length) - 1] as number;
}

function parseKeys(row: { input_keys_json: string }): string[] {
    try {
        const parsed: unknown = JSON.parse(row.input_keys_json);
        return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
        return [];
    }
}

function parsePhases(row: DecisionLogRow): { phase: string; startedAt: number; durationMs: number }[] {
    try {
        const parsed: unknown = JSON.parse(row.phases_json);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (p): p is { phase: string; startedAt: number; durationMs: number } =>
                typeof p === 'object' &&
                p !== null &&
                typeof (p as { phase?: unknown }).phase === 'string' &&
                typeof (p as { startedAt?: unknown }).startedAt === 'number' &&
                typeof (p as { durationMs?: unknown }).durationMs === 'number',
        );
    } catch {
        return [];
    }
}

function toSummaryEntry(row: DecisionLogSummaryRow): DecisionLogSummaryEntry {
    return {
        id: row.id,
        decisionId: row.decision_id,
        decisionType: row.decision_type,
        caller: row.caller,
        runId: row.run_id,
        workflowName: row.workflow_name,
        nodeId: row.node_id,
        wbs: row.wbs,
        makerName: row.maker_name,
        makerSource: row.maker_source,
        catalogLayer: row.catalog_layer,
        catalogSource: row.catalog_source,
        minConfidence: row.min_confidence,
        inputKeys: parseKeys(row),
        evidenceDigest: row.evidence_digest,
        outcome: row.outcome as DecisionLogSummaryEntry['outcome'],
        value: row.value,
        fallbackValue: row.fallback_value,
        source: row.source,
        reason: row.reason,
        confidence: row.confidence,
        confidenceLevel: confidenceLevel(row.confidence),
        error: row.error,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        durationMs: row.duration_ms,
        schemaVersion: row.schema_version,
    };
}

function daoQuery(spec: DecisionLogQuerySpec): DecisionLogQuery {
    const before =
        spec.before !== undefined
            ? (() => {
                  const sep = spec.before.indexOf('|');
                  if (sep <= 0) return undefined;
                  const startedAt = spec.before.slice(0, sep);
                  const id = spec.before.slice(sep + 1);
                  return id !== '' ? { started_at: startedAt, id } : undefined;
              })()
            : undefined;
    return {
        ...(spec.since !== undefined ? { since: spec.since } : {}),
        ...(spec.decisionId !== undefined ? { decision_id: spec.decisionId } : {}),
        ...(spec.maker !== undefined ? { maker_name: spec.maker } : {}),
        ...(spec.outcome !== undefined ? { outcome: spec.outcome } : {}),
        ...(spec.caller !== undefined ? { caller: spec.caller } : {}),
        ...(spec.runId !== undefined ? { run_id: spec.runId } : {}),
        ...(before !== undefined ? { before } : {}),
        ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
    };
}

/** Read service over one {@link DecisionLogDao} (task 1100 §3.6). */
export class DecisionLogQueryService {
    constructor(private readonly dao: DecisionLogDao) {}

    /** One list page plus the KPI strip and filter facets over the same filter set. */
    async list(spec: DecisionLogQuerySpec = {}): Promise<DecisionLogListResponse> {
        const query = daoQuery(spec);
        const [page, counts, facets] = await Promise.all([
            this.dao.list(query),
            this.dao.summary(query),
            this.dao.facets({ ...(spec.since !== undefined ? { since: spec.since } : {}) }),
        ]);
        return {
            rows: page.rows.map(toSummaryEntry),
            summary: {
                count: counts.count,
                acceptedRate: counts.count === 0 ? 0 : counts.accepted / counts.count,
                fallbackRate: counts.count === 0 ? 0 : counts.fallback / counts.count,
                p95DurationMs: decisionLogP95(counts.durations),
            },
            facets,
            nextCursor: page.nextCursor !== null ? `${page.nextCursor.started_at}|${page.nextCursor.id}` : null,
        };
    }

    /** Full detail row by invocation id, or null. */
    async get(id: string): Promise<DecisionLogDetailEntry | null> {
        const row = await this.dao.get(id);
        if (row === null) return null;
        return {
            ...toSummaryEntry(row),
            question: row.question,
            inputJson: row.input_json,
            phases: parsePhases(row),
        };
    }
}
