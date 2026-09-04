import type { DbAdapter, DbBatchOp } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from './artifact';
import type {
    BucketedTokenRow,
    HistoryBucket,
    HistoryDimension,
    LoopRow,
    MessageRollupRow,
    SourceSummaryRow,
    StepRow,
    ToolRollupRow,
} from './forensic-query';
import {
    cacheWasteAggregate,
    loops,
    messageRollup,
    sourceSummary,
    toolRollup,
    topCacheWasteSteps,
    topStepsByDuration,
    topStepsByTokens,
} from './forensic-query';
import { deriveDimensionMarts, deriveDimensionMartsOps } from './history-board-marts';
import {
    ALL_ROLLUP_TABLES,
    BUCKETED_ROLLUP_TABLES,
    GLOBAL_RANKED_ROLLUP_TABLES,
    KEYED_ROLLUP_TABLES,
    ROLLUP_DEFINITION_VERSION,
    readRollupWatermarks,
    rollupTableFreshness,
    writeRollupWatermark,
} from './rollup-watermark';
import { HISTORY_BOARD_ACTIVITY_DAYS, RESOLVED_TOOL_NAME_SQL } from './tool-name-sql';

// Keep the FINAL row (MAX rowid) per request_id. A streaming response re-emits an
// assistant message while it streams; the final row carries the complete cumulative usage
// (task 0624 R1), so the representative is MAX rowid — matching forensic-query's
// MESSAGE_DEDUP. NOT EXISTS form: only rows carrying a request_id (retries, a tiny fraction
// of the corpus) pay a correlated lookup, instead of a bloom-filter membership check over
// every row — same representative, far cheaper scan.
const MESSAGE_DEDUP = `(m.request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM history_message o
    WHERE o.request_id = m.request_id AND o.rowid > m.rowid
))`;

/**
 * Raw importer-owned source tables read by the rollup refresh path.
 * Used by schema assertion guards to ensure all referenced sources exist in DDL.
 */
export const ROLLUP_SOURCE_TABLES = ['history_message', 'history_tool_call', 'history_skill_call'] as const;

/**
 * SQL expression resolving the effective tool name for a history_tool_call `tc` row.
 * Re-exported from tool-name-sql so existing importers keep working.
 */
export {
    EFFECTIVE_TOOL_NAME_SQL,
    HISTORY_BOARD_ACTIVITY_DAYS,
    RESOLVED_TOOL_NAME_SQL,
} from './tool-name-sql';

