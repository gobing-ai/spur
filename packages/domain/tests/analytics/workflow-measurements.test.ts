/**
 * Workflow run/state measurement SQL (task 1178 R1) — the domain query owner behind
 * `packages/app/src/workflow/run-measurements.ts`. These cases pin the SQL-level
 * invariants the app aggregation depends on: unmapped/unmeasured stays null (never 0),
 * the dry-run and timestamp predicates the two promotion queries deliberately differ on,
 * and the epoch-ms `sinceMs` window. No real history DB, no paid models.
 */
import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    readAgentRunHistoryRows,
    readRealTerminalRunCounts,
    readWorkflowRuns,
    readWorkflowStateActionRows,
    readWorkflowStateVisitRows,
} from '../../src/analytics/workflow-measurements';

/** Minimum history plane the measurement queries join over. */
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
    if (seed) await seed(db);
    return { db, close: () => db.close() };
}

async function insertRun(
    db: DbAdapter,
    id: string,
    workflow: string,
    status: string,
    startedAt: string,
    completedAt: string,
    opts: { dryRun?: boolean; createdAt?: number } = {},
): Promise<void> {
    await db.run(
        `INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        workflow,
        status,
        startedAt,
        completedAt,
        opts.dryRun ? '{"dryRun":true}' : '{}',
        opts.createdAt ?? 0,
    );
}

describe('readWorkflowRuns', () => {
    test('unmapped/unmeasured cost and tokens stay null, mapped sessions fold the typed columns', async () => {
        const { db, close } = await seedDb(async (d) => {
            await insertRun(d, 'r-mapped', 'p', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:05:00.000Z');
            await insertRun(d, 'r-unmapped', 'p', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:05:00.000Z');
            await d.run("INSERT INTO history_run_session VALUES ('r-mapped', 'omp', 's-a', 'exact', 'observed')");
            await d.run("INSERT INTO history_message VALUES ('omp', 's-a', '2026-08-20T00:01:00.000Z', 0.01, 100, 40)");
        });
        try {
            const rows = await readWorkflowRuns(db, ['p']);
            const unmapped = rows.find((r) => r.runId === 'r-unmapped');
            expect(unmapped?.tokenCostUsd).toBeNull(); // unmeasured → null, never 0
            expect(unmapped?.tokens).toBeNull();
            expect(unmapped?.historyRows).toBe(0);
            const mapped = rows.find((r) => r.runId === 'r-mapped');
            expect(mapped?.tokenCostUsd).toBeCloseTo(0.01, 4);
            expect(mapped?.tokens).toBe(140);
            expect(mapped?.usdRows).toBe(1);
        } finally {
            close();
        }
    });

    test('dry-run flag reads from metadata_json and sinceMs narrows on epoch-ms created_at', async () => {
        const { db, close } = await seedDb(async (d) => {
            await insertRun(d, 'r-real', 'p', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:05:00.000Z', {
                createdAt: 100,
            });
            await insertRun(d, 'r-dry', 'p', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:05:00.000Z', {
                dryRun: true,
                createdAt: 200,
            });
        });
        try {
            const all = await readWorkflowRuns(db, ['p']);
            expect(all.map((r) => [r.runId, r.dryRun])).toEqual([
                ['r-real', false],
                ['r-dry', true],
            ]);
            const narrowed = await readWorkflowRuns(db, ['p'], { sinceMs: 150 });
            expect(narrowed.map((r) => r.runId)).toEqual(['r-dry']);
        } finally {
            close();
        }
    });

    test('runs missing a time bound are not returned', async () => {
        const { db, close } = await seedDb(async (d) => {
            await insertRun(d, 'r-open', 'p', 'running', '2026-08-20T00:00:00.000Z', '');
        });
        try {
            expect(await readWorkflowRuns(db, ['p'])).toHaveLength(0);
        } finally {
            close();
        }
    });
});

describe('workflow per-state queries', () => {
    test('state action folds keep summed wall ms null when no action carried a duration', async () => {
        const { db, close } = await seedDb(async (d) => {
            await insertRun(d, 'r1', 'p', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:05:00.000Z');
            await d.run("INSERT INTO action_runs VALUES ('a1', 'r1', 'implement', 'agent.run', 'done', 1200)");
            await d.run("INSERT INTO action_runs VALUES ('a2', 'r1', 'implement', 'agent.run', 'done', NULL)");
            await d.run("INSERT INTO action_runs VALUES ('a3', 'r1', 'test', 'shell', 'done', NULL)");
        });
        try {
            const rows = await readWorkflowStateActionRows(db, ['p']);
            const implement = rows.find((r) => r.state === 'implement');
            expect(implement?.wallMs).toBe(1200); // SUM skips NULL
            expect(implement?.agentRunCount).toBe(2);
            const testState = rows.find((r) => r.state === 'test');
            expect(testState?.wallMs).toBeNull(); // all-NULL duration → unmeasured
            expect(testState?.agentRunCount).toBe(0);
        } finally {
            close();
        }
    });

    test('state visit counts group per (state, run) over terminal non-dry runs', async () => {
        const { db, close } = await seedDb(async (d) => {
            await insertRun(d, 'r1', 'p', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:05:00.000Z');
            await insertRun(d, 'rdry', 'p', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z', {
                dryRun: true,
            });
            await d.run("INSERT INTO transition_runs VALUES ('t1', 'r1', 'a', 'implement', 1)");
            await d.run("INSERT INTO transition_runs VALUES ('t2', 'r1', 'b', 'implement', 2)");
            await d.run("INSERT INTO transition_runs VALUES ('t3', 'rdry', 'a', 'implement', 3)");
        });
        try {
            const rows = await readWorkflowStateVisitRows(db, ['p']);
            expect(rows).toEqual([{ workflow: 'p', state: 'implement', visitsInRun: 2 }]); // dry run excluded
        } finally {
            close();
        }
    });
});

describe('promotion run queries', () => {
    test('readAgentRunHistoryRows rejects dry runs and requires timestamps; no agent.run → null duration', async () => {
        const { db, close } = await seedDb(async (d) => {
            await insertRun(d, 'r-real', 'p', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:05:00.000Z');
            await insertRun(d, 'r-dry', 'p', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:05:00.000Z', {
                dryRun: true,
            });
            await insertRun(d, 'r-open', 'p', 'running', '2026-08-20T02:00:00.000Z', '');
            await d.run("INSERT INTO action_runs VALUES ('a1', 'r-real', 'implement', 'agent.run', 'done', 3000)");
        });
        try {
            const rows = await readAgentRunHistoryRows(db, 'p');
            expect(rows).toEqual([{ runId: 'r-real', count: 1, durationMs: 3000 }]);
            const narrowed = await readAgentRunHistoryRows(db, 'p', ['r-missing']);
            expect(narrowed).toHaveLength(0);
        } finally {
            close();
        }
    });

    test('readRealTerminalRunCounts has no timestamp gate and accepts absent/0/false dry-run forms', async () => {
        const { db, close } = await seedDb(async (d) => {
            await insertRun(d, 'r-open', 'p', 'done', '', ''); // unbalanced bounds, still counted
            await insertRun(d, 'r-dry', 'p', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:05:00.000Z', {
                dryRun: true,
            });
            await insertRun(d, 'r-zero', 'p', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z');
            await d.run("UPDATE runs SET metadata_json = '{\"dryRun\":0}' WHERE id = 'r-zero'");
        });
        try {
            expect(await readRealTerminalRunCounts(db)).toEqual([{ workflow: 'p', count: 2 }]); // r-open + r-zero
        } finally {
            close();
        }
    });
});
