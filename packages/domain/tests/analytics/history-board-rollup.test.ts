import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import type { MessageRollupRow, StepRow, ToolRollupRow } from '../../src/analytics/forensic-query';
import {
    historyBoardDatabaseBytes,
    historyBoardHeavySessionsFromRollup,
    historyBoardHistoryVersion,
    historyBoardKpiTrendFromRollup,
    historyBoardLoopsFromRollup,
    historyBoardModelComparisonFromRollup,
    historyBoardRankedStepsFromRollup,
    historyBoardRollupsFresh,
    historyBoardSessionsFromRollup,
    historyBoardSourcesFromRollup,
    historyBoardSummaryFromRollup,
    replaceHistoryBoardRollups,
} from '../../src/analytics/history-board-rollup';
import { HISTORY_BOARD_ROLLUPS_SCHEMA_SQL } from '../../src/migrations';

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
    for (const statement of `${HISTORY_IMPORT_SCHEMA_SQL};${HISTORY_BOARD_ROLLUPS_SCHEMA_SQL}`
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    return adapter;
}

interface Msg {
    recordHash: string;
    sessionId: string;
    seq: number;
    role?: string;
    ts: string | null;
    model?: string | null;
    input?: number | null;
    cacheRead?: number | null;
    output?: number | null;
    durationMs?: number | null;
    disposition?: string;
    requestId?: string | null;
    importedAt?: string;
}

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
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
        m.role ?? 'assistant',
        'message',
        m.disposition ?? 'conversation',
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

interface ToolCall {
    recordHash: string;
    messageHash: string;
    sessionId: string;
    seq: number;
    toolName?: string;
    argsRaw?: string | null;
    status?: string;
    durationMs?: number | null;
}

async function insertToolCall(db: DbAdapter, t: ToolCall): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_raw, status, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.recordHash,
        t.messageHash,
        'claude',
        'test.jsonl',
        1,
        t.sessionId,
        t.seq,
        t.toolName ?? 'Read',
        t.argsRaw ?? null,
        t.status ?? 'success',
        t.durationMs ?? null,
        '2026-06-01T00:00:00Z',
    );
}

function messageRollupRow(partial: Partial<MessageRollupRow> = {}): MessageRollupRow {
    return {
        source: 'claude',
        model: 'gpt-5',
        day: '2026-06-01',
        messages: 1,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: null,
        costUsd: null,
        recordsWithUsage: 0,
        assistantDurationMs: 0,
        assistantDurationUnmeasured: 0,
        ...partial,
    };
}

function toolRollupRow(partial: Partial<ToolRollupRow> = {}): ToolRollupRow {
    return {
        source: 'claude',
        model: 'gpt-5',
        day: '2026-06-01',
        toolCalls: 0,
        durationMs: null,
        durationUnmeasured: 0,
        ...partial,
    };
}

function stepRow(partial: Partial<StepRow> = {}): StepRow {
    return {
        sessionId: 's1',
        source: 'claude',
        ts: '2026-06-01T00:10:00Z',
        model: 'gpt-5',
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costUsd: null,
        durationMs: null,
        ...partial,
    };
}

const EMPTY_SEED = {
    messageRows: [] as readonly MessageRollupRow[],
    toolRows: [] as readonly ToolRollupRow[],
    loopRows: [],
    sourceRows: [],
    tokenSteps: [] as readonly StepRow[],
    durationSteps: [] as readonly StepRow[],
    cacheWasteSteps: [] as readonly StepRow[],
};

