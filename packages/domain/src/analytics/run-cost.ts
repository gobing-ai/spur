import type { DbAdapter } from '@gobing-ai/ts-db';
import { RunSessionDao } from '../dao/run-session-dao';
import { cacheHitRatio } from './costs';
import type { CostRecord, TokenTotals } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal `action_runs` row shape needed for the session-mapping join. */
export interface ActionRunCostRow {
    id: string;
    kind: string;
    started_at: string | null;
    completed_at: string | null;
}

/** Per-action cost computed from mapped history_message token columns. */
export interface ActionCost {
    /** Aggregated token totals across all matched history_message rows. */
    totals: TokenTotals;
    /** Cache-hit ratio in [0,1], or null when unavailable (0281/0284 invariant). */
    cacheHit: number | null;
    /** True when the figures came from estimated (retroactive) run→session mappings. */
    estimated: boolean;
}

/**
 * Cost attribution for one workflow action, split by mapping exactness (R2).
 * Exact and estimated figures are never summed into one number — the operator
 * can only weigh an estimated total if it is reported apart from an observed one.
 */
export interface ActionCostAttribution {
    /** Figures from `exact` run→session mappings (task 0557 observed/supplied). */
    exact: ActionCost | null;
    /** Figures from `estimated` mappings (task 0558 retroactive correlation). */
    estimated: ActionCost | null;
}

// ---------------------------------------------------------------------------
// Attribution (R1: history_message typed columns via the run→session mapping)
// ---------------------------------------------------------------------------

/**
 * Attribute token usage to a workflow action from `history_message`'s typed
 * token columns, joined through the `history_run_session` mapping (feature E6):
 * the action's run id → mapped (source, session_id) pairs → their message rows.
 *
 * Exact and estimated mappings are folded separately and returned apart (R2);
 * a class with no mappings or no matching rows is `null`. Absent tables read as
 * empty (unmigrated DB / missing history plane), never throw — best-effort like
 * the rest of the trace path. No dollar figure is computed anywhere (R3):
 * `history_message.cost_usd` and the pricing tables stay unread.
 *
 * `ponytail:` figures are narrowed to the action's [started_at, completed_at]
 * window when both bounds exist; a bound-less action takes the whole mapped
 * session. Per-message attribution inside a shared session (multi-step
 * workflows resuming one session) would need per-message run stamps — add when
 * a step-level breakdown is requested.
 */
export async function attributeActionCost(
    db: DbAdapter,
    runId: string,
    action: ActionRunCostRow,
): Promise<ActionCostAttribution> {
    const mappings = await new RunSessionDao(db).getByRunId(runId);
    const [exact, estimated] = await Promise.all([
        foldMappedSessions(db, mappings, action, 'exact'),
        foldMappedSessions(db, mappings, action, 'estimated'),
    ]);
    return {
        exact: exact === null ? null : actionCost(exact),
        estimated: estimated === null ? null : actionCostEstimated(estimated),
    };
}

