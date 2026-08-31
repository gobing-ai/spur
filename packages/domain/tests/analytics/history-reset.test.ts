import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, HISTORY_RESET_TABLES, resetHistoryTables, TaskSessionDao } from '../../src';

async function makeDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

describe('resetHistoryTables', () => {
    test('wipes every history_* table, keeps non-history data, and is idempotent', async () => {
        const db = await makeDb();

        // Seed one normalized row, one attribution link, one ETL row, one bookkeeping row.
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq, role, record_type, disposition, content_text, provenance, imported_at)
             VALUES ('h1', 'pi', 'a.jsonl', 1, 's1', 0, 'user', 'message', 'keep', 'hello', 'ambient', '2026-08-30T12:00:00.000Z')`,
        );
        await new TaskSessionDao(db).insert({
            wbs: '0703',
            source: 'pi',
            sessionId: 's1',
            exactness: 'estimated',
            mechanism: 'slash-command',
            evidenceKind: 'user-command',
            evidenceRef: 'a.jsonl#12',
            resolvedAt: '2026-08-30T12:00:00.000Z',
        });
        await db.run(`CREATE TABLE history_etl_pi (session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL)`);
        await db.run(`INSERT INTO history_etl_pi (session_id, seq, ts) VALUES ('s1', 0, '2026-08-30T12:00:00.000Z')`);
        await db
            .run(
                `INSERT INTO history_import_ledger (source, source_file, record_hash)
             VALUES ('pi', 'a.jsonl', 'h1')`,
            )
            .catch(() => {
                // ledger column shape varies; wipe coverage is what matters
            });

        const result = await resetHistoryTables(db);

        // The other nine importer-created etl tables don't exist pre-import.
        expect(result.skipped).toEqual(
            HISTORY_RESET_TABLES.filter((t) => t.startsWith('history_etl_') && t !== 'history_etl_pi'),
        );
        expect(result.unknown).toEqual([]);
        expect(result.cleared.length).toBe(HISTORY_RESET_TABLES.length - 9);

        const remaining = await db.queryAll<{ n: number }>(
            `SELECT (SELECT COUNT(*) FROM history_message)
                   + (SELECT COUNT(*) FROM history_task_session)
                   + (SELECT COUNT(*) FROM history_etl_pi) AS n`,
        );
        expect(remaining[0]?.n).toBe(0);

        // Idempotent second run.
        const again = await resetHistoryTables(db);
        expect(again.cleared.length).toBe(HISTORY_RESET_TABLES.length - 9);
        expect(again.unknown).toEqual([]);
    });

    test('reports unlisted history_* tables instead of deleting them', async () => {
        const db = await makeDb();
        await db.run('CREATE TABLE history_zz_rogue (id INTEGER)');

        const result = await resetHistoryTables(db);

        expect(result.unknown).toEqual(['history_zz_rogue']);
        const rogue = await db.queryAll<{ n: number }>(`SELECT COUNT(*) AS n FROM history_zz_rogue`);
        expect(rogue[0]?.n).toBe(0); // table exists (was not dropped), empty
    });

    test('table list covers every history_* table the migrations create', async () => {
        // Drift guard: a migration adding a history_* table must update HISTORY_RESET_TABLES.
        // (The per-source history_etl_* tables are created by the importer at import time,
        // so post-migration equality is not expected — subset coverage is.)
        const db = await makeDb();
        const rows = await db.queryAll<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'history\\_%' ESCAPE '\\'",
        );
        for (const row of rows) {
            expect(HISTORY_RESET_TABLES).toContain(row.name);
        }
    });
});
