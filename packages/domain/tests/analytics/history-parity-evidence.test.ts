import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import { bucketedTokenSeries, messageRollup } from '../../src/analytics/forensic-query';
import { historyBoardSummaryFromMart } from '../../src/analytics/history-board-marts';
import {
    type HistoryBoardAggregateRow,
    historyBoardBucketsFromRollup,
    historyBoardRollupsFresh,
    historyBoardSummaryFromRollup,
    refreshHistoryBoardRollupsIncremental,
} from '../../src/analytics/history-board-rollup';
import { applyCliMigrations } from '../../src/migrations';

/** Same ratio as `export const ALLOC_TOLERANCE_RATIO` in rollup-equivalence.test.ts. */
const ALLOC_TOLERANCE_RATIO = 1e-9;

/**
 * Task 1309 — evidence only. Production SQL stays as it is. This fixture compares the
 * existing raw, rollup, and mart reads, publishes golden time-bound predicate vectors,
 * and writes the go/no-go artifact from the measurement.
 */

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const REPORT_JSON = resolve(REPO_ROOT, 'docs/reports/1309-analytics-parity.json');
const REPORT_MD = resolve(REPO_ROOT, 'docs/reports/1309-analytics-parity.md');
const PROOF_JSON = resolve(REPO_ROOT, '.spur/run/1309-analytics-parity.json');
const PROOF_JUNIT = resolve(REPO_ROOT, '.spur/run/1309-analytics-parity.junit.xml');
const COMMAND = [
    'rm -f docs/reports/1309-analytics-parity.json docs/reports/1309-analytics-parity.md',
    'cd packages/domain && bun test tests/analytics/history-parity-evidence.test.ts',
].join(' && ');

const INSPECTED = [
    'packages/domain/src/analytics/history-board-rollup.ts',
    'packages/domain/src/analytics/history-board-marts.ts',
    'packages/domain/src/analytics/message-where.ts',
    'packages/app/src/services/history-board-service.ts',
] as const;

const FIXTURE_SEED = {
    id: '1309-48h-v1',
    hours: 48,
    start: '2026-01-01T12:00:00Z',
    end: '2026-01-03T12:00:00Z',
    importedAt: '2026-01-03T12:00:00Z',
    staleImportedAt: '2026-01-03T18:00:00Z',
    phenomena: ['duplicate-import', 'null-measures', 'unknown-usage', 'midnight-boundary', 'fresh-and-stale-watermark'],
} as const;

const DAY_SINCE = '2026-01-01T00:00:00Z';
const DAY_UNTIL = '2026-01-03T23:59:59Z';
const MID_SINCE = '2026-01-02T00:30:00Z';
const MID_UNTIL = '2026-01-02T12:00:00Z';

/** One shared helper 1310 could use. Counted, not shipped — production SQL is unchanged. */
const PROPOSED_HELPER = `function timeBoundClauses(column: string, since: string | null, until: string | null, boundSql: string): { clauses: string[]; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (since !== null) {
        clauses.push(\`\${column} >= \${boundSql}\`);
        params.push(since);
    }
    if (until !== null) {
        clauses.push(\`\${column} <= \${boundSql}\`);
        params.push(until);
    }
    return { clauses, params };
}`;

type Status = 'go' | 'no-go' | 'inconclusive';

interface Difference {
    path: string;
    key: string;
    column: string;
    left: unknown;
    right: unknown;
}

interface ParityCase {
    id: string;
    grain: string;
    bounds: string;
    filters: string;
    comparable: boolean;
    reason: string;
    selectedCounts: { raw: number; rollupDate: number; rollupInstant: number };
    differences: Difference[];
    notes?: string[];
}

interface Timings {
    warmups: number;
    measuredReads: number;
    rollupMs: number[];
    martMs: number[];
    rawMs: number[];
}

interface ParityReport {
    schemaVersion: 1;
    candidate: 'time-range-predicates';
    status: Status;
    reason: string;
    cases: ParityCase[];
    predicateVectors: Array<{ id: string; path: string; fragments: string[]; absent: string[] }>;
    surface: {
        candidateFunctions: ['buildRollupWhere', 'dayClauses'];
        currentLines: number;
        proposedLines: number;
        smaller: boolean;
        adjacentAssemblies: string[];
    };
    toolVersions: { bun: string; sqlite: string };
    timings: { sevenDay: Timings; allHistory: Timings };
    sourceRevision: string;
    sourceDigests: Record<string, string>;
    fixtureSeed: typeof FIXTURE_SEED;
    command: string;
    measuredAt: string;
}

/** Compare one measure. Null matches only null. Integers are exact. Allocated columns use a 1e-9 relative tolerance. */
export function valuesEqual(column: string, left: unknown, right: unknown, allocated: boolean): boolean {
    if (left === null || right === null) return left === right;
    if (typeof left === 'number' && typeof right === 'number') {
        const alloc = allocated || column.endsWith('_alloc');
        if (alloc) {
            const base = Math.max(Math.abs(right), 1);
            return Math.abs(left - right) / base <= ALLOC_TOLERANCE_RATIO;
        }
        return left === right;
    }
    return left === right;
}

/** Diff message-grain aggregate rows. A missing key is recorded. Null is not treated as zero. */
export function diffAggregates(
    path: string,
    left: readonly HistoryBoardAggregateRow[],
    right: readonly HistoryBoardAggregateRow[],
    allocated: boolean,
): Difference[] {
    const differences: Difference[] = [];
    const rightByKey = new Map(right.map((row) => [row.key, row]));
    const leftByKey = new Map(left.map((row) => [row.key, row]));
    for (const row of left) {
        const other = rightByKey.get(row.key);
        if (other === undefined) {
            differences.push({ path, key: row.key, column: '*', left: 'present', right: 'missing' });
            continue;
        }
        for (const column of ['freshInputTokens', 'cacheReadTokens', 'outputTokens'] as const) {
            if (!valuesEqual(column, row[column], other[column], allocated)) {
                differences.push({ path, key: row.key, column, left: row[column], right: other[column] });
            }
        }
    }
    for (const row of right) {
        if (!leftByKey.has(row.key)) {
            differences.push({ path, key: row.key, column: '*', left: 'missing', right: 'present' });
        }
    }
    return differences;
}

