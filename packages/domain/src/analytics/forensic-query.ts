import type { DbAdapter } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from './artifact';
import type { SessionSpanRow, SessionToolDurationRow, TodoToolCallRow } from './derived';
import { EFFECTIVE_TOOL_NAME_SQL } from './history-board-rollup';
import { applyWatermarkToWhere, type WatermarkQueryOptions } from './watermark';

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
    billedTokens: number;
}

/** Explicit skill-tool invocation aggregate. */
export interface SkillStatRow {
    skillName: string;
    calls: number;
}

/** Per-session leaderboard entry — Q5. */
export interface SessionRow {
    sessionId: string;
    source: string;
    model: string | null;
    startedAt: string | null;
    endedAt: string | null;
    messages: number;
    toolCalls: number;
    tokens: number | null;
    inputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    topTool: string | null;
    /** Sum of `duration_ms` across role='assistant' rows in this session. */
    assistantDurationMs: number | null;
    /** role='assistant' rows in this session whose `duration_ms` was NULL. */
    assistantDurationUnmeasured: number;
    state: 'complete' | 'in-progress';
}

/** Repeated-call loop finding — Q4 (`args_digest` repeated >= 3 times). */
export interface LoopRow {
    source: string;
    sessionId: string;
    model: string;
    startedAt: string | null;
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

// 0624 R1 re-audit: claude re-emits an assistant message while a response streams;
// the final row (MAX rowid) carries the complete cumulative usage. Keep that row
// once per request_id; unidentified responses stay distinct.
const MESSAGE_DEDUP = `(m.rowid IN (
    SELECT MAX(rowid) FROM history_message WHERE request_id IS NOT NULL GROUP BY request_id
) OR m.request_id IS NULL)`;

function withMessageDedup(where: string): string {
    return where === '' ? `WHERE ${MESSAGE_DEDUP}` : `${where} AND ${MESSAGE_DEDUP}`;
}

function escapeLike(value: string): string {
    return value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
}

/**
 * Selector predicate clauses against `history_message`, parameterized by alias so
 * the watermark queries can reuse the same scope against a second alias (`m2`).
 */
export function buildMessageWhereClauses(
    sel: ArtifactSelector,
    alias: string,
): { clauses: string[]; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since != null) {
        clauses.push(`${alias}.ts >= ?`);
        params.push(sel.since);
    }
    if (sel.until != null) {
        clauses.push(`${alias}.ts <= ?`);
        params.push(sel.until);
    }
    if (sel.sources != null && sel.sources.length > 0) {
        clauses.push(`${alias}.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.models != null && sel.models.length > 0) {
        clauses.push(`${alias}.model IN (${sel.models.map(() => '?').join(', ')})`);
        params.push(...sel.models);
    }
    if (sel.tools != null && sel.tools.length > 0) {
        const validTools = sel.tools.map((t) => (t && t.trim() !== '' ? t.trim() : 'unknown'));
        if (validTools.length > 0) {
            const placeholders = validTools.map(() => '?').join(', ');
            clauses.push(
                'EXISTS (SELECT 1 FROM ' +
                    `history_tool_call tc_filt WHERE tc_filt.message_hash = ${alias}.record_hash AND ${EFFECTIVE_TOOL_NAME_SQL.replace(/tc\./g, 'tc_filt.')} IN (${placeholders}))`,
            );
            params.push(...validTools);
        }
    }
    if (sel.skills != null && sel.skills.length > 0) {
        const validSkills = sel.skills.filter((s) => s && s.trim() !== '' && s !== 'unknown');
        if (validSkills.length > 0) {
            const skillConditions = validSkills.map(
                () => "tc_filt.tool_name LIKE ? ESCAPE '!' OR tc_filt.args_raw LIKE ? ESCAPE '!'",
            );
            clauses.push(
                'EXISTS (SELECT 1 FROM ' +
                    `history_tool_call tc_filt WHERE tc_filt.message_hash = ${alias}.record_hash AND (${skillConditions.join(' OR ')}))`,
            );
            for (const sk of validSkills) {
                const escaped = escapeLike(sk);
                params.push(`%${escaped}%`, `%${escaped}%`);
            }
        }
    }
    if (sel.sessionId != null) {
        clauses.push(`${alias}.session_id = ?`);
        params.push(sel.sessionId);
    }
    if (sel.runId != null && sel.taskWbs != null) {
        clauses.push(
            `EXISTS (
                SELECT 1 FROM history_run_session hrs_scope
                JOIN task_run_links trl_scope ON trl_scope.run_id = hrs_scope.run_id
                WHERE hrs_scope.run_id = ? AND trl_scope.wbs = ?
                  AND hrs_scope.session_id IS NOT NULL
                  AND hrs_scope.source = ${alias}.source
                  AND hrs_scope.session_id = ${alias}.session_id
            )`,
        );
        params.push(sel.runId, sel.taskWbs);
    } else if (sel.runId != null) {
        clauses.push(
            `EXISTS (
                SELECT 1 FROM history_run_session hrs_scope
                WHERE hrs_scope.run_id = ? AND hrs_scope.session_id IS NOT NULL
                  AND hrs_scope.source = ${alias}.source
                  AND hrs_scope.session_id = ${alias}.session_id
            )`,
        );
        params.push(sel.runId);
    } else if (sel.taskWbs != null) {
        // Task 0722 R5: task-only selection matches the union of the established
        // run chain (task_run_links → history_run_session) and the direct
        // import-recovered task↔session authority. Task+run keeps intersection
        // semantics through the real run chain above; unresolved/ambiguous
        // mappings never match (`session_id IS NOT NULL`, and direct rows exist
        // only for locator-validated evidence).
        clauses.push(
            `(
                EXISTS (
                    SELECT 1 FROM task_run_links trl_scope
                    JOIN history_run_session hrs_scope ON hrs_scope.run_id = trl_scope.run_id
                    WHERE trl_scope.wbs = ? AND hrs_scope.session_id IS NOT NULL
                      AND hrs_scope.source = ${alias}.source
                      AND hrs_scope.session_id = ${alias}.session_id
                )
                OR EXISTS (
                    SELECT 1 FROM history_task_session hts_scope
                    WHERE hts_scope.wbs = ?
                      AND hts_scope.source = ${alias}.source
                      AND hts_scope.session_id = ${alias}.session_id
                )
            )`,
        );
        params.push(sel.taskWbs, sel.taskWbs);
    }
    return { clauses, params };
}

/**
 * Build the `WHERE` clause (and params) for the six composable selectors against
 * `history_message` (aliased `m` by default). Selectors compose as `AND` — narrowing,
 * never widening. `null` means "no predicate" for that axis; an empty/`null` source
 * list means no source filter.
 */
export function buildMessageWhere(sel: ArtifactSelector, alias = 'm'): { where: string; params: unknown[] } {
    const { clauses, params } = buildMessageWhereClauses(sel, alias);
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/** Message-side spend rollup (Q8) grouped by source, model, and day. */
export async function messageRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<MessageRollupRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<MessageRollupRow>(
        `WITH filtered AS (
             SELECT m.source, m.model, m.ts, m.input_tokens, m.output_tokens,
                    m.cache_read_tokens, m.cache_write_tokens, m.cost_usd, m.role, m.duration_ms,
                    ROW_NUMBER() OVER (PARTITION BY m.request_id ORDER BY m.rowid DESC) AS rn,
                    m.request_id
             FROM history_message m
             ${wm.where}
         ),
         selected AS (
             SELECT * FROM filtered WHERE request_id IS NULL OR rn = 1
         )
         SELECT source, model, DATE(ts) AS day,
                COUNT(*) AS messages,
                SUM(input_tokens) AS inputTokens,
                SUM(output_tokens) AS outputTokens,
                SUM(cache_read_tokens) AS cacheReadTokens,
                SUM(cache_write_tokens) AS cacheWriteTokens,
                SUM(cost_usd) AS costUsd,
                SUM(CASE WHEN input_tokens IS NOT NULL OR output_tokens IS NOT NULL THEN 1 ELSE 0 END) AS recordsWithUsage,
                SUM(CASE WHEN role = 'assistant' THEN duration_ms END) AS assistantDurationMs,
                SUM(CASE WHEN role = 'assistant' THEN duration_ms IS NULL END) AS assistantDurationUnmeasured
         FROM selected
         GROUP BY source, model, DATE(ts)`,
        ...params,
        ...wm.params,
    );
}

/** Tool-call rollup per (source, model, day) — the duration/toolCall side of the buckets. */
export async function toolRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<ToolRollupRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<ToolRollupRow>(
        `WITH filtered_messages AS (
             SELECT m.record_hash, m.source, m.model, m.ts
             FROM history_message m
             ${wm.where}
         )
         SELECT fm.source AS source, fm.model AS model, DATE(fm.ts) AS day,
                COUNT(*) AS toolCalls,
                SUM(tc.duration_ms) AS durationMs,
                SUM(tc.duration_ms IS NULL) AS durationUnmeasured
         FROM filtered_messages fm
         CROSS JOIN history_tool_call tc ON tc.message_hash = fm.record_hash
         GROUP BY fm.source, fm.model, DATE(fm.ts)`,
        ...params,
        ...wm.params,
    );
}

/** Per-tool forensic stats (Q1 time + Q3/Q6 calls/errors), bounded by `top`. */
export async function byTool(
    db: DbAdapter,
    sel: ArtifactSelector,
    top: number,
    opts?: WatermarkQueryOptions,
): Promise<ToolStatRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<ToolStatRow>(
        `WITH filtered_messages AS (
             SELECT m.record_hash, m.input_tokens, m.output_tokens
             FROM history_message m
             ${wm.where}
         ),
         filtered_tools AS (
             SELECT tc.tool_name, tc.args_raw, tc.call_id, tc.status, tc.duration_ms, tc.result_bytes,
                    fm.input_tokens, fm.output_tokens,
                    COUNT(*) OVER (PARTITION BY tc.message_hash) AS links
             FROM filtered_messages fm
             CROSS JOIN history_tool_call tc ON tc.message_hash = fm.record_hash
         )
         SELECT ${EFFECTIVE_TOOL_NAME_SQL} AS toolName,
                COUNT(*) AS calls,
                SUM(tc.status = 'error') AS errors,
                SUM(tc.duration_ms) AS durationMsTotal,
                CAST(AVG(tc.duration_ms) AS INT) AS durationMsMean,
                MAX(tc.duration_ms) AS durationMsMax,
                SUM(tc.duration_ms IS NULL) AS durationUnmeasured,
                SUM(tc.result_bytes) AS resultBytes,
                ROUND(SUM(CAST(COALESCE(tc.input_tokens, 0) + COALESCE(tc.output_tokens, 0) AS REAL) / tc.links)) AS billedTokens
         FROM filtered_tools tc
         GROUP BY ${EFFECTIVE_TOOL_NAME_SQL}
         ORDER BY durationMsTotal DESC
         LIMIT ?`,
        ...params,
        ...wm.params,
        top,
    );
}

/** Explicit skill invocations extracted from retained Skill tool arguments. */
export async function bySkill(db: DbAdapter, sel: ArtifactSelector, top: number): Promise<SkillStatRow[]> {
    const { where, params } = buildMessageWhere(sel);
    return db.queryAll<SkillStatRow>(
        `WITH filtered_messages AS (
             SELECT m.record_hash
             FROM history_message m
             ${where}
         )
         SELECT ${HISTORY_SKILL_NAME_SQL} AS skillName, COUNT(*) AS calls
         FROM filtered_messages fm
         CROSS JOIN history_tool_call tc ON tc.message_hash = fm.record_hash
         WHERE ${HISTORY_SKILL_NAME_SQL} <> '' AND ${HISTORY_SKILL_NAME_SQL} <> 'unknown'
         GROUP BY skillName ORDER BY calls DESC LIMIT ?`,
        ...params,
        top,
    );
}

/** Per-session leaderboard (Q5), bounded by `top`. */
export async function bySession(
    db: DbAdapter,
    sel: ArtifactSelector,
    top: number,
    opts?: WatermarkQueryOptions,
): Promise<SessionRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    const sessionWhere =
        wm.where === ''
            ? "WHERE m.session_id NOT IN ('', 'unknown', 'session')"
            : `${wm.where} AND m.session_id NOT IN ('', 'unknown', 'session')`;

    const msgRows = await db.queryAll<{
        sessionId: string;
        source: string;
        model: string | null;
        startedAt: string | null;
        endedAt: string | null;
        messages: number;
        tokens: number;
        inputTokens: number;
        cacheReadTokens: number;
        outputTokens: number;
        costUsd: number | null;
        assistantDurationMs: number;
        assistantDurationUnmeasured: number;
        state: 'complete' | 'in-progress';
    }>(
        `WITH filtered AS (
             SELECT m.record_hash, m.ts, m.input_tokens, m.cache_read_tokens, m.output_tokens,
                    m.session_id, m.source, m.model, m.cost_usd, m.role, m.duration_ms,
                    m.rowid AS source_rowid, m.seq, m.disposition,
                    ROW_NUMBER() OVER (PARTITION BY m.request_id ORDER BY m.rowid DESC) AS rn,
                    m.request_id
             FROM history_message m
             ${sessionWhere}
         ),
         selected AS (
             SELECT * FROM filtered WHERE request_id IS NULL OR rn = 1
         ),
         message_stats AS (
             SELECT source, session_id,
                    COALESCE(
                        m.model,
                        MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END)
                            OVER (PARTITION BY m.source, m.session_id),
                        'unknown'
                    ) AS model,
                    MIN(ts) AS started_at, MAX(ts) AS ended_at, COUNT(*) AS messages,
                    SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens,
                    SUM(COALESCE(input_tokens, 0)) AS input_tokens,
                    SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
                    SUM(COALESCE(output_tokens, 0)) AS output_tokens,
                    SUM(cost_usd) AS cost_usd,
                    SUM(CASE WHEN role = 'assistant' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS assistant_duration_ms,
                    SUM(CASE WHEN role = 'assistant' AND duration_ms IS NULL THEN 1 ELSE 0 END) AS assistant_duration_unmeasured
             FROM selected m
             GROUP BY source, session_id
         ), last_messages AS (
             SELECT source, session_id, record_hash, role,
                    ROW_NUMBER() OVER (
                        PARTITION BY source, session_id ORDER BY seq DESC, source_rowid DESC
                    ) AS rank
             FROM selected WHERE disposition != 'meta'
         )
         SELECT ms.session_id AS sessionId, ms.source AS source, ms.model AS model,
                ms.started_at AS startedAt, ms.ended_at AS endedAt, ms.messages AS messages,
                ms.tokens AS tokens,
                ms.input_tokens AS inputTokens, ms.cache_read_tokens AS cacheReadTokens,
                ms.output_tokens AS outputTokens, ms.cost_usd AS costUsd,
                ms.assistant_duration_ms AS assistantDurationMs,
                ms.assistant_duration_unmeasured AS assistantDurationUnmeasured,
                CASE WHEN COALESCE(lm.role, 'unknown') IN ('assistant', 'unknown', '')
                          AND NOT EXISTS (
                              SELECT 1 FROM history_tool_call open_tc WHERE open_tc.message_hash = lm.record_hash
                          )
                     THEN 'complete' ELSE 'in-progress' END AS state
         FROM message_stats ms
         LEFT JOIN last_messages lm ON lm.source = ms.source AND lm.session_id = ms.session_id AND lm.rank = 1
         ORDER BY tokens DESC
         LIMIT ?`,
        ...params,
        ...wm.params,
        top,
    );

    if (msgRows.length === 0) return [];

    // Tool-call stats per (session, tool), scoped to the returned sessions and message watermark so a
    // watermark-filtered query doesn't read unbounded tool calls or count
    // tool calls outside the window (F1).
    const sessionIds = Array.from(new Set(msgRows.map((m) => m.sessionId)));
    const toolRows =
        sessionIds.length === 0
            ? []
            : await db.queryAll<{ sessionId: string; source: string; toolName: string; cnt: number }>(
                  `WITH filtered_messages AS (
             SELECT m.record_hash, m.session_id, m.source
             FROM history_message m
             ${wm.where}${wm.where === '' ? 'WHERE' : ' AND'} m.session_id IN (${sessionIds.map(() => '?').join(',')})
         )
         SELECT fm.session_id AS sessionId, fm.source AS source,
                ${EFFECTIVE_TOOL_NAME_SQL} AS toolName,
                COUNT(*) AS cnt
         FROM filtered_messages fm
         CROSS JOIN history_tool_call tc ON tc.message_hash = fm.record_hash
         GROUP BY fm.session_id, fm.source, ${EFFECTIVE_TOOL_NAME_SQL}`,
                  ...params,
                  ...wm.params,
                  ...sessionIds,
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
                if (
                    topTool === null ||
                    (topTool === 'unknown' && name !== 'unknown') ||
                    (name !== 'unknown' && count > maxCount) ||
                    (name !== 'unknown' && count === maxCount && name < topTool) ||
                    (topTool === 'unknown' && count > maxCount)
                ) {
                    maxCount = count;
                    topTool = name;
                }
            }
        }
        return {
            sessionId: msg.sessionId,
            source: msg.source,
            model: msg.model,
            startedAt: msg.startedAt,
            endedAt: msg.endedAt,
            messages: msg.messages,
            toolCalls,
            topTool,
            tokens: msg.tokens,
            inputTokens: msg.inputTokens,
            cacheReadTokens: msg.cacheReadTokens,
            outputTokens: msg.outputTokens,
            costUsd: msg.costUsd,
            assistantDurationMs: msg.assistantDurationMs,
            assistantDurationUnmeasured: msg.assistantDurationUnmeasured,
            state: msg.state,
        };
    });
}

/**
 * True selection population behind the bounded leaderboards (HA-S1, ADR-080).
 * Unbounded `COUNT(DISTINCT …)` over the same selector the bounded rankings use —
 * never derived from `bySession.length` / `byTool.length` (that reintroduces the
 * exact defect the counts exist to fix). Sessions exclude the same placeholder ids
 * `bySession` filters; tools count distinct tool names over the same join.
 */
export async function selectionPopulation(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<{ sessions: number; tools: number }> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    const sessionWhere =
        wm.where === ''
            ? "WHERE m.session_id NOT IN ('', 'unknown', 'session')"
            : `${wm.where} AND m.session_id NOT IN ('', 'unknown', 'session')`;

    const [sessionRow, toolRow] = await Promise.all([
        db.queryFirst<{ n: number }>(
            `SELECT COUNT(DISTINCT m.session_id) AS n FROM history_message m ${sessionWhere} LIMIT ?`,
            ...params,
            ...wm.params,
            1,
        ),
        db.queryFirst<{ n: number }>(
            `WITH filtered_messages AS (
                 SELECT m.record_hash
                 FROM history_message m
                 ${wm.where}
             )
             SELECT COUNT(DISTINCT tc.tool_name) AS n
             FROM filtered_messages fm
             CROSS JOIN history_tool_call tc ON tc.message_hash = fm.record_hash
             LIMIT ?`,
            ...params,
            ...wm.params,
            1,
        ),
    ]);
    return { sessions: sessionRow?.n ?? 0, tools: toolRow?.n ?? 0 };
}

/** Repeated-call loop findings (Q4): same args_digest repeated >= 3 times. */
export async function loops(db: DbAdapter, sel: ArtifactSelector, opts?: WatermarkQueryOptions): Promise<LoopRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<LoopRow>(
        `WITH filtered_messages AS (
             SELECT m.record_hash, m.source, m.model, m.ts
             FROM history_message m
             ${wm.where}
         )
         SELECT fm.source AS source, tc.session_id AS sessionId,
                COALESCE(MAX(fm.model), 'unknown') AS model, MIN(fm.ts) AS startedAt,
                tc.tool_name AS toolName,
                tc.args_digest AS argsDigest,
                COUNT(*) AS repeats,
                MIN(tc.seq) AS firstSeq,
                MAX(tc.seq) AS lastSeq
         FROM filtered_messages fm
         CROSS JOIN history_tool_call tc ON tc.message_hash = fm.record_hash
         WHERE tc.args_digest IS NOT NULL AND tc.session_id NOT IN ('', 'unknown', 'session')
         GROUP BY fm.source, tc.session_id, tc.tool_name, tc.args_digest
         HAVING COUNT(*) >= 3
         ORDER BY repeats DESC`,
        ...params,
        ...wm.params,
    );
}

/** Row result for detailed repeated tool invocations in an execution loop. */
export interface LoopRepeatedCallRow {
    toolSeq: number;
    ts: string | null;
    toolName: string;
    status: string;
    durationMs: number | null;
    resultBytes: number | null;
    argsRaw: string | null;
    argsDigest: string | null;
    errorText: string | null;
    callId: string | null;
    messageHash: string;
    sessionId: string;
    source: string;
    model: string | null;
    links: number | null;
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
}

/** Query detailed repeated invocations for a detected execution loop. */
export async function loopRepeatedCallsQuery(
    db: DbAdapter,
    params: {
        source: string;
        sessionId: string;
        toolName: string;
        argsDigest: string | null;
        limit?: number;
    },
): Promise<LoopRepeatedCallRow[]> {
    return db.queryAll<LoopRepeatedCallRow>(
        `SELECT tc.seq AS toolSeq,
                COALESCE(tc.started_at, m.ts) AS ts,
                tc.tool_name AS toolName,
                tc.status AS status,
                tc.duration_ms AS durationMs,
                tc.result_bytes AS resultBytes,
                tc.args_raw AS argsRaw,
                tc.args_digest AS argsDigest,
                tc.error_text AS errorText,
                tc.call_id AS callId,
                tc.message_hash AS messageHash,
                tc.session_id AS sessionId,
                tc.source AS source,
                m.model AS model,
                (SELECT COUNT(*) FROM history_tool_call l WHERE l.message_hash = m.record_hash) AS links,
                m.input_tokens AS inputTokens,
                m.cache_read_tokens AS cacheReadTokens,
                m.output_tokens AS outputTokens
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         WHERE tc.source = ? AND tc.session_id = ? AND tc.tool_name = ?
           AND (tc.args_digest = ? OR (tc.args_digest IS NULL AND ? = ''))
         ORDER BY tc.seq ASC
         LIMIT ?`,
        params.source,
        params.sessionId,
        params.toolName,
        params.argsDigest ?? '',
        params.argsDigest ?? '',
        params.limit ?? 50,
    );
}

/** Unknown-disposition drift counts (Q10) per source and record_type. */
export async function drift(db: DbAdapter, sel: ArtifactSelector, opts?: WatermarkQueryOptions): Promise<DriftRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    const extra = wm.where === '' ? "WHERE m.disposition = 'unknown'" : `${wm.where} AND m.disposition = 'unknown'`;
    return db.queryAll<DriftRow>(
        `SELECT m.source AS source, m.record_type AS recordType, COUNT(*) AS n
         FROM history_message m
         ${extra}
         GROUP BY m.source, m.record_type
         ORDER BY n DESC`,
        ...params,
        ...wm.params,
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

/**
 * Count `history_tool_call` rows a source import wrote in this run (`imported_at >= runStartedAt`,
 * task 0622 F9). Standalone `history import` coverage previously hardcoded `toolCalls: 0`; the
 * count is real only when rows landed, so dry-run legitimately reports 0. Owned here so raw SQL
 * stays in the domain layer (ADR-011).
 */
export async function countToolCallsSince(db: DbAdapter, source: string, runStartedAt: string): Promise<number> {
    const row = await db.queryFirst<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM history_tool_call WHERE source = ? AND imported_at >= ?',
        source,
        runStartedAt,
    );
    return row?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Per-step rankings (task 0581)
// ---------------------------------------------------------------------------

/**
 * Cache re-send waste thresholds (task 0581, I4). A step is counted when its fresh
 * input exceeds the floor and the provider served less than the reuse fraction of it
 * from cache. Baseline measured on omp 2026-08-17: 2,478 steps / 354,130,045 fresh
 * tokens. Adjust only with new evidence.
 */
export const CACHE_WASTE_MIN_INPUT_TOKENS = 100_000;

/** Max share of fresh input the provider may serve from cache for a step to count as waste (0581 I4). */
export const CACHE_WASTE_MAX_REUSE_FRACTION = 0.1;

/** One assistant step in the 0581 rankings - raw `history_message` columns, nulls preserved. */
export interface StepRow {
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

/** Per-source support verdict for the per-step sections, derived from assistant rows (0581 R5). */
export interface StepSupportRow {
    source: string;
    assistantSteps: number;
    stepsWithUsage: number;
    /** Steps carrying any duration — provider-reported plus ETL-derived. */
    stepsWithDuration: number;
    /**
     * Of {@link stepsWithDuration}, how many are ETL timestamp deltas rather than the
     * provider's own measurement (0702 R2). A reader comparing latency across sources
     * needs this: a derived value includes queue and network time, a provider one does
     * not, and the two must never be presented as the same measurement.
     */
    stepsWithDerivedDuration: number;
    stepsWithCacheRead: number;
}

/** Cache re-send waste aggregate: one row for the whole selection, never bounded by `top`. */
export interface CacheWasteAggregateRow {
    steps: number;
    inputTokens: number | null;
}

/** Appends fixed predicates to a (possibly empty) selector WHERE - no user input, fixed strings only. */
function withStepPredicates(wmWhere: string, predicates: string): string {
    return wmWhere === '' ? `WHERE ${predicates}` : `${wmWhere} AND ${predicates}`;
}

/**
 * Q11 - top assistant steps by total tokens (input + cache-read), bounded by `top`.
 * A step is measured when either token column is non-NULL; 0 counts as measured
 * (glm steps legitimately report 0/0 while still being usage-bearing rows).
 */
export async function topStepsByTokens(
    db: DbAdapter,
    sel: ArtifactSelector,
    top: number,
    opts?: WatermarkQueryOptions,
): Promise<StepRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<StepRow>(
        `SELECT m.session_id AS sessionId, m.source AS source, m.ts AS ts, m.model AS model,
                m.input_tokens AS inputTokens, m.cache_read_tokens AS cacheReadTokens,
                m.output_tokens AS outputTokens, m.cost_usd AS costUsd, m.duration_ms AS durationMs
         FROM history_message m
         ${withStepPredicates(wm.where, "m.role = 'assistant' AND +(m.input_tokens IS NOT NULL OR m.output_tokens IS NOT NULL)")}
         ORDER BY +(COALESCE(m.input_tokens, 0) + COALESCE(m.cache_read_tokens, 0)) DESC
         LIMIT ?`,
        ...params,
        ...wm.params,
        top,
    );
}

/** Q12 - top assistant steps by measured duration. Unmeasured steps are excluded, never zeroed. */
export async function topStepsByDuration(
    db: DbAdapter,
    sel: ArtifactSelector,
    top: number,
    opts?: WatermarkQueryOptions,
): Promise<StepRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<StepRow>(
        `SELECT m.session_id AS sessionId, m.source AS source, m.ts AS ts, m.model AS model,
                m.input_tokens AS inputTokens, m.cache_read_tokens AS cacheReadTokens,
                m.output_tokens AS outputTokens, m.cost_usd AS costUsd, m.duration_ms AS durationMs
         FROM history_message m
         ${withStepPredicates(wm.where, "m.role = 'assistant' AND +m.duration_ms IS NOT NULL")}
         ORDER BY +m.duration_ms DESC
         LIMIT ?`,
        ...params,
        ...wm.params,
        top,
    );
}

/**
 * Q13a - cache re-send waste aggregate for the whole selection (single row, R2-safe).
 * `m.cache_read_tokens < m.input_tokens * ?` is raw-column: a NULL cache read does not
 * compare true, so only measured low-reuse steps count (matches the AC4 baseline query).
 */
export async function cacheWasteAggregate(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<CacheWasteAggregateRow | null | undefined> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryFirst<CacheWasteAggregateRow>(
        `SELECT COUNT(*) AS steps, SUM(m.input_tokens) AS inputTokens
         FROM history_message m
         ${withStepPredicates(
             wm.where,
             "m.role = 'assistant' AND +m.input_tokens > ? AND m.cache_read_tokens < m.input_tokens * ?",
         )}
         LIMIT ?`,
        ...params,
        CACHE_WASTE_MIN_INPUT_TOKENS,
        CACHE_WASTE_MAX_REUSE_FRACTION,
        ...wm.params,
        1,
    );
}

/** Q13b - the bounded offenders ranking under the same waste predicate as Q13a. */
export async function topCacheWasteSteps(
    db: DbAdapter,
    sel: ArtifactSelector,
    top: number,
    opts?: WatermarkQueryOptions,
): Promise<StepRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<StepRow>(
        `SELECT m.session_id AS sessionId, m.source AS source, m.ts AS ts, m.model AS model,
                m.input_tokens AS inputTokens, m.cache_read_tokens AS cacheReadTokens,
                m.output_tokens AS outputTokens, m.cost_usd AS costUsd, m.duration_ms AS durationMs
         FROM history_message m
         ${withStepPredicates(
             wm.where,
             "m.role = 'assistant' AND +m.input_tokens > ? AND m.cache_read_tokens < m.input_tokens * ?",
         )}
         ORDER BY +m.input_tokens DESC
         LIMIT ?`,
        ...params,
        CACHE_WASTE_MIN_INPUT_TOKENS,
        CACHE_WASTE_MAX_REUSE_FRACTION,
        ...wm.params,
        top,
    );
}

/**
 * Q14 - per-source support verdicts for the per-step sections. Never hard-codes a
 * source list: tokens supported iff usage-bearing steps exist, duration iff measured
 * durations exist, cache iff any cache-read column is populated (0581 R5).
 */
export async function stepSupport(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<StepSupportRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<StepSupportRow>(
        `SELECT m.source AS source,
                COUNT(*) AS assistantSteps,
                SUM(m.input_tokens IS NOT NULL OR m.output_tokens IS NOT NULL) AS stepsWithUsage,
                SUM(m.duration_ms IS NOT NULL) AS stepsWithDuration,
                SUM(m.duration_source IS 'derived') AS stepsWithDerivedDuration,
                SUM(m.cache_read_tokens IS NOT NULL) AS stepsWithCacheRead
         FROM history_message m
         ${withStepPredicates(wm.where, "m.role = 'assistant'")}
         GROUP BY m.source`,
        ...params,
        ...wm.params,
    );
}

// ---------------------------------------------------------------------------
// Derived-variable queries (task 0554)
// ---------------------------------------------------------------------------

/** Per-session timing span: MIN/MAX ts + assistant duration sums (derived metric input). */
export async function sessionSpans(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<SessionSpanRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<SessionSpanRow>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                MIN(CASE WHEN m.ts <> '1970-01-01T00:00:00.000Z' AND m.ts LIKE '____-__-__T%' THEN m.ts END) AS firstTs,
                MAX(CASE WHEN m.ts <> '1970-01-01T00:00:00.000Z' AND m.ts LIKE '____-__-__T%' THEN m.ts END) AS lastTs,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms END) AS assistantDurationMs,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms IS NULL END) AS assistantDurationUnmeasured
         FROM history_message m
         ${wm.where}
         GROUP BY m.session_id, m.source`,
        ...params,
        ...wm.params,
    );
}

