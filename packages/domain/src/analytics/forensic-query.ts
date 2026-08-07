import type { DbAdapter } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from './artifact';

/**
 * Forensic SQL over `history_message` / `history_tool_call` (0464 R1). Sole owner of
 * the query SQL.
 *
 * **R2 structural invariant — no code path may materialize the corpus.** Every query here
 * is a `GROUP BY` whose result is bounded by the selector or by `LIMIT ?`. There is
 * deliberately no bare `SELECT ... FROM history_message`; if a reviewer can point at an
 * array whose length grows with the row count, R2 has failed.
 *
 * Tool-call queries join to `history_message` (via `message_hash`) because the message
 * columns are where the six selectors live (`ts`, `source`, `session_id`, `run_id`,
 * `task_wbs`); a `history_tool_call` row alone cannot resolve `--since`/`--run`/`--task`.
 */

/** Message-side aggregate per (source, model, day) — Q8 re-expressed, plus coverage fodder. */
export interface MessageRollupRow {
    source: string;
    model: string | null;
    day: string | null;
    messages: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    costUsd: number | null;
    recordsWithUsage: number;
}

/** Tool-call aggregate per (source, model, day) — the duration side of the rollup. */
export interface ToolRollupRow {
    source: string;
    model: string | null;
    day: string | null;
    toolCalls: number;
    durationMs: number | null;
    durationUnmeasured: number;
}

/** Per-tool forensic stat — Q1 + Q3/Q6 combined. */
export interface ToolStatRow {
    toolName: string;
    calls: number;
    errors: number;
    durationMsTotal: number | null;
    durationMsMean: number | null;
    durationMsMax: number | null;
    durationUnmeasured: number;
    resultBytes: number | null;
}

/** Per-session leaderboard entry — Q5. */
export interface SessionRow {
    sessionId: string;
    source: string;
    startedAt: string | null;
    messages: number;
    toolCalls: number;
    tokens: number | null;
    costUsd: number | null;
    topTool: string | null;
}

/** Repeated-call loop finding — Q4 (`args_digest` repeated >= 3 times). */
export interface LoopRow {
    sessionId: string;
    toolName: string;
    argsDigest: string;
    repeats: number;
    firstSeq: number;
    lastSeq: number;
}

/** Unknown-disposition drift count — Q10. */
export interface DriftRow {
    source: string;
    recordType: string;
    n: number;
}

/** Per-source coverage fodder (files, messages, last import time). */
export interface SourceSummaryRow {
    source: string;
    files: number;
    messages: number;
    lastImportedAt: string | null;
}

/**
 * Build the `WHERE` clause (and params) for the six composable selectors against
 * `history_message` (aliased `m`). Selectors compose as `AND` — narrowing, never widening.
 * `null` means "no predicate" for that axis; an empty/`null` source list means no source filter.
 */
