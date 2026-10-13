/**
 * Workflow run/state measurement owner (task 1178 R1) — the extraction of the
 * `readWorkflowRuns`/`readWorkflowMetrics`/`readStateMetrics` measurement out of
 * `scripts/commands/real-run-cost.ts`.
 *
 * These cases observe REAL query/aggregation behavior against an in-memory SQLite history
 * plane (`createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' })`) — no real history
 * DB, no paid models. The `scripts/commands/real-run-cost.test.ts` parity suite keeps
 * pinning the repository wrapper/CLI behavior over the same semantics.
 */
import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { nearestRankPercentile, readStateMetrics, readWorkflowMetrics } from '../../src/workflow/run-measurements';

/** In-memory history plane shaped like the live one: text run bounds, `metadata_json` dry
 * flags, epoch-ms `created_at`, transition hops and `action_runs`. */
async function seedDb(seed?: (db: DbAdapter) => Promise<void>): Promise<{ db: DbAdapter; close: () => void }> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await db.exec(
        'CREATE TABLE runs (id TEXT, workflow_name TEXT, status TEXT, started_at TEXT, completed_at TEXT, metadata_json TEXT, created_at INTEGER, terminal_reason TEXT)',
    );
    await db.exec(
        'CREATE TABLE history_run_session (run_id TEXT, source TEXT, session_id TEXT, exactness TEXT, mechanism TEXT)',
    );
    await db.exec(
        'CREATE TABLE history_message (source TEXT, session_id TEXT, ts TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER)',
    );
    await db.exec(
        'CREATE TABLE transition_runs (id TEXT, run_id TEXT, from_state TEXT, to_state TEXT, created_at INTEGER)',
    );
    await db.exec(
        'CREATE TABLE action_runs (id TEXT, run_id TEXT, node TEXT, kind TEXT, status TEXT, duration_ms INTEGER)',
    );
    const run = (id: string, workflow: string, status: string, startedAt: string, completedAt: string) =>
        db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json) VALUES (?, ?, ?, ?, ?, '{}')",
            id,
            workflow,
            status,
            startedAt,
            completedAt,
        );
    // task-pipeline: two terminal real runs + a dry probe + a stale non-terminal row.
    await run('r1', 'task-pipeline', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:33:00.000Z');
    await run('r2', 'task-pipeline', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:34:00.000Z');
    await run('rdry', 'task-pipeline', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z');
    await run('rstale', 'task-pipeline', 'running', '2026-08-20T03:00:00.000Z', '2026-08-20T03:00:12.000Z');
    await db.run("UPDATE runs SET metadata_json = '{\"dryRun\":true}' WHERE id = 'rdry'");
    // wrapup-pipeline: one costed run and one token-only run (null USD).
    await run('rcost', 'wrapup-pipeline', 'done', '2026-08-20T04:00:00.000Z', '2026-08-20T04:05:00.000Z');
    await db.run("INSERT INTO history_run_session VALUES ('rcost', 'omp', 's-a', 'exact', 'observed')");
    await db.run("INSERT INTO history_message VALUES ('omp', 's-a', '2026-08-20T04:01:00.000Z', 0.0123, 1000, 200)");
    await run('rtok', 'wrapup-pipeline', 'done', '2026-08-20T05:00:00.000Z', '2026-08-20T05:10:00.000Z');
    await db.run("INSERT INTO history_run_session VALUES ('rtok', 'claude', 's-x', 'exact', 'observed')");
    await db.run("INSERT INTO history_message VALUES ('claude', 's-x', '2026-08-20T05:01:00.000Z', NULL, 500, 100)");
    // Transition hops: rcost has 3 (first→last = 300s); r1 has 1 (too few to bound).
    await db.run("INSERT INTO transition_runs VALUES ('t1', 'rcost', 'precheck', 'implement', 1724121660000)");
    await db.run("INSERT INTO transition_runs VALUES ('t2', 'rcost', 'implement', 'test', 1724121900000)");
    await db.run("INSERT INTO transition_runs VALUES ('t3', 'rcost', 'test', 'done', 1724121960000)");
    await db.run("INSERT INTO transition_runs VALUES ('tsolo', 'r1', 'precheck', 'implement', 1724107500000)");
    if (seed) await seed(db);
    return { db, close: () => db.close() };
}

/** Assert exactly one rounded number and return it (noUncheckedIndexedAccess-safe). */
function one<T>(rows: T[]): T {
    if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}`);
    return rows[0] as T;
}

describe('readWorkflowMetrics (1178 R1 domain query + app aggregation)', () => {
    test('folds wall-clock over terminal non-dry runs and keeps excluded rows counted', async () => {
        const { db, close } = await seedDb();
        try {
            const tp = one(await readWorkflowMetrics(db, ['task-pipeline']));
            expect(tp.runs).toBe(4); // r1, r2, rdry, rstale
            expect(tp.terminalRuns).toBe(2); // r1 + r2
            expect(tp.dryRuns).toBe(1);
            expect(tp.nonTerminalRuns).toBe(1);
            expect(tp.wallClockMs).toEqual({ mean: 2010000, median: 2010000, min: 1980000, max: 2040000 });
        } finally {
            close();
        }
    });

    test('folds cost and tokens independently; unmapped/unmeasured stays null, never 0', async () => {
        const { db, close } = await seedDb();
        try {
            const wrapup = one(await readWorkflowMetrics(db, ['wrapup-pipeline']));
            expect(wrapup.tokenCostUsd).toBeCloseTo(0.0123, 4); // only rcost carries USD
            expect(wrapup.tokens).toBe(1800); // rcost 1200 + rtok 600 (USD null keeps tokens)
            expect(wrapup.mappedRuns).toBe(2);
            expect(wrapup.historyRows).toBe(2);
            expect(wrapup.usdRows).toBe(1);
            const docs = one(await readWorkflowMetrics(db, ['docs-pipeline']));
            expect(docs.runs).toBe(0);
            expect(docs.wallClockMs).toBeNull();
            expect(docs.tokenCostUsd).toBeNull();
            expect(docs.tokens).toBeNull();
        } finally {
            close();
        }
    });

    test('active time needs ≥2 transition hops; single-hop runs report a null bound', async () => {
        const { db, close } = await seedDb();
        try {
            const wrapup = one(await readWorkflowMetrics(db, ['wrapup-pipeline']));
            expect(wrapup.activeRuns).toBe(1);
            expect(wrapup.activeMs).toEqual({ mean: 300000, median: 300000, min: 300000, max: 300000 });
            const tp = one(await readWorkflowMetrics(db, ['task-pipeline']));
            expect(tp.activeMs).toBeNull();
            expect(tp.activeRuns).toBe(0);
        } finally {
            close();
        }
    });

    test('--since narrows numerically on epoch-ms created_at, not text', async () => {
        const { db, close } = await seedDb(async (d) => {
            const run = (id: string, createdAt: number) =>
                d.run(
                    "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at) VALUES (?, 'history-anatomy', 'done', '2026-09-03T00:00:00.000Z', '2026-09-03T00:10:00.000Z', '{}', ?)",
                    id,
                    createdAt,
                );
            await run('h1', 999);
            await run('h2', 1500);
        });
        try {
            const windowed = one(await readWorkflowMetrics(db, ['history-anatomy'], { sinceMs: 1000 }));
            expect(windowed.terminalRuns).toBe(1); // h2 only; 999 < 1000 despite "999" > "1000"
        } finally {
            close();
        }
    });
});

describe('readStateMetrics (1178 R1 per-state fold)', () => {
    test('folds visits/retries/agent.run counts and per-(run,state) wall percentiles, ordered state', async () => {
        const { db, close } = await seedDb(async (d) => {
            for (const id of ['p1', 'p2']) {
                await d.run(
                    "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at) VALUES (?, 'pr-review', 'done', '2026-09-01T00:00:00.000Z', '2026-09-01T00:30:00.000Z', '{}', 1)",
                    id,
                );
            }
            // p1 visits check 3× and done 1×; p2 visits check 1×.
            const visit = (id: string, runId: string, state: string) =>
                d.run("INSERT INTO transition_runs VALUES (?, ?, 'prev', ?, 1)", id, runId, state);
            await visit('v1', 'p1', 'check');
            await visit('v2', 'p1', 'check');
            await visit('v3', 'p1', 'check');
            await visit('v4', 'p1', 'done');
            await visit('v5', 'p2', 'check');
            const action = (id: string, runId: string, node: string, kind: string, ms: number | null) =>
                d.run("INSERT INTO action_runs VALUES (?, ?, ?, ?, 'done', ?)", id, runId, node, kind, ms);
            await action('a1', 'p1', 'check', 'agent.run', 100);
            await action('a2', 'p1', 'check', 'agent.run', 300);
            await action('a3', 'p1', 'done', 'run.artifact', 50);
            await action('a4', 'p2', 'check', 'agent.run', 200);
        });
        try {
            const rows = await readStateMetrics(db, ['pr-review']);
            expect(rows.map((r) => `${r.workflow}/${r.state}`)).toEqual(['pr-review/check', 'pr-review/done']);
            const check = rows[0] as (typeof rows)[number];
            expect(check.visits).toBe(4); // 3 in p1 + 1 in p2
            expect(check.retries).toBe(2); // (3−1) + (1−1)
            expect(check.agentRunCount).toBe(3);
            expect(check.wallMsP50).toBe(200); // samples [400, 200] → rank-1
            expect(check.wallMsP90).toBe(400);
            const done = rows[1] as (typeof rows)[number];
            expect(done.visits).toBe(1);
            expect(done.retries).toBe(0);
            expect(done.agentRunCount).toBe(0); // run.artifact only — measured zero, not null
            expect(done.wallMsP50).toBe(50);
        } finally {
            close();
        }
    });

    test('dry and non-terminal runs never enter state metrics (same population as workflow stats)', async () => {
        const { db, close } = await seedDb(async (d) => {
            await d.run(
                "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at) VALUES ('p1', 'pr-review', 'done', '2026-09-01T00:00:00.000Z', '2026-09-01T00:30:00.000Z', '{}', 1)",
            );
            await d.run(
                "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at) VALUES ('p3', 'pr-review', 'done', '2026-09-01T02:00:00.000Z', '2026-09-01T02:01:00.000Z', '{\"dryRun\":true}', 2)",
            );
            await d.run(
                "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at) VALUES ('p4', 'pr-review', 'running', '2026-09-01T03:00:00.000Z', '2026-09-01T03:01:00.000Z', '{}', 3)",
            );
            for (const [runId, id, ms] of [
                ['p1', 'a1', 100],
                ['p3', 'a9', 999],
                ['p4', 'a8', 888],
            ] as const) {
                await d.run("INSERT INTO transition_runs VALUES (?, ?, 'prev', 'check', 1)", `v-${id}`, runId);
                await d.run("INSERT INTO action_runs VALUES (?, ?, 'check', 'agent.run', 'done', ?)", id, runId, ms);
            }
        });
        try {
            const rows = await readStateMetrics(db, ['pr-review']);
            expect(rows).toHaveLength(1);
            expect(rows[0]?.visits).toBe(1);
            expect(rows[0]?.agentRunCount).toBe(1);
            expect(rows[0]?.wallMsP50).toBe(100); // 999/888 excluded with their runs
        } finally {
            close();
        }
    });
});

describe('nearestRankPercentile (nearest-rank, no interpolation)', () => {
    test('picks the ⌈p/100 × n⌉-th smallest sample; null on an empty sample', () => {
        const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
        expect(nearestRankPercentile(samples, 50)).toBe(500);
        expect(nearestRankPercentile(samples, 90)).toBe(900);
        expect(nearestRankPercentile([1, 2, 3, 4], 50)).toBe(2); // sample member, not 2.5
        expect(nearestRankPercentile([], 50)).toBeNull();
    });
});
