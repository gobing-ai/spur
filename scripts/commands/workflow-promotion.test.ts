import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type AgentRunMeasurement,
    checkRetirementGuard,
    checkWorkflowPromotion,
    countAgentRunActions,
    evaluateCandidate,
    findParallelDefinitions,
    isPastDeadline,
    loadCanonicalAgentRunCounts,
    measureAgentRunHistory,
    runWorkflowPromotion,
    validateCandidate,
    type WorkflowCandidate,
    type WorkflowCandidatesConfig,
    type WorkflowCandidateVerdict,
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
            // 0878 R6: the duration fold's .runs counts the durations actually folded (0), not the row count (1).
            expect(m.agentRunDurationMs.runs).toBe(0);
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

    test('cannot promote a candidate with zero measured real runs (0878 R6 ADR-076 gate)', () => {
        const v = evaluateCandidate(candidate({ delta: { agentRunCount: 3 } }), emptyMeasurement(), 4, 'x');
        expect(v.decision).toBe('delete'); // static reduction 4 -> 3 holds, but the gate refuses unmeasured
        expect(v.agentRunCount.median).toBeNull();
        expect(v.reason).toContain('no measured real-run history');
    });
});

describe('evaluateCandidate (0921 declared-count baseline)', () => {
    const measured: AgentRunMeasurement = {
        workflow: 'task-pipeline',
        agentRunCount: { runs: 11, mean: 3, median: 3, min: 1, max: 4 },
        agentRunDurationMs: { runs: 11, mean: 500000, median: 400000, min: 10000, max: 900000 },
    };

    test('promotes an already-applied candidate: projection 3 < baseline 4 while the live canonical also declares 3', () => {
        const c = candidate({ delta: { agentRunCount: 3, baselineAgentRunCount: 4 } });
        const v = evaluateCandidate(c, measured, 3, '2026-09-24T00:00:00.000Z');
        expect(v.decision).toBe('promote');
        expect(v.candidateAgentRunCount).toBe(3);
        expect(v.canonicalAgentRunCount).toBe(3);
        expect(v.reason).toContain('incumbent baseline of 4');
        expect(v.reason).toContain('now declares 3');
    });

    test('keeps the pre-0921 rule without a baseline: projection vs the live canonical count', () => {
        const v = evaluateCandidate(candidate({ delta: { agentRunCount: 2 } }), measured, 3, 'x');
        expect(v.decision).toBe('promote');
        expect(v.reason).toContain('canonical task-pipeline count of 3');
    });

    test('deletes when the projection does not beat the incumbent baseline (no model-hop reduction)', () => {
        const v = evaluateCandidate(
            candidate({ delta: { agentRunCount: 3, baselineAgentRunCount: 3 } }),
            measured,
            3,
            'x',
        );
        expect(v.decision).toBe('delete');
        expect(v.reason).toContain('not fewer than');
    });
});

