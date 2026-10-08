/**
 * Decision log persistence — design/decision-observability-and-adoption.md §3.5
 * (task 1100).
 *
 * One row per decision invocation, written by the decision-log sink after the
 * lifecycle's terminal event (`end` / `rejected`), keyed by the same
 * `invocationId` the events carry. Writing is best-effort (§5): a DAO failure
 * reaches the sink's warn path and never changes the returned decision or a
 * caller's thrown error. Redaction reuses the agent-execution redactor with the
 * caller's configured secret values, and every free-text column is bounded.
 *
 * Row-building policy lives here so `decision-events.ts` only hands over the
 * invocation facts via {@link writeDecisionLog}.
 */

import type { SpurConfig } from '@gobing-ai/spur-config';
import { type CreateDecisionLogInput, type DbAdapter, DecisionLogDao } from '@gobing-ai/spur-domain';
import { configuredSecretValues, redactAndBound } from '../observability/agent-execution';
import type { DecisionCaller, DecisionCorrelation } from './decision-events';

/** Caller-observed lifecycle phase timing (task 1100). */
export interface DecisionPhase {
    readonly phase: 'resolve' | 'evidence' | 'maker' | 'serve';
    readonly startedAt: number;
    readonly durationMs: number;
}

/** Write mode for decision log rows. `metadata` drops input and inline-question text. */
export type DecisionLogMode = 'full' | 'metadata';

/** Per-caller sink: DAO plus the redaction inputs. Built once per call site by {@link decisionLogSink}. */
export interface DecisionLogSink {
    readonly dao: DecisionLogDao;
    readonly secrets: readonly string[];
    readonly mode: DecisionLogMode;
    /** Warn sink for best-effort write failures; absent warns nowhere. */
    readonly warn?: (message: string) => void;
}

/**
 * Build the decision log sink for one caller from its own config. `off` returns
 * `undefined` — callers pass the sink through optional plumbing and the
 * lifecycle emits events exactly as before with no row written.
 */
export function decisionLogSink(
    adapter: DbAdapter,
    config: SpurConfig | null | undefined,
    env: Record<string, string | undefined>,
): DecisionLogSink | undefined {
    const mode = config?.decisions?.log ?? 'full';
    if (mode === 'off') return undefined;
    return { dao: new DecisionLogDao(adapter), secrets: configuredSecretValues(env), mode };
}

/** Facts a producer hands the lifecycle so the row lands under the events' invocationId. */
export interface DecisionLogWrite {
    readonly sink: DecisionLogSink;
    /** Producer lifecycle clock (epoch ms) — the service entry, or the inline maker start. */
    readonly startedAt: number;
    /** Phases the producer observed inside its own call, in order; producers append as they go. */
    phases: DecisionPhase[];
    /** Caller prelude (clock + phases such as an evidence read) that precedes the service call. */
    readonly prelude?: { readonly startedAt: number; readonly phases: readonly DecisionPhase[] };
    /** The decide input as received; redacted and bounded per mode at write time. */
    readonly input?: Record<string, unknown>;
    /** Workflow inline-question text (inline path only). */
    readonly question?: string;
    /** The catalog-declared fallback, stored on `fallback`/`rejected` rows that declared one. */
    fallbackValue?: string | number | boolean;
    /** Winning catalog file path; set by the service after describe resolves. */
    catalogSource?: string;
    /** Raw maker/rejection message for the row's redacted `error` column. */
    error?: string;
    /** Maker source for rejection sites that already resolved it (e.g. unregistered-maker). */
    makerSource?: string;
}

/** Everything needed to build one row. Assembled at terminal time from events + the log arg. */
export interface DecisionLogRecord {
    readonly id: string;
    readonly decisionId: string;
    readonly caller: DecisionCaller;
    readonly correlation?: DecisionCorrelation;
    readonly decisionType?: string;
    readonly maker?: string;
    readonly makerSource?: string;
    readonly catalogLayer?: string;
    readonly catalogSource?: string;
    readonly minConfidence?: number;
    readonly input?: Record<string, unknown>;
    readonly inputKeys?: readonly string[];
    readonly question?: string;
    readonly evidenceDigest?: string;
    readonly outcome: 'accepted' | 'fallback' | 'rejected';
    readonly value?: string | number | boolean;
    readonly fallbackValue?: string | number | boolean;
    readonly source?: string;
    readonly reason?: string;
    readonly confidence?: number | null;
    readonly error?: string;
    readonly startedAtMs: number;
    readonly endedAtMs: number;
    readonly phases: readonly DecisionPhase[];
}

