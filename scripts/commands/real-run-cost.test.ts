import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inScopeWorkflows, readWorkflowMetrics } from './real-run-cost';

/**
 * Build a temp DB shaped like the live history plane (runs.metadata_json + status +
 * transition_runs) to prove the 0730 R2 measurement repairs:
 * dry-run inclusion, partial workflow scope, blanket long-run exclusion, null-USD token
 * rows, active-vs-paused duration, unknown-as-zero.
 */
async function seedDb(): Promise<{ dir: string; dbPath: string; close: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'real-run-cost-'));
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.run(
        'CREATE TABLE runs (id TEXT, workflow_name TEXT, status TEXT, started_at TEXT, completed_at TEXT, metadata_json TEXT)',
    );
    db.run(
        'CREATE TABLE history_run_session (run_id TEXT, source TEXT, session_id TEXT, exactness TEXT, mechanism TEXT)',
    );
    db.run(
        'CREATE TABLE history_message (source TEXT, session_id TEXT, ts TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER)',
    );
    db.run('CREATE TABLE transition_runs (id TEXT, run_id TEXT, from_state TEXT, to_state TEXT, created_at INTEGER)');

    const insRun = db.query("INSERT INTO runs VALUES (?, ?, ?, ?, ?, '{}')");
    // Terminal real runs with ISO-8601 bounds (live schema stores text timestamps).
    insRun.run('r1', 'task-pipeline', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:33:00.000Z'); // 1980s
    insRun.run('r2', 'task-pipeline', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:34:00.000Z'); // 2040s
    // A legit LONG terminal run (>24h) — 0730 R2: no blanket ceiling, it stays in stats.
    insRun.run('rlong', 'idea-pipeline', 'done', '2026-08-01T00:00:00.000Z', '2026-08-02T12:00:00.000Z'); // 36h
    // Dry-run probes — excluded from real-work stats, counted in dryRuns.
    db.run(
        "INSERT INTO runs VALUES ('rdry', 'task-pipeline', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z', '{\"dryRun\":true,\"definitionDigest\":\"sha256:x\"}')",
    );
    db.run(
        "INSERT INTO runs VALUES ('rdry2', 'task-pipeline', 'failed', '2026-08-20T02:10:00.000Z', '2026-08-20T02:10:01.000Z', '{\"dryRun\":true}')",
    );
    // Non-terminal row with a STALE completed_at (live: 0729's abandoned lifecycle run) —
    // excluded, counted in nonTerminalRuns; the old code folded it into wall stats.
    insRun.run('rstale', 'task-pipeline', 'running', '2026-08-20T03:00:00.000Z', '2026-08-20T03:00:12.000Z');
    // Terminal run with a mapped session carrying typed cost + tokens.
    insRun.run('rcost', 'wrapup-pipeline', 'done', '2026-08-20T04:00:00.000Z', '2026-08-20T04:05:00.000Z'); // 300s
    db.run("INSERT INTO history_run_session VALUES ('rcost', 'omp', 'session-a', 'exact', 'observed')");
    db.run("INSERT INTO history_message VALUES ('omp', 'session-a', '2026-08-20T04:01:00.000Z', 0.0123, 1000, 200)");
    // Terminal run mapped to rows with TOKENS but NULL USD (0730 R2: null-USD token rows)
    // plus a second null-USD row — tokens measured, cost null, coverage 0/2.
    insRun.run('rtok', 'wrapup-pipeline', 'done', '2026-08-20T05:00:00.000Z', '2026-08-20T05:10:00.000Z');
    db.run("INSERT INTO history_run_session VALUES ('rtok', 'claude', 'session-x', 'exact', 'observed')");
    db.run("INSERT INTO history_message VALUES ('claude', 'session-x', '2026-08-20T05:01:00.000Z', NULL, 500, 100)");
    db.run("INSERT INTO history_message VALUES ('claude', 'session-x', '2026-08-20T05:02:00.000Z', NULL, 300, 50)");
    // Mapped run with neither cost nor tokens — unmeasured (null), never 0.
    insRun.run('rempty', 'idea-pipeline', 'done', '2026-08-20T06:00:00.000Z', '2026-08-20T06:10:00.000Z');
    db.run("INSERT INTO history_run_session VALUES ('rempty', 'claude', 'session-y', 'exact', 'observed')");
    db.run("INSERT INTO history_message VALUES ('claude', 'session-y', '2026-08-20T06:01:00.000Z', NULL, NULL, NULL)");
    // Transition hops for active-time bounds: rcost has 3 hops (first 60s after start,
    // last at completion − 0); r1 has 1 hop (insufficient — bounds a single instant).
    db.run("INSERT INTO transition_runs VALUES ('t1', 'rcost', 'precheck', 'implement', 1724121660000)"); // 04:01
    db.run("INSERT INTO transition_runs VALUES ('t2', 'rcost', 'implement', 'test', 1724121900000)"); // 04:05−60s
    db.run("INSERT INTO transition_runs VALUES ('t3', 'rcost', 'test', 'done', 1724121960000)"); // 04:06
    db.run("INSERT INTO transition_runs VALUES ('tsolo', 'r1', 'precheck', 'implement', 1724107500000)");

    return {
        dir,
        dbPath,
        close: async () => {
            db.close();
            await rm(dir, { recursive: true, force: true });
        },
    };
}

/** Assert exactly one metric row and return it (noUncheckedIndexedAccess-safe). */
function one(metrics: ReturnType<typeof readWorkflowMetrics>) {
    if (metrics.length !== 1) throw new Error(`expected 1 metric row, got ${metrics.length}`);
    const [row] = metrics;
    return row as NonNullable<(typeof metrics)[0]>;
}

describe('readWorkflowMetrics (0730 R2 measurement repairs)', () => {
    test('computes wall-clock from ISO text bounds over terminal non-dry runs', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const tp = one(readWorkflowMetrics(dbPath, ['task-pipeline']));
            expect(tp.runs).toBe(5); // r1, r2, rdry, rdry2, rstale
            expect(tp.terminalRuns).toBe(2); // r1 + r2 only
            expect(tp.dryRuns).toBe(2);
            expect(tp.nonTerminalRuns).toBe(1); // rstale
            expect(tp.wallClockMs).toEqual({ mean: 2010000, median: 2010000, min: 1980000, max: 2040000 });
        } finally {
            await close();
        }
    });

    test('no blanket long-run ceiling: a legit >24h terminal run stays in wall stats', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const idea = one(readWorkflowMetrics(dbPath, ['idea-pipeline']));
            expect(idea.terminalRuns).toBe(2); // rlong (36h) + rempty, both terminal
            expect(idea.wallClockMs).not.toBeNull();
            expect(idea.wallClockMs?.max).toBe(36 * 3600 * 1000); // 36h run included
        } finally {
            await close();
        }
    });

    test('dry-run and non-terminal rows never enter real-work stats (counts stay visible)', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const tp = one(readWorkflowMetrics(dbPath, ['task-pipeline']));
            // rstale (3s stale-completed 'running') and rdry2 (1s dry 'failed') would
            // have dragged the median down under the old code.
            expect(tp.wallClockMs?.min).toBe(1980000);
            expect(tp.wallClockMs?.median).toBe(2010000);
        } finally {
            await close();
        }
    });

    test('folds mapped-session cost from the history plane (typed columns)', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const wrapup = one(readWorkflowMetrics(dbPath, ['wrapup-pipeline']));
            expect(wrapup.tokenCostUsd).toBeCloseTo(0.0123, 4); // only rcost has USD
            expect(wrapup.mappedRuns).toBe(2);
            expect(wrapup.historyRows).toBe(3);
            expect(wrapup.usdRows).toBe(1); // null-USD exposure reported, not hidden
        } finally {
            await close();
        }
    });

    test('tokens fold independently of USD: null-USD token rows keep their token counts', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const wrapup = one(readWorkflowMetrics(dbPath, ['wrapup-pipeline']));
            // rcost 1200 tokens + rtok 950 tokens (600 in + 350 out, USD null).
            expect(wrapup.tokens).toBe(2150);
        } finally {
            await close();
        }
    });

    test('a mapped run with no cost AND no token rows reports nulls, never 0', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const idea = one(readWorkflowMetrics(dbPath, ['idea-pipeline']));
            expect(idea.tokenCostUsd).toBeNull();
            expect(idea.tokens).toBeNull();
        } finally {
            await close();
        }
    });

    test('active time bounds from ≥2 transition hops; single-hop runs report null bound', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const wrapup = one(readWorkflowMetrics(dbPath, ['wrapup-pipeline']));
            // rcost hops: 04:01 → 04:05 → 04:06 ⇒ active span 300000ms (last − first).
            expect(wrapup.activeRuns).toBe(1);
            expect(wrapup.activeMs).toEqual({ mean: 300000, median: 300000, min: 300000, max: 300000 });
            const tp = one(readWorkflowMetrics(dbPath, ['task-pipeline']));
            expect(tp.activeMs).toBeNull(); // r1/r2 have 0 hops; tsolo is 1 hop
            expect(tp.activeRuns).toBe(0);
        } finally {
            await close();
        }
    });

    test('a workflow with no runs reports nulls and zero counts', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const docs = one(readWorkflowMetrics(dbPath, ['docs-pipeline']));
            expect(docs.runs).toBe(0);
            expect(docs.wallClockMs).toBeNull();
            expect(docs.tokenCostUsd).toBeNull();
            expect(docs.tokens).toBeNull();
        } finally {
            await close();
        }
    });
});