/** Per-session tool-call duration sums (derived metric input). */
export async function sessionToolDurations(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<SessionToolDurationRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<SessionToolDurationRow>(
        `SELECT m.session_id AS sessionId, m.source AS source,
                SUM(tc.duration_ms) AS toolDurationMs,
                SUM(tc.duration_ms IS NULL) AS toolDurationUnmeasured
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${wm.where}
         GROUP BY m.session_id, m.source`,
        ...params,
        ...wm.params,
    );
}

/**
 * Todo-tool calls with `args_raw` populated (task 0553), ordered for phase extraction.
 * `LIMIT ?` satisfies the R2 structural invariant (no unbounded corpus materialization).
 */
export async function todoToolCalls(
    db: DbAdapter,
    sel: ArtifactSelector,
    limit = 5000,
    opts?: WatermarkQueryOptions,
): Promise<TodoToolCallRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    // Built outside the SQL template: a nested backtick expression inside the literal
    // would break the R2 source scan (which treats backticks as query boundaries).
    const whereClause = wm.where ? `${wm.where} AND tc.args_raw IS NOT NULL` : 'WHERE tc.args_raw IS NOT NULL';
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
        ...wm.params,
        limit,
    );
}

// ─── History Board Live Queries (task 0628 R2) ───────────────────────────────