/** Decide go, no-go, or inconclusive from completeness, comparable differences, and surface size. */
export function decide(input: {
    casesComplete: boolean;
    timingsComplete: boolean;
    digestsComplete: boolean;
    comparableDifferences: number;
    smallerSurface: boolean;
}): { status: Status; reason: string } {
    if (!input.casesComplete || !input.timingsComplete || !input.digestsComplete) {
        return {
            status: 'inconclusive',
            reason: 'A required case, timing sample, or source digest is missing, so consolidation is not decided.',
        };
    }
    if (input.comparableDifferences > 0) {
        return {
            status: 'no-go',
            reason: `${input.comparableDifferences} semantic difference(s) on requests whose time predicates select the same rows. Leave 1310 blocked.`,
        };
    }
    if (!input.smallerSurface) {
        return {
            status: 'no-go',
            reason: 'Comparable reads match, but a shared time-bound helper is not a smaller handwritten surface. Leave 1310 blocked.',
        };
    }
    return {
        status: 'go',
        reason: 'Date-grain raw, rollup, and mart reads match on comparable requests, and one timeBoundClauses helper is smaller than the buildRollupWhere and dayClauses assemblies. Whole queries are not claimed equivalent. 1310 may consume this artifact; this task does not unblock it.',
    };
}

function nonemptyLines(text: string): number {
    return text.split('\n').filter((line) => line.trim().length > 0).length;
}

function sliceFunction(source: string, name: string): string {
    const start = source.indexOf(`function ${name}`);
    if (start < 0) throw new Error(`missing function ${name}`);
    const rest = source.slice(start + name.length);
    const nextFn = rest.search(/\n(?:export )?(?:async )?function /);
    return nextFn < 0 ? source.slice(start) : source.slice(start, start + name.length + nextFn);
}

function boundAssembly(fnSource: string, stopMarker: string): string {
    const since = fnSource.indexOf('if (sel.since !== null)');
    if (since < 0) throw new Error('missing since assembly');
    const stop = fnSource.indexOf(stopMarker, since + 1);
    if (stop < 0) throw new Error(`missing stop marker ${stopMarker}`);
    return fnSource.slice(since, stop);
}

function measureSurface(rollupSource: string, martSource: string, messageWhereSource: string): ParityReport['surface'] {
    const rollupBlock = boundAssembly(sliceFunction(rollupSource, 'buildRollupWhere'), 'if (sel.sources !== null &&');
    const dayBlock = boundAssembly(sliceFunction(martSource, 'dayClauses'), 'return {');
    if (!rollupBlock.includes('DATE(?)') || !rollupBlock.includes('strftime')) {
        throw new Error('buildRollupWhere time assembly did not include both DATE and strftime forms');
    }
    if (!dayBlock.includes('DATE(?)')) throw new Error('dayClauses time assembly did not include DATE(?)');
    const currentLines = nonemptyLines(rollupBlock) + nonemptyLines(dayBlock);
    const proposedLines = nonemptyLines(PROPOSED_HELPER) + 2;
    const adjacentAssemblies = [
        ...scanAssemblies('packages/domain/src/analytics/history-board-rollup.ts', rollupSource),
        ...scanAssemblies('packages/domain/src/analytics/history-board-marts.ts', martSource),
        ...scanAssemblies('packages/domain/src/analytics/message-where.ts', messageWhereSource),
    ];
    return {
        candidateFunctions: ['buildRollupWhere', 'dayClauses'],
        currentLines,
        proposedLines,
        smaller: proposedLines < currentLines,
        adjacentAssemblies,
    };
}

function scanAssemblies(path: string, source: string): string[] {
    const hits: string[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (
            line.includes('>= DATE(?)') ||
            line.includes('<= DATE(?)') ||
            line.includes("strftime('%Y-%m-%dT%H:%M:%SZ', ?)") ||
            line.includes('.ts >= ?') ||
            line.includes('.started_at >= ?') ||
            line.includes('SUBSTR(m.bucket_start, 1, 10) >= DATE(?)')
        ) {
            hits.push(`${path}:${i + 1}`);
        }
    }
    return hits;
}

function selector(partial: Partial<ArtifactSelector> = {}): ArtifactSelector {
    return {
        since: null,
        until: null,
        sources: null,
        models: null,
        tools: null,
        skills: null,
        sessionId: null,
        runId: null,
        taskWbs: null,
        ...partial,
    };
}

async function setup(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    for (const statement of HISTORY_IMPORT_SCHEMA_SQL.split(';')
        .map((statement) => statement.trim())
        .filter(Boolean)) {
        await db.exec(statement);
    }
    await applyCliMigrations(db);
    return db;
}

interface SeedMessage {
    recordHash: string;
    source: string;
    sessionId: string;
    seq: number;
    ts: string;
    model: string | null;
    input: number | null;
    cacheRead: number | null;
    output: number | null;
    requestId?: string | null;
    importedAt: string;
}

async function insertMessage(db: DbAdapter, message: SeedMessage): Promise<void> {
    await db.run(
        `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
             role, record_type, disposition, ts, model, input_tokens, cache_read_tokens, cache_write_tokens,
             output_tokens, cost_usd, provenance, run_id, task_wbs, duration_ms, request_id, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        message.recordHash,
        message.source,
        'fixture.jsonl',
        1,
        message.sessionId,
        message.seq,
        'assistant',
        'message',
        'conversation',
        message.ts,
        message.model,
        message.input,
        message.cacheRead,
        null,
        message.output,
        null,
        'agent',
        null,
        null,
        null,
        message.requestId ?? null,
        message.importedAt,
    );
}

async function insertTool(
    db: DbAdapter,
    recordHash: string,
    messageHash: string,
    source: string,
    sessionId: string,
    seq: number,
    toolName: string,
    argsRaw: string | null,
): Promise<void> {
    await db.run(
        `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, tool_name, args_raw, status, duration_ms, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        recordHash,
        messageHash,
        source,
        'fixture.jsonl',
        1,
        sessionId,
        seq,
        toolName,
        argsRaw,
        'success',
        10,
        FIXTURE_SEED.importedAt,
    );
}

