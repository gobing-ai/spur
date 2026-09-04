import type { DbAdapter, DbBatchOp } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from './artifact';
import type { BucketedTokenRow, HistoryBucket, HistoryDimension } from './forensic-query';
import type {
    HistoryBoardAggregateRow,
    HistoryBoardKpiTrendRow,
    HistoryBoardSkillRow,
    HistoryBoardSourceModelRow,
    HistoryBoardSummaryRollup,
} from './history-board-rollup';

/**
 * Dimension marts (task 0743).
 *
 * Summary is the most expensive History request: with fresh rollups the fresh path reads the
 * five-minute tables (a rollup re-GROUP BY costs 0.087–0.112 s), and with stale rollups it falls
 * through to a five-way parallel fan-out over the raw tables. The two mart tables precompute what
 * Summary always asks for at daily grain, so qualifying requests become a lookup rather than a
 * per-request re-aggregation.
 *
 * Every measure column in both tables is nullable for exactly one reason: ADR-106 records a
 * measure that is not well defined at a given dimension as NULL, never as a zero that would be
 * indistinguishable from a measured absence of activity. A dimension key with genuinely zero
 * activity stores `0`.
 */

/** The four dimensions materialized in `history_board_dimension_daily`. */
export const MART_DIMENSIONS = ['model', 'source', 'tool', 'skill'] as const;
/** A dimension materialized in `history_board_dimension_daily`. */
export type MartDimension = (typeof MART_DIMENSIONS)[number];

/**
 * The routing cut line: at seven days and beyond on a daily bucket the re-aggregation cost is
 * highest and the requested shape is most stable, so materializing pays. Below a week the
 * five-minute rollups already answer in ~0.1 s and the filter combinations are far less
 * predictable. Named so it can be moved on evidence rather than rewritten.
 */
export const MART_MIN_RANGE_DAYS = 7;

/** Whether a Summary request is served from the mart tables or the five-minute rollups. */
export type SummaryReadPath = 'mart' | 'rollup';

/** Inputs to {@link resolveSummaryReadPath}. */
export interface SummaryReadPathInput {
    fresh: boolean;
    bucket: HistoryBucket;
    /** Selections spanned by the request, in days. `null` means unbounded (`all`/custom). */
    rangeDays: number | null;
    dimension: HistoryDimension;
    /** The resolved artifact selector; used to enforce the materialized filter cut line. */
    selector: ArtifactSelector;
}

/**
 * True only when all five routing conditions hold, evaluated in this order: rollups fresh, bucket
 * daily, range at or beyond {@link MART_MIN_RANGE_DAYS}, dimension in {@link MART_DIMENSIONS}, and
 * the selector is within the materialized filter cut line (unfiltered, or source-filtered on the
 * source dimension). Any other request resolves to `'rollup'` and is served from the five-minute
 * rollup tables — never from `history_message` / `history_tool_call` while rollups are fresh.
 */
export function resolveSummaryReadPath(input: SummaryReadPathInput): SummaryReadPath {
    if (!input.fresh) return 'rollup';
    if (input.bucket !== '1d') return 'rollup';
    if (input.rangeDays !== null && input.rangeDays < MART_MIN_RANGE_DAYS) return 'rollup';
    if (!(MART_DIMENSIONS as readonly string[]).includes(input.dimension)) return 'rollup';
    if (!martFilterSupported(input.selector, input.dimension)) return 'rollup';
    return 'mart';
}

/**
 * The day-grain mart cannot filter by tool / skill / model across a different dimension (a tool
 * filter on a model-dimension series, for example), so those combinations resolve from the
 * five-minute rollups. A source filter is honored only on the source dimension.
 */
function martFilterSupported(sel: ArtifactSelector, dimension: HistoryDimension): boolean {
    if ((sel.tools?.length ?? 0) > 0) return false;
    if ((sel.skills?.length ?? 0) > 0) return false;
    if ((sel.models?.length ?? 0) > 0) return false;
    if ((sel.sources?.length ?? 0) > 0 && dimension !== 'source') return false;
    return true;
}

/** A materialized `history_board_dimension_daily` row. */
export interface HistoryBoardDimensionDailyRow {
    dimension: string;
    dimensionKey: string;
    day: string;
    messages: number | null;
    toolCalls: number | null;
    skillCalls: number | null;
    freshInputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    durationSamples: number | null;
}

