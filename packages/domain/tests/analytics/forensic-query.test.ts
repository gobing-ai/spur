import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import {
    buildMessageWhere,
    bySession,
    byTool,
    drift,
    loops,
    messageRollup,
    sourceSummary,
    toolRollup,
} from '../../src/analytics/forensic-query';

const SESSION: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    sessionId: 'sess-1',
    runId: null,
    taskWbs: null,
};

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
    // exec() runs a single statement; the importer schema is multi-statement DDL.
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    // The (provenance, run_id) index this task adds Spur-side (0009 migration) must
    // exist here so the --run/--task EXPLAIN check resolves against it.
    await adapter.exec(
        'CREATE INDEX IF NOT EXISTS idx_history_message_provenance_run ON history_message (provenance, run_id)',
    );
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
    provenance?: string;
    run_id?: string | null;
    task_wbs?: string | null;
    duration_ms?: number | null;
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
        m.role,
        m.record_type,
        m.disposition,
        m.ts,
        m.model,
        m.input ?? null,
        m.output ?? null,
        m.cost ?? null,
        m.provenance ?? 'agent',
        m.run_id ?? null,
        m.task_wbs ?? null,
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
    args_digest: string | null;
    status: string;
    duration_ms: number | null;
    result_bytes: number | null;
}

async function insertToolCall(db: DbAdapter, t: ToolCall): Promise<void> {
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
        t.tool_name,
        t.args_digest,
        t.status,
        t.duration_ms,
        t.result_bytes,
        '2026-06-01T00:00:00Z',
    );
}

/** Seed one session with four messages and five tool calls (Read/abc repeats >= 3). */
async function seedFixture(db: DbAdapter): Promise<void> {
    await insertMessage(db, {
        record_hash: 'm1',
        session_id: 'sess-1',
        seq: 1,
        role: 'assistant',
        record_type: 'message',
        disposition: 'conversation',
        ts: '2026-05-30T10:00:00Z',
        model: 'claude-opus-5',
        input: 1000,
        output: 500,
        cost: 0.05,
        duration_ms: 3000,
    });
    await insertMessage(db, {
        record_hash: 'm2',
        session_id: 'sess-1',
        seq: 2,
        role: 'assistant',
        record_type: 'message',
        disposition: 'conversation',
        ts: '2026-05-30T10:01:00Z',
        model: 'claude-opus-5',
        input: 500,
        output: 200,
        cost: 0.02,
        duration_ms: 5000,
    });
    // Unknown-disposition record (no usage, no model) — feeds Q10 drift.
    await insertMessage(db, {
        record_hash: 'm3',
        session_id: 'sess-1',
        seq: 3,
        role: 'assistant',
        record_type: 'id+ts+content',
        disposition: 'unknown',
        ts: '2026-05-31T10:00:00Z',
        model: null,
        duration_ms: null,
    });
    // Spur-run attributed record — feeds --run/--task selectors.
    await insertMessage(db, {
        record_hash: 'm4',
        session_id: 'sess-1',
        seq: 4,
        role: 'assistant',
        record_type: 'message',
        disposition: 'conversation',
        ts: '2026-05-31T11:00:00Z',
        model: 'claude-opus-5',
        input: 100,
        output: 0,
        cost: 0,
        duration_ms: 2000,
        provenance: 'spur-run',
        run_id: 'run-1',
        task_wbs: '0042',
    });

    await insertToolCall(db, {
        record_hash: 'tc1',
        message_hash: 'm1',
        session_id: 'sess-1',
        seq: 1,
        tool_name: 'Read',
        args_digest: 'abc',
        status: 'success',
        duration_ms: 100,
        result_bytes: 5000,
    });
    await insertToolCall(db, {
        record_hash: 'tc2',
        message_hash: 'm1',
        session_id: 'sess-1',
        seq: 2,
        tool_name: 'Bash',
        args_digest: 'def',
        status: 'error',
        duration_ms: 200,
        result_bytes: 1000,
    });
    await insertToolCall(db, {
        record_hash: 'tc3',
        message_hash: 'm2',
        session_id: 'sess-1',
        seq: 3,
        tool_name: 'Read',
        args_digest: 'abc',
        status: 'success',
        duration_ms: 150,
        result_bytes: 5000,
    });
    await insertToolCall(db, {
        record_hash: 'tc4',
        message_hash: 'm2',
        session_id: 'sess-1',
        seq: 4,
        tool_name: 'Read',
        args_digest: 'abc',
        status: 'success',
        duration_ms: 90,
        result_bytes: 5000,
    });
    // Unmeasured duration (NULL) — feeds R5 carry-through.
    await insertToolCall(db, {
        record_hash: 'tc5',
        message_hash: 'm3',
        session_id: 'sess-1',
        seq: 5,
        tool_name: 'Bash',
        args_digest: null,
        status: 'success',
        duration_ms: null,
        result_bytes: 0,
    });
}

