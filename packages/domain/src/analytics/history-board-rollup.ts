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

const MESSAGE_DEDUP = `(m.rowid IN (
    SELECT MIN(rowid) FROM history_message WHERE request_id IS NOT NULL GROUP BY request_id
) OR m.request_id IS NULL)`;

const SKILL_NAME_SQL = `CASE
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

const HISTORY_BOARD_ROLLUP_VERSION = 2;

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

/** Exact aggregate rows needed by the Summary projection. */
export interface HistoryBoardSummaryRollup {
    buckets: BucketedTokenRow[];
    models: HistoryBoardAggregateRow[];
    sources: HistoryBoardAggregateRow[];
    tools: Array<{ toolName: string; calls: number; errors: number }>;
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

/** True only when the materialized read models cover the latest imported message. */
export async function historyBoardRollupsFresh(db: DbAdapter): Promise<boolean> {
    const [meta, version] = await Promise.all([
        db.queryFirst<{ historyVersion: string }>(
            'SELECT history_version AS historyVersion FROM history_board_rollup_meta WHERE id = 1',
        ),
        historyBoardHistoryVersion(db),
    ]);
    return meta != null && meta.historyVersion === version;
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
        ].map((table) => ({ sql: `DELETE FROM ${table}`, params: [] })),
        {
            sql: `INSERT INTO history_board_message_5m (
                    bucket_start, session_id, source, model,
                    fresh_input_tokens, cache_read_tokens, output_tokens,
                    messages, assistant_duration_ms, assistant_duration_samples
                )
                SELECT COALESCE(
                           strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 300 * 300 AS INTEGER), 'unixepoch'),
                           ''
                       ) AS bucket_start,
                       m.session_id, m.source, COALESCE(m.model, 'unknown'),
                       SUM(COALESCE(m.input_tokens, 0)),
                       SUM(COALESCE(m.cache_read_tokens, 0)),
                       SUM(COALESCE(m.output_tokens, 0)),
                       COUNT(*),
                       SUM(CASE WHEN m.role = 'assistant' THEN COALESCE(m.duration_ms, 0) ELSE 0 END),
                       SUM(CASE WHEN m.role = 'assistant' AND m.duration_ms > 0 THEN 1 ELSE 0 END)
                FROM history_message m
                WHERE ${MESSAGE_DEDUP}
                GROUP BY bucket_start, m.session_id, m.source, COALESCE(m.model, 'unknown')`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_tool_5m (
                    bucket_start, session_id, source, model, tool_name, skill_name,
                    fresh_input_tokens, cache_read_tokens, output_tokens, calls, errors, duration_ms
                )
                WITH linked AS (
                    SELECT COALESCE(
                               strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 300 * 300 AS INTEGER), 'unixepoch'),
                               ''
                           ) AS bucket_start,
                           m.session_id, m.source, COALESCE(m.model, 'unknown') AS model,
                           tc.tool_name, ${SKILL_NAME_SQL} AS skill_name,
                           COALESCE(m.input_tokens, 0) AS input_tokens,
                           COALESCE(m.cache_read_tokens, 0) AS cache_read_tokens,
                           COALESCE(m.output_tokens, 0) AS output_tokens,
                           tc.status, COALESCE(tc.duration_ms, 0) AS duration_ms,
                           COUNT(*) OVER (PARTITION BY m.record_hash) AS tools_in_message
                    FROM history_message m
                    JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                    WHERE ${MESSAGE_DEDUP}
                )
                SELECT bucket_start, session_id, source, model, tool_name, skill_name,
                       SUM(CAST(input_tokens AS REAL) / tools_in_message),
                       SUM(CAST(cache_read_tokens AS REAL) / tools_in_message),
                       SUM(CAST(output_tokens AS REAL) / tools_in_message),
                       COUNT(*), SUM(status = 'error'), SUM(duration_ms)
                FROM linked
                GROUP BY bucket_start, session_id, source, model, tool_name, skill_name`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_session_stats (
                    source, session_id, model, started_at, ended_at, messages,
                    tool_calls, errors, fresh_input_tokens, cache_read_tokens,
                    output_tokens, assistant_duration_ms, top_tool, state
                )
                WITH selected AS (
                    SELECT m.rowid AS source_rowid, m.* FROM history_message m
                    WHERE ${MESSAGE_DEDUP} AND m.session_id NOT IN ('', 'unknown', 'session')
                ), message_stats AS (
                    SELECT source, session_id, COALESCE(MAX(model), 'unknown') AS model,
                           MIN(ts) AS started_at, MAX(ts) AS ended_at, COUNT(*) AS messages,
                           SUM(COALESCE(input_tokens, 0)) AS fresh_input_tokens,
                           SUM(COALESCE(cache_read_tokens, 0)) AS cache_read_tokens,
                           SUM(COALESCE(output_tokens, 0)) AS output_tokens,
                           SUM(CASE WHEN role = 'assistant' THEN COALESCE(duration_ms, 0) ELSE 0 END) AS assistant_duration_ms
                    FROM selected GROUP BY source, session_id
                ), tool_counts AS (
                    SELECT m.source, m.session_id, COUNT(*) AS tool_calls,
                           SUM(tc.status = 'error') AS errors
                    FROM selected m JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                    GROUP BY m.source, m.session_id
                ), tool_ranks AS (
                    SELECT source, session_id, tool_name,
                           ROW_NUMBER() OVER (PARTITION BY source, session_id ORDER BY calls DESC, tool_name ASC) AS rank
                    FROM (
                        SELECT m.source, m.session_id, tc.tool_name, COUNT(*) AS calls
                        FROM selected m JOIN history_tool_call tc ON tc.message_hash = m.record_hash
                        GROUP BY m.source, m.session_id, tc.tool_name
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
                       ms.fresh_input_tokens, ms.cache_read_tokens, ms.output_tokens,
                       ms.assistant_duration_ms, tr.tool_name,
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
                    fresh_input_tokens, cache_read_tokens, output_tokens, tool_calls, errors
                )
                WITH messages AS (
                    SELECT model,
                           SUM(assistant_duration_ms) AS assistant_duration_ms,
                           SUM(assistant_duration_samples) AS assistant_duration_samples,
                           SUM(fresh_input_tokens) AS fresh_input_tokens,
                           SUM(cache_read_tokens) AS cache_read_tokens,
                           SUM(output_tokens) AS output_tokens
                    FROM history_board_message_5m GROUP BY model
                ), tools AS (
                    SELECT model, SUM(calls) AS tool_calls, SUM(errors) AS errors
                    FROM history_board_tool_5m GROUP BY model
                )
                SELECT m.model, m.assistant_duration_ms, m.assistant_duration_samples,
                       m.fresh_input_tokens, m.cache_read_tokens, m.output_tokens,
                       COALESCE(t.tool_calls, 0), COALESCE(t.errors, 0)
                FROM messages m LEFT JOIN tools t ON t.model = m.model`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_tool_stats (tool_name, skill_name, calls, errors)
                  SELECT tool_name, skill_name, SUM(calls), SUM(errors)
                  FROM history_board_tool_5m GROUP BY tool_name, skill_name`,
            params: [],
        },
        {
            sql: `INSERT INTO history_board_source_daily (
                    source, day, fresh_input_tokens, cache_read_tokens,
                    output_tokens, sessions, tool_calls
                )
                WITH messages AS (
                    SELECT source, SUBSTR(bucket_start, 1, 10) AS day,
                           SUM(fresh_input_tokens) AS fresh_input_tokens,
                           SUM(cache_read_tokens) AS cache_read_tokens,
                           SUM(output_tokens) AS output_tokens,
                           COUNT(DISTINCT CASE
                               WHEN session_id NOT IN ('', 'unknown', 'session') THEN session_id
                           END) AS sessions
                    FROM history_board_message_5m GROUP BY source, day
                ), tools AS (
                    SELECT source, SUBSTR(bucket_start, 1, 10) AS day, SUM(calls) AS tool_calls
                    FROM history_board_tool_5m GROUP BY source, day
                )
                SELECT m.source, m.day, m.fresh_input_tokens, m.cache_read_tokens,
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
                    source, model, day, fresh_input_tokens, cache_read_tokens, output_tokens,
                    messages, assistant_duration_ms, tool_calls
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [
                row.source,
                model,
                day,
                row.inputTokens ?? 0,
                row.cacheReadTokens ?? 0,
                row.outputTokens ?? 0,
                row.messages,
                row.assistantDurationMs ?? 0,
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
        params: [seed.historyVersion, new Date().toISOString()],
    });
    await db.batch(operations);
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
    options: { timestamp: string; dateOnly?: boolean; toolFields?: boolean },
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
        clauses.push(`${alias}.tool_name IN (${sel.tools.map(() => '?').join(', ')})`);
        params.push(...sel.tools);
    }
    if (options.toolFields && sel.skills !== null && sel.skills !== undefined && sel.skills.length > 0) {
        clauses.push(`${alias}.skill_name IN (${sel.skills.map(() => '?').join(', ')})`);
        params.push(...sel.skills);
    }
    return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function bucketExpression(bucket: HistoryBucket, alias: string): string {
    if (bucket === '1d') return `SUBSTR(${alias}.bucket_start, 1, 10)`;
    const seconds: Record<Exclude<HistoryBucket, '1d'>, number> = {
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
    });
    const seriesExtra = dimension === 'skill' ? `${seriesWhere.where ? ' AND' : ' WHERE'} r.skill_name <> ''` : '';
    const seriesKey =
        dimension === 'model'
            ? 'r.model'
            : dimension === 'source'
              ? 'r.source'
              : dimension === 'tool'
                ? 'r.tool_name'
                : 'r.skill_name';
    const bucketExpr = seriesUsesDaily ? 'r.day' : bucketExpression(bucket, 'r');
    const tokenSelect = `SUM(r.fresh_input_tokens) AS freshInputTokens,
                         SUM(r.cache_read_tokens) AS cacheReadTokens,
                         SUM(r.output_tokens) AS outputTokens`;

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

    const [buckets, models, sources, tools, skills, sessionCount] = await Promise.all([
        db.queryAll<BucketedTokenRow>(
            `SELECT ${bucketExpr} AS bucketStart, ${seriesKey} AS key, ${tokenSelect}
             FROM ${seriesTable} r
             ${seriesWhere.where}${seriesExtra}
             GROUP BY bucketStart, key ORDER BY bucketStart ASC`,
            ...seriesWhere.params,
        ),
        db.queryAll<HistoryBoardAggregateRow>(
            `SELECT r.model AS key, ${tokenSelect} FROM ${aggregateTable} r
             ${aggregateWhere.where} GROUP BY r.model ORDER BY (SUM(r.fresh_input_tokens) + SUM(r.output_tokens)) DESC`,
            ...aggregateWhere.params,
        ),
        db.queryAll<HistoryBoardAggregateRow>(
            `SELECT r.source AS key, ${tokenSelect} FROM ${aggregateTable} r
             ${aggregateWhere.where} GROUP BY r.source ORDER BY (SUM(r.fresh_input_tokens) + SUM(r.output_tokens)) DESC`,
            ...aggregateWhere.params,
        ),
        db.queryAll<{ toolName: string; calls: number; errors: number }>(
            `SELECT r.tool_name AS toolName, SUM(r.calls) AS calls, SUM(r.errors) AS errors
             FROM ${toolTable} r ${toolFilter.where}
             GROUP BY r.tool_name ORDER BY calls DESC`,
            ...toolFilter.params,
        ),
        db.queryAll<HistoryBoardSkillRow>(
            `SELECT r.skill_name AS skillName, SUM(r.calls) AS calls
             FROM ${toolTable} r
             ${toolFilter.where}${toolFilter.where ? ' AND' : ' WHERE'} r.skill_name <> ''
             GROUP BY r.skill_name ORDER BY calls DESC LIMIT 10`,
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
        tools,
        skills,
        sessions: sessionCount?.sessions ?? 0,
        toolCalls,
        toolErrors,
    };
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

/** Read and paginate the materialized Sessions table with exact supported sorting. */
export async function historyBoardSessionsFromRollup(
    db: DbAdapter,
    sel: ArtifactSelector,
    input: { page: number; pageSize: number; sortBy: string; sortDir: 'asc' | 'desc' },
): Promise<HistoryBoardSessionPage> {
    const spec = buildSessionWhere(sel);
    const orderColumns: Record<string, string> = {
        start: 's.started_at',
        duration: 's.assistant_duration_ms',
        messages: 's.messages',
        toolCalls: 's.tool_calls',
        billedTokens: '(s.fresh_input_tokens + s.output_tokens)',
        cacheRead: 's.cache_read_tokens',
        freshInput: 's.fresh_input_tokens',
    };
    const order = orderColumns[input.sortBy] ?? orderColumns.start;
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
                    CASE WHEN fresh_input_tokens + cache_read_tokens > 0
                         THEN CAST(cache_read_tokens AS REAL) / (fresh_input_tokens + cache_read_tokens) ELSE 0 END AS cacheRatio,
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
                    SUM(m.output_tokens) AS output
             FROM history_board_message_5m m ${messages.where} GROUP BY m.model
         ), tool_stats AS (
             SELECT t.model, SUM(t.calls) AS calls, SUM(t.errors) AS errors
             FROM history_board_tool_5m t ${tools.where} GROUP BY t.model
         )
         SELECT m.model,
                CASE WHEN m.duration_samples > 0 THEN CAST(m.duration_ms AS REAL) / m.duration_samples ELSE NULL END AS speedMsMean,
                CASE WHEN m.fresh + m.cache_read > 0 THEN CAST(m.cache_read AS REAL) / (m.fresh + m.cache_read) ELSE 0 END AS cacheRatio,
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
    days = 90,
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

/** Exact SQLite database bytes used as the honest corpus-store size. */
export async function historyBoardDatabaseBytes(db: DbAdapter): Promise<number> {
    const [pageCount, pageSize] = await Promise.all([
        db.queryFirst<{ page_count: number }>('PRAGMA page_count'),
        db.queryFirst<{ page_size: number }>('PRAGMA page_size'),
    ]);
    return (pageCount?.page_count ?? 0) * (pageSize?.page_size ?? 0);
}