/** Supported bucket intervals for token time-series aggregations. */
export type HistoryBucket = '1m' | '3m' | '5m' | '10m' | '30m' | '1h' | '4h' | '1d';

/** Supported dimensions for breakdown in token time-series. */
export type HistoryDimension = 'model' | 'source' | 'tool' | 'skill';

/** Aggregate token row floored to a time bucket interval and grouped by dimension key. */
export interface BucketedTokenRow {
    bucketStart: string;
    key: string;
    freshInputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
    calls?: number | null;
}

/** Chronological event row in a session execution timeline. */
export interface TimelineEventRow {
    seq: number;
    sessionId: string;
    messageSeq: number;
    turnIndex: number;
    eventType: 'message' | 'tool';
    recordType: string;
    ts: string | null;
    role: string;
    source: string;
    model: string | null;
    toolName: string | null;
    durationMs: number | null;
    durationSource: 'measured' | 'inferred' | 'unmeasured';
    inputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
    exitCode: number | null;
    payload: string | null;
    correlationExactness?: 'exact' | 'estimated' | null;
}

/** Result of a timeline query with truncation status. */
export interface TimelineQueryResult {
    truncated: boolean;
    events: TimelineEventRow[];
}

/** Per-(source, day) token aggregate row for heatmap visualizer. */
export interface DailyTokenRow {
    source: string;
    day: string;
    tokens: number | null;
    cacheReadTokens: number | null;
    freshInputTokens: number | null;
    sessions: number;
    toolCalls: number;
}