/** Seed two sessions across two 5-minute buckets with tools and skills; build all read models. */
async function seedCorpusAndRefresh(db: DbAdapter): Promise<void> {
    // Session s1: 09:58 bucket. Two turns; last message is assistant with no tool → complete.
    await insertMessage(db, {
        recordHash: 's1-u1',
        sessionId: 's1',
        seq: 1,
        role: 'user',
        ts: '2026-06-01T09:58:00Z',
        model: 'gpt-5',
    });
    await insertMessage(db, {
        recordHash: 's1-a1',
        sessionId: 's1',
        seq: 2,
        ts: '2026-06-01T09:58:30Z',
        model: 'gpt-5',
        input: 100,
        cacheRead: 900,
        output: 50,
        durationMs: 4000,
    });
    await insertToolCall(db, {
        recordHash: 'tc-s1-1',
        messageHash: 's1-a1',
        sessionId: 's1',
        seq: 2,
        toolName: 'Read',
        durationMs: 100,
    });
    await insertToolCall(db, {
        recordHash: 'tc-s1-2',
        messageHash: 's1-a1',
        sessionId: 's1',
        seq: 3,
        toolName: 'skill',
        argsRaw: '{"skill":"sp-code-testing"}',
        durationMs: 200,
    });
    await insertMessage(db, {
        recordHash: 's1-u2',
        sessionId: 's1',
        seq: 4,
        role: 'user',
        ts: '2026-06-01T09:59:00Z',
        model: 'gpt-5',
    });
    await insertMessage(db, {
        recordHash: 's1-a2',
        sessionId: 's1',
        seq: 5,
        ts: '2026-06-01T09:59:30Z',
        model: 'gpt-5',
        input: 10,
        output: 5,
    });
    // Session s2: 10:05 bucket, different model. Ends on assistant WITH tool → in-progress.
    await insertMessage(db, {
        recordHash: 's2-u1',
        sessionId: 's2',
        seq: 1,
        role: 'user',
        ts: '2026-06-01T10:05:00Z',
        model: 'gpt-5-mini',
    });
    await insertMessage(db, {
        recordHash: 's2-a1',
        sessionId: 's2',
        seq: 2,
        ts: '2026-06-01T10:05:30Z',
        model: 'gpt-5-mini',
        input: 40,
        output: 20,
        durationMs: 2000,
    });
    await insertToolCall(db, {
        recordHash: 'tc-s2-1',
        messageHash: 's2-a1',
        sessionId: 's2',
        seq: 2,
        toolName: 'Bash',
        status: 'error',
    });

    await replaceHistoryBoardRollups(db, {
        historyVersion: await historyBoardHistoryVersion(db),
        messageRows: [
            messageRollupRow({ day: '2026-06-01', messages: 4, inputTokens: 110 }),
            messageRollupRow({ day: '2026-06-02', messages: 1, inputTokens: 7 }),
        ],
        toolRows: [toolRollupRow({ toolCalls: 3 })],
        loopRows: [
            {
                source: 'claude',
                sessionId: 's1',
                model: 'gpt-5',
                startedAt: '2026-06-01T09:58:00Z',
                toolName: 'Read',
                argsDigest: 'digest-a',
                repeats: 4,
                firstSeq: 1,
                lastSeq: 9,
            },
        ],
        sourceRows: [{ source: 'claude', files: 2, messages: 7, lastImportedAt: '2026-06-02T00:00:00Z' }],
        tokenSteps: [
            stepRow({ inputTokens: 1500, outputTokens: 300 }),
            stepRow({ sessionId: 's2', model: 'gpt-5-mini', inputTokens: 200 }),
        ],
        durationSteps: [
            stepRow({ durationMs: 9000 }),
            stepRow({ sessionId: 's2', model: 'gpt-5-mini', durationMs: 1000 }),
        ],
        cacheWasteSteps: [stepRow({ cacheReadTokens: 5000 })],
    });
}

describe('historyBoardHistoryVersion', () => {
    test('uses checkpoint shape when checkpoint rows exist', async () => {
        const db = await setup();
        await db.run(
            `INSERT INTO history_import_checkpoint (source, source_file, last_imported_line, updated_at)
             VALUES ('claude', 'a.jsonl', 5, '2026-06-02T00:00:00Z')`,
        );
        await expect(historyBoardHistoryVersion(db)).resolves.toBe('v2:checkpoint:2026-06-02T00:00:00Z:1:5');
    });

    test('falls back to latest raw message rowid when no checkpoint exists', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'm1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T00:00:00Z',
            importedAt: '2026-06-01T01:00:00Z',
        });
        const version = await historyBoardHistoryVersion(db);
        expect(version).toBe('v2:message:2026-06-01T01:00:00Z:1');
    });

    test('fallback handles an empty message table', async () => {
        const db = await setup();
        await expect(historyBoardHistoryVersion(db)).resolves.toBe('v2:message::0');
    });
});

