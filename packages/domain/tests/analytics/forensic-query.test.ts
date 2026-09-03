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
    cacheWasteAggregate,
    drift,
    loops,
    messageRollup,
    sourceSummary,
    stepSupport,
    toolRollup,
    topCacheWasteSteps,
    topStepsByDuration,
    topStepsByTokens,
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
    await adapter.exec(`CREATE TABLE history_run_session (
        run_id TEXT NOT NULL, source TEXT NOT NULL, session_id TEXT, exactness TEXT NOT NULL,
        mechanism TEXT NOT NULL, resolved_at TEXT NOT NULL
    )`);
    await adapter.exec('CREATE INDEX idx_history_run_session_run ON history_run_session (run_id)');
    await adapter.exec(
        'CREATE INDEX idx_history_run_session_source_session ON history_run_session (source, session_id)',
    );
    await adapter.exec(`CREATE TABLE task_run_links (
        id TEXT PRIMARY KEY, wbs TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    // Direct task↔session authority (0028_spur_cli_history_task_session, task 0722).
    await adapter.exec(`CREATE TABLE history_task_session (
        wbs TEXT NOT NULL, source TEXT NOT NULL, session_id TEXT NOT NULL,
        exactness TEXT NOT NULL, mechanism TEXT NOT NULL, evidence_kind TEXT NOT NULL,
        evidence_ref TEXT, resolved_at TEXT NOT NULL,
        PRIMARY KEY (wbs, source, session_id)
    )`);
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
    provenance?: string;
    run_id?: string | null;
    task_wbs?: string | null;
    duration_ms?: number | null;
}

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
             cache_read_tokens, provenance, run_id, task_wbs, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    // Direct run/task columns stay null: mapping tables are the selector authority.
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
    });

    await db.run(
        `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at)
         VALUES ('run-1', 'claude', 'sess-1', 'exact', 'observed', '2026-06-01T00:00:00Z')`,
    );
    await db.run(
        `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at)
         VALUES ('fixture-link', '0042', 'run-1', 'task', '2026-06-01T00:00:00Z')`,
    );

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
    test('messageRollup folds duplicate request_id rows in SQL (0624 R1)', async () => {
        const db = await setup();
        // Claude streams cumulative usage under one request_id. The final row
        // must win; MIN(rowid) silently undercounted real responses.
        for (const [hash, seq, output, cost] of [
            ['d1', 1, 25, 0.005],
            ['d2', 2, 40, 0.008],
            ['d3', 3, 50, 0.01],
        ] as const) {
            await db.run(
                `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                     role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
                     cache_read_tokens, provenance, run_id, task_wbs, duration_ms, request_id, imported_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                hash,
                'claude',
                'test.jsonl',
                1,
                'sess-dup',
                seq,
                'assistant',
                'assistant',
                'keep',
                '2026-05-30T00:00:00.000Z',
                'claude-x',
                100,
                output,
                cost,
                null,
                'agent',
                null,
                null,
                null,
                'req_dup',
                '2026-06-01T00:00:00Z',
            );
        }
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
                 cache_read_tokens, provenance, run_id, task_wbs, duration_ms, request_id, imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            'd4',
            'claude',
            'test.jsonl',
            1,
            'sess-dup',
            4,
            'user',
            'user',
            'keep',
            '2026-05-30T00:00:00.000Z',
            null,
            null,
            null,
            null,
            null,
            'agent',
            null,
            null,
            null,
            null,
            '2026-06-01T00:00:00Z',
        );
        const rows = await messageRollup(db, { ...ALL, sessionId: 'sess-dup' });
        expect(rows.reduce((n, r) => n + r.messages, 0)).toBe(2);
        const assistant = rows.find((r) => r.model === 'claude-x');
        expect(assistant?.inputTokens).toBe(100);
        expect(assistant?.outputTokens).toBe(50);
        expect(assistant?.costUsd).toBeCloseTo(0.01);
        db.close();
    });

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
        expect(rows[0]?.messages).toBe(4);
        expect(rows[0]?.toolCalls).toBe(5);
        expect(rows[0]?.topTool).toBe('Read');
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

    test('--run/--task selectors resolve through mapping authorities when message columns are null (0638 R5)', async () => {
        const db = await setup();
        await seedFixture(db);

        const byRun = await messageRollup(db, { ...ALL, runId: 'run-1' });
        expect(byRun.reduce((sum, row) => sum + row.messages, 0)).toBe(4);
        const byTask = await messageRollup(db, { ...ALL, taskWbs: '0042' });
        expect(byTask.reduce((sum, row) => sum + row.messages, 0)).toBe(4);
        const wrongPair = await messageRollup(db, { ...ALL, runId: 'run-1', taskWbs: '9999' });
        expect(wrongPair).toEqual([]);
        // Task 0722 R5: a task with NO run chain still matches through the direct
        // authority for exactly the mapped (source, session) pairs.
        await db.run(
            `INSERT INTO history_task_session (wbs, source, session_id, exactness, mechanism, evidence_kind, evidence_ref, resolved_at)
             VALUES ('0722', 'claude', 'sess-1', 'estimated', 'slash-command', 'user-command', 'a.jsonl#1', '2026-06-01T00:00:00Z')`,
        );
        const viaDirect = await messageRollup(db, { ...ALL, taskWbs: '0722' });
        expect(viaDirect.reduce((sum, row) => sum + row.messages, 0)).toBe(4); // sess-1 only
        // Other sessions of the same source stay outside the direct mapping.
        const scoped = await messageRollup(db, { ...ALL, taskWbs: '0722', sessionId: 'sess-2' });
        expect(scoped).toEqual([]);
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
        expect(where).toContain('history_run_session hrs_scope');
        expect(where).toContain('task_run_links trl_scope');
        expect(where).toContain('hrs_scope.source = m.source');
        expect(where).toContain('hrs_scope.session_id = m.session_id');
        expect(where).not.toContain('m.run_id');
        expect(where).not.toContain('m.task_wbs');
        expect(where).toContain('AND');
        expect(params).toHaveLength(7);
    });

    test('task-only selector unions the run chain with the direct authority (0722 R5)', () => {
        const { where, params } = buildMessageWhere({
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: null,
            taskWbs: '0722',
        });
        expect(where).toContain('history_run_session hrs_scope');
        expect(where).toContain('task_run_links trl_scope');
        expect(where).toContain('history_task_session hts_scope');
        expect(where).toContain('hts_scope.source = m.source');
        expect(where).toContain('hts_scope.session_id = m.session_id');
        // The WBS parameter is pushed once per authority branch.
        expect(params).toEqual(['0722', '0722']);
    });

    test('task+run selector keeps intersection semantics through the run chain only (0722 R5)', () => {
        const { where } = buildMessageWhere({
            since: null,
            until: null,
            sources: null,
            sessionId: null,
            runId: 'run-1',
            taskWbs: '0722',
        });
        // The direct-authority branch belongs to the task-only path; the
        // task+run intersection must not be widened by it.
        expect(where).not.toContain('history_task_session');
        expect(where).toContain('trl_scope.wbs = ?');
        expect(where).toContain('hrs_scope.session_id IS NOT NULL');
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
    //
    // Carve-out: the `MESSAGE_DEDUP` predicate. It is a WHERE-clause existence check
    // (`NOT EXISTS (SELECT 1 FROM ... )`) that returns at most one row per evaluation and
    // never materializes an array, so it cannot violate R2 — but the regex sees its
    // `FROM history_message` and would flag it. It carries no GROUP BY / LIMIT because
    // either collapses the correlated subquery to a 10s plan (measured on a 1.7M-row
    // corpus) where the bare NOT EXISTS is ~0.5s. The scan it sits inside is bounded by
    // the enclosing query's GROUP BY / LIMIT.
    const queries = [...noComments.matchAll(/`([^`]*\bFROM\s+history_(?:message|tool_call)[^`]*)`/g)]
        .map((m) => m[1])
        .filter((q): q is string => q !== undefined)
        .filter((q) => !/^\(m\.request_id IS NULL OR NOT EXISTS/.test(q));

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

describe('task 0581 — per-step rankings and cache waste (R2-bounded)', () => {
    // Dedicated fixture: cache-read tokens and multi-source rows the shared
    // seedFixture does not carry.
    async function stepFixture(db: DbAdapter): Promise<void> {
        await insertMessage(db, {
            record_hash: 'w1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'conversation',
            ts: '2026-06-01T00:00:00Z',
            model: 'deepseek-v4-flash',
            input: 200_000,
            output: 1000,
            cache_read: 50,
            duration_ms: 1000,
        });
        await insertMessage(db, {
            record_hash: 'w2',
            session_id: 's1',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'conversation',
            ts: '2026-06-01T00:01:00Z',
            model: 'deepseek-v4-flash',
            input: 8000,
            output: 200,
            cache_read: null,
            duration_ms: null,
        });
        await insertMessage(db, {
            record_hash: 'w3',
            session_id: 's2',
            seq: 1,
            role: 'user',
            record_type: 'message',
            disposition: 'conversation',
            ts: '2026-06-01T00:02:00Z',
            model: 'deepseek-v4-flash',
            input: 999_999,
            output: 0,
            cache_read: 999_999,
            duration_ms: 500,
        });
        await insertMessage(db, {
            record_hash: 'w4',
            session_id: 's2',
            seq: 2,
            role: 'assistant',
            record_type: 'message',
            disposition: 'conversation',
            ts: '2026-06-01T00:03:00Z',
            model: 'glm-5.1',
            input: 500,
            output: null,
            cache_read: 0,
            duration_ms: 123,
        });
    }

    test('topStepsByTokens ranks assistant steps by input+cache-read, top-bounded (Q11)', async () => {
        const db = await setup();
        await stepFixture(db);
        const rows = await topStepsByTokens(db, ALL, 2);
        expect(rows).toHaveLength(2);
        // w3 is a user row — excluded by the role filter; w1 (200_000 + 50) tops w2 (8000 + 0).
        expect(rows[0]?.inputTokens).toBe(200_000);
        expect(rows[0]?.model).toBe('deepseek-v4-flash');
        expect(rows[1]?.inputTokens).toBe(8000);
        db.close();
    });

    test('topStepsByTokens keeps NULL-usage assistant steps out of the ranking (Q11)', async () => {
        const db = await setup();
        await stepFixture(db);
        const rows = await topStepsByTokens(db, ALL, 10);
        expect(rows).toHaveLength(3); // w1, w2, w4 — all assistant with usage present
        // w3 (user, 999_999 input) never appears; NULL cache never nullifies input.
        expect(rows.some((r) => r.inputTokens === 999_999)).toBe(false);
        db.close();
    });

    test('topStepsByDuration excludes steps with NULL duration, top-bounded (Q12)', async () => {
        const db = await setup();
        await stepFixture(db);
        const rows = await topStepsByDuration(db, ALL, 2);
        expect(rows).toHaveLength(2);
        expect(rows[0]?.sessionId).toBe('s1'); // w1 1000ms — top
        expect(rows[0]?.durationMs).toBe(1000);
        expect(rows[1]?.inputTokens).toBe(500); // w4 123ms — second; w2 NULL excluded
        db.close();
    });

    test('cacheWasteAggregate counts only measured low-reuse assistant steps (Q13a)', async () => {
        const db = await setup();
        await stepFixture(db);
        const row = await cacheWasteAggregate(db, ALL);
        // w1: 200_000 input, 50 cache-read (`< 10%`) — matches; w2: 8000 input — below the
        // 100_000 floor; w4: 500 input — below the floor. NULL-cache rows never compare true.
        expect(row?.steps).toBe(1);
        expect(row?.inputTokens).toBe(200_000);
        db.close();
    });

    test('topCacheWasteSteps bounds offenders by input tokens (Q13b)', async () => {
        const db = await setup();
        await stepFixture(db);
        const rows = await topCacheWasteSteps(db, ALL, 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.inputTokens).toBe(200_000);
        db.close();
    });

    test('stepSupport reports per-source assistant counts and section support (Q14)', async () => {
        const db = await setup();
        // w1/w2/w4 (claude) + a second source so the grouping is meaningful.
        await stepFixture(db);
        await insertMessage(db, {
            record_hash: 'g1',
            session_id: 's3',
            seq: 1,
            role: 'assistant',
            record_type: 'message',
            disposition: 'conversation',
            ts: '2026-06-01T00:04:00Z',
            model: 'glm-5.1',
            input: null,
            output: null,
            cache_read: null,
            duration_ms: null,
            source: 'glm',
        });
        const rows = await stepSupport(db, ALL);
        expect(rows).toHaveLength(2);
        const claude = rows.find((r) => r.source === 'claude');
        expect(claude?.assistantSteps).toBe(3); // w1, w2, w4
        expect(claude?.stepsWithUsage).toBe(3);
        expect(claude?.stepsWithDuration).toBe(2); // w2 NULL duration
        expect(claude?.stepsWithCacheRead).toBe(2); // w2 cache_read NULL
        const glm = rows.find((r) => r.source === 'glm');
        expect(glm?.assistantSteps).toBe(1);
        expect(glm?.stepsWithUsage).toBe(0);
        expect(glm?.stepsWithDuration).toBe(0);
        expect(glm?.stepsWithCacheRead).toBe(0);
        db.close();
    });
});