/** A materialized `history_board_kpi_window` row. */
export interface HistoryBoardKpiWindowRow {
    rangeKey: string;
    windowKind: 'current' | 'previous';
    messages: number | null;
    toolCalls: number | null;
    skillCalls: number | null;
    freshInputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    durationSamples: number | null;
    sessions: number | null;
    toolErrors: number | null;
}

/** The nine-member ADR-106 additive measure vector, stored once on both mart tables. */
const MEASURE_COLS =
    'messages, tool_calls, skill_calls, fresh_input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, duration_ms, duration_samples';

/** The mart INSERT column list: the ADR-106 vector plus the tool-error count the top-tools projection needs. */
const MART_INSERT_COLS = `${MEASURE_COLS}, errors`;

/**
 * Day predicate over a five-minute table's `bucket_start` (0741 R8).
 *
 * Written as a half-open range rather than `SUBSTR(bucket_start, 1, 10) = ?` so the existing
 * `(bucket_start, …)` indexes apply: the SUBSTR form is not sargable, and because the refresh
 * engine embeds these ops in *every* per-bucket transaction, it turned each mart derivation into
 * a full scan of the five-minute tables — the delta refresh then grew with total corpus size,
 * which is exactly what R8 forbids. Bind the day twice; `DATE(?, '+1 day')` closes the range.
 * Rows with an empty `bucket_start` (NULL `ts`) fall outside the range, as under SUBSTR.
 */
const MSG_DAY_PRED = "(m.bucket_start >= ? AND m.bucket_start < DATE(?, '+1 day'))";
const TOOL_DAY_PRED = "(t.bucket_start >= ? AND t.bucket_start < DATE(?, '+1 day'))";
const SKILL_DAY_PRED = "(s.bucket_start >= ? AND s.bucket_start < DATE(?, '+1 day'))";

/**
 * SQL ops that derive the day-grain mart rows for the given days. Import-free of the refresh
 * engine; the caller (the refresh engine) embeds these in the per-bucket transaction so a reader
 * never observes rollups and marts disagreeing.
 *
 * `NOT-APPLICABLE IS NULL`: a measure that is not well defined at a dimension is stored as NULL,
 * never as 0. The frozen encoding applies at:
 *   - tool dimension   -> skill_calls is NULL
 *   - skill dimension  -> tool_calls is NULL
 *   - source dimension -> duration_ms and duration_samples are NULL
 * A dimension key with genuinely zero activity stores 0 (a real, measured zero).
 */
