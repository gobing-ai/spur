import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import { HISTORY_ARTIFACT_SCHEMA_VERSION } from '../../src/analytics/artifact';
import {
    computeDerived,
    derivedWarnings,
    emptyDerived,
    extractPhases,
    parseTodoItems,
} from '../../src/analytics/derived';
import { sessionSpans, sessionToolDurations, todoToolCalls } from '../../src/analytics/forensic-query';
import { assertArtifactVersion } from '../../src/analytics/render-report';
import { applyCliMigrations } from '../../src/migrations';

const ALL: ArtifactSelector = {
    since: null,
    until: null,
    sources: null,
    sessionId: null,
    runId: null,
    taskWbs: null,
};

const T0 = '2026-01-01T00:00:00Z';
const T10 = '2026-01-01T00:00:10Z';
const T110 = '2026-01-01T00:01:50Z';

async function setup(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await adapter.exec(statement);
    }
    // 0012 adds args_raw to history_tool_call (importer 0.4.32 schema lacks it).
    await applyCliMigrations(adapter);
    return adapter;
}

interface Msg {
    record_hash: string;
    session_id: string;
    seq: number;
    role: string;
    ts: string;
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
        'message',
        'ok',
        m.ts,
        null,
        null,
        null,
        null,
        'agent',
        null,
        null,
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
    args_raw?: string | null;
    duration_ms?: number | null;
}

async function insertToolCall(db: DbAdapter, t: ToolCall): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_digest, args_raw, status, duration_ms, result_bytes, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.record_hash,
        t.message_hash,
        'claude',
        'test.jsonl',
        1,
        t.session_id,
        t.seq,
        t.tool_name,
        'digest',
        t.args_raw ?? null,
        'ok',
        t.duration_ms ?? null,
        0,
        '2026-06-01T00:00:00Z',
    );
}

/** Seed one fully-measured session: span 110s, llm 5000ms, tool 1500ms, one todo pair. */
async function seedMeasuredSession(db: DbAdapter): Promise<void> {
    await insertMessage(db, { record_hash: 'm1', session_id: 's1', seq: 1, role: 'user', ts: T0 });
    await insertMessage(db, {
        record_hash: 'm2',
        session_id: 's1',
        seq: 2,
        role: 'assistant',
        ts: T10,
        duration_ms: 3000,
    });
    await insertMessage(db, { record_hash: 'm3', session_id: 's1', seq: 3, role: 'user', ts: '2026-01-01T00:01:40Z' });
    await insertMessage(db, {
        record_hash: 'm4',
        session_id: 's1',
        seq: 4,
        role: 'assistant',
        ts: T110,
        duration_ms: 2000,
    });
    await insertToolCall(db, {
        record_hash: 't1',
        message_hash: 'm2',
        session_id: 's1',
        seq: 1,
        tool_name: 'Read',
        duration_ms: 1000,
    });
    await insertToolCall(db, {
        record_hash: 't2',
        message_hash: 'm4',
        session_id: 's1',
        seq: 2,
        tool_name: 'Read',
        duration_ms: 500,
    });
    await insertToolCall(db, {
        record_hash: 't3',
        message_hash: 'm2',
        session_id: 's1',
        seq: 3,
        tool_name: 'TodoWrite',
        duration_ms: 0,
        args_raw: JSON.stringify({
            todos: [
                { content: 'phase A', status: 'in_progress' },
                { content: 'phase B', status: 'pending' },
            ],
        }),
    });
    await insertToolCall(db, {
        record_hash: 't4',
        message_hash: 'm4',
        session_id: 's1',
        seq: 4,
        tool_name: 'TodoWrite',
        duration_ms: 0,
        args_raw: JSON.stringify({
            todos: [
                { content: 'phase A', status: 'completed' },
                { content: 'phase B', status: 'in_progress' },
            ],
        }),
    });
}

// ---------------------------------------------------------------------------
// parseTodoItems
// ---------------------------------------------------------------------------

