import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkflowMetrics } from './real-run-cost';

/** Build a temp DB with the history-plane tables + runs needed by the R5 reading path. */
async function seedDb(): Promise<{ dir: string; dbPath: string; close: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'real-run-cost-'));
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.run('CREATE TABLE runs (id TEXT, workflow_name TEXT, started_at TEXT, completed_at TEXT)');
    db.run(
        'CREATE TABLE history_run_session (run_id TEXT, source TEXT, session_id TEXT, exactness TEXT, mechanism TEXT)',
    );
    db.run(
        'CREATE TABLE history_message (source TEXT, session_id TEXT, ts TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER)',
    );

    // Two terminal task-pipeline runs with ISO-8601 bounds (text timestamps).
    db.run("INSERT INTO runs VALUES ('r1', 'task-pipeline', '2026-08-20T00:00:00.000Z', '2026-08-20T00:33:00.000Z')"); // 1980s
    db.run("INSERT INTO runs VALUES ('r2', 'task-pipeline', '2026-08-20T01:00:00.000Z', '2026-08-20T01:34:00.000Z')"); // 2040s
    // A degenerate abandoned run spanning > 24h — must be excluded from wall stats.
    db.run("INSERT INTO runs VALUES ('r3', 'task-pipeline', '2026-08-01T00:00:00.000Z', '2026-08-29T00:00:00.000Z')");
    // A run with a mapped session carrying typed cost columns.
    db.run("INSERT INTO runs VALUES ('r4', 'wrapup-pipeline', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z')"); // 300s
    db.run("INSERT INTO history_run_session VALUES ('r4', 'omp', 'session-a', 'exact', 'observed')");
    db.run("INSERT INTO history_message VALUES ('omp', 'session-a', '2026-08-20T02:01:00.000Z', 0.0123, 1000, 200)");
    // A run with a mapping but NO cost rows -> unmeasured (null), never 0.
    db.run("INSERT INTO runs VALUES ('r5', 'idea-pipeline', '2026-08-20T03:00:00.000Z', '2026-08-20T03:10:00.000Z')");
    db.run("INSERT INTO history_run_session VALUES ('r5', 'claude', 'session-x', 'exact', 'observed')");
    db.run("INSERT INTO history_message VALUES ('claude', 'session-x', '2026-08-20T03:01:00.000Z', NULL, NULL, NULL)");

    return {
        dir,
        dbPath,
        close: async () => {
            db.close();
            await rm(dir, { recursive: true, force: true });
        },
    };
}

describe('readWorkflowMetrics (0607 R5 real-run reading path)', () => {
    test('computes wall-clock from ISO text bounds and excludes degenerate >24h runs', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const metrics = readWorkflowMetrics(dbPath, ['task-pipeline']);
            expect(metrics).toHaveLength(1);
            const tp = metrics[0];
            expect(tp.runs).toBe(3); // all runs counted
            expect(tp.wallClockMs).not.toBeNull();
            // Only r1 (1980s) + r2 (2040s) are sane; median = mean = 2010s.
            expect(tp.wallClockMs).toEqual({ mean: 2010000, median: 2010000, min: 1980000, max: 2040000 });
        } finally {
            await close();
        }
    });

    test('folds mapped-session cost from the history plane (typed columns)', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const [wrapup] = readWorkflowMetrics(dbPath, ['wrapup-pipeline']);
            expect(wrapup.tokenCostUsd).toBeCloseTo(0.0123, 4);
            expect(wrapup.tokens).toBe(1200);
        } finally {
            await close();
        }
    });

    test('a mapped run with no cost rows reports null, never 0 (unmeasured ≠ free)', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const [idea] = readWorkflowMetrics(dbPath, ['idea-pipeline']);
            expect(idea.tokenCostUsd).toBeNull();
            expect(idea.tokens).toBeNull();
        } finally {
            await close();
        }
    });

    test('a workflow with no runs reports nulls and zero count', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const [docs] = readWorkflowMetrics(dbPath, ['docs-pipeline']);
            expect(docs.runs).toBe(0);
            expect(docs.wallClockMs).toBeNull();
            expect(docs.tokenCostUsd).toBeNull();
        } finally {
            await close();
        }
    });
});
