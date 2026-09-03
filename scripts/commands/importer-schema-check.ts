#!/usr/bin/env bun
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { checkImporterSchemaVersion } from '../../packages/domain/src/analytics/importer-schema-version';

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
                console.error('importer-schema-check FAILED — schema version drift detected:');
                console.error(`  recorded:  ${drift.recorded ?? 'none'}`);
                console.error(`  installed: ${drift.installed}`);
                if (drift.missingTables.length > 0) {
                    console.error(`  missing:   ${drift.missingTables.join(', ')}`);
                }
                console.error(`  remedy:    ${drift.remediation}\n`);
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