/** Multi-axis model benchmark comparison metrics row. */
export interface ModelComparisonRow {
    model: string;
    speedMsMean: number | null;
    cacheRatio: number | null;
    reliability: number | null;
    outputRatio: number | null;
}

const BUCKET_SECONDS: Record<HistoryBucket, number> = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '10m': 600,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
};

const HISTORY_SKILL_NAME_SQL = `CASE
    WHEN LOWER(${EFFECTIVE_TOOL_NAME_SQL}) IN ('skill', 'use_skill', 'invoke_skill', 'slashcommand', 'slash_command', 'run_skill', 'call_skill', 'execute_skill') AND json_valid(tc.args_raw)
    THEN COALESCE(
        CAST(json_extract(tc.args_raw, '$.skill') AS TEXT),
        CAST(json_extract(tc.args_raw, '$.skill_name') AS TEXT),
        CAST(json_extract(tc.args_raw, '$.skillName') AS TEXT),
        CAST(json_extract(tc.args_raw, '$.name') AS TEXT),
        CAST(json_extract(tc.args_raw, '$.command') AS TEXT),
        CAST(json_extract(tc.args_raw, '$.command_name') AS TEXT),
        CAST(json_extract(tc.args_raw, '$') AS TEXT),
        ''
    )
    ELSE ''
END`;