export function deriveDimensionMartsOps(days: readonly string[]): DbBatchOp[] {
    const ops: DbBatchOp[] = [];
    for (const day of days) {
        ops.push({ sql: 'DELETE FROM history_board_dimension_daily WHERE day = ?', params: [day] });
        // model: message_5m fresh/cache/cache-write/output/messages/duration + tool_5m tool_calls.
        // skill_calls is not derivable at model grain (skill_5m carries no model column) -> NULL.
        ops.push({
            sql: `INSERT INTO history_board_dimension_daily (
                    dimension, dimension_key, day, ${MART_INSERT_COLS}
                )
                WITH msg AS (
                    SELECT m.model,
                           SUM(m.messages) AS messages,
                           SUM(m.fresh_input_tokens) AS fresh_input_tokens,
                           SUM(m.cache_read_tokens) AS cache_read_tokens,
                           SUM(m.cache_write_tokens) AS cache_write_tokens,
                           SUM(m.output_tokens) AS output_tokens,
                           SUM(m.assistant_duration_ms) AS duration_ms,
                           SUM(m.assistant_duration_samples) AS duration_samples
                    FROM history_board_message_5m m
                    WHERE ${MSG_DAY_PRED}
                    GROUP BY m.model
                ), tools AS (
                    SELECT t.model, SUM(t.calls) AS tool_calls, SUM(t.errors) AS errors
                    FROM history_board_tool_5m t
                    WHERE ${TOOL_DAY_PRED}
                    GROUP BY t.model
                )
                SELECT 'model', msg.model, ?, msg.messages, COALESCE(tools.tool_calls, 0), NULL,
                       msg.fresh_input_tokens, msg.cache_read_tokens, msg.cache_write_tokens,
                       msg.output_tokens, msg.duration_ms, msg.duration_samples, COALESCE(tools.errors, 0)
                FROM msg LEFT JOIN tools ON tools.model = msg.model`,
            params: [day, day, day, day, day],
        });
        // source: message_5m fresh/cache/output/messages + tool_5m tool_calls + skill_5m skill_calls.
        // duration_ms / duration_samples are not applicable at source grain -> NULL.
        ops.push({
            sql: `INSERT INTO history_board_dimension_daily (
                    dimension, dimension_key, day, ${MART_INSERT_COLS}
                )
                WITH msg AS (
                    SELECT m.source,
                           SUM(m.messages) AS messages,
                           SUM(m.fresh_input_tokens) AS fresh_input_tokens,
                           SUM(m.cache_read_tokens) AS cache_read_tokens,
                           SUM(m.cache_write_tokens) AS cache_write_tokens,
                           SUM(m.output_tokens) AS output_tokens
                    FROM history_board_message_5m m
                    WHERE ${MSG_DAY_PRED}
                    GROUP BY m.source
                ), tools AS (
                    SELECT t.source, SUM(t.calls) AS tool_calls, SUM(t.errors) AS errors
                    FROM history_board_tool_5m t
                    WHERE ${TOOL_DAY_PRED}
                    GROUP BY t.source
                ), skills AS (
                    SELECT s.source, SUM(s.calls) AS skill_calls
                    FROM history_board_skill_5m s
                    WHERE ${SKILL_DAY_PRED}
                    GROUP BY s.source
                )
                SELECT 'source', msg.source, ?, msg.messages, COALESCE(tools.tool_calls, 0),
                       COALESCE(skills.skill_calls, 0), msg.fresh_input_tokens, msg.cache_read_tokens,
                       msg.cache_write_tokens, msg.output_tokens, NULL, NULL, COALESCE(tools.errors, 0)
                FROM msg LEFT JOIN tools ON tools.source = msg.source
                         LEFT JOIN skills ON skills.source = msg.source`,
            params: [day, day, day, day, day, day, day],
        });
        // tool: tool_calls / fresh(_alloc) / cache(_alloc) / output(_alloc) / duration from tool_5m.
        // skill_calls is not applicable at tool grain -> NULL; messages is not derivable -> NULL.
        ops.push({
            sql: `INSERT INTO history_board_dimension_daily (
                    dimension, dimension_key, day, ${MART_INSERT_COLS}
                )
                SELECT 'tool', t.tool_name, ?, NULL, SUM(t.calls), NULL,
                       SUM(t.fresh_input_tokens_alloc), SUM(t.cache_read_tokens_alloc),
                       SUM(t.cache_write_tokens_alloc), SUM(t.output_tokens_alloc),
                       SUM(t.duration_ms), NULL, SUM(t.errors)
                FROM history_board_tool_5m t
                WHERE ${TOOL_DAY_PRED}
                GROUP BY t.tool_name`,
            params: [day, day, day],
        });
        // skill: tool_5m rows whose skill_name is a real skill. tool_calls is not applicable at
        // skill grain -> NULL; messages is not derivable -> NULL.
        ops.push({
            sql: `INSERT INTO history_board_dimension_daily (
                    dimension, dimension_key, day, ${MART_INSERT_COLS}
                )
                SELECT 'skill', t.skill_name, ?, NULL, NULL, SUM(t.calls),
                       SUM(t.fresh_input_tokens_alloc), SUM(t.cache_read_tokens_alloc),
                       SUM(t.cache_write_tokens_alloc), SUM(t.output_tokens_alloc),
                       SUM(t.duration_ms), NULL, SUM(t.errors)
                FROM history_board_tool_5m t
                WHERE ${TOOL_DAY_PRED} AND t.skill_name IS NOT NULL AND TRIM(t.skill_name) <> '' AND t.skill_name <> 'unknown'
                GROUP BY t.skill_name`,
            params: [day, day, day],
        });
    }
    // KPI window: current + previous aggregate windows for the trend range key. Re-derived from the
    // freshly-written daily mart in the same batch, so a reader never observes the rollups and the
    // marts disagreeing.
    ops.push(...deriveKpiWindowOps());
    return ops;
}

