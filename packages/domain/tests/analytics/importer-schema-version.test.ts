import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL, HISTORY_IMPORT_SCHEMA_VERSION } from '@gobing-ai/ts-llm-jsonl-importer';
import {
    checkImporterSchemaVersion,
    IMPORTER_SCHEMA_LEDGER_PREFIX,
    readRecordedImporterSchemaVersion,
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
            const versionRowId = IMPORTER_SCHEMA_LEDGER_PREFIX + '0.4.55';
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
            const currentVersionId = IMPORTER_SCHEMA_LEDGER_PREFIX + HISTORY_IMPORT_SCHEMA_VERSION;
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
            const olderVersionId = IMPORTER_SCHEMA_LEDGER_PREFIX + '0.4.51';
            await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
                olderVersionId,
                Date.now(),
            ]);

            const drift = await checkImporterSchemaVersion(db);
            expect(drift).not.toBeNull();
            expect(drift?.recorded).toBe('0.4.51');
            expect(drift?.installed).toBe(HISTORY_IMPORT_SCHEMA_VERSION);
            // history_skill_call was not created in 0.4.51
            expect(drift?.missingTables).toContain('history_skill_call');
            expect(drift?.remediation).toContain('0.4.51');
            expect(drift?.remediation).toContain(HISTORY_IMPORT_SCHEMA_VERSION);
            expect(drift?.remediation).toContain('spur migrate');
            db.close();
        });

        test('reports drift when history tables exist but no version was recorded', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
            const drift = await checkImporterSchemaVersion(db);
            expect(drift).not.toBeNull();
            expect(drift?.recorded).toBeNull();
            expect(drift?.installed).toBe(HISTORY_IMPORT_SCHEMA_VERSION);
            db.close();
        });
    });

    describe('migration 0033 integration (AC R4)', () => {
        test('applying migrations records importer_schema version in migration ledger', async () => {
            const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(db);

            const recorded = await readRecordedImporterSchemaVersion(db);
            expect(recorded).toBe(HISTORY_IMPORT_SCHEMA_VERSION);

            const drift = await checkImporterSchemaVersion(db);
            expect(drift).toBeNull();
            db.close();
        });
    });
});
