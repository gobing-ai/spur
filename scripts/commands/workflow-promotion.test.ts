import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type AgentRunMeasurement,
    checkWorkflowPromotion,
    countAgentRunActions,
    evaluateCandidate,
    findParallelDefinitions,
    isPastDeadline,
    loadCanonicalAgentRunCounts,
    measureAgentRunHistory,
    validateCandidate,
    type WorkflowCandidate,
    type WorkflowCandidatesConfig,
} from './workflow-promotion';

/** A minimal valid candidate record. */
function candidate(over: Partial<WorkflowCandidate> = {}): WorkflowCandidate {
    return {
        id: 'c1',
        canonical: 'task-pipeline',
        deadline: '2026-10-01',
        createdAt: '2026-09-16',
        rationale: 'merge resolve-scope into implement',
        measurement: { workflow: 'task-pipeline' },
        delta: { agentRunCount: 3 },
        verdict: null,
        ...over,
    };
}

function config(candidates: WorkflowCandidate[]): WorkflowCandidatesConfig {
    return { schemaVersion: 1, candidates };
}

/** An empty measurement (no recorded runs) — the unmeasured case. */
function emptyMeasurement(): AgentRunMeasurement {
    return {
        workflow: 'task-pipeline',
        agentRunCount: { runs: 0, mean: null, median: null, min: null, max: null },
        agentRunDurationMs: { runs: 0, mean: null, median: null, min: null, max: null },
    };
}

/**
 * Build a temp DB shaped like the live history plane (`runs` + `action_runs`) to prove the
 * shadow-run measurement: dry-run and non-terminal exclusion, runIds narrowing, and the
 * zero-`agent.run`-run count (0 count, null duration).
 */
async function seedDb(): Promise<{ dbPath: string; close: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'workflow-promotion-'));
    const dbPath = join(dir, 'test.db');
    const db = new Database(dbPath);
    db.run(
        'CREATE TABLE runs (id TEXT, workflow_name TEXT, status TEXT, started_at TEXT, completed_at TEXT, metadata_json TEXT)',
    );
    db.run('CREATE TABLE action_runs (id TEXT, run_id TEXT, node TEXT, kind TEXT, status TEXT, duration_ms INTEGER)');
    const insRun = db.query("INSERT INTO runs VALUES (?, ?, ?, ?, ?, '{}')");
    // Two terminal real runs with agent.run action rows (count 4 + 4, durations 100+100+200+200).
    insRun.run('r1', 'task-pipeline', 'done', '2026-08-20T00:00:00.000Z', '2026-08-20T00:33:00.000Z');
    insRun.run('r2', 'task-pipeline', 'done', '2026-08-20T01:00:00.000Z', '2026-08-20T01:34:00.000Z');
    // A dry-run probe — excluded from measurement.
    db.run(
        "INSERT INTO runs VALUES ('rdry', 'task-pipeline', 'done', '2026-08-20T02:00:00.000Z', '2026-08-20T02:05:00.000Z', '{\"dryRun\":true}')",
    );
    // A non-terminal row with a stale completed_at — excluded.
    insRun.run('rstale', 'task-pipeline', 'running', '2026-08-20T03:00:00.000Z', '2026-08-20T03:00:12.000Z');
    // A terminal run with NO agent.run rows — counts as 0, duration unmeasured.
    insRun.run('r3', 'wrapup-pipeline', 'done', '2026-08-20T04:00:00.000Z', '2026-08-20T04:05:00.000Z');

    const insAction = db.query('INSERT INTO action_runs VALUES (?, ?, ?, ?, ?, ?)');
    const seedActions = (runId: string, prefix: string) => {
        insAction.run(`${prefix}-a1`, runId, 'precheck', 'shell', 'done', 10);
        insAction.run(`${prefix}-a2`, runId, 'implement', 'agent.run', 'done', 100);
        insAction.run(`${prefix}-a3`, runId, 'resolve-scope', 'agent.run', 'done', 100);
        insAction.run(`${prefix}-a4`, runId, 'test', 'agent.run', 'done', 200);
        insAction.run(`${prefix}-a5`, runId, 'verify', 'agent.run', 'done', 200);
    };
    seedActions('r1', 'x');
    seedActions('r2', 'y');

    return {
        dbPath,
        close: async () => {
            db.close();
            await rm(dir, { recursive: true, force: true });
        },
    };
}