/** SQL ops (delete + insert) that recompute the current and previous KPI windows for the trend key. */
const KPI_RANGE_KEY = 'trend';
function deriveKpiWindowOps(): DbBatchOp[] {
    return [
        { sql: 'DELETE FROM history_board_kpi_window WHERE range_key = ?', params: [KPI_RANGE_KEY] },
        {
            sql: `INSERT INTO history_board_kpi_window (
                    range_key, window_kind, ${MEASURE_COLS}, sessions, tool_errors
                )
                SELECT ?, 'current', SUM(messages), SUM(tool_calls), SUM(skill_calls),
                       SUM(fresh_input_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens),
                       SUM(output_tokens), SUM(duration_ms), SUM(duration_samples), NULL, NULL
                FROM history_board_dimension_daily WHERE dimension = 'model'`,
            params: [KPI_RANGE_KEY],
        },
        {
            sql: `INSERT INTO history_board_kpi_window (
                    range_key, window_kind, ${MEASURE_COLS}, sessions, tool_errors
                )
                SELECT ?, 'previous', SUM(messages), SUM(tool_calls), SUM(skill_calls),
                       SUM(fresh_input_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens),
                       SUM(output_tokens), SUM(duration_ms), SUM(duration_samples), NULL, NULL
                FROM history_board_dimension_daily WHERE dimension = 'model'`,
            params: [KPI_RANGE_KEY],
        },
    ];
}

/**
 * Derive the mart rows for the given days in a single batch, so a reader never observes the
 * five-minute rollups and the daily mart disagreeing.
 */
export async function deriveDimensionMarts(db: DbAdapter, days: readonly string[]): Promise<void> {
    if (days.length === 0) return;
    await db.batch(deriveDimensionMartsOps(days));
}

interface WhereSpec {
    clauses: string[];
    params: unknown[];
}

/** Day-range predicates over a `day` column (the daily mart grain). */
function dayClauses(sel: ArtifactSelector): WhereSpec {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since !== null) {
        clauses.push('d.day >= DATE(?)');
        params.push(sel.since);
    }
    if (sel.until !== null) {
        clauses.push('d.day <= DATE(?)');
        params.push(sel.until);
    }
    return { clauses, params };
}

/** A `dimension_key IN (...)` predicate for the same-dimension allowlist, when present. */
function dimensionKeyClauses(sel: ArtifactSelector, dimension: MartDimension): WhereSpec {
    let values: readonly string[] | null = null;
    if (dimension === 'model') values = sel.models ?? null;
    else if (dimension === 'source') values = sel.sources;
    else if (dimension === 'tool') values = sel.tools ?? null;
    else if (dimension === 'skill') values = sel.skills ?? null;
    if (values === null || values.length === 0) return { clauses: [], params: [] };
    return {
        clauses: [`d.dimension_key IN (${values.map(() => '?').join(', ')})`],
        params: [...values],
    };
}

/** The day-grain series for a single dimension, from the daily mart. */
export async function historyBoardDimensionDailyFromMart(
    db: DbAdapter,
    sel: ArtifactSelector,
    dimension: MartDimension,
): Promise<BucketedTokenRow[]> {
    const dimensions = [...dimensionKeyClauses(sel, dimension).clauses, ...dayClauses(sel).clauses];
    const params: unknown[] = [dimension];
    for (const spec of [dimensionKeyClauses(sel, dimension), dayClauses(sel)]) params.push(...spec.params);
    const callsExpr =
        dimension === 'model' || dimension === 'source'
            ? 'd.messages'
            : dimension === 'tool'
              ? 'd.tool_calls'
              : 'd.skill_calls';
    const where =
        dimensions.length > 0 ? `WHERE d.dimension = ? AND ${dimensions.join(' AND ')}` : `WHERE d.dimension = ?`;
    return db.queryAll<BucketedTokenRow>(
        `SELECT d.day AS bucketStart, d.dimension_key AS key,
                d.fresh_input_tokens AS freshInputTokens,
                d.cache_read_tokens AS cacheReadTokens,
                d.output_tokens AS outputTokens,
                ${callsExpr} AS calls
         FROM history_board_dimension_daily d ${where}
         ORDER BY d.day ASC`,
        ...params,
    );
}

