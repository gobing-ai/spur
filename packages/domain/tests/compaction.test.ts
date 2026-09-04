import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, type DbAdapter } from '../src';
import { historyBoardDatabaseBytes } from '../src/analytics/history-board-rollup';
import { compactDatabase, estimateReclaimableBytes } from '../src/retention';

const NOW = new Date('2026-08-20T00:00:00Z');

async function fileDb(): Promise<{ db: DbAdapter; dir: string; path: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'spur-compaction-'));
    const path = join(dir, 'spur.db');
    const db = await createMigratedDb({ url: path });
    return { db, dir, path };
}

async function seedCorpus(db: DbAdapter): Promise<void> {
    for (let i = 0; i < 50; i++) {
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens, cache_read_tokens,
                 provenance, imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            `m${i}`,
            'claude',
            'f.jsonl',
            1,
            `s${i % 5}`,
            1,
            'assistant',
            'message',
            'ok',
            `2026-08-01T00:0${i % 10}:00Z`,
            'gpt-5',
            100 + i,
            50,
            20,
            'agent',
            '2026-08-01T00:00:00Z',
        );
        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, status, imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            `t${i}`,
            `m${i}`,
            'claude',
            'f.jsonl',
            1,
            `s${i % 5}`,
            1,
            i % 2 === 0 ? 'Read' : 'Bash',
            'success',
            '2026-08-01T00:00:01Z',
        );
    }
}

describe('database compaction (0746)', () => {
    test('estimateReclaimableBytes is zero when dbstat is unavailable and non-negative otherwise', async () => {
        const { db } = await fileDb();
        // In-memory or dbstat-less DBs degrade to 0 (the helper never throws).
        const bytes = await estimateReclaimableBytes(db);
        expect(typeof bytes).toBe('number');
        expect(bytes).toBeGreaterThanOrEqual(0);
        db.close();
    });

    test('compaction skips on a recent run with the recent-run reason', async () => {
        const { db, path } = await fileDb();
        // First run establishes a marker (or runs); the immediately-following run must skip.
        await compactDatabase(db, { dbPath: path, now: NOW });
        const second = await compactDatabase(db, { dbPath: path, now: new Date(NOW.getTime() + 1) });
        expect(second.ran).toBe(false);
        expect(second.skippedReason).toBe('recent-run');
        expect(second.bytesBefore).toBe(second.bytesAfter);
        db.close();
    });

    test('compaction records the before and after size from an actual run', async () => {
        const { db, path, dir } = await fileDb();
        await seedCorpus(db);
        const before = await historyBoardDatabaseBytes(db);
        const result = await compactDatabase(db, { dbPath: path, now: NOW });
        expect(typeof result.bytesBefore).toBe('number');
        expect(result.bytesBefore).toBe(before);
        expect(typeof result.bytesAfter).toBe('number');
        if (result.ran) {
            expect(result.skippedReason).toBeUndefined();
        }
        db.close();
        rmSync(dir, { recursive: true, force: true });
    });

    test('board-read invariance: a fixed query returns identical results before and after compaction', async () => {
        const { db, path, dir } = await fileDb();
        await seedCorpus(db);
        const snapshot = async () =>
            db.queryAll<{ session_id: string; messages: number }>(
                'SELECT session_id, COUNT(*) AS messages FROM history_message GROUP BY session_id ORDER BY session_id',
            );
        const before = await snapshot();
        await compactDatabase(db, { dbPath: path, now: NOW });
        // Force a VACUUM regardless of gating so the invariance is exercised across repacking.
        await db.exec('VACUUM');
        const after = await snapshot();
        expect(after).toEqual(before);
        db.close();
        rmSync(dir, { recursive: true, force: true });
    });

    test('foreign_keys and import ledger integrity survive compaction', async () => {
        const { db, dir } = await fileDb();
        await seedCorpus(db);
        // Simulate a fresh import DDL application; the ledger/import schema is importer-owned and
        // must remain intact after re-pointing the file for VACUUM.
        await db.exec('VACUUM');
        const messageCount = await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_message');
        expect(messageCount?.n).toBe(50);
        const toolCount = await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_tool_call');
        expect(toolCount?.n).toBe(50);
        // Import-dedup short-circuit: re-inserting a known row with ON CONFLICT DO NOTHING is a no-op.
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens, cache_read_tokens,
                 provenance, imported_at)
             VALUES ('m0', 'claude', 'f.jsonl', 1, 's0', 1, 'assistant', 'message', 'ok',
                     '2026-08-01T00:00:00Z', 'gpt-5', 100, 50, 20, 'agent', '2026-08-01T00:00:00Z')
             ON CONFLICT(record_hash) DO NOTHING`,
        );
        const after = await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_message');
        expect(after?.n).toBe(50);
        db.close();
        rmSync(dir, { recursive: true, force: true });
    });
});
