import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Per-table rollup refresh watermark over `imported_at` (task 0741).
 *
 * Distinct from the turn-completeness watermark in `watermark.ts`: that one
 * answers "is this session finished", which governs whether a row should be
 * aggregated at all. This one answers "has this row been rolled up yet". The two
 * compose as `new AND complete` — every rollup read still applies the turn
 * watermark, and the refresh driver additionally selects rows at or after the
 * `imported_at` watermark.
 */

/**
 * Current definition version of the rollup derivation logic. Bumping this
 * invalidates every stored watermark: a table whose stored version differs is
 * rebuilt rather than extended from the existing watermark (R6 / R27). A
 * derivation-SQL change without a bump fails the pinned-value test.
 */
// v4 (0763 re-audit): preserve raw-only source/day rows, keep an empty loop scope
// as a no-op, and include sources first seen in the alias-update delta. Marts
// materialized under v3 must rebuild rather than extend.
export const ROLLUP_DEFINITION_VERSION = 'v4';

/** A table with no watermark row reports this sentinel state (empty watermark → stale). */
export const EMPTY_ROLLUP_WATERMARK: RollupWatermarkState = {
    importedAtWatermark: '',
    definitionVersion: '',
    updatedAt: '',
};

/** Per-table watermark state persisted in `history_board_rollup_watermark`. */
export interface RollupWatermarkState {
    importedAtWatermark: string;
    definitionVersion: string;
    updatedAt: string;
}

/** Bucketed rollup tables — the per-bucket delete-and-re-derive unit (class 1). */
export const BUCKETED_ROLLUP_TABLES = [
    'history_board_message_5m',
    'history_board_tool_5m',
    'history_board_skill_5m',
    'history_daily_stats',
    'history_board_source_daily',
] as const;

/** Keyed-aggregate rollup tables — re-derive only touched keys from bucketed tables (class 2). */
export const KEYED_ROLLUP_TABLES = [
    'history_board_session_stats',
    'history_board_model_stats',
    'history_board_tool_stats',
    'history_board_source_stats',
] as const;

/** Global-ranked rollup tables — no incremental path, recompute in full (class 3). */
export const GLOBAL_RANKED_ROLLUP_TABLES = ['history_board_loop_findings', 'history_board_ranked_steps'] as const;

/** Every rollup data table tracked by the watermark (excludes `history_board_rollup_meta`). */
export const ALL_ROLLUP_TABLES = [
    ...BUCKETED_ROLLUP_TABLES,
    ...KEYED_ROLLUP_TABLES,
    ...GLOBAL_RANKED_ROLLUP_TABLES,
] as const;

/** Per-table freshness verdict plus the stale bucket range (R3). */
export interface RollupTableFreshness {
    tableName: string;
    fresh: boolean;
    /** Distinct buckets touched by rows at or after the watermark; empty when fresh. */
    staleBuckets: string[];
}

const MSG_BUCKET_5M = `strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', m.ts) / 60 * 60 AS INTEGER), 'unixepoch')`;
const SKILL_BUCKET_5M = `strftime('%Y-%m-%dT%H:%M:00Z', CAST(strftime('%s', sc.started_at) / 60 * 60 AS INTEGER), 'unixepoch')`;
const MSG_DAY = `SUBSTR(${MSG_BUCKET_5M}, 1, 10)`;

/** Bucket expression (and source alias) used to derive stale buckets for a table. */
function staleBucketSource(table: string): { select: string; from: string; alias: string } | null {
    switch (table) {
        case 'history_board_message_5m':
        case 'history_board_tool_5m':
            return { select: MSG_BUCKET_5M, from: 'history_message', alias: 'm' };
        case 'history_board_skill_5m':
            return { select: SKILL_BUCKET_5M, from: 'history_skill_call', alias: 'sc' };
        case 'history_daily_stats':
        case 'history_board_source_daily':
            return { select: MSG_DAY, from: 'history_message', alias: 'm' };
        default:
            return null;
    }
}

/** Read all persisted watermark states into a tableName → state map. */
export async function readRollupWatermarks(db: DbAdapter): Promise<Map<string, RollupWatermarkState>> {
    const rows = await db.queryAll<{
        tableName: string;
        importedAtWatermark: string;
        definitionVersion: string;
        updatedAt: string;
    }>(
        `SELECT table_name AS tableName,
                imported_at_watermark AS importedAtWatermark,
                definition_version AS definitionVersion,
                updated_at AS updatedAt
         FROM history_board_rollup_watermark`,
    );
    const map = new Map<string, RollupWatermarkState>();
    for (const row of rows) {
        map.set(row.tableName, {
            importedAtWatermark: row.importedAtWatermark,
            definitionVersion: row.definitionVersion,
            updatedAt: row.updatedAt,
        });
    }
    return map;
}

/** Upsert a table's watermark state, stamping `updated_at` with the current time. */
export async function writeRollupWatermark(
    db: DbAdapter,
    tableName: string,
    state: Omit<RollupWatermarkState, 'updatedAt'>,
): Promise<void> {
    await db.run(
        `INSERT INTO history_board_rollup_watermark (table_name, imported_at_watermark, definition_version, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(table_name) DO UPDATE SET
             imported_at_watermark = excluded.imported_at_watermark,
             definition_version = excluded.definition_version,
             updated_at = excluded.updated_at`,
        tableName,
        state.importedAtWatermark,
        state.definitionVersion,
        new Date().toISOString(),
    );
}

/** The distinct buckets touched by rows imported at or after `watermark` for a stale table. */
async function staleBucketsForTable(db: DbAdapter, table: string, watermark: string): Promise<string[]> {
    const source = staleBucketSource(table);
    if (source === null) return [];
    const rows = await db.queryAll<{ bucket: string }>(
        `SELECT DISTINCT ${source.select} AS bucket
         FROM ${source.from} ${source.alias}
         WHERE ${source.alias}.imported_at >= ?`,
        watermark,
    );
    return rows.map((row) => row.bucket);
}

/**
 * Per-table freshness verdict for every rollup data table, plus the stale bucket
 * range (the buckets covered by imported rows at or after the watermark).
 *
 * A table is fresh iff it has a stored watermark whose version matches
 * {@link ROLLUP_DEFINITION_VERSION} and whose `imported_at` watermark covers the
 * newest imported row. A table with no watermark row is stale (sentinel).
 */
export async function rollupTableFreshness(db: DbAdapter): Promise<Map<string, RollupTableFreshness>> {
    const watermarks = await readRollupWatermarks(db);
    // The materialized-only read path tolerates exactly one raw history_message probe:
    // the newest-row single-row read. Use the same `ORDER BY rowid DESC LIMIT 1` shape
    // (never a scan or aggregate) so a fresh read is still materialized-only.
    const newestRow = await db.queryFirst<{ newest: string | null }>(
        'SELECT imported_at AS newest FROM history_message ORDER BY rowid DESC LIMIT 1',
    );
    const newest = newestRow?.newest ?? null;

    const result = new Map<string, RollupTableFreshness>();
    for (const table of ALL_ROLLUP_TABLES) {
        const wm = watermarks.get(table) ?? EMPTY_ROLLUP_WATERMARK;
        const hasWatermark = wm.importedAtWatermark !== '' || wm.definitionVersion !== '';
        const covered = newest === null || wm.importedAtWatermark >= newest;
        const fresh = hasWatermark && wm.definitionVersion === ROLLUP_DEFINITION_VERSION && covered;
        const staleBuckets = fresh ? [] : await staleBucketsForTable(db, table, wm.importedAtWatermark);
        result.set(table, { tableName: table, fresh, staleBuckets });
    }
    return result;
}
