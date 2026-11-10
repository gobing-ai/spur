/**
 * Antigravity (agy) capture-fidelity ETL (task 1324, feature D, R2/R3).
 *
 * The vendor importer (`@gobing-ai/ts-llm-jsonl-importer`) is an external package Spur
 * cannot edit, and its agy mapper writes `history_message` rows with NULL model, NULL
 * usage columns, and tool-call rows whose args are digested only when the mapper saw a
 * `tool_calls[]` payload — which is why agy carried 61% of the window's messages with
 * zero usage/model/args capture (39.9% unattributed wall time, blind cost). This module
 * is the Spur-side enrichment plane: it reads *vendor-side* usage/tool-arg facts (parsed
 * from the raw session logs by the caller) and back-fills the forensic tables in place,
 * plus collapses verbatim poll-message duplicates so loop/latency aggregators stop
 * counting them (R3).
 *
 * Availability contract (R2): a field the vendor log actually carries is written with its
 * real value (cost derived via the shared model pricing when the model resolves); a field
 * the vendor never exposes stays SQL NULL — never an empty string — and the owning row is
 * marked with the explicit `usage-unavailable` disposition so consumers can distinguish
 * "the vendor told us nothing" from "not yet enriched". Empty-string arg digests (the
 * loop-detector false-fire root cause) are rewritten to NULL, the unavailable sentinel
 * the loop query already excludes.
 *
 * All writes are idempotent: enrichment targets only rows that still lack the field, and
 * collapse only marks rows whose disposition is not already the duplicate marker, so a
 * second pass over the same DB is a no-op.
 */
import { createHash } from 'node:crypto';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { computeRecordCost } from './costs';

/** Sources the antigravity CLI writes history under (mapper + custom-source spellings). */
const AGY_SOURCES = ['agy', 'antigravity'] as const;

/** Disposition stamped on assistant rows whose vendor log carries no usage facts (R2). */
export const AGY_USAGE_UNAVAILABLE_DISPOSITION = 'usage-unavailable';

/** Disposition stamped on verbatim-duplicate consecutive assistant messages (R3). */
export const POLL_DUPLICATE_DISPOSITION = 'poll-duplicate';

/** One vendor-side usage fact parsed from an agy session log, keyed to its session. */
export interface AntigravityUsageRecord {
    /** Session id the vendor log row belongs to (`session_id` / `conversationId`). */
    readonly sessionId: string;
    /** Model the vendor reports for the step (real identifier, never a placeholder). */
    readonly model: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number | null;
    readonly cacheWriteTokens?: number | null;
}

/** One vendor-side tool-args fact parsed from an agy session log, keyed to its call site. */
export interface AntigravityToolArgsRecord {
    /** Session id the vendor log row belongs to. */
    readonly sessionId: string;
    /** `seq` / `step_index` the importer wrote on the `history_tool_call` row. */
    readonly seq: number;
    /** Tool name exactly as the importer recorded it (`name` / `tool_name`). */
    readonly toolName: string;
    /** The vendor's raw args payload (JSON-serializable); NULL/undefined = unavailable. */
    readonly args: unknown;
}

/** Outcome counters for one enrichment pass — each count is rows actually changed. */
export interface AntigravityEnrichmentResult {
    /** Assistant rows that received real model/usage/cost values. */
    readonly messagesEnriched: number;
    /** Assistant rows marked `usage-unavailable` (vendor carries no usage for them). */
    readonly messagesUnavailable: number;
    /** Tool-call rows whose `args_raw`/`args_digest` were back-filled from vendor logs. */
    readonly toolCallsBackfilled: number;
    /** Empty-string arg digests rewritten to the NULL unavailable sentinel. */
    readonly emptyDigestsRepaired: number;
}

/** Outcome counters for one poll-duplicate collapse pass (R3). */
export interface PollDuplicateCollapse {
    /** Sessions that contained at least one collapsed duplicate run. */
    readonly sessions: number;
    /** Assistant rows re-dispositioned to {@link POLL_DUPLICATE_DISPOSITION}. */
    readonly duplicatesMarked: number;
}

/** SHA-256 hex of the canonical JSON encoding — the digest form `args_digest` carries. */
function digestArgs(args: unknown): string | null {
    if (args === null || args === undefined) return null;
    let json: string;
    try {
        json = JSON.stringify(args);
    } catch {
        return null; // non-serializable payload: unavailable, never an empty digest
    }
    return createHash('sha256').update(json, 'utf8').digest('hex');
}

