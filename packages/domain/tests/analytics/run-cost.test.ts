import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    type ActionRunCostRow,
    actionCost,
    actionCostEstimated,
    attributeActionCost,
    foldTotals,
} from '../../src/analytics/run-cost';
import type { CostRecord } from '../../src/analytics/types';
import { applyCliMigrations, RunSessionDao, type RunSessionExactness } from '../../src/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<ActionRunCostRow> = {}): ActionRunCostRow {
    return {
        id: 'a1',
        kind: 'agent.run',
        started_at: '2026-01-15T10:00:00.000Z',
        completed_at: '2026-01-15T10:05:00.000Z',
        ...overrides,
    };
}

/** A migrated in-memory DB with the history plane + run→session mapping tables. */
async function setupDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

async function insertMessage(
    db: DbAdapter,
    m: {
        record_hash: string;
        source?: string;
        session_id: string;
        seq: number;
        ts: string;
        input?: number | null;
        output?: number | null;
        cache_read?: number | null;
        cache_write?: number | null;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens, provenance, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.record_hash,
        m.source ?? 'pi',
        'test.jsonl',
        1,
        m.session_id,
        m.seq,
        'assistant',
        'message',
        'conversation',
        m.ts,
        'pi-1',
        m.input ?? null,
        m.output ?? null,
        m.cache_read ?? null,
        m.cache_write ?? null,
        'ambient',
        '2026-01-15T10:10:00.000Z',
    );
}

async function insertMapping(
    db: DbAdapter,
    input: {
        runId: string;
        source: string;
        sessionId: string;
        exactness: RunSessionExactness;
        mechanism?: 'observed' | 'supplied' | 'inferred';
    },
): Promise<void> {
    await new RunSessionDao(db).insert({
        runId: input.runId,
        source: input.source,
        sessionId: input.sessionId,
        exactness: input.exactness,
        mechanism: input.mechanism ?? (input.exactness === 'estimated' ? 'inferred' : 'observed'),
        resolvedAt: '2026-01-15T10:06:00.000Z',
    });
}

async function insertToolCall(
    db: DbAdapter,
    input: {
        record_hash: string;
        message_hash: string;
        session_id: string;
        seq: number;
        tool_name?: string;
        duration_ms?: number | null;
    },
): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, status, started_at, completed_at, duration_ms,
             result_bytes, error_text, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        input.record_hash,
        input.message_hash,
        'pi',
        'test.jsonl',
        1,
        input.session_id,
        input.seq,
        input.tool_name ?? 'Bash',
        'ok',
        null,
        null,
        input.duration_ms ?? null,
        null,
        null,
        '2026-01-15T10:10:00.000Z',
    );
}

// ---------------------------------------------------------------------------
// actionCost / actionCostEstimated (R2/R3)
// ---------------------------------------------------------------------------