describe('historyBoardRollupsFresh', () => {
    test('fresh only when the stored meta version equals the current history version', async () => {
        const db = await setup();
        expect(await historyBoardRollupsFresh(db)).toBe(false);
        await db.run(
            `INSERT INTO history_board_rollup_meta (id, history_version, refreshed_at)
             VALUES (1, ?, '2026-06-01T00:00:00Z')`,
            await historyBoardHistoryVersion(db),
        );
        expect(await historyBoardRollupsFresh(db)).toBe(true);
        // Any new message invalidates the version → stale.
        await insertMessage(db, { recordHash: 'm2', sessionId: 's1', seq: 2, ts: '2026-06-01T02:00:00Z' });
        expect(await historyBoardRollupsFresh(db)).toBe(false);
    });
});

describe('replaceHistoryBoardRollups', () => {
    test('materializes every read model and replaces prior contents on re-run', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);

        // message_5m: bucket flooring to 300s (09:58 and 09:59 both floor to 09:55).
        const buckets = await db.queryAll<{ bucket_start: string; session_id: string; messages: number }>(
            `SELECT bucket_start, session_id, messages FROM history_board_message_5m
             ORDER BY bucket_start, session_id`,
        );
        expect(buckets).toEqual([
            { bucket_start: '2026-06-01T09:55:00Z', session_id: 's1', messages: 4 },
            { bucket_start: '2026-06-01T10:05:00Z', session_id: 's2', messages: 2 },
        ]);

        // tool_5m: per-tool rows with skill-name extraction from args_raw.
        const tools5m = await db.queryAll<{ tool_name: string; skill_name: string; calls: number; errors: number }>(
            `SELECT tool_name, skill_name, calls, errors FROM history_board_tool_5m ORDER BY tool_name`,
        );
        expect(tools5m).toContainEqual({ tool_name: 'skill', skill_name: 'sp-code-testing', calls: 1, errors: 0 });
        expect(tools5m).toContainEqual({ tool_name: 'Read', skill_name: '', calls: 1, errors: 0 });
        expect(tools5m).toContainEqual({ tool_name: 'Bash', skill_name: '', calls: 1, errors: 1 });

        // session_stats: state and top tool (call-count tie broken by name ASC).
        const sessions = await db.queryAll<{ session_id: string; state: string; top_tool: string; tool_calls: number }>(
            `SELECT session_id, state, top_tool, tool_calls FROM history_board_session_stats ORDER BY session_id`,
        );
        expect(sessions).toEqual([
            { session_id: 's1', state: 'complete', top_tool: 'Read', tool_calls: 2 },
            { session_id: 's2', state: 'in-progress', top_tool: 'Bash', tool_calls: 1 },
        ]);

        // model_stats aggregates duration samples per model.
        const modelStats = await db.queryAll<{
            model: string;
            assistant_duration_ms: number;
            assistant_duration_samples: number;
            tool_calls: number;
            errors: number;
        }>(
            `SELECT model, assistant_duration_ms, assistant_duration_samples, tool_calls, errors
             FROM history_board_model_stats ORDER BY model`,
        );
        expect(modelStats).toEqual([
            { model: 'gpt-5', assistant_duration_ms: 4000, assistant_duration_samples: 1, tool_calls: 2, errors: 0 },
            {
                model: 'gpt-5-mini',
                assistant_duration_ms: 2000,
                assistant_duration_samples: 1,
                tool_calls: 1,
                errors: 1,
            },
        ]);

        // ranked steps carry their kind and rank.
        const ranked = await db.queryAll<{ kind: string; rank: number; session_id: string }>(
            `SELECT kind, rank, session_id FROM history_board_ranked_steps ORDER BY kind, rank`,
        );
        expect(ranked).toEqual([
            { kind: 'cache-waste', rank: 1, session_id: 's1' },
            { kind: 'duration', rank: 1, session_id: 's1' },
            { kind: 'duration', rank: 2, session_id: 's2' },
            { kind: 'tokens', rank: 1, session_id: 's1' },
            { kind: 'tokens', rank: 2, session_id: 's2' },
        ]);

        // meta row stamped with the seed version → fresh.
        expect(await historyBoardRollupsFresh(db)).toBe(true);

        // Idempotence: refreshing again is a full rebuild (DELETE-then-INSERT), never an append.
        await db.run('DELETE FROM history_board_session_stats');
        await replaceHistoryBoardRollups(db, {
            historyVersion: await historyBoardHistoryVersion(db),
            messageRows: [],
            toolRows: [],
            loopRows: [],
            sourceRows: [],
            tokenSteps: [],
            durationSteps: [],
            cacheWasteSteps: [],
        });
        expect(await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_rollup_meta')).toEqual({
            n: 1,
        });
        expect(await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_session_stats')).toEqual({
            n: 2,
        });
    });

    test('drops re-imported duplicates: only the first row of a request_id group is measured', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'dup-1',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T11:00:00Z',
            input: 100,
            requestId: 'req-1',
        });
        await insertMessage(db, {
            recordHash: 'dup-2',
            sessionId: 's1',
            seq: 2,
            ts: '2026-06-01T11:01:00Z',
            input: 999,
            requestId: 'req-1',
        });
        await insertMessage(db, {
            recordHash: 'null-req',
            sessionId: 's1',
            seq: 3,
            ts: '2026-06-01T11:02:00Z',
            input: 7,
        });
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });

        const rows = await db.queryAll<{ bucket_start: string; messages: number; fresh_input_tokens: number }>(
            `SELECT bucket_start, messages, fresh_input_tokens FROM history_board_message_5m ORDER BY bucket_start`,
        );
        expect(rows).toEqual([{ bucket_start: '2026-06-01T11:00:00Z', messages: 2, fresh_input_tokens: 107 }]);
    });

    test('splits message tokens evenly across the tools of the same message', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'm-tools',
            sessionId: 's1',
            seq: 1,
            ts: '2026-06-01T00:10:00Z',
            input: 100,
            cacheRead: 200,
            output: 50,
        });
        for (let i = 0; i < 4; i++) {
            await insertToolCall(db, {
                recordHash: `tc-${i}`,
                messageHash: 'm-tools',
                sessionId: 's1',
                seq: 1,
                toolName: `Tool${i}`,
            });
        }
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });
        const rows = await db.queryAll<{ tool_name: string; fresh_input_tokens: number; output_tokens: number }>(
            `SELECT tool_name, fresh_input_tokens, output_tokens FROM history_board_tool_5m ORDER BY tool_name`,
        );
        expect(rows).toHaveLength(4);
        for (const row of rows) {
            expect(row.fresh_input_tokens).toBe(25); // 100 / 4 tools
            expect(row.output_tokens).toBe(12.5); // 50 / 4 tools
        }
    });
    test('excludes placeholder session ids from session_stats but not from 5m buckets', async () => {
        const db = await setup();
        await insertMessage(db, { recordHash: 'anon', sessionId: 'unknown', seq: 1, ts: '2026-06-01T00:10:00Z' });
        await insertMessage(db, { recordHash: 'real', sessionId: 's1', seq: 1, ts: '2026-06-01T00:11:00Z' });
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });

        const sessions = await db.queryAll<{ session_id: string }>(
            'SELECT session_id FROM history_board_session_stats',
        );
        expect(sessions.map((s) => s.session_id)).toEqual(['s1']);
        const bucketSessions = await db.queryAll<{ session_id: string }>(
            'SELECT DISTINCT session_id FROM history_board_message_5m ORDER BY session_id',
        );
        expect(bucketSessions.map((s) => s.session_id)).toEqual(['s1', 'unknown']);
    });
});

