/**
 * Step-profile pure aggregation core (task 0827, feature I21) — ported to packages/app (1005 R1).
 *
 * Builder-level cases (aggregation, idle gaps, session mode, cache coverage, flags, dry-run
 * sampling) run against packages/app/src/workflow/step-profile.ts. Script-level argv/exit and
 * bare-node twin pins stay in plugins/sp/tests/workflow-step-profile.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import {
    type ActionCostAttributionLike,
    buildStepProfile,
    formatStepProfileHuman,
    nonDryRuns,
    type StepProfileRow,
    type StepProfileRun,
    type TraceActionEvent,
} from '../../src/workflow/step-profile';

const T0 = Date.parse('2026-09-11T10:00:00.000Z');

function at(sec: number): string {
    return new Date(T0 + sec * 1000).toISOString();
}

interface ActionSpec {
    node: string;
    actionKind: string;
    startSec: number;
    endSec: number;
    invocation?: Record<string, string | number | boolean> | null;
    /** `undefined` = the executor computed no cost attribution at all (live `cost` absent). */
    cost?: ActionCostAttributionLike | null;
}

function actionEvent(spec: ActionSpec): TraceActionEvent {
    return {
        kind: 'action',
        node: spec.node,
        actionKind: spec.actionKind,
        durationMs: (spec.endSec - spec.startSec) * 1000,
        startedAt: at(spec.startSec),
        completedAt: at(spec.endSec),
        invocation: spec.invocation ?? null,
        cost: spec.cost === undefined ? null : spec.cost,
    };
}

/** A run carries non-action events too; only `kind: 'action'` is evidence. */
const PHASE_EVENT: TraceActionEvent = { kind: 'phase' };

function run(runId: string, actions: ActionSpec[]): StepProfileRun {
    return { runId, events: [PHASE_EVENT, ...actions.map(actionEvent)] };
}

function cost(cacheHit: number | null, estimatedHit?: number): ActionCostAttributionLike {
    return {
        exact: cacheHit === null ? null : { cacheHit },
        estimated: estimatedHit === undefined ? null : { cacheHit: estimatedHit },
    };
}

function rowFor(rows: StepProfileRow[], node: string, actionKind: string): StepProfileRow {
    const row = rows.find((r) => r.node === node && r.actionKind === actionKind);
    if (row === undefined) throw new Error(`no row for ${node}/${actionKind}`);
    return row;
}

// ── fixtures: three runs, one node executed twice in run A ──────────────────────────────

const AGENT_FRESH: ActionSpec = {
    node: 'implement',
    actionKind: 'agent.run',
    startSec: 0,
    endSec: 20,
    invocation: { continue: false, skill: 'sp:super-coder' },
    cost: cost(0.8),
};
const AGENT_RESUMED: ActionSpec = {
    node: 'implement',
    actionKind: 'agent.run',
    startSec: 30,
    endSec: 34,
    invocation: { continue: true },
    // `estimated` is retroactive evidence and must never mix into the reported cacheHit.
    cost: cost(0.4, 0.0),
};

const RUNS: StepProfileRun[] = [
    run('run-a', [AGENT_FRESH, { node: 'test', actionKind: 'shell', startSec: 25, endSec: 28 }, AGENT_RESUMED]),
    run('run-b', [
        {
            node: 'implement',
            actionKind: 'agent.run',
            startSec: 0,
            endSec: 30,
            invocation: { continue: true },
            cost: cost(0.2),
        },
        { node: 'test', actionKind: 'shell', startSec: 30, endSec: 31 },
    ]),
    // Old event: no `invocation` recorded at all → session unknown, never "fresh".
    run('run-c', [
        {
            node: 'implement',
            actionKind: 'agent.run',
            startSec: 0,
            endSec: 1,
            invocation: null,
            cost: cost(null),
        },
    ]),
];

const PROFILE = buildStepProfile({ workflow: 'idea-pipeline', windowSec: 300, runs: RUNS });

