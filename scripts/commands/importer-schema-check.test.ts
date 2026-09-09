import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL, HISTORY_IMPORT_SCHEMA_VERSION } from '@gobing-ai/ts-llm-jsonl-importer';
import {
    IMPORTER_SCHEMA_LEDGER_PREFIX,
    readRecordedImporterSchemaVersion,
} from '../../packages/domain/src/analytics/importer-schema-version';
import { importerSchemaCheck } from './importer-schema-check';

describe('importer-schema-check (0748 R3/R5)', () => {
    test('returns 0 when database file does not exist', async () => {
        const nonExistent = join(tmpdir(), `nonexistent-db-${Date.now()}.db`);
        const code = await importerSchemaCheck(nonExistent, { quiet: true });
        expect(code).toBe(0);
    });

    test('returns 0 on a database with matching recorded version', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'importer-check-test-'));
        const dbPath = join(dir, 'test.db');
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });

        for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
            .map((s) => s.trim())
            .filter(Boolean)) {
            await db.exec(statement);
        }

        await db.exec(
            'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
        );
        const currentVersionId = `${IMPORTER_SCHEMA_LEDGER_PREFIX}${HISTORY_IMPORT_SCHEMA_VERSION}`;
        await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
            currentVersionId,
            Date.now(),
        ]);
        db.close();

        const code = await importerSchemaCheck(dbPath, { quiet: true });
        expect(code).toBe(0);

        await rm(dir, { recursive: true });
    });

    test('auto-remedies a stale ledger stamp on a current-schema database and returns 0', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'importer-check-test-'));
        const dbPath = join(dir, 'test.db');
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });

        for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
            .map((s) => s.trim())
            .filter(Boolean)) {
            await db.exec(statement);
        }
        await db.exec(
            'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
        );
        // Schema is current but the ledger says 0.4.51 (e.g. dependency bump without migrate).
        await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
            `${IMPORTER_SCHEMA_LEDGER_PREFIX}0.4.51`,
            Date.now(),
        ]);
        db.close();

        const code = await importerSchemaCheck(dbPath, { quiet: true });
        expect(code).toBe(0);

        const verify = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
        const recorded = await readRecordedImporterSchemaVersion(verify);
        verify.close();
        expect(recorded).toBe(HISTORY_IMPORT_SCHEMA_VERSION);

        await rm(dir, { recursive: true });
    });

    test('still returns 1 with the manual remedy when the schema cannot be auto-healed', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'importer-check-test-'));
        const dbPath = join(dir, 'test.db');
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });

        // Hostile stub: table exists with a shape no migration path can evolve in place.
        await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
        await db.exec(
            'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
        );
        await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
            `${IMPORTER_SCHEMA_LEDGER_PREFIX}0.4.51`,
            Date.now(),
        ]);
        db.close();

        const code = await importerSchemaCheck(dbPath, { quiet: true });
        expect(code).toBe(1);

        await rm(dir, { recursive: true });
    });

    test('auto-remedies a stale shadow ledger row with a newer applied_at (0817 buglog)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'importer-check-test-'));
        const dbPath = join(dir, 'test.db');
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });

        for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
            .map((s) => s.trim())
            .filter(Boolean)) {
            await db.exec(statement);
        }
        await db.exec(
            'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
        );
        // Truthful stamp first (older applied_at)…
        await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
            `${IMPORTER_SCHEMA_LEDGER_PREFIX}${HISTORY_IMPORT_SCHEMA_VERSION}`,
            Date.now() - 60_000,
        ]);
        // …then a stale binary's false row shadows it with a newer applied_at.
        await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
            `${IMPORTER_SCHEMA_LEDGER_PREFIX}0.4.60`,
            Date.now(),
        ]);
        db.close();

        const code = await importerSchemaCheck(dbPath, { quiet: true });
        expect(code).toBe(0);

        const verify = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
        const recorded = await readRecordedImporterSchemaVersion(verify);
        const stale = await verify.queryFirst<{ id: string }>(
            'SELECT id FROM "__spur_cli_migrations" WHERE id = ?',
            `${IMPORTER_SCHEMA_LEDGER_PREFIX}0.4.60`,
        );
        verify.close();
        expect(recorded).toBe(HISTORY_IMPORT_SCHEMA_VERSION);
        expect(stale).toBeUndefined(); // false shadow row deleted, not just out-dated

        await rm(dir, { recursive: true });
    });
});
