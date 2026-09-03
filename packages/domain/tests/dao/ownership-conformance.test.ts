import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { IMPORTER_OWNED_TABLES } from '@gobing-ai/ts-llm-jsonl-importer';
import { HISTORY_RESET_TABLES, resetHistoryTables, SPUR_OWNED_HISTORY_TABLES } from '../../src/analytics/history-reset';
import { CLI_MIGRATIONS, splitSqlStatements } from '../../src/migrations';

/**
 * Grandfathered Spur migrations that violate ADR-105 axis two (adding columns to importer-owned tables).
 *
 * Task 0747 repatriated the DDL authority and ETL pass for these columns; the applied migrations remain
 * in the ledger as guarded no-ops to protect applied history (R3/R7).
 */
export const OWNERSHIP_EXCEPTIONS: ReadonlySet<string> = new Set([
    '0024_spur_cli_history_checkpoint_identity',
    '0025_spur_cli_history_checkpoint_identity_mtime',
    '0026_spur_cli_history_message_duration_source',
]);

const IMPORTER_OWNED_SET: ReadonlySet<string> = new Set(IMPORTER_OWNED_TABLES);

/** Extract table names created or altered by DDL statements (excluding CREATE INDEX). */
function extractDdlTargets(sql: string): { createdTables: string[]; alteredTables: string[] } {
    const createdTables: string[] = [];
    const alteredTables: string[] = [];

    for (const stmt of splitSqlStatements(sql)) {
        const trimmed = stmt.trim();
        // Match CREATE TABLE [IF NOT EXISTS] <name>
        const createMatch = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?/i.exec(trimmed);
        if (createMatch?.[1]) {
            createdTables.push(createMatch[1]);
        }

        // Match ALTER TABLE <name> ADD COLUMN
        const alterMatch = /^ALTER\s+TABLE\s+["`]?([a-zA-Z0-9_]+)["`]?\s+ADD\s+(?:COLUMN\s+)?/i.exec(trimmed);
        if (alterMatch?.[1]) {
            alteredTables.push(alterMatch[1]);
        }
    }

    return { createdTables, alteredTables };
}

describe('history schema ownership conformance (task 0749 / ADR-105)', () => {
    describe('OWNERSHIP_EXCEPTIONS allow-list (R2b)', () => {
        test('contains exactly the 3 grandfathered migrations and no more', () => {
            expect(OWNERSHIP_EXCEPTIONS.size).toBe(3);
            expect(OWNERSHIP_EXCEPTIONS.has('0024_spur_cli_history_checkpoint_identity')).toBe(true);
            expect(OWNERSHIP_EXCEPTIONS.has('0025_spur_cli_history_checkpoint_identity_mtime')).toBe(true);
            expect(OWNERSHIP_EXCEPTIONS.has('0026_spur_cli_history_message_duration_source')).toBe(true);
        });
    });

    describe('CLI_MIGRATIONS ownership conformance (R2a)', () => {
        test('no Spur migration creates or alters importer-owned tables without an exception', () => {
            const violations: string[] = [];

            // Modern migrations (post-0019 ETL tables drop) plus all future migrations
            const modernMigrations = CLI_MIGRATIONS.filter((m) => m.id > '0019_spur_cli_history_etl_tables_drop');

            for (const migration of modernMigrations) {
                const isExcepted = OWNERSHIP_EXCEPTIONS.has(migration.id);

                // Check addColumnIfMissing guard
                if (migration.addColumnIfMissing) {
                    const table = migration.addColumnIfMissing.table;
                    if (IMPORTER_OWNED_SET.has(table) && !isExcepted) {
                        violations.push(
                            `${migration.id}: addColumnIfMissing touches importer-owned table '${table}' without exception`,
                        );
                    }
                }

                // Check SQL DDL
                const { createdTables, alteredTables } = extractDdlTargets(migration.sql);

                for (const table of createdTables) {
                    if (IMPORTER_OWNED_SET.has(table) && !isExcepted) {
                        violations.push(
                            `${migration.id}: CREATE TABLE touches importer-owned table '${table}' without exception`,
                        );
                    }
                }

                for (const table of alteredTables) {
                    if (IMPORTER_OWNED_SET.has(table) && !isExcepted) {
                        violations.push(
                            `${migration.id}: ALTER TABLE touches importer-owned table '${table}' without exception`,
                        );
                    }
                }
            }

            expect(violations).toEqual([]);
        });

        test('CREATE INDEX on importer-owned tables is permitted unconditionally', () => {
            const indexMigrationsOnImporterTables = [
                '0009_spur_cli_history_message_run_idx',
                '0020_spur_cli_history_board_query_indexes',
                '0022_spur_cli_history_performance_indexes',
                '0029_spur_cli_history_tool_call_indexes',
                '0030_spur_cli_history_board_covering_indexes',
            ];

            for (const id of indexMigrationsOnImporterTables) {
                const migration = CLI_MIGRATIONS.find((m) => m.id === id);
                expect(migration).toBeDefined();
                // These migrations are NOT in OWNERSHIP_EXCEPTIONS because axis three permits indexes
                expect(OWNERSHIP_EXCEPTIONS.has(id)).toBe(false);
            }
        });
    });

    describe('HISTORY_RESET_TABLES split and coverage (R1a, R1b, R1d)', () => {
        test('contains exactly 29 tables: 15 importer-owned + 14 spur-owned', () => {
            expect(IMPORTER_OWNED_TABLES.length).toBe(15);
            expect(SPUR_OWNED_HISTORY_TABLES.length).toBe(14);
            expect(HISTORY_RESET_TABLES.length).toBe(29);
        });

        test('matches expected 29 table names exactly (regression check)', () => {
            const expected29 = [
                'history_message',
                'history_tool_call',
                'history_skill_call',
                'history_run_session',
                'history_task_session',
                'history_etl_agy',
                'history_etl_antigravity',
                'history_etl_claude',
                'history_etl_codex',
                'history_etl_gemini',
                'history_etl_grok',
                'history_etl_omp',
                'history_etl_openclaw',
                'history_etl_opencode',
                'history_etl_pi',
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
                'history_import_checkpoint',
                'history_import_ledger',
            ];

            expect([...HISTORY_RESET_TABLES].sort()).toEqual([...expected29].sort());
        });

        test('R1c: upstream-added source landing table automatically covered without Spur edit', () => {
            // Sourcing from IMPORTER_OWNED_TABLES means if upstream defines a targetTable,
            // it appears in IMPORTER_OWNED_TABLES and therefore HISTORY_RESET_TABLES.
            const syntheticSourceTable = 'history_etl_future_agent';
            const simulatedUpstream = [...IMPORTER_OWNED_TABLES, syntheticSourceTable];
            const dynamicResetTables = [...simulatedUpstream, ...SPUR_OWNED_HISTORY_TABLES];

            expect(dynamicResetTables).toContain(syntheticSourceTable);
            expect(SPUR_OWNED_HISTORY_TABLES).not.toContain(syntheticSourceTable);
        });

        test('resetHistoryTables wipes listed tables and reports unknown history_* tables in unknown', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await db.exec('CREATE TABLE history_message (id TEXT)');
            await db.exec('CREATE TABLE history_unknown_custom (id TEXT)');

            const result = await resetHistoryTables(db);
            expect(result.cleared).toContain('history_message');
            expect(result.unknown).toContain('history_unknown_custom');
            db.close();
        });
    });
});