describe('task 0827 R1 — aggregation is per node and action kind', () => {
    test('counts distinct runs and executions, including a node executed twice in one run', () => {
        const agentRow = rowFor(PROFILE.rows, 'implement', 'agent.run');
        expect(agentRow.runs).toBe(3);
        expect(agentRow.executions).toBe(4);
        const shellRow = rowFor(PROFILE.rows, 'test', 'shell');
        expect(shellRow.runs).toBe(2);
        expect(shellRow.executions).toBe(2);
    });

    test('p50 is the nearest-rank median of observed values, and max the largest', () => {
        const agentRow = rowFor(PROFILE.rows, 'implement', 'agent.run');
        // 1000, 4000, 20000, 30000 → nearest rank ceil(4/2)-1 = index 1.
        expect(agentRow.durationMs.p50).toBe(4000);
        expect(agentRow.durationMs.max).toBe(30000);
        const shellRow = rowFor(PROFILE.rows, 'test', 'shell');
        // 1000, 3000 → ceil(2/2)-1 = index 0.
        expect(shellRow.durationMs.p50).toBe(1000);
        expect(shellRow.durationMs.max).toBe(3000);
    });

    test('rows are sorted by node, then action kind, and the header carries the sampling window', () => {
        expect(PROFILE.workflow).toBe('idea-pipeline');
        expect(PROFILE.windowSec).toBe(300);
        expect(PROFILE.sampledRuns).toBe(3);
        expect(PROFILE.rows.map((r) => `${r.node}/${r.actionKind}`)).toEqual(['implement/agent.run', 'test/shell']);
    });

    test('no sampled runs still yields an empty profile, never fabricated rows', () => {
        const empty = buildStepProfile({ workflow: 'idea-pipeline', windowSec: 300, runs: [] });
        expect(empty.sampledRuns).toBe(0);
        expect(empty.rows).toEqual([]);
    });
});

describe('task 0827 R1 — idle gap comes from the previous action, and unknown stays null', () => {
    test('the gap is startedAt minus the previous action completedAt in the same run', () => {
        // run-a second agent.run starts at +30s; the shell step before it completed at +28s.
        const agentRow = rowFor(PROFILE.rows, 'implement', 'agent.run');
        expect(agentRow.idleGapMs.p50).toBe(2000);
    });

    test('a first action has no previous action: unknown, not zero', () => {
        const shellRow = rowFor(PROFILE.rows, 'test', 'shell');
        // run-a shell gaps 5000ms (previous completedAt +20s), run-b shell gaps 0ms.
        expect(shellRow.idleGapMs.p50).toBe(0);
        const single = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [run('only', [{ node: 'first', actionKind: 'shell', startSec: 0, endSec: 5 }])],
        });
        expect(rowFor(single.rows, 'first', 'shell').idleGapMs.p50).toBeNull();
    });

    test('the trace emits row-creation order, so the gap uses the startedAt order', () => {
        const shuffled = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [
                {
                    runId: 'r1',
                    events: [
                        {
                            kind: 'action',
                            node: 'n',
                            actionKind: 'shell',
                            durationMs: 1000,
                            startedAt: at(10),
                            completedAt: at(11),
                        },
                        {
                            kind: 'action',
                            node: 'n',
                            actionKind: 'shell',
                            durationMs: 1000,
                            startedAt: at(0),
                            completedAt: at(1),
                        },
                    ],
                },
            ],
        });
        // Ordered 0→1 then 10→11: the only gap is 9000ms, and the first action keeps none.
        expect(rowFor(shuffled.rows, 'n', 'shell').idleGapMs.p50).toBe(9000);
    });

    test('a gap is measured per run: the first action of every run is unknown', () => {
        const gaps = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [
                run('r1', [{ node: 'n', actionKind: 'shell', startSec: 0, endSec: 1 }]),
                run('r2', [{ node: 'n', actionKind: 'shell', startSec: 0, endSec: 1 }]),
                run('r3', [
                    { node: 'n', actionKind: 'shell', startSec: 0, endSec: 1 },
                    { node: 'n', actionKind: 'shell', startSec: 4, endSec: 5 },
                ]),
            ],
        });
        // Only r3's second execution has a previous action: 3000ms.
        expect(rowFor(gaps.rows, 'n', 'shell').idleGapMs.p50).toBe(3000);
    });
});

