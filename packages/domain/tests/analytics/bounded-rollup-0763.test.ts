/**
 * Focused tests for task 0763 — bound the whole-corpus rollup derivations.
 *
 * R1 loop findings scoped by delta sessions; R2 ranked-plan reads served by the
 * rank indexes (no TEMP B-TREE for unfiltered, `+expr` preserved when filtered);
 * R4 source stats via the recursive-CTE loose index scan over
 * idx_history_message_source_file; R5 alias backfill scoped to the delta's
 * sources and imported-at window. R3 covers the wide-delta fallback, reset
 * cleanup, and first-seen source path.
 */
import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL, sha256 } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import {
    distinctSourceFileCounts,
    loops,
    topCacheWasteSteps,
    topStepsByDuration,
    topStepsByTokens,
} from '../../src/analytics/forensic-query';
import { refreshHistoryBoardRollupsIncremental } from '../../src/analytics/history-board-rollup';
import { resetHistoryTables } from '../../src/analytics/history-reset';
import { applyToolAliases } from '../../src/analytics/tool-alias';
import { applyCliMigrations } from '../../src/migrations';

const ALL_HISTORY: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    models: null,
    tools: null,
    skills: null,
    sessionId: null,
    runId: null,
    taskWbs: null,
};

interface Msg {
    recordHash: string;
    sessionId: string;
    seq: number;
    source?: string;
    sourceFile?: string;
    role?: string;
    ts: string | null;
    model?: string | null;
    input?: number | null;
    cacheRead?: number | null;
    output?: number | null;
    durationMs?: number | null;
    importedAt?: string;
    requestId?: string | null;
}

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

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, cache_read_tokens, output_tokens,
             cost_usd, provenance, run_id, task_wbs, duration_ms, request_id, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.recordHash,
        m.source ?? 'claude',
        m.sourceFile ?? 'test.jsonl',
        1,
        m.sessionId,
        m.seq,
        m.role ?? 'assistant',
        'message',
        'conversation',
        m.ts,
        m.model ?? null,
        m.input ?? null,
        m.cacheRead ?? null,
        m.output ?? null,
        null,
        'agent',
        null,
        null,
        m.durationMs ?? null,
        m.requestId ?? null,
        m.importedAt ?? '2026-06-01T00:00:00Z',
    );
}

interface RecordedQuery {
    sql: string;
    params: unknown[];
}

function recordingQueryAdapter(db: DbAdapter, sink: RecordedQuery[]): DbAdapter {
    return new Proxy(db, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                if (prop === 'queryAll' && typeof args[0] === 'string') {
                    sink.push({ sql: args[0], params: args.slice(1) });
                }
                return (value as (...callArgs: unknown[]) => unknown).apply(target, args);
            };
        },
    }) as DbAdapter;
}

interface ToolCall {
    recordHash: string;
    messageHash: string;
    sessionId: string;
    seq: number;
    source?: string;
    toolName?: string;
    args?: unknown;
    importedAt?: string;
}

async function insertToolCall(db: DbAdapter, t: ToolCall): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_digest, status, imported_at, effective_tool_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.recordHash,
        t.messageHash,
        t.source ?? 'claude',
        'test.jsonl',
        1,
        t.sessionId,
        t.seq,
        t.toolName ?? 'Read',
        sha256(t.args ?? { command: 'ls' }),
        'success',
        t.importedAt ?? '2026-06-01T00:00:00Z',
        t.toolName ?? 'Read',
    );
}

