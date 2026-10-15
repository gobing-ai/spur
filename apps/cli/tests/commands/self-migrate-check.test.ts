/**
 * `spur self migrate [--check]` (script-absorption PR-9). Ports the scenarios of the retired
 * `scripts/commands/importer-schema-check.test.ts` (0748 R3/R5, 0815 residual 6, 0817 buglog):
 * the check is read-only and exits 1 on drift; `spur self migrate` performs the remedy the old
 * script folded into its check (CLI migrations + importer ledger repair).
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import {
    IMPORTER_SCHEMA_KEY,
    IMPORTER_SCHEMA_LEDGER_PREFIX,
    readRecordedImporterSchemaVersion,
} from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { checkImporterSchema, renderImporterSchemaCheck } from '../../src/commands/migrate';
import { main } from '../../src/index';
import { createCapturedOutput } from '../helpers';

async function run(cwd: string, argv: string[], env: Record<string, string> = {}) {
    const output = createCapturedOutput();
    const exitCode = await main(argv, { cwd, output, env: { PATH: getEnvVars().PATH ?? '', ...env } });
    return { exitCode, stdout: output.messages.join('\n'), stderr: output.errors.join('\n') };
}

async function withProject(
    seed: ((db: DbAdapter) => Promise<void>) | null,
    body: (dir: string, dbPath: string) => Promise<void>,
) {
    const dir = mkdtempSync(join(tmpdir(), 'self-migrate-check-'));
    const dbPath = join(dir, '.spur', 'spur.db');
    try {
        if (seed !== null) {
            mkdirSync(join(dir, '.spur'), { recursive: true });
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
            await seed(db);
            db.close();
        }
        await body(dir, dbPath);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function importerSchema(db: DbAdapter): Promise<void> {
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await db.exec(statement);
    }
    await db.exec(
        'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );
}

async function stamp(db: DbAdapter, version: string, appliedAt = Date.now()): Promise<void> {
    await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
        `${IMPORTER_SCHEMA_LEDGER_PREFIX}${version}`,
        appliedAt,
    ]);
}

async function recorded(dbPath: string): Promise<string | null> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
    try {
        return await readRecordedImporterSchemaVersion(db);
    } finally {
        db.close();
    }
}

describe('spur self migrate --check', () => {
    test('an absent database is OK and is not created by either CLI spelling', async () => {
        await withProject(null, async (dir, dbPath) => {
            const result = await checkImporterSchema({ cwd: dir, env: {}, fs: createNodeFileSystem() });
            expect(result).toEqual({ state: 'absent', url: dbPath });
            expect(renderImporterSchemaCheck(result, dir).out).toEqual([
                'importer schema OK — database file absent (.spur/spur.db).',
            ]);
            expect(existsSync(dbPath)).toBe(false);
            for (const argv of [['self', 'migrate'], ['migrate']]) {
                const checked = await run(dir, ['--no-logo', ...argv, '--check', '--json']);
                expect(checked.exitCode).toBe(0);
                expect(JSON.parse(checked.stdout)).toMatchObject({ state: 'absent' });
                expect(existsSync(dbPath)).toBe(false);
            }
        });
    });

    test('CLI check reports missing tables without migrating the existing database', async () => {
        await withProject(
            async (db) => {
                await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
            },
            async (dir, dbPath) => {
                const tables = async () => {
                    const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
                    try {
                        return await db.queryAll("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
                    } finally {
                        db.close();
                    }
                };
                const before = await tables();
                const checked = await run(dir, ['self', 'migrate', '--check', '--json']);
                expect(checked.exitCode).toBe(1);
                expect(JSON.parse(checked.stdout)).toMatchObject({ state: 'drift' });
                expect(await tables()).toEqual(before);
            },
        );
    });

    test('a matching recorded version is OK (text and --json)', async () => {
        await withProject(
            async (db) => {
                await importerSchema(db);
                await stamp(db, IMPORTER_SCHEMA_KEY);
            },
            async (dir) => {
                const r = await run(dir, ['self', 'migrate', '--check']);
                expect(r.exitCode).toBe(0);
                expect(r.stdout).toContain('recorded version matches installed version');
                const j = await run(dir, ['self', 'migrate', '--check', '--json']);
                expect(JSON.parse(j.stdout)).toMatchObject({ ok: true, state: 'ok' });
            },
        );
    });

    test('a stale stamp is reported (exit 1, no write); spur self migrate heals it', async () => {
        await withProject(
            async (db) => {
                await importerSchema(db);
                await stamp(db, '0.4.51');
            },
            async (dir, dbPath) => {
                const r = await run(dir, ['self', 'migrate', '--check']);
                expect(r.exitCode).toBe(1);
                expect(r.stderr).toContain('importer schema drift detected:');
                expect(r.stderr).toContain('recorded:  0.4.51');
                expect(r.stderr).toContain('remedy:    spur self migrate');
                expect(await recorded(dbPath)).toBe('0.4.51');
                const j = await run(dir, ['self', 'migrate', '--check', '--json']);
                expect(j.exitCode).toBe(1);
                expect(JSON.parse(j.stdout)).toMatchObject({ ok: false, state: 'drift' });

                expect((await run(dir, ['self', 'migrate'])).exitCode).toBe(0);
                expect(await recorded(dbPath)).toBe(IMPORTER_SCHEMA_KEY);
                expect((await run(dir, ['self', 'migrate', '--check'])).exitCode).toBe(0);
            },
        );
    });

    test('missing importer tables are listed (direct check on an unmigrated DB)', async () => {
        await withProject(
            async (db) => {
                await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
            },
            async (dir) => {
                const result = await checkImporterSchema({ cwd: dir, env: {}, fs: createNodeFileSystem() });
                expect(result.state).toBe('drift');
                const { err } = renderImporterSchemaCheck(result, dir);
                expect(err).toContain('  recorded:  none');
                expect(err.some((line) => line.startsWith('  missing:   '))).toBe(true);
            },
        );
    });

    test('a stale shadow ledger row with a newer applied_at is healed by spur self migrate (0817)', async () => {
        await withProject(
            async (db) => {
                await importerSchema(db);
                await stamp(db, IMPORTER_SCHEMA_KEY, Date.now() - 60_000);
                await stamp(db, '0.4.60');
            },
            async (dir, dbPath) => {
                expect((await run(dir, ['self', 'migrate', '--check'])).exitCode).toBe(1);
                expect((await run(dir, ['self', 'migrate'])).exitCode).toBe(0);
                expect(await recorded(dbPath)).toBe(IMPORTER_SCHEMA_KEY);
            },
        );
    });

    test('DATABASE_URL selects the checked database', async () => {
        await withProject(null, async (dir) => {
            const other = join(dir, 'elsewhere.db');
            const result = await checkImporterSchema({
                cwd: dir,
                env: { DATABASE_URL: other },
                fs: createNodeFileSystem(),
            });
            expect(result).toEqual({ state: 'absent', url: other });
            expect(renderImporterSchemaCheck(result, dir).out[0]).toContain('(elsewhere.db)');
        });
    });
});
