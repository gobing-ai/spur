import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import {
    checkImporterSchemaVersion,
    IMPORTER_SCHEMA_KEY,
    IMPORTER_SCHEMA_LEDGER_PREFIX,
    readRecordedImporterSchemaVersion,
    repairImporterSchemaVersion,
} from '../../src/analytics/importer-schema-version';
import { applyCliMigrations } from '../../src/migrations';

describe('importer-schema-version (task 0748)', () => {
    describe('readRecordedImporterSchemaVersion', () => {
        test('returns null on a fresh database without migration table', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            const version = await readRecordedImporterSchemaVersion(db);
            expect(version).toBeNull();
            db.close();
        });

        test('returns null when migration table exists but carries no importer_schema row', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await db.exec(
                'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
            );
            await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
                '0000_other',
                Date.now(),
            ]);
            const version = await readRecordedImporterSchemaVersion(db);
            expect(version).toBeNull();
            db.close();
        });

        test('returns version string when importer_schema row is present', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await db.exec(
                'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
            );
            const versionRowId = `${IMPORTER_SCHEMA_LEDGER_PREFIX}0.4.55`;
            await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
                versionRowId,
                Date.now(),
            ]);
            const version = await readRecordedImporterSchemaVersion(db);
            expect(version).toBe('0.4.55');
            db.close();
        });
    });

    describe('checkImporterSchemaVersion', () => {
        test('returns null on a clean empty database with no history tables', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            const drift = await checkImporterSchemaVersion(db);
            expect(drift).toBeNull();
            db.close();
        });

        test('returns null on a database with matching recorded version', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
                .map((s) => s.trim())
                .filter(Boolean)) {
                await db.exec(statement);
            }
            await db.exec(
                'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
            );
            const currentVersionId = IMPORTER_SCHEMA_LEDGER_PREFIX + IMPORTER_SCHEMA_KEY;
            await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
                currentVersionId,
                Date.now(),
            ]);

            const drift = await checkImporterSchemaVersion(db);
            expect(drift).toBeNull();
            db.close();
        });

        test('R4/R5/R9: detects database created with older importer version and reports missing tables', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            // Simulate 0.4.51 schema (has history_message, but lacks history_skill_call)
            await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
            await db.exec('CREATE TABLE history_tool_call (record_hash TEXT PRIMARY KEY)');
            await db.exec('CREATE TABLE history_import_checkpoint (source TEXT PRIMARY KEY)');
            await db.exec('CREATE TABLE history_import_ledger (record_hash TEXT PRIMARY KEY)');
            await db.exec(
                'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
            );
            const olderVersionId = `${IMPORTER_SCHEMA_LEDGER_PREFIX}0.4.51`;
            await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
                olderVersionId,
                Date.now(),
            ]);

            const drift = await checkImporterSchemaVersion(db);
            expect(drift).not.toBeNull();
            expect(drift?.recorded).toBe('0.4.51');
            expect(drift?.installed).toBe(IMPORTER_SCHEMA_KEY);
            // history_skill_call was not created in 0.4.51
            expect(drift?.missingTables).toContain('history_skill_call');
            expect(drift?.remediation).toContain('0.4.51');
            expect(drift?.remediation).toContain(IMPORTER_SCHEMA_KEY);
            expect(drift?.remediation).toContain('spur self migrate');
            db.close();
        });

        test('reports drift when history tables exist but no version was recorded', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
            const drift = await checkImporterSchemaVersion(db);
            expect(drift).not.toBeNull();
            expect(drift?.recorded).toBeNull();
            expect(drift?.installed).toBe(IMPORTER_SCHEMA_KEY);
            db.close();
        });
    });

    describe('migration 0033 integration (AC R4)', () => {
        test('applying migrations records importer_schema version in migration ledger', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(db);

            const recorded = await readRecordedImporterSchemaVersion(db);
            expect(recorded).toBe(IMPORTER_SCHEMA_KEY);

            const drift = await checkImporterSchemaVersion(db);
            expect(drift).toBeNull();
            db.close();
        });
    });
});

/**
 * Task 1388 touched this module's remedy strings (`spur migrate` → `spur self migrate`), so the
 * file must meet the coverage bar. These cases cover the two paths the suite left unexercised: an
 * unreadable ledger (the catch in the reader) and the repair routine's journal rewrite.
 */
describe('importer schema version — unreadable ledger and repair (task 1388)', () => {
    test('an unreadable ledger reads as "no recorded key" rather than throwing', async () => {
        const broken = {
            queryFirst: async () => {
                throw new Error('no such table: __spur_cli_migrations');
            },
        } as unknown as DbAdapter;
        expect(await readRecordedImporterSchemaVersion(broken)).toBeNull();
    });

    test('repair rewrites the journal to exactly one current key', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        try {
            await applyCliMigrations(db);
            await db.run('INSERT OR REPLACE INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
                `${IMPORTER_SCHEMA_LEDGER_PREFIX}stale`,
                1,
            ]);
            await repairImporterSchemaVersion(db);
            const keys = await db.queryAll<{ id: string }>(
                `SELECT id FROM "__spur_cli_migrations" WHERE id LIKE '${IMPORTER_SCHEMA_LEDGER_PREFIX}%'`,
            );
            expect(keys).toHaveLength(1);
            expect(keys[0]?.id).toBe(`${IMPORTER_SCHEMA_LEDGER_PREFIX}${IMPORTER_SCHEMA_KEY}`);
            expect(await readRecordedImporterSchemaVersion(db)).toBe(IMPORTER_SCHEMA_KEY);
            expect(await checkImporterSchemaVersion(db)).toBeNull();
        } finally {
            await db.close();
        }
    });
});