describe('historyBoardSummaryFromRollup', () => {
    test('aggregates buckets, models, sources, tools, skills, and session count from rollups', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);

        const summary = await historyBoardSummaryFromRollup(db, ALL, '5m', 'model');
        expect(summary.sessions).toBe(2);
        expect(summary.toolCalls).toBe(3);
        expect(summary.toolErrors).toBe(1);
        expect(summary.tools.map((t) => t.toolName).sort()).toEqual(['Bash', 'Read', 'skill']);
        expect(summary.skills).toEqual([{ skillName: 'sp-code-testing', calls: 1 }]);
        expect(summary.models).toEqual([
            { key: 'gpt-5', freshInputTokens: 110, cacheReadTokens: 900, outputTokens: 55 },
            { key: 'gpt-5-mini', freshInputTokens: 40, cacheReadTokens: 0, outputTokens: 20 },
        ]);
        expect(summary.sources).toEqual([
            { key: 'claude', freshInputTokens: 150, cacheReadTokens: 900, outputTokens: 75 },
        ]);
        // Sub-day buckets re-floor the stored 5-minute start through datetime(): space-separated, no Z.
        expect(summary.buckets).toEqual([
            {
                bucketStart: '2026-06-01 09:55:00',
                key: 'gpt-5',
                freshInputTokens: 110,
                cacheReadTokens: 900,
                outputTokens: 55,
            },
            {
                bucketStart: '2026-06-01 10:05:00',
                key: 'gpt-5-mini',
                freshInputTokens: 40,
                cacheReadTokens: 0,
                outputTokens: 20,
            },
        ]);
    });

    test('skill dimension excludes empty skill names and groups by skill', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const summary = await historyBoardSummaryFromRollup(db, ALL, '5m', 'skill');
        // Skill series reads the live attribution query: each skill row carries the full
        // message tokens (links are counted after the skill predicate), matching the
        // un-refreshed path exactly.
        expect(summary.buckets).toEqual([
            {
                bucketStart: '2026-06-01 09:55:00',
                key: 'sp-code-testing',
                freshInputTokens: 100,
                cacheReadTokens: 900,
                outputTokens: 50,
            },
        ]);
    });

    test('tool filter switches aggregates to the tool read model; sessions keep counting sessions', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const summary = await historyBoardSummaryFromRollup(db, { ...ALL, tools: ['Bash'] }, '5m', 'model');
        // s2-a1 has exactly one tool, so it carries that message's full tokens.
        expect(summary.models).toEqual([
            { key: 'gpt-5-mini', freshInputTokens: 40, cacheReadTokens: 0, outputTokens: 20 },
        ]);
        expect(summary.sessions).toBe(1);
        expect(summary.tools).toEqual([{ toolName: 'Bash', calls: 1, errors: 1 }]);
    });

    test('sources and models filters narrow the 5m read model', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const summary = await historyBoardSummaryFromRollup(
            db,
            { ...ALL, sources: ['claude'], models: ['gpt-5'] },
            '5m',
            'model',
        );
        expect(summary.models).toEqual([
            { key: 'gpt-5', freshInputTokens: 110, cacheReadTokens: 900, outputTokens: 55 },
        ]);
        expect(summary.sessions).toBe(1);
    });

    test('skill filter matches the extracted skill name', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const summary = await historyBoardSummaryFromRollup(db, { ...ALL, skills: ['sp-code-testing'] }, '5m', 'model');
        expect(summary.models).toEqual([
            { key: 'gpt-5', freshInputTokens: 50, cacheReadTokens: 450, outputTokens: 25 },
        ]);
    });

    test('time bounds filter the 5m read model', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const summary = await historyBoardSummaryFromRollup(
            db,
            { ...ALL, since: '2026-06-01T10:00:00Z', until: '2026-06-01T10:10:00Z' },
            '5m',
            'model',
        );
        expect(summary.models).toEqual([
            { key: 'gpt-5-mini', freshInputTokens: 40, cacheReadTokens: 0, outputTokens: 20 },
        ]);
        expect(summary.sessions).toBe(1);
    });

    test('1d bucket without tool filters reads the bounded daily read model keyed by model', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const summary = await historyBoardSummaryFromRollup(db, ALL, '1d', 'model');
        expect(summary.buckets).toEqual([
            { bucketStart: '2026-06-01', key: 'gpt-5', freshInputTokens: 110, cacheReadTokens: 0, outputTokens: 0 },
            { bucketStart: '2026-06-02', key: 'gpt-5', freshInputTokens: 7, cacheReadTokens: 0, outputTokens: 0 },
        ]);
    });

    test('source and tool dimensions group by their own keys', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const bySource = await historyBoardSummaryFromRollup(db, ALL, '1d', 'source');
        expect(bySource.buckets.map((b) => b.key)).toEqual(['claude', 'claude']);
        const byTool = await historyBoardSummaryFromRollup(db, ALL, '5m', 'tool');
        expect(byTool.buckets.map((b) => `${b.bucketStart}|${b.key}`).sort()).toEqual([
            '2026-06-01 09:55:00|Read',
            '2026-06-01 09:55:00|skill',
            '2026-06-01 10:05:00|Bash',
        ]);
    });
});