describe('0763 R2 — ranked plan reads the rank indexes', () => {
    test('unfiltered selector: ORDER BY skips TEMP B-TREE on all three rank queries', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'r1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            input: 100,
            durationMs: 500,
        });
        const queries: RecordedQuery[] = [];
        const recorder = recordingQueryAdapter(db, queries);
        await topStepsByTokens(recorder, ALL_HISTORY, 5);
        await topStepsByDuration(recorder, ALL_HISTORY, 5);
        await topCacheWasteSteps(recorder, ALL_HISTORY, 5);

        const expectedIndexes = [
            'idx_history_message_token_rank',
            'idx_history_message_duration_rank',
            'idx_history_message_input_rank',
        ] as const;
        expect(queries).toHaveLength(expectedIndexes.length);
        for (const [index, expectedIndex] of expectedIndexes.entries()) {
            const query = queries[index];
            if (!query) throw new Error(`missing captured rank query ${index}`);
            const plan = (await db.queryAll<{ detail: string }>(`EXPLAIN QUERY PLAN ${query.sql}`, ...query.params))
                .map((r) => r.detail)
                .join('\n');
            expect(plan).toContain(expectedIndex);
            expect(plan).not.toContain('USE TEMP B-TREE FOR ORDER BY');
        }
    });

    test('filtered selector keeps the pre-0763 plan (unary + form still forces the sort)', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'r1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            input: 100,
            durationMs: 500,
        });
        const queries: RecordedQuery[] = [];
        const recorder = recordingQueryAdapter(db, queries);
        await topStepsByTokens(recorder, { ...ALL_HISTORY, since: '2026-06-01T00:00:00Z', sources: ['claude'] }, 5);
        const query = queries[0];
        expect(query).toBeDefined();
        if (query === undefined) throw new Error('topStepsByTokens issued no query');
        expect(query.sql).toContain('ORDER BY +');
        const plan = (await db.queryAll<{ detail: string }>(`EXPLAIN QUERY PLAN ${query.sql}`, ...query.params))
            .map((r) => r.detail)
            .join('\n');
        expect(plan).toContain('USE TEMP B-TREE FOR ORDER BY');
    });

    test('recomputeRankedSteps (full refresh) returns top steps in rank order', async () => {
        const db = await setup();
        for (const [i, tokens] of [900, 100, 500].entries()) {
            await insertMessage(db, {
                recordHash: `r${i}`,
                sessionId: 's1',
                seq: i,
                ts: `2026-06-01T10:0${i}:00Z`,
                input: tokens,
            });
        }
        await refreshHistoryBoardRollupsIncremental(db); // no watermark → full rebuild
        const rows = await db.queryAll<{ input_tokens: number }>(
            "SELECT input_tokens FROM history_board_ranked_steps WHERE kind = 'tokens' ORDER BY rank",
        );
        expect(rows.map((r) => r.input_tokens)).toEqual([900, 500, 100]);
    });
});