const SKILL_NAME_SQL = `CASE
    WHEN LOWER(${RESOLVED_TOOL_NAME_SQL}) IN ('skill', 'use_skill', 'invoke_skill', 'slashcommand', 'slash_command', 'run_skill', 'call_skill', 'execute_skill') AND json_valid(tc.args_raw)
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

const HISTORY_BOARD_ROLLUP_VERSION = 2;

/** Materialized skill-call rollup row keyed on (bucket_start, source, skill_name, invocation_kind). */
export interface HistoryBoardSkill5mRow {
    bucketStart: string;
    source: string;
    skillName: string;
    invocationKind: string;
    calls: number;
}

/** Skill-load breakdown computed from the materialized skill rollup. */
export interface HistoryBoardSkillBreakdown {
    bySkill: HistoryBoardSkillRow[];
    bySource: Array<{ source: string; calls: number }>;
    byInvocationKind: Array<{ invocationKind: string; calls: number }>;
    trend: BucketedTokenRow[];
}

/** Input rows reused from the existing forensic analyzers when rebuilding board rollups. */
export interface HistoryBoardRollupSeed {
    historyVersion: string;
    messageRows: readonly MessageRollupRow[];
    toolRows: readonly ToolRollupRow[];
    loopRows: readonly LoopRow[];
    sourceRows: readonly SourceSummaryRow[];
    tokenSteps: readonly StepRow[];
    durationSteps: readonly StepRow[];
    cacheWasteSteps: readonly StepRow[];
    skill5m?: readonly HistoryBoardSkill5mRow[];
}

/** Numeric token aggregate grouped by one display key. */
export interface HistoryBoardAggregateRow {
    key: string;
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
}

/** Skill invocation aggregate. */
export interface HistoryBoardSkillRow {
    skillName: string;
    calls: number;
}

/** Per (source, model) token aggregate — the agent × model correlation grid. */
export interface HistoryBoardSourceModelRow {
    source: string;
    model: string;
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
}

/** Exact aggregate rows needed by the Summary projection. */
export interface HistoryBoardSummaryRollup {
    buckets: BucketedTokenRow[];
    models: HistoryBoardAggregateRow[];
    sources: HistoryBoardAggregateRow[];
    sourceModels: HistoryBoardSourceModelRow[];
    tools: Array<{ toolName: string; calls: number; errors: number; durationMs?: number; billedTokens?: number }>;
    skills: HistoryBoardSkillRow[];
    sessions: number;
    toolCalls: number;
    toolErrors: number;
}

/** Materialized Sessions-tab row. */
export interface HistoryBoardSessionRollupRow {
    source: string;
    sessionId: string;
    model: string;
    startedAt: string | null;
    endedAt: string | null;
    messages: number;
    toolCalls: number;
    errors: number;
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    assistantDurationMs: number;
    topTool: string | null;
    state: string;
}

/** Paginated Sessions-tab materialized result. */
export interface HistoryBoardSessionPage {
    items: HistoryBoardSessionRollupRow[];
    total: number;
}

/** Materialized loop finding enriched with its session dimensions. */
export interface HistoryBoardLoopRollupRow extends LoopRow {
    source: string;
    model: string;
    startedAt: string | null;
}

/** Materialized ranked step. */
export interface HistoryBoardRankedStepRow extends Omit<StepRow, 'costUsd'> {
    rank: number;
}

/** Model comparison derived from bounded board read models. */
export interface HistoryBoardModelComparisonRow {
    model: string;
    speedMsMean: number | null;
    cacheRatio: number;
    reliability: number;
    outputRatio: number;
}

/** Daily KPI trend derived from bounded board read models. */
export interface HistoryBoardKpiTrendRow {
    day: string;
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    sessions: number;
    toolCalls: number;
}

/** Source-card aggregate derived from board read models. */
export interface HistoryBoardSourceRollupRow {
    source: string;
    files: number;
    messages: number;
    lastImportedAt: string | null;
    sessions: number;
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    toolCalls: number;
    firstDate: string | null;
    lastDate: string | null;
}

/** Daily source activity derived from the 5-minute/session rollup. */
export interface HistoryBoardDailyRollupRow {
    source: string;
    day: string;
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    sessions: number;
    toolCalls: number;
}

/** Latest importer checkpoint, with a raw-row fallback for directly seeded/test databases. */
export async function historyBoardHistoryVersion(db: DbAdapter): Promise<string> {
    const checkpoint = await db.queryFirst<{ files: number; lines: number; updatedAt: string | null }>(
        `SELECT COUNT(*) AS files, COALESCE(SUM(last_imported_line), 0) AS lines, MAX(updated_at) AS updatedAt
         FROM history_import_checkpoint`,
    );
    if ((checkpoint?.files ?? 0) > 0) {
        return `v${HISTORY_BOARD_ROLLUP_VERSION}:checkpoint:${checkpoint?.updatedAt ?? ''}:${checkpoint?.files ?? 0}:${checkpoint?.lines ?? 0}`;
    }
    const row = await db.queryFirst<{ importedAt: string | null; maxRowId: number | null }>(
        `SELECT imported_at AS importedAt, rowid AS maxRowId
         FROM history_message ORDER BY rowid DESC LIMIT 1`,
    );
    return `v${HISTORY_BOARD_ROLLUP_VERSION}:message:${row?.importedAt ?? ''}:${row?.maxRowId ?? 0}`;
}

/**
 * Aggregate `history_skill_call` into the materialized skill rollup seed, bucketing
 * `started_at` to the board's shared minute floor so the read layer can re-bucket to
 * any requested interval. All-time (unfiltered): the Summary read layer applies the
 * window/source filters, matching the other board rollups.
 */
export async function skillCallRollup(db: DbAdapter): Promise<HistoryBoardSkill5mRow[]> {
    return db.queryAll<HistoryBoardSkill5mRow>(
        `SELECT strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', started_at) / 60 * 60 AS INTEGER), 'unixepoch') AS bucketStart,
                source,
                skill_name AS skillName,
                invocation_kind AS invocationKind,
                COUNT(*) AS calls
         FROM history_skill_call
         WHERE started_at IS NOT NULL
         GROUP BY bucketStart, source, skillName, invocationKind
         ORDER BY bucketStart ASC, source ASC`,
    );
}

/**
 * True only when every rollup table's watermark covers the latest imported row
 * and its definition version matches {@link ROLLUP_DEFINITION_VERSION}. Reduced
 * to a single boolean from {@link rollupTableFreshness}; `history_board_rollup_meta`
 * remains for compatibility but is no longer the freshness authority (task 0741).
 */
export async function historyBoardRollupsFresh(db: DbAdapter): Promise<boolean> {
    const freshness = await rollupTableFreshness(db);
    for (const verdict of freshness.values()) {
        if (!verdict.fresh) return false;
    }
    return true;
}

/**
 * Atomically replace the measured History Board read models. Heavy grouping stays
 * inside SQLite; bounded daily/loop/ranking rows come from the existing analyzers.
 */
export async function replaceHistoryBoardRollups(db: DbAdapter, seed: HistoryBoardRollupSeed): Promise<void> {
    const operations: DbBatchOp[] = [
        ...[
            'history_daily_stats',
            'history_board_message_5m',
            'history_board_tool_5m',
            'history_board_session_stats',
            'history_board_model_stats',
            'history_board_tool_stats',
            'history_board_loop_findings',
            'history_board_ranked_steps',
            'history_board_source_stats',
            'history_board_source_daily',
            'history_board_rollup_meta',
            'history_board_skill_5m',
        ].map((table) => ({ sql: `DELETE FROM ${table}`, params: [] })),
        {
            sql: `INSERT INTO history_board_message_5m (
                    bucket_start, session_id, source, model,
                    fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
                    messages, assistant_duration_ms, assistant_duration_samples
                )
                WITH enriched AS (
                    SELECT m.*,
                           COALESCE(
                               m.model,
                               MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END)
                                   OVER (PARTITION BY m.source, m.session_id),
                               'unknown'
                           ) AS effective_model
                    FROM history_message m
                    WHERE ${MESSAGE_DEDUP}
                )
                SELECT COALESCE(
                           strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 60 * 60 AS INTEGER), 'unixepoch'),
                           ''
                       ) AS bucket_start,
                       m.session_id, m.source, m.effective_model AS model,
                       SUM(COALESCE(m.input_tokens, 0)),
                       SUM(COALESCE(m.cache_read_tokens, 0)),
                       SUM(COALESCE(m.cache_write_tokens, 0)),
                       SUM(COALESCE(m.output_tokens, 0)),
                       COUNT(*),
                       SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(m.duration_ms, 0) ELSE 0 END),
                       SUM(CASE WHEN m.role = 'assistant' AND m.duration_ms > 0 THEN 1 ELSE 0 END)
                FROM enriched m
                GROUP BY bucket_start, m.session_id, m.source, m.effective_model`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_tool_5m (
                    bucket_start, session_id, source, model, tool_name, skill_name,
                    fresh_input_tokens_alloc, cache_read_tokens_alloc, cache_write_tokens_alloc, output_tokens_alloc,
                    calls, errors, duration_ms
                )
                WITH enriched AS (
                    SELECT m.*,
                           COALESCE(
                               m.model,
                               MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END)
                                   OVER (PARTITION BY m.source, m.session_id),
                               'unknown'
                           ) AS effective_model,
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
                               m.cache_write_tokens,
                               LAG(CASE WHEN m.role = 'assistant' THEN m.cache_write_tokens END)
                                   OVER (PARTITION BY m.source, m.session_id ORDER BY m.seq, m.rowid)
                           ) AS resolved_cache_write_tokens,
                           COALESCE(
                               m.output_tokens,
                               LAG(CASE WHEN m.role = 'assistant' THEN m.output_tokens END)
                                   OVER (PARTITION BY m.source, m.session_id ORDER BY m.seq, m.rowid)
                           ) AS resolved_output_tokens
                    FROM history_message m
                    WHERE ${MESSAGE_DEDUP}
                ), linked AS (
                    SELECT COALESCE(
                               strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 60 * 60 AS INTEGER), 'unixepoch'),
                               ''
                           ) AS bucket_start,
                           m.session_id, m.source, m.effective_model AS model,
                           ${RESOLVED_TOOL_NAME_SQL} AS tool_name, ${SKILL_NAME_SQL} AS skill_name,
                           COALESCE(m.resolved_input_tokens, 0) AS input_tokens,
                           COALESCE(m.resolved_cache_read_tokens, 0) AS cache_read_tokens,
                           COALESCE(m.resolved_cache_write_tokens, 0) AS cache_write_tokens,
                           COALESCE(m.resolved_output_tokens, 0) AS output_tokens,
                           tc.status, COALESCE(tc.duration_ms, 0) AS duration_ms,
                           COUNT(*) OVER (PARTITION BY m.record_hash) AS tools_in_message
                    FROM enriched m
                    JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                )
                SELECT bucket_start, session_id, source, model, tool_name, skill_name,
                       SUM(CAST(input_tokens AS REAL) / tools_in_message),
                       SUM(CAST(cache_read_tokens AS REAL) / tools_in_message),
                       SUM(CAST(cache_write_tokens AS REAL) / tools_in_message),
                       SUM(CAST(output_tokens AS REAL) / tools_in_message),
                       COUNT(*), SUM(status = 'error'), SUM(duration_ms)
                FROM linked
                GROUP BY bucket_start, session_id, source, model, tool_name, skill_name`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_session_stats (
                    source, session_id, model, started_at, ended_at, messages,
                    tool_calls, errors, fresh_input_tokens, cache_read_tokens, cache_write_tokens,
                    output_tokens, assistant_duration_ms, assistant_duration_samples, top_tool, state
                )
                WITH selected AS (
                    SELECT m.rowid AS source_rowid, m.* FROM history_message m
                    WHERE ${MESSAGE_DEDUP} AND m.session_id NOT IN ('', 'unknown', 'session')
                ), message_stats AS (
                    SELECT source, session_id, COALESCE(MAX(model), 'unknown') AS model,
                           MIN(ts) AS started_at, MAX(ts) AS ended_at, COUNT(*) AS messages,
                           SUM(COALESCE(input_tokens, 0)) AS fresh_input_tokens,
                           SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
                           SUM(COALESCE(cache_write_tokens, 0)) AS cache_write_tokens,
                           SUM(COALESCE(output_tokens, 0)) AS output_tokens,
                           SUM(CASE WHEN role = 'assistant' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS assistant_duration_ms,
                           SUM(CASE WHEN role = 'assistant' AND duration_ms > 0 THEN 1 ELSE 0 END) AS assistant_duration_samples
                    FROM selected GROUP BY source, session_id
                ), tool_counts AS (
                    SELECT m.source, m.session_id, COUNT(*) AS tool_calls,
                           SUM(tc.status = 'error') AS errors
                    FROM selected m JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                    GROUP BY m.source, m.session_id
                ), tool_ranks AS (
                    SELECT source, session_id, tool_name,
                           ROW_NUMBER() OVER (PARTITION BY source, session_id ORDER BY (tool_name != 'unknown') DESC, calls DESC, tool_name ASC) AS rank
                    FROM (
                        SELECT m.source, m.session_id, ${RESOLVED_TOOL_NAME_SQL} AS tool_name, COUNT(*) AS calls
                        FROM selected m JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                        GROUP BY m.source, m.session_id, ${RESOLVED_TOOL_NAME_SQL}
                    )
                ), last_messages AS (
                    SELECT source, session_id, record_hash, role,
                           ROW_NUMBER() OVER (
                               PARTITION BY source, session_id ORDER BY seq DESC, source_rowid DESC
                           ) AS rank
                    FROM selected WHERE disposition != 'meta'
                )
                SELECT ms.source, ms.session_id, ms.model, ms.started_at, ms.ended_at, ms.messages,
                       COALESCE(tc.tool_calls, 0), COALESCE(tc.errors, 0),
                       ms.fresh_input_tokens, ms.cache_read_tokens, ms.cache_write_tokens, ms.output_tokens,
                       ms.assistant_duration_ms, ms.assistant_duration_samples, tr.tool_name,
                       CASE WHEN lm.role IN ('assistant', 'unknown', '')
                                  AND NOT EXISTS (
                                      SELECT 1 FROM history_tool_call open_tc WHERE open_tc.message_hash = lm.record_hash
                                  )
                            THEN 'complete' ELSE 'in-progress' END
                FROM message_stats ms
                LEFT JOIN tool_counts tc ON tc.source = ms.source AND tc.session_id = ms.session_id
                LEFT JOIN tool_ranks tr ON tr.source = ms.source AND tr.session_id = ms.session_id AND tr.rank = 1
                LEFT JOIN last_messages lm ON lm.source = ms.source AND lm.session_id = ms.session_id AND lm.rank = 1`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_model_stats (
                    model, assistant_duration_ms, assistant_duration_samples,
                    fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, tool_calls, errors
                )
                WITH messages AS (
                    SELECT model,
                           SUM(assistant_duration_ms) AS assistant_duration_ms,
                           SUM(assistant_duration_samples) AS assistant_duration_samples,
                           SUM(fresh_input_tokens) AS fresh_input_tokens,
                           SUM(cache_read_tokens) AS cache_read_tokens,
                           SUM(cache_write_tokens) AS cache_write_tokens,
                           SUM(output_tokens) AS output_tokens
                    FROM history_board_message_5m GROUP BY model
                ), tools AS (
                    SELECT model, SUM(calls) AS tool_calls, SUM(errors) AS errors
                    FROM history_board_tool_5m GROUP BY model
                )
                SELECT m.model, m.assistant_duration_ms, m.assistant_duration_samples,
                       m.fresh_input_tokens, m.cache_read_tokens, m.cache_write_tokens, m.output_tokens,
                       COALESCE(t.tool_calls, 0), COALESCE(t.errors, 0)
                FROM messages m LEFT JOIN tools t ON t.model = m.model`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_tool_stats (
                    tool_name, skill_name, calls, errors,
                    fresh_input_tokens_alloc, cache_read_tokens_alloc, cache_write_tokens_alloc, output_tokens_alloc, duration_ms
                )
                SELECT tool_name, skill_name, SUM(calls), SUM(errors),
                       SUM(fresh_input_tokens_alloc), SUM(cache_read_tokens_alloc), SUM(cache_write_tokens_alloc), SUM(output_tokens_alloc), SUM(duration_ms)
                FROM history_board_tool_5m
                GROUP BY tool_name, skill_name`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_source_daily (
                    source, day, fresh_input_tokens, cache_read_tokens, cache_write_tokens,
                    output_tokens, sessions, tool_calls
                )
                WITH messages AS (
                    SELECT source, SUBSTR(bucket_start, 1, 10) AS day,
                           SUM(fresh_input_tokens) AS fresh_input_tokens,
                           SUM(cache_read_tokens) AS cache_read_tokens,
                           SUM(cache_write_tokens) AS cache_write_tokens,
                           SUM(output_tokens) AS output_tokens,
                           COUNT(DISTINCT CASE
                               WHEN session_id NOT IN ('', 'unknown', 'session') THEN session_id
                           END) AS sessions
                    FROM history_board_message_5m GROUP BY source, day
                ), tools AS (
                    SELECT source, SUBSTR(bucket_start, 1, 10) AS day, SUM(calls) AS tool_calls
                    FROM history_board_tool_5m GROUP BY source, day
                )
                SELECT m.source, m.day, m.fresh_input_tokens, m.cache_read_tokens, m.cache_write_tokens,
                       m.output_tokens, m.sessions, COALESCE(t.tool_calls, 0)
                FROM messages m LEFT JOIN tools t ON t.source = m.source AND t.day = m.day`,
            params: [],
        },
    ];

    const toolByDay = new Map(
        seed.toolRows.map((row) => [`${row.source}\0${row.model ?? 'unknown'}\0${row.day ?? ''}`, row] as const),
    );
    for (const row of seed.messageRows) {
        const model = row.model ?? 'unknown';
        const day = row.day ?? '';
        const tools = toolByDay.get(`${row.source}\0${model}\0${day}`);
        operations.push({
            sql: `INSERT INTO history_daily_stats (
                    source, model, day, fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
                    messages, assistant_duration_ms, assistant_duration_samples, tool_calls
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
                row.source,
                model,
                day,
                row.inputTokens ?? 0,
                row.cacheReadTokens ?? 0,
                row.cacheWriteTokens ?? 0,
                row.outputTokens ?? 0,
                row.messages,
                row.assistantDurationMs ?? 0,
                row.assistantDurationSamples ?? 0,
                tools?.toolCalls ?? 0,
            ],
        });
    }

    for (const row of seed.loopRows) {
        operations.push({
            sql: `INSERT INTO history_board_loop_findings (
                    source, session_id, model, started_at, tool_name, args_digest, repeats, first_seq, last_seq
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
                row.source,
                row.sessionId,
                row.model,
                row.startedAt,
                row.toolName,
                row.argsDigest,
                row.repeats,
                row.firstSeq,
                row.lastSeq,
            ],
        });
    }

    appendRankedSteps(operations, 'tokens', seed.tokenSteps);
    appendRankedSteps(operations, 'duration', seed.durationSteps);
    appendRankedSteps(operations, 'cache-waste', seed.cacheWasteSteps);

    for (const row of seed.skill5m ?? []) {
        operations.push({
            sql: `INSERT INTO history_board_skill_5m (
                    bucket_start, source, skill_name, invocation_kind, calls
                ) VALUES (?, ?, ?, ?, ?)`,
            params: [row.bucketStart, row.source, row.skillName, row.invocationKind, row.calls],
        });
    }

    for (const row of seed.sourceRows) {
        operations.push({
            sql: `INSERT INTO history_board_source_stats (
                    source, files, messages, last_imported_at
                ) VALUES (?, ?, ?, ?)`,
            params: [row.source, row.files, row.messages, row.lastImportedAt],
        });
    }

    operations.push({
        sql: `UPDATE history_board_source_stats AS src
              SET sessions = COALESCE((
                      SELECT COUNT(*) FROM history_board_session_stats s WHERE s.source = src.source
                  ), 0),
                  fresh_input_tokens = COALESCE((
                      SELECT SUM(d.fresh_input_tokens) FROM history_board_source_daily d WHERE d.source = src.source
                  ), 0),
                  cache_read_tokens = COALESCE((
                      SELECT SUM(d.cache_read_tokens) FROM history_board_source_daily d WHERE d.source = src.source
                  ), 0),
                  cache_write_tokens = COALESCE((
                      SELECT SUM(d.cache_write_tokens) FROM history_board_source_daily d WHERE d.source = src.source
                  ), 0),
                  output_tokens = COALESCE((
                      SELECT SUM(d.output_tokens) FROM history_board_source_daily d WHERE d.source = src.source
                  ), 0),
                  tool_calls = COALESCE((
                      SELECT SUM(d.tool_calls) FROM history_board_source_daily d WHERE d.source = src.source
                  ), 0),
                  first_date = (
                      SELECT MIN(s.started_at) FROM history_board_session_stats s WHERE s.source = src.source
                  ),
                  last_date = (
                      SELECT MAX(s.ended_at) FROM history_board_session_stats s WHERE s.source = src.source
                  )`,
        params: [],
    });

    operations.push({
        sql: `INSERT INTO history_board_rollup_meta (id, history_version, refreshed_at)
              VALUES (1, ?, ?)`,
        params: [seed.historyVersion || 'v2:initial', new Date().toISOString()],
    });
    await db.batch(operations);
    // Record the refresh watermark per table so freshness reads off the importer cursor (task 0741).
    await writeAllWatermarks(db, await newestImportedAt(db));
    // 0743: derive the day-grain dimension marts for every materialized day after the cold-start
    // full rebuild so the Summary read path can serve qualifying requests from the mart.
    await deriveDimensionMarts(db, await allMaterializedDays(db));
}

