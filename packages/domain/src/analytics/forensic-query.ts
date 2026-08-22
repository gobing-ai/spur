import type { DbAdapter } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from './artifact';
import type { SessionSpanRow, SessionToolDurationRow, TodoToolCallRow } from './derived';
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

const MESSAGE_DEDUP = `(m.rowid IN (
    SELECT MIN(rowid) FROM history_message WHERE request_id IS NOT NULL GROUP BY request_id
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
        const placeholders = sel.tools.map(() => '?').join(', ');
        clauses.push(
            'EXISTS (SELECT 1 FROM ' +
                `history_tool_call tc_filt WHERE tc_filt.message_hash = ${alias}.record_hash AND tc_filt.tool_name IN (${placeholders}))`,
        );
        params.push(...sel.tools);
    }
    if (sel.skills != null && sel.skills.length > 0) {
        const skillConditions = sel.skills.map(
            () => "tc_filt.tool_name LIKE ? ESCAPE '!' OR tc_filt.args_raw LIKE ? ESCAPE '!'",
        );
        clauses.push(
            'EXISTS (SELECT 1 FROM ' +
                `history_tool_call tc_filt WHERE tc_filt.message_hash = ${alias}.record_hash AND (${skillConditions.join(' OR ')}))`,
        );
        for (const sk of sel.skills) {
            const escaped = escapeLike(sk);
            params.push(`%${escaped}%`, `%${escaped}%`);
        }
    }
    if (sel.sessionId != null) {
        clauses.push(`${alias}.session_id = ?`);
        params.push(sel.sessionId);
    }
    if (sel.runId != null) {
        // `run_id`/`task_wbs` only exist on `provenance='spur-run'` rows, and the 0009 index
        // is `(provenance, run_id)` — the provenance equality is what makes the --run/--task
        // selectors resolve against an index rather than a scan (R3).
        clauses.push(`${alias}.provenance = 'spur-run'`);
        clauses.push(`${alias}.run_id = ?`);
        params.push(sel.runId);
    }
    if (sel.taskWbs != null) {
        clauses.push(`${alias}.provenance = 'spur-run'`);
        clauses.push(`${alias}.task_wbs = ?`);
        params.push(sel.taskWbs);
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
    // 0624 R1: claude re-emits an assistant message per attached content block —
    // all copies share `request_id`. Fold duplicates in SQL (keep MIN(rowid) per
    // request_id) instead of double-counting them; rows without a request_id
    // (all other sources, plus claude user/system lines) pass through untouched.
    const folded = withMessageDedup(where);
    const wm = applyWatermarkToWhere(folded, opts?.watermark);
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
         ${wm.where}
         GROUP BY m.source, m.model, DATE(m.ts)`,
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
        `SELECT m.source AS source, m.model AS model, DATE(m.ts) AS day,
                COUNT(*) AS toolCalls,
                SUM(tc.duration_ms) AS durationMs,
                SUM(tc.duration_ms IS NULL) AS durationUnmeasured
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${wm.where}
         GROUP BY m.source, m.model, DATE(m.ts)`,
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
         ${wm.where}
         GROUP BY tc.tool_name
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
    const folded = withMessageDedup(where);
    return db.queryAll<SkillStatRow>(
        `SELECT ${HISTORY_SKILL_NAME_SQL} AS skillName, COUNT(*) AS calls
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${folded}${folded ? ' AND' : ' WHERE'} ${HISTORY_SKILL_NAME_SQL} <> ''
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
    const folded = withMessageDedup(where);
    const sessionScoped = `${folded} AND m.session_id NOT IN ('', 'unknown', 'session')`;
    const wm = applyWatermarkToWhere(sessionScoped, opts?.watermark);

    // Message-side stats per session, selector-scoped (Q5).
    const msgRows = await db.queryAll<{
        sessionId: string;
        source: string;
        model: string | null;
        startedAt: string | null;
        endedAt: string | null;
        messages: number;
        tokens: number | null;
        inputTokens: number | null;
        cacheReadTokens: number | null;
        outputTokens: number | null;
        costUsd: number | null;
        assistantDurationMs: number | null;
        assistantDurationUnmeasured: number;
        state: 'complete' | 'in-progress';
    }>(
        `WITH selected AS (
             SELECT m.rowid AS source_rowid, m.* FROM history_message m ${wm.where}
         ), last_messages AS (
             SELECT source, session_id, record_hash, role,
                    ROW_NUMBER() OVER (PARTITION BY source, session_id ORDER BY seq DESC, source_rowid DESC) AS rank
             FROM selected WHERE disposition != 'meta'
         )
         SELECT m.session_id AS sessionId, m.source AS source, MAX(m.model) AS model,
                MIN(m.ts) AS startedAt, MAX(m.ts) AS endedAt,
                COUNT(*) AS messages,
                SUM(COALESCE(m.input_tokens, 0) + COALESCE(m.output_tokens, 0)) AS tokens,
                SUM(COALESCE(m.input_tokens, 0)) AS inputTokens,
                SUM(COALESCE(m.cache_read_tokens, 0)) AS cacheReadTokens,
                SUM(COALESCE(m.output_tokens, 0)) AS outputTokens,
                SUM(m.cost_usd) AS costUsd,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms END) AS assistantDurationMs,
                SUM(CASE WHEN m.role = 'assistant' THEN m.duration_ms IS NULL END) AS assistantDurationUnmeasured,
                CASE WHEN COALESCE(lm.role, 'unknown') IN ('assistant', 'unknown', '')
                          AND NOT EXISTS (
                              SELECT 1 FROM history_tool_call open_tc WHERE open_tc.message_hash = lm.record_hash
                          )
                     THEN 'complete' ELSE 'in-progress' END AS state
         FROM selected m
         LEFT JOIN last_messages lm
           ON lm.source = m.source AND lm.session_id = m.session_id AND lm.rank = 1
         GROUP BY m.session_id, m.source
         ORDER BY tokens DESC
         LIMIT ?`,
        ...params,
        ...wm.params,
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
         ${wm.where}
         GROUP BY m.session_id, m.source, tc.tool_name`,
        ...params,
        ...wm.params,
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

