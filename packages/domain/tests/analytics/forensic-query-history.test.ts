import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import {
    bucketedTokenSeries,
    consolidatedTimeline,
    dailyTokenMatrix,
    historyKpiTrend,
    modelComparison,
    sessionTimeline,
    toolSequenceQuery,
} from '../../src/analytics/forensic-query';

import { applyCliMigrations, CLI_SCHEMA_SQL, HISTORY_BOARD_QUERY_INDEXES_SCHEMA_SQL } from '../../src/migrations';

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of CLI_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    await applyCliMigrations(adapter);
    return adapter;
}

interface Msg {
    record_hash: string;
    session_id: string;
    seq: number;
    role: string;
    record_type: string;
    disposition: string;
    ts: string;
    model: string | null;
    input?: number | null;
    request_id?: string | null;
    output?: number | null;
    cost?: number | null;
    cache_read?: number | null;
    source?: string;
    duration_ms?: number | null;
}

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
             cache_read_tokens, provenance, duration_ms, request_id, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.record_hash,
        m.source ?? 'claude',
        'test.jsonl',
        1,
        m.session_id,
        m.seq,
        m.role,
        m.record_type,
        m.disposition,
        m.ts,
        m.model,
        m.input ?? null,
        m.output ?? null,
        m.cost ?? null,
        m.cache_read ?? null,
        'agent',
        m.duration_ms ?? null,
        m.request_id ?? null,
        '2026-06-01T00:00:00Z',
    );
}

interface ToolCall {
    record_hash: string;
    message_hash: string;
    session_id: string;
    seq: number;
    tool_name: string;
    args_digest?: string | null;
    args_raw?: string | null;
    status: string;
    duration_ms?: number | null;
}

async function insertToolCall(db: DbAdapter, t: ToolCall): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.record_hash,
        t.message_hash,
        'claude',
        'test.jsonl',
        1,
        t.session_id,
        t.seq,
        t.tool_name,
        t.args_digest ?? null,
        t.args_raw ?? null,
        t.status,
        t.duration_ms ?? null,
        '2026-06-01T00:00:00Z',
    );
}

