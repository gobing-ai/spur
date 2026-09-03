import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import { bySession, bySessionPage, SESSION_SORT_COLUMNS } from '../../src/analytics/forensic-query';
import { historyBoardSessionsFromRollup, SESSION_ORDER_COLUMNS } from '../../src/analytics/history-board-rollup';
import { applyCliMigrations } from '../../src/migrations';
import { recordStatements } from './statement-recorder';

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
    await applyCliMigrations(adapter);
    return adapter;
}

interface SeedSessionSpec {
    id: string;
    start: string;
    messages: number;
    /** duration_ms per message — assistant-duration total = messages * perMsg. */
    perMsgDuration: number;
    /** input_tokens per message. */
    perMsgInput: number;
    /** output_tokens per message. */
    perMsgOutput: number;
    /** cache_read_tokens per message. */
    perMsgCache: number;
}

const SESSIONS: SeedSessionSpec[] = [
    {
        id: 's1',
        start: '2026-01-01T00:00:00Z',
        messages: 1,
        perMsgDuration: 1000,
        perMsgInput: 10,
        perMsgOutput: 10,
        perMsgCache: 50,
    },
    {
        id: 's2',
        start: '2026-01-02T00:00:00Z',
        messages: 2,
        perMsgDuration: 1000,
        perMsgInput: 10,
        perMsgOutput: 10,
        perMsgCache: 50,
    },
    {
        id: 's3',
        start: '2026-01-03T00:00:00Z',
        messages: 3,
        perMsgDuration: 1000,
        perMsgInput: 10,
        perMsgOutput: 10,
        perMsgCache: 50,
    },
    {
        id: 's4',
        start: '2026-01-04T00:00:00Z',
        messages: 4,
        perMsgDuration: 1000,
        perMsgInput: 10,
        perMsgOutput: 10,
        perMsgCache: 50,
    },
    {
        id: 's5',
        start: '2026-01-05T00:00:00Z',
        messages: 5,
        perMsgDuration: 1000,
        perMsgInput: 10,
        perMsgOutput: 10,
        perMsgCache: 50,
    },
];

async function seedSessions(db: DbAdapter): Promise<void> {
    for (const spec of SESSIONS) {
        for (let i = 1; i <= spec.messages; i++) {
            const recordHash = `${spec.id}-m${i}`;
            await db.run(
                `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                     role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
                     cache_read_tokens, provenance, duration_ms, imported_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                recordHash,
                'claude',
                'test.jsonl',
                1,
                spec.id,
                i,
                'assistant',
                'message',
                'conversation',
                spec.start,
                'claude-x',
                spec.perMsgInput,
                spec.perMsgOutput,
                0.001,
                spec.perMsgCache,
                'agent',
                spec.perMsgDuration,
                '2026-06-01T00:00:00Z',
            );
            await db.run(
                `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                     session_id, seq, tool_name, effective_tool_name, tool_name_alias, args_digest, status,
                     duration_ms, result_bytes, imported_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                `${spec.id}-tc${i}`,
                recordHash,
                'claude',
                'test.jsonl',
                1,
                spec.id,
                i,
                `tool-${i}`,
                `tool-${i}`,
                `tool-${i}`,
                'digest',
                'success',
                150,
                0,
                '2026-06-01T00:00:00Z',
            );
        }
    }
}

/** Session ids in the fixture, sorted ascending by each aggregate value. */
const ASC_IDS = ['s1', 's2', 's3', 's4', 's5'];

