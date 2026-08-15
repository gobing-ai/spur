import type { DbAdapter } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from './artifact';
import { buildMessageWhereClauses } from './forensic-query';

/**
 * Watermark policy for still-appending sessions (task 0550).
 *
 * A refresh fires on work completion while the agent that just completed the task is
 * still running, so its session file is append-only growing and the import sees a
 * partial session. The watermark is the **last complete turn**: derived values are
 * computed only up to a turn-closing message, and a session whose trailing turn is
 * not yet closed is marked `in-progress` rather than final.
 *
 * A message closes a turn iff it is an assistant message (non-meta) with **no open
 * tool call** — the agent's final response for that turn. Everything after the last
 * turn-closing message belongs to a possibly-incomplete trailing turn and is excluded
 * from analysis. Where "complete" is ambiguous for a source (no tool-call rows to
 * inspect), the source cannot see an open tool call, so the rule degrades to
 * "last message is an assistant message" — never a guess about turn structure.
 */

/** Completeness state of a session on the analyze output (R2). */
export type SessionState = 'in-progress' | 'complete';

/** Per-session watermark result (R1/R2). */
export interface SessionWatermark {
    sessionId: string;
    source: string;
    state: SessionState;
    /**
     * Highest `seq` a consumer may include. Rows above this belong to a trailing
     * partial turn. For complete sessions this equals the session's max seq (nothing
     * is excluded, trailing meta records included — no behavior change). For
     * in-progress sessions it is the last turn-closing message's seq, or -1 when the
     * session has no complete turn at all (everything is the trailing turn).
     */
    watermarkSeq: number;
}

/**
 * SQL fragment appended to a message `WHERE` clause (alias `m`) to exclude the
 * trailing partial turn of in-progress sessions. `sql` is empty when nothing is
 * excluded — callers skip the append entirely.
 */
export interface WatermarkFilter {
    sql: string;
    params: unknown[];
}

/** Query options accepted by the forensic queries (each maps to a `WatermarkFilter`). */
export interface WatermarkQueryOptions {
    watermark?: WatermarkFilter;
}

/** Row of the last-meaningful-message query. */
interface LastMessageRow {
    sessionId: string;
    source: string;
    seq: number;
    role: string;
    hasToolCall: boolean;
}

/** Row of the turn-closer query. */
interface TurnCloserRow {
    sessionId: string;
    source: string;
    watermarkSeq: number;
}

/** Row of the per-session max-seq query. */
interface MaxSeqRow {
    sessionId: string;
    source: string;
    maxSeq: number;
}

const KEY = (sessionId: string, source: string): string => `${sessionId}\0${source}`;

/**
 * Compute the watermark for every session in the selector's scope. Runs three bounded
 * queries (each GROUP BY session — the R2 invariant, never corpus-sized) and combines
 * them in JS:
 *
 * 1. **Last meaningful message** per session (last non-meta message) + whether it has
 *    an open tool call. An assistant message with no tool call closes its turn.
 * 2. **Turn closers** per session: max `seq` of assistant non-meta messages with no
 *    tool call — the watermark boundary.
 * 3. **Max seq** per session (all messages) — used so complete sessions keep every
 *    row (no behavior change), while in-progress sessions truncate at the last closer.
 */
