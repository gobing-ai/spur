#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    checkImporterSchemaVersion,
    repairImporterSchemaVersion,
} from '../../packages/domain/src/analytics/importer-schema-version';
import { applyCliMigrations } from '../../packages/domain/src/migrations';

export interface ImporterSchemaCheckOptions {
    dbPath?: string;
    quiet?: boolean;
}

/**
 * Check that the SQLite database has a recorded importer schema version matching
 * the installed @gobing-ai/ts-llm-jsonl-importer package.
 *
 * Runs as part of the spur-check chain before lint.
 */
export async function importerSchemaCheck(
    dbPathOrOptions?: string | ImporterSchemaCheckOptions,
    options?: { quiet?: boolean },
): Promise<number> {
    const opts = typeof dbPathOrOptions === 'object' ? dbPathOrOptions : { dbPath: dbPathOrOptions, ...options };
    const quiet = opts.quiet ?? false;
    const targetDb = opts.dbPath ?? process.env.SPUR_DB_PATH ?? join(process.cwd(), '.spur', 'spur.db');

    if (!existsSync(targetDb)) {
        if (!quiet) {
            console.log('importer-schema-check OK — database file absent (.spur/spur.db).');
        }
        return 0;
    }

    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: targetDb });
    try {
        const drift = await checkImporterSchemaVersion(adapter);
        if (drift) {
            if (!quiet) {
                console.error('importer-schema-check — schema version drift detected:');
                console.error(`  recorded:  ${drift.recorded ?? 'none'}`);
                console.error(`  installed: ${drift.installed}`);
                if (drift.missingTables.length > 0) {
                    console.error(`  missing:   ${drift.missingTables.join(', ')}`);
                }
                console.error(
                    '  remedy:    auto-reprovisioning importer schema and re-stamping ledger (0815 residual 6)…',
                );
            }
            // Fold the migrate remedy into the check (0815 residual 6), in two passes:
            //   1. applyCliMigrations — genuine older-schema drift (guarded ALTERs evolve
            //      existing tables; embedded CLI_MIGRATIONS cover the drizzle set).
            //   2. repairImporterSchemaVersion — stale shadow ledger rows (a stale binary's
            //      INSERT OR REPLACE with newer applied_at), unreachable by migrate's
            //      journaled fast path.
            try {
                await applyCliMigrations(adapter);
                await repairImporterSchemaVersion(adapter);
            } catch (error) {
                if (!quiet) {
                    console.error(`importer-schema-check FAILED — auto-remedy threw: ${error}`);
                    console.error(`  manual remedy: ${drift.remediation}\n`);
                }
                return 1;
            }
            const after = await checkImporterSchemaVersion(adapter);
            if (after === null) {
                if (!quiet) {
                    console.log(
                        'importer-schema-check OK — drift auto-remedied; recorded version now matches installed version.',
                    );
                }
                return 0;
            }
            if (!quiet) {
                console.error('importer-schema-check FAILED — drift persists after auto-remedy:');
                console.error(`  recorded:  ${after.recorded ?? 'none'}`);
                console.error(`  installed: ${after.installed}`);
                console.error(`  remedy:    ${after.remediation}\n`);
            }
            return 1;
        }

        if (!quiet) {
            console.log('importer-schema-check OK — recorded version matches installed version.');
        }
        return 0;
    } finally {
        adapter.close();
    }
}

if (import.meta.main) {
    const code = await importerSchemaCheck();
    process.exit(code);
}