/**
 * The KPI trend points for a Summary request, from the daily mart. The trend is the per-day
 * `model`-dimension total across the requested day range.
 */
export async function historyBoardKpiWindowFromMart(
    db: DbAdapter,
    sel: ArtifactSelector,
): Promise<{
    trend: HistoryBoardKpiTrendRow[];
}> {
    const daySpec = dayClauses(sel);
    const outerClauses = ['d.dimension = ?', ...daySpec.clauses];
    const msgClauses: string[] = [];
    const msgParams: unknown[] = [];
    if (sel.since !== null) {
        msgClauses.push('SUBSTR(m.bucket_start, 1, 10) >= DATE(?)');
        msgParams.push(sel.since);
    }
    if (sel.until !== null) {
        msgClauses.push('SUBSTR(m.bucket_start, 1, 10) <= DATE(?)');
        msgParams.push(sel.until);
    }
    const params: unknown[] = [...msgParams, 'model', ...daySpec.params];
    const rows = await db.queryAll<{
        day: string;
        freshInputTokens: number | null;
        cacheReadTokens: number | null;
        outputTokens: number | null;
        toolCalls: number | null;
        sessions: number | null;
    }>(
        `SELECT d.day AS day,
                SUM(d.fresh_input_tokens) AS freshInputTokens,
                SUM(d.cache_read_tokens) AS cacheReadTokens,
                SUM(d.output_tokens) AS outputTokens,
                SUM(d.tool_calls) AS toolCalls,
                COALESCE(sess.sessions, 0) AS sessions
         FROM history_board_dimension_daily d
         LEFT JOIN (
             SELECT SUBSTR(m.bucket_start, 1, 10) AS day,
                    COUNT(DISTINCT CASE WHEN m.session_id NOT IN ('', 'unknown', 'session') THEN m.session_id END) AS sessions
             FROM history_board_message_5m m
             ${msgClauses.length > 0 ? `WHERE ${msgClauses.join(' AND ')}` : ''}
             GROUP BY day
         ) sess ON sess.day = d.day
         WHERE ${outerClauses.join(' AND ')}
         GROUP BY d.day ORDER BY d.day ASC`,
        ...params,
    );
    const trend: HistoryBoardKpiTrendRow[] = rows.map((r) => ({
        day: r.day,
        freshInputTokens: r.freshInputTokens ?? 0,
        cacheReadTokens: r.cacheReadTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        sessions: r.sessions ?? 0,
        toolCalls: r.toolCalls ?? 0,
    }));
    return { trend };
}

/**
 * Read the materialized KPI window rows for a given range key, indexed by window kind.
 */
export async function historyBoardKpiWindowRowsFromMart(
    db: DbAdapter,
    rangeKey: string,
): Promise<Map<'current' | 'previous', HistoryBoardKpiWindowRow>> {
    const rows = await db.queryAll<HistoryBoardKpiWindowRow>(
        `SELECT range_key AS rangeKey, window_kind AS windowKind, ${MEASURE_COLS}, sessions, tool_errors AS toolErrors
         FROM history_board_kpi_window WHERE range_key = ?`,
        rangeKey,
    );
    return new Map(rows.map((r) => [r.windowKind, r]));
}

/**
 * The previous-window KPIs for a Summary request, computed from the daily mart over the
 * SHIFTED prior window (mirroring the rollup read path's `previousWindowSelector`).
 *
 * The mart path must not read the static all-time `'previous'` row from
 * `history_board_kpi_window` — that row is not a true prior window, so serving it as
 * `previousKpis` for a bounded request produces a nonsense all-time-vs-30d comparison.
 * Instead the model-dimension daily mart is re-aggregated over `previousWindowSelector(sel)`
 * (a bounded request) and sessions are counted from the session rollup in the same window.
 *
 * Returns `null` for an unbounded request (`sel.since === null`), matching the rollup path,
 * where there is no bounded prior window to compare. The returned row is intended for
 * `kpiWindowRowToKpis`; it never derives from `history_message` / `history_tool_call`.
 */
