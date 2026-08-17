import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import { messageRollup, sessionSpans } from '../../src/analytics/forensic-query';
import {
    applyWatermarkToWhere,
    buildWatermarkFilter,
    dataWindow,
    materializeWatermarkExclude,
    sessionWatermarks,
} from '../../src/analytics/watermark';

const ALL: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    sessionId: null,
    runId: null,
    taskWbs: null,
};

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    return adapter;
}

interface Msg {
    record_hash: string;
    session_id: string;
    seq: number;
    role?: string;
    record_type?: string;
    disposition?: string;
    ts: string;
    input?: number | null;
    output?: number | null;
}

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
             provenance, run_id, task_wbs, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.record_hash,
        'claude',
        'test.jsonl',
        1,
        m.session_id,
        m.seq,
        m.role ?? 'assistant',
        m.record_type ?? 'message',
        m.disposition ?? 'conversation',
        m.ts,
        null,
        m.input ?? null,
        m.output ?? null,
        null,
        'agent',
        null,
        null,
        null,
        '2026-06-01T00:00:00Z',
    );
}

async function insertToolCall(
    db: DbAdapter,
    t: { record_hash: string; message_hash: string; session_id: string; seq: number },
): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_digest, status, duration_ms, result_bytes, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.record_hash,
        t.message_hash,
        'claude',
        'test.jsonl',
        1,
        t.session_id,
        t.seq,
        'Read',
        null,
        'success',
        null,
        null,
        '2026-06-01T00:00:00Z',
    );
}

/** One complete turn: user prompt + assistant final response with no tool call. */
async function insertCompleteTurn(db: DbAdapter, session: string, baseSeq: number, ts: string): Promise<void> {
    await insertMessage(db, {
        record_hash: `${session}-u${baseSeq}`,
        session_id: session,
        seq: baseSeq,
        role: 'user',
        ts,
    });
    await insertMessage(db, {
        record_hash: `${session}-a${baseSeq}`,
        session_id: session,
        seq: baseSeq + 1,
        role: 'assistant',
        ts,
    });
}