function appendRankedSteps(operations: DbBatchOp[], kind: string, rows: readonly StepRow[]): void {
    rows.forEach((row, index) => {
        operations.push({
            sql: `INSERT INTO history_board_ranked_steps (
                    kind, rank, session_id, source, ts, model,
                    input_tokens, cache_read_tokens, output_tokens, duration_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
                kind,
                index + 1,
                row.sessionId,
                row.source,
                row.ts,
                row.model,
                row.inputTokens,
                row.cacheReadTokens,
                row.outputTokens,
                row.durationMs,
            ],
        });
    });
}

interface WhereSpec {
    where: string;
    params: unknown[];
}

function buildRollupWhere(
    sel: ArtifactSelector,
    alias: string,
    options: {
        timestamp: string;
        dateOnly?: boolean;
        toolFields?: boolean;
        skillOnly?: boolean;
        toolOnly?: boolean;
    },
): WhereSpec {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since !== null) {
        clauses.push(
            `${alias}.${options.timestamp} >= ${options.dateOnly ? 'DATE(?)' : "strftime('%Y-%m-%dT%H:%M:%SZ', ?)"}`,
        );
        params.push(sel.since);
    }
    if (sel.until !== null) {
        clauses.push(
            `${alias}.${options.timestamp} <= ${options.dateOnly ? 'DATE(?)' : "strftime('%Y-%m-%dT%H:%M:%SZ', ?)"}`,
        );
        params.push(sel.until);
    }
    if (sel.sources !== null && sel.sources.length > 0) {
        clauses.push(`${alias}.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.models !== null && sel.models !== undefined && sel.models.length > 0) {
        clauses.push(`${alias}.model IN (${sel.models.map(() => '?').join(', ')})`);
        params.push(...sel.models);
    }
    if (options.toolFields && sel.tools !== null && sel.tools !== undefined && sel.tools.length > 0) {
        const validTools = sel.tools.map((t) => (t && t.trim() !== '' ? t.trim() : 'unknown'));
        if (validTools.length > 0) {
            clauses.push(`${alias}.tool_name IN (${validTools.map(() => '?').join(', ')})`);
            params.push(...validTools);
        }
    }
    if (options.toolFields && sel.skills !== null && sel.skills !== undefined && sel.skills.length > 0) {
        const validSkills = sel.skills.filter((s) => s && s.trim() !== '' && s !== 'unknown');
        if (validSkills.length > 0) {
            clauses.push(`${alias}.skill_name IN (${validSkills.map(() => '?').join(', ')})`);
            params.push(...validSkills);
        }
    }
    if (options.skillOnly) {
        clauses.push(
            `${alias}.skill_name IS NOT NULL AND TRIM(${alias}.skill_name) <> '' AND ${alias}.skill_name <> 'unknown'`,
        );
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function bucketExpression(bucket: HistoryBucket, alias: string): string {
    if (bucket === '1d') return `SUBSTR(${alias}.bucket_start, 1, 10)`;
    const seconds: Record<Exclude<HistoryBucket, '1d'>, number> = {
        '1m': 60,
        '3m': 180,
        '5m': 300,
        '10m': 600,
        '30m': 1800,
        '1h': 3600,
        '4h': 14400,
    };
    return `datetime(CAST(strftime('%s', ${alias}.bucket_start) / ${seconds[bucket]} * ${seconds[bucket]} AS INTEGER), 'unixepoch')`;
}

function filteredTokenTable(sel: ArtifactSelector): 'history_board_message_5m' | 'history_board_tool_5m' {
    return (sel.tools?.length ?? 0) > 0 || (sel.skills?.length ?? 0) > 0
        ? 'history_board_tool_5m'
        : 'history_board_message_5m';
}

/** Read the Summary aggregates from fresh materialized read models. */
export async function historyBoardSummaryFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    bucket: HistoryBucket,
    dimension: HistoryDimension,
): Promise<HistoryBoardSummaryRollup> {
    const useDaily = bucket === '1d' && (sel.tools?.length ?? 0) === 0 && (sel.skills?.length ?? 0) === 0;
    const aggregateTable = useDaily ? 'history_daily_stats' : filteredTokenTable(sel);
    const aggregateIsTool = aggregateTable === 'history_board_tool_5m';
    const seriesTable = dimension === 'tool' || dimension === 'skill' ? 'history_board_tool_5m' : aggregateTable;
    const seriesIsTool = seriesTable === 'history_board_tool_5m';
    const aggregateWhere = buildRollupWhere(sel, 'r', {
        timestamp: useDaily ? 'day' : 'bucket_start',
        dateOnly: useDaily,
        toolFields: aggregateIsTool,
    });
    const seriesUsesDaily = seriesTable === 'history_daily_stats';
    const seriesWhere = buildRollupWhere(sel, 'r', {
        timestamp: seriesUsesDaily ? 'day' : 'bucket_start',
        dateOnly: seriesUsesDaily,
        toolFields: seriesIsTool,
        skillOnly: dimension === 'skill',
        toolOnly: dimension === 'tool',
    });
    const seriesKey =
        dimension === 'model'
            ? 'r.model'
            : dimension === 'source'
              ? 'r.source'
              : dimension === 'skill'
                ? 'r.skill_name'
                : 'r.tool_name';
    const bucketExpr = seriesUsesDaily ? 'r.day' : bucketExpression(bucket, 'r');
    const tokenSelect = aggregateIsTool
        ? `SUM(r.fresh_input_tokens_alloc) AS freshInputTokens,
           SUM(r.cache_read_tokens_alloc) AS cacheReadTokens,
           SUM(r.output_tokens_alloc) AS outputTokens`
        : `SUM(r.fresh_input_tokens) AS freshInputTokens,
           SUM(r.cache_read_tokens) AS cacheReadTokens,
           SUM(r.output_tokens) AS outputTokens`;
    const callCountCol = seriesIsTool ? 'r.calls' : 'r.messages';
    const seriesTokenSelect = seriesIsTool
        ? `SUM(r.fresh_input_tokens_alloc) AS freshInputTokens,
           SUM(r.cache_read_tokens_alloc) AS cacheReadTokens,
           SUM(r.output_tokens_alloc) AS outputTokens,
           SUM(r.calls) AS calls`
        : `${tokenSelect}, SUM(${callCountCol}) AS calls`;

    const toolWhere = buildRollupWhere(sel, 'r', { timestamp: 'bucket_start', toolFields: true });
    const sessionWhere = buildSessionWhere(sel);
    const allTimeTools =
        sel.since === null &&
        sel.until === null &&
        (sel.sources?.length ?? 0) === 0 &&
        (sel.models?.length ?? 0) === 0 &&
        (sel.tools?.length ?? 0) === 0 &&
        (sel.skills?.length ?? 0) === 0;
    const toolTable = allTimeTools ? 'history_board_tool_stats' : 'history_board_tool_5m';
    const toolFilter = allTimeTools ? { where: '', params: [] } : toolWhere;
    const orderByExpr = aggregateIsTool
        ? 'SUM(r.fresh_input_tokens_alloc) + SUM(r.output_tokens_alloc)'
        : 'SUM(r.fresh_input_tokens) + SUM(r.output_tokens)';
    const [buckets, models, sources, sourceModels, tools, skills, sessionCount] = await Promise.all([
        db.queryAll<BucketedTokenRow>(
            `SELECT ${bucketExpr} AS bucketStart, ${seriesKey} AS key, ${seriesTokenSelect}
             FROM ${seriesTable} r
             ${seriesWhere.where}
             GROUP BY bucketStart, key ORDER BY bucketStart ASC`,
            ...seriesWhere.params,
        ),
        db.queryAll<HistoryBoardAggregateRow>(
            `SELECT r.model AS key, ${tokenSelect} FROM ${aggregateTable} r
             ${aggregateWhere.where} GROUP BY r.model ORDER BY ${orderByExpr} DESC`,
            ...aggregateWhere.params,
        ),
        db.queryAll<HistoryBoardAggregateRow>(
            `SELECT r.source AS key, ${tokenSelect} FROM ${aggregateTable} r
             ${aggregateWhere.where} GROUP BY r.source ORDER BY ${orderByExpr} DESC`,
            ...aggregateWhere.params,
        ),
        db.queryAll<HistoryBoardSourceModelRow>(
            `SELECT r.source AS source, r.model AS model, ${tokenSelect}
             FROM ${aggregateTable} r
             ${aggregateWhere.where}
             GROUP BY r.source, r.model
             ORDER BY r.source ASC, ${orderByExpr} DESC`,
            ...aggregateWhere.params,
        ),
        db.queryAll<{ toolName: string; calls: number; errors: number; durationMs: number; billedTokens: number }>(
            `SELECT r.tool_name AS toolName, SUM(r.calls) AS calls, SUM(r.errors) AS errors,
                    SUM(r.duration_ms) AS durationMs,
                    SUM(r.fresh_input_tokens_alloc + r.output_tokens_alloc) AS billedTokens
             FROM ${toolTable} r
             ${toolFilter.where}
             GROUP BY r.tool_name ORDER BY calls DESC`,
            ...toolFilter.params,
        ),
        db.queryAll<HistoryBoardSkillRow>(
            `SELECT r.skill_name AS skillName, SUM(r.calls) AS calls
             FROM ${toolTable} r
             ${toolFilter.where}${toolFilter.where ? ' AND' : ' WHERE'} r.skill_name <> '' AND r.skill_name <> 'unknown'
             GROUP BY r.skill_name ORDER BY calls DESC, r.skill_name ASC LIMIT 10`,
            ...toolFilter.params,
        ),
        db.queryFirst<{ sessions: number }>(
            `SELECT COUNT(*) AS sessions FROM history_board_session_stats s ${sessionWhere.where}`,
            ...sessionWhere.params,
        ),
    ]);
    const toolCalls = tools.reduce((sum, row) => sum + row.calls, 0);
    const toolErrors = tools.reduce((sum, row) => sum + row.errors, 0);

    return {
        buckets,
        models,
        sources,
        sourceModels,
        tools,
        skills,
        sessions: sessionCount?.sessions ?? 0,
        toolCalls,
        toolErrors,
    };
}

/**
 * Efficiently query only the bucketed token time-series for a single dimension
 * from materialized rollups without computing full summary breakdowns.
 */
export async function historyBoardBucketsFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    bucket: HistoryBucket,
    dimension: HistoryDimension,
): Promise<BucketedTokenRow[]> {
    const seriesTable =
        dimension === 'tool' || dimension === 'skill'
            ? 'history_board_tool_5m'
            : bucket === '1d'
              ? 'history_daily_stats'
              : 'history_board_message_5m';
    const seriesIsTool = seriesTable === 'history_board_tool_5m';
    const seriesUsesDaily = seriesTable === 'history_daily_stats';
    const seriesWhere = buildRollupWhere(sel, 'r', {
        timestamp: seriesUsesDaily ? 'day' : 'bucket_start',
        dateOnly: seriesUsesDaily,
        toolFields: seriesIsTool,
        skillOnly: dimension === 'skill',
        toolOnly: dimension === 'tool',
    });
    const seriesKey =
        dimension === 'model'
            ? 'r.model'
            : dimension === 'source'
              ? 'r.source'
              : dimension === 'skill'
                ? 'r.skill_name'
                : 'r.tool_name';
    const bucketExpr = seriesUsesDaily ? 'r.day' : bucketExpression(bucket, 'r');
    const tokenSelect = seriesIsTool
        ? `SUM(r.fresh_input_tokens_alloc) AS freshInputTokens,
           SUM(r.cache_read_tokens_alloc) AS cacheReadTokens,
           SUM(r.output_tokens_alloc) AS outputTokens`
        : `SUM(r.fresh_input_tokens) AS freshInputTokens,
           SUM(r.cache_read_tokens) AS cacheReadTokens,
           SUM(r.output_tokens) AS outputTokens`;
    const callCountCol = seriesIsTool ? 'r.calls' : 'r.messages';
    const seriesTokenSelect = `${tokenSelect}, SUM(${callCountCol}) AS calls`;

    return db.queryAll<BucketedTokenRow>(
        `SELECT ${bucketExpr} AS bucketStart, ${seriesKey} AS key, ${seriesTokenSelect}
         FROM ${seriesTable} r
         ${seriesWhere.where}
         GROUP BY bucketStart, key ORDER BY bucketStart ASC`,
        ...seriesWhere.params,
    );
}

function buildSessionWhere(sel: ArtifactSelector, alias = 's'): WhereSpec {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since !== null) {
        clauses.push(`${alias}.started_at >= ?`);
        params.push(sel.since);
    }
    if (sel.until !== null) {
        clauses.push(`${alias}.started_at <= ?`);
        params.push(sel.until);
    }
    if (sel.sources !== null && sel.sources.length > 0) {
        clauses.push(`${alias}.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.models !== null && sel.models !== undefined && sel.models.length > 0) {
        clauses.push(`${alias}.model IN (${sel.models.map(() => '?').join(', ')})`);
        params.push(...sel.models);
    }
    if ((sel.tools?.length ?? 0) > 0 || (sel.skills?.length ?? 0) > 0) {
        const nested: string[] = ['t.source = s.source', 't.session_id = s.session_id'];
        if ((sel.tools?.length ?? 0) > 0) {
            nested.push(`t.tool_name IN (${sel.tools?.map(() => '?').join(', ')})`);
            params.push(...(sel.tools ?? []));
        }
        if ((sel.skills?.length ?? 0) > 0) {
            nested.push(`t.skill_name IN (${sel.skills?.map(() => '?').join(', ')})`);
            params.push(...(sel.skills ?? []));
        }
        clauses.push(`EXISTS (SELECT 1 FROM history_board_tool_5m t WHERE ${nested.join(' AND ')})`);
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Materialized Sessions-table sort key → SQL `ORDER BY` expression. This is the parity
 * source for `SESSION_SORT_COLUMNS` in `forensic-query.ts`: a sort key added here without
 * the fallback map (or vice versa) is caught by a test, because a key that sorts one way
 * on the rollup path and another way on the stale fallback path is a user-visible
 * inconsistency that appears only when rollups go stale.
 */
export const SESSION_ORDER_COLUMNS: Record<string, string> = {
    start: 's.started_at',
    duration: 's.assistant_duration_ms',
    messages: 's.messages',
    toolCalls: 's.tool_calls',
    billedTokens: '(s.fresh_input_tokens + s.output_tokens)',
    cacheRead: 's.cache_read_tokens',
    freshInput: 's.fresh_input_tokens',
};

/** Read and paginate the materialized Sessions table with exact supported sorting. */
export async function historyBoardSessionsFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    input: { page: number; pageSize: number; sortBy: string; sortDir: 'asc' | 'desc' },
): Promise<HistoryBoardSessionPage> {
    const spec = buildSessionWhere(sel);
    const order = SESSION_ORDER_COLUMNS[input.sortBy] ?? SESSION_ORDER_COLUMNS.start;
    const offset = (input.page - 1) * input.pageSize;
    const [items, total] = await Promise.all([
        db.queryAll<HistoryBoardSessionRollupRow>(
            `SELECT s.source, s.session_id AS sessionId, s.model,
                    s.started_at AS startedAt, s.ended_at AS endedAt,
                    s.messages, s.tool_calls AS toolCalls, s.errors,
                    s.fresh_input_tokens AS freshInputTokens,
                    s.cache_read_tokens AS cacheReadTokens,
                    s.output_tokens AS outputTokens,
                    s.assistant_duration_ms AS assistantDurationMs,
                    s.top_tool AS topTool, s.state
             FROM history_board_session_stats s ${spec.where}
             ORDER BY ${order} ${input.sortDir.toUpperCase()}, s.session_id ASC
             LIMIT ? OFFSET ?`,
            ...spec.params,
            input.pageSize,
            offset,
        ),
        db.queryFirst<{ total: number }>(
            `SELECT COUNT(*) AS total FROM history_board_session_stats s ${spec.where}`,
            ...spec.params,
        ),
    ]);
    return { items, total: total?.total ?? 0 };
}

/** Read loop findings from the materialized analyzer output. */
export async function historyBoardLoopsFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    limit = 100,
): Promise<HistoryBoardLoopRollupRow[]> {
    const spec = buildSessionWhere(sel);
    return db.queryAll<HistoryBoardLoopRollupRow>(
        `SELECT l.session_id AS sessionId, l.tool_name AS toolName, l.args_digest AS argsDigest,
                l.repeats, l.first_seq AS firstSeq, l.last_seq AS lastSeq,
                l.source, l.model, l.started_at AS startedAt
         FROM history_board_loop_findings l
         JOIN history_board_session_stats s ON s.source = l.source AND s.session_id = l.session_id
         ${spec.where}
         ORDER BY l.repeats DESC LIMIT ?`,
        ...spec.params,
        limit,
    );
}

/** Read a bounded materialized step ranking. */
export async function historyBoardRankedStepsFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    kind: 'tokens' | 'duration' | 'cache-waste',
    limit = 10,
): Promise<HistoryBoardRankedStepRow[]> {
    const clauses = ['r.kind = ?'];
    const params: unknown[] = [kind];
    if (sel.since !== null) {
        clauses.push('r.ts >= ?');
        params.push(sel.since);
    }
    if (sel.until !== null) {
        clauses.push('r.ts <= ?');
        params.push(sel.until);
    }
    if (sel.sources !== null && sel.sources.length > 0) {
        clauses.push(`r.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.models !== null && sel.models !== undefined && sel.models.length > 0) {
        clauses.push(`r.model IN (${sel.models.map(() => '?').join(', ')})`);
        params.push(...sel.models);
    }
    return db.queryAll<HistoryBoardRankedStepRow>(
        `SELECT r.rank, r.session_id AS sessionId, r.source, r.ts, r.model,
                r.input_tokens AS inputTokens, r.cache_read_tokens AS cacheReadTokens,
                r.output_tokens AS outputTokens, r.duration_ms AS durationMs
         FROM history_board_ranked_steps r
         WHERE ${clauses.join(' AND ')} ORDER BY r.rank ASC LIMIT ?`,
        ...params,
        limit,
    );
}

/** Read the heaviest filtered sessions from the session rollup. */
export async function historyBoardHeavySessionsFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    limit = 5,
): Promise<HistoryBoardSessionRollupRow[]> {
    const spec = buildSessionWhere(sel);
    return db.queryAll<HistoryBoardSessionRollupRow>(
        `SELECT s.source, s.session_id AS sessionId, s.model,
                s.started_at AS startedAt, s.ended_at AS endedAt,
                s.messages, s.tool_calls AS toolCalls, s.errors,
                s.fresh_input_tokens AS freshInputTokens,
                s.cache_read_tokens AS cacheReadTokens,
                s.output_tokens AS outputTokens,
                s.assistant_duration_ms AS assistantDurationMs,
                s.top_tool AS topTool, s.state
         FROM history_board_session_stats s ${spec.where}
         ORDER BY (s.fresh_input_tokens + s.output_tokens) DESC LIMIT ?`,
        ...spec.params,
        limit,
    );
}

/** Read model comparison axes from the 5-minute message/tool read models. */
export async function historyBoardModelComparisonFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
): Promise<HistoryBoardModelComparisonRow[]> {
    const allTime =
        sel.since === null &&
        sel.until === null &&
        (sel.sources?.length ?? 0) === 0 &&
        (sel.tools?.length ?? 0) === 0 &&
        (sel.skills?.length ?? 0) === 0;
    if (allTime) {
        const models = sel.models ?? [];
        const where = models.length > 0 ? `WHERE model IN (${models.map(() => '?').join(', ')})` : '';
        return db.queryAll<HistoryBoardModelComparisonRow>(
            `SELECT model,
                    CASE WHEN assistant_duration_samples > 0
                         THEN CAST(assistant_duration_ms AS REAL) / assistant_duration_samples ELSE NULL END AS speedMsMean,
                    CASE WHEN fresh_input_tokens + cache_read_tokens + cache_write_tokens > 0
                         THEN CAST(cache_read_tokens AS REAL) / (fresh_input_tokens + cache_read_tokens + cache_write_tokens) ELSE 0 END AS cacheRatio,
                    CASE WHEN tool_calls > 0 THEN 1.0 - CAST(errors AS REAL) / tool_calls ELSE 1.0 END AS reliability,
                    CASE WHEN fresh_input_tokens + output_tokens > 0
                         THEN CAST(output_tokens AS REAL) / (fresh_input_tokens + output_tokens) ELSE 0 END AS outputRatio
             FROM history_board_model_stats ${where} ORDER BY model`,
            ...models,
        );
    }
    const messages = buildRollupWhere(sel, 'm', { timestamp: 'bucket_start' });
    const tools = buildRollupWhere(sel, 't', { timestamp: 'bucket_start', toolFields: true });
    return db.queryAll<HistoryBoardModelComparisonRow>(
        `WITH message_stats AS (
             SELECT m.model,
                    SUM(m.assistant_duration_ms) AS duration_ms,
                    SUM(m.assistant_duration_samples) AS duration_samples,
                    SUM(m.fresh_input_tokens) AS fresh,
                    SUM(m.cache_read_tokens) AS cache_read,
                    SUM(m.cache_write_tokens) AS cache_write,
                    SUM(m.output_tokens) AS output
             FROM history_board_message_5m m ${messages.where} GROUP BY m.model
         ), tool_stats AS (
             SELECT t.model, SUM(t.calls) AS calls, SUM(t.errors) AS errors
             FROM history_board_tool_5m t ${tools.where} GROUP BY t.model
         )
         SELECT m.model,
                CASE WHEN m.duration_samples > 0 THEN CAST(m.duration_ms AS REAL) / m.duration_samples ELSE NULL END AS speedMsMean,
                CASE WHEN m.fresh + m.cache_read + m.cache_write > 0 THEN CAST(m.cache_read AS REAL) / (m.fresh + m.cache_read + m.cache_write) ELSE 0 END AS cacheRatio,
                CASE WHEN COALESCE(t.calls, 0) > 0 THEN 1.0 - CAST(t.errors AS REAL) / t.calls ELSE 1.0 END AS reliability,
                CASE WHEN m.fresh + m.output > 0 THEN CAST(m.output AS REAL) / (m.fresh + m.output) ELSE 0 END AS outputRatio
         FROM message_stats m LEFT JOIN tool_stats t ON t.model = m.model
         ORDER BY m.model`,
        ...messages.params,
        ...tools.params,
    );
}

/** Read all-time source summaries and an activity window from materialized rows. */
export async function historyBoardSourcesFromRollup(
    db: DbAdapter,
    days = HISTORY_BOARD_ACTIVITY_DAYS,
): Promise<{ sources: HistoryBoardSourceRollupRow[]; daily: HistoryBoardDailyRollupRow[]; databaseBytes: number }> {
    const [sources, daily, databaseBytes] = await Promise.all([
        db.queryAll<HistoryBoardSourceRollupRow>(
            `SELECT source, files, messages, last_imported_at AS lastImportedAt,
                    sessions, fresh_input_tokens AS freshInputTokens,
                    cache_read_tokens AS cacheReadTokens, output_tokens AS outputTokens,
                    tool_calls AS toolCalls, first_date AS firstDate, last_date AS lastDate
             FROM history_board_source_stats`,
        ),
        db.queryAll<HistoryBoardDailyRollupRow>(
            `SELECT source, day, fresh_input_tokens AS freshInputTokens,
                    cache_read_tokens AS cacheReadTokens, output_tokens AS outputTokens,
                    sessions, tool_calls AS toolCalls
             FROM history_board_source_daily
             WHERE day >= DATE('now', '-' || ? || ' days')
             ORDER BY day ASC`,
            days,
        ),
        historyBoardDatabaseBytes(db),
    ]);
    return {
        sources,
        daily,
        databaseBytes,
    };
}

/**
 * Skill-load breakdown from the materialized skill rollup — never scans
 * `history_skill_call`. Counts by skill, source, invocation_kind, plus a bucketed
 * call-count trend over the selected window, all filtered through the shared selectors.
 */
export async function historyBoardSkillBreakdownFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    bucket: HistoryBucket,
): Promise<HistoryBoardSkillBreakdown> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since !== null) {
        clauses.push(`r.bucket_start >= strftime('%Y-%m-%dT%H:%M:%SZ', ?)`);
        params.push(sel.since);
    }
    if (sel.until !== null) {
        clauses.push(`r.bucket_start <= strftime('%Y-%m-%dT%H:%M:%SZ', ?)`);
        params.push(sel.until);
    }
    if (sel.sources !== null && sel.sources.length > 0) {
        clauses.push(`r.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    const validSkills = sel.skills?.filter((s) => s && s.trim() !== '' && s !== 'unknown') ?? [];
    if (validSkills.length > 0) {
        clauses.push(`r.skill_name IN (${validSkills.map(() => '?').join(', ')})`);
        params.push(...validSkills);
    }
    // Selector-only predicate (shared by the four grouping queries).
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    // bySkill additionally excludes empty / 'unknown' skill names (mirrors the parallel
    // skill query), so a bogus 'unknown' top-skill is never surfaced (0737 R7).
    const skillWhere = `${where}${where ? ' AND' : ' WHERE'} r.skill_name <> '' AND r.skill_name <> 'unknown'`;
    const [bySkill, bySource, byInvocationKind, trend] = await Promise.all([
        db.queryAll<HistoryBoardSkillRow>(
            `SELECT r.skill_name AS skillName, SUM(r.calls) AS calls
             FROM history_board_skill_5m r${skillWhere}
             GROUP BY r.skill_name ORDER BY calls DESC, r.skill_name ASC LIMIT 10`,
            ...params,
        ),
        db.queryAll<{ source: string; calls: number }>(
            `SELECT r.source AS source, SUM(r.calls) AS calls
             FROM history_board_skill_5m r${where}
             GROUP BY r.source ORDER BY calls DESC, r.source ASC`,
            ...params,
        ),
        db.queryAll<{ invocationKind: string; calls: number }>(
            `SELECT r.invocation_kind AS invocationKind, SUM(r.calls) AS calls
             FROM history_board_skill_5m r${where}
             GROUP BY r.invocation_kind ORDER BY calls DESC, r.invocation_kind ASC`,
            ...params,
        ),
        db.queryAll<BucketedTokenRow>(
            `SELECT ${bucketExpression(bucket, 'r')} AS bucketStart, r.skill_name AS key,
                    SUM(r.calls) AS calls, 0 AS freshInputTokens, 0 AS cacheReadTokens, 0 AS outputTokens
             FROM history_board_skill_5m r${skillWhere}
             GROUP BY bucketStart, r.skill_name ORDER BY bucketStart ASC`,
            ...params,
        ),
    ]);
    return { bySkill, bySource, byInvocationKind, trend };
}

/** Exact SQLite database bytes used as the honest corpus-store size. */
export async function historyBoardDatabaseBytes(db: DbAdapter): Promise<number> {
    const [pageCount, pageSize] = await Promise.all([
        db.queryFirst<{ page_count: number }>('PRAGMA page_count'),
        db.queryFirst<{ page_size: number }>('PRAGMA page_size'),
    ]);
    return (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);
}
/**
 * Daily KPI trend from materialized 5-minute read models.
 * Tokens and sessions come from the filter-routed token table; tool calls
 * always come from history_board_tool_5m so message-only views stay honest.
 */
export async function historyBoardKpiTrendFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
): Promise<HistoryBoardKpiTrendRow[]> {
    const table = filteredTokenTable(sel);
    const tokens = buildRollupWhere(sel, 'r', {
        timestamp: 'bucket_start',
        toolFields: table === 'history_board_tool_5m',
    });
    const calls = buildRollupWhere(sel, 't', { timestamp: 'bucket_start', toolFields: true });
    const isTool = table === 'history_board_tool_5m';
    const tokenCols = isTool
        ? `SUM(r.fresh_input_tokens_alloc) AS freshInputTokens,
           SUM(r.cache_read_tokens_alloc) AS cacheReadTokens,
           SUM(r.output_tokens_alloc) AS outputTokens`
        : `SUM(r.fresh_input_tokens) AS freshInputTokens,
           SUM(r.cache_read_tokens) AS cacheReadTokens,
           SUM(r.output_tokens) AS outputTokens`;
    const [tokenRows, callRows] = await Promise.all([
        db.queryAll<{
            day: string;
            freshInputTokens: number;
            cacheReadTokens: number;
            outputTokens: number;
            sessions: number;
        }>(
            `SELECT SUBSTR(r.bucket_start, 1, 10) AS day,
                    ${tokenCols},
                    COUNT(DISTINCT CASE WHEN r.session_id NOT IN ('', 'unknown', 'session') THEN r.session_id END) AS sessions
             FROM ${table} r ${tokens.where}
             GROUP BY day ORDER BY day ASC`,
            ...tokens.params,
        ),
        db.queryAll<{ day: string; toolCalls: number }>(
            `SELECT SUBSTR(t.bucket_start, 1, 10) AS day, SUM(t.calls) AS toolCalls
             FROM history_board_tool_5m t ${calls.where}
             GROUP BY day ORDER BY day ASC`,
            ...calls.params,
        ),
    ]);
    const callsByDay = new Map(callRows.map((row) => [row.day, row.toolCalls]));
    return tokenRows.map((row) => ({ ...row, toolCalls: callsByDay.get(row.day) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Incremental rollup refresh engine (task 0741)
// ---------------------------------------------------------------------------

/** Selector covering the whole corpus — used by the incremental rebuild fallback. */
const ALL_HISTORY: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    models: null,
    tools: null,
    skills: null,
    sessionId: null,
    runId: null,
    taskWbs: null,
};

const RANK_DEPTH = 1000;

/** 5-minute bucket expression over `history_message` alias `m`. */
const MSG_BUCKET_5M_SQL = `strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 60 * 60 AS INTEGER), 'unixepoch')`;
/** 5-minute bucket expression over `history_skill_call.started_at`. */
const SKILL_BUCKET_5M_SQL = `strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', started_at) / 60 * 60 AS INTEGER), 'unixepoch')`;