describe('historyBoardSessionsFromRollup', () => {
    test('paginates and sorts; unknown sortBy falls back to started_at', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);

        const byTokens = await historyBoardSessionsFromRollup(db, ALL, {
            page: 1,
            pageSize: 1,
            sortBy: 'billedTokens',
            sortDir: 'desc',
        });
        expect(byTokens.total).toBe(2);
        expect(byTokens.items).toHaveLength(1);
        expect(byTokens.items[0]?.sessionId).toBe('s1'); // 165 billed vs 60

        const page2 = await historyBoardSessionsFromRollup(db, ALL, {
            page: 2,
            pageSize: 1,
            sortBy: 'bogus',
            sortDir: 'asc',
        });
        expect(page2.items[0]?.sessionId).toBe('s2'); // fallback sort: started_at ASC

        const full = await historyBoardSessionsFromRollup(db, ALL, {
            page: 1,
            pageSize: 10,
            sortBy: 'messages',
            sortDir: 'desc',
        });
        expect(full.items.map((s) => s.sessionId)).toEqual(['s1', 's2']);
        expect(full.items[0]).toMatchObject({
            source: 'claude',
            model: 'gpt-5',
            startedAt: '2026-06-01T09:58:00Z',
            endedAt: '2026-06-01T09:59:30Z',
            messages: 4,
            toolCalls: 2,
            errors: 0,
            freshInputTokens: 110,
            cacheReadTokens: 900,
            outputTokens: 55,
            assistantDurationMs: 4000,
            topTool: 'Read',
            state: 'complete',
        });
        expect(full.items[1]).toMatchObject({ sessionId: 's2', state: 'in-progress', topTool: 'Bash' });
    });

    test('tool filter keeps only sessions that used the tool', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const page = await historyBoardSessionsFromRollup(
            db,
            { ...ALL, tools: ['Bash'] },
            {
                page: 1,
                pageSize: 10,
                sortBy: 'start',
                sortDir: 'asc',
            },
        );
        expect(page.total).toBe(1);
        expect(page.items[0]?.sessionId).toBe('s2');
    });

    test('sources and models filters narrow session_stats', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const page = await historyBoardSessionsFromRollup(
            db,
            { ...ALL, sources: ['claude'], models: ['gpt-5-mini'] },
            {
                page: 1,
                pageSize: 10,
                sortBy: 'start',
                sortDir: 'asc',
            },
        );
        expect(page.total).toBe(1);
        expect(page.items[0]?.sessionId).toBe('s2');
    });
});