describe('parseTodoItems', () => {
    test('parses the Claude/OMP/Pi/Grok {todos:[{content,status}]} shape', () => {
        const items = parseTodoItems(
            'claude',
            JSON.stringify({
                todos: [
                    { content: 'a', status: 'in_progress' },
                    { content: 'b', status: 'completed' },
                ],
            }),
        );
        expect(items).toEqual([
            { content: 'a', status: 'in_progress' },
            { content: 'b', status: 'completed' },
        ]);
    });

    test('parses the Codex {plan:[{step,status}]} shape', () => {
        const items = parseTodoItems('codex', JSON.stringify({ plan: [{ step: 'write tests', status: 'completed' }] }));
        expect(items).toEqual([{ content: 'write tests', status: 'completed' }]);
    });

    test('malformed JSON yields an empty list, not a throw', () => {
        expect(parseTodoItems('claude', 'not json')).toEqual([]);
    });

    test('entries without a non-empty content string are dropped', () => {
        const items = parseTodoItems(
            'claude',
            JSON.stringify({
                todos: [
                    { content: '', status: 'pending' },
                    { status: 'pending' },
                    'garbage',
                    { content: 'kept', status: 'pending' },
                ],
            }),
        );
        expect(items).toEqual([{ content: 'kept', status: 'pending' }]);
    });

    test('parses the Pi {todoList:[{title,status}]} shape with hyphenated statuses (task 0578 R3)', () => {
        const items = parseTodoItems('pi', JSON.stringify({ todoList: [{ title: 't1', status: 'in-progress' }] }));
        expect(items).toEqual([{ content: 't1', status: 'in_progress' }]);
    });

    test('parses the OMP todo {ops:[...]} shape — start/done/init/append (task 0578 R3)', () => {
        const items = parseTodoItems(
            'omp',
            JSON.stringify({
                ops: [
                    { op: 'init', list: [{ phase: 'Scout', items: ['a', 'b'] }] },
                    { op: 'start', task: 'a' },
                    { op: 'append', items: ['c'] },
                    { op: 'done', task: 'a' },
                ],
            }),
        );
        expect(items).toEqual([
            { content: 'a', status: 'pending' },
            { content: 'b', status: 'pending' },
            { content: 'a', status: 'in_progress' },
            { content: 'c', status: 'pending' },
            { content: 'a', status: 'completed' },
        ]);
    });

    test('OMP todo_write still parses via the {todos} shape', () => {
        const items = parseTodoItems('omp', JSON.stringify({ todos: [{ content: 'x', status: 'pending' }] }));
        expect(items).toEqual([{ content: 'x', status: 'pending' }]);
    });
});

// ---------------------------------------------------------------------------
// extractPhases
// ---------------------------------------------------------------------------