/** Newest `imported_at` across the whole corpus. */
async function newestImportedAt(db: DbAdapter): Promise<string> {
    const row = await db.queryFirst<{ newest: string | null }>(
        'SELECT MAX(imported_at) AS newest FROM history_message',
    );
    return row?.newest ?? '';
}

/** The distinct buckets touched by rows imported at or after `watermark`, ascending. */
/** Per-bucket imported_at range over the affected set, ascending by bucket_start. */
interface AffectedBucketRange {
    bucket: string;
    minImportedAt: string;
    maxImportedAt: string;
}

/**
 * The distinct buckets touched by rows at/after `watermark`, each with the min and max
 * `imported_at` of its rows, ascending by bucket_start.
 *
 * A single query groups by the shared 5m bucket expression so the incremental unit is the
 * bucket, and the range lets {@link refreshHistoryBoardRollupsIncremental} keep the
 * watermark from leaping past an unprocessed sibling bucket's rows (backfilled
 * `imported_at` need not increase monotonically with `bucket_start` — R7).
 */
async function affectedBucketsWithRange(db: DbAdapter, watermark: string): Promise<AffectedBucketRange[]> {
    const rows = await db.queryAll<{ bucketStart: string; minImportedAt: string; maxImportedAt: string }>(
        `SELECT ${MSG_BUCKET_5M_SQL} AS bucketStart,
                MIN(m.imported_at) AS minImportedAt,
                MAX(m.imported_at) AS maxImportedAt
         FROM history_message m
         WHERE m.imported_at >= ?
         GROUP BY bucketStart
         ORDER BY bucketStart ASC`,
        watermark,
    );
    return rows.map((row) => ({
        bucket: row.bucketStart,
        minImportedAt: row.minImportedAt,
        maxImportedAt: row.maxImportedAt,
    }));
}