describe('historyBoardLoopsFromRollup', () => {
    test('returns seeded findings enriched with session dimensions', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const loops = await historyBoardLoopsFromRollup(db, ALL, 10);
        expect(loops).toEqual([
            {
                source: 'claude',
                sessionId: 's1',
                model: 'gpt-5',
                startedAt: '2026-06-01T09:58:00Z',
                toolName: 'Read',
                argsDigest: 'digest-a',
                repeats: 4,
                firstSeq: 1,
                lastSeq: 9,
            },
        ]);
        const bounded = await historyBoardLoopsFromRollup(db, { ...ALL, since: '2026-06-01T10:00:00Z' }, 10);
        expect(bounded).toEqual([]); // loop session started 09:58, outside the window
    });
});

describe('historyBoardRankedStepsFromRollup', () => {
    test('filters by kind and honors selector bounds', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const tokens = await historyBoardRankedStepsFromRollup(db, ALL, 'tokens', 10);
        expect(tokens).toEqual([
            {
                rank: 1,
                sessionId: 's1',
                source: 'claude',
                ts: '2026-06-01T00:10:00Z',
                model: 'gpt-5',
                inputTokens: 1500,
                cacheReadTokens: 0,
                outputTokens: 300,
                durationMs: null,
            },
            {
                rank: 2,
                sessionId: 's2',
                source: 'claude',
                ts: '2026-06-01T00:10:00Z',
                model: 'gpt-5-mini',
                inputTokens: 200,
                cacheReadTokens: 0,
                outputTokens: 0,
                durationMs: null,
            },
        ]);
        const bounded = await historyBoardRankedStepsFromRollup(
            db,
            { ...ALL, since: '2026-06-01T01:00:00Z' },
            'tokens',
            10,
        );
        expect(bounded).toEqual([]);
        expect(await historyBoardRankedStepsFromRollup(db, ALL, 'cache-waste', 10)).toEqual([
            {
                rank: 1,
                sessionId: 's1',
                source: 'claude',
                ts: '2026-06-01T00:10:00Z',
                model: 'gpt-5',
                inputTokens: 0,
                cacheReadTokens: 5000,
                outputTokens: 0,
                durationMs: null,
            },
        ]);
    });

    test('sources, models, and until filters narrow ranked steps', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const rows = await historyBoardRankedStepsFromRollup(
            db,
            { ...ALL, sources: ['claude'], models: ['gpt-5'], until: '2026-06-01T00:15:00Z' },
            'tokens',
            10,
        );
        expect(rows).toEqual([
            {
                rank: 1,
                sessionId: 's1',
                source: 'claude',
                ts: '2026-06-01T00:10:00Z',
                model: 'gpt-5',
                inputTokens: 1500,
                cacheReadTokens: 0,
                outputTokens: 300,
                durationMs: null,
            },
        ]);
    });
});