describe('resolve CLI (0878 R6)', () => {
    // `runWorkflowPromotion` writes refusals/results to stdout/stderr; capture both so the dots
    // reporter output stays clean (same pattern as eval-pipeline.test.ts nesting guard).
    let logSpy: ReturnType<typeof spyOn>;
    let errSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
        logSpy = spyOn(console, 'log').mockImplementation(() => {});
        errSpy = spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        errSpy.mockRestore();
    });

    const verdict = (decision: 'promote' | 'delete'): WorkflowCandidateVerdict => ({
        decision,
        evaluatedAt: '2026-09-16T00:00:00Z',
        agentRunCount: { runs: 2, mean: 4, median: 4, min: 4, max: 4 },
        agentRunDurationMs: { runs: 2, mean: 600, median: 600, min: 600, max: 600 },
        candidateAgentRunCount: 3,
        canonicalAgentRunCount: 4,
        reason: 'test',
    });

    async function candidatesFile(cands: WorkflowCandidate[]): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), 'resolve-'));
        const p = join(dir, 'candidates.json');
        await writeFile(p, JSON.stringify(config(cands)));
        return p;
    }

    test('refuses a decision that contradicts the evaluated verdict and keeps the candidate', async () => {
        const p = await candidatesFile([candidate({ verdict: verdict('promote') })]);
        const code = await runWorkflowPromotion(['resolve', 'c1', '--decision', 'delete', '--config', p]);
        expect(code).toBe(1);
        expect(JSON.parse(await readFile(p, 'utf8')).candidates).toHaveLength(1);
    });

    test('refuses --decision promote when the canonical count mismatches (0873 refusal branch)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'canonical-resolve-'));
        const p = await candidatesFile([candidate({ verdict: verdict('promote'), delta: { agentRunCount: 3 } })]);
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
                ].join('\n'),
            );
            const code = await runWorkflowPromotion([
                'resolve',
                'c1',
                '--decision',
                'promote',
                '--config',
                p,
                '--workflows-dir',
                dir,
            ]);
            expect(code).toBe(1);
            expect(JSON.parse(await readFile(p, 'utf8')).candidates).toHaveLength(1);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('evaluate refuses when the live canonical count matches neither baseline nor projection (0921 drift)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'canonical-drift-'));
        const p = await candidatesFile([candidate({ delta: { agentRunCount: 3, baselineAgentRunCount: 4 } })]);
        const seeded = await seedDb();
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
                ].join('\n'),
            );
            const code = await runWorkflowPromotion([
                'evaluate',
                'c1',
                '--config',
                p,
                '--workflows-dir',
                dir,
                '--db',
                seeded.dbPath,
            ]);
            expect(code).toBe(1);
            expect(JSON.parse(await readFile(p, 'utf8')).candidates[0].verdict).toBeNull();
        } finally {
            await rm(dir, { recursive: true, force: true });
            await seeded.close();
        }
    });

    test('resolve --decision promote passes with a baseline when the canonical declares the projection (0921)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'canonical-resolve-'));
        const p = await candidatesFile([
            candidate({ verdict: verdict('promote'), delta: { agentRunCount: 3, baselineAgentRunCount: 4 } }),
        ]);
        try {
            await writeFile(
                join(dir, 'task-pipeline.yaml'),
                [
                    'terminalStates: [done]',
                    'states:',
                    '  - id: enrich',
                    '    onEnter:',
                    '      - kind: agent.run',
                    '        options: { input: enrich }',
                    '  - id: validate',
                    '    onEnter:',
                    '      - kind: agent.run',
                    '        options: { input: validate }',
                    '  - id: correct',
                    '    onEnter:',
                    '      - kind: agent.run',
                    '        options: { input: correct }',
                ].join('\n'),
            );
            const code = await runWorkflowPromotion([
                'resolve',
                'c1',
                '--decision',
                'promote',
                '--config',
                p,
                '--workflows-dir',
                dir,
            ]);
            expect(code).toBe(0);
            expect(JSON.parse(await readFile(p, 'utf8')).candidates).toHaveLength(0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('resolves a delete consistent with the verdict and removes the candidate', async () => {
        const p = await candidatesFile([candidate({ verdict: verdict('delete') })]);
        const code = await runWorkflowPromotion(['resolve', 'c1', '--decision', 'delete', '--config', p]);
        expect(code).toBe(0);
        expect(JSON.parse(await readFile(p, 'utf8')).candidates).toHaveLength(0);
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

describe('checkRetirementGuard (0882 R8, 0866 review finding 6)', () => {
    /** Mixed-history seed: `with-real` has one non-dry + one dry terminal run; `dry-only` has two dry runs. */
    async function seedRetirementDb(): Promise<{ db: Database; close: () => Promise<void> }> {
        const dir = await mkdtemp(join(tmpdir(), 'retirement-guard-'));
        const db = new Database(join(dir, 'test.db'));
        db.run('CREATE TABLE runs (id TEXT, workflow_name TEXT, status TEXT, metadata_json TEXT)');
        const ins = db.query('INSERT INTO runs VALUES (?, ?, ?, ?)');
        ins.run('wr1', 'with-real', 'done', '{}');
        ins.run('wr2', 'with-real', 'done', '{"dryRun":true}');
        ins.run('do1', 'dry-only', 'done', '{"dryRun":1}');
        ins.run('do2', 'dry-only', 'done', '{"dryRun":true}');
        ins.run('wp1', 'still-present', 'done', '{}');
        return {
            db,
            close: async () => {
                db.close();
                await rm(dir, { recursive: true, force: true });
            },
        };
    }

    async function seedWorkflowsDir(names: string[]): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), 'retirement-workflows-'));
        for (const n of names) {
            await writeFile(join(dir, `${n}.yaml`), 'kind: state-machine\n');
        }
        return dir;
    }

    test('refuses retiring a definition with real non-dry terminal runs absent a recorded decision', async () => {
        const { db, close } = await seedRetirementDb();
        const dir = await seedWorkflowsDir(['still-present']);
        try {
            const findings = checkRetirementGuard(db, config([]), dir, new Set(['with-real', 'still-present']));
            expect(findings).toHaveLength(1);
            expect(findings[0]?.kind).toBe('unrecorded-retirement');
            expect(findings[0]?.detail).toContain('with-real');
            expect(findings[0]?.detail).toContain('1 real (non-dry)');
        } finally {
            await close();
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('a recorded decision and dry-only history pass; present definitions are untouched', async () => {
        const { db, close } = await seedRetirementDb();
        const dir = await seedWorkflowsDir(['still-present']);
        try {
            const withRecord = checkRetirementGuard(
                db,
                {
                    schemaVersion: 1,
                    candidates: [],
                    retirements: [
                        { name: 'with-real', recordedBy: '0882', date: '2026-09-17', rationale: 'recorded decision' },
                    ],
                },
                dir,
                new Set(['with-real', 'still-present']),
            );
            expect(withRecord).toHaveLength(0); // recorded decision + dry-only + still-present all pass
            const neverTracked = checkRetirementGuard(db, config([]), dir, new Set(['still-present']));
            expect(neverTracked).toHaveLength(0); // ad-hoc run names without a standing definition are out of scope
        } finally {
            await close();
            await rm(dir, { recursive: true, force: true });
        }
    });
});
