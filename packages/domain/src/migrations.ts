import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { WORKFLOW_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-dual-workflow-engine';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import { RULE_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-rule-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { DOMAIN_SCHEMA_SQL, PLANNING_SCHEMA_SQL } from './schema';

/** Embedded CLI migration used when no migration folder is available. */
export interface CliMigration {
    id: string;
    sql: string;
    addColumnIfMissing?: {
        table: string;
        column: string;
    };
}

/**
 * DDL for the team-mode `inbox_messages` table owned by `@gobing-ai/ts-db`
 * (`InboxMessageDao`). ts-db ships the Drizzle table but no SQL constant, so the
 * DDL is mirrored here and kept byte-compatible with `drizzle/0001_spur_cli_team_inbox.sql`.
 * Column types and the `(to_id, status)` pending-lookup index must match the package.
 */
export const INBOX_MESSAGES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_id TEXT,
    to_id TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    in_reply_to TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    delivered_at INTEGER,
    inject_attempts INTEGER NOT NULL DEFAULT 0,
    inject_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_to_status ON inbox_messages (to_id, status);
`;

/**
 * DDL for the `queue_jobs` table owned by `@gobing-ai/ts-db` (`QueueJobDao`, backing
 * `@gobing-ai/ts-infra` `DBJobQueue`/`DBQueueConsumer`). ts-db ships the Drizzle table +
 * embedded migrations but no SQL constant, so the DDL is mirrored here and kept
 * byte-compatible with ts-db's embedded migrations `0000_init` + `0001` (ready index) +
 * `0002` (`expires_at`). Column types and the `(status, next_retry_at, created_at)`
 * ready-lookup index must match the package or the DAO's claim query breaks.
 */
export const QUEUE_JOBS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS queue_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    next_retry_at INTEGER,
    last_error TEXT,
    processing_at INTEGER,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS queue_jobs_ready_idx ON queue_jobs (status, next_retry_at, created_at);
`;

/**
 * DDL for the `system_events` table — a capped append-only ledger of planning
 * and system events persisted by the server EventBus tap (task 0189 wave A /
 * 0198). Indexed on `occurred_at` (history query newest-first + since-filter),
 * `event_name` (per-stream board tabs), `run_id`, and the
 * `(entity_kind, entity_id)` pair (task 0369 indexed correlation columns).
 * Kept byte-compatible with `drizzle/0006_spur_cli_system_events.sql` for the
 * five original columns; the correlation columns ship only in the embedded
 * schema and migration `0008` (the historical drizzle file is inert).
 */
export const SYSTEM_EVENTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_events (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    actor TEXT,
    payload_json TEXT,
    run_id TEXT,
    entity_kind TEXT,
    entity_id TEXT,
    sequence INTEGER
);

CREATE INDEX IF NOT EXISTS idx_system_events_occurred_at ON system_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_system_events_event_name ON system_events (event_name);
CREATE INDEX IF NOT EXISTS idx_system_events_run_id ON system_events (run_id);
CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events (entity_kind, entity_id);
`;

/** SQL that creates the Spur CLI-owned domain tables plus package-owned tables. */
export const CLI_SCHEMA_SQL = `
${DOMAIN_SCHEMA_SQL}

${PLANNING_SCHEMA_SQL}

${HISTORY_IMPORT_SCHEMA_SQL}

${WORKFLOW_ENGINE_SCHEMA_SQL}

${RULE_ENGINE_SCHEMA_SQL}

${INBOX_MESSAGES_SCHEMA_SQL}

${QUEUE_JOBS_SCHEMA_SQL}

${SYSTEM_EVENTS_SCHEMA_SQL}
`;

/**
 * Add a `pid` column to the engine-owned `runs` table so `spur workflow cancel
 * <run-id>` can SIGTERM the in-flight subprocess of an async run (task 0140).
 *
 * The `runs` table is created by `WORKFLOW_ENGINE_SCHEMA_SQL`
 * (`@gobing-ai/ts-dual-workflow-engine`), which Spur cannot edit, so the column
 * is added as a Spur-side incremental migration. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`; this is safe because the applier journals each
 * migration by id and runs it exactly once per database (`applyCliMigrations`,
 * `existing != null → continue`). Requires `runs` to already exist — guaranteed
 * for any real DB, since `0000` provisions the engine schema that creates it.
 * Collision risk: if the engine package ever ships its own `runs.pid` column,
 * this ALTER fails on fresh DBs — flagged for review at that point.
 */
export const RUN_PID_COLUMN_SCHEMA_SQL = `
ALTER TABLE runs ADD COLUMN pid INTEGER;
`;

/**
 * Add the `external_key` column to legacy `runs` tables created before
 * `packages/domain` owned workflow-run lookup by external entity key.
 *
 * New databases already get this column from `DOMAIN_SCHEMA_SQL`/`runsTable`,
 * so this migration uses `addColumnIfMissing` to journal itself without
 * executing the ALTER when the column is already present. Old databases missing
 * the column still receive the same narrow SQLite ALTER used by the run-pid
 * precedent.
 */
export const RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL = `
ALTER TABLE runs ADD COLUMN external_key TEXT;
`;

/**
 * Add the indexed correlation columns (`run_id`, `entity_kind`, `entity_id`,
 * `sequence`) to legacy `system_events` tables created before task 0369.
 *
 * Fresh databases already get these columns (and their indexes) from
 * `SYSTEM_EVENTS_SCHEMA_SQL` in the `0000` foundation, so this migration uses
 * `addColumnIfMissing` to journal itself without executing the ALTERs when the
 * columns are already present — the `runs.external_key` precedent. `sequence`
 * is the representative guard column: the four columns are only ever added
 * together, so its absence identifies a pre-0369 table.
 *
 * No payload rewrite or backfill (R5): pre-migration rows keep their existing
 * `payload_json` and read back with nulls in every correlation column.
 */
export const SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL = `
ALTER TABLE system_events ADD COLUMN run_id TEXT;
ALTER TABLE system_events ADD COLUMN entity_kind TEXT;
ALTER TABLE system_events ADD COLUMN entity_id TEXT;
ALTER TABLE system_events ADD COLUMN sequence INTEGER;

CREATE INDEX IF NOT EXISTS idx_system_events_run_id ON system_events (run_id);
CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events (entity_kind, entity_id);
`;

/**
 * Built-in migrations for compiled binaries and test use. `0000` provisions a
 * fresh database with the full current schema (inbox included); `0001` is the
 * incremental step that adds `inbox_messages` to databases created before team
 * mode; `0002` adds the rule-engine run history tables (`rule_runs`,
 * `rule_eval_runs`) to databases created before task 0040; `0003` adds the
 * planning event ledger (`planning_events`, `task_run_links`); `0004` adds the
 * `queue_jobs` table (`@gobing-ai/ts-infra` `DBJobQueue`/`DBQueueConsumer`, task 0074);
 * `0005` adds the `pid` column to `runs` for subprocess cancellation (task 0140);
 * `0006` adds the `system_events` ledger persisted by the server EventBus tap
 * (observabilities board v1, task 0189 wave A / 0198); `0007` backfills
 * `runs.external_key` for databases whose `runs` table predates that column;
 * `0008` backfills the indexed `system_events` correlation columns
 * (`run_id`, `entity_kind`, `entity_id`, `sequence`) for pre-0369 ledgers.
 * All are idempotent (`CREATE TABLE IF NOT EXISTS`), so applying them in sequence is
 * safe regardless of the database's age.
 */
export const CLI_MIGRATIONS: CliMigration[] = [
    { id: '0000_spur_cli_foundation', sql: CLI_SCHEMA_SQL },
    // Renamed from `0001_spur_team_inbox` so the filename carries the
    // `_spur_cli_` marker that folder-based loads filter on. DBs journaled
    // under the old id re-apply the idempotent DDL once and move on.
    { id: '0001_spur_cli_team_inbox', sql: INBOX_MESSAGES_SCHEMA_SQL },
    { id: '0002_spur_cli_rule_history', sql: RULE_ENGINE_SCHEMA_SQL },
    { id: '0003_spur_cli_planning', sql: PLANNING_SCHEMA_SQL },
    { id: '0004_spur_cli_queue_jobs', sql: QUEUE_JOBS_SCHEMA_SQL },
    {
        id: '0005_spur_cli_run_pid',
        sql: RUN_PID_COLUMN_SCHEMA_SQL,
        addColumnIfMissing: { table: 'runs', column: 'pid' },
    },
    { id: '0006_spur_cli_system_events', sql: SYSTEM_EVENTS_SCHEMA_SQL },
    {
        id: '0007_spur_cli_runs_external_key',
        sql: RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL,
        addColumnIfMissing: { table: 'runs', column: 'external_key' },
    },
    {
        id: '0008_spur_cli_system_events_correlation',
        sql: SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL,
        addColumnIfMissing: { table: 'system_events', column: 'sequence' },
    },
];

/** Filename marker for regenerated CLI-owned migrations. */
export const CLI_MIGRATION_FILE_MARKER = '_spur_cli_';

/** Apply CLI-owned migrations with an isolated journal table. */
export async function applyCliMigrations(adapter: DbAdapter, migrations = CLI_MIGRATIONS): Promise<number> {
    await adapter.exec(
        'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );

    let applied = 0;
    for (const migration of migrations) {
        const existing = await adapter.queryFirst<{ id: string }>(
            'SELECT id FROM "__spur_cli_migrations" WHERE id = ?',
            migration.id,
        );
        if (existing != null) continue;

        const addColumnGuard = migration.addColumnIfMissing;
        const shouldApplySql =
            addColumnGuard === undefined || !(await columnExists(adapter, addColumnGuard.table, addColumnGuard.column));

        if (shouldApplySql) {
            for (const statement of splitSqlStatements(migration.sql)) {
                await adapter.exec(statement);
            }
        }
        await adapter.run(
            'INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)',
            migration.id,
            Date.now(),
        );
        applied += 1;
    }
    return applied;
}

/** Load SQL migration files from a regenerated local migration folder. */
export async function loadSqlMigrations(folder: string): Promise<CliMigration[]> {
    const fs = createNodeFileSystem();
    const rawEntries = await fs.readDir(folder);
    const entries = rawEntries
        .filter((entry) => entry.endsWith('.sql') && entry.includes(CLI_MIGRATION_FILE_MARKER))
        .sort((left, right) => left.localeCompare(right));

    const migrations: CliMigration[] = [];
    for (const entry of entries) {
        migrations.push({
            id: entry.replace(/\.sql$/, ''),
            sql: await fs.readFile(join(folder, entry)),
        });
    }
    return migrations.length > 0 ? migrations : CLI_MIGRATIONS;
}

async function columnExists(adapter: DbAdapter, table: string, column: string): Promise<boolean> {
    const rows = await adapter.queryAll<{ name: string }>(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === column);
}

function splitSqlStatements(sql: string): string[] {
    return sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
}
