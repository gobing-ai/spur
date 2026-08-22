import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    applyCliMigrations,
    CLI_MIGRATION_FILE_MARKER,
    CLI_MIGRATIONS,
    CLI_SCHEMA_SQL,
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

        test('has foundation through args_raw plus history-run-session migrations', () => {
            expect(CLI_MIGRATIONS).toHaveLength(20);
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
            // applies) plus 0019 etl-tables drop applied on top.
            const applied = await applyCliMigrations(adapter);
            expect(applied).toBe(18);
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
            // is already nullable) + 0018 request_id + 0019 etl drop
            expect(applied).toBe(19);
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
            // (history_message now exists, guarded apply runs) + 0019 etl drop.
            expect(await applyCliMigrations(adapter)).toBe(11);
            const columns = await adapter.queryAll<{ name: string }>(
                'PRAGMA index_info(idx_history_message_provenance_run)',
            );
            expect(columns.map((column) => column.name)).toEqual(['provenance', 'run_id']);
            expect(await applyCliMigrations(adapter)).toBe(0);
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
    });
});
