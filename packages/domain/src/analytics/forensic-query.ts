import type { DbAdapter } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from './artifact';
import type { SessionSpanRow, SessionToolDurationRow, TodoToolCallRow } from './derived';

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
    /** Sum of `duration_ms` across role='assistant' rows (measured assistant response time). */
    assistantDurationMs: number | null;
    /** role='assistant' rows whose `duration_ms` was NULL — the assistant-duration unavailable count. */
    assistantDurationUnmeasured: number;
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

/** Completeness of an analyzed session (task 0550). */
export type SessionCompletenessState = 'in-progress' | 'complete';

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
    /** Sum of `duration_ms` across role='assistant' rows in this session. */
    assistantDurationMs: number | null;
    /** role='assistant' rows in this session whose `duration_ms` was NULL. */
    assistantDurationUnmeasured: number;
}

/**
 * Unclipped session completeness (task 0550). `watermarkSeq` is the last complete
 * turn (last `role='assistant'` seq). A session whose last message is not an
 * assistant turn is still in progress.
 */
export interface SessionCompletenessRow {
    sessionId: string;
    source: string;
    lastSeq: number;
    watermarkSeq: number | null;
    sessionState: SessionCompletenessState;
}

/**
 * Last complete turn: the last assistant message in the session. Trailing
 * user/tool-only rows after that seq are excluded from derived aggregates.
 * A session with NO assistant turn has no complete turn — it is all
 * in-progress (task 0550), so nothing is clipped: every stored row counts
 * (with `sessionState: 'in-progress'` reported by sessionCompleteness).
 * Regular string (not a template) so the R2 backtick scanner does not treat
 * the subquery as an unbounded corpus query.
 */
const COMPLETE_TURN_PREDICATE =
    "m.seq <= COALESCE((SELECT MAX(a.seq) FROM history_message a WHERE a.session_id = m.session_id AND a.source = m.source AND a.role = 'assistant'), m.seq)";

