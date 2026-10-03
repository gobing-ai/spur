import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyHistoryImportSchema, HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import type { MessageRollupRow, StepRow, ToolRollupRow } from '../../src/analytics/forensic-query';
import { bucketedTokenSeries } from '../../src/analytics/forensic-query';
import {
    type HistoryBoardRollupSeed,
    historyBoardDatabaseBytes,
    historyBoardHeavySessionsFromRollup,
    historyBoardHistoryVersion,
    historyBoardKpiTrendFromRollup,
    historyBoardLoopsFromRollup,
    historyBoardModelComparisonFromRollup,
    historyBoardRankedStepsFromRollup,
    historyBoardRollupsFresh,
    historyBoardSessionsFromRollup,
    historyBoardSkillBreakdownFromRollup,
    historyBoardSourcesFromRollup,
    historyBoardSummaryFromRollup,
    ROLLUP_SOURCE_TABLES,
    refreshHistoryBoardRollupsIncremental,
    replaceHistoryBoardRollups,
    skillCallRollup,
} from '../../src/analytics/history-board-rollup';
import {
    ROLLUP_DEFINITION_VERSION,
    readRollupWatermarks,
    writeRollupWatermark,
} from '../../src/analytics/rollup-watermark';
import { applyCliMigrations } from '../../src/migrations';

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
        assistantDurationSamples: 0,
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

describe('historyBoardRollupsFresh (task 0741)', () => {
    test('fresh only when every rollup watermark covers the newest imported row and version matches', async () => {
        const db = await setup();
        expect(await historyBoardRollupsFresh(db)).toBe(false);
        // A full rebuild records the per-table watermarks → the corpus is fresh.
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });
        expect(await historyBoardRollupsFresh(db)).toBe(true);
        // A message imported at a later cursor makes every table stale again.
        await insertMessage(db, {
            recordHash: 'm2',
            sessionId: 's1',
            seq: 2,
            ts: '2026-06-01T02:00:00Z',
            importedAt: '2026-06-01T04:00:00Z',
        });
        expect(await historyBoardRollupsFresh(db)).toBe(false);
    });
});

