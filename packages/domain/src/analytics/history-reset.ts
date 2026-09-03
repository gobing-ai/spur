import type { DbAdapter } from '@gobing-ai/ts-db';
import { IMPORTER_OWNED_TABLES } from '@gobing-ai/ts-llm-jsonl-importer';

/**
 * Tables owned by Spur (14 tables): session attribution, daily stats, and History Board rollups.
 * Kept explicit (axis one of ADR-105: table DDL by layer).
 */
export const SPUR_OWNED_HISTORY_TABLES: readonly string[] = [
    // session attribution
    'history_run_session',
    'history_task_session',
    // tool alias mapping
    'history_tool_alias_map',
    // derived analytics
    'history_daily_stats',
    'history_board_loop_findings',
    'history_board_message_5m',
    'history_board_model_stats',
    'history_board_ranked_steps',
    'history_board_rollup_meta',
    'history_board_session_stats',
    'history_board_skill_5m',
    'history_board_source_daily',
    'history_board_source_stats',
    'history_board_tool_5m',
    'history_board_tool_stats',
];

/**
 * Every `history_*` table: normalized import output, per-source ETL, board rollups,
 * daily stats, and importer bookkeeping (checkpoint/ledger). All of it is derived data
 * that a full re-import rebuilds. Never includes task corpus or run provenance tables
 * (`task_run_links` survives a reset so run-chain attribution re-resolves after
 * re-import).
 *
 * Sourced from the importer's exported registry (`IMPORTER_OWNED_TABLES`) plus Spur's
 * explicit list (`SPUR_OWNED_HISTORY_TABLES`). Kept explicit (not scraped from sqlite_master
 * at runtime) so a reset only ever wipes a consciously listed table; {@link resetHistoryTables}
 * reports any unlisted `history_*` table it finds instead of deleting it.
 */
export const HISTORY_RESET_TABLES: readonly string[] = [...IMPORTER_OWNED_TABLES, ...SPUR_OWNED_HISTORY_TABLES];

/** Result of a {@link resetHistoryTables} run. */
export interface HistoryResetResult {
    /** Listed tables that existed and were wiped. */
    readonly cleared: readonly string[];
    /** Listed tables absent from this database (e.g. pre-migration). */
    readonly skipped: readonly string[];
    /** Unlisted `history_*` tables found and deliberately NOT wiped — a schema-drift signal. */
    readonly unknown: readonly string[];
}

/**
 * Wipe all history tables in one atomic batch. A fresh full `spur history import`
 * followed by `spur history analyze` rebuilds everything from source JSONL.
 */
export async function resetHistoryTables(db: DbAdapter): Promise<HistoryResetResult> {
    const rows = await db.queryAll<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'history\\_%' ESCAPE '\\'",
    );
    const existing = new Set(rows.map((r) => r.name));
    const cleared = HISTORY_RESET_TABLES.filter((t) => existing.has(t));
    const skipped = HISTORY_RESET_TABLES.filter((t) => !existing.has(t));
    const known = new Set(HISTORY_RESET_TABLES);
    const unknown = rows.map((r) => r.name).filter((t) => !known.has(t));
    if (cleared.length > 0) {
        await db.batch(cleared.map((table) => ({ sql: `DELETE FROM "${table}"`, params: [] })));
    }
    return { cleared, skipped, unknown };
}