function maxStr(left: string, right: string): string {
    return left > right ? left : right;
}

function minStr(left: string, right: string): string {
    return left < right ? left : right;
}

function bucketDay(bucket: string): string {
    return bucket.slice(0, 10);
}

/** UPSERT op for the per-table watermark — used inside the bucket transaction (R7). */
function watermarkUpsertOp(tableName: string, watermark: string, definitionVersion: string): DbBatchOp {
    return {
        sql: `INSERT INTO history_board_rollup_watermark (table_name, imported_at_watermark, definition_version, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(table_name) DO UPDATE SET
                  imported_at_watermark = excluded.imported_at_watermark,
                  definition_version = excluded.definition_version,
                  updated_at = excluded.updated_at`,
        params: [tableName, watermark, definitionVersion, new Date().toISOString()],
    };
}

function message5mBucketOps(bucket: string): DbBatchOp[] {
    return [
        { sql: 'DELETE FROM history_board_message_5m WHERE bucket_start = ?', params: [bucket] },
        {
            sql: `INSERT INTO history_board_message_5m (
                    bucket_start, session_id, source, model,
                    fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
                    messages, assistant_duration_ms, assistant_duration_samples
                )
                WITH enriched AS (
                    SELECT m.*,
                           COALESCE(
                               m.model,
                               MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END)
                                   OVER (PARTITION BY m.source, m.session_id),
                               'unknown'
                           ) AS effective_model
                    FROM history_message m
                    WHERE ${MESSAGE_DEDUP} AND ${MSG_BUCKET_5M_SQL} = ?
                )
                SELECT COALESCE(
                           strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 60 * 60 AS INTEGER), 'unixepoch'),
                           ''
                       ) AS bucket_start,
                       m.session_id, m.source, m.effective_model AS model,
                       SUM(COALESCE(m.input_tokens, 0)),
                       SUM(COALESCE(m.cache_read_tokens, 0)),
                       SUM(COALESCE(m.cache_write_tokens, 0)),
                       SUM(COALESCE(m.output_tokens, 0)),
                       COUNT(*),
                       SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(m.duration_ms, 0) ELSE 0 END),
                       SUM(CASE WHEN m.role = 'assistant' AND m.duration_ms > 0 THEN 1 ELSE 0 END)
                FROM enriched m
                GROUP BY bucket_start, m.session_id, m.source, m.effective_model`,
            params: [bucket],
        },
    ];
}

