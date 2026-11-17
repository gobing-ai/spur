import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type AgentRunMeasurement,
    evaluateCandidate,
    measureAgentRunHistory,
    readAgentRunHistory,
    type WorkflowCandidate,
    type WorkflowCandidateDelta,
} from '../../src/workflow/promotion-evaluation';

/**
 * ADR-076 promotion verdict (A93 1356 R2). The decision rules that must not drift while the
 * implementation moves to the app:
 *
 *   - zero recorded real runs never promotes (unmeasured evidence is refused, not assumed);
 *   - promotion needs STRICTLY fewer `agent.run` actions than the incumbent;
 *   - `delta.baselineAgentRunCount` pins the incumbent, so an already-applied change still compares
 *     against its origin;
 *   - a run with no `agent.run` action has an unmeasured duration (null), never 0;
 *   - the evaluation timestamp is the caller's clock.
 */
function candidate(delta: WorkflowCandidateDelta, over: Partial<WorkflowCandidate> = {}): WorkflowCandidate {
    return {
        id: 'c1',
        canonical: 'task-pipeline',
        deadline: '2026-12-01',
        createdAt: '2026-11-01',
        rationale: 'fixture',
        measurement: { workflow: 'task-pipeline' },
        delta,
        verdict: null,
        ...over,
    };
}

const stat = (runs: number, median: number | null) => ({
    runs,
    mean: median,
    median,
    min: median,
    max: median,
});

function measured(runs: number, median: number | null): AgentRunMeasurement {
    return {
        workflow: 'task-pipeline',
        agentRunCount: stat(runs, median),
        agentRunDurationMs: stat(median === null ? 0 : runs, median === null ? null : 1000),
    };
}

const NOW = '2026-11-16T12:00:00.000Z';

describe('evaluateCandidate — the ADR-076 bar', () => {
    test('a strictly smaller projection promotes and cites the measured evidence', () => {
        const verdict = evaluateCandidate(candidate({ agentRunCount: 2 }), measured(5, 3), 3, NOW);
        expect(verdict.decision).toBe('promote');
        expect(verdict.evaluatedAt).toBe(NOW);
        expect(verdict.candidateAgentRunCount).toBe(2);
        expect(verdict.canonicalAgentRunCount).toBe(3);
        expect(verdict.reason).toContain('5 real run(s)');
    });

    test('an equal projection is rejected: the bar is strictly fewer actions', () => {
        const verdict = evaluateCandidate(candidate({ agentRunCount: 3 }), measured(5, 3), 3, NOW);
        expect(verdict.decision).toBe('delete');
        expect(verdict.reason).toContain('not fewer than');
    });

    test('zero recorded real runs can never promote', () => {
        const verdict = evaluateCandidate(candidate({ agentRunCount: 1 }), measured(0, null), 3, NOW);
        expect(verdict.decision).toBe('delete');
        expect(verdict.reason).toContain('no measured real-run history');
        expect(verdict.reason).toContain('delete');
    });

    test('an explicit baseline pins the incumbent even when the canonical count already moved', () => {
        const pinned = evaluateCandidate(
            candidate({ agentRunCount: 2, baselineAgentRunCount: 5 }),
            measured(4, 4),
            2,
            NOW,
        );
        expect(pinned.decision).toBe('promote');
        expect(pinned.reason).toContain('incumbent baseline of 5');
        expect(pinned.reason).toContain('canonical task-pipeline now declares 2');
    });

    test('without a pinned baseline the live canonical count is the comparator', () => {
        const verdict = evaluateCandidate(candidate({ agentRunCount: 2 }), measured(4, 4), 2, NOW);
        expect(verdict.decision).toBe('delete');
        expect(verdict.reason).toContain('the canonical task-pipeline count of 2');
    });

    test('an unmeasured duration stays null in the verdict (never 0)', () => {
        const verdict = evaluateCandidate(candidate({ agentRunCount: 1 }), measured(3, 2), 3, NOW);
        expect(verdict.agentRunDurationMs.runs).toBe(3);
    });
});

/**
 * History reading/summarizing against a temp DB shaped like the live history plane. Rows are created
 * through raw SQL on the same schema the domain queries read (fixture setup, never live data).
 */