describe('forensic queries', () => {
    test('messageRollup reports per-step token/cost buckets (Q8)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await messageRollup(db, SESSION);
        expect(rows.reduce((n, r) => n + r.messages, 0)).toBe(4);

        const may30 = rows.find((r) => r.day === '2026-05-30');
        expect(may30?.messages).toBe(2);
        expect(may30?.inputTokens).toBe(1500);
        expect(may30?.outputTokens).toBe(700);
        expect(may30?.costUsd).toBeCloseTo(0.07);
        expect(may30?.recordsWithUsage).toBe(2);
        // Assistant duration is role-filtered and additive (0507 R2).
        expect(may30?.assistantDurationMs).toBe(8000); // m1 3000 + m2 5000
        expect(may30?.assistantDurationUnmeasured).toBe(0);
        db.close();
    });

    test('toolRollup reports duration and unmeasured count (Q1)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await toolRollup(db, SESSION);
        expect(rows.reduce((n, r) => n + r.toolCalls, 0)).toBe(5);
        expect(rows.reduce((n, r) => n + (r.durationMs ?? 0), 0)).toBe(540);
        expect(rows.reduce((n, r) => n + r.durationUnmeasured, 0)).toBe(1);
        db.close();
    });

    test('byTool ranks tools by total duration with calls, errors, and result bytes (Q1+Q3+Q6)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await byTool(db, SESSION, 10);
        expect(rows[0]?.toolName).toBe('Read');
        const read = rows.find((r) => r.toolName === 'Read');
        expect(read?.calls).toBe(3);
        expect(read?.errors).toBe(0);
        expect(read?.durationMsTotal).toBe(340);
        expect(read?.durationMsMax).toBe(150);
        expect(read?.resultBytes).toBe(15000);

        const bash = rows.find((r) => r.toolName === 'Bash');
        expect(bash?.calls).toBe(2);
        expect(bash?.errors).toBe(1);
        expect(bash?.durationMsTotal).toBe(200);
        expect(bash?.durationUnmeasured).toBe(1);
        db.close();
    });

    test('byTool honors the top-N limit (Q5/Q8 leaderboard depth)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await byTool(db, SESSION, 1);
        expect(rows).toHaveLength(1);
        db.close();
    });

    test('bySession reports the session leaderboard with topTool (Q5)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await bySession(db, SESSION, 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.sessionId).toBe('sess-1');
        expect(rows[0]?.messages).toBe(4);
        expect(rows[0]?.toolCalls).toBe(5);
        expect(rows[0]?.tokens).toBe(2300);
        expect(rows[0]?.costUsd).toBeCloseTo(0.07);
        expect(rows[0]?.topTool).toBe('Read');
        // m3 is an assistant message with NULL duration → unmeasured count, not a zero sum.
        expect(rows[0]?.assistantDurationMs).toBe(10000); // m1 3000 + m2 5000 + m4 2000
        expect(rows[0]?.assistantDurationUnmeasured).toBe(1); // m3
        db.close();
    });

    test('bySession honors the time-window selector for tool calls (F1 regression)', async () => {
        const db = await setup();
        await seedFixture(db);
        const may30: ArtifactSelector = {
            since: '2026-05-30T00:00:00Z',
            until: '2026-05-30T23:59:59Z',
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };
        const rows = await bySession(db, may30, 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.messages).toBe(2); // m1 + m2 only
        expect(rows[0]?.toolCalls).toBe(4); // tc1-tc4 (parent messages m1/m2 in window); tc5 excluded
        expect(rows[0]?.topTool).toBe('Read'); // 3 Read vs 1 Bash in window
        expect(rows[0]?.tokens).toBe(2200);
        expect(rows[0]?.costUsd).toBeCloseTo(0.07);
        db.close();
    });

    test('bySession honors the --run selector for tool calls (F1 regression)', async () => {
        const db = await setup();
        await seedFixture(db);
        const runSel: ArtifactSelector = {
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: 'run-1',
            taskWbs: null,
        };
        const rows = await bySession(db, runSel, 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.messages).toBe(1); // m4 only
        expect(rows[0]?.toolCalls).toBe(0); // m4 has no tool calls; old code reported 5 (F1)
        expect(rows[0]?.topTool).toBe(null);
        db.close();
    });

    test('loops surfaces the repeated-call finding (Q4, repeats >= 3)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await loops(db, SESSION);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.toolName).toBe('Read');
        expect(rows[0]?.argsDigest).toBe('abc');
        expect(rows[0]?.repeats).toBe(3);
        expect(rows[0]?.firstSeq).toBe(1);
        expect(rows[0]?.lastSeq).toBe(4);
        db.close();
    });

    test('drift counts unknown-disposition records (Q10)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await drift(db, SESSION);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.source).toBe('claude');
        expect(rows[0]?.recordType).toBe('id+ts+content');
        expect(rows[0]?.n).toBe(1);
        db.close();
    });

    test('sourceSummary reports per-source files, messages, last import (coverage fodder)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await sourceSummary(db, ALL);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.source).toBe('claude');
        expect(rows[0]?.files).toBe(1);
        expect(rows[0]?.messages).toBe(4);
        expect(rows[0]?.lastImportedAt).toBe('2026-06-01T00:00:00Z');
        db.close();
    });

    test('selectors compose as AND (R3): time window + source + session', async () => {
        const db = await setup();
        await seedFixture(db);
        const narrowed: ArtifactSelector = {
            since: '2026-05-31T00:00:00Z',
            until: null,
            sources: ['claude'],
            sessionId: 'sess-1',
            runId: null,
            taskWbs: null,
        };
        const rows = await messageRollup(db, narrowed);
        expect(rows.reduce((n, r) => n + r.messages, 0)).toBe(2); // m3 + m4 only
        db.close();
    });

    test('all-sources (null) applies no source predicate (R3)', async () => {
        const db = await setup();
        await seedFixture(db);
        const rows = await messageRollup(db, ALL);
        expect(rows.reduce((n, r) => n + r.messages, 0)).toBe(4);
        db.close();
    });

    test('--run/--task selectors resolve against the (provenance, run_id) index (R3)', async () => {
        const db = await setup();
        await seedFixture(db);
        // Seed enough rows that the planner prefers the index over a full scan. A tiny
        // fixture would always "SCAN" regardless of indexes, so this test needs real
        // selectivity to prove the --run/--task path is index-backed.
        await db.exec(`
            INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                role, record_type, disposition, ts, provenance, run_id, task_wbs, imported_at)
            SELECT 'bulk'||x, 'claude', 'bulk.jsonl', 1, 's'||(x%50), x, 'assistant', 'message', 'conversation',
                datetime('2026-01-01','+'||(x%1000)||' minutes'),
                CASE WHEN x%2=0 THEN 'spur-run' ELSE 'agent' END,
                CASE WHEN x%2=0 THEN 'run-'||(x%100) ELSE NULL END,
                CASE WHEN x%2=0 THEN '0042' ELSE NULL END,
                '2026-06-01'
            FROM (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2000) SELECT x FROM c)`);
        await db.exec('ANALYZE');

        const runWhere = buildMessageWhere({ ...ALL, runId: 'run-5' });
        const runPlan = await db.queryAll<{ detail: string }>(
            `EXPLAIN QUERY PLAN SELECT m.source FROM history_message m ${runWhere.where}`,
            ...runWhere.params,
        );
        expect(runPlan.map((p) => p.detail).join('\n')).toContain('idx_history_message_provenance_run');

        const taskWhere = buildMessageWhere({ ...ALL, taskWbs: '0042' });
        const taskPlan = await db.queryAll<{ detail: string }>(
            `EXPLAIN QUERY PLAN SELECT m.source FROM history_message m ${taskWhere.where}`,
            ...taskWhere.params,
        );
        expect(taskPlan.map((p) => p.detail).join('\n')).toContain('idx_history_message_provenance_run');
        db.close();
    });

    test('buildMessageWhere emits every predicate in AND order (R3)', () => {
        const { where, params } = buildMessageWhere({
            since: '2026-05-31T00:00:00Z',
            until: '2026-06-01T00:00:00Z',
            sources: ['claude', 'codex'],
            sessionId: 'sess-1',
            runId: 'run-1',
            taskWbs: '0042',
        });
        expect(where).toContain('m.ts >= ?');
        expect(where).toContain('m.ts <= ?');
        expect(where).toContain('m.source IN (?, ?)');
        expect(where).toContain('m.session_id = ?');
        // --run/--task must predicate the leading index column so the index is usable.
        expect(where).toContain("m.provenance = 'spur-run'");
        expect(where).toContain('m.run_id = ?');
        expect(where).toContain('m.task_wbs = ?');
        expect(where).toContain('AND');
        expect(params).toHaveLength(7);
    });
});

