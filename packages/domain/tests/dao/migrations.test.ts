import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyHistoryImportSchema } from '@gobing-ai/ts-llm-jsonl-importer';
import {
    applyCliMigrations,
    CLI_MIGRATION_FILE_MARKER,
    CLI_MIGRATIONS,
    CLI_SCHEMA_SQL,
    HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL,
    loadSqlMigrations,
    RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL,
    SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL,
} from '../../src/migrations';

describe('db migrations', () => {
    describe('CLI_SCHEMA_SQL', () => {
        const hasCreateTable = (table: string): boolean =>
            new RegExp(`CREATE TABLE IF NOT EXISTS "?${table}"?`).test(CLI_SCHEMA_SQL);

        test('contains workspaces table', () => {
            expect(hasCreateTable('workspaces')).toBe(true);
        });

        test('contains runs table', () => {
            expect(hasCreateTable('runs')).toBe(true);
        });

        test('contains phase_runs table', () => {
            expect(hasCreateTable('phase_runs')).toBe(true);
        });

        test('contains transition_runs table', () => {
            expect(hasCreateTable('transition_runs')).toBe(true);
        });

        test('contains workflow_states table', () => {
            expect(hasCreateTable('workflow_states')).toBe(true);
        });

        test('contains artifacts table', () => {
            expect(hasCreateTable('artifacts')).toBe(true);
        });

        test('contains inbox_messages table', () => {
            expect(hasCreateTable('inbox_messages')).toBe(true);
        });

        test('contains rule_runs and rule_eval_runs tables', () => {
            expect(hasCreateTable('rule_runs')).toBe(true);
            expect(hasCreateTable('rule_eval_runs')).toBe(true);
        });

        test('contains planning_events and task_run_links tables', () => {
            expect(hasCreateTable('planning_events')).toBe(true);
            expect(hasCreateTable('task_run_links')).toBe(true);
        });
    });

    describe('CLI_MIGRATIONS', () => {
        function assertMigrationPrefixSequence(migrations: { id: string }[]): void {
            const seen = new Map<string, string>();
            let prevPrefix: number | null = null;
            let prevId: string | null = null;

            for (let i = 0; i < migrations.length; i++) {
                const item = migrations[i];
                if (!item) {
                    continue;
                }
                const id = item.id;
                const prefixStr = id.slice(0, 4);
                const prefix = Number.parseInt(prefixStr, 10);
                if (Number.isNaN(prefix) || !/^\d{4}/.test(id)) {
                    throw new Error(`migration at index ${i} (${id}) does not have a 4-digit numeric prefix`);
                }

                const existing = seen.get(prefixStr);
                if (existing) {
                    throw new Error(`duplicate migration prefix ${prefixStr}: ${existing}, ${id}`);
                }
                seen.set(prefixStr, id);

                if (prevPrefix !== null && prefix <= prevPrefix) {
                    throw new Error(
                        `non-ascending migration prefix sequence at index ${i}: ${prevId} (prefix ${prevPrefix}) >= ${id} (prefix ${prefix})`,
                    );
                }
                prevPrefix = prefix;
                prevId = id;
            }
        }

        test('migration ids have strictly ascending 4-digit numeric prefixes with no duplicate prefix', () => {
            assertMigrationPrefixSequence(CLI_MIGRATIONS);
        });

        test('fails when two migrations share a numeric prefix, naming both colliding ids (R1)', () => {
            const mock = [
                { id: '0000_spur_cli_foundation' },
                { id: '0012_spur_cli_history_tool_call_args_raw' },
                { id: '0012_spur_cli_history_run_session' },
            ];
            expect(() => assertMigrationPrefixSequence(mock)).toThrow(
                'duplicate migration prefix 0012: 0012_spur_cli_history_tool_call_args_raw, 0012_spur_cli_history_run_session',
            );
        });

        test('fails when migration prefixes are not strictly ascending, naming the offending position (R2)', () => {
            const mock = [
                { id: '0000_spur_cli_foundation' },
                { id: '0002_spur_cli_rule_history' },
                { id: '0001_spur_cli_team_inbox' },
            ];
            expect(() => assertMigrationPrefixSequence(mock)).toThrow(
                'non-ascending migration prefix sequence at index 2',
            );
        });

        test('has foundation through History Board indexes, rollups, checkpoint identity, the history-refresh single-flight index, and the 0722 task↔session attribution table', () => {
            expect(CLI_MIGRATIONS).toHaveLength(34);
            expect(CLI_MIGRATIONS[0]?.id).toBe('0000_spur_cli_foundation');
            expect(CLI_MIGRATIONS[1]?.id).toBe('0001_spur_cli_team_inbox');
            expect(CLI_MIGRATIONS[2]?.id).toBe('0002_spur_cli_rule_history');
            expect(CLI_MIGRATIONS[3]?.id).toBe('0003_spur_cli_planning');
            expect(CLI_MIGRATIONS[4]?.id).toBe('0004_spur_cli_queue_jobs');
            expect(CLI_MIGRATIONS[5]?.id).toBe('0005_spur_cli_run_pid');
            expect(CLI_MIGRATIONS[6]?.id).toBe('0006_spur_cli_system_events');
            expect(CLI_MIGRATIONS[7]?.id).toBe('0007_spur_cli_runs_external_key');
            expect(CLI_MIGRATIONS[8]?.id).toBe('0008_spur_cli_system_events_correlation');
            expect(CLI_MIGRATIONS[9]?.id).toBe('0009_spur_cli_history_message_run_idx');
            expect(CLI_MIGRATIONS[10]?.id).toBe('0010_spur_cli_coordination_runs');
            expect(CLI_MIGRATIONS[11]?.id).toBe('0011_spur_cli_system_events_sequence_idx');
            expect(CLI_MIGRATIONS[12]?.id).toBe('0012_spur_cli_history_tool_call_args_raw');
            expect(CLI_MIGRATIONS[13]?.id).toBe('0013_spur_cli_history_run_session');
            expect(CLI_MIGRATIONS[14]?.id).toBe('0014_spur_cli_system_events_name_occurred_idx');
            expect(CLI_MIGRATIONS[15]?.id).toBe('0015_spur_cli_history_tool_call_call_id');
            expect(CLI_MIGRATIONS[16]?.id).toBe('0016_spur_cli_history_message_ts_nullable');
            expect(CLI_MIGRATIONS[17]?.id).toBe('0017_spur_cli_runs_status_completed_to_done');
            expect(CLI_MIGRATIONS[18]?.id).toBe('0018_spur_cli_history_message_request_id');
            expect(CLI_MIGRATIONS[19]?.id).toBe('0019_spur_cli_history_etl_tables_drop');
            expect(CLI_MIGRATIONS[20]?.id).toBe('0020_spur_cli_history_board_query_indexes');
            expect(CLI_MIGRATIONS[21]?.id).toBe('0021_spur_cli_history_board_rollups');
            expect(CLI_MIGRATIONS[22]?.id).toBe('0022_spur_cli_history_performance_indexes');
            expect(CLI_MIGRATIONS[23]?.id).toBe('0023_spur_cli_history_message_request_id_idx');
            // 0675/0678: guarded file-identity columns for the incremental import short-circuit.
            expect(CLI_MIGRATIONS[24]?.id).toBe('0024_spur_cli_history_checkpoint_identity');
            expect(CLI_MIGRATIONS[25]?.id).toBe('0025_spur_cli_history_checkpoint_identity_mtime');
            // 0702: assistant-step duration provenance column.
            expect(CLI_MIGRATIONS[26]?.id).toBe('0026_spur_cli_history_message_duration_source');
            // 0716: single-flight for history.refresh — ACTIVE (pending OR processing) unique index.
            expect(CLI_MIGRATIONS[27]?.id).toBe('0027_spur_cli_history_refresh_active_unique');

            // 0722 (feature E6): direct task↔session attribution authority.
            expect(CLI_MIGRATIONS[28]?.id).toBe('0028_spur_cli_history_task_session');
            // 0029: composite indexes on history_tool_call and history_message.
            expect(CLI_MIGRATIONS[29]?.id).toBe('0029_spur_cli_history_tool_call_indexes');
            // 0030: covering indexes for history board rollups, tool calls, and session attribution.
            expect(CLI_MIGRATIONS[30]?.id).toBe('0030_spur_cli_history_board_covering_indexes');
            // 0031: token and duration columns on history_board_tool_stats.
            expect(CLI_MIGRATIONS[31]?.id).toBe('0031_spur_cli_history_board_tool_stats_columns');
            // 0737 R2: materialized skill-call rollup backing the Summary skill-load breakdown.
            expect(CLI_MIGRATIONS[32]?.id).toBe('0032_spur_cli_history_board_skill_5m');
        });

        test('run-pid migration adds a pid column to runs', () => {
            expect(CLI_MIGRATIONS[5]?.sql).toContain('ALTER TABLE runs ADD COLUMN pid');
        });

        test('runs-external-key migration adds an external_key column to legacy runs tables', () => {
            expect(CLI_MIGRATIONS[7]?.sql).toBe(RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL);
            expect(CLI_MIGRATIONS[7]?.sql).toContain('ALTER TABLE runs ADD COLUMN external_key');
            expect(CLI_MIGRATIONS[7]?.addColumnIfMissing).toEqual({ table: 'runs', column: 'external_key' });
        });

        test('system-events-correlation migration adds the four indexed columns to legacy ledgers', () => {
            expect(CLI_MIGRATIONS[8]?.sql).toBe(SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL);
            for (const column of ['run_id TEXT', 'entity_kind TEXT', 'entity_id TEXT', 'sequence INTEGER']) {
                expect(CLI_MIGRATIONS[8]?.sql).toContain(`ALTER TABLE system_events ADD COLUMN ${column}`);
            }
            expect(CLI_MIGRATIONS[8]?.addColumnIfMissing).toEqual({ table: 'system_events', column: 'sequence' });
        });

        test('system-events-correlation migration rewrites no payloads', () => {
            // R5: the migration is columns + indexes only. An UPDATE here would
            // mutate rows the ledger promises to keep append-only.
            expect(SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL).not.toContain('UPDATE');
            expect(SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL).not.toContain('payload_json');
        });

        test('queue-jobs migration creates queue_jobs', () => {
            expect(CLI_MIGRATIONS[4]?.sql).toContain('CREATE TABLE IF NOT EXISTS queue_jobs');
        });

        test('every migration id carries the folder-load filename marker', () => {
            for (const migration of CLI_MIGRATIONS) {
                expect(migration.id).toContain(CLI_MIGRATION_FILE_MARKER);
            }
        });

        test('foundation migration SQL matches CLI_SCHEMA_SQL', () => {
            expect(CLI_MIGRATIONS[0]?.sql).toBe(CLI_SCHEMA_SQL);
        });

        test('team-inbox migration creates inbox_messages', () => {
            expect(CLI_MIGRATIONS[1]?.sql).toContain('CREATE TABLE IF NOT EXISTS inbox_messages');
        });

        test('rule-history migration creates rule run tables', () => {
            expect(CLI_MIGRATIONS[2]?.sql).toContain('CREATE TABLE IF NOT EXISTS rule_runs');
            expect(CLI_MIGRATIONS[2]?.sql).toContain('CREATE TABLE IF NOT EXISTS rule_eval_runs');
        });

        test('existing DB that already applied 0000/0001 gains rule, planning, queue, run-pid, and runs-external-key', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            // Stub 0000 mirrors a realistic legacy DB: it predates the later
            // migrations but already has `runs` (the engine schema has shipped it
            // since before team-inbox), so 0005's ALTER has a target.
            await applyCliMigrations(adapter, [
                {
                    id: '0000_spur_cli_foundation',
                    sql: 'CREATE TABLE IF NOT EXISTS workspaces (id TEXT); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS history_message (record_hash TEXT PRIMARY KEY, source TEXT NOT NULL, session_id TEXT NOT NULL, provenance TEXT NOT NULL, run_id TEXT);',
                },
                { id: '0001_spur_cli_team_inbox', sql: 'CREATE TABLE IF NOT EXISTS inbox_messages (id TEXT);' },
            ]);
            // 0002–0011 plus 0012 args_raw (journaled, skipped: no history_tool_call
            // in stub) plus 0013 history-run-session plus 0014 name-occurred index
            // plus 0015 call_id (journaled, skipped: no history_tool_call in stub)
            // plus 0018 request_id (guarded: history_message exists here so it
            // applies) plus 0019 etl-tables drop, 0020 History Board indexes
            // (journaled, skipped: the stub lacks their source columns), 0021 rollups,
            // and 0022 performance indexes (journaled, skipped: stub history_message
            // lacks ts/model and history_tool_call is absent).
            // 0024/0025 checkpoint identity are guarded: the stub never creates
            // history_import_checkpoint, so they skip without error (0678).
            // 0027's active-unique swap applies: the stub's queue_jobs (from 0004)
            // exists, so the table guard passes. 0028 history_task_session applies
            // (standalone DDL, 0722). 0029 history_tool_call_indexes applies.
            // 0030 history_board_covering_indexes applies + 0031 tool stats columns
            // + 0032 history_board_skill_5m + 0033 importer_schema_version.
            const applied = await applyCliMigrations(adapter);
            expect(applied).toBe(30);
            // 0005 and 0007 backfilled columns on the legacy runs table.
            const cols = await adapter.queryAll<{ name: string }>('PRAGMA table_info(runs)');
            expect(cols.some((c) => c.name === 'pid')).toBe(true);
            expect(cols.some((c) => c.name === 'external_key')).toBe(true);
            await adapter.run(
                `INSERT INTO rule_runs (id, source_kind, status, started_at, created_at, updated_at)
                 VALUES ('r1', 'preset', 'done', datetime('now'), datetime('now'), datetime('now'))`,
            );
            const rows = await adapter.queryAll('SELECT id FROM rule_runs');
            expect(rows).toHaveLength(1);
            // queue_jobs (0004) is now present and writable.
            await adapter.run(
                'INSERT INTO queue_jobs (id, type, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                'j1',
                'test.job',
                '{}',
                Date.now(),
                Date.now(),
            );
            const jobs = await adapter.queryAll('SELECT id FROM queue_jobs');
            expect(jobs).toHaveLength(1);
            adapter.close();
        });

        test('DB journaled under the legacy 0001_spur_team_inbox id upgrades safely', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter, [
                { id: '0000_spur_cli_foundation', sql: CLI_SCHEMA_SQL },
                { id: '0001_spur_team_inbox', sql: 'SELECT 1;' },
            ]);

            const applied = await applyCliMigrations(adapter);
            // renamed inbox + rule + planning + queue-jobs + run-pid + system-events
            // + runs-external-key + system-events-correlation + history-message-run-idx
            // + coordination-runs + system-events-sequence-idx + args_raw
            // + history-run-session + name-occurred-index + call_id + 0017 status
            // retirements (0016 nullable-ts skips: CLI_SCHEMA_SQL's history_message
            // is already nullable) + 0018 request_id + 0019 etl drop + 0020 indexes
            // + 0021 rollups + 0022 performance indexes + 0023 request_id index
            // + 0675/0678 guarded checkpoint identity columns (0024, 0025)
            // + 0026 duration-source column + 0027 active-unique swap
            // + 0028 history_task_session (0722) + 0029 history_tool_call_indexes
            // + 0030 history_board_covering_indexes + 0031 tool stats columns
            // + 0032 history_board_skill_5m + 0033 importer_schema_version.
            expect(applied).toBe(33);
            await adapter.run(
                'INSERT INTO inbox_messages (id, to_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                'm1',
                'planner',
                'hi',
                Date.now(),
                Date.now(),
            );
            const rows = await adapter.queryAll('SELECT id FROM inbox_messages');
            expect(rows).toHaveLength(1);
            adapter.close();
        });

        test('fresh DB journals runs-external-key without duplicate-column errors', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            const applied = await applyCliMigrations(adapter);
            expect(applied).toBe(CLI_MIGRATIONS.length);

            const cols = await adapter.queryAll<{ name: string }>('PRAGMA table_info(runs)');
            expect(cols.filter((c) => c.name === 'external_key')).toHaveLength(1);
            const row = await adapter.queryFirst<{ id: string }>(
                'SELECT id FROM "__spur_cli_migrations" WHERE id = ?',
                '0007_spur_cli_runs_external_key',
            );
            expect(row?.id).toBe('0007_spur_cli_runs_external_key');

            const secondApplied = await applyCliMigrations(adapter);
            expect(secondApplied).toBe(0);
            adapter.close();
        });

        test('folder-loaded runs-external-key migration also skips when foundation already created the column', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter, [{ id: '0000_spur_cli_foundation', sql: CLI_SCHEMA_SQL }]);

            const applied = await applyCliMigrations(adapter, [
                {
                    id: '0007_spur_cli_runs_external_key',
                    sql: RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL,
                    addColumnIfMissing: { table: 'runs', column: 'external_key' },
                },
            ]);

            expect(applied).toBe(1);
            const cols = await adapter.queryAll<{ name: string }>('PRAGMA table_info(runs)');
            expect(cols.filter((c) => c.name === 'external_key')).toHaveLength(1);
            adapter.close();
        });

        test('legacy pre-0369 ledger gains the correlation columns without losing its rows', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            // A DB journaled through 0007 whose system_events table carries only
            // the five original columns — the exact shape drizzle/0006 ships.
            await applyCliMigrations(adapter, [
                {
                    id: '0006_spur_cli_system_events',
                    sql: `CREATE TABLE IF NOT EXISTS system_events (
                        id TEXT PRIMARY KEY,
                        event_name TEXT NOT NULL,
                        occurred_at TEXT NOT NULL,
                        actor TEXT,
                        payload_json TEXT
                    );`,
                },
            ]);
            await adapter.run(
                `INSERT INTO system_events (id, event_name, occurred_at, actor, payload_json)
                 VALUES ('sev_legacy', 'task.updated', '2026-07-04T01:00:00.000Z', 'operator', '{"entityId":"0001"}')`,
            );

            const applied = await applyCliMigrations(adapter, [
                {
                    id: '0008_spur_cli_system_events_correlation',
                    sql: SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL,
                    addColumnIfMissing: { table: 'system_events', column: 'sequence' },
                },
            ]);
            expect(applied).toBe(1);

            const cols = await adapter.queryAll<{ name: string; type: string; notnull: number }>(
                'PRAGMA table_info(system_events)',
            );
            for (const name of ['run_id', 'entity_kind', 'entity_id', 'sequence']) {
                const col = cols.find((c) => c.name === name);
                expect(col).toBeDefined();
                // Nullable (R4) — pre-migration rows have no correlation to carry.
                expect(col?.notnull).toBe(0);
            }
            expect(cols.find((c) => c.name === 'sequence')?.type).toBe('INTEGER');

            // R5: the pre-migration row survives with its payload untouched and
            // nulls in every new column.
            const row = await adapter.queryFirst<{
                payload_json: string;
                run_id: string | null;
                sequence: number | null;
            }>('SELECT payload_json, run_id, sequence FROM system_events WHERE id = ?', 'sev_legacy');
            expect(row?.payload_json).toBe('{"entityId":"0001"}');
            expect(row?.run_id).toBeNull();
            expect(row?.sequence).toBeNull();
            adapter.close();
        });

        test('fresh DB journals system-events-correlation without duplicate-column errors', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);

            const cols = await adapter.queryAll<{ name: string }>('PRAGMA table_info(system_events)');
            expect(cols.filter((c) => c.name === 'sequence')).toHaveLength(1);
            expect(cols.filter((c) => c.name === 'run_id')).toHaveLength(1);
            const row = await adapter.queryFirst<{ id: string }>(
                'SELECT id FROM "__spur_cli_migrations" WHERE id = ?',
                '0008_spur_cli_system_events_correlation',
            );
            expect(row?.id).toBe('0008_spur_cli_system_events_correlation');

            const secondApplied = await applyCliMigrations(adapter);
            expect(secondApplied).toBe(0);
            adapter.close();
        });

        test('fresh DB indexes run_id and the entity pair for the J3 read API', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);

            const indexes = await adapter.queryAll<{ name: string }>('PRAGMA index_list(system_events)');
            const names = indexes.map((i) => i.name);
            expect(names).toContain('idx_system_events_run_id');
            expect(names).toContain('idx_system_events_entity');

            // The entity index must be the (kind, id) pair — a single-column
            // index cannot serve the "this task's stream" lookup.
            const entityCols = await adapter.queryAll<{ name: string }>('PRAGMA index_info(idx_system_events_entity)');
            expect(entityCols.map((c) => c.name)).toEqual(['entity_kind', 'entity_id']);
            adapter.close();
        });

        test('0009 adds the (provenance, run_id) index to history_message', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);

            const indexes = await adapter.queryAll<{ name: string }>('PRAGMA index_list(history_message)');
            expect(indexes.map((i) => i.name)).toContain('idx_history_message_provenance_run');

            // The index covers the (provenance, run_id) pair — the --run/--task selectors.
            const cols = await adapter.queryAll<{ name: string }>(
                'PRAGMA index_info(idx_history_message_provenance_run)',
            );
            expect(cols.map((c) => c.name)).toEqual(['provenance', 'run_id']);

            // Idempotent: re-applying journals nothing and does not duplicate the index.
            const secondApplied = await applyCliMigrations(adapter);
            expect(secondApplied).toBe(0);
            adapter.close();
        });

        test('0020 indexes only identified history responses', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);

            const row = await adapter.queryFirst<{ sql: string }>(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_history_message_request_id'",
            );
            expect(row?.sql).toContain('ON history_message (request_id)');
            expect(row?.sql).toContain('WHERE request_id IS NOT NULL');
            adapter.close();
        });

        test('0009 provisions importer tables for databases whose journaled foundation predates them', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await adapter.exec(
                'CREATE TABLE "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
            );
            for (const migration of CLI_MIGRATIONS.slice(0, 9)) {
                await adapter.run(
                    'INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)',
                    migration.id,
                    Date.now(),
                );
            }

            expect(
                await adapter.queryFirst("SELECT name FROM sqlite_master WHERE name = 'history_message'"),
            ).toBeNull();

            // 0009 (history index, provisions importer tables first) + 0010 coordination-runs
            // + 0011 system-events-sequence-idx + 0012 args_raw + 0013 history-run-session
            // + 0014 name-occurred index + 0015 call_id + 0016 nullable-ts
            // + 0017 completed→done status retirements + 0018 request_id
            // (history_message now exists, guarded apply runs) + 0019 etl drop
            // + 0020 History Board indexes + 0021 rollups + 0022 performance
            // indexes + 0023 request_id index + 0024/0025 checkpoint identity
            // + 0026 duration-source column + 0027 active-unique swap (skipped:
            // this pre-provisioned journal never creates queue_jobs)
            // + 0028 history_task_session (standalone DDL, applies)
            // + 0029 history_tool_call_indexes (applies)
            // + 0030 history_board_covering_indexes (applies)
            // + 0031 history_board_tool_stats_columns (applies)
            // + 0032 history_board_skill_5m (applies)
            // + 0033 importer_schema_version (applies).
            expect(await applyCliMigrations(adapter)).toBe(25);
            const columns = await adapter.queryAll<{ name: string }>(
                'PRAGMA index_info(idx_history_message_provenance_run)',
            );
            expect(columns.map((column) => column.name)).toEqual(['provenance', 'run_id']);
            expect(await applyCliMigrations(adapter)).toBe(0);
            adapter.close();
        });

        test('0022 migration SQL matches HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL and is all idempotent DDL', () => {
            const entry = CLI_MIGRATIONS[22];
            expect(entry?.sql).toBe(HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL);
            // No plain CREATE INDEX / CREATE TABLE / ALTER: every statement must be IF NOT EXISTS.
            expect(entry?.sql).not.toMatch(/CREATE (INDEX|TABLE)(?! IF NOT EXISTS)/);
        });

        test('fresh DB gains the six E9 performance indexes with frozen column order and direction', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);

            const expectIndex = async (table: string, index: string, columns: string[], desc: string[] = []) => {
                const listed = await adapter.queryAll<{ name: string }>(`PRAGMA index_list(${table})`);
                expect(listed.map((i) => i.name)).toContain(index);
                const info = await adapter.queryAll<{ name: string; desc: number }>(`PRAGMA index_xinfo(${index})`);
                const keyColumns = info.filter((c) => c.name != null);
                expect(keyColumns.map((c) => c.name)).toEqual(columns);
                for (const column of desc) {
                    expect(keyColumns.find((c) => c.name === column)?.desc).toBe(1);
                }
                for (const column of columns.filter((c) => !desc.includes(c))) {
                    expect(keyColumns.find((c) => c.name === column)?.desc).toBe(0);
                }
            };

            await expectIndex('history_message', 'idx_history_message_source_ts', ['source', 'ts']);
            await expectIndex('history_message', 'idx_history_message_model_ts', ['model', 'ts']);
            await expectIndex('history_tool_call', 'idx_history_tool_call_session_id_seq', ['session_id', 'seq']);
            await expectIndex('history_board_message_5m', 'idx_history_board_message_5m_bucket_model', [
                'bucket_start',
                'model',
            ]);
            await expectIndex('history_board_tool_5m', 'idx_history_board_tool_5m_bucket_skill', [
                'bucket_start',
                'skill_name',
            ]);
            await expectIndex(
                'history_board_session_stats',
                'idx_history_board_session_source_started',
                ['source', 'started_at'],
                ['started_at'],
            );

            // Second idempotent apply journals nothing new.
            expect(await applyCliMigrations(adapter)).toBe(0);
            adapter.close();
        });

        test('upgraded DB journaled through 0021 receives 0022-0031 and converges with a fresh DB', async () => {
            const upgraded = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(upgraded, CLI_MIGRATIONS.slice(0, 22));
            expect(await applyCliMigrations(upgraded)).toBe(12);

            const fresh = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(fresh);

            const schemaOf = async (adapter: DbAdapter) =>
                (
                    await adapter.queryAll<{ sql: string }>(
                        "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') AND name LIKE 'idx_history%' ORDER BY name",
                    )
                ).map((r) => r.sql);
            expect(await schemaOf(upgraded)).toEqual(await schemaOf(fresh));
            upgraded.close();
            fresh.close();
        });

        test('EXPLAIN QUERY PLAN selects each E9 index for its intended access path', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            // Give the planner representative row counts so index choice is stable.
            await adapter.exec(`
                INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, role, record_type, disposition, ts, model, provenance, imported_at)
                VALUES ('h1', 'claude', 'f.jsonl', 1, 's1', 1, 'user', 'message', 'ok', '2026-08-01T00:00:00Z', 'sonnet', 'run', '2026-08-01T00:00:01Z');
                INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line, session_id, seq, tool_name, status, imported_at)
                VALUES ('t1', 'h1', 'claude', 'f.jsonl', 1, 's1', 1, 'Read', 'ok', '2026-08-01T00:00:01Z');
                INSERT INTO history_board_message_5m (bucket_start, session_id, source, model, fresh_input_tokens, cache_read_tokens, output_tokens, messages, assistant_duration_ms, assistant_duration_samples)
                VALUES ('2026-08-01T00:00', 's1', 'claude', 'sonnet', 1, 0, 0, 1, 0, 1);
                INSERT INTO history_board_tool_5m (bucket_start, session_id, source, model, tool_name, skill_name, fresh_input_tokens, cache_read_tokens, output_tokens, calls)
                VALUES ('2026-08-01T00:00', 's1', 'claude', 'sonnet', 'Read', 'spur-dev', 1, 0, 0, 1);
                INSERT INTO history_board_session_stats (source, session_id, started_at, ended_at, messages, tool_calls, fresh_input_tokens, cache_read_tokens, output_tokens, assistant_duration_ms)
                VALUES ('claude', 's1', '2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', 1, 1, 1, 0, 0, 0);
                ANALYZE;
            `);

            const planUses = async (index: string, sql: string) => {
                const rows = await adapter.queryAll<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`);
                const detail = rows.map((r) => r.detail).join('\n');
                expect(detail).toContain(index);
                expect(detail).not.toContain('SCAN');
            };

            // (source, ts): source-filtered time-ordered message read.
            await planUses(
                'idx_history_message_source_ts',
                "SELECT session_id FROM history_message WHERE source = 'claude' AND ts >= '2026-08-01' ORDER BY ts",
            );
            // (model, ts): model-filtered time-ordered message read.
            await planUses(
                'idx_history_message_model_ts',
                "SELECT session_id FROM history_message WHERE model = 'sonnet' AND ts >= '2026-08-01' ORDER BY ts",
            );
            // (session_id, seq): session-ordered tool-call read.
            await planUses(
                'idx_history_tool_call_session_id_seq',
                "SELECT tool_name FROM history_tool_call WHERE session_id = 's1' ORDER BY seq",
            );
            // (bucket_start, model): bucket-range model series from the message rollup.
            await planUses(
                'idx_history_board_message_5m_bucket_model',
                "SELECT model, SUM(messages) FROM history_board_message_5m WHERE bucket_start >= '2026-08-01T00:00' AND bucket_start < '2026-08-02T00:00' GROUP BY bucket_start, model",
            );
            // (bucket_start, skill_name): bucket-range skill series from the tool rollup.
            await planUses(
                'idx_history_board_tool_5m_bucket_skill',
                "SELECT skill_name, SUM(calls) FROM history_board_tool_5m WHERE bucket_start >= '2026-08-01T00:00' AND bucket_start < '2026-08-02T00:00' GROUP BY bucket_start, skill_name",
            );
            // (source, started_at DESC): source-filtered newest-first session list.
            await planUses(
                'idx_history_board_session_source_started',
                "SELECT session_id FROM history_board_session_stats WHERE source = 'claude' ORDER BY started_at DESC LIMIT 20",
            );
            adapter.close();
        });

        test('checkpoint (source, updated_at) index rejected: PK covers the source lookup, freshness aggregates everything', async () => {
            // R5: the source-filtered checkpoint lookup is served by the
            // history_import_checkpoint primary key (source, source_file)...
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const pk = await adapter.queryAll<{ name: string }>(
                'PRAGMA index_info(sqlite_autoindex_history_import_checkpoint_1)',
            );
            expect(pk.map((c) => c.name)).toEqual(['source', 'source_file']);
            // ...and the freshness query has no selective predicate, so no
            // distinct access path exists for an (source, updated_at) index.
            const rows = await adapter.queryAll<{ detail: string }>(
                'EXPLAIN QUERY PLAN SELECT source, MAX(updated_at) FROM history_import_checkpoint GROUP BY source',
            );
            expect(rows.map((r) => r.detail).join('\n')).not.toContain('idx_history_import_checkpoint');
            const indexes = await adapter.queryAll<{ name: string }>('PRAGMA index_list(history_import_checkpoint)');
            expect(indexes.map((i) => i.name)).not.toContain('idx_history_import_checkpoint_source_updated_at');
            adapter.close();
        });

        test('folder-loaded 0009 provisions importer tables before creating its index', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-history-index-migration-'));
            await writeFile(
                join(dir, '0009_spur_cli_history_message_run_idx.sql'),
                'CREATE INDEX IF NOT EXISTS idx_history_message_provenance_run ON history_message (provenance, run_id);',
            );
            const migrations = await loadSqlMigrations(dir);
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });

            expect(await applyCliMigrations(adapter, migrations)).toBe(1);
            const columns = await adapter.queryAll<{ name: string }>(
                'PRAGMA index_info(idx_history_message_provenance_run)',
            );
            expect(columns.map((column) => column.name)).toEqual(['provenance', 'run_id']);

            adapter.close();
            await rm(dir, { recursive: true, force: true });
        });
    });

    describe('CLI_MIGRATION_FILE_MARKER', () => {
        test('contains expected marker string', () => {
            expect(CLI_MIGRATION_FILE_MARKER).toBe('_spur_cli_');
        });
    });

    describe('applyCliMigrations', () => {
        test('applies schema to fresh database', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            const count = await applyCliMigrations(adapter);
            expect(count).toBeGreaterThan(0);
            adapter.close();
        });

        test('returns 0 when already applied', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const count = await applyCliMigrations(adapter);
            expect(count).toBe(0);
            adapter.close();
        });

        test('creates __spur_cli_migrations table', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const row = await adapter.queryFirst<{ id: string }>(
                'SELECT id FROM "__spur_cli_migrations" WHERE id = ?',
                '0000_spur_cli_foundation',
            );
            expect(row?.id).toBe('0000_spur_cli_foundation');
            adapter.close();
        });

        test('tables are usable after migration', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            await adapter.run(
                'INSERT INTO workspaces (id, name, root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                'ws1',
                'test',
                '/tmp',
                Date.now(),
                Date.now(),
            );
            const rows = await adapter.queryAll('SELECT * FROM workspaces');
            expect(rows).toHaveLength(1);
            adapter.close();
        });

        test('inbox_messages table is usable after migration', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            await adapter.run(
                'INSERT INTO inbox_messages (id, to_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                'm1',
                'planner',
                'hi',
                Date.now(),
                Date.now(),
            );
            const rows = await adapter.queryAll<{ status: string }>(
                'SELECT status FROM inbox_messages WHERE to_id = ?',
                'planner',
            );
            expect(rows).toHaveLength(1);
            expect(rows[0]?.status).toBe('queued');
            adapter.close();
        });

        test('runs table gains a nullable pid column after migration (0005)', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const cols = await adapter.queryAll<{ name: string; type: string; notnull: number }>(
                'PRAGMA table_info(runs)',
            );
            const pidCol = cols.find((c) => c.name === 'pid');
            expect(pidCol).toBeDefined();
            expect(pidCol?.type).toBe('INTEGER');
            expect(pidCol?.notnull).toBe(0); // nullable — sync runs have no pid
            adapter.close();
        });
    });

    describe('loadSqlMigrations', () => {
        test('falls back to embedded migrations for empty folder', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-test-migrations-'));
            const migrations = await loadSqlMigrations(dir);
            expect(migrations.length).toBeGreaterThan(0);
            expect(migrations[0]?.id).toBe('0000_spur_cli_foundation');
            await rm(dir, { recursive: true });
        });

        test('loads migration files with marker', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-test-migrations-'));
            await writeFile(
                join(dir, '0001_spur_cli_test.sql'),
                'CREATE TABLE IF NOT EXISTS test_t (id TEXT PRIMARY KEY);',
            );
            await writeFile(join(dir, '0002_other.sql'), 'CREATE TABLE IF NOT EXISTS ignored (id TEXT);');

            const migrations = await loadSqlMigrations(dir);
            expect(migrations).toHaveLength(1);
            expect(migrations[0]?.id).toBe('0001_spur_cli_test');
            expect(migrations[0]?.sql).toContain('test_t');
            await rm(dir, { recursive: true });
        });

        test('repo drizzle folder includes 0011 sequence index (0531 folder-load)', async () => {
            const migrations = await loadSqlMigrations(join(import.meta.dir, '../../../../drizzle'));
            const seqIdx = migrations.find((m) => m.id === '0011_spur_cli_system_events_sequence_idx');
            expect(seqIdx).toBeDefined();
            expect(seqIdx?.sql).toContain('idx_system_events_sequence');
        });

        test('repo drizzle folder includes the 0028 history_task_session migration (0722 folder-load)', async () => {
            const migrations = await loadSqlMigrations(join(import.meta.dir, '../../../../drizzle'));
            const taskSession = migrations.find((m) => m.id === '0028_spur_cli_history_task_session');
            expect(taskSession).toBeDefined();
            expect(taskSession?.sql).toContain('history_task_session');
            expect(taskSession?.sql).toContain('PRIMARY KEY (wbs, source, session_id)');
        });
    });

    describe('repatriated history schema ownership (task 0747 / ADR-104 / ADR-105)', () => {
        test('R1: importer schema defines source_size and source_mtime_ms on history_import_checkpoint', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyHistoryImportSchema(adapter);

            const cols = await adapter.queryAll<{ name: string; type: string }>(
                'PRAGMA table_info(history_import_checkpoint)',
            );
            const sizeCol = cols.find((c) => c.name === 'source_size');
            const mtimeCol = cols.find((c) => c.name === 'source_mtime_ms');

            expect(sizeCol).toBeDefined();
            expect(sizeCol?.type).toBe('INTEGER');
            expect(mtimeCol).toBeDefined();
            expect(mtimeCol?.type).toBe('REAL');

            // Incremental checkpoint write succeeds with file-identity columns
            await adapter.run(
                `INSERT INTO history_import_checkpoint (source, source_file, last_imported_line, source_size, source_mtime_ms, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                'claude',
                'session.jsonl',
                42,
                1024,
                1725000000000.5,
                '2026-09-03T00:00:00.000Z',
            );
            const row = await adapter.queryFirst<{ last_imported_line: number; source_size: number }>(
                'SELECT last_imported_line, source_size FROM history_import_checkpoint WHERE source = ?',
                'claude',
            );
            expect(row?.last_imported_line).toBe(42);
            expect(row?.source_size).toBe(1024);
            adapter.close();
        });

        test('R2: importer schema defines duration_source on history_message', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyHistoryImportSchema(adapter);

            const cols = await adapter.queryAll<{ name: string; type: string }>('PRAGMA table_info(history_message)');
            const durSourceCol = cols.find((c) => c.name === 'duration_source');
            expect(durSourceCol).toBeDefined();
            expect(durSourceCol?.type).toBe('TEXT');
            adapter.close();
        });

        test('R7/R3: migrations 0024, 0025, 0026 remain in ledger and are no-ops on importer-seeded DB', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            // Seed DB with importer schema
            await applyHistoryImportSchema(adapter);

            // Migrations exist in CLI_MIGRATIONS
            const m0024 = CLI_MIGRATIONS.find((m) => m.id === '0024_spur_cli_history_checkpoint_identity');
            const m0025 = CLI_MIGRATIONS.find((m) => m.id === '0025_spur_cli_history_checkpoint_identity_mtime');
            const m0026 = CLI_MIGRATIONS.find((m) => m.id === '0026_spur_cli_history_message_duration_source');

            expect(m0024).toBeDefined();
            expect(m0025).toBeDefined();
            expect(m0026).toBeDefined();

            // Applying all migrations over importer-seeded DB journals all migrations without error
            const applied = await applyCliMigrations(adapter);
            expect(applied).toBe(CLI_MIGRATIONS.length);

            // Check that migrations 0024, 0025, 0026 are recorded in __spur_cli_migrations
            const rows = await adapter.queryAll<{ id: string }>(
                'SELECT id FROM "__spur_cli_migrations" WHERE id IN (?, ?, ?)',
                '0024_spur_cli_history_checkpoint_identity',
                '0025_spur_cli_history_checkpoint_identity_mtime',
                '0026_spur_cli_history_message_duration_source',
            );
            expect(rows).toHaveLength(3);
            adapter.close();
        });

        test('R10/R4: upstream importer schema and downstream migrated schema converge on identical columns', async () => {
            const adapterA = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyHistoryImportSchema(adapterA);

            const adapterB = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyHistoryImportSchema(adapterB);
            await applyCliMigrations(adapterB);

            const tables = ['history_import_checkpoint', 'history_message', 'history_tool_call', 'history_skill_call'];

            for (const table of tables) {
                const colsA = await adapterA.queryAll<{ name: string; type: string }>(`PRAGMA table_info(${table})`);
                const colsB = await adapterB.queryAll<{ name: string; type: string }>(`PRAGMA table_info(${table})`);

                expect(colsA.map((c) => ({ name: c.name, type: c.type }))).toEqual(
                    colsB.map((c) => ({ name: c.name, type: c.type })),
                );
            }

            adapterA.close();
            adapterB.close();
        });

        test('0738 R5/R13: every migration has next four-digit prefix, matching registry entry, and applies to populated DB without data loss', async () => {
            for (let i = 0; i < CLI_MIGRATIONS.length; i++) {
                const id = CLI_MIGRATIONS[i]?.id ?? '';
                const match = id.match(/^(\d{4})_/);
                expect(match).not.toBeNull();
                const num = Number.parseInt(match?.[1] ?? '0', 10);
                expect(num).toBe(i);
            }

            const drizzleDir = join(import.meta.dir, '../../../../drizzle');
            const sqlMigrations = await loadSqlMigrations(drizzleDir);
            for (const sqlM of sqlMigrations) {
                const found = CLI_MIGRATIONS.find((m) => m.id === sqlM.id);
                expect(found).toBeDefined();
            }

            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(db, CLI_MIGRATIONS.slice(0, 30));

            await db.run("INSERT INTO runs (id, status, started_at) VALUES ('run-1', 'pending', 100)");
            await db.run(
                "INSERT INTO inbox_messages (id, to_id, body, created_at, updated_at) VALUES ('msg-1', 'planner', 'hi', 100, 100)",
            );

            const newlyApplied = await applyCliMigrations(db);
            expect(newlyApplied).toBe(CLI_MIGRATIONS.length - 30);

            const run = await db.queryFirst<{ id: string }>('SELECT id FROM runs WHERE id = ?', 'run-1');
            expect(run?.id).toBe('run-1');

            const msg = await db.queryFirst<{ id: string }>('SELECT id FROM inbox_messages WHERE id = ?', 'msg-1');
            expect(msg?.id).toBe('msg-1');

            db.close();
        });
    });
});