/**
 * Token metrics bucketed into regular time intervals across a given dimension.
 */
export async function bucketedTokenSeries(
    db: DbAdapter,
    sel: ArtifactSelector,
    bucket: HistoryBucket,
    dim: HistoryDimension,
    opts?: WatermarkQueryOptions,
): Promise<BucketedTokenRow[]> {
    const { where, params } = buildMessageWhere(sel, 'm');
    const wm = applyWatermarkToWhere(where, opts?.watermark);

    const bucketExpr =
        bucket === '1d'
            ? 'DATE(m.ts)'
            : `datetime(CAST(strftime('%s', m.ts) / ${BUCKET_SECONDS[bucket]} * ${BUCKET_SECONDS[bucket]} AS INTEGER), 'unixepoch')`;

    if (dim === 'tool' || dim === 'skill') {
        // Allocation is canonical: a message's tokens divide across ALL linked tool calls,
        // and skill rows are selected only after that division — matching how
        // history_board_tool_5m was materialized so fresh and stale results stay equal.
        const keyExpr = dim === 'tool' ? EFFECTIVE_TOOL_NAME_SQL : HISTORY_SKILL_NAME_SQL;
        const outerFilter = dim === 'skill' ? "WHERE key <> '' AND key <> 'unknown'" : '';
        return db.queryAll<BucketedTokenRow>(
            `WITH filtered AS (
                 SELECT m.record_hash, m.ts, m.source, m.session_id, m.seq, m.rowid, m.role,
                        m.input_tokens, m.cache_read_tokens, m.output_tokens,
                        ROW_NUMBER() OVER (PARTITION BY m.request_id ORDER BY m.rowid DESC) AS rn,
                        m.request_id
                 FROM history_message m
                 ${wm.where}
             ),
             deduped AS (
                 SELECT * FROM filtered WHERE request_id IS NULL OR rn = 1
             ),
             enriched AS (
                 SELECT m.*,
                        COALESCE(
                            m.input_tokens,
                            LAG(CASE WHEN m.role = 'assistant' THEN m.input_tokens END)
                                OVER (PARTITION BY m.source, m.session_id ORDER BY m.seq, m.rowid)
                        ) AS resolved_input_tokens,
                        COALESCE(
                            m.cache_read_tokens,
                            LAG(CASE WHEN m.role = 'assistant' THEN m.cache_read_tokens END)
                                OVER (PARTITION BY m.source, m.session_id ORDER BY m.seq, m.rowid)
                        ) AS resolved_cache_read_tokens,
                        COALESCE(
                            m.output_tokens,
                            LAG(CASE WHEN m.role = 'assistant' THEN m.output_tokens END)
                                OVER (PARTITION BY m.source, m.session_id ORDER BY m.seq, m.rowid)
                        ) AS resolved_output_tokens
                 FROM deduped m
             ), linked AS (
                 SELECT ${bucketExpr.replace(/m\.ts/g, 'm.ts')} AS bucketStart, ${keyExpr} AS key,
                        COALESCE(m.resolved_input_tokens, 0) AS freshInputTokens,
                        COALESCE(m.resolved_cache_read_tokens, 0) AS cacheReadTokens,
                        COALESCE(m.resolved_output_tokens, 0) AS outputTokens,
                        COUNT(*) OVER (PARTITION BY m.record_hash) AS links
                 FROM enriched m
                 CROSS JOIN history_tool_call tc ON tc.message_hash = m.record_hash
             )
             SELECT bucketStart, key,
                    SUM(CAST(freshInputTokens AS REAL) / links) AS freshInputTokens,
                    SUM(CAST(cacheReadTokens AS REAL) / links) AS cacheReadTokens,
                    SUM(CAST(outputTokens AS REAL) / links) AS outputTokens,
                    COUNT(*) AS calls
             FROM linked
             ${outerFilter}
             GROUP BY bucketStart, key
             ORDER BY bucketStart ASC`,
            ...params,
            ...wm.params,
        );
    }

    const keyExpr =
        dim === 'model'
            ? "COALESCE(m.model, MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END) OVER (PARTITION BY m.source, m.session_id), 'unknown')"
            : 'm.source';
    return db.queryAll<BucketedTokenRow>(
        `WITH filtered AS (
             SELECT m.input_tokens, m.cache_read_tokens, m.output_tokens, m.ts, m.source, m.session_id, m.model,
                    ROW_NUMBER() OVER (PARTITION BY m.request_id ORDER BY m.rowid DESC) AS rn,
                    m.request_id
             FROM history_message m
             ${wm.where}
         ),
         deduped AS (
             SELECT * FROM filtered WHERE request_id IS NULL OR rn = 1
         ),
         enriched AS (
             SELECT input_tokens, cache_read_tokens, output_tokens, ts,
                    ${keyExpr} AS key
             FROM deduped m
         )
         SELECT ${bucketExpr.replace(/m\.ts/g, 'ts')} AS bucketStart,
                key,
                SUM(COALESCE(input_tokens, 0)) AS freshInputTokens,
                SUM(COALESCE(cache_read_tokens, 0)) AS cacheReadTokens,
                SUM(COALESCE(output_tokens, 0)) AS outputTokens,
                COUNT(*) AS calls
         FROM enriched
         GROUP BY bucketStart, key
         ORDER BY bucketStart ASC`,
        ...params,
        ...wm.params,
    );
}

