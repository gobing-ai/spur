/**
 * Guard: the embedded 0037 migration SQL is GENERATED from the released
 * `drizzle/0037_spur_cli_history_dimension_marts.sql` and cannot drift from it (task 1312).
 *
 * Failure modes this suite pins before the generator exists:
 * - the committed generated module is stale or hand-edited;
 * - escaping corrupts the SQL (backtick, backslash or `${` in the source);
 * - the export no longer carries the released bytes, or migrations.ts keeps a handwritten twin;
 * - regeneration is nondeterministic, or an unchanged source still rewrites the file.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORY_DIMENSION_MARTS_SCHEMA_SQL } from '../../packages/domain/src/migration-sql.generated';
import { CLI_MIGRATIONS } from '../../packages/domain/src/migrations';
import {
    emitMigrationSql,
    MIGRATION_SQL_SOURCE,
    migrationSqlTarget,
    renderMigrationSqlModule,
} from './emit-migration-sql';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('emit-migration-sql', () => {
    test('the committed generated module is exactly what the released SQL generates', async () => {
        const onDisk = await readFile(migrationSqlTarget(), 'utf-8');
        expect(onDisk).toBe(renderMigrationSqlModule(await readFile(MIGRATION_SQL_SOURCE, 'utf-8')));
    });

    test('the export carries the released .sql bytes verbatim', async () => {
        const released = await readFile(join(REPO_ROOT, 'drizzle/0037_spur_cli_history_dimension_marts.sql'), 'utf-8');
        expect(HISTORY_DIMENSION_MARTS_SCHEMA_SQL).toBe(released);
        const entry = CLI_MIGRATIONS.find((migration) => migration.id === '0037_spur_cli_history_dimension_marts');
        expect(entry?.sql).toBe(released);
    });

    test('migrations.ts re-exports the generated constant instead of a handwritten twin', async () => {
        const source = await readFile(join(REPO_ROOT, 'packages/domain/src/migrations.ts'), 'utf-8');
        expect(source).not.toContain('export const HISTORY_DIMENSION_MARTS_SCHEMA_SQL');
        expect(source).toContain("from './migration-sql.generated'");
    });

    test('escaping round-trips backticks, backslashes and template placeholders', async () => {
        const placeholder = ['$', '{not.interpolated}'].join('');
        const tricky = `-- a \`tick\`, a \\ slash and ${placeholder}\nSELECT '\`' AS q;\n`;
        const module = renderMigrationSqlModule(tricky);
        const dir = await mkdtemp(join(tmpdir(), 'emit-migration-sql-'));
        try {
            const path = join(dir, 'probe.ts');
            await Bun.write(path, module);
            const loaded = (await import(path)) as { HISTORY_DIMENSION_MARTS_SCHEMA_SQL: string };
            expect(loaded.HISTORY_DIMENSION_MARTS_SCHEMA_SQL).toBe(tricky);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('regeneration is deterministic and an unchanged source does not rewrite the target', async () => {
        const sql = await readFile(MIGRATION_SQL_SOURCE, 'utf-8');
        expect(renderMigrationSqlModule(sql)).toBe(renderMigrationSqlModule(sql));
        const dir = await mkdtemp(join(tmpdir(), 'emit-migration-sql-'));
        try {
            const target = join(dir, 'out.ts');
            expect(await emitMigrationSql(target)).toEqual({ target, changed: true });
            const before = (await stat(target)).mtimeMs;
            expect(await emitMigrationSql(target)).toEqual({ target, changed: false });
            expect((await stat(target)).mtimeMs).toBe(before);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
