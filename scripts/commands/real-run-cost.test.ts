import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildReportJson,
    inScopeWorkflows,
    nearestRankPercentile,
    readStateMetrics,
    readWorkflowMetrics,
    realRunCost,
    scopedWorkflows,
    stableJson,
} from './real-run-cost';

/**
 * Build a temp DB shaped like the live history plane (runs.metadata_json + status +
 * transition_runs + action_runs + the 0937 terminal_reason column + epoch-ms created_at)
 * to prove the 0730 R2 measurement repairs:
 * dry-run inclusion, partial workflow scope, blanket long-run exclusion, null-USD token
 * rows, active-vs-paused duration, unknown-as-zero — and the 0938 additions built on the
 * same engine DDL.
 */
async function seedDb(
    extra?: (db: Database) => void,
): Promise<{ dir: string; dbPath: string; close: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'real-run-cost-'));
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.run(
        'CREATE TABLE runs (id TEXT, workflow_name TEXT, status TEXT, started_at TEXT, completed_at TEXT, metadata_json TEXT, created_at INTEGER, terminal_reason TEXT)',
    );
    db.run(
        'CREATE TABLE history_run_session (run_id TEXT, source TEXT, session_id TEXT, exactness TEXT, mechanism TEXT)',
    );
    db.run(
        'CREATE TABLE history_message (source TEXT, session_id TEXT, ts TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER)',
    );
    db.run('CREATE TABLE transition_runs (id TEXT, run_id TEXT, from_state TEXT, to_state TEXT, created_at INTEGER)');
    // Engine action_runs shape (subset the queries read): node = state id, kind, duration_ms.
    db.run('CREATE TABLE action_runs (id TEXT, run_id TEXT, node TEXT, kind TEXT, status TEXT, duration_ms INTEGER)');

    const insRun = db.query(
        "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json) VALUES (?, ?, ?, ?, ?, '{}')",
    );
    // Terminal real runs with ISO-8601 bounds (live schema stores text timestamps).
    insRun.run('r1', 'task-pipeline', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:33:00.000Z'); // 1980s
    insRun.run('r2', 'task-pipeline', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:34:00.000Z'); // 2040s
    // A legit LONG terminal run (>24h) — 0730 R2: no blanket ceiling, it stays in stats.
    insRun.run('rlong', 'idea-pipeline', 'done', '2026-08-01T00:00:00.000Z', '2026-08-02T12:00:00.000Z'); // 36h
    // Dry-run probes — excluded from real-work stats, counted in dryRuns.
    db.run(
        "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json) VALUES ('rdry', 'task-pipeline', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z', '{\"dryRun\":true,\"definitionDigest\":\"sha256:x\"}')",
    );
    db.run(
        "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json) VALUES ('rdry2', 'task-pipeline', 'failed', '2026-08-20T02:10:00.000Z', '2026-08-20T02:10:01.000Z', '{\"dryRun\":true}')",
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

    // 0938 scenarios opt in via this hook (runs with created_at/terminal_reason, state
    // transitions and actions) — the base rows above stay untouched for the 0730 tests.
    extra?.(db);

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

/** Assert a state row exists at the index and return it (noUncheckedIndexedAccess-safe). */
function at<T>(rows: T[], index: number): T {
    const row = rows[index];
    if (row === undefined) throw new Error(`expected a row at index ${index}, got ${rows.length} row(s)`);
    return row;
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
    test('scopes the cohort to the config/workflows definitions', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'scope-'));
        try {
            const wfDir = join(dir, 'workflows');
            await mkdir(wfDir);
            for (const name of ['task-pipeline', 'task-lifecycle', 'feature-lifecycle', 'history-anatomy']) {
                await writeFile(join(wfDir, `${name}.yaml`), 'placeholder');
            }
            await writeFile(join(wfDir, 'not-a-workflow.txt'), 'skip');
            const scope = await inScopeWorkflows(wfDir);
            expect(scope).toEqual(['feature-lifecycle', 'history-anatomy', 'task-lifecycle', 'task-pipeline']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('a missing definitions dir degrades to an empty cohort, never a crash', async () => {
        expect(await inScopeWorkflows('/nonexistent/workflows')).toEqual([]);
    });
});

// ── 0938: per-state metrics, workflow additions, determinism, flags ─────────────────

/** Seed helpers shared by the 0938 scenarios (engine DDL from the fixture above). */
function insRunFull(db: Database) {
    return db.query(
        "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at, terminal_reason) VALUES (?, ?, ?, ?, ?, '{}', ?, ?)",
    );
}
function insTransition(db: Database, id: string, runId: string, toState: string) {
    db.run(`INSERT INTO transition_runs VALUES ('${id}', '${runId}', 'prev', '${toState}', 1)`);
}
function insAction(db: Database, id: string, runId: string, node: string, kind: string, durationMs: number | null) {
    db.query('INSERT INTO action_runs VALUES (?, ?, ?, ?, ?, ?)').run(id, runId, node, kind, 'done', durationMs);
}

describe('nearestRankPercentile (0938: nearest-rank, no interpolation)', () => {
    test('p50/p90 pick the ⌈p/100 × n⌉-th smallest sample', () => {
        const samples = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
        expect(nearestRankPercentile(samples, 50)).toBe(500); // ceil(5) = 5th
        expect(nearestRankPercentile(samples, 90)).toBe(900); // ceil(9) = 9th
        // Even count: nearest-rank stays a sample member — interpolated median (2.5) is rejected.
        expect(nearestRankPercentile([1, 2, 3, 4], 50)).toBe(2);
    });

    test('null on empty (n/a, never 0), identity on a single sample', () => {
        expect(nearestRankPercentile([], 50)).toBeNull();
        expect(nearestRankPercentile([42], 50)).toBe(42);
        expect(nearestRankPercentile([42], 90)).toBe(42);
    });
});

describe('readStateMetrics (0938 R1)', () => {
    test('per-state rows: visits from transition_runs, retries = visits−1 per run, agent.run count, wall p50/p90', async () => {
        const { dbPath, close } = await seedDb((db) => {
            const run = insRunFull(db);
            // p1 visits 'check' 3× (2 retries) then 'done'; p2 visits each once.
            run.run(
                'p1',
                'pr-review',
                'done',
                '2026-09-01T00:00:00.000Z',
                '2026-09-01T00:30:00.000Z',
                1800000000000,
                'done',
            );
            insTransition(db, 'sc1', 'p1', 'check');
            insTransition(db, 'sc2', 'p1', 'check');
            insTransition(db, 'sc3', 'p1', 'check');
            insTransition(db, 'sd1', 'p1', 'done');
            run.run(
                'p2',
                'pr-review',
                'done',
                '2026-09-01T00:40:00.000Z',
                '2026-09-01T01:00:00.000Z',
                1800000000001,
                'done',
            );
            insTransition(db, 'sc4', 'p2', 'check');
            insTransition(db, 'sd2', 'p2', 'done');
            insAction(db, 'a1', 'p1', 'check', 'agent.run', 100);
            insAction(db, 'a2', 'p1', 'check', 'agent.run', 300);
            insAction(db, 'a3', 'p1', 'done', 'run.artifact', 50);
            insAction(db, 'a4', 'p2', 'check', 'agent.run', 200);
        });
        try {
            const rows = readStateMetrics(dbPath, ['pr-review']);
            expect(rows.map((r) => `${r.workflow}/${r.state}`)).toEqual(['pr-review/check', 'pr-review/done']);
            const check = at(rows, 0);
            expect(check.visits).toBe(4); // 3 in p1 + 1 in p2
            expect(check.retries).toBe(2); // (3−1) + (1−1)
            expect(check.agentRunCount).toBe(3);
            // Per-(run, state) wall samples [400, 200]: p50 rank 1 → 200; p90 rank 2 → 400.
            expect(check.wallMsP50).toBe(200);
            expect(check.wallMsP90).toBe(400);
            const done = at(rows, 1);
            expect(done.visits).toBe(2);
            expect(done.retries).toBe(0);
            expect(done.agentRunCount).toBe(0); // run.artifact only — zero, not null: measured
            expect(done.wallMsP50).toBe(50);
            expect(done.wallMsP90).toBe(50);
        } finally {
            await close();
        }
    });

    test('dry and non-terminal runs never enter state metrics, same population as workflow stats', async () => {
        const { dbPath, close } = await seedDb((db) => {
            const run = insRunFull(db);
            run.run(
                'p1',
                'pr-review',
                'done',
                '2026-09-01T00:00:00.000Z',
                '2026-09-01T00:30:00.000Z',
                1800000000000,
                'done',
            );
            insTransition(db, 'sc1', 'p1', 'check');
            insAction(db, 'a1', 'p1', 'check', 'agent.run', 100);
            // A dry probe and a stale 'running' row visit states too — excluded like 0730 R2.
            db.run(
                "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at, terminal_reason) VALUES ('p3', 'pr-review', 'done', '2026-09-01T02:00:00.000Z', '2026-09-01T02:01:00.000Z', '{\"dryRun\":true}', 1800000000002, 'done')",
            );
            insTransition(db, 'sc9', 'p3', 'check');
            insAction(db, 'a9', 'p3', 'check', 'agent.run', 999);
            run.run(
                'p4',
                'pr-review',
                'running',
                '2026-09-01T03:00:00.000Z',
                '2026-09-01T03:01:00.000Z',
                1800000000003,
                null,
            );
            insTransition(db, 'sc8', 'p4', 'check');
            insAction(db, 'a8', 'p4', 'check', 'agent.run', 888);
        });
        try {
            const rows = readStateMetrics(dbPath, ['pr-review']);
            expect(rows).toHaveLength(1);
            expect(at(rows, 0).visits).toBe(1);
            expect(at(rows, 0).agentRunCount).toBe(1);
            expect(at(rows, 0).wallMsP50).toBe(100); // the 999/888 actions are excluded with their runs
        } finally {
            await close();
        }
    });
});

describe('readWorkflowMetrics 0938 R2 additions', () => {
    test('agentRunCountMedian (zero-inclusive), wall p50/p90, terminalReasonMix from the 0937 column only', async () => {
        const { dbPath, close } = await seedDb((db) => {
            const run = insRunFull(db);
            run.run(
                'm1',
                'task-lifecycle',
                'done',
                '2026-09-02T00:00:00.000Z',
                '2026-09-02T00:01:00.000Z',
                1800003600000,
                'done',
            );
            insAction(db, 'ma1', 'm1', 'review', 'agent.run', 10);
            insAction(db, 'ma2', 'm1', 'review', 'agent.run', 20);
            run.run(
                'm2',
                'task-lifecycle',
                'done',
                '2026-09-02T01:00:00.000Z',
                '2026-09-02T01:00:30.000Z',
                1800003600001,
                null,
            ); // legacy NULL
            run.run(
                'm3',
                'task-lifecycle',
                'done',
                '2026-09-02T02:00:00.000Z',
                '2026-09-02T02:01:30.000Z',
                1800003600002,
                null,
            );
            insAction(db, 'ma3', 'm3', 'review', 'agent.run', 5);
            // Interrupted close: NOT terminal-status, but its 0937 reason surfaces in the mix.
            run.run(
                'i1',
                'task-lifecycle',
                'interrupted',
                '2026-09-02T03:00:00.000Z',
                '2026-09-02T03:00:05.000Z',
                1800003600003,
                'interrupted',
            );
            run.run(
                'f1',
                'task-lifecycle',
                'failed',
                '2026-09-02T04:00:00.000Z',
                '2026-09-02T04:00:10.000Z',
                1800003600004,
                null,
            );
            // A dry close with a reason stays out of the mix (dry exclusion unchanged).
            db.run(
                "INSERT INTO runs (id, workflow_name, status, started_at, completed_at, metadata_json, created_at, terminal_reason) VALUES ('d1', 'task-lifecycle', 'done', '2026-09-02T05:00:00.000Z', '2026-09-02T05:00:01.000Z', '{\"dryRun\":true}', 1800003600005, 'done')",
            );
        });
        try {
            const m = one(readWorkflowMetrics(dbPath, ['task-lifecycle']));
            // Counts [2, 0, 1, 0] over terminal non-dry runs (m1/m2/m3 + f1; i1 is not
            // terminal-status): zero-action runs count as 0, nearest-rank p50 → sorted[1] = 0.
            expect(m.agentRunCountMedian).toBe(0);
            // Walls [60000, 30000, 90000, 10000]: p50 rank 2 → 30000; p90 rank 4 → 90000.
            expect(m.wallMsP50).toBe(30000);
            expect(m.wallMsP90).toBe(90000);
            // Column read, never guessed: legacy NULLs are 'unclassified' even for done/failed.
            expect(m.terminalReasonMix).toEqual({ done: 1, unclassified: 3, interrupted: 1 });
        } finally {
            await close();
        }
    });

    test('a workflow with no runs: 0938 additions stay null and the mix stays empty', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const docs = one(readWorkflowMetrics(dbPath, ['docs-pipeline']));
            expect(docs.agentRunCountMedian).toBeNull();
            expect(docs.wallMsP50).toBeNull();
            expect(docs.wallMsP90).toBeNull();
            expect(docs.terminalReasonMix).toEqual({});
        } finally {
            await close();
        }
    });
});

describe('0938 R4 --since window (epoch ms on runs.created_at)', () => {
    test('filters workflow and state metrics numerically — 999 < 1000 even though "999" > "1000" as text', async () => {
        const { dbPath, close } = await seedDb((db) => {
            const run = insRunFull(db);
            run.run(
                'h1',
                'history-anatomy',
                'done',
                '2026-09-03T00:00:00.000Z',
                '2026-09-03T00:10:00.000Z',
                999,
                'done',
            );
            insTransition(db, 'hy', 'h1', 'y');
            insAction(db, 'ha', 'h1', 'y', 'agent.run', 10);
            run.run(
                'h2',
                'history-anatomy',
                'done',
                '2026-09-03T01:00:00.000Z',
                '2026-09-03T01:10:00.000Z',
                1500,
                'done',
            );
            insTransition(db, 'hx', 'h2', 'x');
            insAction(db, 'hb', 'h2', 'x', 'agent.run', 40);
        });
        try {
            const windowed = readWorkflowMetrics(dbPath, ['history-anatomy'], { sinceMs: 1000 });
            expect(one(windowed).terminalRuns).toBe(1); // h2 only; h1 (999) is out of the window
            const states = readStateMetrics(dbPath, ['history-anatomy'], { sinceMs: 1000 });
            expect(states.map((r) => r.state)).toEqual(['x']);
            expect(at(states, 0).wallMsP50).toBe(40);
            // Without the window both runs fold in, ordered by state.
            expect(readStateMetrics(dbPath, ['history-anatomy']).map((r) => r.state)).toEqual(['x', 'y']);
            expect(one(readWorkflowMetrics(dbPath, ['history-anatomy'])).terminalRuns).toBe(2);
        } finally {
            await close();
        }
    });

    test('the CLI rejects a non-date --since before touching the DB', async () => {
        expect(realRunCost(['--since', 'not-a-date'])).rejects.toThrow(/--since/);
        expect(realRunCost(['--since'])).rejects.toThrow(/--since requires a value/);
        expect(realRunCost(['--bogus'])).rejects.toThrow(/unknown argument/);
    });
});

describe('0938 R4 deterministic serialization', () => {
    test('stableJson sorts keys recursively and stays compact', () => {
        expect(stableJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(
            '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}',
        );
    });

    test('buildReportJson is byte-identical across runs on one DB snapshot', async () => {
        const { dbPath, close } = await seedDb((db) => {
            const run = insRunFull(db);
            run.run(
                'p1',
                'pr-review',
                'done',
                '2026-09-01T00:00:00.000Z',
                '2026-09-01T00:30:00.000Z',
                1800000000000,
                'done',
            );
            insTransition(db, 'sc1', 'p1', 'check');
            insAction(db, 'a1', 'p1', 'check', 'agent.run', 100);
        });
        try {
            const targets = ['pr-review', 'history-anatomy'];
            const first = buildReportJson(dbPath, targets);
            const second = buildReportJson(dbPath, targets);
            expect(first).toBe(second); // determinism: two reads, one byte string
            expect(first).not.toMatch(/generated|timestamp|Date\.now/); // no wall-clock in the body
            const parsed = JSON.parse(first) as { workflows: unknown[]; states: unknown[] };
            expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
            expect(parsed.workflows).toHaveLength(2);
            expect(parsed.states).toHaveLength(1);
        } finally {
            await close();
        }
    });
});

describe('scopedWorkflows (0938 R3 bookkeeping exclusion)', () => {
    test('drops BOOKKEEPING_WORKFLOWS unless --include-bookkeeping; explicit filters obey the same rule', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'scope0938-'));
        try {
            const wfDir = join(dir, 'workflows');
            await mkdir(wfDir);
            for (const name of ['task-lifecycle', 'feature-lifecycle', 'task-pipeline']) {
                await writeFile(join(wfDir, `${name}.yaml`), 'placeholder');
            }
            expect(await scopedWorkflows([], { includeBookkeeping: false, workflowsDir: wfDir })).toEqual([
                'task-pipeline',
            ]);
            expect(await scopedWorkflows([], { includeBookkeeping: true, workflowsDir: wfDir })).toEqual([
                'feature-lifecycle',
                'task-lifecycle',
                'task-pipeline',
            ]);
            expect(
                await scopedWorkflows(['task-lifecycle'], { includeBookkeeping: false, workflowsDir: wfDir }),
            ).toEqual([]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