/** SQL `source IN (…)` fragment + params binding {@link AGY_SOURCES}. */
const AGY_SOURCE_FILTER = `source IN (${AGY_SOURCES.map(() => '?').join(', ')})`;
const AGY_SOURCE_PARAMS: readonly string[] = AGY_SOURCES;

/**
 * Enrich agy `history_message` rows with vendor-side usage facts (R2) and mark the
 * remainder explicitly unavailable. Rows are filled session-by-session in `seq` order —
 * each record consumes the next assistant row that still lacks model AND input AND
 * output tokens, mirroring the vendor log's step order. Enriched rows get the derived
 * cost (shared model pricing); rows the vendor never attributions keep NULL columns and
 * receive {@link AGY_USAGE_UNAVAILABLE_DISPOSITION} — empty strings never enter the DB.
 *
 * Idempotent: already-enriched rows are skipped by the NULL guard; a second pass
 * re-marks nothing because `usage-unavailable` rows fail the same NULL guard's
 * disposition filter.
 */
export async function enrichAntigravityUsage(
    db: DbAdapter,
    records: readonly AntigravityUsageRecord[],
): Promise<AntigravityEnrichmentResult> {
    let messagesEnriched = 0;
    let messagesUnavailable = 0;
    for (const record of records) {
        const target = await db.queryFirst<{ record_hash: string }>(
            `SELECT record_hash FROM history_message
             WHERE ${AGY_SOURCE_FILTER} AND session_id = ? AND role = 'assistant'
               AND model IS NULL AND input_tokens IS NULL AND output_tokens IS NULL
               AND disposition NOT IN (?, ?, ?)
             ORDER BY seq, rowid LIMIT 1`,
            ...AGY_SOURCE_PARAMS,
            record.sessionId,
            'meta',
            POLL_DUPLICATE_DISPOSITION,
            AGY_USAGE_UNAVAILABLE_DISPOSITION,
        );
        if (target === undefined) continue;
        const priced = computeRecordCost({
            source: AGY_SOURCES[0],
            date: '',
            model: record.model,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            cacheReadTokens: record.cacheReadTokens ?? 0,
            cacheCreationTokens: record.cacheWriteTokens ?? 0,
            costUsd: 0,
            usageReported: true,
        });
        await db.run(
            `UPDATE history_message
             SET model = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?,
                 cost_usd = ?, disposition = 'keep'
             WHERE record_hash = ?`,
            record.model,
            record.inputTokens,
            record.outputTokens,
            record.cacheReadTokens ?? null,
            record.cacheWriteTokens ?? null,
            priced.costUsd ?? null,
            target.record_hash,
        );
        messagesEnriched += 1;
    }
    // Explicit unavailable disposition (R2): assistant rows the vendor log never
    // attributed, left with NULL usage columns — never empty strings.
    const unavailableWhere = `WHERE ${AGY_SOURCE_FILTER} AND role = 'assistant'
           AND model IS NULL AND input_tokens IS NULL AND output_tokens IS NULL
           AND disposition NOT IN ('meta', '${POLL_DUPLICATE_DISPOSITION}', '${AGY_USAGE_UNAVAILABLE_DISPOSITION}')`;
    messagesUnavailable =
        (
            await db.queryFirst<{ n: number }>(
                `SELECT COUNT(*) AS n FROM history_message ${unavailableWhere}`,
                ...AGY_SOURCE_PARAMS,
            )
        )?.n ?? 0;
    await db.run(
        `UPDATE history_message SET disposition = '${AGY_USAGE_UNAVAILABLE_DISPOSITION}' ${unavailableWhere}`,
        ...AGY_SOURCE_PARAMS,
    );
    return { messagesEnriched, messagesUnavailable, toolCallsBackfilled: 0, emptyDigestsRepaired: 0 };
}

/**
 * Back-fill agy `history_tool_call` rows with vendor-side args (R2). Each record targets
 * the session/seq/tool row whose args are still entirely absent (`args_raw` IS NULL AND
 * `args_digest` IS NULL). A record carrying a real payload writes `args_raw` (canonical
 * JSON) plus its digest; a record whose payload the vendor did not include writes
 * nothing — the NULL pair IS the explicit unavailable form, and the loop query already
 * excludes NULL digests. Idempotent by the same NULL guard.
 */