describe('0763 R1 — loop findings scoped by delta sessions', () => {
    async function seedLoopCorpus(db: DbAdapter, importedAt: string, prefix: string): Promise<void> {
        for (const session of ['sA', 'sB']) {
            for (let i = 0; i < 3; i++) {
                const hash = `${prefix}-${session}-${i}`;
                await insertMessage(db, {
                    recordHash: hash,
                    sessionId: session,
                    seq: i,
                    ts: `2026-06-01T10:0${i}:00Z`,
                    model: 'gpt-5',
                    importedAt,
                });
                await insertToolCall(db, {
                    recordHash: `${hash}-t`,
                    messageHash: hash,
                    sessionId: session,
                    seq: i,
                    toolName: 'Read',
                    args: { path: '/x' },
                    importedAt,
                });
            }
        }
    }

    test('delta touching only session A leaves session B rows intact and matches a fresh rebuild', async () => {
        const base = await setup();
        await seedLoopCorpus(base, '2026-06-01T05:00:00Z', 'base');
        await refreshHistoryBoardRollupsIncremental(base); // full rebuild, watermark at 05:00

        // Delta: one more Read call in session A only, imported later than the watermark.
        await insertMessage(base, {
            recordHash: 'd-A-3',
            sessionId: 'sA',
            seq: 3,
            ts: '2026-06-01T11:00:00Z',
            model: 'gpt-5',
            importedAt: '2026-06-01T07:00:00Z',
        });
        await insertToolCall(base, {
            recordHash: 'd-A-3-t',
            messageHash: 'd-A-3',
            sessionId: 'sA',
            seq: 3,
            toolName: 'Read',
            args: { path: '/x' },
            importedAt: '2026-06-01T07:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(base);

        const scopedRows = await base.queryAll<{ session_id: string; repeats: number; args_digest: string }>(
            'SELECT * FROM history_board_loop_findings ORDER BY session_id, args_digest',
        );

        const fresh = await setup();
        await seedLoopCorpus(fresh, '2026-06-01T05:00:00Z', 'base');
        await insertMessage(fresh, {
            recordHash: 'd-A-3',
            sessionId: 'sA',
            seq: 3,
            ts: '2026-06-01T11:00:00Z',
            model: 'gpt-5',
            importedAt: '2026-06-01T07:00:00Z',
        });
        await insertToolCall(fresh, {
            recordHash: 'd-A-3-t',
            messageHash: 'd-A-3',
            sessionId: 'sA',
            seq: 3,
            toolName: 'Read',
            args: { path: '/x' },
            importedAt: '2026-06-01T07:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(fresh); // no watermark → full rebuild
        const freshRows = await fresh.queryAll<{ session_id: string; repeats: number; args_digest: string }>(
            'SELECT * FROM history_board_loop_findings ORDER BY session_id, args_digest',
        );

        expect(scopedRows).toEqual(freshRows);
        // sA now has 4 repeats; sB untouched at 3.
        const bySession = new Map(scopedRows.map((r) => [r.session_id, r.repeats]));
        expect(bySession.get('sA')).toBe(4);
        expect(bySession.get('sB')).toBe(3);
    });

    test('empty delta scope is a no-op and never falls back to the full-corpus loop query', async () => {
        const db = await setup();
        await seedLoopCorpus(db, '2026-06-01T05:00:00Z', 'base');
        await refreshHistoryBoardRollupsIncremental(db);

        expect(await loops(db, ALL_HISTORY, { sessionScope: [] })).toEqual([]);
        const before = await db.queryAll('SELECT * FROM history_board_loop_findings ORDER BY session_id, args_digest');

        // Delta rows whose session_id is one of the filtered sentinel sessions:
        // deltaSessionScope returns [] (not null), so there is nothing to re-derive.
        await insertMessage(db, {
            recordHash: 'x-1',
            sessionId: 'unknown',
            seq: 0,
            ts: '2026-06-01T12:00:00Z',
            model: 'gpt-5',
            importedAt: '2026-06-01T08:00:00Z',
        });
        await insertToolCall(db, {
            recordHash: 'x-1-t',
            messageHash: 'x-1',
            sessionId: 'unknown',
            seq: 0,
            toolName: 'Read',
            args: { path: '/y' },
            importedAt: '2026-06-01T08:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);

        const after = await db.queryAll('SELECT * FROM history_board_loop_findings ORDER BY session_id, args_digest');
        expect(after).toEqual(before);
    });

    test('more than 1000 touched sessions falls back to a full recompute', async () => {
        const db = await setup();
        await seedLoopCorpus(db, '2026-06-01T05:00:00Z', 'base');
        await refreshHistoryBoardRollupsIncremental(db);

        for (let i = 0; i <= 1000; i++) {
            await insertMessage(db, {
                recordHash: `wide-${i}-0`,
                sessionId: `wide-${i}`,
                seq: 0,
                ts: '2026-06-01T12:00:00Z',
                importedAt: '2026-06-01T08:00:00Z',
            });
        }
        for (let i = 0; i < 3; i++) {
            const messageHash = i === 0 ? 'wide-0-0' : `wide-0-${i}`;
            if (i > 0) {
                await insertMessage(db, {
                    recordHash: messageHash,
                    sessionId: 'wide-0',
                    seq: i,
                    ts: '2026-06-01T12:00:00Z',
                    importedAt: '2026-06-01T08:00:00Z',
                });
            }
            await insertToolCall(db, {
                recordHash: `wide-tool-${i}`,
                messageHash,
                sessionId: 'wide-0',
                seq: i,
                args: { path: '/wide' },
                importedAt: '2026-06-01T08:00:00Z',
            });
        }

        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<{ repeats: number }>(
                "SELECT repeats FROM history_board_loop_findings WHERE session_id = 'wide-0'",
            ),
        ).toEqual({ repeats: 3 });
    });

    test('history reset removes raw rows and their loop findings together', async () => {
        const db = await setup();
        await seedLoopCorpus(db, '2026-06-01T05:00:00Z', 'base');
        await refreshHistoryBoardRollupsIncremental(db);
        expect(await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_loop_findings')).toEqual({
            n: 2,
        });

        await resetHistoryTables(db);
        expect(await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_message')).toEqual({ n: 0 });
        expect(await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_loop_findings')).toEqual({
            n: 0,
        });
    });
});

describe('0763 R4 — source stats via the loose index scan', () => {
    test('recursive CTE walks the covering index and counts distinct files per source', async () => {
        const db = await setup();
        await insertMessage(db, { recordHash: 'a1', sessionId: 's1', seq: 1, ts: null, sourceFile: 'a.jsonl' });
        await insertMessage(db, { recordHash: 'a2', sessionId: 's1', seq: 2, ts: null, sourceFile: 'a.jsonl' });
        await insertMessage(db, { recordHash: 'b1', sessionId: 's1', seq: 3, ts: null, sourceFile: 'b.jsonl' });
        await insertMessage(db, {
            recordHash: 'c1',
            sessionId: 's1',
            seq: 4,
            ts: null,
            source: 'codex',
            sourceFile: 'c.jsonl',
        });

        const queries: RecordedQuery[] = [];
        const counts = await distinctSourceFileCounts(recordingQueryAdapter(db, queries));
        expect(counts.get('claude')).toBe(2);
        expect(counts.get('codex')).toBe(1);

        const query = queries[0];
        expect(query).toBeDefined();
        if (query === undefined) throw new Error('distinctSourceFileCounts issued no query');
        const plan = (await db.queryAll<{ detail: string }>(`EXPLAIN QUERY PLAN ${query.sql}`, ...query.params))
            .map((r) => r.detail)
            .join('\n');
        expect(plan).toContain('idx_history_message_source_file');
    });

    test('incremental refresh on a multi-file corpus matches a fresh full rebuild (raw_messages, day-0 sentinel, files)', async () => {
        const build = async () => {
            const db = await setup();
            // Two sources, multiple files, one NULL-ts message (day-'' sentinel bucket).
            await insertMessage(db, {
                recordHash: 'a1',
                sessionId: 's1',
                seq: 1,
                ts: null,
                input: 10,
                sourceFile: 'a.jsonl',
                importedAt: '2026-06-01T05:00:00Z',
            });
            await insertMessage(db, {
                recordHash: 'a2',
                sessionId: 's1',
                seq: 2,
                ts: '2026-06-01T10:00:00Z',
                input: 20,
                sourceFile: 'a.jsonl',
                importedAt: '2026-06-01T05:00:00Z',
            });
            await insertMessage(db, {
                recordHash: 'b1',
                sessionId: 's1',
                seq: 3,
                ts: '2026-06-02T10:00:00Z',
                input: 40,
                sourceFile: 'b.jsonl',
                importedAt: '2026-06-01T05:00:00Z',
            });
            await insertMessage(db, {
                recordHash: 'c1',
                sessionId: 's1',
                seq: 4,
                ts: '2026-06-01T09:00:00Z',
                input: 5,
                source: 'codex',
                sourceFile: 'c.jsonl',
                importedAt: '2026-06-01T05:00:00Z',
            });
            return db;
        };

        const incremental = await build();
        await refreshHistoryBoardRollupsIncremental(incremental);
        await insertMessage(incremental, {
            recordHash: 'd1',
            sessionId: 's1',
            seq: 5,
            ts: '2026-06-02T11:00:00Z',
            input: 30,
            sourceFile: 'b.jsonl',
            importedAt: '2026-06-01T07:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(incremental);

        const fresh = await build();
        await insertMessage(fresh, {
            recordHash: 'd1',
            sessionId: 's1',
            seq: 5,
            ts: '2026-06-02T11:00:00Z',
            input: 30,
            sourceFile: 'b.jsonl',
            importedAt: '2026-06-01T07:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(fresh); // no watermark → full rebuild

        const dump = async (db: DbAdapter) => ({
            daily: await db.queryAll('SELECT * FROM history_board_source_daily ORDER BY source, day'),
            stats: await db.queryAll('SELECT * FROM history_board_source_stats ORDER BY source'),
        });
        expect(await dump(incremental)).toEqual(await dump(fresh));
    });

    test('raw source counts retain a deduplicated-away day', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'stream-1',
            sessionId: 'stream',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            input: 10,
            requestId: 'request-1',
            importedAt: '2026-06-01T05:00:00Z',
        });
        await insertMessage(db, {
            recordHash: 'stream-2',
            sessionId: 'stream',
            seq: 2,
            ts: '2026-06-02T10:00:00Z',
            input: 20,
            requestId: 'request-1',
            importedAt: '2026-06-01T05:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);
        await insertMessage(db, {
            recordHash: 'delta',
            sessionId: 'delta',
            seq: 1,
            ts: '2026-06-03T10:00:00Z',
            input: 30,
            importedAt: '2026-06-01T07:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);

        expect(
            await db.queryAll<{ day: string; raw_messages: number }>(
                'SELECT day, raw_messages FROM history_board_source_daily ORDER BY day',
            ),
        ).toEqual([
            { day: '2026-06-01', raw_messages: 1 },
            { day: '2026-06-02', raw_messages: 1 },
            { day: '2026-06-03', raw_messages: 1 },
        ]);
        expect(
            await db.queryFirst<{ messages: number }>(
                "SELECT messages FROM history_board_source_stats WHERE source = 'claude'",
            ),
        ).toEqual({ messages: 3 });
    });
});

describe('0763 R5 — alias backfill scoped to the delta', () => {
    test('scoped incremental pass leaves stale aliases on untouched rows; unscoped pass fixes them', async () => {
        const db = await setup();
        // Pre-delta tool call imported BEFORE the first refresh's watermark (05:00) —
        // the scoped pass must never scan it again. First refresh (no alias map) leaves
        // its alias at the effective name.
        await insertMessage(db, {
            recordHash: 'm1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            model: 'gpt-5',
            importedAt: '2026-06-01T05:00:00Z',
        });
        await insertToolCall(db, {
            recordHash: 't1',
            messageHash: 'm1',
            sessionId: 's1',
            seq: 1,
            toolName: 'exec_command',
            args: { command: 'ls' },
            importedAt: '2026-06-01T04:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db); // full rebuild with no alias map → alias = effective name

        // Map the alias AFTER the first refresh: t1 is now stale.
        await db.run(
            "INSERT INTO history_tool_alias_map (source, effective_tool_name, alias) VALUES ('claude', 'exec_command', 'Shell')",
        );
        expect(
            await db.queryFirst<{ n: number }>(
                'SELECT COUNT(*) AS n FROM history_tool_call WHERE tool_name_alias = ?',
                'Shell',
            ),
        ).toMatchObject({ n: 0 });

        // Delta: a NEW row for the same source. Scoped applyToolAliases(since=watermark)
        // must alias the new row without touching the stale one.
        await insertMessage(db, {
            recordHash: 'm2',
            sessionId: 's1',
            seq: 2,
            ts: '2026-06-01T11:00:00Z',
            model: 'gpt-5',
            importedAt: '2026-06-01T07:00:00Z',
        });
        await insertToolCall(db, {
            recordHash: 't2',
            messageHash: 'm2',
            sessionId: 's1',
            seq: 2,
            toolName: 'exec_command',
            args: { command: 'ls' },
            importedAt: '2026-06-01T07:00:00Z',
        });
        await applyToolAliases(db, { sources: ['claude'], since: '2026-06-01T05:00:00Z' });

        const aliasOf = async (hash: string) =>
            (
                await db.queryFirst<{ a: string | null }>(
                    'SELECT tool_name_alias AS a FROM history_tool_call WHERE record_hash = ?',
                    hash,
                )
            )?.a;
        expect(await aliasOf('t1')).toBe('exec_command'); // pre-map alias, untouched by the scoped pass
        expect(await aliasOf('t2')).toBe('Shell');

        // Unscoped pass (full-rebuild path) re-aliases every row.
        await applyToolAliases(db);
        expect(await aliasOf('t1')).toBe('Shell');
        expect(await aliasOf('t2')).toBe('Shell');
    });

    test('incremental refresh aliases the first delta from a new source', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'base',
            sessionId: 'base',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            importedAt: '2026-06-01T05:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);
        await db.run(
            "INSERT INTO history_tool_alias_map (source, effective_tool_name, alias) VALUES ('codex', 'exec_command', 'Shell')",
        );
        await insertMessage(db, {
            recordHash: 'codex-message',
            source: 'codex',
            sessionId: 'codex-session',
            seq: 1,
            ts: '2026-06-01T11:00:00Z',
            importedAt: '2026-06-01T07:00:00Z',
        });
        await insertToolCall(db, {
            recordHash: 'codex-tool',
            messageHash: 'codex-message',
            source: 'codex',
            sessionId: 'codex-session',
            seq: 1,
            toolName: 'exec_command',
            importedAt: '2026-06-01T07:00:00Z',
        });

        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<{ tool_name_alias: string }>(
                "SELECT tool_name_alias FROM history_tool_call WHERE record_hash = 'codex-tool'",
            ),
        ).toEqual({ tool_name_alias: 'Shell' });
        expect(
            await db.queryFirst<{ tool_name: string }>(
                "SELECT tool_name FROM history_board_tool_5m WHERE source = 'codex'",
            ),
        ).toEqual({ tool_name: 'Shell' });
    });
});

describe('0763 R4 regression — adversarial anchor (no valid column-wise MIN pair)', () => {
    test('walk starts at the true lex-first pair and counts correctly when (MIN source, MIN source_file) does not exist', async () => {
        const db = await setup();
        // Column-wise MINs are (a, m.jsonl) — a pair absent from the table, since
        // source 'a' only has a.jsonl. The pre-review CTE anchored on that phantom
        // pair and returned [] (merged downstream as files=0).
        await insertMessage(db, {
            recordHash: 'r1',
            sessionId: 's1',
            seq: 1,
            ts: null,
            source: 'b',
            sourceFile: 'm.jsonl',
        });
        await insertMessage(db, {
            recordHash: 'r2',
            sessionId: 's2',
            seq: 1,
            ts: null,
            source: 'a',
            sourceFile: 'a.jsonl',
        });

        const counts = await distinctSourceFileCounts(db);
        expect(counts.get('a')).toBe(1);
        expect(counts.get('b')).toBe(1);
        expect(counts.size).toBe(2);
    });

    test('walk emits no terminal NULL key and stays exact on a 600-file corpus', async () => {
        const db = await setup();
        for (let s = 0; s < 20; s++) {
            const source = `src${String(s).padStart(2, '0')}`;
            for (let f = 0; f < 30; f++) {
                await insertMessage(db, {
                    recordHash: `h${s}-${f}`,
                    sessionId: `sess-${s}-${f}`,
                    seq: 1,
                    ts: null,
                    source,
                    sourceFile: `file${String(f).padStart(3, '0')}.jsonl`,
                });
            }
        }
        const counts = await distinctSourceFileCounts(db);
        expect(counts.size).toBe(20);
        for (const [, files] of counts) expect(files).toBe(30);
    });
});