/** Repeated-call loop findings (Q4): same args_digest repeated >= 3 times. */
export async function loops(db: DbAdapter, sel: ArtifactSelector, opts?: WatermarkQueryOptions): Promise<LoopRow[]> {
    const { where, params } = buildMessageWhere(sel);
    const wm = applyWatermarkToWhere(where, opts?.watermark);
    const extra =
        wm.where === ''
            ? "WHERE tc.args_digest IS NOT NULL AND tc.session_id NOT IN ('', 'unknown', 'session')"
            : `${wm.where} AND tc.args_digest IS NOT NULL AND tc.session_id NOT IN ('', 'unknown', 'session')`;
    return db.queryAll<LoopRow>(
        `SELECT m.source AS source, tc.session_id AS sessionId,
                COALESCE(MAX(m.model), 'unknown') AS model, MIN(m.ts) AS startedAt,
                tc.tool_name AS toolName,
                tc.args_digest AS argsDigest,
                COUNT(*) AS repeats,
                MIN(tc.seq) AS firstSeq,
                MAX(tc.seq) AS lastSeq
         FROM history_tool_call tc
         JOIN history_message m ON m.record_hash = tc.message_hash
         ${extra}
         GROUP BY m.source, tc.session_id, tc.tool_name, tc.args_digest
         HAVING COUNT(*) >= 3
         ORDER BY repeats DESC`,
        ...params,
        ...wm.params,
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
    stepsWithDuration: number;
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
         ${withStepPredicates(wm.where, "m.role = 'assistant' AND (m.input_tokens IS NOT NULL OR m.output_tokens IS NOT NULL)")}
         ORDER BY (COALESCE(m.input_tokens, 0) + COALESCE(m.cache_read_tokens, 0)) DESC
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
         ${withStepPredicates(wm.where, "m.role = 'assistant' AND m.duration_ms IS NOT NULL")}
         ORDER BY m.duration_ms DESC
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
             "m.role = 'assistant' AND m.input_tokens > ? AND m.cache_read_tokens < m.input_tokens * ?",
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
             "m.role = 'assistant' AND m.input_tokens > ? AND m.cache_read_tokens < m.input_tokens * ?",
         )}
         ORDER BY m.input_tokens DESC
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
export type HistoryBucket = '5m' | '10m' | '30m' | '1h' | '4h' | '1d';

/** Supported dimensions for breakdown in token time-series. */
export type HistoryDimension = 'model' | 'source' | 'tool' | 'skill';

/** Aggregate token row floored to a time bucket interval and grouped by dimension key. */
export interface BucketedTokenRow {
    bucketStart: string;
    key: string;
    freshInputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
}

