import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import {
    EMPTY_ROLLUP_WATERMARK,
    ROLLUP_DEFINITION_VERSION,
    readRollupWatermarks,
    rollupTableFreshness,
    writeRollupWatermark,
} from '../../src/analytics/rollup-watermark';
import { applyCliMigrations } from '../../src/migrations';

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    await applyCliMigrations(adapter);
    return adapter;
}

async function insertMessage(
    db: DbAdapter,
    m: {
        recordHash: string;
        sessionId: string;
        seq: number;
        ts: string;
        importedAt: string;
        input?: number | null;
        output?: number | null;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, cache_read_tokens, output_tokens,
             cost_usd, provenance, run_id, task_wbs, duration_ms, request_id, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.recordHash,
        'claude',
        'test.jsonl',
        1,
        m.sessionId,
        m.seq,
        'assistant',
        'message',
        'conversation',
        m.ts,
        'gpt-5',
        m.input ?? 0,
        0,
        m.output ?? 0,
        null,
        'agent',
        null,
        null,
        null,
        null,
        m.importedAt,
    );
}

async function newestImportedAt(db: DbAdapter): Promise<string> {
    const row = await db.queryFirst<{ newest: string | null }>(
        'SELECT MAX(imported_at) AS newest FROM history_message',
    );
    return row?.newest ?? '';
}

describe('rollup-watermark (task 0741)', () => {
    test('readRollupWatermarks returns an empty map, and a missing table reads as the sentinel', async () => {
        const db = await setup();
        const watermarks = await readRollupWatermarks(db);
        expect(watermarks.size).toBe(0);
        const missing = watermarks.get('history_board_message_5m') ?? EMPTY_ROLLUP_WATERMARK;
        expect(missing.importedAtWatermark).toBe('');
        expect(missing.definitionVersion).toBe('');
    });

    test('writeRollupWatermark upserts a row that readRoundtrips', async () => {
        const db = await setup();
        await writeRollupWatermark(db, 'history_board_message_5m', {
            importedAtWatermark: '2026-06-01T00:00:00Z',
            definitionVersion: ROLLUP_DEFINITION_VERSION,
        });
        const watermarks = await readRollupWatermarks(db);
        expect(watermarks.get('history_board_message_5m')).toMatchObject({
            importedAtWatermark: '2026-06-01T00:00:00Z',
            definitionVersion: ROLLUP_DEFINITION_VERSION,
        });
        // Upsert replaces, never duplicates.
        await writeRollupWatermark(db, 'history_board_message_5m', {
            importedAtWatermark: '2026-06-02T00:00:00Z',
            definitionVersion: ROLLUP_DEFINITION_VERSION,
        });
        const rows = await db.queryAll<{ table_name: string }>(
            'SELECT table_name FROM history_board_rollup_watermark WHERE table_name = ?',
            'history_board_message_5m',
        );
        expect(rows).toHaveLength(1);
        const again = await readRollupWatermarks(db);
        expect(again.get('history_board_message_5m')?.importedAtWatermark).toBe('2026-06-02T00:00:00Z');
    });

    test('a table with no watermark row reports stale', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'm1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T09:58:00Z',
            importedAt: '2026-06-01T10:00:00Z',
        });
        const freshness = await rollupTableFreshness(db);
        expect(freshness.get('history_board_message_5m')?.fresh).toBe(false);
        expect(freshness.get('history_board_session_stats')?.fresh).toBe(false);
    });

    test('a table whose watermark covers the newest imported_at reports fresh with no stale buckets', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'm1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T09:58:00Z',
            importedAt: '2026-06-01T10:00:00Z',
        });
        await writeRollupWatermark(db, 'history_board_message_5m', {
            importedAtWatermark: await newestImportedAt(db),
            definitionVersion: ROLLUP_DEFINITION_VERSION,
        });
        const freshness = await rollupTableFreshness(db);
        expect(freshness.get('history_board_message_5m')).toMatchObject({ fresh: true, staleBuckets: [] });
    });

    test('stale bucket range equals the distinct buckets touched by the imported rows', async () => {
        const db = await setup();
        // Two new 1-minute buckets; both imported after the watermark.
        await insertMessage(db, {
            recordHash: 'm1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T09:58:00Z',
            importedAt: '2026-06-01T10:00:00Z',
        });
        await insertMessage(db, {
            recordHash: 'm2',
            sessionId: 's2',
            seq: 1,
            ts: '2026-06-01T10:06:00Z',
            importedAt: '2026-06-01T10:10:00Z',
        });
        // Watermark covers imports up to 09:00Z — both rows are new.
        await writeRollupWatermark(db, 'history_board_message_5m', {
            importedAtWatermark: '2026-06-01T09:00:00Z',
            definitionVersion: ROLLUP_DEFINITION_VERSION,
        });
        const freshness = await rollupTableFreshness(db);
        const verdict = freshness.get('history_board_message_5m');
        expect(verdict?.fresh).toBe(false);
        expect(verdict?.staleBuckets).toEqual(['2026-06-01T09:58:00Z', '2026-06-01T10:06:00Z']);
    });

    test('a wrong definition version forces a stale verdict even when the watermark covers', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'm1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T09:58:00Z',
            importedAt: '2026-06-01T10:00:00Z',
        });
        await writeRollupWatermark(db, 'history_board_message_5m', {
            importedAtWatermark: await newestImportedAt(db),
            definitionVersion: 'v999-old',
        });
        const freshness = await rollupTableFreshness(db);
        expect(freshness.get('history_board_message_5m')?.fresh).toBe(false);
    });
});
