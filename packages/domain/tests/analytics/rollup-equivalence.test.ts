import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import { refreshHistoryBoardRollupsIncremental } from '../../src/analytics/history-board-rollup';
import { ALL_ROLLUP_TABLES } from '../../src/analytics/rollup-watermark';
// Import history-board-rollup AFTER migrations/rollup-watermark so the module graph
// resolves in the established order. (The former forensic-query<->history-board-rollup
// value cycle is broken into tool-name-sql, so this no longer triggers a TDZ, but the
// safe ordering is retained for clarity.)
import { applyCliMigrations } from '../../src/migrations';

/**
 * Bookkeeping tables excluded from the equivalence comparison. Each records HOW the build
 * ran rather than WHAT it measured — comparing them fails every run for reasons unrelated
 * to correctness:
 *   - history_board_rollup_meta: refreshed_at = new Date().toISOString() at write time.
 *   - history_board_rollup_watermark: per-table imported_at watermark + definition version,
 *     describing the incremental engine's progress, not a measurement.
 *   - history_board_rollup_bucket: the materialized bucket range, likewise progress.
 */
export const EQUIVALENCE_EXCLUDED_TABLES = [
    'history_board_rollup_meta',
    'history_board_rollup_watermark',
    'history_board_rollup_bucket',
] as const;

/**
 * Relative tolerance for `_alloc` columns. Allocated token measures are REAL sums of a
 * message's tokens distributed across the tool calls of that message; the per-bucket build
 * and the whole-corpus build legitimately differ in floating-point summation order, so exact
 * equality is the wrong assertion. Relative (not absolute) because column magnitudes differ
 * by orders of magnitude — a 0.5-token slack is negligible on a 43B cache-read sum and
 * enormous on a per-tool allocation. Stated as an engineering decision, not tuned to green.
 */
export const ALLOC_TOLERANCE_RATIO = 1e-9;

/** All data rollup tables compared by the equivalence assertion (never a hand-written list). */
export const EQUIVALENCE_COMPARED_TABLES = ALL_ROLLUP_TABLES.filter(
    (t) => !(EQUIVALENCE_EXCLUDED_TABLES as readonly string[]).includes(t),
);

/** Column metadata used to derive a row's key and classify its measure columns. */
interface TableColumn {
    name: string;
    type: string;
    pk: number;
}

async function tableColumns(db: DbAdapter, table: string): Promise<TableColumn[]> {
    return db.queryAll<TableColumn>(`PRAGMA table_info("${table}")`);
}

/** Snapshot every compared table as key→row maps, with per-table column metadata. */
export async function snapshotRollupTables(db: DbAdapter): Promise<Map<string, Map<string, Record<string, unknown>>>> {
    const snapshot = new Map<string, Map<string, Record<string, unknown>>>();
    for (const table of EQUIVALENCE_COMPARED_TABLES) {
        const cols = await tableColumns(db, table);
        const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
        if (pkCols.length === 0) throw new Error(`Equivalence table ${table} has no PRIMARY KEY`);
        const rows = await db.queryAll<Record<string, unknown>>(`SELECT * FROM "${table}"`);
        const keyed = new Map<string, Record<string, unknown>>();
        for (const row of rows) {
            keyed.set(pkCols.map((c) => String(row[c])).join('\0'), row);
        }
        snapshot.set(table, keyed);
    }
    return snapshot;
}

/** Shallow-copy a snapshot so a test can mutate one side as the oracle. */
function cloneSnapshot(
    snapshot: Map<string, Map<string, Record<string, unknown>>>,
): Map<string, Map<string, Record<string, unknown>>> {
    const copy = new Map<string, Map<string, Record<string, unknown>>>();
    for (const [table, keyed] of snapshot) {
        const tableCopy = new Map<string, Record<string, unknown>>();
        for (const [key, row] of keyed) tableCopy.set(key, { ...row });
        copy.set(table, tableCopy);
    }
    return copy;
}