/** Fold the typed token columns of every mapped session of one exactness class. */
async function foldMappedSessions(
    db: DbAdapter,
    mappings: readonly { source: string; session_id: string | null; exactness: string }[],
    action: ActionRunCostRow,
    exactness: 'exact' | 'estimated',
): Promise<TokenTotals | null> {
    const mapped = mappings.filter((m) => m.session_id !== null && m.exactness === exactness);
    if (mapped.length === 0) return null;

    const totals = emptyTotals();
    let matchedAny = false;
    for (const m of mapped) {
        const windowed = action.started_at !== null && action.completed_at !== null ? 'AND ts >= ? AND ts <= ?' : '';
        const params: unknown[] = [m.source, m.session_id];
        if (windowed !== '') params.push(action.started_at, action.completed_at);
        let row: MessageTokenRow | undefined;
        try {
            row = await db.queryFirst<MessageTokenRow>(
                `SELECT COUNT(*) AS records,
                        SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL THEN 1 ELSE 0 END)
                            AS recordsWithUsage,
                        COALESCE(SUM(input_tokens), 0) AS inputTokens,
                        COALESCE(SUM(output_tokens), 0) AS outputTokens,
                        COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
                        COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens
                 FROM history_message
                 WHERE source = ? AND session_id = ? ${windowed}`,
                ...params,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_message')) return null;
            throw error;
        }
        if (row === undefined || row.records === 0) continue;
        matchedAny = true;
        totals.records += row.records;
        totals.recordsWithUsage += row.recordsWithUsage;
        // The typed `input_tokens` column excludes cache; the billed total is the
        // sum — the TokenTotals.inputTokens contract ("cache reads and writes
        // included") and the cache-hit denominator.
        totals.inputTokens += row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens;
        totals.outputTokens += row.outputTokens;
        totals.cacheReadTokens += row.cacheReadTokens;
        totals.cacheWriteTokens += row.cacheWriteTokens;
        totals.messages += row.records;

        // Task 0564 R2: fold the mapped session's tool-call rows so the duration
        // buckets carry real values instead of the emptyTotals() zeros they were
        // structurally stuck at. Session-scoped (no window — history_tool_call has
        // no ts column; the duration columns are the tool's own measurement). A
        // missing history_tool_call table (unmigrated DB) degrades to zeros, never
        // throws — same best-effort as the message fold. NOTE: this fold is only
        // observable once the RESOLVED importer version carries the 0564 R1
        // duration attach; until then it reads NULLs and reports honest zeros.
        let toolRow: ToolCallRow | undefined;
        try {
            toolRow = await db.queryFirst<ToolCallRow>(
                `SELECT COUNT(*) AS toolCalls,
                        COALESCE(SUM(duration_ms), 0) AS durationMs,
                        SUM(CASE WHEN duration_ms IS NULL THEN 1 ELSE 0 END) AS durationUnmeasured
                 FROM history_tool_call
                 WHERE source = ? AND session_id = ?`,
                m.source,
                m.session_id,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_tool_call')) {
                toolRow = undefined;
            } else {
                throw error;
            }
        }
        if (toolRow !== undefined && toolRow !== null) {
            totals.toolCalls += toolRow.toolCalls;
            totals.durationMs += toolRow.durationMs;
            totals.durationUnmeasured += toolRow.durationUnmeasured;
        }
    }
    return matchedAny ? totals : null;
}

/** One aggregated history_message token row for a mapped (source, session_id). */
interface MessageTokenRow {
    records: number;
    recordsWithUsage: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

/** One aggregated history_tool_call row for a mapped (source, session_id). */
interface ToolCallRow {
    toolCalls: number;
    durationMs: number;
    durationUnmeasured: number;
}

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

/**
 * Build an exact {@link ActionCost} from folded token totals. The caller folds
 * typed `history_message` columns; no pricing is applied (R3) — `costUsd` stays
 * 0 and the renderer never emits a currency figure.
 */
export function actionCost(totals: TokenTotals): ActionCost {
    return { totals, cacheHit: cacheHitRatio(totals), estimated: false };
}

/**
 * Variant of {@link actionCost} marking the result as estimated (R2): the
 * figures came from retroactive (task 0558) mappings, never an exact join.
 */
export function actionCostEstimated(totals: TokenTotals): ActionCost {
    return { totals, cacheHit: cacheHitRatio(totals), estimated: true };
}

/**
 * Fold priced cost records into a {@link TokenTotals} bucket. Retained for
 * dependent consumers (task 0547) and the analyze rollup; run-cost attribution
 * folds SQL rows directly and never builds intermediate `CostRecord`s (the ETL
 * path was retired — task 0559, R4).
 */
export function foldTotals(records: readonly CostRecord[]): TokenTotals {
    const totals: TokenTotals = emptyTotals();
    for (const record of records) {
        totals.inputTokens += record.inputTokens;
        totals.outputTokens += record.outputTokens;
        totals.cacheReadTokens += record.cacheReadTokens;
        totals.cacheWriteTokens += record.cacheCreationTokens;
        totals.costUsd += record.costUsd;
        totals.records += 1;
        if (record.usageReported) totals.recordsWithUsage += 1;
    }
    return totals;
}

function emptyTotals(): TokenTotals {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
        messages: 0,
        toolCalls: 0,
        durationMs: 0,
        durationUnmeasured: 0,
    };
}
