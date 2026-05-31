import { join } from 'node:path';
import { applyCliMigrations, loadSqlMigrations } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Apply the regenerated Spur CLI schema migrations. */
export async function runMigrateCommand(context: CliContext, flags: Record<string, string | boolean>): Promise<number> {
    const migrations = await loadSqlMigrations(join(context.cwd, 'drizzle')).catch(() => undefined);
    const applied = await applyCliMigrations(await context.getDb(), migrations);
    const result = { ok: true, applied };
    context.output.write(flags.json === true ? toJson(result) : `Database migrations complete (${applied} applied)`);
    return 0;
}
