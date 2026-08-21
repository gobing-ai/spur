import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { applyCliMigrations, loadSqlMigrations } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/** Register `spur migrate` command (optionally hidden from the top-level help listing). */
export function registerMigrateCommand(
    program: Command,
    context: CliContext,
    options: { hidden?: boolean } = {},
): void {
    program
        .command('migrate', { hidden: options.hidden === true })
        .summary('apply CLI-owned schema migrations')
        .option(...SHARED_OPTIONS.json)
        .action(async (options) => {
            const migrations = await loadSqlMigrations(join(context.cwd, 'drizzle')).catch(() => undefined);
            const applied = await applyCliMigrations(await context.getDb(), migrations);
            const result = { ok: true, applied };
            context.output.write(
                options.json === true ? toJson(result) : `Database migrations complete (${applied} applied)`,
            );
        });
}