export function buildMessageWhere(sel: ArtifactSelector): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since != null) {
        clauses.push('m.ts >= ?');
        params.push(sel.since);
    }
    if (sel.until != null) {
        clauses.push('m.ts <= ?');
        params.push(sel.until);
    }
    if (sel.sources != null && sel.sources.length > 0) {
        clauses.push(`m.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.sessionId != null) {
        clauses.push('m.session_id = ?');
        params.push(sel.sessionId);
    }
    if (sel.runId != null) {
        clauses.push('m.run_id = ?');
        params.push(sel.runId);
    }
    if (sel.taskWbs != null) {
        clauses.push('m.task_wbs = ?');
        params.push(sel.taskWbs);
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Message-side spend rollup (Q8) grouped by source, model, and day. */
export async function messageRollup(db: DbAdapter, sel: ArtifactSelector): Promise<MessageRollupRow[]> {
    const { where, params } = buildMessageWhere(sel);
    return db.queryAll<MessageRollupRow>(
        `SELECT m.source AS source, m.model AS model, DATE(m.ts) AS day,
                COUNT(*) AS messages,
                SUM(m.input_tokens) AS inputTokens,
                SUM(m.output_tokens) AS outputTokens,
                SUM(m.cache_read_tokens) AS cacheReadTokens,
                SUM(m.cache_write_tokens) AS cacheWriteTokens,
                SUM(m.cost_usd) AS costUsd,
                SUM(CASE WHEN m.input_tokens IS NOT NULL OR m.output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS recordsWithUsage
         FROM history_message m
         ${where}
         GROUP BY m.source, m.model, DATE(m.ts)`,
        ...params,
    );
}

/** Tool-call rollup per (source, model, day) — the duration/toolCall side of the buckets. */
export async function toolRollup(db: DbAdapter, sel: ArtifactSelector): Promise<ToolRollupRow[]> {
    const { where, params } = buildMessageWhere(sel);
    return db.queryAll<ToolRollupRow>(
        `SELECT m.source AS source, m.model AS model, DATE(m.ts) AS day,
                COUNT(*) AS toolCalls,
                SUM(tc.duration_ms) AS durationMs,
                SUM(tc.duration_ms IS NULL) AS durationUnmeasured
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${where}
         GROUP BY m.source, m.model, DATE(m.ts)`,
        ...params,
    );
}

/** Per-tool forensic stats (Q1 time + Q3/Q6 calls/errors), bounded by `top`. */
export async function byTool(db: DbAdapter, sel: ArtifactSelector, top: number): Promise<ToolStatRow[]> {
    const { where, params } = buildMessageWhere(sel);
    return db.queryAll<ToolStatRow>(
        `SELECT tc.tool_name AS toolName,
                COUNT(*) AS calls,
                SUM(tc.status = 'error') AS errors,
                SUM(tc.duration_ms) AS durationMsTotal,
                CAST(AVG(tc.duration_ms) AS INT) AS durationMsMean,
                MAX(tc.duration_ms) AS durationMsMax,
                SUM(tc.duration_ms IS NULL) AS durationUnmeasured,
                SUM(tc.result_bytes) AS resultBytes
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${where}
         GROUP BY tc.tool_name
         ORDER BY durationMsTotal DESC
         LIMIT ?`,
        ...params,
        top,
    );
}

/** Per-session leaderboard (Q5), bounded by `top`. */
export async function bySession(db: DbAdapter, sel: ArtifactSelector, top: number): Promise<SessionRow[]> {
    const { where, params } = buildMessageWhere(sel);
    return db.queryAll<SessionRow>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                MIN(m.ts) AS startedAt,
                COUNT(*) AS messages,
                (SELECT COUNT(*) FROM history_tool_call tc
                  WHERE tc.session_id = m.session_id AND tc.source = m.source) AS toolCalls,
                (SELECT tc2.tool_name FROM history_tool_call tc2
                  WHERE tc2.session_id = m.session_id AND tc2.source = m.source
                  GROUP BY tc2.tool_name ORDER BY COUNT(*) DESC, tc2.tool_name LIMIT 1) AS topTool,
                SUM(m.input_tokens + m.output_tokens) AS tokens,
                SUM(m.cost_usd) AS costUsd
         FROM history_message m
         ${where}
         GROUP BY m.session_id, m.source
         ORDER BY tokens DESC
         LIMIT ?`,
        ...params,
        top,
    );
}

/** Repeated-call loop findings (Q4): same args_digest repeated >= 3 times. */
export async function loops(db: DbAdapter, sel: ArtifactSelector): Promise<LoopRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const extra = where === '' ? 'WHERE tc.args_digest IS NOT NULL' : `${where} AND tc.args_digest IS NOT NULL`;
    return db.queryAll<LoopRow>(
        `SELECT tc.session_id AS sessionId, tc.tool_name AS toolName,
                tc.args_digest AS argsDigest,
                COUNT(*) AS repeats,
                MIN(tc.seq) AS firstSeq,
                MAX(tc.seq) AS lastSeq
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${extra}
         GROUP BY tc.session_id, tc.tool_name, tc.args_digest
         HAVING COUNT(*) >= 3
         ORDER BY repeats DESC`,
        ...params,
    );
}

/** Unknown-disposition drift counts (Q10) per source and record_type. */
export async function drift(db: DbAdapter, sel: ArtifactSelector): Promise<DriftRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const extra = where === '' ? "WHERE m.disposition = 'unknown'" : `${where} AND m.disposition = 'unknown'`;
    return db.queryAll<DriftRow>(
        `SELECT m.source AS source, m.record_type AS recordType, COUNT(*) AS n
         FROM history_message m
         ${extra}
         GROUP BY m.source, m.record_type
         ORDER BY n DESC`,
        ...params,
    );
}

/** Per-source coverage fodder: files, message count, last import time. */
export async function sourceSummary(db: DbAdapter, sel: ArtifactSelector): Promise<SourceSummaryRow[]> {
    const { where, params } = buildMessageWhere(sel);
    return db.queryAll<SourceSummaryRow>(
        `SELECT m.source AS source,
                COUNT(DISTINCT m.source_file) AS files,
                COUNT(*) AS messages,
                MAX(m.imported_at) AS lastImportedAt
         FROM history_message m
         ${where}
         GROUP BY m.source`,
        ...params,
    );
}
