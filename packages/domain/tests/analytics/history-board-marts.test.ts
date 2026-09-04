import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import {
    deriveDimensionMarts,
    historyBoardDimensionDailyFromMart,
    historyBoardKpiWindowFromMart,
    historyBoardKpiWindowRowsFromMart,
    historyBoardPreviousWindowKpiFromMart,
    historyBoardSummaryFromMart,
    MART_DIMENSIONS,
    MART_MIN_RANGE_DAYS,
    resolveSummaryReadPath,
} from '../../src/analytics/history-board-marts';
import {
    historyBoardBucketsFromRollup,
    historyBoardKpiTrendFromRollup,
    refreshHistoryBoardRollupsIncremental,
} from '../../src/analytics/history-board-rollup';
import { applyCliMigrations, HISTORY_DIMENSION_MARTS_SCHEMA_SQL } from '../../src/migrations';

async function setup(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await db.exec(statement);
    }
    await applyCliMigrations(db);
    return db;
}

async function tableColumns(
    db: DbAdapter,
    table: string,
): Promise<Array<{ name: string; notnull: number; dflt_value: string | null }>> {
    return db.queryAll(`PRAGMA table_info("${table}")`);
}

interface Msg {
    recordHash: string;
    sessionId: string;
    seq: number;
    ts: string;
    model?: string | null;
    input?: number | null;
    cacheRead?: number | null;
    cacheWrite?: number | null;
    output?: number | null;
    durationMs?: number | null;
    importedAt: string;
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
    importedAt?: string;
}
interface SkillCall {
    recordHash: string;
    messageHash: string;
    sessionId: string;
    seq: number;
    start: string;
    skillName: string;
}