describe('sessionWatermarks (task 0550 R1/R2)', () => {
    test('a session ending on an assistant message with no tool call is complete', async () => {
        const db = await setup();
        await insertCompleteTurn(db, 'sess-a', 1, '2026-08-01T00:00:00Z');
        const rows = await sessionWatermarks(db, ALL);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ sessionId: 'sess-a', source: 'claude', state: 'complete', watermarkSeq: 2 });
        db.close();
    });

    test('a session ending on a user message (no assistant response yet) is in-progress and truncates after the last turn closer', async () => {
        const db = await setup();
        // Turn 1 complete (seq 1-2), then a partial turn 2: just the user message (seq 3).
        await insertCompleteTurn(db, 'sess-b', 1, '2026-08-01T00:00:00Z');
        await insertMessage(db, {
            record_hash: 'sess-b-u3',
            session_id: 'sess-b',
            seq: 3,
            role: 'user',
            ts: '2026-08-01T00:10:00Z',
        });
        const rows = await sessionWatermarks(db, ALL);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ sessionId: 'sess-b', state: 'in-progress', watermarkSeq: 2 });
        db.close();
    });

    test('a session ending on an assistant message with an open tool call is in-progress', async () => {
        const db = await setup();
        await insertCompleteTurn(db, 'sess-c', 1, '2026-08-01T00:00:00Z');
        // Partial turn 2: user message + assistant tool_use (has a tool call row), no result.
        await insertMessage(db, {
            record_hash: 'sess-c-u3',
            session_id: 'sess-c',
            seq: 3,
            role: 'user',
            ts: '2026-08-01T00:10:00Z',
        });
        await insertMessage(db, {
            record_hash: 'sess-c-a4',
            session_id: 'sess-c',
            seq: 4,
            role: 'assistant',
            ts: '2026-08-01T00:11:00Z',
        });
        await insertToolCall(db, { record_hash: 'sess-c-tc', message_hash: 'sess-c-a4', session_id: 'sess-c', seq: 4 });
        const rows = await sessionWatermarks(db, ALL);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ sessionId: 'sess-c', state: 'in-progress', watermarkSeq: 2 });
        db.close();
    });

    test('a session with no assistant message at all (only a user prompt) is in-progress with watermark = max seq (fail-open, 0576)', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'sess-d-u1',
            session_id: 'sess-d',
            seq: 1,
            role: 'user',
            ts: '2026-08-01T00:00:00Z',
        });
        const rows = await sessionWatermarks(db, ALL);
        expect(rows).toHaveLength(1);
        // No turn closer → no evidence of a trailing partial turn → exclude nothing:
        // state stays in-progress, watermark is the session's max seq, never -1.
        expect(rows[0]).toMatchObject({ sessionId: 'sess-d', state: 'in-progress', watermarkSeq: 1 });
        const wm = buildWatermarkFilter(rows);
        const dropWm = await materializeWatermarkExclude(db, rows);
        const rollup = await messageRollup(db, ALL, { watermark: wm });
        expect(rollup.reduce((n, r) => n + r.messages, 0)).toBe(1);
        await dropWm();
        db.close();
    });

    test("a session ending on a role='unknown' message with no tool call is complete and counted (0550 review-fix regression)", async () => {
        const db = await setup();
        // A complete turn, then a final role-less/'unknown'-role message (the claude mapper
        // writes 'unknown' for role-less messages; imported rows commonly lack a role).
        await insertCompleteTurn(db, 'sess-f', 1, '2026-08-01T00:00:00Z');
        await insertMessage(db, {
            record_hash: 'sess-f-u3',
            session_id: 'sess-f',
            seq: 3,
            role: 'unknown',
            ts: '2026-08-01T00:10:00Z',
            input: 42,
        });
        const rows = await sessionWatermarks(db, ALL);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ sessionId: 'sess-f', state: 'complete', watermarkSeq: 3 });
        // The role-less message is analyzed, not zeroed: the rollup counts it.
        const wm = buildWatermarkFilter(rows);
        const wmRows = await messageRollup(db, ALL, { watermark: wm });
        expect(wmRows.reduce((n, r) => n + r.messages, 0)).toBe(3);
        expect(wmRows.reduce((n, r) => n + (r.inputTokens ?? 0), 0)).toBe(42);
        db.close();
    });

    test('trailing meta records after the final assistant response do not make a complete session in-progress', async () => {
        const db = await setup();
        await insertCompleteTurn(db, 'sess-e', 1, '2026-08-01T00:00:00Z');
        // A trailing summary/turn_duration meta record (seq 3) after the final response.
        await insertMessage(db, {
            record_hash: 'sess-e-m3',
            session_id: 'sess-e',
            seq: 3,
            role: 'system',
            record_type: 'turn_duration',
            disposition: 'meta',
            ts: '2026-08-01T00:12:00Z',
        });
        const rows = await sessionWatermarks(db, ALL);
        expect(rows).toHaveLength(1);
        // Complete: the meta record is skipped for meaningfulness, and the watermark keeps
        // the session's full max seq (no data excluded — trailing meta still counted).
        expect(rows[0]).toMatchObject({ sessionId: 'sess-e', state: 'complete', watermarkSeq: 3 });
        db.close();
    });
});

describe('buildWatermarkFilter (task 0550 R1)', () => {
    test('no in-progress sessions → empty filter (no data excluded)', () => {
        const filter = buildWatermarkFilter([{ sessionId: 'a', source: 'claude', state: 'complete', watermarkSeq: 5 }]);
        expect(filter.sql).toBe('');
        expect(filter.params).toEqual([]);
    });

    test('in-progress sessions produce a constant-depth NOT EXISTS anti-join with no params', () => {
        const filter = buildWatermarkFilter([
            { sessionId: 's1', source: 'claude', state: 'in-progress', watermarkSeq: 4 },
            { sessionId: 's2', source: 'pi', state: 'in-progress', watermarkSeq: 9 },
        ]);
        // References the temp table materialized by materializeWatermarkExclude.
        // Expression depth stays constant regardless of in-progress count — a per-session
        // OR chain grows SQLite expression depth ~1/session and blows
        // SQLITE_MAX_EXPRESSION_DEPTH (1000) past ~1000 sessions (pi has 176k).
        expect(filter.sql).toBe(
            'NOT EXISTS (\n            SELECT 1 FROM spur_wm_exclude w\n            WHERE w.session_id = m.session_id AND w.source = m.source\n              AND m.seq > w.watermark_seq\n        )',
        );
        expect(filter.params).toEqual([]);
    });
});

