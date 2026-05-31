import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { WORKFLOW_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-dual-workflow-engine';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import { DOMAIN_SCHEMA_SQL } from './schema';

/** Embedded CLI migration used when no migration folder is available. */
export interface CliMigration {
    id: string;
    sql: string;
}

/** SQL that creates the Spur CLI-owned domain tables plus package-owned tables. */
export const CLI_SCHEMA_SQL = `
${DOMAIN_SCHEMA_SQL}

${HISTORY_IMPORT_SCHEMA_SQL}

${WORKFLOW_ENGINE_SCHEMA_SQL}
`;

/** Built-in migrations for compiled binaries and test use. */
export const CLI_MIGRATIONS: CliMigration[] = [{ id: '0000_spur_cli_foundation', sql: CLI_SCHEMA_SQL }];

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