async function seedParity(db: DbAdapter): Promise<void> {
    const importedAt = FIXTURE_SEED.importedAt;
    const rows: SeedMessage[] = [
        {
            recordHash: 'm-day1',
            source: 'claude',
            sessionId: 's-claude',
            seq: 1,
            ts: '2026-01-01T18:00:00Z',
            model: 'opus',
            input: 100,
            cacheRead: 10,
            output: 20,
            importedAt,
        },
        {
            recordHash: 'm-pre-midnight',
            source: 'claude',
            sessionId: 's-claude',
            seq: 2,
            ts: '2026-01-01T23:59:59Z',
            model: 'opus',
            input: 10,
            cacheRead: 1,
            output: 2,
            importedAt,
        },
        {
            recordHash: 'm-midnight',
            source: 'claude',
            sessionId: 's-claude',
            seq: 3,
            ts: '2026-01-02T00:00:00Z',
            model: 'opus',
            input: 40,
            cacheRead: 0,
            output: 5,
            importedAt,
        },
        {
            recordHash: 'm-dup-old',
            source: 'claude',
            sessionId: 's-claude',
            seq: 4,
            ts: '2026-01-02T00:30:00Z',
            model: 'opus',
            input: 1,
            cacheRead: 0,
            output: 1,
            requestId: 'dup-1',
            importedAt,
        },
        {
            recordHash: 'm-dup-new',
            source: 'claude',
            sessionId: 's-claude',
            seq: 5,
            ts: '2026-01-02T00:30:01Z',
            model: 'opus',
            input: 80,
            cacheRead: 4,
            output: 15,
            requestId: 'dup-1',
            importedAt,
        },
        {
            recordHash: 'm-grok',
            source: 'grok',
            sessionId: 's-grok',
            seq: 1,
            ts: '2026-01-02T23:30:00Z',
            model: 'grok-4',
            input: 50,
            cacheRead: 5,
            output: 25,
            importedAt,
        },
        {
            recordHash: 'm-null',
            source: 'grok',
            sessionId: 's-grok',
            seq: 2,
            ts: '2026-01-03T06:00:00Z',
            model: 'grok-4',
            input: null,
            cacheRead: null,
            output: null,
            importedAt,
        },
        {
            recordHash: 'm-unknown',
            source: 'claude',
            sessionId: 's-unknown',
            seq: 1,
            ts: '2026-01-03T11:00:00Z',
            model: 'unknown',
            input: 7,
            cacheRead: 0,
            output: 3,
            importedAt,
        },
    ];
    for (const row of rows) await insertMessage(db, row);
    await insertTool(db, 't-read', 'm-day1', 'claude', 's-claude', 1, 'Read', null);
    await insertTool(db, 't-skill', 'm-grok', 'grok', 's-grok', 1, 'skill', '{"skill":"code-review"}');
    await db.run(
        `INSERT INTO history_skill_call (record_hash, message_hash, source, source_file, source_line,
             session_id, seq, skill_name, invocation_kind, started_at, imported_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        'sk-1',
        'm-grok',
        'grok',
        'fixture.jsonl',
        1,
        's-grok',
        1,
        'code-review',
        'user',
        '2026-01-02T23:30:00Z',
        importedAt,
    );
}

async function seedSevenDays(db: DbAdapter): Promise<void> {
    for (let day = 0; day < 7; day++) {
        const ts = new Date(Date.UTC(2026, 3, 1 + day, 15, 0, 0)).toISOString().replace('.000Z', 'Z');
        await insertMessage(db, {
            recordHash: `w-${day}`,
            source: 'claude',
            sessionId: `s-${day}`,
            seq: 1,
            ts,
            model: 'opus',
            input: 10 * (day + 1),
            cacheRead: 1,
            output: 2,
            importedAt: '2026-04-08T00:00:00Z',
        });
    }
}

const DEDUP = `m.request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM history_message o WHERE o.request_id = m.request_id AND o.rowid > m.rowid)`;

async function selectedHashes(db: DbAdapter, timeSql: string, params: readonly unknown[]): Promise<string[]> {
    const rows = await db.queryAll<{ record_hash: string }>(
        `SELECT m.record_hash AS record_hash FROM history_message m WHERE (${DEDUP}) AND (${timeSql}) ORDER BY m.record_hash`,
        ...params,
    );
    return rows.map((row) => row.record_hash);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
}

async function oracleAggregates(
    db: DbAdapter,
    group: 'model' | 'source',
    timeSql: string,
    params: readonly unknown[],
): Promise<HistoryBoardAggregateRow[]> {
    const key = group === 'model' ? 'effective_model' : 'm.source';
    const rows = await db.queryAll<HistoryBoardAggregateRow>(
        `WITH enriched AS (
             SELECT m.*,
                    COALESCE(
                        NULLIF(NULLIF(m.model, ''), 'unknown'),
                        MAX(CASE WHEN m.model IS NOT NULL AND m.model != '' AND m.model != 'unknown' THEN m.model END)
                            OVER (PARTITION BY m.source, m.session_id),
                        NULLIF(m.model, ''),
                        'unknown'
                    ) AS effective_model
             FROM history_message m
             WHERE ${DEDUP}
         )
         SELECT ${key} AS key,
                SUM(COALESCE(input_tokens, 0)) AS freshInputTokens,
                SUM(COALESCE(cache_read_tokens, 0)) AS cacheReadTokens,
                SUM(COALESCE(output_tokens, 0)) AS outputTokens
         FROM enriched m
         WHERE ${timeSql}
         GROUP BY ${key}
         ORDER BY key ASC`,
        ...params,
    );
    return rows;
}

function timePredicates(
    since: string | null,
    until: string | null,
): {
    raw: { sql: string; params: unknown[] };
    date: { sql: string; params: unknown[] };
    instant: { sql: string; params: unknown[] };
} {
    const rawParts: string[] = ['1'];
    const dateParts: string[] = ['1'];
    const instantParts: string[] = ['1'];
    const rawParams: unknown[] = [];
    const dateParams: unknown[] = [];
    const instantParams: unknown[] = [];
    if (since !== null) {
        rawParts.push('m.ts >= ?');
        dateParts.push('DATE(m.ts) >= DATE(?)');
        instantParts.push("m.ts >= strftime('%Y-%m-%dT%H:%M:%SZ', ?)");
        rawParams.push(since);
        dateParams.push(since);
        instantParams.push(since);
    }
    if (until !== null) {
        rawParts.push('m.ts <= ?');
        dateParts.push('DATE(m.ts) <= DATE(?)');
        instantParts.push("m.ts <= strftime('%Y-%m-%dT%H:%M:%SZ', ?)");
        rawParams.push(until);
        dateParams.push(until);
        instantParams.push(until);
    }
    return {
        raw: { sql: rawParts.join(' AND '), params: rawParams },
        date: { sql: dateParts.join(' AND '), params: dateParams },
        instant: { sql: instantParts.join(' AND '), params: instantParams },
    };
}

function withSource(sql: string, params: unknown[], source: string | null): { sql: string; params: unknown[] } {
    if (source === null) return { sql, params };
    return { sql: `${sql} AND m.source = ?`, params: [...params, source] };
}

async function compareDaily(
    db: DbAdapter,
    id: string,
    bounds: string,
    filters: string,
    since: string | null,
    until: string | null,
    source: string | null,
    group: 'model' | 'source',
): Promise<ParityCase> {
    const predicates = timePredicates(since, until);
    const rawSel = withSource(predicates.raw.sql, predicates.raw.params, source);
    const dateSel = withSource(predicates.date.sql, predicates.date.params, source);
    const instantSel = withSource(predicates.instant.sql, predicates.instant.params, source);
    const [rawHashes, dateHashes, instantHashes] = await Promise.all([
        selectedHashes(db, rawSel.sql, rawSel.params),
        selectedHashes(db, dateSel.sql, dateSel.params),
        selectedHashes(db, instantSel.sql, instantSel.params),
    ]);
    const counts = { raw: rawHashes.length, rollupDate: dateHashes.length, rollupInstant: instantHashes.length };
    const dateMatchesRaw = sameSet(rawHashes, dateHashes);
    const sel = selector({
        since,
        until,
        sources: source === null ? null : [source],
    });
    if (!dateMatchesRaw) {
        return {
            id,
            grain: '1d',
            bounds,
            filters,
            comparable: false,
            reason: 'time-predicate-selects-different-rows: DATE(?) keeps the whole calendar day; the raw instant bound does not',
            selectedCounts: counts,
            differences: [],
        };
    }
    const dimension = group === 'source' ? 'source' : 'model';
    const [oracle, rollup, mart] = await Promise.all([
        oracleAggregates(db, group, dateSel.sql, dateSel.params),
        historyBoardSummaryFromRollup(db, sel, '1d', dimension),
        historyBoardSummaryFromMart(db, sel, dimension),
    ]);
    const rollupRows = group === 'source' ? rollup.sources : rollup.models;
    const martRows = group === 'source' ? mart.sources : mart.models;
    const differences = [
        ...diffAggregates('rollup-vs-raw', rollupRows, oracle, false),
        ...diffAggregates('mart-vs-raw', martRows, oracle, false),
    ];
    return {
        id,
        grain: '1d',
        bounds,
        filters,
        comparable: true,
        reason: 'time-predicates-select-the-same-rows',
        selectedCounts: counts,
        differences,
    };
}

interface TracedQuery {
    sql: string;
    params: unknown[];
}

function trace(db: DbAdapter): { db: DbAdapter; queries: TracedQuery[] } {
    const queries: TracedQuery[] = [];
    const wrap = (method: 'queryAll' | 'queryFirst') => {
        const original = db[method].bind(db) as (sql: string, ...params: unknown[]) => Promise<unknown>;
        return (sql: string, ...params: unknown[]) => {
            queries.push({ sql, params });
            return original(sql, ...params);
        };
    };
    const traced = new Proxy(db, {
        get(target, prop, receiver) {
            if (prop === 'queryAll' || prop === 'queryFirst') return wrap(prop);
            const value = Reflect.get(target, prop, receiver) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
    });
    return { db: traced, queries };
}

function observed(queries: readonly TracedQuery[], fragment: string): boolean {
    return queries.some((query) => query.sql.includes(fragment));
}

async function measureReads(db: DbAdapter, sel: ArtifactSelector): Promise<Timings> {
    const once = async (): Promise<{ rollup: number; mart: number; raw: number }> => {
        const started = performance.now();
        await historyBoardSummaryFromRollup(db, sel, '1d', 'model');
        const afterRollup = performance.now();
        await historyBoardSummaryFromMart(db, sel, 'model');
        const afterMart = performance.now();
        await messageRollup(db, sel);
        const finished = performance.now();
        return { rollup: afterRollup - started, mart: afterMart - afterRollup, raw: finished - afterMart };
    };
    for (let i = 0; i < 2; i++) await once();
    const samples: Array<{ rollup: number; mart: number; raw: number }> = [];
    for (let i = 0; i < 9; i++) samples.push(await once());
    return {
        warmups: 2,
        measuredReads: 9,
        rollupMs: samples.map((sample) => sample.rollup),
        martMs: samples.map((sample) => sample.mart),
        rawMs: samples.map((sample) => sample.raw),
    };
}

function formatReport(path: string): void {
    const result = Bun.spawnSync(['bunx', 'biome', 'check', '--write', path], {
        cwd: REPO_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (result.exitCode !== 0) {
        throw new Error(`biome format failed for ${path}: ${result.stderr.toString()}`);
    }
}

function gitHead(): string {
    const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' });
    if (result.exitCode !== 0) throw new Error('git rev-parse HEAD failed');
    return result.stdout.toString().trim();
}

/**
 * Bytes of an inspected source: the working tree, or `revision` once a report is frozen. 1309 measured
 * the code before 1310 consolidated it; re-measuring the consolidated tree would compare a different
 * surface, so a frozen report is reproduced from the revision it recorded.
 */
function sourceAt(path: string, revision: string | null): Buffer {
    if (revision === null) return readFileSync(resolve(REPO_ROOT, path));
    const result = Bun.spawnSync(['git', 'show', `${revision}:${path}`], {
        cwd: REPO_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (result.exitCode === 0) return Buffer.from(result.stdout);
    // A shallow clone has no such object, and git reports that as "path exists on disk, but not
    // in <sha>" — which reads like a moved file and is not. Name the real cause (1309 evidence
    // needs the frozen revision's history; CI checks out with fetch-depth: 0 for it).
    const reachable = Bun.spawnSync(['git', 'cat-file', '-e', `${revision}^{commit}`], {
        cwd: REPO_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (reachable.exitCode !== 0) {
        throw new Error(
            `frozen sourceRevision ${revision} is not in this clone, so ${path} cannot be re-read ` +
                '(shallow or partial checkout). Fetch the history — `git fetch --unshallow` or ' +
                `\`git fetch origin ${revision}\` — then re-run; the parity evidence is measured at the ` +
                'revision the report recorded, not the current tree.',
        );
    }
    throw new Error(`git show ${revision}:${path} failed: ${result.stderr.toString().trim()}`);
}