export async function historyBoardPreviousWindowKpiFromMart(
    db: DbAdapter,
    sel: ArtifactSelector,
): Promise<HistoryBoardKpiWindowRow | null> {
    if (sel.since === null) return null;
    // The prior window is the same duration immediately before the requested window.
    const untilMs = sel.until === null ? Date.now() : new Date(sel.until).getTime();
    const sinceMs = new Date(sel.since).getTime();
    const duration = untilMs - sinceMs + 1;
    const prevSince = new Date(sinceMs - duration).toISOString();
    const prevUntil = new Date(untilMs - duration).toISOString();
    const prevSel: ArtifactSelector = { ...sel, since: prevSince, until: prevUntil };

    const daySpec = dayClauses(prevSel);
    const clauses = ['dimension = ?', ...daySpec.clauses];
    const params: unknown[] = ['model', ...daySpec.params];
    const row = await db.queryFirst<{
        messages: number;
        toolCalls: number;
        skillCalls: number;
        freshInputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        outputTokens: number;
        durationMs: number;
        durationSamples: number;
        toolErrors: number;
    }>(
        `SELECT SUM(messages) AS messages,
                SUM(tool_calls) AS toolCalls,
                SUM(skill_calls) AS skillCalls,
                SUM(fresh_input_tokens) AS freshInputTokens,
                SUM(cache_read_tokens) AS cacheReadTokens,
                SUM(cache_write_tokens) AS cacheWriteTokens,
                SUM(output_tokens) AS outputTokens,
                SUM(duration_ms) AS durationMs,
                SUM(duration_samples) AS durationSamples,
                SUM(errors) AS toolErrors
         FROM history_board_dimension_daily d
         WHERE ${clauses.join(' AND ')}`,
        ...params,
    );
    if (row == null) return null;
    const sessionRow = await db.queryFirst<{ sessions: number }>(
        `SELECT COUNT(*) AS sessions FROM history_board_session_stats s
         WHERE s.started_at >= ? AND s.started_at <= ?`,
        prevSince,
        prevUntil,
    );
    return {
        rangeKey: 'trend',
        windowKind: 'previous',
        messages: row.messages ?? null,
        toolCalls: row.toolCalls ?? null,
        skillCalls: row.skillCalls ?? null,
        freshInputTokens: row.freshInputTokens ?? null,
        cacheReadTokens: row.cacheReadTokens ?? null,
        cacheWriteTokens: row.cacheWriteTokens ?? null,
        outputTokens: row.outputTokens ?? null,
        durationMs: row.durationMs ?? null,
        durationSamples: row.durationSamples ?? null,
        sessions: sessionRow?.sessions ?? 0,
        toolErrors: row.toolErrors ?? null,
    };
}

/** Per-key token aggregate over the daily mart for a dimension in the requested range. */
async function martAggregate(
    db: DbAdapter,
    sel: ArtifactSelector,
    dimension: MartDimension,
): Promise<HistoryBoardAggregateRow[]> {
    const dimSpec = dimensionKeyClauses(sel, dimension);
    const daySpec = dayClauses(sel);
    const clauses = ['d.dimension = ?', ...dimSpec.clauses, ...daySpec.clauses];
    const params: unknown[] = [dimension, ...dimSpec.params, ...daySpec.params];
    return db.queryAll<HistoryBoardAggregateRow>(
        `SELECT d.dimension_key AS key,
                SUM(d.fresh_input_tokens) AS freshInputTokens,
                SUM(d.cache_read_tokens) AS cacheReadTokens,
                SUM(d.output_tokens) AS outputTokens
         FROM history_board_dimension_daily d
         WHERE ${clauses.join(' AND ')}
         GROUP BY d.dimension_key`,
        ...params,
    );
}

/** Aggregate top tools over the daily mart `tool` dimension. */
async function martTools(db: DbAdapter, sel: ArtifactSelector) {
    const daySpec = dayClauses(sel);
    const clauses = ['d.dimension = ?', ...daySpec.clauses];
    const params: unknown[] = ['tool', ...daySpec.params];
    return db.queryAll<{ toolName: string; calls: number; errors: number; durationMs: number; billedTokens: number }>(
        `SELECT d.dimension_key AS toolName, SUM(d.tool_calls) AS calls, SUM(d.errors) AS errors,
                SUM(d.duration_ms) AS durationMs,
                SUM(d.fresh_input_tokens + d.output_tokens) AS billedTokens
         FROM history_board_dimension_daily d
         WHERE ${clauses.join(' AND ')}
         GROUP BY d.dimension_key ORDER BY calls DESC`,
        ...params,
    );
}