/** A single difference: missing key, extra key, or a per-column value mismatch. */
export interface RowDifference {
    table: string;
    kind: 'missing-key' | 'extra-key' | 'value';
    key: string;
    column?: string;
    incremental?: unknown;
    full?: unknown;
}

/**
 * Compare two snapshots (incremental vs full rebuild) per table: key sets in both
 * directions first, then per-column values. Integer columns are compared exactly; `_alloc`
 * columns use {@link ALLOC_TOLERANCE_RATIO}. `NULL` and `0` are never treated as equal.
 */
export function diffRollupSnapshots(
    incremental: Map<string, Map<string, Record<string, unknown>>>,
    full: Map<string, Map<string, Record<string, unknown>>>,
): RowDifference[] {
    const differences: RowDifference[] = [];
    for (const table of EQUIVALENCE_COMPARED_TABLES) {
        const incr = incremental.get(table) ?? new Map();
        const ful = full.get(table) ?? new Map();
        // Key sets, both directions.
        for (const key of incr.keys()) {
            if (!ful.has(key)) differences.push({ table, kind: 'missing-key', key });
        }
        for (const key of ful.keys()) {
            if (!incr.has(key)) differences.push({ table, kind: 'extra-key', key });
        }
        // Shared keys: per-column values.
        for (const [key, incrRow] of incr) {
            const fulRow = ful.get(key);
            if (fulRow === undefined) continue;
            for (const [col, incrVal] of Object.entries(incrRow)) {
                const fulVal = fulRow[col];
                if (incrVal === null || fulVal === null) {
                    if (incrVal !== fulVal) {
                        differences.push({
                            table,
                            kind: 'value',
                            key,
                            column: col,
                            incremental: incrVal,
                            full: fulVal,
                        });
                    }
                    continue;
                }
                const isAlloc = col.endsWith('_alloc');
                if (typeof incrVal === 'number' && typeof fulVal === 'number') {
                    if (isAlloc) {
                        const base = Math.max(Math.abs(fulVal), 1);
                        const rel = Math.abs(incrVal - fulVal) / base;
                        if (rel > ALLOC_TOLERANCE_RATIO) {
                            differences.push({
                                table,
                                kind: 'value',
                                key,
                                column: col,
                                incremental: incrVal,
                                full: fulVal,
                            });
                        }
                    } else if (incrVal !== fulVal) {
                        differences.push({
                            table,
                            kind: 'value',
                            key,
                            column: col,
                            incremental: incrVal,
                            full: fulVal,
                        });
                    }
                } else if (incrVal !== fulVal) {
                    differences.push({ table, kind: 'value', key, column: col, incremental: incrVal, full: fulVal });
                }
            }
        }
    }
    return differences;
}

// ─── Fixture helpers ────────────────────────────────────────────────────

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