async function seedDb(): Promise<{ dbPath: string; close: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'promotion-evaluation-'));
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.run(
        'CREATE TABLE runs (id TEXT, workflow_name TEXT, status TEXT, started_at TEXT, completed_at TEXT, metadata_json TEXT)',
    );
    db.run('CREATE TABLE action_runs (id TEXT, run_id TEXT, node TEXT, kind TEXT, status TEXT, duration_ms INTEGER)');
    const insRun = db.query("INSERT INTO runs VALUES (?, ?, ?, ?, ?, '{}')");
    insRun.run('r1', 'task-pipeline', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:33:00.000Z');
    insRun.run('r2', 'task-pipeline', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:34:00.000Z');
    db.run(
        "INSERT INTO runs VALUES ('rdry', 'task-pipeline', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z', '{\"dryRun\":true}')",
    );
    insRun.run('rstale', 'task-pipeline', 'running', '2026-08-20T03:00:00.000Z', '2026-08-20T03:00:12.000Z');
    // Terminal run with NO agent.run rows: counts as 0 actions, duration unmeasured.
    insRun.run('r3', 'wrapup-pipeline', 'done', '2026-08-20T04:00:00.000Z', '2026-08-20T04:05:00.000Z');
    const insAction = db.query('INSERT INTO action_runs VALUES (?, ?, ?, ?, ?, ?)');
    for (const [runId, prefix] of [
        ['r1', 'x'],
        ['r2', 'y'],
    ] as const) {
        insAction.run(`${prefix}-a1`, runId, 'precheck', 'shell', 'done', 10);
        insAction.run(`${prefix}-a2`, runId, 'implement', 'agent.run', 'done', 100);
        insAction.run(`${prefix}-a3`, runId, 'resolve-scope', 'agent.run', 'done', 100);
        insAction.run(`${prefix}-a4`, runId, 'test', 'agent.run', 'done', 200);
        insAction.run(`${prefix}-a5`, runId, 'verify', 'agent.run', 'done', 200);
    }
    db.close();
    return { dbPath, close: () => rm(dir, { recursive: true, force: true }) };
}

describe('readAgentRunHistory and measureAgentRunHistory', () => {
    test('a dry run, a non-terminal row and another workflow are all excluded', async () => {
        const fixture = await seedDb();
        try {
            const rows = await readAgentRunHistory(fixture.dbPath, 'task-pipeline');
            expect(rows.map((row) => row.runId).sort()).toEqual(['r1', 'r2']);
            expect(rows.every((row) => row.count === 4)).toBe(true);
            expect(rows.map((row) => row.durationMs)).toEqual([600, 600]);
        } finally {
            await fixture.close();
        }
    });

    test('runIds narrows the replay to the recorded runs the caller names', async () => {
        const fixture = await seedDb();
        try {
            const rows = await readAgentRunHistory(fixture.dbPath, 'task-pipeline', ['r2']);
            expect(rows.map((row) => row.runId)).toEqual(['r2']);
        } finally {
            await fixture.close();
        }
    });

    test('a terminal run with no agent.run rows counts 0 actions with an unmeasured duration', async () => {
        const fixture = await seedDb();
        try {
            const measurement = await measureAgentRunHistory(fixture.dbPath, 'wrapup-pipeline');
            expect(measurement.agentRunCount.runs).toBe(1);
            expect(measurement.agentRunCount.median).toBe(0);
            // Duration folds only runs that recorded an agent.run action, so it stays null, never 0.
            expect(measurement.agentRunDurationMs.runs).toBe(0);
            expect(measurement.agentRunDurationMs.median).toBeNull();
        } finally {
            await fixture.close();
        }
    });

    test('the summary carries median/min/max over the measured runs', async () => {
        const fixture = await seedDb();
        try {
            const measurement = await measureAgentRunHistory(fixture.dbPath, 'task-pipeline');
            expect(measurement.agentRunCount).toEqual({ runs: 2, mean: 4, median: 4, min: 4, max: 4 });
            expect(measurement.agentRunDurationMs).toEqual({ runs: 2, mean: 600, median: 600, min: 600, max: 600 });
        } finally {
            await fixture.close();
        }
    });

    test('an empty history is zero runs, not an error', async () => {
        const fixture = await seedDb();
        try {
            const measurement = await measureAgentRunHistory(fixture.dbPath, 'no-such-workflow');
            expect(measurement.agentRunCount).toEqual({ runs: 0, mean: null, median: null, min: null, max: null });
        } finally {
            await fixture.close();
        }
    });
});