describe('inScopeWorkflows (0730 R1/R2 cohort scope)', () => {
    test('unions baseline keys with config/workflows definitions (not baseline-only)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'scope-'));
        try {
            const baseline = join(dir, 'baseline.json');
            const wfDir = join(dir, 'workflows');
            await writeFile(baseline, JSON.stringify({ workflows: { 'task-pipeline': {}, 'docs-pipeline': {} } }));
            await mkdir(wfDir);
            // task-pipeline overlaps; the three workflows missing from the live
            // baseline (feature-lifecycle, history-anatomy, task-lifecycle) are added.
            for (const name of ['task-pipeline', 'task-lifecycle', 'feature-lifecycle', 'history-anatomy']) {
                await writeFile(join(wfDir, `${name}.yaml`), 'placeholder');
            }
            await writeFile(join(wfDir, 'not-a-workflow.txt'), 'skip');
            const scope = await inScopeWorkflows(baseline, wfDir);
            expect(scope).toEqual([
                'docs-pipeline',
                'feature-lifecycle',
                'history-anatomy',
                'task-lifecycle',
                'task-pipeline',
            ]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('falls back to the definitions dir when the baseline is unreadable, and vice versa', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'scope2-'));
        try {
            const wfDir = join(dir, 'workflows');
            await mkdir(wfDir);
            await writeFile(join(wfDir, 'basic.yaml'), 'placeholder');
            expect(await inScopeWorkflows(join(dir, 'missing.json'), wfDir)).toEqual(['basic']);
            await writeFile(join(dir, 'baseline.json'), JSON.stringify({ workflows: { 'pr-review': {} } }));
            expect(await inScopeWorkflows(join(dir, 'baseline.json'), join(dir, 'missing-dir'))).toEqual(['pr-review']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