function tool5mBucketOps(bucket: string): DbBatchOp[] {
    return [
        { sql: 'DELETE FROM history_board_tool_5m WHERE bucket_start = ?', params: [bucket] },
        {
            sql: `INSERT INTO history_board_tool_5m (
                    bucket_start, session_id, source, model, tool_name, skill_name,
                    fresh_input_tokens_alloc, cache_read_tokens_alloc, cache_write_tokens_alloc, output_tokens_alloc,
                    calls, errors, duration_ms
                )
                WITH enriched AS (
                    SELECT m.*,
                           COALESCE(
                               m.model,
                               MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END)
                                   OVER (PARTITION BY m.source, m.session_id),
                               'unknown'
                           ) AS effective_model,
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
                               m.cache_write_tokens,
                               LAG(CASE WHEN m.role = 'assistant' THEN m.cache_write_tokens END)
                                   OVER (PARTITION BY m.source, m.session_id ORDER BY m.seq, m.rowid)
                           ) AS resolved_cache_write_tokens,
                           COALESCE(
                               m.output_tokens,
                               LAG(CASE WHEN m.role = 'assistant' THEN m.output_tokens END)
                                   OVER (PARTITION BY m.source, m.session_id ORDER BY m.seq, m.rowid)
                           ) AS resolved_output_tokens
                    FROM history_message m
                    WHERE ${MESSAGE_DEDUP} AND ${MSG_BUCKET_5M_SQL} = ?
                ), linked AS (
                    SELECT COALESCE(
                               strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 60 * 60 AS INTEGER), 'unixepoch'),
                               ''
                           ) AS bucket_start,
                           m.session_id, m.source, m.effective_model AS model,
                           ${RESOLVED_TOOL_NAME_SQL} AS tool_name, ${SKILL_NAME_SQL} AS skill_name,
                           COALESCE(m.resolved_input_tokens, 0) AS input_tokens,
                           COALESCE(m.resolved_cache_read_tokens, 0) AS cache_read_tokens,
                           COALESCE(m.resolved_cache_write_tokens, 0) AS cache_write_tokens,
                           COALESCE(m.resolved_output_tokens, 0) AS output_tokens,
                           tc.status, COALESCE(tc.duration_ms, 0) AS duration_ms,
                           COUNT(*) OVER (PARTITION BY m.record_hash) AS tools_in_message
                    FROM enriched m
                    JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                )
                SELECT bucket_start, session_id, source, model, tool_name, skill_name,
                       SUM(CAST(input_tokens AS REAL) / tools_in_message),
                       SUM(CAST(cache_read_tokens AS REAL) / tools_in_message),
                       SUM(CAST(cache_write_tokens AS REAL) / tools_in_message),
                       SUM(CAST(output_tokens AS REAL) / tools_in_message),
                       COUNT(*), SUM(status = 'error'), SUM(duration_ms)
                FROM linked
                GROUP BY bucket_start, session_id, source, model, tool_name, skill_name`,
            params: [bucket],
        },
    ];
}

function skill5mBucketOps(bucket: string): DbBatchOp[] {
    return [
        { sql: 'DELETE FROM history_board_skill_5m WHERE bucket_start = ?', params: [bucket] },
        {
            sql: `INSERT INTO history_board_skill_5m (bucket_start, source, skill_name, invocation_kind, calls)
                  SELECT ${SKILL_BUCKET_5M_SQL} AS bucket_start, source, skill_name, invocation_kind, COUNT(*) AS calls
                  FROM history_skill_call
                  WHERE started_at IS NOT NULL AND ${SKILL_BUCKET_5M_SQL} = ?
                  GROUP BY bucket_start, source, skill_name, invocation_kind`,
            params: [bucket],
        },
    ];
}