describe('forensic-query history live extensions (task 0628)', () => {
    test('bucketedTokenSeries aggregates by bucket and dimension', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T12:05:00Z',
            model: 'claude-opus-4.6',
            input: 100,
            output: 50,
            cache_read: 200,
            source: 'claude',
        });
        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 's1',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T12:25:00Z',
            model: 'claude-sonnet-4.6',
            input: 80,
            output: 40,
            cache_read: 150,
            source: 'claude',
        });

        const sel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };

        const rows10m = await bucketedTokenSeries(db, sel, '10m', 'model');
        expect(rows10m.length).toBe(2);

        const rows1d = await bucketedTokenSeries(db, sel, '1d', 'model');
        expect(rows1d.length).toBe(2);
    });

    test('tool dimensions allocate each message once and model metrics do not multiply by tool count', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T12:00:00Z',
            model: 'gpt-5.6-sol',
            input: 100,
            output: 50,
            cache_read: 200,
            duration_ms: 1_000,
        });
        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 's1',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T12:01:00Z',
            model: 'gpt-5.6-sol',
            input: 100,
            output: 10,
            cache_read: 0,
            duration_ms: 100,
        });
        await insertToolCall(db, {
            record_hash: 't1',
            message_hash: 'm1',
            session_id: 's1',
            seq: 1,
            tool_name: 'Read',
            status: 'success',
            duration_ms: 10,
        });
        await insertToolCall(db, {
            record_hash: 't2',
            message_hash: 'm1',
            session_id: 's1',
            seq: 2,
            tool_name: 'Edit',
            status: 'success',
            duration_ms: 20,
        });
        await insertToolCall(db, {
            record_hash: 't3',
            message_hash: 'm2',
            session_id: 's1',
            seq: 3,
            tool_name: 'Read',
            status: 'success',
            duration_ms: 30,
        });
        const selector: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };

        const byTool = await bucketedTokenSeries(db, selector, '1d', 'tool');
        expect(byTool.reduce((sum, row) => sum + (row.freshInputTokens ?? 0), 0)).toBe(200);
        expect(byTool.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0)).toBe(60);
        expect(byTool.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0)).toBe(200);

        const comparison = await modelComparison(db, selector);
        expect(comparison[0]?.speedMsMean).toBe(550);
        expect(comparison[0]?.cacheRatio).toBeCloseTo(0.5);
        expect(comparison[0]?.outputRatio).toBeCloseTo(60 / 260);
    });

    test('ArtifactSelector filters by models, tools, and skills', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T12:00:00Z',
            model: 'claude-opus-4.6',
            input: 100,
            output: 50,
            source: 'claude',
        });
        await insertToolCall(db, {
            record_hash: 'tc1',
            message_hash: 'm1',
            session_id: 's1',
            seq: 1,
            tool_name: 'Read',
            args_raw: '{"file": "main.ts"}',
            status: 'success',
            duration_ms: 120,
        });

        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 's2',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T13:00:00Z',
            model: 'gpt-5.6-sol',
            input: 200,
            output: 80,
            source: 'codex',
        });
        await insertToolCall(db, {
            record_hash: 'tc2',
            message_hash: 'm2',
            session_id: 's2',
            seq: 1,
            tool_name: 'Bash',
            args_raw: '{"cmd": "sp:dev-verify"}',
            status: 'success',
            duration_ms: 300,
        });

        // Model filter
        const modelSel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            models: ['claude-opus-4.6'],
            sessionId: null,
            runId: null,
            taskWbs: null,
        };
        const modelRows = await bucketedTokenSeries(db, modelSel, '1d', 'model');
        expect(modelRows.length).toBe(1);
        expect(modelRows[0]?.key).toBe('claude-opus-4.6');

        // Tool filter
        const toolSel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            tools: ['Bash'],
            sessionId: null,
            runId: null,
            taskWbs: null,
        };
        const toolRows = await bucketedTokenSeries(db, toolSel, '1d', 'model');
        expect(toolRows.length).toBe(1);
        expect(toolRows[0]?.key).toBe('gpt-5.6-sol');

        // Skill filter
        const skillSel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            skills: ['dev-verify'],
            sessionId: null,
            runId: null,
            taskWbs: null,
        };
        const skillRows = await bucketedTokenSeries(db, skillSel, '1d', 'model');
        expect(skillRows.length).toBe(1);
        expect(skillRows[0]?.key).toBe('gpt-5.6-sol');
    });

    test('skill series divides tokens across ALL linked tool calls before selecting skill rows (canonical allocation)', async () => {
        const db = await setup();
        // One message with a non-skill and a skill tool call: tokens split 50/50.
        await insertMessage(db, {
            record_hash: 'mx-1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T12:00:00Z',
            model: 'gpt-5',
            input: 100,
            cache_read: 40,
            output: 60,
            source: 'claude',
        });
        await insertToolCall(db, {
            record_hash: 'tc-mx-1',
            message_hash: 'mx-1',
            session_id: 's1',
            seq: 1,
            tool_name: 'Read',
            args_raw: '{"file": "a.ts"}',
            status: 'success',
        });
        await insertToolCall(db, {
            record_hash: 'tc-mx-2',
            message_hash: 'mx-1',
            session_id: 's1',
            seq: 2,
            tool_name: 'skill',
            args_raw: '{"skill": "sp-code-testing"}',
            status: 'success',
        });
        await insertToolCall(db, {
            record_hash: 'tc-mx-3',
            message_hash: 'mx-1',
            session_id: 's1',
            seq: 3,
            tool_name: 'skill',
            args_raw: null, // blank skill name must stay excluded
            status: 'success',
        });

        const sel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };
        const rows = await bucketedTokenSeries(db, sel, '1d', 'skill');
        // 3 linked calls -> the skill row carries one third of the message tokens.
        expect(rows).toEqual([
            {
                bucketStart: '2026-06-01',
                key: 'sp-code-testing',
                freshInputTokens: 100 / 3,
                cacheReadTokens: 40 / 3,
                outputTokens: 60 / 3,
                calls: 1,
            },
        ]);
        // Blank-skill and non-skill rows are excluded; tool dimension still sees all 3 tools.
        const toolRows = await bucketedTokenSeries(db, sel, '1d', 'tool');
        expect(toolRows.map((r) => r.key).sort()).toEqual(['Read', 'skill']);
    });

    test('sessionTimeline returns chronological event stream', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 's1',
            seq: 1,
            role: 'user',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:00Z',
            model: null,
            input: 50,
            output: null,
            source: 'claude',
        });
        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 's1',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:05Z',
            model: 'claude-opus-4.6',
            input: 100,
            output: 200,
            source: 'claude',
            duration_ms: 1500,
        });
        await insertToolCall(db, {
            record_hash: 'tc1',
            message_hash: 'm2',
            session_id: 's1',
            seq: 1,
            tool_name: 'Write',
            args_raw: '{"target": "index.ts"}',
            status: 'success',
            duration_ms: 350,
        });

        const timelineResult = await sessionTimeline(db, 'claude', 's1');
        const timeline = timelineResult.events;
        expect(timeline.length).toBe(3);
        expect(timeline[0]?.role).toBe('user');
        expect(timeline[1]?.role).toBe('assistant');
        expect(timeline[2]?.toolName).toBe('Write');
        expect(timeline[2]?.durationMs).toBe(350);
        expect(timeline[2]?.durationSource).toBe('measured');
        expect(timeline.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0)).toBe(150);
        expect(timeline.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0)).toBe(200);
    });

    test('sessionTimeline labels a digest-only tool payload instead of exposing a bare hash', async () => {
        const db = await setup();
        const digest = 'a'.repeat(64);
        await insertMessage(db, {
            record_hash: 'digest-message',
            session_id: 'digest-session',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:00Z',
            model: 'claude-opus-4.6',
        });
        await insertToolCall(db, {
            record_hash: 'digest-tool',
            message_hash: 'digest-message',
            session_id: 'digest-session',
            seq: 1,
            tool_name: 'Bash',
            args_digest: digest,
            status: 'success',
        });

        const result = await sessionTimeline(db, 'claude', 'digest-session');
        const tool = result.events.find((event) => event.eventType === 'tool');
        expect(tool?.payload).toBe(
            `tool: Bash\nstatus: success\nargs_digest: ${digest} (raw payload omitted at import)`,
        );
        expect(tool?.payload).not.toBe(digest);
    });

    test('sessionTimeline stays bounded on a 6,500-message session', async () => {
        const db = await setup();
        await db.exec(
            `WITH RECURSIVE numbers(n) AS (
                 VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 6500
             )
             INSERT INTO history_message (
                 record_hash, source, source_file, source_line, session_id, seq,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens,
                 cache_read_tokens, provenance, imported_at
             )
             SELECT printf('large-%d', n), 'codex', 'large.jsonl', n, 'large-session', n,
                    'assistant', 'message', 'ok', '2026-06-01T12:00:00Z', 'gpt-5.6-sol',
                    1, 1, 0, 'agent', '2026-06-01T12:00:00Z'
             FROM numbers`,
        );

        const started = performance.now();
        const result = await sessionTimeline(db, 'codex', 'large-session', 5000);
        const durationMs = performance.now() - started;

        expect(result.truncated).toBe(true);
        expect(result.events).toHaveLength(5000);
        expect(result.events[0]?.seq).toBe(1);
        expect(result.events.at(-1)?.seq).toBe(5000);
        expect(durationMs).toBeLessThan(100);
    });

    test('duration projection distinguishes measured, inferred, and unmeasured values', async () => {
        const db = await setup();
        // S1: 3 events
        // 1. 10:00:00, duration 500ms -> measured
        // 2. 10:00:01, duration null -> inferred (delta 2s to next at 10:00:03)
        // 3. 10:00:03, duration null -> next event at 10:15:00 is > 10m gap -> unmeasured
        // 4. 10:15:00, duration null -> last event in session -> unmeasured
        await insertMessage(db, {
            record_hash: 'd1',
            session_id: 's-dur',
            seq: 1,
            role: 'user',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:00.000Z',
            model: null,
            input: 50,
            output: null,
            source: 'claude',
            duration_ms: 500,
        });
        await insertMessage(db, {
            record_hash: 'd2',
            session_id: 's-dur',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:01.000Z',
            model: 'claude-3-7-sonnet',
            input: 100,
            output: 200,
            source: 'claude',
            duration_ms: null,
        });
        await insertMessage(db, {
            record_hash: 'd3',
            session_id: 's-dur',
            seq: 3,
            role: 'user',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:03.000Z',
            model: null,
            input: 50,
            output: null,
            source: 'claude',
            duration_ms: null,
        });
        await insertMessage(db, {
            record_hash: 'd4',
            session_id: 's-dur',
            seq: 4,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:15:00.000Z',
            model: 'claude-3-7-sonnet',
            input: 100,
            output: 200,
            source: 'claude',
            duration_ms: null,
        });

        // Interleaved S2 event at 10:00:02 must NOT affect S1 duration inference
        await insertMessage(db, {
            record_hash: 'd-other',
            session_id: 's-other',
            seq: 1,
            role: 'user',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:02.000Z',
            model: null,
            input: 50,
            output: null,
            source: 'claude',
            duration_ms: null,
        });

        const timeline = await sessionTimeline(db, 'claude', 's-dur');
        expect(timeline.events).toHaveLength(4);
        expect(timeline.events[0]?.durationMs).toBe(500);
        expect(timeline.events[0]?.durationSource).toBe('measured');
        expect(timeline.events[1]?.durationMs).toBe(2000);
        expect(timeline.events[1]?.durationSource).toBe('inferred');
        expect(timeline.events[2]?.durationMs).toBeNull();
        expect(timeline.events[2]?.durationSource).toBe('unmeasured');
        expect(timeline.events[3]?.durationMs).toBeNull();
        expect(timeline.events[3]?.durationSource).toBe('unmeasured');
    });

    test('dailyTokenMatrix returns daily token metrics per source', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: new Date().toISOString(),
            model: 'claude-opus-4.6',
            input: 500,
            output: 250,
            cache_read: 1000,
            source: 'claude',
        });

        const matrix = await dailyTokenMatrix(db, 90);
        expect(matrix.length).toBeGreaterThanOrEqual(1);
        expect(matrix[0]?.source).toBe('claude');
        expect(matrix[0]?.tokens).toBe(750);
        expect(matrix[0]?.cacheReadTokens).toBe(1000);
    });

    test('modelComparison computes Speed, Cache ratio, Reliability, Output ratio', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:00Z',
            model: 'claude-opus-4.6',
            input: 100,
            output: 25,
            cache_read: 300,
            source: 'claude',
            duration_ms: 600,
        });
        await insertToolCall(db, {
            record_hash: 'tc1',
            message_hash: 'm1',
            session_id: 's1',
            seq: 1,
            tool_name: 'Edit',
            args_raw: '{}',
            status: 'success',
            duration_ms: 100,
        });

        const sel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };

        const comparison = await modelComparison(db, sel);
        expect(comparison.length).toBe(1);
        expect(comparison[0]?.model).toBe('claude-opus-4.6');
        expect(comparison[0]?.speedMsMean).toBe(600);
        expect(comparison[0]?.cacheRatio).toBeCloseTo(300 / 400); // 300 / (100+300) = 0.75
        expect(comparison[0]?.reliability).toBe(1.0);
        expect(comparison[0]?.outputRatio).toBeCloseTo(25 / 125); // 25 / (100+25) = 0.2
    });

    test('indexes and EXPLAIN QUERY PLAN on history queries', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        for (const statement of CLI_SCHEMA_SQL.split(';')
            .map((value) => value.trim())
            .filter(Boolean)) {
            await db.exec(statement);
        }
        const queries = [
            {
                index: 'idx_history_message_session_id_seq',
                sql: `SELECT seq FROM history_message WHERE session_id = 's1' ORDER BY seq LIMIT 5000`,
            },
            {
                index: 'idx_history_message_duration_rank',
                sql: `SELECT duration_ms FROM history_message
                      WHERE role = 'assistant' AND duration_ms IS NOT NULL
                      ORDER BY duration_ms DESC LIMIT 10`,
            },
            {
                index: 'idx_history_message_token_rank',
                sql: `SELECT input_tokens FROM history_message
                      WHERE role = 'assistant' AND (input_tokens IS NOT NULL OR output_tokens IS NOT NULL)
                      ORDER BY (COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0)) DESC LIMIT 10`,
            },
            {
                index: 'idx_history_message_input_rank',
                sql: `SELECT input_tokens FROM history_message
                      WHERE role = 'assistant' AND input_tokens > 100000
                        AND cache_read_tokens < input_tokens * 0.1
                      ORDER BY input_tokens DESC LIMIT 10`,
            },
        ];
        const plan = async (sql: string) =>
            (await db.queryAll<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)).map((row) => row.detail).join('\n');
        const before = await Promise.all(queries.map(({ sql }) => plan(sql)));
        for (const [index, query] of queries.entries()) {
            expect(before[index]).not.toContain(query.index);
        }

        for (const statement of HISTORY_BOARD_QUERY_INDEXES_SCHEMA_SQL.split(';')
            .map((value) => value.trim())
            .filter(Boolean)) {
            await db.exec(statement);
        }
        const after = await Promise.all(queries.map(({ sql }) => plan(sql)));
        for (const [index, query] of queries.entries()) {
            expect(after[index]).toContain(query.index);
        }
    });

    test('historyKpiTrend groups days, sums tokens, counts sessions and tool calls', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'k1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:00Z',
            model: 'claude-opus-4.6',
            input: 100,
            output: 25,
            cache_read: 300,
            duration_ms: 600,
        });
        await insertToolCall(db, {
            record_hash: 'kt1',
            message_hash: 'k1',
            session_id: 's1',
            seq: 1,
            tool_name: 'Edit',
            args_raw: '{}',
            status: 'success',
            duration_ms: 100,
        });
        await insertMessage(db, {
            record_hash: 'k2',
            session_id: 's2',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T11:00:00Z',
            model: 'claude-opus-4.6',
            input: 10,
            output: 5,
        });
        await insertMessage(db, {
            record_hash: 'k3',
            session_id: 's1',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-02T09:00:00Z',
            model: 'claude-sonnet-4.6',
            input: 20,
            output: 10,
            cache_read: 80,
        });

        const sel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };

        const rows = await historyKpiTrend(db, sel);
        expect(rows).toEqual([
            {
                day: '2026-06-01',
                freshInputTokens: 110,
                outputTokens: 30,
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
        ]);
    });

    test('historyKpiTrend dedups repeated request_id and preserves filters', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'd1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:00Z',
            model: 'gpt-5',
            input: 100,
            output: 25,
            cache_read: 50,
            request_id: 'req_1',
        });
        await insertMessage(db, {
            record_hash: 'd2',
            session_id: 's1',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:01Z',
            model: 'gpt-5',
            input: 100,
            output: 25,
            cache_read: 50,
            request_id: 'req_1',
        });
        await insertMessage(db, {
            record_hash: 'd3',
            session_id: 's2',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-02T10:00:00Z',
            model: 'gpt-5-mini',
            input: 7,
            output: 3,
        });

        const base: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };

        const all = await historyKpiTrend(db, base);
        expect(all).toEqual([
            {
                day: '2026-06-01',
                freshInputTokens: 100,
                outputTokens: 25,
                cacheReadTokens: 50,
                sessions: 1,
                toolCalls: 0,
            },
            { day: '2026-06-02', freshInputTokens: 7, outputTokens: 3, cacheReadTokens: 0, sessions: 1, toolCalls: 0 },
        ]);

        const byModel = await historyKpiTrend(db, { ...base, models: ['gpt-5'] });
        expect(byModel).toEqual([
            {
                day: '2026-06-01',
                freshInputTokens: 100,
                outputTokens: 25,
                cacheReadTokens: 50,
                sessions: 1,
                toolCalls: 0,
            },
        ]);
    });

    test('consolidatedTimeline retrieves multi-session events correlated via history_run_session and task_run_links', async () => {
        const db = await setup();

        await insertMessage(db, {
            record_hash: 'c1',
            session_id: 's-run-1',
            seq: 1,
            role: 'user',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:00Z',
            model: null,
            source: 'agy',
        });
        await insertMessage(db, {
            record_hash: 'c2',
            session_id: 's-run-1',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:00:05Z',
            model: 'gemini-3-pro',
            source: 'agy',
            input: 1000,
            output: 200,
        });
        await insertToolCall(db, {
            record_hash: 'tc-c1',
            message_hash: 'c2',
            session_id: 's-run-1',
            seq: 1,
            tool_name: 'Bash',
            args_raw: '{"skill":"sp-code-testing"}',
            status: 'ok',
            duration_ms: 3000,
        });

        await insertMessage(db, {
            record_hash: 'c3',
            session_id: 's-run-2',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'ok',
            ts: '2026-06-01T10:01:00Z',
            model: 'gpt-5.6-sol',
            source: 'codex',
            input: 500,
            output: 100,
        });

        // Seed history_run_session
        await db.run(
            `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            'run-test-1',
            'agy',
            's-run-1',
            'exact',
            'env-var',
        );
        await db.run(
            `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            'run-test-1',
            'codex',
            's-run-2',
            'estimated',
            'env-var',
        );

        // Seed task_run_links
        await db.run(
            `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
            'link-1',
            '0638',
            'run-test-1',
            'task',
        );
        await db.run(
            `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
            'link-other',
            '9999',
            'run-other',
            'task',
        );
        await db.run(
            `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            'run-test-1',
            'agy',
            null,
            'unresolved',
            'observed',
        );

        // 1. By runId
        const resRun = await consolidatedTimeline(db, {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: 'run-test-1',
            taskWbs: null,
        });
        expect(resRun.events.length).toBeGreaterThanOrEqual(3);
        expect(resRun.truncated).toBe(false);
        const exactEv = resRun.events.find((e) => e.sessionId === 's-run-1');
        expect(exactEv?.correlationExactness).toBe('exact');
        const estEv = resRun.events.find((e) => e.sessionId === 's-run-2');
        expect(estEv?.correlationExactness).toBe('estimated');

        // 2. By taskWbs
        const resTask = await consolidatedTimeline(db, {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: '0638',
        });
        expect(resTask.events.length).toBeGreaterThanOrEqual(3);

        // 3. Combined correlation and every active global filter compose by AND.
        const resCombined = await consolidatedTimeline(db, {
            since: '2026-06-01T09:59:00Z',
            until: '2026-06-01T10:02:00Z',
            sources: ['agy'],
            models: ['gemini-3-pro'],
            tools: ['Bash'],
            skills: ['sp-code-testing'],
            sessionId: null,
            runId: 'run-test-1',
            taskWbs: '0638',
        });
        expect(resCombined.events.map((event) => event.sessionId)).toEqual(['s-run-1', 's-run-1']);
        expect(resCombined.events.every((event) => event.correlationExactness === 'exact')).toBe(true);

        const wrongPair = await consolidatedTimeline(db, {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: 'run-test-1',
            taskWbs: '9999',
        });
        expect(wrongPair.events).toEqual([]);

        // 4. General filter (all sessions)
        const resAll = await consolidatedTimeline(db, {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        });
        expect(resAll.events.length).toBeGreaterThanOrEqual(3);
    });
});

describe('toolSequenceQuery', () => {
    test('retrieves ordered tool calls for session and respects filters, dedup, and bounds', async () => {
        const db = await setup();
        // Insert message and tools
        await insertMessage(db, {
            record_hash: 'msg-tool-1',
            session_id: 's-tool-seq',
            seq: 1,
            role: 'assistant',
            record_type: 'assistant',
            disposition: 'executed',
            ts: '2026-08-31T01:00:00Z',
            model: 'claude-opus-4.6',
            input: 1000,
            cache_read: 2000,
            output: 500,
            request_id: 'req-1',
        });

        // Insert duplicate message row with same request_id (streaming duplicate simulation)
        await insertMessage(db, {
            record_hash: 'msg-tool-1-dup',
            session_id: 's-tool-seq',
            seq: 2,
            role: 'assistant',
            record_type: 'assistant',
            disposition: 'executed',
            ts: '2026-08-31T01:00:05Z',
            model: 'claude-opus-4.6',
            input: 1000,
            cache_read: 2000,
            output: 500,
            request_id: 'req-1',
        });

        await insertToolCall(db, {
            record_hash: 'tc-1',
            message_hash: 'msg-tool-1-dup',
            session_id: 's-tool-seq',
            seq: 1,
            tool_name: 'Read',
            args_digest: 'src/index.ts',
            args_raw: '{"file":"src/index.ts"}',
            status: 'ok',
            duration_ms: 250,
        });

        await insertToolCall(db, {
            record_hash: 'tc-2',
            message_hash: 'msg-tool-1-dup',
            session_id: 's-tool-seq',
            seq: 2,
            tool_name: 'Bash',
            args_digest: 'bun test',
            args_raw: '{"cmd":"bun test"}',
            status: 'error',
            duration_ms: null,
        });

        // 1. Session query
        const sessionRes = await toolSequenceQuery(db, {
            mode: 'session',
            source: 'claude',
            sessionId: 's-tool-seq',
        });
        expect(sessionRes.truncated).toBe(false);
        expect(sessionRes.rows.length).toBe(2);
        expect(sessionRes.rows[0]?.toolName).toBe('Read');
        expect(sessionRes.rows[0]?.durationMs).toBe(250);
        expect(sessionRes.rows[0]?.links).toBe(2);
        expect(sessionRes.rows[1]?.toolName).toBe('Bash');
        expect(sessionRes.rows[1]?.status).toBe('error');
        expect(sessionRes.rows[1]?.durationMs).toBeNull();

        // 2. Tool name filter
        const toolNameRes = await toolSequenceQuery(
            db,
            { mode: 'session', source: 'claude', sessionId: 's-tool-seq' },
            { toolNames: ['Read'] },
        );
        expect(toolNameRes.rows.length).toBe(1);
        expect(toolNameRes.rows[0]?.toolName).toBe('Read');

        // 3. Status filter
        const errorRes = await toolSequenceQuery(
            db,
            { mode: 'session', source: 'claude', sessionId: 's-tool-seq' },
            { status: 'error' },
        );
        expect(errorRes.rows.length).toBe(1);
        expect(errorRes.rows[0]?.toolName).toBe('Bash');

        // 4. Search filter (matching args_raw)
        const searchRes = await toolSequenceQuery(
            db,
            { mode: 'session', source: 'claude', sessionId: 's-tool-seq' },
            { search: 'bun test' },
        );
        expect(searchRes.rows.length).toBe(1);
        expect(searchRes.rows[0]?.toolName).toBe('Bash');

        // 5. Consolidated mode with limit & truncation
        const boundRes = await toolSequenceQuery(
            db,
            {
                mode: 'consolidated',
                sel: {
                    since: null,
                    until: null,
                    sources: null,
                    sessionId: null,
                    runId: null,
                    taskWbs: null,
                },
            },
            {},
            1,
        );
        expect(boundRes.truncated).toBe(true);
        expect(boundRes.rows.length).toBe(1);
    });
});