describe('historyBoardHeavySessionsFromRollup', () => {
    test('orders by billed tokens descending with a limit', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const heavy = await historyBoardHeavySessionsFromRollup(db, ALL, 1);
        expect(heavy.map((s) => s.sessionId)).toEqual(['s1']);
        expect(heavy[0]).toMatchObject({ freshInputTokens: 110, outputTokens: 55 });
    });
});

describe('historyBoardModelComparisonFromRollup', () => {
    test('all-time path reads model_stats and computes axes with null-safe guards', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const rows = await historyBoardModelComparisonFromRollup(db, ALL);
        expect(rows).toEqual([
            {
                model: 'gpt-5',
                speedMsMean: 4000, // 4000ms / 1 sample
                cacheRatio: 900 / 1010,
                reliability: 1, // 0 errors of 2 calls
                outputRatio: 55 / 165,
            },
            {
                model: 'gpt-5-mini',
                speedMsMean: 2000,
                cacheRatio: 0,
                reliability: 0, // 1 error of 1 call
                outputRatio: 20 / 60,
            },
        ]);
    });

    test('filtered path recomputes from 5m read models', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const rows = await historyBoardModelComparisonFromRollup(db, { ...ALL, since: '2026-06-01T10:00:00Z' });
        expect(rows).toEqual([
            {
                model: 'gpt-5-mini',
                speedMsMean: 2000,
                cacheRatio: 0,
                reliability: 0,
                outputRatio: 20 / 60,
            },
        ]);
    });

    test('all-time path with a models filter still reads model_stats', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const rows = await historyBoardModelComparisonFromRollup(db, { ...ALL, models: ['gpt-5-mini'] });
        expect(rows).toEqual([
            {
                model: 'gpt-5-mini',
                speedMsMean: 2000,
                cacheRatio: 0,
                reliability: 0,
                outputRatio: 20 / 60,
            },
        ]);
    });
});

describe('historyBoardSourcesFromRollup', () => {
    test('returns source cards, a bounded daily window, and database bytes', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const { sources, daily, databaseBytes } = await historyBoardSourcesFromRollup(db, 90);
        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatchObject({
            source: 'claude',
            files: 2,
            messages: 7,
            lastImportedAt: '2026-06-02T00:00:00Z',
            sessions: 2,
            toolCalls: 3,
            firstDate: '2026-06-01T09:58:00Z',
            lastDate: '2026-06-01T10:05:30Z',
        });
        expect(sources[0]?.freshInputTokens).toBe(150);
        expect(daily).toEqual([
            {
                source: 'claude',
                day: '2026-06-01',
                freshInputTokens: 150,
                cacheReadTokens: 900,
                outputTokens: 75,
                sessions: 2,
                toolCalls: 3,
            },
        ]);
        expect(databaseBytes).toBeGreaterThan(0);
    });

    test('daily window is bounded by the requested day count', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        // Seeded daily rows are on 2026-06-01/02; a 0-day window anchored at now excludes them.
        const { daily } = await historyBoardSourcesFromRollup(db, 0);
        expect(daily).toEqual([]);
    });
});

describe('historyBoardDatabaseBytes', () => {
    test('returns page_count * page_size of the backing database', async () => {
        const db = await setup();
        const bytes = await historyBoardDatabaseBytes(db);
        expect(Number.isInteger(bytes)).toBe(true);
        expect(bytes).toBeGreaterThan(0);
    });
});