describe('extractPhases', () => {
    test('startedAt = first in_progress ts, endedAt = first completed ts', () => {
        const calls = [
            {
                sessionId: 's1',
                source: 'claude',
                ts: T10,
                toolName: 'TodoWrite',
                argsRaw: JSON.stringify({ todos: [{ content: 'A', status: 'in_progress' }] }),
            },
            {
                sessionId: 's1',
                source: 'claude',
                ts: T110,
                toolName: 'TodoWrite',
                argsRaw: JSON.stringify({ todos: [{ content: 'A', status: 'completed' }] }),
            },
        ];
        const phases = extractPhases(calls);
        expect(phases).toEqual([{ name: 'A', startedAt: T10, endedAt: T110, source: 'todo' }]);
    });

    test('never-completed phase falls back to the session last todo-call ts', () => {
        const calls = [
            {
                sessionId: 's1',
                source: 'claude',
                ts: T10,
                toolName: 'TodoWrite',
                argsRaw: JSON.stringify({ todos: [{ content: 'B', status: 'pending' }] }),
            },
            {
                sessionId: 's1',
                source: 'claude',
                ts: T110,
                toolName: 'TodoWrite',
                argsRaw: JSON.stringify({ todos: [{ content: 'B', status: 'in_progress' }] }),
            },
        ];
        const phases = extractPhases(calls);
        expect(phases).toEqual([{ name: 'B', startedAt: T110, endedAt: T110, source: 'todo' }]);
    });

    test('phases stay per-session — same content in two sessions yields two phases', () => {
        const calls = [
            {
                sessionId: 's1',
                source: 'claude',
                ts: T10,
                toolName: 'TodoWrite',
                argsRaw: JSON.stringify({ todos: [{ content: 'A', status: 'completed' }] }),
            },
            {
                sessionId: 's2',
                source: 'claude',
                ts: T110,
                toolName: 'TodoWrite',
                argsRaw: JSON.stringify({ todos: [{ content: 'A', status: 'completed' }] }),
            },
        ];
        expect(extractPhases(calls)).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// computeDerived — end-to-end through the real SQL queries
// ---------------------------------------------------------------------------

describe('computeDerived via SQL', () => {
    test('fully-measured session: decomposition sums to span; idle dominates bottlenecks', async () => {
        const db = await setup();
        await seedMeasuredSession(db);

        const [spans, tools, todos] = await Promise.all([
            sessionSpans(db, ALL),
            sessionToolDurations(db, ALL),
            todoToolCalls(db, ALL),
        ]);
        const derived = computeDerived(spans, tools, todos);

        // Span: T0 → T110 = 110_000ms. LLM 3000+2000, tool 1000+500, all measured.
        const { llmMs, toolMs, idleMs, unattributedMs, spanMs } = derived.timeDecomposition;
        expect(spanMs).toBe(110_000);
        expect(llmMs).toBe(5000);
        expect(toolMs).toBe(1500);
        expect(unattributedMs).toBe(0);
        expect(llmMs + toolMs + idleMs + unattributedMs).toBe(spanMs);
        expect(idleMs).toBe(103_500);

        // Bottlenecks: only ms > 0 entries, ranked desc, share = ms/span.
        expect(derived.bottlenecks.map((b) => b.label)).toEqual(['idle', 'llm', 'tool']);
        for (const b of derived.bottlenecks) {
            expect(b.share).toBeCloseTo(b.ms / spanMs, 6);
        }

        // Phases: A completed between the two todo calls; B still open at the last call.
        expect(derived.phases.phaseSupport).toBe('supported');
        const phaseA = derived.phases.phases.find((p) => p.name === 'phase A');
        const phaseB = derived.phases.phases.find((p) => p.name === 'phase B');
        expect(phaseA).toEqual({ name: 'phase A', startedAt: T10, endedAt: T110, source: 'todo' });
        expect(phaseB?.endedAt).toBe(T110);

        // Fully-measured ⇒ no derived warnings.
        expect(derivedWarnings(derived)).toEqual([]);
    });

    test('unmeasured durations route the remainder to unattributedMs and emit a warning', async () => {
        const db = await setup();
        await insertMessage(db, { record_hash: 'm1', session_id: 's1', seq: 1, role: 'user', ts: T0 });
        await insertMessage(db, { record_hash: 'm2', session_id: 's1', seq: 2, role: 'assistant', ts: T110 }); // duration NULL
        await insertToolCall(db, {
            record_hash: 't1',
            message_hash: 'm2',
            session_id: 's1',
            seq: 1,
            tool_name: 'Read',
            // duration NULL
        });

        const [spans, tools, todos] = await Promise.all([
            sessionSpans(db, ALL),
            sessionToolDurations(db, ALL),
            todoToolCalls(db, ALL),
        ]);
        const derived = computeDerived(spans, tools, todos);

        expect(derived.timeDecomposition.unattributedMs).toBe(110_000);
        expect(derived.timeDecomposition.idleMs).toBe(0);
        // Sum invariant still holds.
        const { llmMs, toolMs, idleMs, unattributedMs, spanMs } = derived.timeDecomposition;
        expect(llmMs + toolMs + idleMs + unattributedMs).toBe(spanMs);

        const warnings = derivedWarnings(derived);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]?.code).toBe('derived-unattributed-time');
    });

    test('session with zero todo-tool calls reports unsupported phases', async () => {
        const db = await setup();
        await insertMessage(db, { record_hash: 'm1', session_id: 's1', seq: 1, role: 'user', ts: T0 });

        const todos = await todoToolCalls(db, ALL);
        expect(todos).toEqual([]);

        const derived = computeDerived(await sessionSpans(db, ALL), await sessionToolDurations(db, ALL), todos);
        expect(derived.phases.phaseSupport).toBe('unsupported');
        expect(derived.phases.phases).toEqual([]);
    });
});

describe('sessionSpans timestamp sanitization (0579)', () => {
    const SENTINEL = '1970-01-01T00:00:00.000Z';

    test('sentinel timestamps are excluded from span bounds; null ts rows too', async () => {
        const db = await setup();
        await insertMessage(db, { record_hash: 'm1', session_id: 's1', seq: 1, role: 'user', ts: SENTINEL });
        await insertMessage(db, {
            record_hash: 'm2',
            session_id: 's1',
            seq: 2,
            role: 'assistant',
            ts: SENTINEL,
            duration_ms: 100,
        });

        const spans = await sessionSpans(db, ALL);
        expect(spans).toHaveLength(1);
        expect(spans[0].firstTs).toBeNull();
        expect(spans[0].lastTs).toBeNull();
        // Measured durations survive a fully sentinel session.
        expect(spans[0].assistantDurationMs).toBe(100);
    });

    test('poisoned session: sentinel rows are ignored, real bounds win', async () => {
        const db = await setup();
        await insertMessage(db, { record_hash: 'm1', session_id: 's1', seq: 1, role: 'user', ts: SENTINEL });
        await insertMessage(db, { record_hash: 'm2', session_id: 's1', seq: 2, role: 'user', ts: T0 });
        await insertMessage(db, { record_hash: 'm3', session_id: 's1', seq: 3, role: 'user', ts: T110 });

        const spans = await sessionSpans(db, ALL);
        expect(spans).toHaveLength(1);
        expect(spans[0].firstTs).toBe(T0);
        expect(spans[0].lastTs).toBe(T110);
    });

    test('mixed session: sentinel rows shift no bound; real span kept', async () => {
        const db = await setup();
        // Sentinel predates all real ts here, so if the screen failed the bound would become SENTINEL.
        await insertMessage(db, { record_hash: 'm1', session_id: 's1', seq: 1, role: 'user', ts: SENTINEL });
        await insertMessage(db, { record_hash: 'm2', session_id: 's1', seq: 2, role: 'user', ts: T0 });
        await insertMessage(db, { record_hash: 'm3', session_id: 's1', seq: 3, role: 'user', ts: T10 });

        const derived = computeDerived(await sessionSpans(db, ALL), await sessionToolDurations(db, ALL), []);
        expect(derived.timeDecomposition.spanMs).toBe(10_000);
        expect(derived.timeDecomposition.spanExcludedSessions).toBe(0);
    });

    test('all-sentinel session: excluded from span, counted, durations preserved', async () => {
        const db = await setup();
        await insertMessage(db, {
            record_hash: 'm1',
            session_id: 's1',
            seq: 1,
            role: 'assistant',
            ts: SENTINEL,
            duration_ms: 500,
        });
        // Unmeasured assistant in the excluded session must NOT leak into unattributedMs (AC6):
        // a broken timestamp is not an unmeasured duration.
        await insertMessage(db, { record_hash: 'm4', session_id: 's1', seq: 2, role: 'assistant', ts: SENTINEL });
        await insertMessage(db, { record_hash: 'm2', session_id: 's2', seq: 1, role: 'user', ts: T0 });
        await insertMessage(db, { record_hash: 'm5', session_id: 's2', seq: 3, role: 'assistant', ts: T10 });
        await insertMessage(db, { record_hash: 'm3', session_id: 's2', seq: 2, role: 'user', ts: T10 });

        const derived = computeDerived(await sessionSpans(db, ALL), await sessionToolDurations(db, ALL), []);
        expect(derived.timeDecomposition.spanMs).toBe(10_000);
        expect(derived.timeDecomposition.spanExcludedSessions).toBe(1);
        // s2's assistant is unmeasured -> its whole remainder is unattributed, not idle.
        expect(derived.timeDecomposition.unattributedMs).toBe(10_000);
        expect(derived.timeDecomposition.idleMs).toBe(0);
    });

    test('epoch-millis string ts: excluded, no NaN leaks into any total (AC3)', async () => {
        const db = await setup();
        await insertMessage(db, { record_hash: 'm1', session_id: 's1', seq: 1, role: 'user', ts: '1786684271589' });
        await insertMessage(db, { record_hash: 'm2', session_id: 's1', seq: 2, role: 'user', ts: '1786684273589' });

        const derived = computeDerived(await sessionSpans(db, ALL), await sessionToolDurations(db, ALL), []);
        // The LIKE '____-__-__T%' screen drops non-ISO ts from the bounds, so the session
        // has NULL bounds -> excluded and counted, never parsed by new Date().
        expect(derived.timeDecomposition.spanExcludedSessions).toBe(1);
        for (const total of [
            derived.timeDecomposition.spanMs,
            derived.timeDecomposition.llmMs,
            derived.timeDecomposition.toolMs,
            derived.timeDecomposition.idleMs,
            derived.timeDecomposition.unattributedMs,
        ]) {
            expect(Number.isFinite(total)).toBe(true);
        }
        expect(derived.timeDecomposition.spanMs).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Artifact compatibility (pre-0554 artifacts carry no `derived` block)
// ---------------------------------------------------------------------------

describe('artifact compatibility', () => {
    test('schema version stays 1 — a pre-0554 artifact version still validates', () => {
        // `derived` is optional on HistoryArtifact; old artifacts lack it entirely.
        // The version contract is unchanged, so assertArtifactVersion must accept v1.
        expect(HISTORY_ARTIFACT_SCHEMA_VERSION).toBe(1);
        expect(() => assertArtifactVersion(1, 'old-artifact.json')).not.toThrow();
        expect(emptyDerived().phases.phaseSupport).toBe('unsupported');
    });
});