describe('actionCost / actionCostEstimated', () => {
    test('actionCost builds an exact cost with cache-hit from folded totals', () => {
        const result = actionCost({
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 200,
            cacheWriteTokens: 0,
            costUsd: 0,
            records: 1,
            recordsWithUsage: 1,
            messages: 1,
            toolCalls: 0,
            durationMs: 0,
            durationUnmeasured: 0,
        });
        expect(result.estimated).toBe(false);
        expect(result.totals.inputTokens).toBe(1000);
        expect(result.cacheHit).toBe(0.2); // 200 / 1000
    });

    test('actionCostEstimated marks the cost as estimated', () => {
        const result = actionCostEstimated({
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            records: 1,
            recordsWithUsage: 1,
            messages: 1,
            toolCalls: 0,
            durationMs: 0,
            durationUnmeasured: 0,
        });
        expect(result.estimated).toBe(true);
    });

    test('cacheHit is null when no usage reported (0281/0284 never-fabricate)', () => {
        const result = actionCost({
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            records: 1,
            recordsWithUsage: 0,
            messages: 1,
            toolCalls: 0,
            durationMs: 0,
            durationUnmeasured: 0,
        });
        expect(result.cacheHit).toBeNull();
    });

    test('costUsd stays 0 — no pricing is applied (R3)', () => {
        const result = actionCost({
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUsd: 0,
            records: 1,
            recordsWithUsage: 1,
            messages: 1,
            toolCalls: 0,
            durationMs: 0,
            durationUnmeasured: 0,
        });
        expect(result.totals.costUsd).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// attributeActionCost — R1: typed columns via the run→session mapping
// ---------------------------------------------------------------------------

describe('attributeActionCost', () => {
    test('returns null attribution when the run has no mapping', async () => {
        const db = await setupDb();
        const result = await attributeActionCost(db, 'run-none', makeAction());
        expect(result.exact).toBeNull();
        expect(result.estimated).toBeNull();
    });

    test('attributes non-zero token figures from typed columns via an exact mapping (R1)', async () => {
        const db = await setupDb();
        await insertMapping(db, { runId: 'run-1', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-01-15T10:02:00.000Z',
            input: 1000,
            output: 500,
            cache_read: 200,
            cache_write: 50,
        });

        const result = await attributeActionCost(db, 'run-1', makeAction());
        expect(result.estimated).toBeNull();
        const exact = result.exact;
        expect(exact).not.toBeNull();
        expect(exact?.estimated).toBe(false);
        // Billed input total: fresh + cache read + cache write (typed columns exclude cache)
        expect(exact?.totals.inputTokens).toBe(1250);
        expect(exact?.totals.outputTokens).toBe(500);
        expect(exact?.totals.cacheReadTokens).toBe(200);
        expect(exact?.totals.cacheWriteTokens).toBe(50);
        expect(exact?.totals.records).toBe(1);
        expect(exact?.totals.recordsWithUsage).toBe(1);
        // cache-hit = cacheRead / billed input
        expect(exact?.cacheHit).toBeCloseTo(200 / 1250, 6);
        // R3: no dollar figure anywhere
        expect(exact?.totals.costUsd).toBe(0);
    });

    test('reports exact and estimated mappings separately, never summed (R2)', async () => {
        const db = await setupDb();
        await insertMapping(db, { runId: 'run-2', source: 'pi', sessionId: 'sess-exact', exactness: 'exact' });
        await insertMapping(db, {
            runId: 'run-2',
            source: 'pi',
            sessionId: 'sess-est',
            exactness: 'estimated',
            mechanism: 'inferred',
        });
        await insertMessage(db, {
            record_hash: 'e1',
            session_id: 'sess-exact',
            seq: 1,
            ts: '2026-01-15T10:02:00.000Z',
            input: 1000,
            output: 100,
        });
        await insertMessage(db, {
            record_hash: 's1',
            session_id: 'sess-est',
            seq: 1,
            ts: '2026-01-15T10:02:00.000Z',
            input: 300,
            output: 30,
        });

        const result = await attributeActionCost(db, 'run-2', makeAction());
        expect(result.exact?.totals.inputTokens).toBe(1000);
        expect(result.exact?.estimated).toBe(false);
        expect(result.estimated?.totals.inputTokens).toBe(300);
        expect(result.estimated?.estimated).toBe(true);
        // The two classes are separate buckets — no figure mixes them.
        expect(result.exact?.totals.records).toBe(1);
        expect(result.estimated?.totals.records).toBe(1);
    });

    test('narrows figures to the action time window when bounds exist', async () => {
        const db = await setupDb();
        await insertMapping(db, { runId: 'run-3', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'in',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-01-15T10:02:00.000Z',
            input: 100,
            output: 10,
        });
        await insertMessage(db, {
            record_hash: 'out',
            session_id: 'sess-1',
            seq: 2,
            ts: '2026-01-15T11:00:00.000Z', // after the action completed
            input: 900,
            output: 90,
        });

        const result = await attributeActionCost(db, 'run-3', makeAction());
        expect(result.exact?.totals.records).toBe(1);
        expect(result.exact?.totals.inputTokens).toBe(100);
    });

    test('an unresolved mapping (NULL session_id) contributes nothing', async () => {
        const db = await setupDb();
        await new RunSessionDao(db).insert({
            runId: 'run-4',
            source: 'pi',
            sessionId: null,
            exactness: 'unresolved',
            mechanism: 'observed',
            resolvedAt: '2026-01-15T10:06:00.000Z',
        });

        const result = await attributeActionCost(db, 'run-4', makeAction());
        expect(result.exact).toBeNull();
        expect(result.estimated).toBeNull();
    });

    test('matched rows without token data yield zero figures and a null cache-hit', async () => {
        const db = await setupDb();
        await insertMapping(db, { runId: 'run-5', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'no-usage',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-01-15T10:02:00.000Z',
        });

        const result = await attributeActionCost(db, 'run-5', makeAction());
        expect(result.exact?.totals.records).toBe(1);
        expect(result.exact?.totals.recordsWithUsage).toBe(0);
        expect(result.exact?.totals.inputTokens).toBe(0);
        expect(result.exact?.cacheHit).toBeNull();
    });

    test('missing history_run_session table reads as empty (unmigrated DB)', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const result = await attributeActionCost(db, 'run-x', makeAction());
        expect(result.exact).toBeNull();
        expect(result.estimated).toBeNull();
    });

    test('missing history_tool_call table degrades the tool fold to zeros, never throws (0564 P4-1)', async () => {
        const db = await setupDb();
        await db.run('DROP TABLE history_tool_call');
        await insertMapping(db, { runId: 'run-5b', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-01-15T10:02:00.000Z',
            input: 100,
            output: 50,
        });

        const result = await attributeActionCost(db, 'run-5b', makeAction());
        // Token fold still works; only the tool fold degraded.
        expect(result.exact?.totals.inputTokens).toBe(100);
        expect(result.exact?.totals.toolCalls).toBe(0);
        expect(result.exact?.totals.durationMs).toBe(0);
        expect(result.exact?.totals.durationUnmeasured).toBe(0);
    });

    test('folds tool-call counts and durations into the bucket (0564 R2)', async () => {
        const db = await setupDb();
        await insertMapping(db, { runId: 'run-6', source: 'pi', sessionId: 'sess-1', exactness: 'exact' });
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            ts: '2026-01-15T10:02:00.000Z',
            input: 100,
            output: 50,
        });
        await insertToolCall(db, {
            record_hash: 'tc1',
            message_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            tool_name: 'Bash',
            duration_ms: 500,
        });
        await insertToolCall(db, {
            record_hash: 'tc2',
            message_hash: 'm1',
            session_id: 'sess-1',
            seq: 1,
            tool_name: 'Bash',
            duration_ms: null, // unmeasured — counts toward durationUnmeasured
        });

        const result = await attributeActionCost(db, 'run-6', makeAction());
        expect(result.estimated).toBeNull();
        const exact = result.exact;
        expect(exact).not.toBeNull();
        // toolCalls = COUNT of history_tool_call rows; durationMs = SUM(duration_ms);
        // durationUnmeasured = COUNT of NULL duration_ms rows.
        expect(exact?.totals.toolCalls).toBe(2);
        expect(exact?.totals.durationMs).toBe(500);
        expect(exact?.totals.durationUnmeasured).toBe(1);
        // Token fold still works alongside the tool fold.
        expect(exact?.totals.inputTokens).toBe(100);
        expect(exact?.totals.messages).toBe(1);
    });

    test('tool-duration fold sums across every mapped session of the class (0564 R2)', async () => {
        const db = await setupDb();
        await insertMapping(db, { runId: 'run-7', source: 'pi', sessionId: 'sess-a', exactness: 'exact' });
        await insertMapping(db, { runId: 'run-7', source: 'pi', sessionId: 'sess-b', exactness: 'exact' });
        for (const [hash, session, dur] of [
            ['a1', 'sess-a', 100],
            ['a2', 'sess-a', 200],
            ['b1', 'sess-b', 300],
            ['b2', 'sess-b', null],
        ] as const) {
            await insertMessage(db, {
                record_hash: `m-${hash}`,
                session_id: session,
                seq: 1,
                ts: '2026-01-15T10:02:00.000Z',
            });
            await insertToolCall(db, {
                record_hash: hash,
                message_hash: `m-${hash}`,
                session_id: session,
                seq: 1,
                duration_ms: dur,
            });
        }

        const result = await attributeActionCost(db, 'run-7', makeAction());
        expect(result.exact?.totals.toolCalls).toBe(4);
        expect(result.exact?.totals.durationMs).toBe(600);
        expect(result.exact?.totals.durationUnmeasured).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// foldTotals (kept for 0547 — folds CostRecords)
// ---------------------------------------------------------------------------

describe('foldTotals', () => {
    function rec(partial: Partial<CostRecord> = {}): CostRecord {
        return {
            source: 'pi',
            date: '2026-01-15',
            model: 'pi-1',
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            usageReported: true,
            costUsd: 0,
            ...partial,
        };
    }

    test('aggregates token and cache dimensions across records', () => {
        const totals = foldTotals([
            rec({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 }),
            rec({ inputTokens: 200, outputTokens: 100 }),
        ]);
        expect(totals.inputTokens).toBe(300);
        expect(totals.outputTokens).toBe(150);
        expect(totals.cacheReadTokens).toBe(10);
        expect(totals.cacheWriteTokens).toBe(5);
        expect(totals.records).toBe(2);
        expect(totals.recordsWithUsage).toBe(2);
    });

    test('records with usageReported false do not inflate recordsWithUsage', () => {
        const totals = foldTotals([
            rec({ inputTokens: 100, usageReported: true }),
            rec({ inputTokens: 100, usageReported: false }),
        ]);
        expect(totals.recordsWithUsage).toBe(1);
    });
});