/** Aggregate skills over the daily mart `skill` dimension. */
async function martSkills(db: DbAdapter, sel: ArtifactSelector): Promise<HistoryBoardSkillRow[]> {
    const daySpec = dayClauses(sel);
    const clauses = ['d.dimension = ?', ...daySpec.clauses];
    const params: unknown[] = ['skill', ...daySpec.params];
    return db.queryAll<HistoryBoardSkillRow>(
        `SELECT d.dimension_key AS skillName, SUM(d.skill_calls) AS calls
         FROM history_board_dimension_daily d
         WHERE ${clauses.join(' AND ')}
         GROUP BY d.dimension_key ORDER BY calls DESC, d.dimension_key ASC LIMIT 10`,
        ...params,
    );
}

/** Session count over the materialized session rollup for the requested range (a count, exact). */
async function martSessions(db: DbAdapter, sel: ArtifactSelector): Promise<number> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since !== null) {
        clauses.push('s.started_at >= ?');
        params.push(sel.since);
    }
    if (sel.until !== null) {
        clauses.push('s.started_at <= ?');
        params.push(sel.until);
    }
    if (sel.sources !== null && sel.sources.length > 0) {
        clauses.push(`s.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.models != null && sel.models.length > 0) {
        clauses.push(`s.model IN (${sel.models.map(() => '?').join(', ')})`);
        params.push(...sel.models);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const row = await db.queryFirst<{ sessions: number }>(
        `SELECT COUNT(*) AS sessions FROM history_board_session_stats s ${where}`,
        ...params,
    );
    return row?.sessions ?? 0;
}

/** Per (source, model) token aggregate. The daily mart has no source×model cross, so the agent ×
 *  model grid is read from the materialized `history_daily_stats` rollup (allowed: a rollup table,
 *  never a raw scan). */
async function martSourceModels(db: DbAdapter, sel: ArtifactSelector): Promise<HistoryBoardSourceModelRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (sel.since !== null) {
        clauses.push('r.day >= DATE(?)');
        params.push(sel.since);
    }
    if (sel.until !== null) {
        clauses.push('r.day <= DATE(?)');
        params.push(sel.until);
    }
    if (sel.sources !== null && sel.sources.length > 0) {
        clauses.push(`r.source IN (${sel.sources.map(() => '?').join(', ')})`);
        params.push(...sel.sources);
    }
    if (sel.models != null && sel.models.length > 0) {
        clauses.push(`r.model IN (${sel.models.map(() => '?').join(', ')})`);
        params.push(...sel.models);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.queryAll<HistoryBoardSourceModelRow>(
        `SELECT r.source AS source, r.model AS model,
                SUM(r.fresh_input_tokens) AS freshInputTokens,
                SUM(r.cache_read_tokens) AS cacheReadTokens,
                SUM(r.output_tokens) AS outputTokens
         FROM history_daily_stats r ${where}
         GROUP BY r.source, r.model ORDER BY r.source ASC`,
        ...params,
    );
}

/**
 * Compose the materialized Summary aggregates for a mart-eligible request from the daily mart.
 */
export async function historyBoardSummaryFromMart(
    db: DbAdapter,
    sel: ArtifactSelector,
    dimension: MartDimension,
): Promise<HistoryBoardSummaryRollup> {
    const buckets = await historyBoardDimensionDailyFromMart(db, sel, dimension);
    const [models, sources, sourceModels, tools, skills, sessions] = await Promise.all([
        martAggregate(db, sel, 'model'),
        martAggregate(db, sel, 'source'),
        martSourceModels(db, sel),
        martTools(db, sel),
        martSkills(db, sel),
        martSessions(db, sel),
    ]);
    const toolCalls = tools.reduce((sum, row) => sum + row.calls, 0);
    const toolErrors = tools.reduce((sum, row) => sum + row.errors, 0);
    return { buckets, models, sources, sourceModels, tools, skills, sessions, toolCalls, toolErrors };
}