describe('task 0827 R1 — session mode comes from invocation.continue', () => {
    test('fresh, resumed and mixed are folded over the known executions', () => {
        expect(rowFor(PROFILE.rows, 'implement', 'agent.run').session).toBe('mixed');
        const allResumed = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [
                run('r1', [
                    { node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 1, invocation: { continue: true } },
                ]),
                run('r2', [
                    { node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 1, invocation: { continue: true } },
                ]),
            ],
        });
        expect(rowFor(allResumed.rows, 'n', 'agent.run').session).toBe('resumed');
        const allFresh = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [
                run('r1', [
                    { node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 1, invocation: { continue: false } },
                ]),
            ],
        });
        expect(rowFor(allFresh.rows, 'n', 'agent.run').session).toBe('fresh');
    });

    test('an unknown invocation is neither fresh nor resumed', () => {
        const unknown = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [
                run('r1', [{ node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 1, invocation: null }]),
                run('r2', [
                    { node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 1, invocation: { continue: true } },
                ]),
            ],
        });
        expect(rowFor(unknown.rows, 'n', 'agent.run').session).toBe('resumed');
    });

    test('session is null for a non-agent.run kind', () => {
        expect(rowFor(PROFILE.rows, 'test', 'shell').session).toBeNull();
    });
});

describe('task 0827 R1 — cache evidence carries its coverage', () => {
    test('exact cacheHit p50 is reported with how many executions carried one', () => {
        const agentRow = rowFor(PROFILE.rows, 'implement', 'agent.run');
        // 0.8, 0.4, 0.2 known of 4 executions → nearest rank index 1.
        expect(agentRow.cacheHit).toEqual({ p50: 0.4, known: 3, of: 4 });
    });

    test('cost.exact null is unknown, never a zero hit rate', () => {
        const unknown = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [run('r1', [{ node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 1, cost: cost(null) }])],
        });
        expect(rowFor(unknown.rows, 'n', 'agent.run').cacheHit).toEqual({ p50: null, known: 0, of: 1 });
    });

    test('cost.estimated never contributes a cacheHit', () => {
        const estimatedOnly = buildStepProfile({
            workflow: 'w',
            windowSec: 300,
            runs: [
                run('r1', [
                    {
                        node: 'n',
                        actionKind: 'agent.run',
                        startSec: 0,
                        endSec: 1,
                        cost: { exact: null, estimated: { cacheHit: 0.99 } },
                    },
                ]),
            ],
        });
        expect(rowFor(estimatedOnly.rows, 'n', 'agent.run').cacheHit).toEqual({ p50: null, known: 0, of: 1 });
    });

    test('a shell step with no cost attribution reports no cache evidence', () => {
        expect(rowFor(PROFILE.rows, 'test', 'shell').cacheHit).toEqual({ p50: null, known: 0, of: 2 });
    });
});

// ── flags: W is in seconds, durations compare as ms > W * 1000 ─────────────────────────

function flagsFor(specs: ActionSpec[], windowSec = 300): string[] {
    const profile = buildStepProfile({
        workflow: 'w',
        windowSec,
        runs: [run('r1', specs)],
    });
    // The action under test is the last one in the run (the earlier ones exist to set its gap).
    const target = specs[specs.length - 1];
    if (target === undefined) throw new Error('flagsFor needs at least one action');
    return rowFor(profile.rows, target.node, target.actionKind).flags;
}