describe('bySessionPage (0744)', () => {
    test('each sort key orders correctly in both directions; unrecognised key falls back to start', async () => {
        const db = await setup();
        await seedSessions(db);

        const expectedAsc: Record<string, string[]> = {
            start: ASC_IDS,
            duration: ASC_IDS,
            messages: ASC_IDS,
            toolCalls: ASC_IDS,
            billedTokens: ASC_IDS,
            cacheRead: ASC_IDS,
            freshInput: ASC_IDS,
        };

        for (const sortBy of Object.keys(SESSION_SORT_COLUMNS)) {
            const asc = await bySessionPage(db, ALL, { sortBy, sortDir: 'asc', limit: 100, offset: 0 });
            expect(
                asc.items.map((r) => r.sessionId),
                `${sortBy} asc`,
            ).toEqual(expectedAsc[sortBy] as string[]);
            expect(asc.total).toBe(5);

            const desc = await bySessionPage(db, ALL, { sortBy, sortDir: 'desc', limit: 100, offset: 0 });
            expect(
                desc.items.map((r) => r.sessionId),
                `${sortBy} desc`,
            ).toEqual([...ASC_IDS].reverse());
        }

        // Unrecognised sort key falls back to `start`.
        const fallback = await bySessionPage(db, ALL, { sortBy: 'nonsense', sortDir: 'asc', limit: 100, offset: 0 });
        expect(SESSION_SORT_COLUMNS.nonsense).toBeUndefined();
        expect(fallback.items.map((r) => r.sessionId)).toEqual(ASC_IDS);

        db.close();
    });

    test('total is the unpaged count, never the page length', async () => {
        const db = await setup();
        await seedSessions(db);

        const page = await bySessionPage(db, ALL, { sortBy: 'start', sortDir: 'asc', limit: 2, offset: 3 });
        expect(page.items.map((r) => r.sessionId)).toEqual(['s4', 's5']);
        expect(page.items).toHaveLength(2);
        // Offset 3 of a 5-row corpus still reports the full unpaged total.
        expect(page.total).toBe(5);

        // An offset beyond the corpus returns an empty page but the full total.
        const beyond = await bySessionPage(db, ALL, { sortBy: 'start', sortDir: 'asc', limit: 2, offset: 10 });
        expect(beyond.items).toHaveLength(0);
        expect(beyond.total).toBe(5);

        db.close();
    });

    test('returns the same SessionRow shape and tool enrichment as bySession', async () => {
        const db = await setup();
        await seedSessions(db);

        const unpaged = await bySession(db, ALL, 100);
        const paged = await bySessionPage(db, ALL, { sortBy: 'start', sortDir: 'asc', limit: 100, offset: 0 });

        const byId = new Map(unpaged.map((r) => [r.sessionId, r]));
        expect(paged.items).toHaveLength(unpaged.length);
        for (const row of paged.items) {
            const other = byId.get(row.sessionId);
            expect(other).toBeDefined();
            if (other === undefined) continue;
            expect(row.messages).toBe(other.messages);
            expect(row.toolCalls).toBe(other.toolCalls);
            expect(row.topTool).toBe(other.topTool);
            expect(row.tokens).toBe(other.tokens);
            expect(row.inputTokens).toBe(other.inputTokens);
            expect(row.cacheReadTokens).toBe(other.cacheReadTokens);
            expect(row.outputTokens).toBe(other.outputTokens);
            expect(row.assistantDurationMs).toBe(other.assistantDurationMs);
            expect(row.state).toBe(other.state);
        }

        db.close();
    });
});

describe('session sort parity (0744)', () => {
    test('SESSION_SORT_COLUMNS and SESSION_ORDER_COLUMNS cover the same keys with the same fallback and meanings', () => {
        expect(Object.keys(SESSION_SORT_COLUMNS).sort()).toEqual(Object.keys(SESSION_ORDER_COLUMNS).sort());

        // Both maps resolve an unrecognised key to `start`.
        expect(SESSION_SORT_COLUMNS.nonsense ?? SESSION_SORT_COLUMNS.start).toBe(SESSION_SORT_COLUMNS.start);
        expect(SESSION_ORDER_COLUMNS.nonsense ?? SESSION_ORDER_COLUMNS.start).toBe(SESSION_ORDER_COLUMNS.start);

        // Same meanings: canonicalise both maps (strip table aliases, unify column names) and compare.
        const canonical = (expr: string): string =>
            expr
                .replace(/\b(s|ms)\./g, '')
                .replace(/fresh_input_tokens|input_tokens/g, 'fresh_input')
                .replace(/output_tokens/g, 'output')
                .replace(/assistant_duration_ms/g, 'assistant_duration')
                .replace(/cache_read_tokens/g, 'cache_read')
                .replace(/started_at/g, 'start')
                .replace(/\s+/g, '');
        const fallbackCanonical = Object.fromEntries(
            Object.entries(SESSION_SORT_COLUMNS).map(([k, v]) => [k, canonical(v)]),
        );
        const rollupCanonical = Object.fromEntries(
            Object.entries(SESSION_ORDER_COLUMNS).map(([k, v]) => [k, canonical(v)]),
        );
        expect(fallbackCanonical).toEqual(rollupCanonical);
    });
});

describe('session listing pushdown (0744)', () => {
    test('both read paths push ORDER BY/LIMIT/OFFSET down to SQL', async () => {
        const db = await setup();
        await seedSessions(db);
        const { db: recDb, statements } = recordStatements(db);

        // Materialized path.
        await historyBoardSessionsFromRollup(recDb, ALL, { page: 1, pageSize: 2, sortBy: 'start', sortDir: 'desc' });
        // Fallback path.
        const page = await bySessionPage(recDb, ALL, { sortBy: 'start', sortDir: 'desc', limit: 2, offset: 0 });

        // Both paths issue at least one statement that carries ORDER BY + LIMIT + OFFSET.
        const pushdown = statements.filter(
            (s) => /\bORDER BY\b/i.test(s) && /\bLIMIT\b/i.test(s) && /\bOFFSET\b/i.test(s),
        );
        expect(pushdown.length).toBeGreaterThanOrEqual(2);

        // Materialized path reads the materialized table with the ordering tied to it.
        expect(statements.some((s) => s.includes('history_board_session_stats') && /\bORDER BY\b/i.test(s))).toBe(true);

        // Fallback path orders by the sort column plus the session_id tiebreak in SQL.
        const fallbackMain = statements.find((s) => /FROM history_message/.test(s) && /\bLIMIT\b/i.test(s));
        expect(fallbackMain).toBeDefined();
        expect(fallbackMain).toMatch(/ORDER BY ms\.started_at DESC, ms\.session_id ASC/i);

        // Fallback path returns only the page (never the full corpus) and does not sort in JS.
        expect(page.items.length).toBeLessThanOrEqual(2);

        db.close();
    });
});