describe('historyBoardKpiTrendFromRollup', () => {
    test('aggregates per-day tokens, distinct sessions, and tool calls ascending', async () => {
        const db = await setup();
        // Day 1: sessions k1 (with tool) and k2. Day 2: k1 continues. Day 3: k3 on another model.
        await insertMessage(db, {
            recordHash: 'k-a1',
            sessionId: 'k1',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            model: 'gpt-5',
            input: 100,
            cacheRead: 300,
            output: 50,
            durationMs: 1000,
        });
        await insertToolCall(db, {
            recordHash: 'k-t1',
            messageHash: 'k-a1',
            sessionId: 'k1',
            seq: 1,
            toolName: 'Read',
        });
        await insertMessage(db, {
            recordHash: 'k-a2',
            sessionId: 'k2',
            seq: 1,
            ts: '2026-06-01T11:00:00Z',
            model: 'gpt-5',
            input: 10,
            output: 5,
        });
        await insertMessage(db, {
            recordHash: 'k-a3',
            sessionId: 'k1',
            seq: 2,
            ts: '2026-06-02T09:00:00Z',
            model: 'gpt-5',
            input: 20,
            cacheRead: 80,
            output: 10,
        });
        await insertMessage(db, {
            recordHash: 'k-a4',
            sessionId: 'k3',
            seq: 1,
            ts: '2026-06-03T12:00:00Z',
            model: 'gpt-5-mini',
            input: 5,
            output: 5,
        });
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });

        const rows = await historyBoardKpiTrendFromRollup(db, ALL);
        expect(rows).toEqual([
            {
                day: '2026-06-01',
                freshInputTokens: 110,
                outputTokens: 55,
                cacheReadTokens: 300,
                sessions: 2,
                toolCalls: 1,
            },
            {
                day: '2026-06-02',
                freshInputTokens: 20,
                outputTokens: 10,
                cacheReadTokens: 80,
                sessions: 1,
                toolCalls: 0,
            },
            { day: '2026-06-03', freshInputTokens: 5, outputTokens: 5, cacheReadTokens: 0, sessions: 1, toolCalls: 0 },
        ]);
    });
    test('preserves model and tool selectors', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'k-b1',
            sessionId: 'k1',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            model: 'gpt-5',
            input: 100,
            cacheRead: 300,
            output: 50,
        });
        await insertToolCall(db, {
            recordHash: 'k-bt1',
            messageHash: 'k-b1',
            sessionId: 'k1',
            seq: 1,
            toolName: 'Read',
        });
        await insertMessage(db, {
            recordHash: 'k-b2',
            sessionId: 'k2',
            seq: 1,
            ts: '2026-06-02T10:00:00Z',
            model: 'gpt-5-mini',
            input: 10,
            output: 5,
        });
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });

        const byModel = await historyBoardKpiTrendFromRollup(db, { ...ALL, models: ['gpt-5'] });
        expect(byModel).toEqual([
            {
                day: '2026-06-01',
                freshInputTokens: 100,
                outputTokens: 50,
                cacheReadTokens: 300,
                sessions: 1,
                toolCalls: 1,
            },
        ]);

        const byTool = await historyBoardKpiTrendFromRollup(db, { ...ALL, tools: ['Read'] });
        expect(byTool.map((row) => row.day)).toEqual(['2026-06-01']);
        expect(byTool[0]).toMatchObject({ freshInputTokens: 100, cacheReadTokens: 300, toolCalls: 1 });
    });

    test('bounded since/until window only includes covered days', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'k-c1',
            sessionId: 'k1',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            model: 'gpt-5',
            input: 10,
            output: 5,
        });
        await insertMessage(db, {
            recordHash: 'k-c2',
            sessionId: 'k1',
            seq: 2,
            ts: '2026-06-02T10:00:00Z',
            model: 'gpt-5',
            input: 20,
            output: 10,
        });
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });

        const rows = await historyBoardKpiTrendFromRollup(db, {
            ...ALL,
            since: '2026-06-02T00:00:00Z',
            until: '2026-06-02T23:59:59Z',
        });
        expect(rows).toEqual([
            {
                day: '2026-06-02',
                freshInputTokens: 20,
                outputTokens: 10,
                cacheReadTokens: 0,
                sessions: 1,
                toolCalls: 0,
            },
        ]);
    });
});