describe('replaceHistoryBoardRollups', () => {
    test('materializes every read model and replaces prior contents on re-run', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);

        // message_5m: bucket flooring to 60s (09:58 and 09:59 are distinct 1m buckets).
        const buckets = await db.queryAll<{ bucket_start: string; session_id: string; messages: number }>(
            `SELECT bucket_start, session_id, messages FROM history_board_message_5m
             ORDER BY bucket_start, session_id`,
        );
        expect(buckets).toEqual([
            { bucket_start: '2026-06-01T09:58:00Z', session_id: 's1', messages: 2 },
            { bucket_start: '2026-06-01T09:59:00Z', session_id: 's1', messages: 2 },
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

    test('drops re-imported duplicates: only the final row of a request_id group is measured (task 0624 R1)', async () => {
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
        // A streaming response re-emits rows while it streams; the FINAL row (MAX rowid) carries
        // the complete cumulative usage, so dedup keeps dup-2 (999) and drops the partial dup-1 (100).
        expect(rows).toEqual([
            { bucket_start: '2026-06-01T11:01:00Z', messages: 1, fresh_input_tokens: 999 },
            { bucket_start: '2026-06-01T11:02:00Z', messages: 1, fresh_input_tokens: 7 },
        ]);
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
        const rows = await db.queryAll<{
            tool_name: string;
            fresh_input_tokens_alloc: number;
            output_tokens_alloc: number;
        }>(
            `SELECT tool_name, fresh_input_tokens_alloc, output_tokens_alloc FROM history_board_tool_5m ORDER BY tool_name`,
        );
        expect(rows).toHaveLength(4);
        for (const row of rows) {
            expect(row.fresh_input_tokens_alloc).toBe(25); // 100 / 4 tools
            expect(row.output_tokens_alloc).toBe(12.5); // 50 / 4 tools
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
                calls: 4,
            },
            {
                bucketStart: '2026-06-01 10:05:00',
                key: 'gpt-5-mini',
                freshInputTokens: 40,
                cacheReadTokens: 0,
                outputTokens: 20,
                calls: 2,
            },
        ]);

        // 1m bucket interval test: outputs granular per-minute buckets from the 1m base rollup
        const summary1m = await historyBoardSummaryFromRollup(db, ALL, '1m', 'model');
        expect(summary1m.buckets).toEqual([
            {
                bucketStart: '2026-06-01 09:58:00',
                key: 'gpt-5',
                freshInputTokens: 100,
                cacheReadTokens: 900,
                outputTokens: 50,
                calls: 2,
            },
            {
                bucketStart: '2026-06-01 09:59:00',
                key: 'gpt-5',
                freshInputTokens: 10,
                cacheReadTokens: 0,
                outputTokens: 5,
                calls: 2,
            },
            {
                bucketStart: '2026-06-01 10:05:00',
                key: 'gpt-5-mini',
                freshInputTokens: 40,
                cacheReadTokens: 0,
                outputTokens: 20,
                calls: 2,
            },
        ]);

        // 3m bucket interval test: aggregates into 3-minute buckets (09:58 and 09:59 floor to 09:57)
        const summary3m = await historyBoardSummaryFromRollup(db, ALL, '3m', 'model');
        expect(summary3m.buckets).toEqual([
            {
                bucketStart: '2026-06-01 09:57:00',
                key: 'gpt-5',
                freshInputTokens: 110,
                cacheReadTokens: 900,
                outputTokens: 55,
                calls: 4,
            },
            {
                bucketStart: '2026-06-01 10:03:00',
                key: 'gpt-5-mini',
                freshInputTokens: 40,
                cacheReadTokens: 0,
                outputTokens: 20,
                calls: 2,
            },
        ]);
    });

    test('skill dimension excludes empty skill names and groups by skill', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const summary = await historyBoardSummaryFromRollup(db, ALL, '5m', 'skill');
        // Canonical allocation: the message's tokens divide across BOTH linked tool calls
        // (Read + skill), and the skill row is selected after that division.
        expect(summary.buckets).toEqual([
            {
                bucketStart: '2026-06-01 09:55:00',
                key: 'sp-code-testing',
                freshInputTokens: 50,
                cacheReadTokens: 450,
                outputTokens: 25,
                calls: 1,
            },
        ]);
    });

    test('skill series from the rollup is numerically equal to the aligned live fallback on a mixed tool/skill message', async () => {
        const db = await setup();
        await seedCorpusAndRefresh(db);
        const rollup = await historyBoardSummaryFromRollup(db, ALL, '5m', 'skill');
        const live = await bucketedTokenSeries(db, ALL, '5m', 'skill');
        expect(rollup.buckets).toEqual(live);
        // Both exclude blank skill names: only the sp-code-testing row exists.
        expect(rollup.buckets.map((b) => b.key)).toEqual(['sp-code-testing']);
        // Mixed message s1-a1 has 2 tool calls, so the skill row carries half its tokens.
        expect(rollup.buckets[0]).toMatchObject({ freshInputTokens: 50, outputTokens: 25 });
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
        expect(summary.tools).toEqual([{ toolName: 'Bash', calls: 1, errors: 1, durationMs: 0, billedTokens: 60 }]);
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

    test('codex messages without individual model inherit model from session_meta in rollups', async () => {
        const db = await setup();
        // Seed session_meta with model='gpt-5-codex' and assistant message with model=null
        await insertMessage(db, {
            recordHash: 'codex_meta',
            sessionId: 'sess_codex_1',
            seq: 1,
            role: 'meta',
            disposition: 'meta',
            ts: '2026-06-01T11:00:00Z',
            model: 'gpt-5-codex',
        });
        await insertMessage(db, {
            recordHash: 'codex_asst',
            sessionId: 'sess_codex_1',
            seq: 2,
            role: 'assistant',
            disposition: 'conversation',
            ts: '2026-06-01T11:01:00Z',
            model: null,
            input: 500,
            output: 100,
            cacheRead: 2000,
            durationMs: 1500,
        });
        await replaceHistoryBoardRollups(db, {
            ...EMPTY_SEED,
            historyVersion: await historyBoardHistoryVersion(db),
        });

        const summary = await historyBoardSummaryFromRollup(db, ALL, '5m', 'model');
        const codexBucket = summary.buckets.find((b) => b.key === 'gpt-5-codex');
        expect(codexBucket).toBeDefined();
        expect(codexBucket?.freshInputTokens).toBe(500);
        expect(codexBucket?.outputTokens).toBe(100);
        expect(codexBucket?.cacheReadTokens).toBe(2000);

        // Ensure no 'unknown' model bucket was created for this session
        const unknownBucket = summary.buckets.find((b) => b.key === 'unknown');
        expect(unknownBucket).toBeUndefined();

        // Check model breakdown
        const codexModel = summary.models.find((m) => m.key === 'gpt-5-codex');
        expect(codexModel).toBeDefined();
        expect(codexModel?.freshInputTokens).toBe(500);
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
            {
                bucketStart: '2026-06-01',
                key: 'gpt-5',
                freshInputTokens: 110,
                cacheReadTokens: 0,
                outputTokens: 0,
                calls: 4,
            },
            {
                bucketStart: '2026-06-02',
                key: 'gpt-5',
                freshInputTokens: 7,
                cacheReadTokens: 0,
                outputTokens: 0,
                calls: 1,
            },
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
        // Seed days are pinned at 2026-06-01; a 90-day now-anchored window scrolls past them as
        // the calendar advances (this broke on 2026-08-31). Bounding itself is covered by the
        // 0-day test below, so use a century-wide window to keep this test clock-independent.
        const { sources, daily, databaseBytes } = await historyBoardSourcesFromRollup(db, 36500);
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

    test('tool name is recovered from args_raw / call_id when blank, and unresolved tools are accepted as unknown', async () => {
        const db = await setup();
        await insertMessage(db, {
            recordHash: 'tool-msg-1',
            sessionId: 'tool-sess-1',
            seq: 1,
            ts: '2026-06-01T10:00:00Z',
            model: 'gpt-5',
            input: 100,
            output: 50,
        });
        await insertToolCall(db, {
            recordHash: 'tc-valid',
            messageHash: 'tool-msg-1',
            sessionId: 'tool-sess-1',
            seq: 1,
            toolName: 'Read',
        });
        await insertToolCall(db, {
            recordHash: 'tc-recovered-args',
            messageHash: 'tool-msg-1',
            sessionId: 'tool-sess-1',
            seq: 2,
            toolName: '',
            argsRaw: JSON.stringify({ tool_name: 'custom_query', query: 'SELECT 1' }),
        });
        await insertToolCall(db, {
            recordHash: 'tc-recovered-callid',
            messageHash: 'tool-msg-1',
            sessionId: 'tool-sess-1',
            seq: 3,
            toolName: '   ',
            argsRaw: null,
        });
        // Update call_id directly on tc-recovered-callid
        await db.run(
            "UPDATE history_tool_call SET call_id = 'call_bash_999' WHERE record_hash = 'tc-recovered-callid'",
        );

        await insertToolCall(db, {
            recordHash: 'tc-unresolved',
            messageHash: 'tool-msg-1',
            sessionId: 'tool-sess-1',
            seq: 4,
            toolName: '',
            argsRaw: null,
        });
        await replaceHistoryBoardRollups(db, { ...EMPTY_SEED, historyVersion: 'v2:test' });

        const summary = await historyBoardSummaryFromRollup(db, ALL, '5m', 'tool');
        const toolNames = summary.tools.map((t) => t.toolName).sort();
        expect(toolNames).toEqual(['Read', 'bash', 'custom_query', 'unknown'].sort());

        const tool5m = await db.queryAll<{ tool_name: string }>('SELECT DISTINCT tool_name FROM history_board_tool_5m');
        expect(tool5m.map((t) => t.tool_name).sort()).toEqual(['Read', 'bash', 'custom_query', 'unknown'].sort());

        const sess = await db.queryFirst<{ top_tool: string }>(
            'SELECT top_tool FROM history_board_session_stats WHERE session_id = ?',
            'tool-sess-1',
        );
        expect(sess?.top_tool).not.toBeNull();
        expect(['Read', 'bash', 'custom_query']).toContain(sess?.top_tool ?? '');
    });
});

/** A seeded history_skill_call row. Class fields default to the pre-1029 legacy shape. */
interface SkillCall {
    recordHash: string;
    source: string;
    sessionId: string;
    seq: number;
    skillName: string;
    invocationKind: 'user' | 'model';
    startedAt: string;
    status?: string | null;
    capabilityKind?: string | null;
    evidenceKind?: string | null;
    invocationId?: string | null;
}

async function insertSkillCall(db: DbAdapter, s: SkillCall): Promise<void> {
    await db.run(
        `INSERT INTO history_skill_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, skill_name, invocation_kind, status, started_at, imported_at,
             capability_kind, evidence_kind, invocation_id)
         VALUES (?, ?, ?, 'test.jsonl', 1, ?, ?, ?, ?, ?, ?, '2026-06-01T00:00:00Z', ?, ?, ?)`,
        s.recordHash,
        s.recordHash,
        s.source,
        s.sessionId,
        s.seq,
        s.skillName,
        s.invocationKind,
        s.status ?? 'success',
        s.startedAt,
        s.capabilityKind ?? null,
        s.evidenceKind ?? null,
        s.invocationId ?? null,
    );
}

describe('history_board_skill_5m / skillCallRollup (task 0737)', () => {
    test('skillCallRollup buckets started_at to the minute floor and counts per key', async () => {
        const db = await setup();
        await insertSkillCall(db, {
            recordHash: 'sk1',
            source: 'claude',
            sessionId: 's1',
            seq: 1,
            skillName: 'sp-code-testing',
            invocationKind: 'model',
            startedAt: '2026-06-01T09:58:10Z',
        });
        await insertSkillCall(db, {
            recordHash: 'sk2',
            source: 'claude',
            sessionId: 's1',
            seq: 2,
            skillName: 'sp-code-testing',
            invocationKind: 'user',
            startedAt: '2026-06-01T09:58:40Z',
        });
        await insertSkillCall(db, {
            recordHash: 'sk3',
            source: 'codex',
            sessionId: 's2',
            seq: 1,
            skillName: 'sp-sys-debugging',
            invocationKind: 'model',
            startedAt: '2026-06-01T10:05:00Z',
        });
        const rows = await skillCallRollup(db);
        // Legacy rows (null class columns, non-'ok'/'error' status) materialize with the ''
        // sentinels and class status 'unknown' — the E93 measure, not the pre-1029 raw count.
        expect(rows).toEqual([
            {
                bucketStart: '2026-06-01T09:58:00Z',
                source: 'claude',
                skillName: 'sp-code-testing',
                invocationKind: 'model',
                capabilityKind: '',
                evidenceKind: '',
                status: 'unknown',
                calls: 1,
            },
            {
                bucketStart: '2026-06-01T09:58:00Z',
                source: 'claude',
                skillName: 'sp-code-testing',
                invocationKind: 'user',
                capabilityKind: '',
                evidenceKind: '',
                status: 'unknown',
                calls: 1,
            },
            {
                bucketStart: '2026-06-01T10:05:00Z',
                source: 'codex',
                skillName: 'sp-sys-debugging',
                invocationKind: 'model',
                capabilityKind: '',
                evidenceKind: '',
                status: 'unknown',
                calls: 1,
            },
        ]);
    });

    test('replaceHistoryBoardRollups materializes history_board_skill_5m, and a re-analyze is idempotent', async () => {
        const db = await setup();
        const seed: HistoryBoardRollupSeed = {
            historyVersion: 'v2:test',
            messageRows: [],
            toolRows: [],
            loopRows: [],
            sourceRows: [],
            tokenSteps: [],
            durationSteps: [],
            cacheWasteSteps: [],
            skill5m: [
                {
                    bucketStart: '2026-06-01T09:58:00Z',
                    source: 'claude',
                    skillName: 'sp-code-testing',
                    invocationKind: 'model',
                    capabilityKind: '',
                    evidenceKind: '',
                    status: '',
                    calls: 2,
                },
                {
                    bucketStart: '2026-06-01T09:58:00Z',
                    source: 'claude',
                    skillName: 'sp-code-testing',
                    invocationKind: 'user',
                    capabilityKind: '',
                    evidenceKind: '',
                    status: '',
                    calls: 1,
                },
                {
                    bucketStart: '2026-06-01T10:05:00Z',
                    source: 'codex',
                    skillName: 'sp-sys-debugging',
                    invocationKind: 'model',
                    capabilityKind: '',
                    evidenceKind: '',
                    status: '',
                    calls: 1,
                },
            ],
        };
        // Exact shape pins the v7 grain INCLUDING the '' sentinels: this seed is the
        // passthrough path (verbatim replay), so pre-classification rows keep '' for
        // capability/evidence/status (schema defaults; migration 0050 copies the same) —
        // distinct from the compute path, whose CASE ELSE materializes 'unknown'.
        await replaceHistoryBoardRollups(db, seed);
        const first = await db.queryAll<{
            bucket_start: string;
            source: string;
            skill_name: string;
            invocation_kind: string;
            capability_kind: string;
            evidence_kind: string;
            status: string;
            calls: number;
        }>('SELECT * FROM history_board_skill_5m ORDER BY bucket_start, source, skill_name, invocation_kind');
        expect(first).toEqual([
            {
                bucket_start: '2026-06-01T09:58:00Z',
                source: 'claude',
                skill_name: 'sp-code-testing',
                invocation_kind: 'model',
                capability_kind: '',
                evidence_kind: '',
                status: '',
                calls: 2,
            },
            {
                bucket_start: '2026-06-01T09:58:00Z',
                source: 'claude',
                skill_name: 'sp-code-testing',
                invocation_kind: 'user',
                capability_kind: '',
                evidence_kind: '',
                status: '',
                calls: 1,
            },
            {
                bucket_start: '2026-06-01T10:05:00Z',
                source: 'codex',
                skill_name: 'sp-sys-debugging',
                invocation_kind: 'model',
                capability_kind: '',
                evidence_kind: '',
                status: '',
                calls: 1,
            },
        ]);
        // Freshness rides the shared meta row (covered by historyBoardRollupsFresh tests).

        // Re-run with the same seed is a full replace, never an append.
        await replaceHistoryBoardRollups(db, { ...seed, historyVersion: 'v2:test' });
        const second = await db.queryAll<{ record: number }>('SELECT COUNT(*) AS record FROM history_board_skill_5m');
        expect(second).toEqual([{ record: 3 }]);
    });

    test('historyBoardSkillBreakdownFromRollup returns per-skill/source/invocation counts and a trend over the window', async () => {
        const db = await setup();
        await replaceHistoryBoardRollups(db, {
            historyVersion: 'v2:test',
            messageRows: [],
            toolRows: [],
            loopRows: [],
            sourceRows: [],
            tokenSteps: [],
            durationSteps: [],
            cacheWasteSteps: [],
            // All seeds are confirmed loads (E93 1029): the legacy arrays count only
            // evidence_kind='load' AND status='ok' rows.
            skill5m: [
                {
                    bucketStart: '2026-06-01T09:58:00Z',
                    source: 'claude',
                    skillName: 'sp-code-testing',
                    invocationKind: 'model',
                    capabilityKind: '',
                    evidenceKind: 'load',
                    status: 'ok',
                    calls: 2,
                },
                {
                    bucketStart: '2026-06-01T09:58:00Z',
                    source: 'claude',
                    skillName: 'sp-code-testing',
                    invocationKind: 'user',
                    capabilityKind: '',
                    evidenceKind: 'load',
                    status: 'ok',
                    calls: 1,
                },
                {
                    bucketStart: '2026-06-01T10:05:00Z',
                    source: 'codex',
                    skillName: 'sp-sys-debugging',
                    invocationKind: 'model',
                    capabilityKind: '',
                    evidenceKind: 'load',
                    status: 'ok',
                    calls: 1,
                },
                {
                    bucketStart: '2026-06-01T10:05:00Z',
                    source: 'codex',
                    skillName: 'unknown',
                    invocationKind: 'model',
                    capabilityKind: '',
                    evidenceKind: 'load',
                    status: 'ok',
                    calls: 4,
                },
                {
                    bucketStart: '2026-06-01T10:05:00Z',
                    source: 'codex',
                    skillName: '',
                    invocationKind: 'model',
                    capabilityKind: '',
                    evidenceKind: 'load',
                    status: 'ok',
                    calls: 2,
                },
            ],
        });
        const breakdown = await historyBoardSkillBreakdownFromRollup(db, ALL, '5m');
        // Empty / 'unknown' skill names are excluded from bySkill (mirrors the parallel skill
        // query); they still count toward bySource / byInvocationKind.
        expect(breakdown.bySkill).toEqual([
            { skillName: 'sp-code-testing', calls: 3 },
            { skillName: 'sp-sys-debugging', calls: 1 },
        ]);
        expect(breakdown.bySource).toEqual([
            { source: 'codex', calls: 7 },
            { source: 'claude', calls: 3 },
        ]);
        expect(breakdown.byInvocationKind).toEqual([
            { invocationKind: 'model', calls: 9 },
            { invocationKind: 'user', calls: 1 },
        ]);
        // byCapability carries the classified dimension — the '' capability kind reads as
        // null (unclassified); empty/'unknown' skill names stay excluded like bySkill.
        expect(breakdown.byCapability).toEqual([
            {
                skillName: 'sp-code-testing',
                capabilityKind: null,
                invocationKind: 'model',
                evidenceKind: 'load',
                status: 'ok',
                calls: 2,
            },
            {
                skillName: 'sp-code-testing',
                capabilityKind: null,
                invocationKind: 'user',
                evidenceKind: 'load',
                status: 'ok',
                calls: 1,
            },
            {
                skillName: 'sp-sys-debugging',
                capabilityKind: null,
                invocationKind: 'model',
                evidenceKind: 'load',
                status: 'ok',
                calls: 1,
            },
        ]);
        // Trend is a 5m re-bucketed call-count series.
        expect(breakdown.trend).toEqual([
            {
                bucketStart: '2026-06-01 09:55:00',
                key: 'sp-code-testing',
                calls: 3,
                freshInputTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 0,
            },
            {
                bucketStart: '2026-06-01 10:05:00',
                key: 'sp-sys-debugging',
                calls: 1,
                freshInputTokens: 0,
                cacheReadTokens: 0,
                outputTokens: 0,
            },
        ]);
    });

    test('skill breakdown honors the window and source selectors and returns empty when no skill rows', async () => {
        const db = await setup();
        await replaceHistoryBoardRollups(db, {
            historyVersion: 'v2:test',
            messageRows: [],
            toolRows: [],
            loopRows: [],
            sourceRows: [],
            tokenSteps: [],
            durationSteps: [],
            cacheWasteSteps: [],
            skill5m: [
                {
                    bucketStart: '2026-06-01T09:58:00Z',
                    source: 'claude',
                    skillName: 'sp-code-testing',
                    invocationKind: 'model',
                    capabilityKind: '',
                    evidenceKind: 'load',
                    status: 'ok',
                    calls: 2,
                },
            ],
        });
        // Window excludes the seeded bucket.
        const empty = await historyBoardSkillBreakdownFromRollup(db, { ...ALL, since: '2026-06-02T00:00:00Z' }, '5m');
        expect(empty.bySkill).toEqual([]);
        expect(empty.trend).toEqual([]);
        // Source selector keeps only that agent.
        const claudeOnly = await historyBoardSkillBreakdownFromRollup(db, { ...ALL, sources: ['claude'] }, '5m');
        expect(claudeOnly.bySource).toEqual([{ source: 'claude', calls: 2 }]);

        // Zero skill rows never crashes; returns empty arrays.
        const zeroDb = await setup();
        await replaceHistoryBoardRollups(zeroDb, {
            historyVersion: 'v2:test',
            messageRows: [],
            toolRows: [],
            loopRows: [],
            sourceRows: [],
            tokenSteps: [],
            durationSteps: [],
            cacheWasteSteps: [],
        });
        const zero = await historyBoardSkillBreakdownFromRollup(zeroDb, ALL, '5m');
        expect(zero).toEqual({
            bySkill: [],
            bySource: [],
            byInvocationKind: [],
            byCapability: [],
            trend: [],
        });
    });
});

describe('ROLLUP_SOURCE_TABLES schema guard (0738 R2)', () => {
    test('matches raw source tables referenced in refresh statements', () => {
        expect([...ROLLUP_SOURCE_TABLES].sort()).toEqual([
            'history_message',
            'history_skill_call',
            'history_tool_call',
        ]);
    });

    test('every rollup source table exists in the schema produced by Spur migrations + importer schema', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyHistoryImportSchema(db);
        await applyCliMigrations(db);

        const rows = await db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
        const existingTables = new Set(rows.map((r) => r.name));

        for (const table of ROLLUP_SOURCE_TABLES) {
            expect(existingTables.has(table)).toBe(true);
        }

        db.close();
    });

    test('schema guard fails naming the offending table when a referenced table is absent', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await db.exec('CREATE TABLE history_message (record_hash TEXT PRIMARY KEY)');
        await db.exec('CREATE TABLE history_tool_call (record_hash TEXT PRIMARY KEY)');

        const rows = await db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
        const existingTables = new Set(rows.map((r) => r.name));

        function assertSourceTables(tables: readonly string[]): void {
            for (const table of tables) {
                if (!existingTables.has(table)) {
                    throw new Error(`Referenced rollup source table absent from schema: ${table}`);
                }
            }
        }

        expect(() => assertSourceTables(ROLLUP_SOURCE_TABLES)).toThrow(
            'Referenced rollup source table absent from schema: history_skill_call',
        );

        db.close();
    });
});

describe('measure vector additivity invariant (0740 R4/R6/R7)', () => {
    async function columnNames(db: DbAdapter, table: string): Promise<string[]> {
        const rows = await db.queryAll<{ name: string }>(`PRAGMA table_info(${table})`);
        return rows.map((r) => r.name);
    }

    test('no aggregate column stores a rate, ratio, percentage, or mean (R6)', async () => {
        const db = await setup();
        const ratePattern = /(_rate|_ratio|_pct|_percent|_percentage|_mean|_avg|_average)$/i;
        for (const table of [
            'history_daily_stats',
            'history_board_message_5m',
            'history_board_tool_5m',
            'history_board_session_stats',
            'history_board_model_stats',
            'history_board_tool_stats',
            'history_board_source_stats',
            'history_board_source_daily',
        ]) {
            const cols = await columnNames(db, table);
            for (const col of cols) {
                expect({ table, col }).not.toMatchObject({ col: expect.stringMatching(ratePattern) });
            }
        }
        db.close();
    });

    test('every duration sum has a co-located sample count; calls serves the tool grain (R4)', async () => {
        const db = await setup();
        for (const table of [
            'history_daily_stats',
            'history_board_message_5m',
            'history_board_tool_5m',
            'history_board_session_stats',
            'history_board_model_stats',
            'history_board_tool_stats',
        ]) {
            const cols = await columnNames(db, table);
            const hasDurationSum = cols.some((c) => c === 'assistant_duration_ms' || c === 'duration_ms');
            if (!hasDurationSum) continue;
            const hasSamples = cols.includes('assistant_duration_samples');
            const hasCalls = cols.includes('calls');
            expect({ table, hasSamples, hasCalls, cols }).toSatisfy((v) => v.hasSamples || v.hasCalls);
        }
        db.close();
    });

    test('excluded per-row / metadata tables carry no measure-vector columns (R7)', async () => {
        const db = await setup();
        for (const table of [
            'history_board_ranked_steps',
            'history_board_loop_findings',
            'history_board_rollup_meta',
            'history_board_skill_5m',
        ]) {
            const cols = await columnNames(db, table);
            expect(cols.filter((c) => /cache_write_tokens|_alloc|_samples/.test(c))).toStrictEqual([]);
        }
        db.close();
    });

    test('cache_write_tokens is stored on every table carrying token measures (R1)', async () => {
        const db = await setup();
        for (const table of [
            'history_daily_stats',
            'history_board_message_5m',
            'history_board_session_stats',
            'history_board_model_stats',
            'history_board_source_stats',
            'history_board_source_daily',
        ]) {
            const cols = await columnNames(db, table);
            expect(cols).toContain('cache_write_tokens');
        }
        for (const table of ['history_board_tool_5m', 'history_board_tool_stats']) {
            const cols = await columnNames(db, table);
            expect(cols).toContain('cache_write_tokens_alloc');
        }
        db.close();
    });

    test('allocated token columns carry a distinct _alloc name (R5)', async () => {
        const db = await setup();
        for (const table of ['history_board_tool_5m', 'history_board_tool_stats']) {
            const cols = await columnNames(db, table);
            for (const base of ['fresh_input_tokens', 'cache_read_tokens', 'output_tokens']) {
                const alloc = `${base}_alloc`;
                expect(cols).toContain(alloc);
                expect(cols).not.toContain(base);
            }
        }
        db.close();
    });
});

/** Incremental engine corpus: two messages in two buckets on 2026-06-01, imported at 05:00Z. */
async function seedIncrementalCorpus(db: DbAdapter): Promise<void> {
    await insertMessage(db, {
        recordHash: 'inc-a1',
        sessionId: 'inc-s1',
        seq: 1,
        ts: '2026-06-01T09:58:00Z',
        model: 'gpt-5',
        input: 100,
        output: 50,
        importedAt: '2026-06-01T05:00:00Z',
    });
    await insertMessage(db, {
        recordHash: 'inc-a2',
        sessionId: 'inc-s2',
        seq: 1,
        ts: '2026-06-01T10:05:00Z',
        model: 'gpt-5-mini',
        input: 40,
        output: 20,
        importedAt: '2026-06-01T05:00:00Z',
    });
    await insertToolCall(db, {
        recordHash: 'inc-t1',
        messageHash: 'inc-a1',
        sessionId: 'inc-s1',
        seq: 1,
        toolName: 'Read',
    });
    await insertToolCall(db, {
        recordHash: 'inc-t2',
        messageHash: 'inc-a2',
        sessionId: 'inc-s2',
        seq: 1,
        toolName: 'Bash',
        status: 'error',
    });
}

describe('refreshHistoryBoardRollupsIncremental (task 0741)', () => {
    test('first run (no watermark) performs a full rebuild and records per-table watermarks', async () => {
        const db = await setup();
        await seedIncrementalCorpus(db);
        await refreshHistoryBoardRollupsIncremental(db);
        const watermarks = await readRollupWatermarks(db);
        expect(watermarks.size).toBeGreaterThan(0);
        for (const table of [
            'history_board_message_5m',
            'history_board_tool_5m',
            'history_board_model_stats',
            'history_board_ranked_steps',
        ]) {
            expect(watermarks.get(table)?.definitionVersion).toBe(ROLLUP_DEFINITION_VERSION);
        }
        // The first run left the corpus fresh.
        expect(await historyBoardRollupsFresh(db)).toBe(true);
    });

    test('a backfilled import lands in an old bucket and the watermark advances past it (R5)', async () => {
        const db = await setup();
        await seedIncrementalCorpus(db);
        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T09:57:00Z'",
            ),
        ).toEqual({ n: 0 });

        // Backfill: an old `ts` (09:57 bucket) imported later than the current cursor.
        await insertMessage(db, {
            recordHash: 'inc-backfill',
            sessionId: 'inc-s1',
            seq: 2,
            ts: '2026-06-01T09:57:00Z',
            model: 'gpt-5',
            input: 7,
            importedAt: '2026-06-01T07:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T09:57:00Z'",
            ),
        ).toEqual({ n: 1 });
        const wm = await readRollupWatermarks(db);
        expect(wm.get('history_board_message_5m')?.importedAtWatermark).toBe('2026-06-01T07:00:00Z');
        // Pre-existing buckets are untouched (still 1 row each).
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T09:58:00Z'",
            ),
        ).toEqual({ n: 1 });
    });

    test('delta row at the first second of its minute survives the incremental refresh (0805 R1)', async () => {
        // Regression for the intermittent history-board 4h flake (task 0805 R1): a delta message
        // whose ts falls in the FIRST second of its minute bucket (`...T09:59:00.000Z`) compared
        // below the whole-second bucketWindow bound (`...T09:59:00Z`) in ISO text order ('.' < 'Z'),
        // so the incremental refresh dropped it from its own bucket's recompute and the materialized
        // read reported 0 sessions. The exact-minute-boundary row must be materialized.
        const db = await setup();
        // Baseline (whole-second ts, same minute-00 shape as the corpus seeds).
        await insertMessage(db, {
            recordHash: 'bl-1',
            sessionId: 'bl-s1',
            seq: 1,
            ts: '2026-06-01T09:58:00Z',
            model: 'gpt-5',
            input: 100,
            output: 50,
            importedAt: '2026-06-01T05:00:00Z',
        });
        await insertToolCall(db, { recordHash: 'bl-t1', messageHash: 'bl-1', sessionId: 'bl-s1', seq: 1 });
        await refreshHistoryBoardRollupsIncremental(db); // no watermark → full rebuild

        // Delta: fractional-second ts at SS=00 (the bug trigger), imported later.
        await insertMessage(db, {
            recordHash: 'delta-00',
            sessionId: 'bl-s1',
            seq: 2,
            ts: '2026-06-01T09:59:00.000Z',
            model: 'gpt-5',
            input: 12,
            output: 6,
            importedAt: '2026-06-01T07:00:00Z',
        });
        await insertToolCall(db, {
            recordHash: 'delta-00-t',
            messageHash: 'delta-00',
            sessionId: 'bl-s1',
            seq: 2,
            toolName: 'run_terminal_command',
        });
        await refreshHistoryBoardRollupsIncremental(db); // incremental delta

        // The exact-boundary message AND tool rows must be materialized (the tool-filtered read
        // is the reported symptom: sessionsCount expected 1, got 0).
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T09:59:00Z'",
            ),
        ).toEqual({ n: 1 });
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_tool_5m WHERE bucket_start = '2026-06-01T09:59:00Z' AND tool_name = 'run_terminal_command'",
            ),
        ).toEqual({ n: 1 });
        // Sanity: a mid-minute fractional delta is still handled (no regression for ordinary rows).
        await insertMessage(db, {
            recordHash: 'delta-30',
            sessionId: 'bl-s1',
            seq: 3,
            ts: '2026-06-01T10:00:30.500Z',
            model: 'gpt-5',
            input: 1,
            output: 1,
            importedAt: '2026-06-01T07:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T10:00:00Z'",
            ),
        ).toEqual({ n: 1 });
    });

    test('incremental keyed aggregates equal a full rebuild on the same corpus (R6)', async () => {
        const base = async (db: DbAdapter): Promise<void> => {
            await insertMessage(db, {
                recordHash: 'inc-a1',
                sessionId: 'inc-s1',
                seq: 1,
                ts: '2026-06-01T09:58:00Z',
                model: 'gpt-5',
                input: 100,
                output: 50,
                importedAt: '2026-06-01T05:00:00Z',
            });
            await insertMessage(db, {
                recordHash: 'inc-a2',
                sessionId: 'inc-s2',
                seq: 1,
                ts: '2026-06-01T10:05:00Z',
                model: 'gpt-5-mini',
                input: 40,
                output: 20,
                importedAt: '2026-06-01T05:00:00Z',
            });
            await insertToolCall(db, {
                recordHash: 'inc-t1',
                messageHash: 'inc-a1',
                sessionId: 'inc-s1',
                seq: 1,
                toolName: 'Read',
            });
            await insertToolCall(db, {
                recordHash: 'inc-t2',
                messageHash: 'inc-a2',
                sessionId: 'inc-s2',
                seq: 1,
                toolName: 'Bash',
                status: 'error',
            });
        };
        const addDelta = async (db: DbAdapter): Promise<void> => {
            await insertMessage(db, {
                recordHash: 'inc-delta',
                sessionId: 'inc-s1',
                seq: 2,
                ts: '2026-06-01T09:59:00Z',
                model: 'gpt-5',
                input: 12,
                output: 6,
                importedAt: '2026-06-01T07:00:00Z',
            });
            await insertToolCall(db, {
                recordHash: 'inc-delta-t',
                messageHash: 'inc-delta',
                sessionId: 'inc-s1',
                seq: 2,
                toolName: 'Edit',
            });
        };

        // Incremental path: baseline full build, then a delta, then the incremental refresh.
        const incrementalDb = await setup();
        await base(incrementalDb);
        await refreshHistoryBoardRollupsIncremental(incrementalDb);
        await addDelta(incrementalDb);
        await refreshHistoryBoardRollupsIncremental(incrementalDb);

        // Full-rebuild path: the identical final corpus re-derived wholesale.
        const freshDb = await setup();
        await base(freshDb);
        await addDelta(freshDb);
        await refreshHistoryBoardRollupsIncremental(freshDb);

        const readKeyed = async (db: DbAdapter) => ({
            model: await db.queryAll(
                'SELECT model, fresh_input_tokens, output_tokens, tool_calls FROM history_board_model_stats ORDER BY model',
            ),
            tool: await db.queryAll('SELECT tool_name, calls, errors FROM history_board_tool_stats ORDER BY tool_name'),
            sessions: await db.queryAll(
                'SELECT session_id, messages, tool_calls, state FROM history_board_session_stats ORDER BY session_id',
            ),
        });

        expect(await readKeyed(incrementalDb)).toEqual(await readKeyed(freshDb));
    });

    test('a definition-version mismatch forces a rebuild and resets the watermark to the current version (R8)', async () => {
        const db = await setup();
        await seedIncrementalCorpus(db);
        await refreshHistoryBoardRollupsIncremental(db);

        const before = await db.queryAll<{ session_id: string; messages: number }>(
            'SELECT session_id, messages FROM history_board_message_5m ORDER BY session_id',
        );
        expect(before.length).toBeGreaterThan(0);

        // Simulate a derivation change: the stored version no longer matches.
        await writeRollupWatermark(db, 'history_board_message_5m', {
            importedAtWatermark: '2026-06-01T05:00:00Z',
            definitionVersion: 'v999-old',
        });

        await refreshHistoryBoardRollupsIncremental(db);
        const wm = await readRollupWatermarks(db);
        expect(wm.get('history_board_message_5m')?.definitionVersion).toBe(ROLLUP_DEFINITION_VERSION);
        // The rebuild preserves the same materialized rows (content unchanged, just re-derived).
        const after = await db.queryAll<{ session_id: string; messages: number }>(
            'SELECT session_id, messages FROM history_board_message_5m ORDER BY session_id',
        );
        expect(after).toEqual(before);
    });

    test('an interrupted run never advances the watermark past an unprocessed backfilled bucket (R16/R7)', async () => {
        const db = await setup();
        // Prior watermark at 04:00 from an earlier run.
        await insertMessage(db, {
            recordHash: 'r16-base',
            sessionId: 'r16-s1',
            seq: 1,
            ts: '2026-06-01T09:57:00Z',
            model: 'gpt-5',
            input: 10,
            importedAt: '2026-06-01T04:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);

        // Backfill creating the non-monotonic ordering: bucket A (09:57) gets a row
        // imported at 10:00 (LATER than bucket B's rows), while bucket B (10:05) gets a
        // row imported at 05:00. Processed ascending, A's naive MAX advance to 10:00 would
        // leap past B's 05:00 rows, so an interrupted run would never re-select B.
        await insertMessage(db, {
            recordHash: 'r16-a',
            sessionId: 'r16-s2',
            seq: 1,
            ts: '2026-06-01T09:57:00Z',
            model: 'gpt-5',
            input: 7,
            importedAt: '2026-06-01T10:00:00Z',
        });
        await insertMessage(db, {
            recordHash: 'r16-b',
            sessionId: 'r16-s3',
            seq: 1,
            ts: '2026-06-01T10:05:00Z',
            model: 'gpt-5-mini',
            input: 20,
            importedAt: '2026-06-01T05:00:00Z',
        });
        await refreshHistoryBoardRollupsIncremental(db);
        const wm = await readRollupWatermarks(db);
        // The watermark must clamp below B's min (05:00): it may NOT advance to A's 10:00,
        // else an interrupted run would skip B forever.
        expect(wm.get('history_board_message_5m')?.importedAtWatermark ?? '').toBe('2026-06-01T05:00:00Z');
        // A complete run still materializes both buckets (09:57 holds base + backfill = 2 rows).
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T09:57:00Z'",
            ),
        ).toEqual({ n: 2 });
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T10:05:00Z'",
            ),
        ).toEqual({ n: 1 });
        // A recovery pass re-selects B (rows at/after the clamped watermark) and re-materializes it.
        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<{ n: number }>(
                "SELECT COUNT(*) AS n FROM history_board_message_5m WHERE bucket_start = '2026-06-01T10:05:00Z'",
            ),
        ).toEqual({ n: 1 });
    });
});