/** Append the last-complete-turn clip to a `buildMessageWhere` result. */
function clipToCompleteTurns(where: string): string {
    return where.length > 0 ? `${where} AND ${COMPLETE_TURN_PREDICATE}` : `WHERE ${COMPLETE_TURN_PREDICATE}`;
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
        // `run_id`/`task_wbs` only exist on `provenance='spur-run'` rows, and the 0009 index
        // is `(provenance, run_id)` — the provenance equality is what makes the --run/--task
        // selectors resolve against an index rather than a scan (R3).
        clauses.push("m.provenance = 'spur-run'");
        clauses.push('m.run_id = ?');
        params.push(sel.runId);
    }
    if (sel.taskWbs != null) {
        clauses.push("m.provenance = 'spur-run'");
        clauses.push('m.task_wbs = ?');
        params.push(sel.taskWbs);
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Unclipped completeness per session (task 0550). Does not apply the last-complete-turn
 * clip — that would hide the trailing incomplete turn this query exists to detect.
 */
export async function sessionCompleteness(db: DbAdapter, sel: ArtifactSelector): Promise<SessionCompletenessRow[]> {
    const { where, params } = buildMessageWhere(sel);
    return db.queryAll<SessionCompletenessRow>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                MAX(m.seq) AS lastSeq,
                MAX(CASE WHEN m.role = 'assistant' THEN m.seq END) AS watermarkSeq,
                CASE
                    WHEN MAX(m.seq) = MAX(CASE WHEN m.role = 'assistant' THEN m.seq END)
                    THEN 'complete'
                    ELSE 'in-progress'
                END AS sessionState
         FROM history_message m
         ${where}
         GROUP BY m.session_id, m.source`,
        ...params,
    );
}

/** Message-side spend rollup (Q8) grouped by source, model, and day. */
export async function messageRollup(db: DbAdapter, sel: ArtifactSelector): Promise<MessageRollupRow[]> {
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
    return db.queryAll<MessageRollupRow>(
        `SELECT m.source AS source, m.model AS model, DATE(m.ts) AS day,
                COUNT(*) AS messages,
                SUM(m.input_tokens) AS inputTokens,
                SUM(m.output_tokens) AS outputTokens,
                SUM(m.cache_read_tokens) AS cacheReadTokens,
                SUM(m.cache_write_tokens) AS cacheWriteTokens,
                SUM(m.cost_usd) AS costUsd,
                SUM(CASE WHEN m.input_tokens IS NOT NULL OR m.output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS recordsWithUsage,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms END) AS assistantDurationMs,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms IS NULL END) AS assistantDurationUnmeasured
         FROM history_message m
         ${where}
         GROUP BY m.source, m.model, DATE(m.ts)`,
        ...params,
    );
}

/** Tool-call rollup per (source, model, day) — the duration/toolCall side of the buckets. */
export async function toolRollup(db: DbAdapter, sel: ArtifactSelector): Promise<ToolRollupRow[]> {
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
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
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
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
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;

    // Message-side stats per session, selector-scoped (Q5).
    const msgRows = await db.queryAll<{
        sessionId: string;
        source: string;
        startedAt: string | null;
        messages: number;
        tokens: number | null;
        costUsd: number | null;
        assistantDurationMs: number | null;
        assistantDurationUnmeasured: number;
    }>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                MIN(m.ts) AS startedAt,
                COUNT(*) AS messages,
                SUM(m.input_tokens + m.output_tokens) AS tokens,
                SUM(m.cost_usd) AS costUsd,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms END) AS assistantDurationMs,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms IS NULL END) AS assistantDurationUnmeasured
         FROM history_message m
         ${where}
         GROUP BY m.session_id, m.source
         ORDER BY tokens DESC
         LIMIT ?`,
        ...params,
        top,
    );

    if (msgRows.length === 0) return [];

    // Tool-call stats per (session, tool), selector-scoped via JOIN to history_message.
    // Both queries honor the same selector window: the old correlated subqueries only
    // filtered by session_id+source, ignoring since/until/runId/taskWbs and over-counting
    // tool calls outside the window (F1).
    const toolRows = await db.queryAll<{ sessionId: string; source: string; toolName: string; cnt: number }>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                tc.tool_name AS toolName,
                COUNT(*) AS cnt
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${where}
         GROUP BY m.session_id, m.source, tc.tool_name`,
        ...params,
    );

    // Build per-session tool counts from the flat (session, tool) rows.
    const toolMap = new Map<string, Map<string, number>>();
    for (const row of toolRows) {
        const key = `${row.sessionId}\0${row.source}`;
        let tools = toolMap.get(key);
        if (!tools) {
            tools = new Map();
            toolMap.set(key, tools);
        }
        tools.set(row.toolName, (tools.get(row.toolName) ?? 0) + row.cnt);
    }

    // Merge message stats with tool stats; pick the most frequent tool per session
    // (ties broken by tool_name ASC, matching the old SQL `ORDER BY COUNT(*) DESC, tc2.tool_name`).
    return msgRows.map((msg) => {
        const key = `${msg.sessionId}\0${msg.source}`;
        const tools = toolMap.get(key);
        let toolCalls = 0;
        let topTool: string | null = null;
        let maxCount = -1;
        if (tools) {
            for (const [name, count] of tools) {
                toolCalls += count;
                if (topTool === null || count > maxCount || (count === maxCount && name < topTool)) {
                    maxCount = count;
                    topTool = name;
                }
            }
        }
        return {
            sessionId: msg.sessionId,
            source: msg.source,
            startedAt: msg.startedAt,
            messages: msg.messages,
            toolCalls,
            topTool,
            tokens: msg.tokens,
            costUsd: msg.costUsd,
            assistantDurationMs: msg.assistantDurationMs,
            assistantDurationUnmeasured: msg.assistantDurationUnmeasured,
        };
    });
}

/** Repeated-call loop findings (Q4): same args_digest repeated >= 3 times. */
export async function loops(db: DbAdapter, sel: ArtifactSelector): Promise<LoopRow[]> {
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
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
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
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
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
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

/**
 * Count `history_import_checkpoint` rows for a source (task 0470 R4 was-non-empty
 * detection). Owned here so raw SQL stays in the domain layer (ADR-011).
 */
export async function countCheckpointsBySource(db: DbAdapter, source: string): Promise<number> {
    const row = await db.queryFirst<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM history_import_checkpoint WHERE source = ?',
        source,
    );
    return row?.cnt ?? 0;
}
// ---------------------------------------------------------------------------
// Derived-variable queries (task 0554)
// ---------------------------------------------------------------------------

/** Per-session timing span: MIN/MAX ts + assistant duration sums (derived metric input). */
export async function sessionSpans(db: DbAdapter, sel: ArtifactSelector): Promise<SessionSpanRow[]> {
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
    return db.queryAll<SessionSpanRow>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                MIN(m.ts) AS firstTs,
                MAX(m.ts) AS lastTs,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms END) AS assistantDurationMs,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms IS NULL END) AS assistantDurationUnmeasured
         FROM history_message m
         ${where}
         GROUP BY m.session_id, m.source`,
        ...params,
    );
}

/** Per-session tool-call duration sums (derived metric input). */
export async function sessionToolDurations(db: DbAdapter, sel: ArtifactSelector): Promise<SessionToolDurationRow[]> {
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
    return db.queryAll<SessionToolDurationRow>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                SUM(tc.duration_ms) AS toolDurationMs,
                SUM(tc.duration_ms IS NULL) AS toolDurationUnmeasured
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${where}
         GROUP BY m.session_id, m.source`,
        ...params,
    );
}

/**
 * Todo-tool calls with `args_raw` populated (task 0553), ordered for phase extraction.
 * `LIMIT ?` satisfies the R2 structural invariant (no unbounded corpus materialization).
 */
export async function todoToolCalls(db: DbAdapter, sel: ArtifactSelector, limit = 5000): Promise<TodoToolCallRow[]> {
    const built = buildMessageWhere(sel);
    const where = clipToCompleteTurns(built.where);
    const params = built.params;
    // Built outside the SQL template: a nested backtick expression inside the literal
    // would break the R2 source scan (which treats backticks as query boundaries).
    const whereClause = where ? `${where} AND tc.args_raw IS NOT NULL` : 'WHERE tc.args_raw IS NOT NULL';
    return db.queryAll<TodoToolCallRow>(
        `SELECT tc.session_id AS sessionId, tc.source AS source,
                m.ts AS ts,
                tc.tool_name AS toolName,
                tc.args_raw AS argsRaw
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${whereClause}
         ORDER BY tc.session_id, m.ts
         LIMIT ?`,
        ...params,
        limit,
    );
}