export async function sessionWatermarks(db: DbAdapter, sel: ArtifactSelector): Promise<SessionWatermark[]> {
    const { clauses, params } = buildMessageWhereClauses(sel, 'm');
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const m2Clauses = buildMessageWhereClauses(sel, 'm2').clauses;
    const m2Where = m2Clauses.length > 0 ? ` AND ${m2Clauses.join(' AND ')}` : '';

    const [lastRows, closerRows, maxRows] = await Promise.all([
        db.queryAll<LastMessageRow>(
            `SELECT m.session_id AS sessionId, m.source AS source, m.seq AS seq, m.role AS role,
                    EXISTS(SELECT 1 FROM history_tool_call tc WHERE tc.message_hash = m.record_hash) AS hasToolCall
             FROM history_message m
             ${where}${where !== '' ? ' AND' : ' WHERE'} m.disposition != 'meta'
               AND (m.session_id, m.source, m.seq) IN (
                    SELECT m2.session_id, m2.source, MAX(m2.seq)
                    FROM history_message m2
                    WHERE m2.disposition != 'meta'${m2Where}
                    GROUP BY m2.session_id, m2.source
               )`,
            ...params,
            ...params,
        ),
        db.queryAll<TurnCloserRow>(
            `SELECT m.session_id AS sessionId, m.source AS source, MAX(m.seq) AS watermarkSeq
             FROM history_message m
             ${where}${where !== '' ? ' AND' : ' WHERE'} m.role = 'assistant' AND m.disposition != 'meta'
               AND NOT EXISTS (SELECT 1 FROM history_tool_call tc WHERE tc.message_hash = m.record_hash)
             GROUP BY m.session_id, m.source`,
            ...params,
        ),
        db.queryAll<MaxSeqRow>(
            `SELECT m.session_id AS sessionId, m.source AS source, MAX(m.seq) AS maxSeq
             FROM history_message m
             ${where}
             GROUP BY m.session_id, m.source`,
            ...params,
        ),
    ]);

    const lastByKey = new Map<string, LastMessageRow>();
    for (const row of lastRows) lastByKey.set(KEY(row.sessionId, row.source), row);
    const closerByKey = new Map<string, number>();
    for (const row of closerRows) closerByKey.set(KEY(row.sessionId, row.source), row.watermarkSeq);

    const result: SessionWatermark[] = [];
    for (const row of maxRows) {
        const key = KEY(row.sessionId, row.source);
        const last = lastByKey.get(key);
        // Degrade rule (documented above): a source with no tool-call rows cannot see an open
        // tool call, so the completeness predicate is "last message is assistant-like with no
        // open tool call". The role label is unreliable — the claude mapper writes 'unknown'
        // for role-less messages and imported rows commonly lack a role — so assistant-like
        // includes 'unknown'/missing. A trailing user message is a real unanswered turn and
        // stays in-progress.
        const complete =
            last !== undefined &&
            !last.hasToolCall &&
            (last.role === 'assistant' ||
                last.role === undefined ||
                last.role === null ||
                last.role === '' ||
                last.role === 'unknown');
        const watermarkSeq = complete ? row.maxSeq : (closerByKey.get(key) ?? -1);
        result.push({
            sessionId: row.sessionId,
            source: row.source,
            state: complete ? 'complete' : 'in-progress',
            watermarkSeq,
        });
    }
    return result;
}

/**
 * Turn the watermark results into a SQL filter that excludes the trailing partial
 * turn of in-progress sessions. Applies to every query that reads messages (alias `m`).
 * Complete sessions contribute no condition — their data is untouched.
 */
export function buildWatermarkFilter(watermarks: readonly SessionWatermark[]): WatermarkFilter {
    const inProgress = watermarks.filter((w) => w.state === 'in-progress');
    if (inProgress.length === 0) return { sql: '', params: [] };
    const conditions: string[] = [];
    const params: unknown[] = [];
    for (const w of inProgress) {
        conditions.push('(m.session_id = ? AND m.source = ? AND m.seq > ?)');
        params.push(w.sessionId, w.source, w.watermarkSeq);
    }
    return { sql: `NOT (${conditions.join(' OR ')})`, params };
}

/**
 * Merge a watermark filter into a `buildMessageWhere` result. Returns the combined
 * `WHERE` clause and the filter's params (appended after the selector's). An empty
 * filter returns the clause unchanged with no extra params.
 */
export function applyWatermarkToWhere(
    where: string,
    wm: WatermarkFilter | undefined,
): { where: string; params: unknown[] } {
    if (wm === undefined || wm.sql === '') return { where, params: [] };
    const combined = where === '' ? `WHERE ${wm.sql}` : `${where} AND ${wm.sql}`;
    return { where: combined, params: wm.params };
}

/** Data window the analyze covered (R4): MIN/MAX message `ts` in the selector's scope. */
export async function dataWindow(
    db: DbAdapter,
    sel: ArtifactSelector,
): Promise<{ since: string | null; until: string | null }> {
    const { clauses, params } = buildMessageWhereClauses(sel, 'm');
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const row = await db.queryFirst<{ since: string | null; until: string | null }>(
        `SELECT MIN(m.ts) AS since, MAX(m.ts) AS until FROM history_message m ${where}`,
        ...params,
    );
    return { since: row?.since ?? null, until: row?.until ?? null };
}
