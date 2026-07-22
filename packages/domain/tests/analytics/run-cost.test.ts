import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    type ActionRunCostRow,
    actionCost,
    actionCostEstimated,
    extractSessionId,
    matchEtlForAction,
} from '../../src/analytics/run-cost';
import type { EtlPayload } from '../../src/analytics/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<ActionRunCostRow> = {}): ActionRunCostRow {
    return {
        id: 'a1',
        kind: 'agent.run',
        started_at: '2026-01-15T10:00:00.000Z',
        completed_at: '2026-01-15T10:05:00.000Z',
        result_json: null,
        ...overrides,
    };
}

function makePayload(overrides: Partial<EtlPayload> = {}): EtlPayload {
    return {
        source_record_id: 'rec-1',
        created_at: '2026-01-15T10:02:00.000Z',
        content: 'hello world',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 100, output_tokens: 50 },
        ...overrides,
    };
}

async function setupEtlDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    const stmt =
        'CREATE TABLE IF NOT EXISTS ETL_TABLE (id INTEGER PRIMARY KEY AUTOINCREMENT, payload_json TEXT NOT NULL, imported_at TEXT NOT NULL)';
    const tables = [
        'history_etl_pi',
        'history_etl_claude',
        'history_etl_codex',
        'history_etl_gemini',
        'history_etl_opencode',
        'history_etl_antigravity',
        'history_etl_openclaw',
    ];
    for (const table of tables) {
        await adapter.exec(stmt.replace('ETL_TABLE', table));
    }
    return adapter;
}
async function insertPayload(db: DbAdapter, table: string, payload: EtlPayload): Promise<void> {
    await db.run(
        `INSERT INTO ${table} (payload_json, imported_at) VALUES (?, ?)`,
        JSON.stringify(payload),
        '2026-01-15T10:10:00.000Z',
    );
}

// ---------------------------------------------------------------------------
// extractSessionId
// ---------------------------------------------------------------------------

describe('extractSessionId', () => {
    test('returns sessionId from result_json invocation', () => {
        const action = makeAction({
            result_json: JSON.stringify({ invocation: { sessionId: 'sess-abc', agent: 'omp' } }),
        });
        expect(extractSessionId(action)).toBe('sess-abc');
    });

    test('returns undefined when no sessionId in invocation', () => {
        const action = makeAction({
            result_json: JSON.stringify({ invocation: { agent: 'omp' } }),
        });
        expect(extractSessionId(action)).toBeUndefined();
    });

    test('returns undefined for null result_json', () => {
        const action = makeAction({ result_json: null });
        expect(extractSessionId(action)).toBeUndefined();
    });

    test('returns undefined for malformed JSON', () => {
        const action = makeAction({ result_json: '{bad' });
        expect(extractSessionId(action)).toBeUndefined();
    });

    test('returns undefined when sessionId is not a string', () => {
        const action = makeAction({
            result_json: JSON.stringify({ invocation: { sessionId: 123 } }),
        });
        expect(extractSessionId(action)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// actionCost
// ---------------------------------------------------------------------------

describe('actionCost', () => {
    test('returns unavailable shape for empty records', () => {
        const result = actionCost([], 'claude');
        expect(result.totals.records).toBe(0);
        expect(result.totals.costUsd).toBe(0);
        expect(result.cacheHit).toBeNull();
        expect(result.estimated).toBe(false);
    });

    test('computes cost and cache-hit from records with usage', () => {
        const payload = makePayload({
            usage: {
                input_tokens: 1000,
                output_tokens: 500,
                cache_read_input_tokens: 200,
                cache_creation_input_tokens: 0,
            },
        });
        const result = actionCost([payload], 'claude');
        expect(result.totals.records).toBe(1);
        expect(result.totals.inputTokens).toBeGreaterThan(0);
        expect(result.totals.outputTokens).toBeGreaterThan(0);
        expect(result.totals.cacheReadTokens).toBe(200);
        expect(result.cacheHit).not.toBeNull();
        expect(result.estimated).toBe(false);
    });

    test('cacheHit is null when usage is absent (never-fabricate invariant)', () => {
        const payload = makePayload({ usage: undefined });
        const result = actionCost([payload], 'claude');
        // No usage reported → cache dimensions are unknown, not zero
        expect(result.totals.recordsWithUsage).toBe(0);
        expect(result.cacheHit).toBeNull();
    });

    test('aggregates multiple records', () => {
        const p1 = makePayload({
            source_record_id: 'r1',
            usage: { input_tokens: 100, output_tokens: 50 },
        });
        const p2 = makePayload({
            source_record_id: 'r2',
            usage: { input_tokens: 200, output_tokens: 100 },
        });
        const result = actionCost([p1, p2], 'claude');
        expect(result.totals.records).toBe(2);
        expect(result.totals.inputTokens).toBe(300);
        expect(result.totals.outputTokens).toBe(150);
    });
});

// ---------------------------------------------------------------------------
// actionCostEstimated
// ---------------------------------------------------------------------------

describe('actionCostEstimated', () => {
    test('marks cost as estimated', () => {
        const payload = makePayload({
            usage: { input_tokens: 100, output_tokens: 50 },
        });
        const result = actionCostEstimated([payload], 'claude');
        expect(result.estimated).toBe(true);
    });

    test('keeps estimated=false for empty records', () => {
        const result = actionCostEstimated([], 'claude');
        expect(result.estimated).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// matchEtlForAction — R1b time-window heuristic
// ---------------------------------------------------------------------------

describe('matchEtlForAction', () => {
    test('matches records within time window (R1b)', async () => {
        const db = await setupEtlDb();
        const payload = makePayload({ created_at: '2026-01-15T10:02:00.000Z', agent: 'claude' });
        await insertPayload(db, 'history_etl_claude', payload);

        const action = makeAction({
            kind: 'agent.run',
            started_at: '2026-01-15T10:00:00.000Z',
            completed_at: '2026-01-15T10:05:00.000Z',
            result_json: JSON.stringify({ invocation: { agent: 'claude', model: 'claude-sonnet-4-20250514' } }),
        });

        const matched = await matchEtlForAction(db, action);
        expect(matched.length).toBe(1);
        expect(matched[0]?.source_record_id).toBe('rec-1');
    });

    test('excludes records outside time window', async () => {
        const db = await setupEtlDb();
        const payload = makePayload({ created_at: '2026-01-15T11:00:00.000Z' }); // after action
        await insertPayload(db, 'history_etl_claude', payload);

        const action = makeAction({
            started_at: '2026-01-15T10:00:00.000Z',
            completed_at: '2026-01-15T10:05:00.000Z',
        });

        const matched = await matchEtlForAction(db, action);
        expect(matched.length).toBe(0);
    });

    test('returns empty when no ETL tables exist', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const action = makeAction();
        const matched = await matchEtlForAction(db, action);
        expect(matched.length).toBe(0);
    });

    test('prefers session-id join (R1a) when sessionId is available', async () => {
        const db = await setupEtlDb();
        const payload = makePayload({ sessionId: 'sess-xyz' } as Partial<EtlPayload> & { sessionId: string });
        await insertPayload(db, 'history_etl_claude', payload as EtlPayload);

        const action = makeAction({
            started_at: '2025-01-01T00:00:00.000Z', // outside window — should NOT match via R1b
            completed_at: '2025-01-01T00:01:00.000Z',
            result_json: JSON.stringify({ invocation: { sessionId: 'sess-xyz', agent: 'claude' } }),
        });

        // R1a should find it via session id even though time window doesn't match
        const matched = await matchEtlForAction(db, action);
        expect(matched.length).toBe(1);
    });
});