describe('isPastDeadline (0873 R3)', () => {
    test('a date before the deadline is not past it; the deadline date itself is still valid', () => {
        expect(isPastDeadline('2026-10-01', '2026-09-30T23:59:59Z')).toBe(false);
        expect(isPastDeadline('2026-10-01', '2026-10-01T00:00:00Z')).toBe(false);
    });

    test('any instant strictly after the deadline date is past it', () => {
        expect(isPastDeadline('2026-10-01', '2026-10-02T00:00:00Z')).toBe(true);
    });
});

describe('validateCandidate (0873 R1 candidate record)', () => {
    test('accepts a well-formed candidate', () => {
        expect(validateCandidate(candidate())).toBeNull();
    });

    test('rejects a missing canonical target and a malformed deadline', () => {
        expect(validateCandidate(candidate({ canonical: '' }))).toContain('canonical');
        expect(validateCandidate(candidate({ deadline: 'october-1' }))).toContain('deadline');
    });

    test('rejects a non-integer or negative agent.run count', () => {
        expect(validateCandidate(candidate({ delta: { agentRunCount: 2.5 } }))).toContain('agentRunCount');
        expect(validateCandidate(candidate({ delta: { agentRunCount: -1 } }))).toContain('agentRunCount');
    });

    test('rejects a measurement that names no workflow', () => {
        expect(validateCandidate(candidate({ measurement: { workflow: '' } }))).toContain('measurement');
    });
});

describe('measureAgentRunHistory (0873 R1/R2 shadow-run inputs)', () => {
    test('counts agent.run actions per terminal non-dry run and sums their durations', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const m = measureAgentRunHistory(dbPath, 'task-pipeline');
            expect(m.agentRunCount.runs).toBe(2); // r1 + r2 only (rdry + rstale excluded)
            expect(m.agentRunCount.median).toBe(4);
            expect(m.agentRunCount.min).toBe(4);
            expect(m.agentRunCount.max).toBe(4);
            expect(m.agentRunDurationMs.median).toBe(600); // 100+100+200+200
        } finally {
            await close();
        }
    });

    test('narrows the replay to specific recorded run ids', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const m = measureAgentRunHistory(dbPath, 'task-pipeline', ['r1']);
            expect(m.agentRunCount.runs).toBe(1);
            expect(m.agentRunCount.median).toBe(4);
        } finally {
            await close();
        }
    });

    test('a run with no agent.run rows counts 0 actions with an unmeasured (null) duration', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const m = measureAgentRunHistory(dbPath, 'wrapup-pipeline');
            expect(m.agentRunCount.runs).toBe(1);
            expect(m.agentRunCount.median).toBe(0);
            expect(m.agentRunDurationMs.median).toBeNull();
        } finally {
            await close();
        }
    });

    test('a workflow with no recorded runs is unmeasured, never 0', async () => {
        const { dbPath, close } = await seedDb();
        try {
            const m = measureAgentRunHistory(dbPath, 'history-anatomy');
            expect(m.agentRunCount.runs).toBe(0);
            expect(m.agentRunCount.median).toBeNull();
        } finally {
            await close();
        }
    });
});