function digestSource(path: string, revision: string | null): string {
    return createHash('sha256').update(sourceAt(path, revision)).digest('hex');
}

function stable(report: ParityReport): unknown {
    return {
        schemaVersion: report.schemaVersion,
        candidate: report.candidate,
        status: report.status,
        reason: report.reason,
        cases: report.cases,
        predicateVectors: report.predicateVectors,
        surface: report.surface,
        // toolVersions is the runner's environment (Bun and SQLite builds), not a property of the
        // measurement: pinning it in the committed artifact made the check fail on any runner whose
        // SQLite patch level differed. Presence is asserted directly instead.
        toolVersions: {
            bun: report.toolVersions.bun.length > 0 ? 'present' : '',
            sqlite: report.toolVersions.sqlite.length > 0 ? 'present' : '',
        },
        timingShape: {
            sevenDay: {
                warmups: report.timings.sevenDay.warmups,
                measuredReads: report.timings.sevenDay.measuredReads,
            },
            allHistory: {
                warmups: report.timings.allHistory.warmups,
                measuredReads: report.timings.allHistory.measuredReads,
            },
        },
        sourceDigests: report.sourceDigests,
        fixtureSeed: report.fixtureSeed,
        command: report.command,
    };
}

function renderMarkdown(report: ParityReport): string {
    const caseRows = report.cases
        .map(
            (item) =>
                `| ${item.id} | ${item.grain} | ${item.bounds} | ${item.filters} | ${item.comparable} | ${item.differences.length} | ${item.reason} |`,
        )
        .join('\n');
    const digests = Object.entries(report.sourceDigests)
        .map(([path, digest]) => `- \`${path}\`: \`${digest}\``)
        .join('\n');
    const vectors = report.predicateVectors
        .map((vector) => `- ${vector.id} (${vector.path}): ${vector.fragments.join(' ; ') || '(no time predicate)'}`)
        .join('\n');
    return `# 1309 analytics parity

schemaVersion: ${report.schemaVersion}
candidate: ${report.candidate}
status: ${report.status}
sourceRevision: ${report.sourceRevision}
command: \`${report.command}\`
fixtureSeed: ${report.fixtureSeed.id} (${report.fixtureSeed.hours}h ${report.fixtureSeed.start} .. ${report.fixtureSeed.end})
toolVersions: bun ${report.toolVersions.bun}; sqlite ${report.toolVersions.sqlite}
measuredAt: ${report.measuredAt}

## Reason

${report.reason}

## Source digests

${digests}

## Surface

Candidate functions: buildRollupWhere, dayClauses.
Current handwritten lines: ${report.surface.currentLines}.
Proposed helper lines (helper + two call sites): ${report.surface.proposedLines}.
Smaller: ${report.surface.smaller}.
Time-bound assemblies in the inspected files, including the candidate blocks: ${report.surface.adjacentAssemblies.join(
        ', ',
    )}.

## Predicate vectors

${vectors}

## Cases

| id | grain | bounds | filters | comparable | differences | reason |
| --- | --- | --- | --- | --- | --- | --- |
${caseRows}

## Timings

Seven-day fixture: ${report.timings.sevenDay.warmups} warmups, ${report.timings.sevenDay.measuredReads} sequential reads.
All-history fixture: ${report.timings.allHistory.warmups} warmups, ${report.timings.allHistory.measuredReads} sequential reads.
No real history database was opened. Both workloads use in-memory synthetic rows.

## Decision

${report.status === 'go' ? '1310 may consume this artifact after review.' : '1310 stays blocked.'}
`;
}