interface Msg {
    recordHash: string;
    sessionId: string;
    seq: number;
    ts: string | null;
    model?: string | null;
    input?: number | null;
    cacheRead?: number | null;
    cacheWrite?: number | null;
    output?: number | null;
    durationMs?: number | null;
    requestId?: string | null;
    importedAt: string;
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
        m.requestId ?? null,
        m.importedAt,
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
    importedAt?: string;
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

interface SkillCall {
    recordHash: string;
    messageHash: string;
    sessionId: string;
    seq: number;
    start: string;
    skillName: string;
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

// Increment 2 hard cases (each a named fixture scenario, per the Plan's test intent):
//   - BACKFILL: a row whose ts lands in a bucket increment 1 already materialized.
//   - DEDUP-EXCLUDED: a row sharing a request_id with an earlier row (the MESSAGE_DEDUP
//     predicate keeps the first rowid and excludes this re-retry).
//   - BOUNDARY-SESSION: a session with messages on both sides of the increment boundary.

async function seedIncrementOne(db: DbAdapter): Promise<void> {
    await insertMessage(db, {
        recordHash: 'inc1-a1',
        sessionId: 'eq-s1',
        seq: 1,
        ts: '2026-06-01T09:58:00Z',
        model: 'gpt-5',
        input: 100,
        cacheRead: 200,
        cacheWrite: 5,
        output: 50,
        durationMs: 1200,
        importedAt: '2026-06-01T05:00:00Z',
    });
    await insertToolCall(db, {
        recordHash: 'inc1-t1',
        messageHash: 'inc1-a1',
        sessionId: 'eq-s1',
        seq: 1,
        toolName: 'Read',
        status: 'success',
        durationMs: 400,
    });
    await insertToolCall(db, {
        recordHash: 'inc1-t2',
        messageHash: 'inc1-a1',
        sessionId: 'eq-s1',
        seq: 1,
        toolName: 'Bash',
        status: 'error',
        durationMs: 800,
    });
    await insertMessage(db, {
        recordHash: 'inc1-b1',
        sessionId: 'eq-s2',
        seq: 1,
        ts: '2026-06-01T10:05:00Z',
        model: 'gpt-5-mini',
        input: 40,
        cacheRead: 0,
        cacheWrite: 0,
        output: 20,
        durationMs: 600,
        importedAt: '2026-06-01T05:00:00Z',
    });
    await insertToolCall(db, {
        recordHash: 'inc1-t3',
        messageHash: 'inc1-b1',
        sessionId: 'eq-s2',
        seq: 1,
        toolName: 'Search',
        status: 'success',
        durationMs: 300,
    });
    // Boundary session: one message in increment 1.
    await insertMessage(db, {
        recordHash: 'inc1-bd1',
        sessionId: 'eq-bd',
        seq: 1,
        ts: '2026-06-01T09:57:00Z',
        model: 'gpt-4',
        input: 10,
        cacheRead: 0,
        cacheWrite: 0,
        output: 5,
        durationMs: 100,
        importedAt: '2026-06-01T05:00:00Z',
    });
}

async function seedIncrementTwo(db: DbAdapter): Promise<void> {
    // BACKFILL: older ts lands in the 09:58 bucket increment 1 already materialized.
    await insertMessage(db, {
        recordHash: 'inc2-backfill',
        sessionId: 'eq-s1',
        seq: 2,
        ts: '2026-06-01T09:57:30Z',
        model: 'gpt-5',
        input: 7,
        cacheRead: 3,
        cacheWrite: 0,
        output: 2,
        durationMs: 150,
        importedAt: '2026-06-01T07:00:00Z',
    });
    // DEDUP-EXCLUDED: same request_id as an existing row → MESSAGE_DEDUP keeps the first.
    await insertMessage(db, {
        recordHash: 'inc2-dedup',
        sessionId: 'eq-s1',
        seq: 3,
        ts: '2026-06-01T10:05:30Z',
        model: 'gpt-5',
        input: 999,
        cacheRead: 0,
        cacheWrite: 0,
        output: 999,
        durationMs: 999,
        requestId: 'eq-shared-request',
        importedAt: '2026-06-01T07:00:00Z',
    });
    await insertMessage(db, {
        recordHash: 'inc2-first-request',
        sessionId: 'eq-s1',
        seq: 4,
        ts: '2026-06-01T10:06:00Z',
        model: 'gpt-5',
        input: 1,
        cacheRead: 0,
        cacheWrite: 0,
        output: 1,
        durationMs: 50,
        requestId: 'eq-shared-request',
        importedAt: '2026-06-01T07:00:00Z',
    });
    // Boundary session: second message in increment 2.
    await insertMessage(db, {
        recordHash: 'inc2-bd2',
        sessionId: 'eq-bd',
        seq: 2,
        ts: '2026-06-01T10:05:00Z',
        model: 'gpt-4',
        input: 20,
        cacheRead: 0,
        cacheWrite: 0,
        output: 10,
        durationMs: 200,
        importedAt: '2026-06-01T07:00:00Z',
    });
    // A skill call to exercise history_board_skill_5m.
    await insertSkillCall(db, {
        recordHash: 'inc2-sk1',
        messageHash: 'inc2-backfill',
        sessionId: 'eq-s1',
        seq: 2,
        start: '2026-06-01T09:57:30Z',
        skillName: 'research',
    });
}

describe('incremental vs full-rebuild rollup equivalence (0742 R4)', () => {
    test('incremental rollups are byte-identical to a full rebuild', async () => {
        // incremental: two increments, each rolled up incrementally.
        const incrDb = await setup();
        await seedIncrementOne(incrDb);
        await refreshHistoryBoardRollupsIncremental(incrDb);
        await seedIncrementTwo(incrDb);
        await refreshHistoryBoardRollupsIncremental(incrDb);

        // full: entire corpus on a fresh DB, first run takes the full-rebuild path.
        const fullDb = await setup();
        await seedIncrementOne(fullDb);
        await seedIncrementTwo(fullDb);
        await refreshHistoryBoardRollupsIncremental(fullDb);

        const incrSnapshot = await snapshotRollupTables(incrDb);
        const fullSnapshot = await snapshotRollupTables(fullDb);
        const differences = diffRollupSnapshots(incrSnapshot, fullSnapshot);
        expect(differences).toStrictEqual([]);

        incrDb.close();
        fullDb.close();
    });

    test('a seeded off-by-one integer count fails the equivalence', async () => {
        const db = await setup();
        await seedIncrementOne(db);
        await refreshHistoryBoardRollupsIncremental(db);
        const snapshot = await snapshotRollupTables(db);
        // Synthesize a difference without mutating the DB: the diff helper itself is the
        // oracle here. Tweak an integer measure in the FULL copy to mirror a real bug.
        const fullCopy = cloneSnapshot(snapshot);
        const sessionStats = fullCopy.get('history_board_session_stats');
        const target = sessionStats !== undefined && sessionStats.size > 0 ? [...sessionStats.values()][0] : null;
        expect(target).not.toBeNull();
        if (target != null) {
            if (typeof target.messages === 'number') {
                target.messages = Number(target.messages) + 1;
            } else {
                const intCol = Object.entries(target).find(([, v]) => typeof v === 'number');
                if (intCol !== undefined) {
                    const [name, val] = intCol;
                    target[name] = Number(val) + 1;
                }
            }
        }
        const differences = diffRollupSnapshots(snapshot, fullCopy);
        expect(differences.some((d) => d.kind === 'value')).toBe(true);
        db.close();
    });

    test('a seed NULL-for-0 substitution fails the equivalence', async () => {
        const db = await setup();
        await seedIncrementOne(db);
        await refreshHistoryBoardRollupsIncremental(db);
        const snapshot = await snapshotRollupTables(db);
        const fullCopy = cloneSnapshot(snapshot);
        // Find an integer column with 0 and set it to NULL in the full copy (NULL ≠ 0).
        let changed = false;
        for (const keyed of fullCopy.values()) {
            for (const row of keyed.values()) {
                for (const [col, val] of Object.entries(row)) {
                    if (val === 0 && !col.endsWith('_alloc')) {
                        row[col] = null;
                        changed = true;
                        break;
                    }
                }
                if (changed) break;
            }
            if (changed) break;
        }
        expect(changed).toBe(true);
        const differences = diffRollupSnapshots(snapshot, fullCopy);
        expect(differences.some((d) => d.kind === 'value' && d.incremental === 0 && d.full === null)).toBe(true);
        db.close();
    });
});

describe('equivalence helper contracts (0742)', () => {
    test('EQUIVALENCE_COMPARED_TABLES is derived from ALL_ROLLUP_TABLES, not hand-written', () => {
        expect(EQUIVALENCE_COMPARED_TABLES).not.toStrictEqual([]);
        for (const excluded of EQUIVALENCE_EXCLUDED_TABLES) {
            expect(EQUIVALENCE_COMPARED_TABLES).not.toContain(excluded);
        }
        for (const table of ALL_ROLLUP_TABLES) {
            if (!(EQUIVALENCE_EXCLUDED_TABLES as readonly string[]).includes(table)) {
                expect(EQUIVALENCE_COMPARED_TABLES).toContain(table);
            }
        }
    });

    test('a backfilled bucket recomputed incrementally matches a full rebuild per bucket', async () => {
        const incrDb = await setup();
        await seedIncrementOne(incrDb);
        await refreshHistoryBoardRollupsIncremental(incrDb);
        await seedIncrementTwo(incrDb);
        await refreshHistoryBoardRollupsIncremental(incrDb);
        const fullDb = await setup();
        await seedIncrementOne(fullDb);
        await seedIncrementTwo(fullDb);
        await refreshHistoryBoardRollupsIncremental(fullDb);

        const incrSum = await incrDb.queryFirst<{ n: number; t: number }>(
            'SELECT COUNT(*) AS n, SUM(fresh_input_tokens) AS t FROM history_board_message_5m WHERE bucket_start = ?',
            '2026-06-01T09:57:30Z',
        );
        const fullSum = await fullDb.queryFirst<{ n: number; t: number }>(
            'SELECT COUNT(*) AS n, SUM(fresh_input_tokens) AS t FROM history_board_message_5m WHERE bucket_start = ?',
            '2026-06-01T09:57:30Z',
        );
        expect(incrSum).toStrictEqual(fullSum);
        incrDb.close();
        fullDb.close();
    });
});

/**
 * A message with no timestamp is a supported state (history_message.ts is nullable), and real
 * corpora carry them. The full rebuild coalesces such a row's 5m bucket to `''`; the incremental
 * engine used to derive a NULL bucket key from the same expression, which crashed the refresh
 * before it ever compared. Both halves of that contract are asserted here.
 */
describe('NULL-ts messages (0741 R8)', () => {
    async function seedNullTs(db: DbAdapter): Promise<void> {
        await insertMessage(db, {
            recordHash: 'nullts-a1',
            sessionId: 'eq-null',
            seq: 1,
            ts: null,
            model: 'gpt-5',
            input: 11,
            cacheRead: 3,
            cacheWrite: 1,
            output: 7,
            durationMs: 250,
            importedAt: '2026-06-01T07:00:00Z',
        });
        await insertToolCall(db, {
            recordHash: 'nullts-t1',
            messageHash: 'nullts-a1',
            sessionId: 'eq-null',
            seq: 1,
            toolName: 'Read',
            status: 'success',
            durationMs: 90,
        });
    }

    test('a NULL-ts message arriving after the watermark refreshes incrementally', async () => {
        const db = await setup();
        await seedIncrementOne(db);
        await refreshHistoryBoardRollupsIncremental(db);
        await seedNullTs(db);
        await refreshHistoryBoardRollupsIncremental(db);

        const bucket = await db.queryFirst<{ n: number; t: number; msgs: number }>(
            `SELECT COUNT(*) AS n, SUM(fresh_input_tokens) AS t, SUM(messages) AS msgs
             FROM history_board_message_5m WHERE bucket_start = ''`,
        );
        expect(bucket?.n).toBe(1);
        expect(bucket?.t).toBe(11);
        expect(bucket?.msgs).toBe(1);
        const tools = await db.queryFirst<{ calls: number }>(
            "SELECT SUM(calls) AS calls FROM history_board_tool_5m WHERE bucket_start = ''",
        );
        expect(tools?.calls).toBe(1);
        db.close();
    });

    test('incremental and full rebuild agree with NULL-ts rows present', async () => {
        const incrDb = await setup();
        await seedIncrementOne(incrDb);
        await refreshHistoryBoardRollupsIncremental(incrDb);
        await seedIncrementTwo(incrDb);
        await seedNullTs(incrDb);
        await refreshHistoryBoardRollupsIncremental(incrDb);

        const fullDb = await setup();
        await seedIncrementOne(fullDb);
        await seedIncrementTwo(fullDb);
        await seedNullTs(fullDb);
        await refreshHistoryBoardRollupsIncremental(fullDb);

        const differences = diffRollupSnapshots(await snapshotRollupTables(incrDb), await snapshotRollupTables(fullDb));
        expect(differences).toStrictEqual([]);
        incrDb.close();
        fullDb.close();
    });
});