function formatToolPayload(
    toolName: string | null,
    status: string | null,
    argsRaw: string | null,
    argsDigest: string | null,
    errorText: string | null,
): string | null {
    if (errorText != null && errorText.trim().length > 0) return errorText;
    if (argsRaw != null && argsRaw.trim().length > 0) return argsRaw;
    if (argsDigest != null && argsDigest.trim().length > 0) {
        return `tool: ${toolName ?? ''}\nstatus: ${status ?? 'ok'}\nargs_digest: ${argsDigest} (raw payload omitted at import)`;
    }
    return null;
}

interface JoinedTimelineRow {
    messageHash: string;
    messageSeq: number;
    turnIndex: number;
    messageTs: string | null;
    messageRole: string;
    recordType: string;
    source: string;
    sessionId: string;
    model: string | null;
    messageDurationMs: number | null;
    inputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
    messagePayload: string | null;
    links: number;
    toolName: string | null;
    toolTs: string | null;
    toolDurationMs: number | null;
    toolStatus: string | null;
    toolArgsRaw: string | null;
    toolArgsDigest: string | null;
    toolErrorText: string | null;
    toolSeq: number | null;
    messageRowId: number;
}

interface RawTimelineEvent {
    sessionId: string;
    messageSeq: number;
    turnIndex: number;
    eventType: 'message' | 'tool';
    recordType: string;
    ts: string | null;
    role: string;
    source: string;
    model: string | null;
    toolName: string | null;
    durationMs: number | null;
    durationSource: 'measured' | 'inferred' | 'unmeasured';
    inputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
    exitCode: number | null;
    payload: string | null;
    messageRowId: number;
    toolSeq: number;
    correlationExactness?: 'exact' | 'estimated' | null;
}

function finalizeSessionDurations(events: RawTimelineEvent[]): void {
    events.sort((a, b) => {
        const aTs = a.ts ? Date.parse(a.ts) : Infinity;
        const bTs = b.ts ? Date.parse(b.ts) : Infinity;
        if (aTs !== bTs) return (Number.isNaN(aTs) ? Infinity : aTs) - (Number.isNaN(bTs) ? Infinity : bTs);
        if (a.messageRowId !== b.messageRowId) return a.messageRowId - b.messageRowId;
        if (a.eventType !== b.eventType) return a.eventType === 'message' ? -1 : 1;
        return a.toolSeq - b.toolSeq;
    });

    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (!ev) continue;
        if (ev.durationMs != null && Number.isFinite(ev.durationMs) && ev.durationMs > 0) {
            ev.durationSource = 'measured';
        } else {
            if (i + 1 < events.length) {
                const nextEv = events[i + 1];
                const currTs = ev.ts ? Date.parse(ev.ts) : Number.NaN;
                const nextTs = nextEv?.ts ? Date.parse(nextEv.ts) : Number.NaN;
                const delta = !Number.isNaN(currTs) && !Number.isNaN(nextTs) ? nextTs - currTs : Number.NaN;
                if (delta > 0 && delta <= 600_000) {
                    ev.durationMs = delta;
                    ev.durationSource = 'inferred';
                } else {
                    ev.durationMs = null;
                    ev.durationSource = 'unmeasured';
                }
            } else {
                ev.durationMs = null;
                ev.durationSource = 'unmeasured';
            }
        }
    }
}

async function queryTimelineEvents(
    db: DbAdapter,
    whereClause: string,
    params: unknown[],
    subWhereClause: string,
    subParams: unknown[],
    limit: number,
    correlationMap?: Map<string, 'exact' | 'estimated'>,
): Promise<TimelineQueryResult> {
    const fetchLimit = limit + 1;
    const mainCondition = whereClause.startsWith('WHERE ') ? whereClause.slice(6) : whereClause;
    const subCondition = subWhereClause.startsWith('WHERE ') ? subWhereClause.slice(6) : subWhereClause;

    const dedupSubWhere = subCondition ? `WHERE ${subCondition} AND ` : 'WHERE ';
    const fullWhere = mainCondition
        ? `WHERE ${mainCondition} AND (m.request_id IS NULL OR m.rowid IN (SELECT MIN(dm.rowid) FROM history_message dm ${dedupSubWhere}dm.request_id IS NOT NULL GROUP BY dm.request_id))`
        : `WHERE (m.request_id IS NULL OR m.rowid IN (SELECT MIN(dm.rowid) FROM history_message dm ${dedupSubWhere}dm.request_id IS NOT NULL GROUP BY dm.request_id))`;

    const rows = await db.queryAll<JoinedTimelineRow>(
        `SELECT m.record_hash AS messageHash, m.seq AS messageSeq,
                COALESCE(m.turn_index, m.seq) AS turnIndex,
                m.ts AS messageTs, m.role AS messageRole, COALESCE(m.record_type, m.role) AS recordType,
                m.source, m.session_id AS sessionId, m.model,
                m.duration_ms AS messageDurationMs, m.input_tokens AS inputTokens,
                m.cache_read_tokens AS cacheReadTokens, m.output_tokens AS outputTokens,
                m.content_text AS messagePayload,
                (SELECT COUNT(*) FROM history_tool_call links WHERE links.message_hash = m.record_hash) AS links,
                tc.tool_name AS toolName, COALESCE(tc.started_at, m.ts) AS toolTs,
                tc.duration_ms AS toolDurationMs, tc.status AS toolStatus,
                tc.args_raw AS toolArgsRaw, tc.args_digest AS toolArgsDigest, tc.error_text AS toolErrorText,
                COALESCE(tc.seq, 0) AS toolSeq, m.rowid AS messageRowId
         FROM history_message m
         LEFT JOIN history_tool_call tc ON tc.message_hash = m.record_hash
         ${fullWhere}
         ORDER BY COALESCE(m.ts, '0000-00-00') DESC, m.rowid DESC, COALESCE(tc.seq, 0) DESC
         LIMIT ?`,
        ...params,
        ...subParams,
        fetchLimit,
    );

    const rawEvents: RawTimelineEvent[] = [];
    let previousMessage = '';
    for (const row of rows) {
        if (row.messageHash !== previousMessage) {
            rawEvents.push({
                sessionId: row.sessionId,
                messageSeq: row.messageSeq,
                turnIndex: row.turnIndex,
                eventType: 'message',
                recordType: row.recordType,
                ts: row.messageTs,
                role: row.messageRole,
                source: row.source,
                model: row.model,
                toolName: null,
                durationMs: row.messageDurationMs,
                durationSource: 'unmeasured',
                inputTokens: row.links > 0 ? 0 : row.inputTokens,
                cacheReadTokens: row.links > 0 ? 0 : row.cacheReadTokens,
                outputTokens: row.links > 0 ? 0 : row.outputTokens,
                exitCode: null,
                payload: row.messagePayload,
                messageRowId: row.messageRowId,
                toolSeq: 0,
            });
            previousMessage = row.messageHash;
        }
        if (row.toolName !== null) {
            rawEvents.push({
                sessionId: row.sessionId,
                messageSeq: row.messageSeq,
                turnIndex: row.turnIndex,
                eventType: 'tool',
                recordType: row.recordType,
                ts: row.toolTs,
                role: 'tool',
                source: row.source,
                model: row.model,
                toolName: row.toolName,
                durationMs: row.toolDurationMs,
                durationSource: 'unmeasured',
                inputTokens: row.links > 0 ? (row.inputTokens ?? 0) / row.links : row.inputTokens,
                cacheReadTokens: row.links > 0 ? (row.cacheReadTokens ?? 0) / row.links : row.cacheReadTokens,
                outputTokens: row.links > 0 ? (row.outputTokens ?? 0) / row.links : row.outputTokens,
                exitCode: row.toolStatus === 'error' ? 1 : 0,
                payload: formatToolPayload(
                    row.toolName,
                    row.toolStatus,
                    row.toolArgsRaw,
                    row.toolArgsDigest,
                    row.toolErrorText,
                ),
                messageRowId: row.messageRowId,
                toolSeq: row.toolSeq ?? 0,
            });
        }
    }

    const truncated = rows.length > limit || rawEvents.length > limit;

    // Stable sort ascending to keep the newest `limit` events
    rawEvents.sort((a, b) => {
        const aTs = a.ts ? Date.parse(a.ts) : Infinity;
        const bTs = b.ts ? Date.parse(b.ts) : Infinity;
        if (aTs !== bTs) return (Number.isNaN(aTs) ? Infinity : aTs) - (Number.isNaN(bTs) ? Infinity : bTs);
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
        if (a.messageRowId !== b.messageRowId) return a.messageRowId - b.messageRowId;
        if (a.eventType !== b.eventType) return a.eventType === 'message' ? -1 : 1;
        return a.toolSeq - b.toolSeq;
    });

    const boundedEvents = rawEvents.length > limit ? rawEvents.slice(rawEvents.length - limit) : rawEvents;

    // Group by session to finalize durations independently per (source, sessionId)
    const sessionMap = new Map<string, RawTimelineEvent[]>();
    for (const ev of boundedEvents) {
        const sessionKey = `${ev.source}:::${ev.sessionId}`;
        let list = sessionMap.get(sessionKey);
        if (list === undefined) {
            list = [];
            sessionMap.set(sessionKey, list);
        }
        list.push(ev);
        if (correlationMap !== undefined) {
            ev.correlationExactness = correlationMap.get(sessionKey) ?? null;
        } else {
            ev.correlationExactness = null;
        }
    }

    for (const sessionEvents of sessionMap.values()) {
        finalizeSessionDurations(sessionEvents);
    }

    // Stable sort overall consolidated stream oldest-to-newest
    boundedEvents.sort((a, b) => {
        const aTs = a.ts ? Date.parse(a.ts) : Infinity;
        const bTs = b.ts ? Date.parse(b.ts) : Infinity;
        if (aTs !== bTs) return (Number.isNaN(aTs) ? Infinity : aTs) - (Number.isNaN(bTs) ? Infinity : bTs);
        if (a.source !== b.source) return a.source.localeCompare(b.source);
        if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
        if (a.messageRowId !== b.messageRowId) return a.messageRowId - b.messageRowId;
        if (a.eventType !== b.eventType) return a.eventType === 'message' ? -1 : 1;
        return a.toolSeq - b.toolSeq;
    });

    return {
        truncated,
        events: boundedEvents.map((row, index) => ({
            seq: index + 1,
            sessionId: row.sessionId,
            messageSeq: row.messageSeq,
            turnIndex: row.turnIndex,
            eventType: row.eventType,
            recordType: row.recordType,
            ts: row.ts,
            role: row.role,
            source: row.source,
            model: row.model,
            toolName: row.toolName,
            durationMs: row.durationMs,
            durationSource: row.durationSource,
            inputTokens: row.inputTokens,
            cacheReadTokens: row.cacheReadTokens,
            outputTokens: row.outputTokens,
            exitCode: row.exitCode,
            payload: row.payload,
            correlationExactness: row.correlationExactness,
        })),
    };
}