function renderJUnit(report: ParityReport): string {
    const cases = report.cases
        .map((item) => {
            const name = `1309 ${item.id}`;
            if (item.comparable && item.differences.length > 0) {
                return `    <testcase name="${xml(name)}"><failure message="${xml(item.reason)}">${xml(JSON.stringify(item.differences))}</failure></testcase>`;
            }
            return `    <testcase name="${xml(name)}"/>`;
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="1309-analytics-parity" tests="${report.cases.length}">
${cases}
</testsuite>
`;
}

function xml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

describe('1309 comparator and decision', () => {
    test('null is not zero and integers are exact', () => {
        expect(valuesEqual('freshInputTokens', null, 0, false)).toBe(false);
        expect(valuesEqual('freshInputTokens', 0, 0, false)).toBe(true);
        expect(valuesEqual('freshInputTokens', 1, 2, false)).toBe(false);
    });

    test('allocated columns use the 1e-9 relative tolerance', () => {
        const equivalence = readFileSync(resolve(import.meta.dir, 'rollup-equivalence.test.ts'), 'utf8');
        expect(equivalence).toContain('export const ALLOC_TOLERANCE_RATIO = 1e-9');
        expect(ALLOC_TOLERANCE_RATIO).toBe(1e-9);
        expect(valuesEqual('fresh_input_tokens_alloc', 1_000_000_000, 1_000_000_001, true)).toBe(true);
        expect(valuesEqual('fresh_input_tokens_alloc', 1_000_000_000, 1_000_000_002, true)).toBe(false);
        expect(valuesEqual('fresh_input_tokens_alloc', 100, 100.1, true)).toBe(false);
    });

    test('a comparable difference is no-go and a missing sample is inconclusive', () => {
        expect(
            decide({
                casesComplete: true,
                timingsComplete: true,
                digestsComplete: true,
                comparableDifferences: 2,
                smallerSurface: true,
            }).status,
        ).toBe('no-go');
        expect(
            decide({
                casesComplete: false,
                timingsComplete: true,
                digestsComplete: true,
                comparableDifferences: 0,
                smallerSurface: true,
            }).status,
        ).toBe('inconclusive');
        expect(
            decide({
                casesComplete: true,
                timingsComplete: false,
                digestsComplete: true,
                comparableDifferences: 0,
                smallerSurface: true,
            }).status,
        ).toBe('inconclusive');
        expect(
            decide({
                casesComplete: true,
                timingsComplete: true,
                digestsComplete: true,
                comparableDifferences: 0,
                smallerSurface: false,
            }).status,
        ).toBe('no-go');
        expect(
            decide({
                casesComplete: true,
                timingsComplete: true,
                digestsComplete: true,
                comparableDifferences: 0,
                smallerSurface: true,
            }).status,
        ).toBe('go');
    });
});

describe('1309 history parity evidence', () => {
    test('fixture records predicate vectors, parity, and the decision artifact', async () => {
        const db = await setup();
        await seedParity(db);
        await refreshHistoryBoardRollupsIncremental(db);
        expect(await historyBoardRollupsFresh(db)).toBe(true);
        const martRows = await db.queryFirst<{ n: number }>('SELECT COUNT(*) AS n FROM history_board_dimension_daily');
        expect(martRows?.n ?? 0).toBeGreaterThan(0);

        const traced = trace(db);
        const vectors = [
            {
                id: 'rollup-date-both',
                path: 'rollup',
                fragments: ['r.day >= DATE(?)', 'r.day <= DATE(?)'],
                absent: [] as string[],
            },
            {
                id: 'mart-date-both',
                path: 'mart',
                fragments: ['d.day >= DATE(?)', 'd.day <= DATE(?)'],
                absent: [],
            },
            {
                id: 'raw-instant-both',
                path: 'raw',
                fragments: ['m.ts >= ?', 'm.ts <= ?'],
                absent: ['DATE(?)'],
            },
            {
                id: 'rollup-date-lower',
                path: 'rollup',
                fragments: ['r.day >= DATE(?)'],
                absent: ['r.day <= DATE(?)'],
            },
            {
                id: 'rollup-date-unbounded',
                path: 'rollup',
                fragments: [],
                absent: ['DATE(?)'],
            },
            {
                id: 'rollup-instant-both',
                path: 'rollup',
                fragments: ["strftime('%Y-%m-%dT%H:%M:%SZ', ?)"],
                absent: ['r.day >= DATE(?)'],
            },
        ];
        traced.queries.length = 0;
        await historyBoardSummaryFromRollup(traced.db, selector({ since: DAY_SINCE, until: DAY_UNTIL }), '1d', 'model');
        expect(observed(traced.queries, 'r.day >= DATE(?)')).toBe(true);
        expect(observed(traced.queries, 'r.day <= DATE(?)')).toBe(true);
        expect(
            traced.queries.some((query) => query.params.includes(DAY_SINCE) && query.params.includes(DAY_UNTIL)),
        ).toBe(true);

        traced.queries.length = 0;
        await historyBoardSummaryFromMart(traced.db, selector({ since: DAY_SINCE, until: DAY_UNTIL }), 'model');
        expect(observed(traced.queries, 'd.day >= DATE(?)')).toBe(true);
        expect(observed(traced.queries, 'd.day <= DATE(?)')).toBe(true);

        traced.queries.length = 0;
        await messageRollup(traced.db, selector({ since: DAY_SINCE, until: DAY_UNTIL }));
        // 1326: the message plane selects instants, so both sides parse (see message-where.ts).
        expect(observed(traced.queries, 'julianday(m.ts) >= julianday(?)')).toBe(true);
        expect(observed(traced.queries, 'julianday(m.ts) <= julianday(?)')).toBe(true);
        expect(observed(traced.queries, 'DATE(?)')).toBe(false);

        traced.queries.length = 0;
        await historyBoardSummaryFromRollup(traced.db, selector({ since: MID_SINCE }), '1d', 'model');
        expect(observed(traced.queries, 'r.day >= DATE(?)')).toBe(true);
        expect(observed(traced.queries, 'r.day <= DATE(?)')).toBe(false);

        traced.queries.length = 0;
        await historyBoardSummaryFromRollup(traced.db, selector(), '1d', 'model');
        expect(observed(traced.queries, 'DATE(?)')).toBe(false);

        traced.queries.length = 0;
        await historyBoardSummaryFromRollup(traced.db, selector({ since: MID_SINCE, until: MID_UNTIL }), '1h', 'model');
        expect(observed(traced.queries, "strftime('%Y-%m-%dT%H:%M:%SZ', ?)")).toBe(true);
        expect(observed(traced.queries, 'r.day >= DATE(?)')).toBe(false);

        const cases: ParityCase[] = [];
        cases.push(await compareDaily(db, 'bounds-null', 'null', 'none', null, null, null, 'model'));
        cases.push(await compareDaily(db, 'bounds-lower-only', 'lower', 'none', MID_SINCE, null, null, 'model'));
        cases.push(await compareDaily(db, 'bounds-upper-only', 'upper', 'none', null, MID_UNTIL, null, 'model'));
        cases.push(
            await compareDaily(db, 'bounds-both-day-aligned', 'both-day', 'none', DAY_SINCE, DAY_UNTIL, null, 'model'),
        );
        cases.push(await compareDaily(db, 'grain-daily', 'both-day', 'none', DAY_SINCE, DAY_UNTIL, null, 'model'));
        cases.push(
            await compareDaily(db, 'filter-same-dimension', 'null', 'source=claude', null, null, 'claude', 'source'),
        );

        const subPredicates = timePredicates(MID_SINCE, MID_UNTIL);
        const [subRaw, subDate, subInstant] = await Promise.all([
            selectedHashes(db, subPredicates.raw.sql, subPredicates.raw.params),
            selectedHashes(db, subPredicates.date.sql, subPredicates.date.params),
            selectedHashes(db, subPredicates.instant.sql, subPredicates.instant.params),
        ]);
        const subSel = selector({ since: MID_SINCE, until: MID_UNTIL });
        const [rawBuckets, rollupBuckets] = await Promise.all([
            bucketedTokenSeries(db, subSel, '1h', 'model'),
            historyBoardBucketsFromRollup(db, subSel, '1h', 'model'),
        ]);
        cases.push({
            id: 'bounds-both-subdaily',
            grain: '1h',
            bounds: 'both-instant',
            filters: 'none',
            comparable: false,
            reason: sameSet(subRaw, subDate)
                ? 'mart is day-grain only; subdaily mart reads are noncomparable'
                : 'mart is day-grain only, and DATE(?) selects different rows than the raw instant bound',
            selectedCounts: { raw: subRaw.length, rollupDate: subDate.length, rollupInstant: subInstant.length },
            differences: [],
            notes: [
                `raw buckets ${rawBuckets.length}`,
                `rollup buckets ${rollupBuckets.length}`,
                `raw-vs-instant-rows ${sameSet(subRaw, subInstant) ? 'equal' : 'differ'}`,
            ],
        });
        cases.push({
            id: 'grain-subdaily',
            grain: '1h',
            bounds: 'null',
            filters: 'none',
            comparable: false,
            reason: 'mart has no subdaily grain; a 1h request stays on the rollup path',
            selectedCounts: { raw: 0, rollupDate: 0, rollupInstant: 0 },
            differences: [],
        });
        cases.push({
            id: 'filter-cross-dimension',
            grain: '1d',
            bounds: 'null',
            filters: 'model=opus on source dimension',
            comparable: false,
            reason: 'mart cannot apply a model filter on the source dimension; the service routes that request to rollup',
            selectedCounts: { raw: 0, rollupDate: 0, rollupInstant: 0 },
            differences: [],
        });
        cases.push({
            id: 'filter-tool',
            grain: '1d',
            bounds: 'null',
            filters: 'tool=Read',
            comparable: false,
            reason: 'a tool filter is not mart-eligible and the rollup read switches to allocated tool measures',
            selectedCounts: { raw: 0, rollupDate: 0, rollupInstant: 0 },
            differences: [],
        });
        cases.push({
            id: 'filter-skill',
            grain: '1d',
            bounds: 'null',
            filters: 'skill=code-review',
            comparable: false,
            reason: 'a skill filter is not mart-eligible; skill rows are not a second copy of the day predicate',
            selectedCounts: { raw: 0, rollupDate: 0, rollupInstant: 0 },
            differences: [],
        });

        const fresh = await historyBoardRollupsFresh(db);
        cases.push({
            id: 'watermark-fresh',
            grain: '1d',
            bounds: 'null',
            filters: 'none',
            comparable: false,
            reason: fresh
                ? 'rollups are fresh after refresh; measure parity is bounds-null'
                : 'expected a fresh watermark after refresh',
            selectedCounts: { raw: 0, rollupDate: 0, rollupInstant: 0 },
            differences: [],
        });

        await insertMessage(db, {
            recordHash: 'm-stale',
            source: 'claude',
            sessionId: 's-claude',
            seq: 6,
            ts: '2026-01-03T11:30:00Z',
            model: 'opus',
            input: 999,
            cacheRead: 0,
            output: 1,
            importedAt: FIXTURE_SEED.staleImportedAt,
        });
        const stale = await historyBoardRollupsFresh(db);
        const staleRaw = await messageRollup(db, selector());
        const staleRollup = await historyBoardSummaryFromRollup(db, selector(), '1d', 'model');
        const rawHasStale = staleRaw.some((row) => row.inputTokens === 999 || (row.inputTokens ?? 0) >= 999);
        const rollupOpus = staleRollup.models.find((row) => row.key === 'opus');
        cases.push({
            id: 'watermark-stale',
            grain: '1d',
            bounds: 'null',
            filters: 'none',
            comparable: false,
            reason: stale
                ? 'stale watermark check failed: rollups still read as fresh after the trailing import'
                : 'stale watermark: rollup and mart omit the trailing import; raw includes it. Noncomparable until refresh.',
            selectedCounts: {
                raw: rawHasStale ? 1 : 0,
                rollupDate: rollupOpus?.freshInputTokens ?? 0,
                rollupInstant: 0,
            },
            differences: [],
            notes: [`rawIncludes999=${rawHasStale}`, `rollupOpus=${rollupOpus?.freshInputTokens ?? 'missing'}`],
        });

        for (const phenomenon of [
            ['phenomenon-duplicate-import', 'm-dup-old is superseded by m-dup-new (same request_id, later rowid)'],
            [
                'phenomenon-null-measures',
                'm-null stores null token measures and is coalesced to 0 on the message rollup',
            ],
            ['phenomenon-unknown-usage', 'm-unknown uses model unknown in its own session'],
            [
                'phenomenon-midnight-boundary',
                'm-midnight is 2026-01-02T00:00:00Z and m-pre-midnight is the previous second',
            ],
        ] as const) {
            cases.push({
                id: phenomenon[0],
                grain: 'none',
                bounds: 'null',
                filters: 'fixture',
                comparable: false,
                reason: phenomenon[1],
                selectedCounts: { raw: 0, rollupDate: 0, rollupInstant: 0 },
                differences: [],
            });
        }

        const sevenDb = await setup();
        await seedSevenDays(sevenDb);
        await refreshHistoryBoardRollupsIncremental(sevenDb);
        const sevenSince = '2026-04-01T00:00:00Z';
        const sevenUntil = '2026-04-07T23:59:59Z';
        const timings = {
            sevenDay: await measureReads(sevenDb, selector({ since: sevenSince, until: sevenUntil })),
            allHistory: await measureReads(sevenDb, selector()),
        };

        // The read paths above run the current code, so they also prove 1310's consolidation kept
        // every result; only the source surface is measured at the frozen revision.
        const frozenRevision = existsSync(REPORT_JSON)
            ? (JSON.parse(readFileSync(REPORT_JSON, 'utf8')) as ParityReport).sourceRevision
            : null;
        const read = (path: string) => sourceAt(path, frozenRevision).toString('utf8');
        const surface = measureSurface(
            read('packages/domain/src/analytics/history-board-rollup.ts'),
            read('packages/domain/src/analytics/history-board-marts.ts'),
            read('packages/domain/src/analytics/message-where.ts'),
        );
        const sourceDigests = Object.fromEntries(INSPECTED.map((path) => [path, digestSource(path, frozenRevision)]));
        const comparableDifferences = cases
            .filter((item) => item.comparable)
            .reduce((sum, item) => sum + item.differences.length, 0);
        const timingsComplete =
            timings.sevenDay.warmups === 2 &&
            timings.sevenDay.measuredReads === 9 &&
            timings.sevenDay.rollupMs.length === 9 &&
            timings.sevenDay.martMs.length === 9 &&
            timings.sevenDay.rawMs.length === 9 &&
            timings.allHistory.rollupMs.length === 9;
        const decision = decide({
            casesComplete: cases.length >= 17,
            timingsComplete,
            digestsComplete: INSPECTED.every((path) => (sourceDigests[path] ?? '').length === 64),
            comparableDifferences,
            smallerSurface: surface.smaller,
        });
        const report: ParityReport = {
            schemaVersion: 1,
            candidate: 'time-range-predicates',
            status: decision.status,
            reason: decision.reason,
            cases,
            predicateVectors: vectors,
            surface,
            toolVersions: {
                bun: Bun.version,
                sqlite: (await db.queryFirst<{ v: string }>('SELECT sqlite_version() AS v'))?.v ?? '',
            },
            timings,
            sourceRevision: frozenRevision ?? gitHead(),
            sourceDigests,
            fixtureSeed: FIXTURE_SEED,
            command: COMMAND,
            measuredAt: new Date().toISOString(),
        };

        const required = [
            'bounds-null',
            'bounds-lower-only',
            'bounds-upper-only',
            'bounds-both-day-aligned',
            'bounds-both-subdaily',
            'grain-daily',
            'grain-subdaily',
            'filter-same-dimension',
            'filter-cross-dimension',
            'filter-tool',
            'filter-skill',
            'watermark-fresh',
            'watermark-stale',
            'phenomenon-duplicate-import',
            'phenomenon-null-measures',
            'phenomenon-unknown-usage',
            'phenomenon-midnight-boundary',
        ];
        for (const id of required) expect(cases.some((item) => item.id === id)).toBe(true);
        expect(cases.find((item) => item.id === 'bounds-lower-only')?.comparable).toBe(false);
        expect(cases.find((item) => item.id === 'bounds-upper-only')?.comparable).toBe(false);
        expect(cases.find((item) => item.id === 'grain-subdaily')?.comparable).toBe(false);
        expect(cases.find((item) => item.id === 'filter-cross-dimension')?.comparable).toBe(false);
        expect(cases.find((item) => item.id === 'watermark-stale')?.comparable).toBe(false);
        expect(cases.find((item) => item.id === 'watermark-stale')?.reason).toContain('stale watermark');
        expect(fresh).toBe(true);
        expect(stale).toBe(false);

        const write = !existsSync(REPORT_JSON);
        if (!write) {
            const existing = JSON.parse(readFileSync(REPORT_JSON, 'utf8')) as ParityReport;
            expect(stable(existing)).toEqual(stable(report));
            expect(existing.sourceRevision.length).toBeGreaterThan(0);
        } else {
            mkdirSync(dirname(REPORT_JSON), { recursive: true });
            mkdirSync(dirname(PROOF_JSON), { recursive: true });
            writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 4)}\n`);
            writeFileSync(REPORT_MD, renderMarkdown(report));
            writeFileSync(PROOF_JSON, `${JSON.stringify(report, null, 4)}\n`);
            writeFileSync(PROOF_JUNIT, renderJUnit(report));
            formatReport(REPORT_JSON);
        }

        expect(report.schemaVersion).toBe(1);
        expect(report.candidate).toBe('time-range-predicates');
        expect(['go', 'no-go', 'inconclusive']).toContain(report.status);
        expect(report.command).toBe(COMMAND);
        expect(report.surface.currentLines).toBeGreaterThan(0);
        expect(report.toolVersions.sqlite.length).toBeGreaterThan(0);
        const nullCase = cases.find((item) => item.id === 'bounds-null');
        expect(nullCase?.comparable, JSON.stringify(nullCase?.differences)).toBe(true);
        expect(nullCase?.differences, JSON.stringify(nullCase?.differences)).toEqual([]);
        const aligned = cases.find((item) => item.id === 'bounds-both-day-aligned');
        expect(aligned?.comparable, JSON.stringify(aligned)).toBe(true);
        expect(aligned?.differences, JSON.stringify(aligned?.differences)).toEqual([]);
        const sameDimension = cases.find((item) => item.id === 'filter-same-dimension');
        expect(sameDimension?.comparable, JSON.stringify(sameDimension)).toBe(true);
        expect(sameDimension?.differences, JSON.stringify(sameDimension?.differences)).toEqual([]);
    }, 60_000);
});