/** Chronological event row in a session execution timeline. */
export interface TimelineEventRow {
    seq: number;
    messageSeq: number;
    turnIndex: number;
    eventType: 'message' | 'tool';
    ts: string | null;
    role: string;
    source: string;
    model: string | null;
    toolName: string | null;
    durationMs: number | null;
    inputTokens: number | null;
    cacheReadTokens: number | null;
    outputTokens: number | null;
    exitCode: number | null;
    payload: string | null;
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
    '5m': 300,
    '10m': 600,
    '30m': 1800,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
};

const HISTORY_SKILL_NAME_SQL = `CASE
    WHEN LOWER(tc.tool_name) IN ('skill', 'use_skill', 'invoke_skill') AND json_valid(tc.args_raw)
    THEN COALESCE(
        CAST(json_extract(tc.args_raw, '$.skill') AS TEXT),
        CAST(json_extract(tc.args_raw, '$.skill_name') AS TEXT),
        CAST(json_extract(tc.args_raw, '$.name') AS TEXT),
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

    const folded = withMessageDedup(wm.where);

    if (dim === 'tool' || dim === 'skill') {
        const skillPredicate = dim === 'skill' ? `AND ${HISTORY_SKILL_NAME_SQL} <> ''` : '';
        const keyExpr = dim === 'tool' ? 'tc.tool_name' : HISTORY_SKILL_NAME_SQL;
        return db.queryAll<BucketedTokenRow>(
            `WITH linked AS (
                 SELECT ${bucketExpr} AS bucketStart, ${keyExpr} AS key,
                        COALESCE(m.input_tokens, 0) AS freshInputTokens,
                        COALESCE(m.cache_read_tokens, 0) AS cacheReadTokens,
                        COALESCE(m.output_tokens, 0) AS outputTokens,
                        COUNT(*) OVER (PARTITION BY m.record_hash) AS links
                 FROM history_message m
                 JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                 ${folded} ${skillPredicate}
             )
             SELECT bucketStart, key,
                    SUM(CAST(freshInputTokens AS REAL) / links) AS freshInputTokens,
                    SUM(CAST(cacheReadTokens AS REAL) / links) AS cacheReadTokens,
                    SUM(CAST(outputTokens AS REAL) / links) AS outputTokens
             FROM linked
             GROUP BY bucketStart, key
             ORDER BY bucketStart ASC`,
            ...params,
            ...wm.params,
        );
    }

    const keyExpr = dim === 'model' ? "COALESCE(m.model, 'unknown')" : 'm.source';
    return db.queryAll<BucketedTokenRow>(
        `SELECT ${bucketExpr} AS bucketStart,
                ${keyExpr} AS key,
                SUM(COALESCE(m.input_tokens, 0)) AS freshInputTokens,
                SUM(COALESCE(m.cache_read_tokens, 0)) AS cacheReadTokens,
                SUM(COALESCE(m.output_tokens, 0)) AS outputTokens
         FROM history_message m
         ${folded}
         GROUP BY bucketStart, key
         ORDER BY bucketStart ASC`,
        ...params,
        ...wm.params,
    );
}

/**
 * Chronological user/assistant/tool event stream for the timeline tab.
 */
export async function sessionTimeline(db: DbAdapter, sessionId: string, limit = 5000): Promise<TimelineEventRow[]> {
    interface JoinedRow {
        messageHash: string;
        messageSeq: number;
        turnIndex: number;
        messageTs: string | null;
        messageRole: string;
        source: string;
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
        toolPayload: string | null;
    }
    const rows = await db.queryAll<JoinedRow>(
        `SELECT m.record_hash AS messageHash, m.seq AS messageSeq,
                COALESCE(m.turn_index, m.seq) AS turnIndex,
                m.ts AS messageTs, m.role AS messageRole, m.source, m.model,
                m.duration_ms AS messageDurationMs, m.input_tokens AS inputTokens,
                m.cache_read_tokens AS cacheReadTokens, m.output_tokens AS outputTokens,
                m.content_text AS messagePayload,
                (SELECT COUNT(*) FROM history_tool_call links WHERE links.message_hash = m.record_hash) AS links,
                tc.tool_name AS toolName, COALESCE(tc.started_at, m.ts) AS toolTs,
                tc.duration_ms AS toolDurationMs, tc.status AS toolStatus,
                COALESCE(tc.error_text, tc.args_raw, tc.args_digest) AS toolPayload
         FROM history_message m
         LEFT JOIN history_tool_call tc ON tc.message_hash = m.record_hash
         WHERE m.session_id = ? AND (
             m.request_id IS NULL OR m.rowid IN (
                 SELECT MIN(dm.rowid) FROM history_message dm
                 WHERE dm.session_id = ? AND dm.request_id IS NOT NULL
                 GROUP BY dm.request_id
             )
         )
         ORDER BY m.seq, m.rowid, COALESCE(tc.seq, 0)
         LIMIT ?`,
        sessionId,
        sessionId,
        limit,
    );
    const events: Array<Omit<TimelineEventRow, 'seq'>> = [];
    let previousMessage = '';
    for (const row of rows) {
        if (row.messageHash !== previousMessage) {
            events.push({
                messageSeq: row.messageSeq,
                turnIndex: row.turnIndex,
                eventType: 'message',
                ts: row.messageTs,
                role: row.messageRole,
                source: row.source,
                model: row.model,
                toolName: null,
                durationMs: row.messageDurationMs,
                inputTokens: row.links > 0 ? 0 : row.inputTokens,
                cacheReadTokens: row.links > 0 ? 0 : row.cacheReadTokens,
                outputTokens: row.links > 0 ? 0 : row.outputTokens,
                exitCode: null,
                payload: row.messagePayload,
            });
            previousMessage = row.messageHash;
        }
        if (row.toolName !== null && events.length < limit) {
            events.push({
                messageSeq: row.messageSeq,
                turnIndex: row.turnIndex,
                eventType: 'tool',
                ts: row.toolTs,
                role: 'tool',
                source: row.source,
                model: row.model,
                toolName: row.toolName,
                durationMs: row.toolDurationMs,
                inputTokens: (row.inputTokens ?? 0) / row.links,
                cacheReadTokens: (row.cacheReadTokens ?? 0) / row.links,
                outputTokens: (row.outputTokens ?? 0) / row.links,
                exitCode: row.toolStatus === 'error' ? 1 : 0,
                payload: row.toolPayload,
            });
        }
        if (events.length >= limit) break;
    }
    return events.map((row, index) => ({ ...row, seq: index + 1 }));
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
    const folded = withMessageDedup(wm.where);
    return db.queryAll<ModelComparisonRow>(
        `WITH selected AS (
             SELECT m.record_hash, COALESCE(m.model, 'unknown') AS model, m.role, m.duration_ms,
                    m.input_tokens, m.cache_read_tokens, m.output_tokens
             FROM history_message m ${folded}
         ), message_stats AS (
             SELECT model,
                    AVG(CASE WHEN role = 'assistant' AND duration_ms > 0 THEN duration_ms END) AS speedMsMean,
                    SUM(COALESCE(input_tokens, 0)) AS fresh,
                    SUM(COALESCE(cache_read_tokens, 0)) AS cache_read,
                    SUM(COALESCE(output_tokens, 0)) AS output
             FROM selected GROUP BY model
         ), tool_stats AS (
             SELECT s.model, COUNT(*) AS calls, SUM(tc.status = 'error') AS errors
             FROM selected s JOIN history_tool_call tc ON tc.message_hash = s.record_hash
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
    const folded = withMessageDedup(wm.where);
    return db.queryAll<KpiTrendRow>(
        `WITH selected AS (
             SELECT m.record_hash, m.ts, m.input_tokens, m.cache_read_tokens, m.output_tokens, m.session_id
             FROM history_message m ${folded}
         ), tools AS (
             SELECT s.record_hash, COUNT(*) AS toolCalls
             FROM selected s JOIN history_tool_call tc ON tc.message_hash = s.record_hash
             GROUP BY s.record_hash
         )
         SELECT DATE(s.ts) AS day,
                SUM(COALESCE(s.input_tokens, 0)) AS freshInputTokens,
                SUM(COALESCE(s.output_tokens, 0)) AS outputTokens,
                SUM(COALESCE(s.cache_read_tokens, 0)) AS cacheReadTokens,
                COUNT(DISTINCT CASE WHEN s.session_id NOT IN ('', 'unknown', 'session') THEN s.session_id END) AS sessions,
                SUM(COALESCE(t.toolCalls, 0)) AS toolCalls
         FROM selected s LEFT JOIN tools t ON t.record_hash = s.record_hash
         GROUP BY DATE(s.ts)
         ORDER BY day ASC`,
        ...params,
        ...wm.params,
    );
}