// ---------------------------------------------------------------------------
// R2 structural invariant (task 0474, plan step 10): no analyze code path may
// materialize the corpus. Every query over history_message / history_tool_call
// must carry a `GROUP BY` or a `LIMIT` — a bare `SELECT ... FROM history_message`
// would return an array whose length grows with the row count and is a hard R2
// failure regardless of what a benchmark says. This test reads the query source
// and fails the suite the moment such a query is added.
// ---------------------------------------------------------------------------
describe('R2 structural invariant — every corpus query is bounded', () => {
    const source = readFileSync(join(import.meta.dir, '../../src/analytics/forensic-query.ts'), 'utf8');
    // Drop comments (block + line) so prose examples like `` `SELECT ... FROM history_message` `` in
    // docs are not mistaken for real queries.
    const noComments = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\n\s*\*[^\n]*/g, '\n');
    // SQL template literals that scan a corpus table. The forensic queries are the
    // only place these two tables appear in an aggregate; a builder helper like
    // `buildMessageWhere` (no FROM) must not be flagged.
    const queries = [...noComments.matchAll(/`([^`]*\bFROM\s+history_(?:message|tool_call)[^`]*)`/g)]
        .map((m) => m[1])
        .filter((q): q is string => q !== undefined);

    test('the query set is non-empty', () => {
        expect(queries.length).toBeGreaterThan(0);
    });

    test('every corpus query carries GROUP BY or LIMIT', () => {
        const offenders = queries.filter((sql) => !/\bGROUP\s+BY\b/i.test(sql) && !/\bLIMIT\s+\?/i.test(sql));
        expect(offenders).toEqual([]);
    });

    test('no query SELECTs a bare corpus table without an aggregate', () => {
        // A `SELECT <expr> FROM history_...` with no GROUP BY and no LIMIT is the
        // load-the-corpus anti-pattern. Every aggregate has GROUP BY; the only
        // non-grouped corpus query allowed is one bounded by `LIMIT ?`.
        for (const sql of queries) {
            const isGrouped = /\bGROUP\s+BY\b/i.test(sql);
            const isBounded = /\bLIMIT\s+\?/i.test(sql);
            if (!isGrouped && !isBounded) {
                throw new Error(`Unbounded corpus query (R2 violation): ${sql}`);
            }
        }
    });
});