export async function enrichAntigravityToolArgs(
    db: DbAdapter,
    records: readonly AntigravityToolArgsRecord[],
): Promise<number> {
    let backfilled = 0;
    for (const record of records) {
        if (record.args === null || record.args === undefined) continue;
        const digest = digestArgs(record.args);
        if (digest === null) continue;
        const hit = await db.queryFirst<{ record_hash: string }>(
            `SELECT record_hash FROM history_tool_call
             WHERE ${AGY_SOURCE_FILTER} AND session_id = ? AND seq = ? AND tool_name = ?
               AND args_raw IS NULL AND args_digest IS NULL
             LIMIT 1`,
            ...AGY_SOURCE_PARAMS,
            record.sessionId,
            record.seq,
            record.toolName,
        );
        if (hit === undefined) continue;
        await db.run(
            'UPDATE history_tool_call SET args_raw = ?, args_digest = ? WHERE record_hash = ?',
            JSON.stringify(record.args),
            digest,
            hit.record_hash,
        );
        backfilled += 1;
    }
    return backfilled;
}

/**
 * Rewrite empty-string agy arg digests to the NULL unavailable sentinel (R2 root-cause
 * removal for the loop-detector false-fire): a digest of nothing is not identity, it is
 * absence, and the loop query's `args_digest <> ''` guard already treats NULL as absent.
 * Returns the number of rows repaired. Idempotent (second pass matches nothing).
 */
export async function repairEmptyArgDigests(db: DbAdapter): Promise<number> {
    const hits = await db.queryAll<{ record_hash: string }>(
        `SELECT record_hash FROM history_tool_call
         WHERE ${AGY_SOURCE_FILTER} AND args_digest = ''`,
        ...AGY_SOURCE_PARAMS,
    );
    for (const hit of hits) {
        await db.run('UPDATE history_tool_call SET args_digest = NULL WHERE record_hash = ?', hit.record_hash);
    }
    return hits.length;
}

/** One assistant row projected out of {@link collapsePollDuplicates}'s session scan. */
interface PollScanRow {
    readonly record_hash: string;
    readonly session_id: string;
    readonly content_text: string | null;
}

/**
 * Collapse verbatim-duplicate consecutive assistant messages (R3). Within each session,
 * a maximal run of adjacent rows (ordered by `seq`, then insert order) with the same
 * normalized `content_text` (trimmed, internal whitespace collapsed — trailing-newline
 * jitter must not defeat the verbatim comparison) keeps its FIRST row untouched and
 * re-dispositions the rest to {@link POLL_DUPLICATE_DISPOSITION} — the excluded marker
 * downstream aggregators filter out of loop and latency denominators. The representative
 * row's content is never rewritten (no repeat-count column exists; the excluded
 * disposition is the R3 contract). NULL/empty texts never collapse (nothing verbatim to
 * compare). Idempotent: rows already carrying the marker are invisible to the scan.
 */
export async function collapsePollDuplicates(db: DbAdapter): Promise<PollDuplicateCollapse> {
    const rows = await db.queryAll<PollScanRow>(
        `SELECT record_hash, session_id, content_text
         FROM history_message
         WHERE role = 'assistant' AND disposition NOT IN (?, ?)
         ORDER BY session_id, seq, rowid`,
        'meta',
        POLL_DUPLICATE_DISPOSITION,
    );
    const normalize = (raw: string): string => raw.trim().replace(/\s+/g, ' ');
    const toMark: string[] = [];
    const sessionsWithDuplicates = new Set<string>();
    let currentSession: string | null = null;
    let currentText: string | null = null;
    for (const row of rows) {
        const text =
            typeof row.content_text === 'string' && row.content_text.length > 0 ? normalize(row.content_text) : null;
        const contiguous = text !== null && row.session_id === currentSession && text === currentText;
        if (!contiguous) {
            currentSession = row.session_id;
            currentText = text;
            continue;
        }
        toMark.push(row.record_hash);
        sessionsWithDuplicates.add(row.session_id);
    }
    for (const recordHash of toMark) {
        await db.run(
            'UPDATE history_message SET disposition = ? WHERE record_hash = ?',
            POLL_DUPLICATE_DISPOSITION,
            recordHash,
        );
    }
    return { sessions: sessionsWithDuplicates.size, duplicatesMarked: toMark.length };
}