async function insertMessage(db: DbAdapter, m: Msg): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, cache_read_tokens, cache_write_tokens,
             output_tokens, cost_usd, provenance, run_id, task_wbs, duration_ms, request_id, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        m.recordHash,
        'claude',
        'test.jsonl',
        1,
        m.sessionId,
        m.seq,
        'assistant',
        'message',
        'conversation',
        m.ts,
        m.model ?? null,
        m.input ?? null,
        m.cacheRead ?? null,
        m.cacheWrite ?? null,
        m.output ?? null,
        null,
        'agent',
        null,
        null,
        m.durationMs ?? null,
        null,
        m.importedAt,
    );
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
        t.importedAt ?? '2026-06-01T00:00:00Z',
    );
}
async function insertSkillCall(db: DbAdapter, s: SkillCall): Promise<void> {
    await db.run(
        `INSERT INTO history_skill_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, skill_name, invocation_kind, started_at, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        s.recordHash,
        s.messageHash,
        'claude',
        'test.jsonl',
        1,
        s.sessionId,
        s.seq,
        s.skillName,
        'user',
        s.start,
        s.start,
    );
}

/** Seed a small corpus spanning `days` consecutive days so a ≥7d mart range has data. */
async function seedMultiDay(db: DbAdapter, days: number): Promise<void> {
    const base = Date.UTC(2026, 0, 10);
    for (let d = 0; d < days; d++) {
        const dayStart = new Date(base + d * 86_400_000);
        const ts = `${dayStart.toISOString().slice(0, 19)}.000Z`;
        const holdTs = new Date(dayStart.getTime() + 2 * 3600_000).toISOString();
        const importedAt = dayStart.toISOString();
        const hash = (n: number) => `m-${d}-${n}`;
        await insertMessage(db, {
            recordHash: hash(1),
            sessionId: `s-${d}`,
            seq: 1,
            ts,
            model: 'gpt-5',
            input: 100,
            cacheRead: 200,
            cacheWrite: 5,
            output: 50,
            durationMs: 1200,
            importedAt,
        });
        await insertToolCall(db, {
            recordHash: `t-${d}-1`,
            messageHash: hash(1),
            sessionId: `s-${d}`,
            seq: 1,
            toolName: 'Read',
            status: 'success',
            durationMs: 400,
            importedAt,
        });
        await insertToolCall(db, {
            recordHash: `t-${d}-2`,
            messageHash: hash(1),
            sessionId: `s-${d}`,
            seq: 1,
            toolName: 'Bash',
            status: 'error',
            durationMs: 800,
            importedAt,
        });
        // A skill *tool* call — exercises the tool_5m skill_name path that both the mart `skill`
        // dimension and historyBoardBucketsFromRollup read from.
        await insertToolCall(db, {
            recordHash: `t-${d}-3`,
            messageHash: hash(1),
            sessionId: `s-${d}`,
            seq: 1,
            toolName: 'skill',
            argsRaw: '{"skill": "code-review"}',
            status: 'success',
            durationMs: 200,
            importedAt,
        });
        // A skill call on a second message — exercises history_board_skill_5m.
        await insertMessage(db, {
            recordHash: hash(2),
            sessionId: `s-${d}`,
            seq: 2,
            ts: holdTs,
            model: 'gpt-5-mini',
            input: 40,
            cacheRead: 0,
            cacheWrite: 0,
            output: 20,
            durationMs: 600,
            importedAt,
        });
        await insertSkillCall(db, {
            recordHash: `sk-${d}-1`,
            messageHash: hash(2),
            sessionId: `s-${d}`,
            seq: 2,
            start: holdTs,
            skillName: 'research',
        });
    }
}

describe('dimension marts (0743)', () => {
    describe('R21: uniform additive measure vector, not-applicable not coerced to zero', () => {
        test('migration 0037 exposes no NOT NULL DEFAULT 0 measure column', async () => {
            const db = await setup();
            const cols = await tableColumns(db, 'history_board_dimension_daily');
            const measures = [
                'messages',
                'tool_calls',
                'skill_calls',
                'fresh_input_tokens',
                'cache_read_tokens',
                'cache_write_tokens',
                'output_tokens',
                'duration_ms',
                'duration_samples',
            ];
            for (const name of measures) {
                const col = cols.find((c) => c.name === name);
                expect(col, `missing measure column ${name}`).toBeDefined();
                expect(col?.notnull, `${name} must be nullable`).toBe(0);
                expect(col?.dflt_value, `${name} must not default to a value`).toBeNull();
            }
            // The schema constant must not carry the forbidden NOT NULL DEFAULT 0 shape.
            expect(HISTORY_DIMENSION_MARTS_SCHEMA_SQL).not.toMatch(/NOT NULL DEFAULT 0/);
            const kpiCols = await tableColumns(db, 'history_board_kpi_window');
            for (const name of measures) {
                const col = kpiCols.find((c) => c.name === name);
                expect(col?.notnull, `${name} kpi must be nullable`).toBe(0);
            }
            db.close();
        });
    });

    describe('resolveSummaryReadPath', () => {
        const unfilteredSel = {
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
        const base = { bucket: '1d' as const, rangeDays: 30, dimension: 'model' as const, selector: unfilteredSel };
        test('rollup on stale rollups', () => {
            expect(resolveSummaryReadPath({ ...base, fresh: false })).toBe('rollup');
        });
        test('rollup on a non-daily bucket', () => {
            expect(resolveSummaryReadPath({ ...base, fresh: true, bucket: '10m' })).toBe('rollup');
        });
        test('rollup when the range is below MART_MIN_RANGE_DAYS', () => {
            expect(resolveSummaryReadPath({ ...base, fresh: true, rangeDays: MART_MIN_RANGE_DAYS - 1 })).toBe('rollup');
        });
        test('rollup for a dimension outside MART_DIMENSIONS', () => {
            expect(resolveSummaryReadPath({ ...base, fresh: true, dimension: 'unknown' as never })).toBe('rollup');
        });
        test('mart when all four conditions hold', () => {
            expect(resolveSummaryReadPath({ ...base, fresh: true })).toBe('mart');
        });
        test('mart when the range is unbounded (all/custom)', () => {
            expect(resolveSummaryReadPath({ ...base, fresh: true, rangeDays: null })).toBe('mart');
        });
        test('the four conditions each independently force rollup', () => {
            for (const input of [
                { ...base, fresh: false },
                { ...base, fresh: true, bucket: '3m' as const },
                { ...base, fresh: true, rangeDays: 1 },
                { ...base, fresh: true, dimension: 'foo' as never },
            ]) {
                expect(resolveSummaryReadPath(input)).toBe('rollup');
            }
        });
        test('a tool-filtered selector (outside the materialized cut line) forces rollup', () => {
            expect(
                resolveSummaryReadPath({ ...base, fresh: true, selector: { ...unfilteredSel, tools: ['Read'] } }),
            ).toBe('rollup');
        });
    });

    describe('deriveDimensionMarts: not-applicable is NULL, measured zero is 0', () => {
        test('tool dimension stores skill_calls NULL; source with zero tool_calls stores 0; skill dimension stores tool_calls NULL', async () => {
            const db = await setup();
            await seedMultiDay(db, 1);
            await refreshHistoryBoardRollupsIncremental(db);
            await deriveDimensionMarts(db, ['2026-01-10']);
            const dim = await db.queryAll<{
                dimension: string;
                dimensionKey: string;
                toolCalls: number | null;
                skillCalls: number | null;
                messages: number | null;
                freshInputTokens: number | null;
            }>(
                `SELECT dimension, dimension_key AS dimensionKey, tool_calls AS toolCalls, skill_calls AS skillCalls, messages, fresh_input_tokens AS freshInputTokens
                 FROM history_board_dimension_daily WHERE day = '2026-01-10'`,
            );
            const tool = dim.find((r) => r.dimension === 'tool');
            const skill = dim.find((r) => r.dimension === 'skill');
            const source = dim.find((r) => r.dimension === 'source' && r.dimensionKey === 'claude');
            // tool dimension: skill_calls is not-applicable -> NULL.
            expect(tool?.skillCalls).toBeNull();
            // skill dimension: tool_calls is not-applicable -> NULL.
            expect(skill?.toolCalls).toBeNull();
            // source claude: message rows and tool calls; tool_calls is a measured count, not NULL.
            expect(source?.toolCalls).not.toBeNull();
            expect(source?.toolCalls ?? 0).toBeGreaterThan(0);
            // model dimension must store real values across the defined measures (no NULL).
            const model = dim.find((r) => r.dimension === 'model');
            expect(model?.messages).not.toBeNull();
            expect(model?.freshInputTokens).not.toBeNull();
            // A model key with genuinely zero activity stores 0, distinguishable from a not-applicable
            // NULL: gpt-5-mini has a message but no tool call -> tool_calls = 0, not NULL.
            const modelMini = dim.find((r) => r.dimension === 'model' && r.dimensionKey === 'gpt-5-mini');
            expect(modelMini).toBeDefined();
            expect(modelMini?.messages).toBeGreaterThan(0);
            expect(modelMini?.toolCalls).toBe(0);
            expect(modelMini?.toolCalls).not.toBeNull();
            // NULL vs 0 are distinguishable: gpt-5-mini tool_calls=0 while tool skill_calls=NULL.
            expect(modelMini?.toolCalls).toBe(0);
            expect(tool?.skillCalls).toBeNull();
            // skill dimension: code-review skill tool exists -> skill_calls is a measured count.
            const skillRow = dim.find((r) => r.dimension === 'skill' && r.dimensionKey === 'code-review');
            expect(skillRow).toBeDefined();
            expect(skillRow?.toolCalls).toBeNull();
            expect(skillRow?.skillCalls).toBeGreaterThan(0);
            db.close();
        });
    });

    describe('historyBoardDimensionDailyFromMart equals the 5m rollup re-aggregation', () => {
        test('for a range at or beyond MART_MIN_RANGE_DAYS the mart series equals historyBoardBucketsFromRollup at daily bucket', async () => {
            const db = await setup();
            await seedMultiDay(db, 10);
            await refreshHistoryBoardRollupsIncremental(db);
            const start = '2026-01-10';
            const end = '2026-01-19';
            const sel = {
                since: `${start}T00:00:00.000Z`,
                until: `${end}T23:59:59.999Z`,
                sources: null,
                models: null,
                tools: null,
                skills: null,
                sessionId: null,
                runId: null,
                taskWbs: null,
            };
            for (const dimension of MART_DIMENSIONS) {
                const mart = await historyBoardDimensionDailyFromMart(db, sel, dimension);
                const rollup = await historyBoardBucketsFromRollup(db, sel, '1d', dimension);
                const key = (r: { bucketStart: string; key: string }) => `${r.bucketStart}\0${r.key}`;
                const rollupMap = new Map(rollup.map((r) => [key(r), r]));
                expect(mart.length, `mart ${dimension} empty`).toBeGreaterThan(0);
                for (const row of mart) {
                    const rup = rollupMap.get(key(row));
                    expect(rup, `mart ${dimension} ${key(row)} missing in rollup`).toBeDefined();
                    expect(row.freshInputTokens ?? 0).toBeCloseTo(rup?.freshInputTokens ?? 0, 6);
                    expect(row.cacheReadTokens ?? 0).toBeCloseTo(rup?.cacheReadTokens ?? 0, 6);
                    expect(row.outputTokens ?? 0).toBeCloseTo(rup?.outputTokens ?? 0, 6);
                    expect(row.calls ?? 0).toBeCloseTo(rup?.calls ?? 0, 6);
                }
            }
            db.close();
        });

        test('the KPI trend from the mart equals the five-minute rollup re-aggregation at daily grain', async () => {
            const db = await setup();
            await seedMultiDay(db, 10);
            await refreshHistoryBoardRollupsIncremental(db);
            const sel = {
                since: '2026-01-10T00:00:00.000Z',
                until: '2026-01-19T23:59:59.999Z',
                sources: null,
                models: null,
                tools: null,
                skills: null,
                sessionId: null,
                runId: null,
                taskWbs: null,
            };
            const { trend: martTrend } = await historyBoardKpiWindowFromMart(db, sel);
            const rollupTrend = await historyBoardKpiTrendFromRollup(db, sel);
            const key = (r: { day: string }) => r.day;
            const rollupMap = new Map(rollupTrend.map((r) => [key(r), r]));
            expect(martTrend.length).toBeGreaterThan(0);
            for (const row of martTrend) {
                const rup = rollupMap.get(row.day);
                expect(rup, `trend ${row.day} missing in rollup`).toBeDefined();
                expect(row.freshInputTokens).toBeCloseTo(rup?.freshInputTokens ?? 0, 6);
                expect(row.outputTokens).toBeCloseTo(rup?.outputTokens ?? 0, 6);
                expect(row.toolCalls).toBe(rup?.toolCalls ?? 0);
            }
            db.close();
        });
    });
});

describe('historyBoardPreviousWindowKpiFromMart (0743 R3 regression)', () => {
    test('the mart previous-window KPI reflects the shifted prior window, not the all-time total', async () => {
        const db = await setup();
        // 10 days of identical gpt-5 corpus (input 100, cacheRead 200, output 50, durationMs
        // 1200, one session, two tool calls one error each day).
        await seedMultiDay(db, 10);
        await refreshHistoryBoardRollupsIncremental(db);
        // Request a 5-day window (days 6-10). The prior window is days 1-5.
        const currentStart = new Date(Date.UTC(2026, 0, 15)).toISOString();
        const currentEnd = new Date(Date.UTC(2026, 0, 19, 23, 59, 59, 999)).toISOString();
        const sel = {
            since: currentStart,
            until: currentEnd,
            sources: null,
            models: null,
            tools: null,
            skills: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };
        const prev = await historyBoardPreviousWindowKpiFromMart(db, sel);
        expect(prev).not.toBeNull();
        // seedMultiDay seeds per day: a gpt-5 message (input 100, cacheRead 200, output 50,
        // duration 1200) + a gpt-5-mini message (input 40, output 20), and three tool calls on
        // the gpt-5 message (Read success, Bash error, skill). Days 1-5 therefore total:
        // fresh = 5*(100+40)=700, cacheRead = 5*200=1000, output = 5*(50+20)=350, toolCalls =
        // 5*3=15, toolErrors = 5*1=5, sessions = 5. If the reader returned the all-time total it
        // would double these — this asserts the true shifted window, not all-time.
        expect(prev?.freshInputTokens).toBe(700);
        expect(prev?.cacheReadTokens).toBe(1000);
        expect(prev?.outputTokens).toBe(350);
        expect(prev?.toolCalls).toBe(15);
        expect(prev?.toolErrors).toBe(5);
        expect(prev?.sessions).toBe(5);
        db.close();
    });

    test('returns null for an unbounded request (matching the rollup path)', async () => {
        const db = await setup();
        await seedMultiDay(db, 3);
        await refreshHistoryBoardRollupsIncremental(db);
        const unbounded = {
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
        const prev = await historyBoardPreviousWindowKpiFromMart(db, unbounded);
        expect(prev).toBeNull();
        db.close();
    });

    test('historyBoardSummaryFromMart and historyBoardKpiWindowRowsFromMart read filtered rows', async () => {
        const db = await setup();
        await seedMultiDay(db, 3);
        await refreshHistoryBoardRollupsIncremental(db);

        const kpiRows = await historyBoardKpiWindowRowsFromMart(db, '30d');
        expect(kpiRows instanceof Map).toBe(true);

        const filtered = {
            since: '2026-01-01T00:00:00Z',
            until: '2026-01-20T00:00:00Z',
            sources: ['claude'],
            models: ['gpt-5', 'gpt-5-mini'],
            tools: null,
            skills: null,
            sessionId: null,
            runId: null,
            taskWbs: null,
        };
        const summary = await historyBoardSummaryFromMart(db, filtered, 'model');
        expect(summary.buckets.length).toBeGreaterThanOrEqual(1);
        expect(summary.models.length).toBeGreaterThanOrEqual(1);
        expect(summary.sources.length).toBeGreaterThanOrEqual(1);
        expect(summary.sourceModels.length).toBeGreaterThanOrEqual(1);
        expect(summary.sessions).toBeGreaterThanOrEqual(1);
        db.close();
    });
});