/** Re-derive daily and source-daily for the affected days from the updated bucketed tables. */
async function recomputeDailyAndSourceDaily(db: DbAdapter, days: string[]): Promise<void> {
    if (days.length === 0) return;
    const placeholders = days.map(() => '?').join(', ');
    await db.batch([
        ...days.map((day) => ({ sql: 'DELETE FROM history_daily_stats WHERE day = ?', params: [day] })),
        {
            sql: `INSERT INTO history_daily_stats (
                    source, model, day, fresh_input_tokens, cache_read_tokens, cache_write_tokens,
                    output_tokens, messages, assistant_duration_ms, assistant_duration_samples, tool_calls
                )
                WITH messages AS (
                    SELECT source, model, SUBSTR(bucket_start, 1, 10) AS day,
                           SUM(fresh_input_tokens) AS fresh_input_tokens,
                           SUM(cache_read_tokens) AS cache_read_tokens,
                           SUM(cache_write_tokens) AS cache_write_tokens,
                           SUM(output_tokens) AS output_tokens,
                           SUM(messages) AS messages,
                           SUM(assistant_duration_ms) AS assistant_duration_ms,
                           SUM(assistant_duration_samples) AS assistant_duration_samples
                    FROM history_board_message_5m
                    WHERE SUBSTR(bucket_start, 1, 10) IN (${placeholders})
                    GROUP BY source, model, day
                ), tools AS (
                    SELECT source, model, SUBSTR(bucket_start, 1, 10) AS day, SUM(calls) AS tool_calls
                    FROM history_board_tool_5m
                    WHERE SUBSTR(bucket_start, 1, 10) IN (${placeholders})
                    GROUP BY source, model, day
                )
                SELECT m.source, m.model, m.day, m.fresh_input_tokens, m.cache_read_tokens, m.cache_write_tokens,
                       m.output_tokens, m.messages, m.assistant_duration_ms, m.assistant_duration_samples,
                       COALESCE(t.tool_calls, 0)
                FROM messages m LEFT JOIN tools t ON t.source = m.source AND t.model = m.model AND t.day = m.day`,
            params: [...days, ...days],
        },
        ...days.map((day) => ({
            sql: 'DELETE FROM history_board_source_daily WHERE day = ?',
            params: [day],
        })),
        {
            sql: `INSERT INTO history_board_source_daily (
                    source, day, fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, sessions, tool_calls
                )
                WITH messages AS (
                    SELECT source, SUBSTR(bucket_start, 1, 10) AS day,
                           SUM(fresh_input_tokens) AS fresh_input_tokens,
                           SUM(cache_read_tokens) AS cache_read_tokens,
                           SUM(cache_write_tokens) AS cache_write_tokens,
                           SUM(output_tokens) AS output_tokens,
                           COUNT(DISTINCT CASE
                               WHEN session_id NOT IN ('', 'unknown', 'session') THEN session_id
                           END) AS sessions
                    FROM history_board_message_5m
                    WHERE SUBSTR(bucket_start, 1, 10) IN (${placeholders})
                    GROUP BY source, day
                ), tools AS (
                    SELECT source, SUBSTR(bucket_start, 1, 10) AS day, SUM(calls) AS tool_calls
                    FROM history_board_tool_5m
                    WHERE SUBSTR(bucket_start, 1, 10) IN (${placeholders})
                    GROUP BY source, day
                )
                SELECT m.source, m.day, m.fresh_input_tokens, m.cache_read_tokens, m.cache_write_tokens,
                       m.output_tokens, m.sessions, COALESCE(t.tool_calls, 0)
                FROM messages m LEFT JOIN tools t ON t.source = m.source AND t.day = m.day`,
            params: [...days, ...days],
        },
    ]);
}

/** Re-derive the keyed-aggregate class after the bucketed deltas land. */
async function recomputeKeyedAggregates(db: DbAdapter): Promise<void> {
    // model_stats and tool_stats derive purely from the bucketed tables (cheap, correct).
    await db.batch([
        { sql: 'DELETE FROM history_board_model_stats', params: [] },
        {
            sql: `INSERT INTO history_board_model_stats (
                    model, assistant_duration_ms, assistant_duration_samples,
                    fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, tool_calls, errors
                )
                WITH messages AS (
                    SELECT model,
                           SUM(assistant_duration_ms) AS assistant_duration_ms,
                           SUM(assistant_duration_samples) AS assistant_duration_samples,
                           SUM(fresh_input_tokens) AS fresh_input_tokens,
                           SUM(cache_read_tokens) AS cache_read_tokens,
                           SUM(cache_write_tokens) AS cache_write_tokens,
                           SUM(output_tokens) AS output_tokens
                    FROM history_board_message_5m GROUP BY model
                ), tools AS (
                    SELECT model, SUM(calls) AS tool_calls, SUM(errors) AS errors
                    FROM history_board_tool_5m GROUP BY model
                )
                SELECT m.model, m.assistant_duration_ms, m.assistant_duration_samples,
                       m.fresh_input_tokens, m.cache_read_tokens, m.cache_write_tokens, m.output_tokens,
                       COALESCE(t.tool_calls, 0), COALESCE(t.errors, 0)
                FROM messages m LEFT JOIN tools t ON t.model = m.model`,
            params: [],
        },
        { sql: 'DELETE FROM history_board_tool_stats', params: [] },
        {
            sql: `INSERT INTO history_board_tool_stats (
                    tool_name, skill_name, calls, errors,
                    fresh_input_tokens_alloc, cache_read_tokens_alloc, cache_write_tokens_alloc, output_tokens_alloc, duration_ms
                )
                SELECT tool_name, skill_name, SUM(calls), SUM(errors),
                       SUM(fresh_input_tokens_alloc), SUM(cache_read_tokens_alloc), SUM(cache_write_tokens_alloc), SUM(output_tokens_alloc), SUM(duration_ms)
                FROM history_board_tool_5m
                GROUP BY tool_name, skill_name`,
            params: [],
        },
    ]);

    // session_stats derives from raw history_message (the existing derivation); recompute in full.
    await db.batch([
        { sql: 'DELETE FROM history_board_session_stats', params: [] },
        {
            sql: `INSERT INTO history_board_session_stats (
                    source, session_id, model, started_at, ended_at, messages,
                    tool_calls, errors, fresh_input_tokens, cache_read_tokens, cache_write_tokens,
                    output_tokens, assistant_duration_ms, assistant_duration_samples, top_tool, state
                )
                WITH selected AS (
                    SELECT m.rowid AS source_rowid, m.* FROM history_message m
                    WHERE ${MESSAGE_DEDUP} AND m.session_id NOT IN ('', 'unknown', 'session')
                ), message_stats AS (
                    SELECT source, session_id, COALESCE(MAX(model), 'unknown') AS model,
                           MIN(ts) AS started_at, MAX(ts) AS ended_at, COUNT(*) AS messages,
                           SUM(COALESCE(input_tokens, 0)) AS fresh_input_tokens,
                           SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
                           SUM(COALESCE(cache_write_tokens, 0)) AS cache_write_tokens,
                           SUM(COALESCE(output_tokens, 0)) AS output_tokens,
                           SUM(CASE WHEN role = 'assistant' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS assistant_duration_ms,
                           SUM(CASE WHEN role = 'assistant' AND duration_ms > 0 THEN 1 ELSE 0 END) AS assistant_duration_samples
                    FROM selected GROUP BY source, session_id
                ), tool_counts AS (
                    SELECT m.source, m.session_id, COUNT(*) AS tool_calls,
                           SUM(tc.status = 'error') AS errors
                    FROM selected m JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                    GROUP BY m.source, m.session_id
                ), tool_ranks AS (
                    SELECT source, session_id, tool_name,
                           ROW_NUMBER() OVER (PARTITION BY source, session_id ORDER BY (tool_name != 'unknown') DESC, calls DESC, tool_name ASC) AS rank
                    FROM (
                        SELECT m.source, m.session_id, ${RESOLVED_TOOL_NAME_SQL} AS tool_name, COUNT(*) AS calls
                        FROM selected m JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                        GROUP BY m.source, m.session_id, ${RESOLVED_TOOL_NAME_SQL}
                    )
                ), last_messages AS (
                    SELECT source, session_id, record_hash, role,
                           ROW_NUMBER() OVER (
                               PARTITION BY source, session_id ORDER BY seq DESC, source_rowid DESC
                           ) AS rank
                    FROM selected WHERE disposition != 'meta'
                )
                SELECT ms.source, ms.session_id, ms.model, ms.started_at, ms.ended_at, ms.messages,
                       COALESCE(tc.tool_calls, 0), COALESCE(tc.errors, 0),
                       ms.fresh_input_tokens, ms.cache_read_tokens, ms.cache_write_tokens, ms.output_tokens,
                       ms.assistant_duration_ms, ms.assistant_duration_samples, tr.tool_name,
                       CASE WHEN lm.role IN ('assistant', 'unknown', '')
                                  AND NOT EXISTS (
                                      SELECT 1 FROM history_tool_call open_tc WHERE open_tc.message_hash = lm.record_hash
                                  )
                            THEN 'complete' ELSE 'in-progress' END
                FROM message_stats ms
                LEFT JOIN tool_counts tc ON tc.source = ms.source AND tc.session_id = ms.session_id
                LEFT JOIN tool_ranks tr ON tr.source = ms.source AND tr.session_id = ms.session_id AND tr.rank = 1
                LEFT JOIN last_messages lm ON lm.source = ms.source AND lm.session_id = ms.session_id AND lm.rank = 1`,
            params: [],
        },
    ]);

    // source_stats: import metadata from sourceSummary, plus the derived enrich update.
    const sourceRows = await sourceSummary(db, ALL_HISTORY);
    const ops: DbBatchOp[] = [{ sql: 'DELETE FROM history_board_source_stats', params: [] }];
    for (const row of sourceRows) {
        ops.push({
            sql: `INSERT INTO history_board_source_stats (source, files, messages, last_imported_at)
                  VALUES (?, ?, ?, ?)`,
            params: [row.source, row.files, row.messages, row.lastImportedAt],
        });
    }
    ops.push({
        sql: `UPDATE history_board_source_stats AS src
              SET sessions = COALESCE((SELECT COUNT(*) FROM history_board_session_stats s WHERE s.source = src.source), 0),
                  fresh_input_tokens = COALESCE((SELECT SUM(d.fresh_input_tokens) FROM history_board_source_daily d WHERE d.source = src.source), 0),
                  cache_read_tokens = COALESCE((SELECT SUM(d.cache_read_tokens) FROM history_board_source_daily d WHERE d.source = src.source), 0),
                  cache_write_tokens = COALESCE((SELECT SUM(d.cache_write_tokens) FROM history_board_source_daily d WHERE d.source = src.source), 0),
                  output_tokens = COALESCE((SELECT SUM(d.output_tokens) FROM history_board_source_daily d WHERE d.source = src.source), 0),
                  tool_calls = COALESCE((SELECT SUM(d.tool_calls) FROM history_board_source_daily d WHERE d.source = src.source), 0),
                  first_date = (SELECT MIN(s.started_at) FROM history_board_session_stats s WHERE s.source = src.source),
                  last_date = (SELECT MAX(s.ended_at) FROM history_board_session_stats s WHERE s.source = src.source)`,
        params: [],
    });
    await db.batch(ops);
}

