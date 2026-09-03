import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL, HISTORY_IMPORT_SCHEMA_VERSION } from '@gobing-ai/ts-llm-jsonl-importer';
import { IMPORTER_SCHEMA_LEDGER_PREFIX } from '../../packages/domain/src/analytics/importer-schema-version';
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

    test('returns 1 on a database with an older recorded version', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'importer-check-test-'));
        const dbPath = join(dir, 'test.db');
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });

        await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
        await db.exec(
            'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
        );
        const olderVersionId = `${IMPORTER_SCHEMA_LEDGER_PREFIX}0.4.51`;
        await db.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
            olderVersionId,
            Date.now(),
        ]);
        db.close();

        const code = await importerSchemaCheck(dbPath, { quiet: true });
        expect(code).toBe(1);

        await rm(dir, { recursive: true });
    });
});