describe('classified skill rollups (E93 task 1029)', () => {
    test('counts one representative per invocation and applies class status precedence ok > error > unknown', async () => {
        const db = await setup();
        // Three raw rows for ONE logical invocation (same source/session/invocation_id/
        // class, e.g. the retry journal replay): the rep query materializes a single call
        // while the class status keeps 'ok' precedence over the 'error' retry row.
        for (const [hash, status] of [
            ['r1', 'ok'],
            ['r2', 'error'],
            ['r3', null],
        ] as const) {
            await insertSkillCall(db, {
                recordHash: hash,
                source: 'claude',
                sessionId: 's1',
                seq: 1,
                skillName: 'sp-x',
                invocationKind: 'user',
                startedAt: '2026-06-01T09:58:30Z',
                status,
                capabilityKind: 'command',
                evidenceKind: 'load',
                invocationId: 'inv-1',
            });
        }
        // Legacy rows have no invocation_id: each row is its own invocation (rep) in the
        // unclassified '' class.
        await insertSkillCall(db, {
            recordHash: 'r4',
            source: 'claude',
            sessionId: 's1',
            seq: 2,
            skillName: 'sp-x',
            invocationKind: 'user',
            startedAt: '2026-06-01T09:59:10Z',
        });
        await insertSkillCall(db, {
            recordHash: 'r5',
            source: 'claude',
            sessionId: 's1',
            seq: 3,
            skillName: 'sp-x',
            invocationKind: 'user',
            startedAt: '2026-06-01T09:59:20Z',
        });
        // A request row for the same skill is a separate class from the load.
        await insertSkillCall(db, {
            recordHash: 'r6',
            source: 'claude',
            sessionId: 's1',
            seq: 4,
            skillName: 'sp-x',
            invocationKind: 'user',
            startedAt: '2026-06-01T09:59:30Z',
            status: 'ok',
            capabilityKind: 'command',
            evidenceKind: 'request',
            invocationId: 'inv-2',
        });
        const rows = await skillCallRollup(db);
        // Skill buckets are minute-floored (SKILL_BUCKET_5M_SQL); '' classes sort first.
        expect(rows).toEqual([
            {
                bucketStart: '2026-06-01T09:58:00Z',
                source: 'claude',
                skillName: 'sp-x',
                invocationKind: 'user',
                capabilityKind: 'command',
                evidenceKind: 'load',
                status: 'ok',
                calls: 1,
            },
            {
                bucketStart: '2026-06-01T09:59:00Z',
                source: 'claude',
                skillName: 'sp-x',
                invocationKind: 'user',
                capabilityKind: '',
                evidenceKind: '',
                status: 'unknown',
                calls: 2,
            },
            {
                bucketStart: '2026-06-01T09:59:00Z',
                source: 'claude',
                skillName: 'sp-x',
                invocationKind: 'user',
                capabilityKind: 'command',
                evidenceKind: 'request',
                status: 'ok',
                calls: 1,
            },
        ]);
    });

    test('breakdown legacy arrays count confirmed loads only; byCapability exposes the full class grain', async () => {
        const db = await setup();
        const seed = async (
            recordHash: string,
            skillName: string,
            invocationKind: 'user' | 'model',
            capabilityKind: string | null,
            evidenceKind: string | null,
            status: string | null,
        ): Promise<void> => {
            await insertSkillCall(db, {
                recordHash,
                source: 'claude',
                sessionId: 's1',
                seq: 1,
                skillName,
                invocationKind,
                startedAt: '2026-06-01T09:58:30Z',
                status,
                capabilityKind,
                evidenceKind,
            });
        };
        // Two confirmed command loads (distinct invocations), one failed load, one
        // unclassified legacy row, one confirmed delegation, one model request.
        await seed('a1', 'sp-x', 'user', 'command', 'load', 'ok');
        await seed('a2', 'sp-x', 'user', 'command', 'load', 'ok');
        await seed('b1', 'sp-x', 'user', 'command', 'load', 'error');
        await seed('c1', 'sp-z', 'model', null, null, null);
        await seed('d1', 'sp-y', 'user', 'subagent', 'delegation', 'ok');
        await seed('e1', 'sp-y', 'model', 'command', 'request', 'ok');
        // Materialize the rollup grain from the raw rows (first run = full rebuild).
        await refreshHistoryBoardRollupsIncremental(db);
        const breakdown = await historyBoardSkillBreakdownFromRollup(db, ALL, '5m');
        // Legacy arrays: confirmed LOADS only (2 loads; the error/request/unclassified
        // rows and the delegation — evidence_kind 'delegation', not a load — fall out).
        expect(breakdown.bySkill).toEqual([{ skillName: 'sp-x', calls: 2 }]);
        expect(breakdown.bySource).toEqual([{ source: 'claude', calls: 2 }]);
        expect(breakdown.byInvocationKind).toEqual([{ invocationKind: 'user', calls: 2 }]);
        // byCapability keeps every classified-or-not class except nameless skills.
        expect(breakdown.byCapability).toEqual([
            {
                skillName: 'sp-x',
                capabilityKind: 'command',
                invocationKind: 'user',
                evidenceKind: 'load',
                status: 'ok',
                calls: 2,
            },
            {
                skillName: 'sp-x',
                capabilityKind: 'command',
                invocationKind: 'user',
                evidenceKind: 'load',
                status: 'error',
                calls: 1,
            },
            {
                skillName: 'sp-y',
                capabilityKind: 'command',
                invocationKind: 'model',
                evidenceKind: 'request',
                status: 'ok',
                calls: 1,
            },
            {
                skillName: 'sp-y',
                capabilityKind: 'subagent',
                invocationKind: 'user',
                evidenceKind: 'delegation',
                status: 'ok',
                calls: 1,
            },
            {
                skillName: 'sp-z',
                capabilityKind: null,
                invocationKind: 'model',
                evidenceKind: null,
                status: 'unknown',
                calls: 1,
            },
        ]);
    });

    test('a late outcome update lands in the original event bucket via the session-join repair pass', async () => {
        const db = await setup();
        // Journal v1: message + unclassified skill row (outcome pending).
        await insertMessage(db, {
            recordHash: 'm1',
            sessionId: 's-late',
            seq: 1,
            ts: '2026-06-01T09:58:30Z',
            importedAt: '2026-06-01T09:00:00Z',
        });
        await insertSkillCall(db, {
            recordHash: 'sc1',
            source: 'claude',
            sessionId: 's-late',
            seq: 1,
            skillName: 'sp-x',
            invocationKind: 'user',
            startedAt: '2026-06-01T09:58:40Z',
            status: null,
            invocationId: 'inv-9',
        });
        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<Record<string, string | number>>(
                "SELECT capability_kind, evidence_kind, status, calls FROM history_board_skill_5m WHERE bucket_start = '2026-06-01T09:58:00Z'",
            ),
        ).toEqual({ capability_kind: '', evidence_kind: '', status: 'unknown', calls: 1 });

        // Journal v2 (re-import of the same session): the outcome update rewrites the skill
        // row in place by record_hash WITHOUT bumping imported_at — invisible to the
        // message watermark. The replayed message row (INSERT OR REPLACE, new imported_at)
        // is the delta the repair pass joins.
        await db.run(
            `INSERT OR REPLACE INTO history_message (record_hash, source, source_file, source_line,
                 session_id, seq, role, record_type, disposition, ts, provenance, imported_at)
             VALUES ('m1', 'claude', 'test.jsonl', 1, 's-late', 1, 'assistant', 'message',
                     'conversation', '2026-06-01T09:58:30Z', 'agent', '2026-06-01T10:00:00Z')`,
        );
        await db.run(
            "UPDATE history_skill_call SET status = 'ok', evidence_kind = 'load', capability_kind = 'command' WHERE record_hash = 'sc1'",
        );
        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<Record<string, string | number>>(
                "SELECT capability_kind, evidence_kind, status, calls FROM history_board_skill_5m WHERE bucket_start = '2026-06-01T09:58:00Z'",
            ),
        ).toEqual({ capability_kind: 'command', evidence_kind: 'load', status: 'ok', calls: 1 });

        // Idempotent: refreshing again with no delta re-materializes the same bucket.
        await refreshHistoryBoardRollupsIncremental(db);
        expect(
            await db.queryFirst<Record<string, string | number>>(
                "SELECT capability_kind, evidence_kind, status, calls FROM history_board_skill_5m WHERE bucket_start = '2026-06-01T09:58:00Z'",
            ),
        ).toEqual({ capability_kind: 'command', evidence_kind: 'load', status: 'ok', calls: 1 });
    });

    test('design 8.3 oracle: 8 distinct classes sum to 8 in byCapability; correlated duplicates do not inflate; legacy confirmed loads sum to 3', async () => {
        const db = await setup();
        // The composite fixture: 2 requests, 3 successful loads (one with correlated
        // duplicate evidence that must collapse to one rep), 1 delegation, 1 failed load,
        // 1 unconfirmed load.
        const oracle = [
            {
                hash: 'o-req-1',
                skill: 'sp-a',
                kind: 'model' as const,
                cap: 'command',
                ev: 'request',
                st: 'ok',
                inv: 'inv-r1',
            },
            {
                hash: 'o-req-2',
                skill: 'sp-b',
                kind: 'user' as const,
                cap: 'skill',
                ev: 'request',
                st: 'ok',
                inv: 'inv-r2',
            },
            { hash: 'o-l1', skill: 'sp-a', kind: 'user' as const, cap: 'command', ev: 'load', st: 'ok', inv: 'inv-l1' },
            // Correlated duplicate evidence for inv-l2: two raw rows, one rep.
            { hash: 'o-l2a', skill: 'sp-b', kind: 'model' as const, cap: 'skill', ev: 'load', st: 'ok', inv: 'inv-l2' },
            { hash: 'o-l2b', skill: 'sp-b', kind: 'model' as const, cap: 'skill', ev: 'load', st: 'ok', inv: 'inv-l2' },
            { hash: 'o-l3', skill: 'sp-c', kind: 'user' as const, cap: 'command', ev: 'load', st: 'ok', inv: 'inv-l3' },
            {
                hash: 'o-del-1',
                skill: 'sp-a',
                kind: 'user' as const,
                cap: 'subagent',
                ev: 'delegation',
                st: 'ok',
                inv: 'inv-d1',
            },
            {
                hash: 'o-fail-1',
                skill: 'sp-c',
                kind: 'user' as const,
                cap: 'command',
                ev: 'load',
                st: 'error',
                inv: 'inv-f1',
            },
            {
                hash: 'o-unc-1',
                skill: 'sp-c',
                kind: 'user' as const,
                cap: 'skill',
                ev: 'load',
                st: null,
                inv: 'inv-u1',
            },
        ];
        for (const [i, row] of oracle.entries()) {
            await insertSkillCall(db, {
                recordHash: row.hash,
                source: 'claude',
                sessionId: 's-oracle',
                seq: i + 1,
                skillName: row.skill,
                invocationKind: row.kind,
                startedAt: '2026-06-01T09:58:30Z',
                status: row.st,
                capabilityKind: row.cap,
                evidenceKind: row.ev,
                invocationId: row.inv,
            });
        }
        await refreshHistoryBoardRollupsIncremental(db);
        const breakdown = await historyBoardSkillBreakdownFromRollup(db, ALL, '5m');
        // Oracle: byCapability sums to 8 (9 raw rows, one correlated duplicate collapses).
        expect(breakdown.byCapability).toHaveLength(8);
        expect(breakdown.byCapability.reduce((acc, r) => acc + r.calls, 0)).toBe(8);
        // Legacy arrays count confirmed loads only: exactly the 3 successful loads.
        expect(breakdown.bySkill.reduce((acc, r) => acc + r.calls, 0)).toBe(3);
        expect(breakdown.bySource.reduce((acc, r) => acc + r.calls, 0)).toBe(3);
        expect(breakdown.byInvocationKind).toEqual([
            { invocationKind: 'user', calls: 2 },
            { invocationKind: 'model', calls: 1 },
        ]);
        // Requests and outcome classes stay visible separately (design 8.3 freeze).
        const classes = breakdown.byCapability.map((r) => `${r.evidenceKind}/${r.status}/${r.calls}`);
        expect(classes).toContain('request/ok/1');
        expect(classes).toContain('delegation/ok/1');
        expect(classes).toContain('load/error/1');
        expect(classes).toContain('load/unknown/1');
        expect(classes.filter((c) => c === 'load/ok/1')).toHaveLength(3);
    });
});