/**
 * Chronological user/assistant/tool event stream for a single session.
 */
export async function sessionTimeline(
    db: DbAdapter,
    source: string,
    sessionId: string,
    limit = 5000,
): Promise<TimelineQueryResult> {
    return queryTimelineEvents(
        db,
        'WHERE m.source = ? AND m.session_id = ?',
        [source, sessionId],
        'WHERE dm.source = ? AND dm.session_id = ?',
        [source, sessionId],
        limit,
    );
}

/**
 * Chronological consolidated event stream across multiple sessions / agents.
 */
export async function consolidatedTimeline(
    db: DbAdapter,
    sel: ArtifactSelector,
    limit = 5000,
): Promise<TimelineQueryResult> {
    const built = buildMessageWhere(sel, 'm');
    const subBuilt = buildMessageWhere(sel, 'dm');
    let correlationMap: Map<string, 'exact' | 'estimated'> | undefined;

    if (sel.runId != null || sel.taskWbs != null) {
        correlationMap = new Map();
        const correlationClauses = ['hrs.session_id IS NOT NULL'];
        const correlationParams: unknown[] = [];
        if (sel.runId != null) {
            correlationClauses.push('hrs.run_id = ?');
            correlationParams.push(sel.runId);
        }
        if (sel.taskWbs != null) {
            correlationClauses.push(
                'EXISTS (SELECT 1 FROM task_run_links trl WHERE trl.run_id = hrs.run_id AND trl.wbs = ?)',
            );
            correlationParams.push(sel.taskWbs);
        }
        const rows = await db.queryAll<{ source: string; session_id: string; exactness: string }>(
            `SELECT hrs.source, hrs.session_id, hrs.exactness
             FROM history_run_session hrs
             WHERE ${correlationClauses.join(' AND ')}`,
            ...correlationParams,
        );

        for (const r of rows) {
            const key = `${r.source}:::${r.session_id}`;
            const existing = correlationMap.get(key);
            if (r.exactness === 'exact') {
                correlationMap.set(key, 'exact');
            } else if (r.exactness === 'estimated' && existing !== 'exact') {
                correlationMap.set(key, 'estimated');
            }
        }
    }

    return queryTimelineEvents(db, built.where, built.params, subBuilt.where, subBuilt.params, limit, correlationMap);
}

/**
 * Per (source, day) token matrix for the 90-day heatmap grid.
 */
export async function dailyTokenMatrix(db: DbAdapter, days = 90): Promise<DailyTokenRow[]> {
    return db.queryAll<DailyTokenRow>(
        `WITH messages AS (
             SELECT m.source, DATE(m.ts) AS day,
                    SUM(COALESCE(m.input_tokens, 0)) AS freshInputTokens,
                    SUM(COALESCE(m.input_tokens, 0) + COALESCE(m.output_tokens, 0)) AS tokens,
                    SUM(COALESCE(m.cache_read_tokens, 0)) AS cacheReadTokens,
                    COUNT(DISTINCT CASE
                        WHEN m.session_id NOT IN ('', 'unknown', 'session') THEN m.session_id
                    END) AS sessions
             FROM history_message m
             WHERE m.ts >= datetime('now', '-' || ? || ' days') AND ${MESSAGE_DEDUP}
             GROUP BY m.source, DATE(m.ts)
         ), tools AS (
             SELECT m.source, DATE(m.ts) AS day, COUNT(*) AS toolCalls
             FROM history_tool_call tc JOIN history_message m ON m.record_hash = tc.message_hash
             WHERE m.ts >= datetime('now', '-' || ? || ' days') AND ${MESSAGE_DEDUP}
             GROUP BY m.source, DATE(m.ts)
         )
         SELECT m.source, m.day, m.tokens, m.cacheReadTokens, m.freshInputTokens,
                m.sessions, COALESCE(t.toolCalls, 0) AS toolCalls
         FROM messages m LEFT JOIN tools t ON t.source = m.source AND t.day = m.day
         ORDER BY m.day ASC`,
        days,
        days,
    );
}

/**
 * Model multi-axis comparison metrics (Speed, Cache ratio, Reliability, Output ratio).
 */