describe('task 0827 R1 — the four cache-window flags fire above their threshold, never at it', () => {
    test('step-over-window: a deterministic step p50 above W', () => {
        expect(flagsFor([{ node: 'n', actionKind: 'shell', startSec: 0, endSec: 300 }])).toEqual([]);
        expect(flagsFor([{ node: 'n', actionKind: 'shell', startSec: 0, endSec: 300.001 }])).toEqual([
            'step-over-window',
        ]);
    });

    test('resume-after-idle: a resumed agent.run whose idle gap p50 is above W', () => {
        const gap = (sec: number): ActionSpec[] => [
            { node: 'prep', actionKind: 'shell', startSec: 0, endSec: 10 },
            {
                node: 'n',
                actionKind: 'agent.run',
                startSec: 10 + sec,
                endSec: 10 + sec + 5,
                invocation: { continue: true },
            },
        ];
        expect(flagsFor(gap(300))).toEqual([]);
        expect(flagsFor(gap(300.001))).toEqual(['resume-after-idle']);
    });

    test('resume-after-idle needs a resumed or mixed session', () => {
        const fresh: ActionSpec[] = [
            { node: 'prep', actionKind: 'shell', startSec: 0, endSec: 10 },
            { node: 'n', actionKind: 'agent.run', startSec: 400, endSec: 405, invocation: { continue: false } },
        ];
        expect(flagsFor(fresh)).toEqual([]);
    });

    test('resume-cold-cache: a resumed agent.run with a cacheHit p50 below 0.5 and evidence', () => {
        const withHit = (cacheHit: number): ActionSpec[] => [
            {
                node: 'n',
                actionKind: 'agent.run',
                startSec: 0,
                endSec: 5,
                invocation: { continue: true },
                cost: cost(cacheHit),
            },
        ];
        expect(flagsFor(withHit(0.5))).toEqual([]);
        expect(flagsFor(withHit(0.499))).toEqual(['resume-cold-cache']);
    });

    test('resume-cold-cache never fires without known cache evidence', () => {
        const noEvidence: ActionSpec[] = [
            {
                node: 'n',
                actionKind: 'agent.run',
                startSec: 0,
                endSec: 5,
                invocation: { continue: true },
                cost: cost(null),
            },
        ];
        expect(flagsFor(noEvidence)).toEqual([]);
    });

    test('agent-run-over-2w: an agent.run p50 above 2W', () => {
        expect(
            flagsFor([
                { node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 600, invocation: { continue: false } },
            ]),
        ).toEqual([]);
        expect(
            flagsFor([
                { node: 'n', actionKind: 'agent.run', startSec: 0, endSec: 600.001, invocation: { continue: false } },
            ]),
        ).toEqual(['agent-run-over-2w']);
    });

    test('--window moves the threshold for the same profile', () => {
        const specs: ActionSpec[] = [{ node: 'n', actionKind: 'shell', startSec: 0, endSec: 300 }];
        expect(flagsFor(specs, 300)).toEqual([]);
        expect(flagsFor(specs, 100)).toEqual(['step-over-window']);
    });
});

describe('task 0827 R1 — dry runs are dropped before sampling', () => {
    test('a dry run never contributes an execution', () => {
        const entries = [
            { runId: 'run-a', isDryRun: false, status: 'done' },
            { runId: 'run-dry', isDryRun: true, status: 'done' },
            { runId: 'run-b', isDryRun: false, status: 'done' },
        ];
        expect(nonDryRuns(entries).map((e) => e.runId)).toEqual(['run-a', 'run-b']);
    });
});

describe('formatStepProfileHuman (ported from the script suite, 1005 R1)', () => {
    test('human output is one line per row: one-decimal seconds and ? for unknown', () => {
        const text = formatStepProfileHuman(PROFILE);
        const lines = text.trimEnd().split('\n');
        expect(lines).toHaveLength(1 + PROFILE.rows.length);
        expect(text).toContain('implement');
        expect(text).toContain('4.0s');
        expect(text).toContain('30.0s');
        // `test/shell` has one measured idle gap of 0.0s and no cache evidence at all.
        expect(text).toContain('0.0s');
        expect(text).toContain('0.40 (3/4)');
        expect(text).toContain('? (0/2)');
    });
});