/** 16 KiB bound for the redacted `input_json` column (§3.5). */
const DECISION_LOG_INPUT_MAX_CHARS = 16 * 1024;

/** 2 KiB bound for redacted free text (`question`, `error`) (§3.5). */
const DECISION_LOG_TEXT_MAX_CHARS = 2 * 1024;

/** Schema version stamped on every row; the Board tolerates future shapes via this field. */
export const DECISION_LOG_SCHEMA_VERSION = 1;

function boundedQuestion(sink: DecisionLogSink, question: string | undefined): string | null {
    if (sink.mode === 'metadata' || question === undefined) return null;
    return redactAndBound(question, sink.secrets, DECISION_LOG_TEXT_MAX_CHARS);
}

function boundedInputJson(sink: DecisionLogSink, input: Record<string, unknown> | undefined): string | null {
    if (sink.mode === 'metadata' || input === undefined) return null;
    const raw = redactAndBound(JSON.stringify(input), sink.secrets, DECISION_LOG_INPUT_MAX_CHARS);
    if (raw.length <= DECISION_LOG_INPUT_MAX_CHARS) return raw;
    // Cut by the bound: re-serialize with an explicit marker so the Board can
    // show a truncated notice instead of a tail-less JSON blob.
    const truncated = JSON.stringify({ truncated: true, input: raw.slice(0, DECISION_LOG_INPUT_MAX_CHARS - 64) });
    return truncated.length <= DECISION_LOG_INPUT_MAX_CHARS
        ? truncated
        : truncated.slice(0, DECISION_LOG_INPUT_MAX_CHARS);
}

function boundedValue(value: string | number | boolean | undefined): string | null {
    return value === undefined ? null : String(value);
}

/** Apply redaction, size bounds and mode nulling; the result is insert-ready. */
export function buildDecisionLogRow(sink: DecisionLogSink, record: DecisionLogRecord): CreateDecisionLogInput {
    const value = record.outcome === 'rejected' ? null : boundedValue(record.value);
    const fallbackValue =
        record.outcome === 'fallback'
            ? boundedValue(record.fallbackValue ?? record.value)
            : record.outcome === 'rejected'
              ? boundedValue(record.fallbackValue)
              : null;
    return {
        id: record.id,
        decision_id: record.decisionId,
        decision_type: record.decisionType ?? null,
        caller: record.caller,
        run_id: record.correlation?.runId ?? null,
        workflow_name: record.correlation?.workflowName ?? null,
        node_id: record.correlation?.nodeId ?? null,
        wbs: record.correlation?.wbs ?? null,
        maker_name: record.maker ?? null,
        maker_source: record.makerSource ?? null,
        catalog_layer: record.catalogLayer !== undefined && record.catalogLayer !== '' ? record.catalogLayer : null,
        catalog_source: record.catalogSource ?? null,
        min_confidence: record.minConfidence ?? null,
        question: boundedQuestion(sink, record.question),
        input_json: boundedInputJson(sink, record.input),
        input_keys_json: JSON.stringify([...(record.inputKeys ?? Object.keys(record.input ?? {}))]),
        evidence_digest: record.evidenceDigest ?? null,
        outcome: record.outcome,
        value,
        fallback_value: fallbackValue,
        source: record.outcome === 'rejected' ? null : (record.source ?? null),
        reason: record.reason ?? null,
        confidence: record.confidence ?? null,
        error:
            record.error === undefined ? null : redactAndBound(record.error, sink.secrets, DECISION_LOG_TEXT_MAX_CHARS),
        started_at: new Date(record.startedAtMs).toISOString(),
        ended_at: new Date(record.endedAtMs).toISOString(),
        duration_ms: Math.max(0, record.endedAtMs - record.startedAtMs),
        phases_json: JSON.stringify(record.phases),
        schema_version: DECISION_LOG_SCHEMA_VERSION,
    };
}

/** Best-effort insert: a DAO failure reaches the sink's warn path and nothing else (§5). */
export function writeDecisionLog(sink: DecisionLogSink, row: CreateDecisionLogInput): void {
    void sink.dao.insert(row).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        try {
            sink.warn?.(`decision log write failed: ${message}`);
        } catch {
            // A warn-sink failure must not change decision semantics either.
        }
    });
}