export async function modelComparison(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<ModelComparisonRow[]> {
    const { where, params } = buildMessageWhere(sel, 'm');
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<ModelComparisonRow>(
        `WITH filtered AS (
             SELECT m.record_hash, m.source, m.session_id, m.role, m.duration_ms,
                    m.input_tokens, m.cache_read_tokens, m.output_tokens, m.model,
                    ROW_NUMBER() OVER (PARTITION BY m.request_id ORDER BY m.rowid DESC) AS rn,
                    m.request_id
             FROM history_message m
             ${wm.where}
         ),
         selected AS (
             SELECT m.record_hash,
                    COALESCE(
                        m.model,
                        MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END)
                            OVER (PARTITION BY m.source, m.session_id),
                        'unknown'
                    ) AS model,
                    m.role, m.duration_ms,
                    m.input_tokens, m.cache_read_tokens, m.output_tokens
             FROM filtered m
             WHERE m.request_id IS NULL OR m.rn = 1
         ), message_stats AS (
             SELECT model,
                    AVG(CASE WHEN role = 'assistant' AND duration_ms > 0 THEN duration_ms END) AS speedMsMean,
                    SUM(COALESCE(input_tokens, 0)) AS fresh,
                    SUM(COALESCE(cache_read_tokens, 0)) AS cache_read,
                    SUM(COALESCE(output_tokens, 0)) AS output
             FROM selected GROUP BY model
         ), tool_stats AS (
             SELECT s.model, COUNT(*) AS calls, SUM(tc.status = 'error') AS errors
             FROM selected s
             CROSS JOIN history_tool_call tc ON tc.message_hash = s.record_hash
             GROUP BY s.model
         )
         SELECT m.model, m.speedMsMean,
                CASE WHEN m.fresh + m.cache_read > 0
                     THEN CAST(m.cache_read AS REAL) / CAST(m.fresh + m.cache_read AS REAL)
                     ELSE 0.0 END AS cacheRatio,
                CASE WHEN COALESCE(t.calls, 0) > 0
                     THEN 1.0 - (CAST(t.errors AS REAL) / CAST(t.calls AS REAL))
                     ELSE 1.0 END AS reliability,
                CASE WHEN m.fresh + m.output > 0
                     THEN CAST(m.output AS REAL) / CAST(m.fresh + m.output AS REAL)
                     ELSE 0.0 END AS outputRatio
         FROM message_stats m LEFT JOIN tool_stats t ON t.model = m.model
         ORDER BY m.model`,
        ...params,
        ...wm.params,
    );
}

/**
 * Daily KPI trend rows (fresh input / output / cache-read tokens, sessions, tool calls)
 * grouped by UTC day from the message table with request_id dedup applied.
 */
export interface KpiTrendRow {
    day: string;
    freshInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    sessions: number;
    toolCalls: number;
}

/** Daily KPI trend rows (tokens, sessions, tool calls) across the selected artifact slice. */
export async function historyKpiTrend(
    db: DbAdapter,
    sel: ArtifactSelector,
    opts?: WatermarkQueryOptions,
): Promise<KpiTrendRow[]> {
    const { where, params } = buildMessageWhere(sel, 'm');
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    return db.queryAll<KpiTrendRow>(
        `WITH filtered_messages AS (
             SELECT m.record_hash, m.ts, m.input_tokens, m.cache_read_tokens, m.output_tokens, m.session_id,
                    ROW_NUMBER() OVER (PARTITION BY m.request_id ORDER BY m.rowid DESC) AS rn,
                    m.request_id
             FROM history_message m
             ${wm.where}
         ),
         selected_messages AS (
             SELECT * FROM filtered_messages WHERE request_id IS NULL OR rn = 1
         ),
         message_daily AS (
             SELECT DATE(ts) AS day,
                    SUM(COALESCE(input_tokens, 0)) AS freshInputTokens,
                    SUM(COALESCE(output_tokens, 0)) AS outputTokens,
                    SUM(COALESCE(cache_read_tokens, 0)) AS cacheReadTokens,
                    COUNT(DISTINCT CASE WHEN session_id NOT IN ('', 'unknown', 'session') THEN session_id END) AS sessions
             FROM selected_messages
             GROUP BY DATE(ts)
         ),
         tool_daily AS (
             SELECT DATE(m.ts) AS day,
                    COUNT(*) AS toolCalls
             FROM selected_messages m
             CROSS JOIN history_tool_call tc ON tc.message_hash = m.record_hash
             GROUP BY DATE(m.ts)
         )
         SELECT m.day,
                m.freshInputTokens,
                m.outputTokens,
                m.cacheReadTokens,
                m.sessions,
                COALESCE(t.toolCalls, 0) AS toolCalls
         FROM message_daily m
         LEFT JOIN tool_daily t ON t.day = m.day
         ORDER BY m.day ASC`,
        ...params,
        ...wm.params,
    );
}

/**
 * Raw tool sequence query row joined from history_tool_call and history_message.
 */
export interface ToolSequenceRow {
    toolSeq: number;
    ts: string | null;
    toolName: string;
    status: string;
    durationMs: number | null;
    resultBytes: number | null;
    argsRaw: string | null;
    argsDigest: string | null;
    errorText: string | null;
    callId: string | null;
    messageHash: string;
    sessionId: string;
    source: string;
    model: string | null;
    links: number;
    inputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
}

/**
 * Result of tool sequence query with truncation flag.
 */
export interface ToolSequenceQueryResult {
    truncated: boolean;
    rows: ToolSequenceRow[];
}

/**
 * Filter options for tool sequence query.
 */
export interface ToolSequenceFilters {
    toolNames?: string[];
    status?: 'all' | 'ok' | 'error';
    search?: string;
}

/**
 * Ordered tool invocation sequence query joining history_tool_call and history_message.
 */
export async function toolSequenceQuery(
    db: DbAdapter,
    scope: { mode: 'session'; source: string; sessionId: string } | { mode: 'consolidated'; sel: ArtifactSelector },
    filters: ToolSequenceFilters = {},
    limit = 5000,
): Promise<ToolSequenceQueryResult> {
    const fetchLimit = limit + 1;
    const params: unknown[] = [];
    const clauses: string[] = [];

    if (scope.mode === 'session') {
        clauses.push('tc.source = ? AND tc.session_id = ?');
        params.push(scope.source, scope.sessionId);
    } else {
        const { where, params: selParams } = buildMessageWhere(scope.sel, 'm');
        if (where !== '') {
            clauses.push(where.startsWith('WHERE ') ? where.slice(6) : where);
            params.push(...selParams);
        }
    }

    if (filters.toolNames && filters.toolNames.length > 0) {
        const placeholders = filters.toolNames.map(() => '?').join(', ');
        clauses.push(`tc.tool_name IN (${placeholders})`);
        params.push(...filters.toolNames);
    }

    if (filters.status && filters.status !== 'all') {
        clauses.push('tc.status = ?');
        params.push(filters.status);
    }

    if (filters.search && filters.search.trim().length > 0) {
        const searchPattern = `%${escapeLike(filters.search.trim())}%`;
        clauses.push(
            "(tc.args_raw LIKE ? ESCAPE '!' OR tc.error_text LIKE ? ESCAPE '!' OR tc.tool_name LIKE ? ESCAPE '!')",
        );
        params.push(searchPattern, searchPattern, searchPattern);
    }

    const whereCombined = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const folded = withMessageDedup(whereCombined);

    params.push(fetchLimit);

    const rows = await db.queryAll<ToolSequenceRow>(
        `SELECT tc.seq AS toolSeq,
                COALESCE(tc.started_at, m.ts) AS ts,
                tc.tool_name AS toolName,
                tc.status AS status,
                tc.duration_ms AS durationMs,
                tc.result_bytes AS resultBytes,
                tc.args_raw AS argsRaw,
                tc.args_digest AS argsDigest,
                tc.error_text AS errorText,
                tc.call_id AS callId,
                tc.message_hash AS messageHash,
                tc.session_id AS sessionId,
                tc.source AS source,
                m.model AS model,
                (SELECT COUNT(*) FROM history_tool_call l WHERE l.message_hash = m.record_hash) AS links,
                m.input_tokens AS inputTokens,
                m.cache_read_tokens AS cacheReadTokens,
                m.output_tokens AS outputTokens
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${folded}
         ORDER BY COALESCE(tc.started_at, m.ts), tc.source, tc.session_id, tc.seq
         LIMIT ?`,
        ...params,
    );

    const truncated = rows.length > limit;
    const finalRows = truncated ? rows.slice(0, limit) : rows;

    return {
        truncated,
        rows: finalRows,
    };
}

/** Total tool calls and errors matching a selector (fast aggregate without name/duration grouping). */
export async function toolCallErrorTotals(
    db: DbAdapter,
    sel: ArtifactSelector,
): Promise<{ calls: number; errors: number }> {
    const { where, params } = buildMessageWhere(sel);
    const row = await db.queryFirst<{ errors: number; calls: number }>(
        `WITH filtered_messages AS (
             SELECT m.record_hash FROM history_message m ${where}
         )
         SELECT COUNT(*) AS calls, SUM(tc.status = 'error') AS errors
         FROM filtered_messages fm
         CROSS JOIN history_tool_call tc ON tc.message_hash = fm.record_hash
         LIMIT ?`,
        ...params,
        1,
    );
    return {
        calls: row?.calls ?? 0,
        errors: row?.errors ?? 0,
    };
}
