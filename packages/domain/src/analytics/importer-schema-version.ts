import type { DbAdapter } from '@gobing-ai/ts-db';
import {
    HISTORY_IMPORT_SCHEMA_SQL,
    HISTORY_IMPORT_SCHEMA_VERSION,
    IMPORTER_OWNED_TABLES,
} from '@gobing-ai/ts-llm-jsonl-importer';

/** Prefix used to encode the applied importer schema version in __spur_cli_migrations.id */
export const IMPORTER_SCHEMA_LEDGER_PREFIX = 'importer_schema@';

/** Result when database importer schema version drifts from installed version. */
export interface ImporterSchemaVersionDrift {
    readonly recorded: string | null;
    readonly installed: string;
    readonly missingTables: readonly string[];
    readonly remediation: string;
}

/**
 * Read the recorded importer schema version from the migration ledger.
 * Returns null if no version has been recorded yet or if the migration table does not exist.
 */
export async function readRecordedImporterSchemaVersion(db: DbAdapter): Promise<string | null> {
    try {
        const tableCheck = await db.queryFirst<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__spur_cli_migrations'",
        );
        if (!tableCheck) return null;

        const row = await db.queryFirst<{ id: string }>(
            `SELECT id FROM "__spur_cli_migrations" WHERE id LIKE '${IMPORTER_SCHEMA_LEDGER_PREFIX}%' ORDER BY applied_at DESC LIMIT 1`,
        );
        if (!row?.id) return null;
        return row.id.slice(IMPORTER_SCHEMA_LEDGER_PREFIX.length);
    } catch {
        return null;
    }
}

/**
 * Check whether the recorded importer schema version in the database matches the installed version.
 * Returns null when the database is current or empty. Returns a drift verdict when older or missing.
 * Never throws on a clean database.
 */
export async function checkImporterSchemaVersion(db: DbAdapter): Promise<ImporterSchemaVersionDrift | null> {
    const recorded = await readRecordedImporterSchemaVersion(db);
    const installed = HISTORY_IMPORT_SCHEMA_VERSION;

    if (recorded === installed) {
        return null;
    }

    // Check if any importer tables exist in the database
    const existingTables = new Set<string>();
    try {
        const rows = await db.queryAll<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'history_%'",
        );
        for (const r of rows) {
            existingTables.add(r.name);
        }
    } catch {
        // Ignored — database might be in an uninitialized state
    }

    // Clean/empty database with no history tables and no migrations: not a drift condition
    if (recorded === null && existingTables.size === 0) {
        return null;
    }

    const missingTables: string[] = [];
    for (const table of IMPORTER_OWNED_TABLES) {
        if (!existingTables.has(table)) {
            missingTables.push(table);
        }
    }

    const remediation =
        recorded === null
            ? `Database has no recorded importer schema version (installed: ${installed}). Run \`spur migrate\` to apply schema updates or \`bun install\` to resync workspace packages.`
            : `Recorded importer schema version (${recorded}) does not match installed version (${installed}). Run \`spur migrate\` to apply schema updates or \`bun install\` to resync workspace packages.`;

    return {
        recorded,
        installed,
        missingTables,
        remediation,
    };
}

/**
 * Repair an importer schema drift (0815 residual 6 / 0817 buglog): idempotently
 * re-provision the importer-owned tables and re-stamp the ledger at the installed
 * version.
 *
 * Stale shadow rows — an older `importer_schema@x` row carrying a newer
 * `applied_at`, written by a stale binary's `INSERT OR REPLACE` provisioning
 * (observed: global spur 0.3.78 stamping 0.4.60 over a 0.4.62 worktree DB) — are
 * deleted so the `ORDER BY applied_at DESC` read can only see the truthful stamp.
 * `spur migrate`'s journaled fast path cannot heal this state, which is why the
 * check folds the remedy in here instead of delegating to it.
 */
export async function repairImporterSchemaVersion(db: DbAdapter): Promise<void> {
    const installed = HISTORY_IMPORT_SCHEMA_VERSION;
    // HISTORY_IMPORT_SCHEMA_SQL is DDL-only (no procedural bodies), so a naive
    // statement split is safe; statements are IF NOT EXISTS idempotent.
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)) {
        await db.exec(statement);
    }
    await db.run('DELETE FROM "__spur_cli_migrations" WHERE id LIKE ? AND id != ?', [
        `${IMPORTER_SCHEMA_LEDGER_PREFIX}%`,
        `${IMPORTER_SCHEMA_LEDGER_PREFIX}${installed}`,
    ]);
    await db.run('INSERT OR REPLACE INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
        `${IMPORTER_SCHEMA_LEDGER_PREFIX}${installed}`,
        Date.now(),
    ]);
}
