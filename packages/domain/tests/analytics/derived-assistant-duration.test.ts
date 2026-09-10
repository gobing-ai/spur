import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { DERIVED_DURATION_CEILING_MS, HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import { deriveMissingAssistantDurations } from '../../src/analytics/derived-assistant-duration';

/**
 * The set-based backfill of assistant-step `duration_ms` (0702 R2) that replaced
 * the upstream per-row `deriveAssistantDurations` loop at the import call site —
 * the loop's ~167k awaited single-row UPDATEs blew the refresh job budget on a
 * 2M-row corpus. Same honesty contract: a provider value is never overwritten, a
 * session gap is never billed as work, an unparseable timestamp is never touched.
 */

const CEILING = DERIVED_DURATION_CEILING_MS;

async function setup(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await db.exec(statement);
    }
    return db;
}

interface Row {
    hash: string;
    seq: number;
    role: string;
    ts: string | null;
    durationMs?: number | null;
    session?: string;
    source?: string;
}

async function insert(db: DbAdapter, row: Row): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, duration_ms, provenance, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        row.hash,
        row.source ?? 'claude',
        'f.jsonl',
        row.seq,
        row.session ?? 'sess-1',
        row.seq,
        row.role,
        'message',
        'kept',
        row.ts,
        row.durationMs ?? null,
        'ambient',
        '2026-08-28T00:00:00.000Z',
    );
}

async function read(
    db: DbAdapter,
    hash: string,
): Promise<{ duration_ms: number | null; duration_source: string | null }> {
    const row = await db.queryFirst<{ duration_ms: number | null; duration_source: string | null }>(
        'SELECT duration_ms, duration_source FROM history_message WHERE record_hash = ?',
        hash,
    );
    return row ?? { duration_ms: null, duration_source: null };
}

describe('deriveMissingAssistantDurations (0702 R2, set-based)', () => {
    test('fills an unmeasured assistant step from the delta to the preceding record', async () => {
        const db = await setup();
        await insert(db, { hash: 'u1', seq: 1, role: 'user', ts: '2026-08-28T10:00:00.000Z' });
        await insert(db, { hash: 'a1', seq: 2, role: 'assistant', ts: '2026-08-28T10:00:04.500Z' });

        await deriveMissingAssistantDurations(db, CEILING);

        expect(await read(db, 'a1')).toEqual({ duration_ms: 4500, duration_source: 'derived' });
    });

    test('never overwrites a provider-reported duration', async () => {
        const db = await setup();
        await insert(db, { hash: 'u1', seq: 1, role: 'user', ts: '2026-08-28T10:00:00.000Z' });
        await insert(db, {
            hash: 'a1',
            seq: 2,
            role: 'assistant',
            ts: '2026-08-28T10:00:09.000Z',
            durationMs: 1234,
        });

        await deriveMissingAssistantDurations(db, CEILING);

        expect(await read(db, 'a1')).toEqual({ duration_ms: 1234, duration_source: null });
    });

    test('leaves a gap over the ceiling unmeasured and partitions by session', async () => {
        const db = await setup();
        await insert(db, { hash: 'u1', seq: 1, role: 'user', ts: '2026-08-28T10:00:00.000Z' });
        const overCeiling = new Date(Date.parse('2026-08-28T10:00:00.000Z') + CEILING + 60_000);
        await insert(db, { hash: 'a1', seq: 2, role: 'assistant', ts: overCeiling.toISOString() });
        // A second session must not borrow its LAG baseline from the first.
        await insert(db, {
            hash: 'u2',
            seq: 1,
            role: 'user',
            ts: '2026-08-28T11:00:00.000Z',
            session: 'sess-2',
        });
        await insert(db, {
            hash: 'a2',
            seq: 2,
            role: 'assistant',
            ts: '2026-08-28T11:00:01.250Z',
            session: 'sess-2',
        });

        await deriveMissingAssistantDurations(db, CEILING);

        expect(await read(db, 'a1')).toEqual({ duration_ms: null, duration_source: null });
        expect(await read(db, 'a2')).toEqual({ duration_ms: 1250, duration_source: 'derived' });
    });

    test('leaves a non-positive delta and rows without a parseable timestamp unmeasured', async () => {
        const db = await setup();
        await insert(db, { hash: 'u1', seq: 1, role: 'user', ts: '2026-08-28T10:00:00.000Z' });
        await insert(db, { hash: 'a1', seq: 2, role: 'assistant', ts: '2026-08-28T10:00:00.000Z' });
        await insert(db, { hash: 'a2', seq: 3, role: 'assistant', ts: 'garbage' });

        await deriveMissingAssistantDurations(db, CEILING);

        expect(await read(db, 'a1')).toEqual({ duration_ms: null, duration_source: null });
        expect(await read(db, 'a2')).toEqual({ duration_ms: null, duration_source: null });
    });
});