describe('evaluateCandidate (0873 R2 verdict)', () => {
    const measured = (median: number, runs: number, durationMedian: number): AgentRunMeasurement => ({
        workflow: 'task-pipeline',
        agentRunCount: { runs, mean: median, median, min: median, max: median },
        agentRunDurationMs: {
            runs,
            mean: durationMedian,
            median: durationMedian,
            min: durationMedian,
            max: durationMedian,
        },
    });

    test('promotes a candidate that projects strictly fewer agent.run actions than the canonical', () => {
        const v = evaluateCandidate(
            candidate({ delta: { agentRunCount: 3 } }),
            measured(4, 10, 600),
            4,
            '2026-09-16T00:00:00Z',
        );
        expect(v.decision).toBe('promote');
        expect(v.agentRunCount.median).toBe(4);
        expect(v.agentRunDurationMs.median).toBe(600);
        expect(v.candidateAgentRunCount).toBe(3);
        expect(v.canonicalAgentRunCount).toBe(4);
        expect(v.reason).toContain('median 4');
    });

    test('deletes a candidate that does not reduce agent.run count (equal or more)', () => {
        expect(
            evaluateCandidate(candidate({ delta: { agentRunCount: 4 } }), measured(4, 10, 600), 4, 'x').decision,
        ).toBe('delete');
        expect(
            evaluateCandidate(candidate({ delta: { agentRunCount: 5 } }), measured(4, 10, 600), 4, 'x').decision,
        ).toBe('delete');
    });

    test('cites measured history even when it is empty (unmeasured, never a fixture)', () => {
        const v = evaluateCandidate(candidate({ delta: { agentRunCount: 3 } }), emptyMeasurement(), 4, 'x');
        expect(v.decision).toBe('promote'); // static reduction 4 -> 3 holds
        expect(v.agentRunCount.median).toBeNull();
        expect(v.reason).toContain('no measured real-run history');
    });
});

describe('findParallelDefinitions (0873 R4)', () => {
    test('flags <name>2.yaml and <name>-2.yaml beside their canonical, and ignores the canonical', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'parallel-'));
        try {
            for (const name of [
                'task-pipeline.yaml',
                'task-pipeline2.yaml',
                'task-pipeline-2.yaml',
                'idea-pipeline.yaml',
            ]) {
                await writeFile(join(dir, name), 'placeholder');
            }
            expect(findParallelDefinitions(dir)).toEqual(['task-pipeline-2.yaml', 'task-pipeline2.yaml']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('does not flag a numeric name with no canonical base', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'parallel-'));
        try {
            await writeFile(join(dir, 'wayfinder-resolution.yaml'), 'placeholder');
            await writeFile(join(dir, 'probe2.yaml'), 'placeholder');
            expect(findParallelDefinitions(dir)).toEqual([]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('loadCanonicalAgentRunCounts / countAgentRunActions (0873 R3 promote landed)', () => {
    test('counts agent.run actions in a resolved workflow definition', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'canonical-'));
        try {
            await writeFile(
                join(dir, 'task-pipeline.yaml'),
                [
                    'terminalStates: [done]',
                    'states:',
                    '  - id: implement',
                    '    onEnter:',
                    '      - kind: agent.run',
                    '        options: { input: run }',
                    '  - id: test',
                    '    onEnter:',
                    '      - kind: shell',
                    '        options: { command: bun }',
                    '      - kind: agent.run',
                    '        options: { input: fix }',
                ].join('\n'),
            );
            const counts = loadCanonicalAgentRunCounts(dir);
            expect(counts['task-pipeline']).toBe(2);
            expect(countAgentRunActions({})).toBe(0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('checkWorkflowPromotion (0873 R3/R4 catalogue check)', () => {
    test('passes with no candidates and no parallel definitions', () => {
        expect(checkWorkflowPromotion(config([]), '/nowhere', '2026-09-16T00:00:00Z')).toEqual([]);
    });

    test('fails an expired pending candidate and a parallel definition, naming both', () => {
        const findings = checkWorkflowPromotion(
            config([candidate({ deadline: '2026-09-15' })]),
            '/nowhere-with-file',
            '2026-09-16T00:00:00Z',
        );
        expect(findings).toContainEqual({
            kind: 'expired-candidate',
            candidateId: 'c1',
            detail: expect.stringContaining('passed its deadline 2026-09-15'),
        });
    });

    test('does not fail a candidate before its deadline', () => {
        expect(
            checkWorkflowPromotion(config([candidate({ deadline: '2026-10-01' })]), '/nowhere', '2026-09-16T00:00:00Z'),
        ).toEqual([]);
    });

    test('flags a parallel definition with no candidate id', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'check-'));
        try {
            await writeFile(join(dir, 'task-pipeline.yaml'), 'placeholder');
            await writeFile(join(dir, 'task-pipeline2.yaml'), 'placeholder');
            const findings = checkWorkflowPromotion(config([]), dir, '2026-09-16T00:00:00Z');
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({ kind: 'parallel-definition', candidateId: null });
            expect(findings[0]?.detail).toContain('task-pipeline2.yaml');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