describe('applyWatermarkToWhere (task 0550 R1)', () => {
    test('undefined filter returns the clause unchanged with no params', () => {
        const out = applyWatermarkToWhere('WHERE m.ts >= ?', undefined);
        expect(out).toEqual({ where: 'WHERE m.ts >= ?', params: [] });
    });

    test('empty filter returns the clause unchanged', () => {
        const out = applyWatermarkToWhere('WHERE m.ts >= ?', { sql: '', params: [] });
        expect(out).toEqual({ where: 'WHERE m.ts >= ?', params: [] });
    });

    test('a real filter is AND-joined to an existing WHERE and to a bare WHERE', () => {
        const wm = { sql: 'NOT (m.seq > ?)', params: [4] };
        expect(applyWatermarkToWhere('WHERE m.ts >= ?', wm)).toEqual({
            where: 'WHERE m.ts >= ? AND NOT (m.seq > ?)',
            params: [4],
        });
        expect(applyWatermarkToWhere('', wm)).toEqual({ where: 'WHERE NOT (m.seq > ?)', params: [4] });
    });
});

describe('watermark filter effect on queries (task 0550 R1)', () => {
    test('a growing in-progress session contributes only its completed portion to totals (never a partial turn)', async () => {
        const db = await setup();
        // Turn 1 complete: user (10 tokens) + assistant (20 tokens) = 30 tokens.
        await insertMessage(db, {
            record_hash: 'g1',
            session_id: 'sess-g',
            seq: 1,
            role: 'user',
            ts: '2026-08-01T00:00:00Z',
            input: 10,
        });
        await insertMessage(db, {
            record_hash: 'g2',
            session_id: 'sess-g',
            seq: 2,
            role: 'assistant',
            ts: '2026-08-01T00:01:00Z',
            input: 20,
        });
        // Partial turn 2: only a user message (50 tokens) — no assistant response yet.
        await insertMessage(db, {
            record_hash: 'g3',
            session_id: 'sess-g',
            seq: 3,
            role: 'user',
            ts: '2026-08-01T00:02:00Z',
            input: 50,
        });

        const watermarks = await sessionWatermarks(db, ALL);
        expect(watermarks[0]).toMatchObject({ sessionId: 'sess-g', state: 'in-progress', watermarkSeq: 2 });
        const wm = buildWatermarkFilter(watermarks);
        const dropWm = await materializeWatermarkExclude(db, watermarks);
        const opts = { watermark: wm };

        // Without the filter the partial turn is counted (3 messages, 80 tokens).
        const raw = await messageRollup(db, ALL);
        expect(raw.reduce((n, r) => n + r.messages, 0)).toBe(3);
        expect(raw.reduce((n, r) => n + (r.inputTokens ?? 0), 0)).toBe(80);
        // With the watermark only the completed portion is counted (2 messages, 30 tokens).
        const wmRows = await messageRollup(db, ALL, opts);
        expect(wmRows.reduce((n, r) => n + r.messages, 0)).toBe(2);
        expect(wmRows.reduce((n, r) => n + (r.inputTokens ?? 0), 0)).toBe(30);
        await dropWm();
        db.close();
    });

    test('a complete session is untouched by the watermark filter', async () => {
        const db = await setup();
        await insertCompleteTurn(db, 'sess-h', 1, '2026-08-01T00:00:00Z');
        const watermarks = await sessionWatermarks(db, ALL);
        const wm = buildWatermarkFilter(watermarks);
        const dropWm = await materializeWatermarkExclude(db, watermarks);
        const rows = await messageRollup(db, ALL, { watermark: wm });
        expect(rows.reduce((n, r) => n + r.messages, 0)).toBe(2);
        await dropWm();
        db.close();
    });

    test('derived inputs (sessionSpans) exclude the trailing partial turn', async () => {
        const db = await setup();
        await insertCompleteTurn(db, 'sess-i', 1, '2026-08-01T00:00:00Z');
        // Partial turn 2: user message at 00:10 — if included, the span would extend there.
        await insertMessage(db, {
            record_hash: 'sess-i-u3',
            session_id: 'sess-i',
            seq: 3,
            role: 'user',
            ts: '2026-08-01T00:10:00Z',
        });
        const watermarks = await sessionWatermarks(db, ALL);
        const wm = buildWatermarkFilter(watermarks);
        const dropWm = await materializeWatermarkExclude(db, watermarks);
        const spans = await sessionSpans(db, ALL, { watermark: wm });
        expect(spans[0]?.lastTs).toBe('2026-08-01T00:00:00Z');
        await dropWm();
        db.close();
    });

    // Regression (dogfood 2026-08-17): a per-session OR chain grows SQLite expression
    // depth ~1 per in-progress session and blows SQLITE_MAX_EXPRESSION_DEPTH (1000)
    // past ~1000 sessions. The anti-join keeps depth constant, so >1000 in-progress
    // sessions must prepare and run without 'Expression tree is too large (maximum
    // depth 1000)' — the crash that broke `spur history analyze --source pi` (pi has
    // 176k in-progress sessions).
    test('more than 1000 in-progress sessions prepare and run via the anti-join (depth regression)', async () => {
        const db = await setup();
        // One complete session the watermark must keep.
        await insertCompleteTurn(db, 'sess-keep', 1, '2026-08-01T00:00:00Z');
        // 1200 in-progress sessions (a single user message each → no turn closer →
        // fail-open watermark = max seq, nothing excluded).
        for (let i = 0; i < 1200; i++) {
            await insertMessage(db, {
                record_hash: `sess-big-${i}-u1`,
                session_id: `sess-big-${i}`,
                seq: 1,
                role: 'user',
                ts: '2026-08-01T00:00:00Z',
            });
        }
        const watermarks = await sessionWatermarks(db, ALL);
        const inProgress = watermarks.filter((w) => w.state === 'in-progress');
        expect(inProgress.length).toBe(1200);
        const wm = buildWatermarkFilter(watermarks);
        const dropWm = await materializeWatermarkExclude(db, watermarks);
        // Must not throw 'Expression tree is too large (maximum depth 1000)'.
        const rows = await messageRollup(db, ALL, { watermark: wm });
        // Fail-open (0576): the 1200 no-closer sessions contribute their messages
        // (watermark = max seq, nothing excluded); the complete session adds its 2.
        expect(rows.reduce((n, r) => n + r.messages, 0)).toBe(1202);
        await dropWm();
        db.close();
    });

    // Task 0576 R3: the pi shape — a source with zero history_tool_call rows whose
    // sessions end on a non-assistant role (pi's last rows are record types like
    // 'toolresult'/'message', never assistant closers). Before 0576 every such
    // session got watermark -1 and vanished from analytics entirely.
    test('a tool-call-less source whose sessions end on a non-assistant role survives the watermark (pi shape)', async () => {
        const db = await setup();
        // Two pi-like sessions: user prompt, then a toolresult-role record as the last
        // message. Zero history_tool_call rows — the degrade rule cannot see closers.
        for (const session of ['pi-s1', 'pi-s2']) {
            await insertMessage(db, {
                record_hash: `${session}-u1`,
                session_id: session,
                seq: 0,
                role: 'user',
                ts: '2026-08-01T00:00:00Z',
                input: 10,
            });
            await insertMessage(db, {
                record_hash: `${session}-tr2`,
                session_id: session,
                seq: 1,
                role: 'toolresult',
                record_type: 'toolresult',
                ts: '2026-08-01T00:01:00Z',
                input: 5,
            });
        }
        const watermarks = await sessionWatermarks(db, ALL);
        expect(watermarks).toHaveLength(2);
        for (const w of watermarks) {
            // No turn closer → fail-open: in-progress with watermark = max seq (1).
            expect(w.state).toBe('in-progress');
            expect(w.watermarkSeq).toBe(1);
        }
        const wm = buildWatermarkFilter(watermarks);
        const dropWm = await materializeWatermarkExclude(db, watermarks);
        const rollup = await messageRollup(db, ALL, { watermark: wm });
        // All 4 messages survive the anti-join — the source does not vanish.
        expect(rollup.reduce((n, r) => n + r.messages, 0)).toBe(4);
        await dropWm();
        db.close();
    });
});

describe('dataWindow (task 0550 R4)', () => {
    test('returns the MIN/MAX message ts in scope', async () => {
        const db = await setup();
        await insertCompleteTurn(db, 'sess-w', 1, '2026-08-01T00:00:00Z');
        await insertMessage(db, {
            record_hash: 'sess-w-u3',
            session_id: 'sess-w',
            seq: 3,
            role: 'user',
            ts: '2026-08-03T05:00:00Z',
        });
        const window = await dataWindow(db, ALL);
        expect(window.since).toBe('2026-08-01T00:00:00Z');
        expect(window.until).toBe('2026-08-03T05:00:00Z');
        db.close();
    });

    test('nulls when no data', async () => {
        const db = await setup();
        const window = await dataWindow(db, ALL);
        expect(window).toEqual({ since: null, until: null });
        db.close();
    });
});
