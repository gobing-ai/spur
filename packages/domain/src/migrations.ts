import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { WORKFLOW_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-dual-workflow-engine';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import { RULE_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-rule-engine';
import { DOMAIN_SCHEMA_SQL, PLANNING_SCHEMA_SQL } from './schema';

/** Embedded CLI migration used when no migration folder is available. */
export interface CliMigration {
    id: string;
    sql: string;
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

/** SQL that creates the Spur CLI-owned domain tables plus package-owned tables. */
export const CLI_SCHEMA_SQL = `
${DOMAIN_SCHEMA_SQL}

${PLANNING_SCHEMA_SQL}

${HISTORY_IMPORT_SCHEMA_SQL}

${WORKFLOW_ENGINE_SCHEMA_SQL}

${RULE_ENGINE_SCHEMA_SQL}

${INBOX_MESSAGES_SCHEMA_SQL}

${QUEUE_JOBS_SCHEMA_SQL}
`;

/**
 * Built-in migrations for compiled binaries and test use. `0000` provisions a
 * fresh database with the full current schema (inbox included); `0001` is the
 * incremental step that adds `inbox_messages` to databases created before team
 * mode; `0002` adds the rule-engine run history tables (`rule_runs`,
 * `rule_eval_runs`) to databases created before task 0040; `0003` adds the
 * planning event ledger (`planning_events`, `task_run_links`); `0004` adds the
 * `queue_jobs` table (`@gobing-ai/ts-infra` `DBJobQueue`/`DBQueueConsumer`, task 0074).
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

        for (const statement of splitSqlStatements(migration.sql)) {
            await adapter.exec(statement);
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
    const entries = (await readdir(folder))
        .filter((entry) => entry.endsWith('.sql') && entry.includes(CLI_MIGRATION_FILE_MARKER))
        .sort((left, right) => left.localeCompare(right));

    const migrations: CliMigration[] = [];
    for (const entry of entries) {
        migrations.push({
            id: entry.replace(/\.sql$/, ''),
            sql: await Bun.file(join(folder, entry)).text(),
        });
    }
    return migrations.length > 0 ? migrations : CLI_MIGRATIONS;
}

function splitSqlStatements(sql: string): string[] {
    return sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
}
