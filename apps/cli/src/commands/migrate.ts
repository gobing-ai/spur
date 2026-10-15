import { join, relative } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    applyCliMigrations,
    checkImporterSchemaVersion,
    type ImporterSchemaVersionDrift,
    loadSqlMigrations,
    openExistingDb,
    repairImporterSchemaVersion,
} from '@gobing-ai/spur-domain';
import { type CliContext, resolveDatabaseUrl } from '../context';
import { toEnvelopeJson } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/** Outcome of the read-only importer-schema check (`spur self migrate --check`). */
export type ImporterSchemaCheckResult =
    | { state: 'absent'; url: string }
    | { state: 'ok'; url: string }
    | { state: 'drift'; url: string; drift: ImporterSchemaVersionDrift };

/**
 * Read-only check that the project DB records the importer schema version of the installed
 * `@gobing-ai/ts-llm-jsonl-importer` (task 0748; absorbed from the retired
 * `scripts/commands/importer-schema-check.ts` by script-absorption PR-9). An absent DB file is
 * OK and is never created; the DB is opened raw, so no migration runs.
 */
export async function checkImporterSchema(
    context: Pick<CliContext, 'cwd' | 'env' | 'fs'>,
): Promise<ImporterSchemaCheckResult> {
    const url = resolveDatabaseUrl(context.cwd, context.env);
    if (!(await context.fs.exists(url))) return { state: 'absent', url };
    const db = await openExistingDb(url);
    try {
        const drift = await checkImporterSchemaVersion(db);
        return drift === null ? { state: 'ok', url } : { state: 'drift', url, drift };
    } finally {
        db.close();
    }
}

/** Human lines for a check result; drift lines go to stderr. */
export function renderImporterSchemaCheck(
    result: ImporterSchemaCheckResult,
    cwd: string,
): { out: string[]; err: string[] } {
    const where = relative(cwd, result.url) || result.url;
    if (result.state === 'absent') return { out: [`importer schema OK — database file absent (${where}).`], err: [] };
    if (result.state === 'ok')
        return { out: ['importer schema OK — recorded version matches installed version.'], err: [] };
    const err = [
        'importer schema drift detected:',
        `  recorded:  ${result.drift.recorded ?? 'none'}`,
        `  installed: ${result.drift.installed}`,
    ];
    if (result.drift.missingTables.length > 0) err.push(`  missing:   ${result.drift.missingTables.join(', ')}`);
    err.push('  remedy:    spur self migrate');
    return { out: [], err };
}

/** Register `spur migrate` command (optionally hidden from the top-level help listing). */
export function registerMigrateCommand(
    program: Command,
    context: CliContext,
    options: { hidden?: boolean } = {},
): void {
    program
        .command('migrate', { hidden: options.hidden === true })
        .summary('apply CLI-owned schema migrations (or --check the importer schema)')
        .description(
            [
                'Apply CLI-owned schema migrations and repair the importer schema ledger',
                '(stale or shadowed version stamps). With --check, only report: exit 1 when the',
                'recorded importer schema version drifts from the installed importer (no writes;',
                'an absent database is OK and is not created).',
            ].join('\n'),
        )
        .option('--check', 'report importer schema drift without writing (exit 1 on drift)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            if (options.check === true) {
                const result = await checkImporterSchema(context);
                const ok = result.state !== 'drift';
                if (options.json === true) {
                    context.output.write(toEnvelopeJson({ ok, ...result }, { enveloped: options.jsonEnvelope }));
                } else {
                    const { out, err } = renderImporterSchemaCheck(result, context.cwd);
                    for (const line of out) context.output.write(line);
                    for (const line of err) context.output.error(line);
                }
                if (!ok) context.setExitCode(1);
                return;
            }
            const migrations = await loadSqlMigrations(join(context.cwd, 'drizzle')).catch(() => undefined);
            const db = await context.getDb();
            const applied = await applyCliMigrations(db, migrations);
            // Fold the importer-ledger repair in (0815 residual 6): stale shadow ledger rows are
            // unreachable by the journaled migrate fast path.
            await repairImporterSchemaVersion(db);
            const result = { ok: true, applied };
            context.output.write(
                options.json === true
                    ? toEnvelopeJson(result, { enveloped: options.jsonEnvelope })
                    : `Database migrations complete (${applied} applied)`,
            );
        });
}