/** Global-ranked class: recompute loop findings and ranked steps in full when any bucket changed. */
async function recomputeGlobalRanked(db: DbAdapter): Promise<void> {
    const [loopRows, tokenSteps, durationSteps, cacheWasteSteps] = await Promise.all([
        loops(db, ALL_HISTORY),
        topStepsByTokens(db, ALL_HISTORY, RANK_DEPTH),
        topStepsByDuration(db, ALL_HISTORY, RANK_DEPTH),
        topCacheWasteSteps(db, ALL_HISTORY, RANK_DEPTH),
    ]);
    const ops: DbBatchOp[] = [
        { sql: 'DELETE FROM history_board_loop_findings', params: [] },
        { sql: 'DELETE FROM history_board_ranked_steps', params: [] },
    ];
    for (const row of loopRows) {
        ops.push({
            sql: `INSERT INTO history_board_loop_findings (
                    source, session_id, model, started_at, tool_name, args_digest, repeats, first_seq, last_seq
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
                row.source,
                row.sessionId,
                row.model,
                row.startedAt,
                row.toolName,
                row.argsDigest,
                row.repeats,
                row.firstSeq,
                row.lastSeq,
            ],
        });
    }
    appendRankedSteps(ops, 'tokens', tokenSteps);
    appendRankedSteps(ops, 'duration', durationSteps);
    appendRankedSteps(ops, 'cache-waste', cacheWasteSteps);
    await db.batch(ops);
}

/** Write the watermark forwarded from `imported_at` for every rollup table. */
async function writeAllWatermarks(db: DbAdapter, watermark: string): Promise<void> {
    for (const table of ALL_ROLLUP_TABLES) {
        await writeRollupWatermark(db, table, {
            importedAtWatermark: watermark,
            definitionVersion: ROLLUP_DEFINITION_VERSION,
        });
    }
}

/** Full-rebuild fallback (no watermark, or a definition-version mismatch). */
async function rebuildAllRollups(db: DbAdapter): Promise<void> {
    const historyVersion = await historyBoardHistoryVersion(db);
    const [messageRows, toolRows, loopRows, sourceRows, tokenSteps, durationSteps, waste, cacheWasteSteps, skillRows] =
        await Promise.all([
            messageRollup(db, ALL_HISTORY),
            toolRollup(db, ALL_HISTORY),
            loops(db, ALL_HISTORY),
            sourceSummary(db, ALL_HISTORY),
            topStepsByTokens(db, ALL_HISTORY, RANK_DEPTH),
            topStepsByDuration(db, ALL_HISTORY, RANK_DEPTH),
            cacheWasteAggregate(db, ALL_HISTORY),
            topCacheWasteSteps(db, ALL_HISTORY, RANK_DEPTH),
            skillCallRollup(db),
        ]);
    await replaceHistoryBoardRollups(db, {
        historyVersion,
        messageRows,
        toolRows,
        loopRows,
        sourceRows,
        tokenSteps,
        durationSteps,
        cacheWasteSteps,
        skill5m: skillRows,
    });
    void waste;
    await writeAllWatermarks(db, await newestImportedAt(db));
}

/**
 * Incrementally refresh the History Board rollups.
 *
 * A separate engine added BESIDE {@link replaceHistoryBoardRollups} (the full-rebuild
 * path, kept for R6/R7 fallback). The incremental unit is the 5-minute bucket derived
 * from the imported rows' `bucket_start`, never from `MAX(ts)` or "the last N hours":
 * imports can backfill old `ts` values, so the bucket set must come from the rows
 * themselves (R2).
 *
 * - Bucketed class: one transaction per bucket, ascending `bucket_start`, deleting then
 *   re-deriving that bucket with `MESSAGE_DEDUP` preserved (R4/R5).
 * - The watermark advances inside each per-bucket transaction (R7): an interrupted run
 *   leaves a contiguous materialized prefix and the next run reprocesses the remainder.
 * - Keyed-aggregate and global-ranked classes are recomputed after the delta lands; the
 *   global-ranked ones are bounded top-N sets recomputed in full (no incremental path).
 */
/** Tables whose watermark advances inside the per-bucket transaction (R7 bucket recovery). */
const BUCKET_LEVEL_WATERMARK_TABLES = [
    'history_board_message_5m',
    'history_board_tool_5m',
    'history_board_skill_5m',
] as const;

/** Tables whose watermark advances only after the post-pass completes (recovery on interruption). */
const POST_WATERMARK_TABLES = [
    ...KEYED_ROLLUP_TABLES,
    ...GLOBAL_RANKED_ROLLUP_TABLES,
    'history_daily_stats',
    'history_board_source_daily',
] as const;

/** All days currently materialized in the bucketed message table — post-pass recovery scope. */
async function allMaterializedDays(db: DbAdapter): Promise<string[]> {
    const rows = await db.queryAll<{ day: string }>(
        'SELECT DISTINCT SUBSTR(bucket_start, 1, 10) AS day FROM history_board_message_5m',
    );
    return rows.map((row) => row.day);
}

/** True when any post-pass table's watermark lags the bucket-level watermark (interrupted post-pass). */
async function postPassLags(db: DbAdapter, bucketWatermark: string): Promise<boolean> {
    const watermarks = await readRollupWatermarks(db);
    for (const table of POST_WATERMARK_TABLES) {
        if ((watermarks.get(table)?.importedAtWatermark ?? '') < bucketWatermark) return true;
    }
    return false;
}

/**
 * Incrementally refresh the History board rollup tables.
 *
 * Reads `imported_at_watermark` and `definition_version` per table. When the stored
 * definition version differs from {@link ROLLUP_DEFINITION_VERSION} the whole corpus is
 * rebuilt (definition changes invalidate every stored bucket). Otherwise the affected
 * buckets are derived from the imported rows' `bucket_start` (never from `MAX(ts)`) and
 * each is rebuilt in its own transaction with the watermark advanced inside it, so an
 * interruption leaves a contiguous materialized prefix and the next run reprocesses the
 * uncommitted range. The keyed-aggregate and global-ranked classes are recomputed after
 * the bucketed deltas land; their watermarks advance last (R7).
 */
export async function refreshHistoryBoardRollupsIncremental(db: DbAdapter): Promise<void> {
    const watermarks = await readRollupWatermarks(db);
    const messageWm = watermarks.get('history_board_message_5m');
    const needsRebuild = messageWm === undefined || messageWm.definitionVersion !== ROLLUP_DEFINITION_VERSION;

    if (needsRebuild) {
        await rebuildAllRollups(db);
        return;
    }

    const affected = await affectedBucketsWithRange(db, messageWm.importedAtWatermark);
    let advanced = messageWm.importedAtWatermark;

    if (affected.length > 0) {
        // A bucket whose rows all sit at the watermark is already materialized (the prior
        // run advanced the watermark to include them); only buckets with a genuinely new
        // row (maxImportedAt > watermark) can raise `advanced` and must be respected as
        // blockers. suffixMin[i+1] = the minimum imported_at among NEW buckets not yet
        // processed — the watermark may advance only up to that boundary, so an interrupted
        // run never leaps past a still-unprocessed bucket whose rows were backfilled to an
        // earlier imported_at than a processed sibling's max (R7).
        const newMask = affected.map((a) => a.maxImportedAt > messageWm.importedAtWatermark);
        const suffixMin: string[] = new Array(affected.length + 1).fill('');
        for (let i = affected.length - 1; i >= 0; i--) {
            const bucket = affected[i];
            const next = suffixMin[i + 1];
            if (bucket === undefined || next === undefined) continue;
            suffixMin[i] = !newMask[i] ? next : next === '' ? bucket.minImportedAt : minStr(bucket.minImportedAt, next);
        }
        for (let i = 0; i < affected.length; i++) {
            const bucket = affected[i];
            if (bucket === undefined) continue;
            // Boundary buckets (rows == watermark) were already materialized; advancing past
            // them is harmless and keeps a clean run from re-selecting them forever. New
            // buckets are clamped to the next unprocessed NEW bucket's minimum.
            const nextMin = suffixMin[i + 1] ?? '';
            const safeAdvance = !newMask[i]
                ? bucket.maxImportedAt
                : nextMin === ''
                  ? bucket.maxImportedAt
                  : minStr(bucket.maxImportedAt, nextMin);
            advanced = maxStr(safeAdvance, advanced);
            const ops: DbBatchOp[] = [
                ...message5mBucketOps(bucket.bucket),
                ...tool5mBucketOps(bucket.bucket),
                ...skill5mBucketOps(bucket.bucket),
            ];
            const day = bucketDay(bucket.bucket);
            for (const table of BUCKETED_ROLLUP_TABLES) {
                const b =
                    table === 'history_daily_stats' || table === 'history_board_source_daily' ? day : bucket.bucket;
                ops.push({
                    sql: `INSERT INTO history_board_rollup_bucket (table_name, bucket_start) VALUES (?, ?)
                          ON CONFLICT(table_name, bucket_start) DO NOTHING`,
                    params: [table, b],
                });
            }
            // 0743: derive the day-grain dimension marts for this bucket's day INSIDE the same
            // per-bucket transaction. A reader never observes the five-minute rollups and the
            // daily mart disagreeing, because both land in the same atomic batch.
            ops.push(...deriveDimensionMartsOps([day]));
            // Advance ONLY the bucket-level watermarks in the transaction. Advancing every
            // table here would make an interruption between the bucket loop and the post-pass
            // unrecoverable: the post-pass tables would already be marked clean (R7).
            for (const table of BUCKET_LEVEL_WATERMARK_TABLES) {
                ops.push(watermarkUpsertOp(table, advanced, ROLLUP_DEFINITION_VERSION));
            }
            await db.batch(ops);
        }
    }

    // Nothing new and no interrupted post-pass pending → fully consistent.
    if (affected.length === 0 && !(await postPassLags(db, advanced))) return;

    const days =
        affected.length > 0 ? [...new Set(affected.map((a) => bucketDay(a.bucket)))] : await allMaterializedDays(db);
    await recomputeDailyAndSourceDaily(db, days);
    await recomputeKeyedAggregates(db);
    await recomputeGlobalRanked(db);

    // The post-pass tables are now consistent — advance their watermarks last.
    for (const table of POST_WATERMARK_TABLES) {
        await writeRollupWatermark(db, table, {
            importedAtWatermark: advanced,
            definitionVersion: ROLLUP_DEFINITION_VERSION,
        });
    }
}

// Re-export from here so ROLLUP_DEFINITION_VERSION is reachable at the frozen location.
export { ROLLUP_DEFINITION_VERSION } from './rollup-watermark';
