import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import {
    bucketedTokenSeries,
    dailyTokenMatrix,
    modelComparison,
    sessionTimeline,
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
             cache_read_tokens, provenance, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    duration_ms: number | null;
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

        const timeline = await sessionTimeline(db, 's1');
        expect(timeline.length).toBe(3);
        expect(timeline[0]?.role).toBe('user');
        expect(timeline[1]?.role).toBe('assistant');
        expect(timeline[2]?.toolName).toBe('Write');
        expect(timeline[2]?.durationMs).toBe(350);
        expect(timeline.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0)).toBe(150);
        expect(timeline.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0)).toBe(200);
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
        const rows = await sessionTimeline(db, 'large-session', 5000);
        const durationMs = performance.now() - started;

        expect(rows).toHaveLength(5000);
        expect(rows[0]?.seq).toBe(1);
        expect(rows.at(-1)?.seq).toBe(5000);
        expect(durationMs).toBeLessThan(50);
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
});
