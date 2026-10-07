/**
 * Tests for the phased plan projection (1104) — pure def→A-Z/1-9 two-layer plan
 * formatters. Assert on the emitted items (labels, ids, text), not timing.
 */
import { describe, expect, test } from 'bun:test';
import type { StateDef, StateMachineWorkflowDef, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import {
    buildBatchPlan,
    buildPhasedPlan,
    hostStatus,
    hostText,
    insertOnEntry,
    type PhasedPlanItem,
    planChild,
    planLetter,
    taskPhaseChildren,
    validatePhaseTable,
} from '../../src/workflow/plan-projection';

/** One fixture state; `display` mirrors the engine's `StateDef.display`. */
type FixtureState = {
    id: string;
    display?: { phase: string; phaseTitle?: string; title?: string; show?: 'plan' | 'on-entry' };
    pause?: boolean;
};

/** Minimal state-machine def helper: ids in declaration order. */
function def(states: FixtureState[], terminals: string[] = ['done']): WorkflowDef {
    const first = states[0]?.id ?? 'start';
    const machine: StateMachineWorkflowDef = {
        name: 'fixture',
        initialState: first,
        terminalStates: terminals,
        states: states.map(
            (s): StateDef => ({
                id: s.id,
                ...(s.pause ? { pause: true } : {}),
                ...(s.display ? { display: s.display } : {}),
            }),
        ),
        transitions: states.slice(1).map((s) => ({ from: first, to: s.id })),
    };
    return machine;
}

/** buildPhasedPlan that fails the test (instead of the type system) on an unexpected null. */
function buildOrThrow(d: WorkflowDef): PhasedPlanItem[] {
    const plan = buildPhasedPlan(d);
    if (plan === null) throw new Error('expected a phased plan — def has no display annotations?');
    return plan;
}

describe('planLetter / planChild caps (1104 AC4)', () => {
    test('letters run A..Z then refuse silently continuing past the cap', () => {
        expect(planLetter(0)).toBe('A');
        expect(planLetter(25)).toBe('Z');
        expect(() => planLetter(26)).toThrow();
        expect(() => planLetter(-1)).toThrow();
    });

    test('children run <letter>1..<letter>9 then refuse past the digit cap', () => {
        expect(planChild('B', 0)).toBe('B1');
        expect(planChild('B', 8)).toBe('B9');
        expect(() => planChild('B', 9)).toThrow();
        expect(() => planChild('BB', 0)).toThrow(); // parent must be a single letter
    });
});

describe('buildPhasedPlan (1104 AC2)', () => {
    const annotated = def(
        [
            { id: 'precheck', display: { phase: 'implement', phaseTitle: 'Implement', title: 'Check task readiness' } },
            { id: 'implement', display: { phase: 'implement', phaseTitle: 'Implement', title: 'Implement' } },
            {
                id: 'escalate',
                display: { phase: 'implement', phaseTitle: 'Implement', title: 'Ask operator', show: 'on-entry' },
            },
            { id: 'test', display: { phase: 'test', phaseTitle: 'Test', title: 'Run quality gate' } },
            { id: 'done' },
            { id: 'failed' },
        ],
        ['done', 'failed'],
    );

    test('opens with the prepare row and its three children', () => {
        const plan = buildOrThrow(annotated);
        expect(plan.slice(0, 4).map((i) => i.text)).toEqual([
            'A Prepare',
            'A1 Quick readiness',
            'A2 Prepare Git',
            'A3 Publish plan',
        ]);
        expect(plan.at(0)).toMatchObject({ label: 'A', id: 'prepare', outcome: 'pending' });
        expect(plan.at(1)).toMatchObject({ label: 'A1', id: 'prepare.1', parent: 'A', outcome: 'pending' });
    });

    test('phase rows follow in first-appearance order with show: plan states as digits', () => {
        const plan = buildOrThrow(annotated);
        const rows = plan.filter((i) => i.id.startsWith('phase.'));
        expect(rows.map((i) => [i.label, i.id, i.text])).toEqual([
            ['B', 'phase.implement', 'B Implement'],
            ['C', 'phase.test', 'C Test'],
        ]);
        const implement = plan.filter((i) => i.parent === 'B');
        expect(implement.map((i) => [i.label, i.id])).toEqual([
            ['B1', 'precheck'],
            ['B2', 'implement'],
        ]);
        expect(implement[0]?.text).toBe('B1 Check task readiness · precheck');
        // on-entry states never appear in the initial projection.
        expect(plan.some((i) => i.id === 'escalate')).toBe(false);
        // terminal states never appear.
        expect(plan.some((i) => i.id === 'done' || i.id === 'failed')).toBe(false);
    });

    test('returns null when no state declares display (unannotated pipeline stays untouched)', () => {
        expect(buildPhasedPlan(def([{ id: 'start' }, { id: 'done' }]))).toBeNull();
        const transitionFlow: WorkflowDef = {
            kind: 'transition-flow',
            name: 't',
            initialNode: 'a',
            nodes: [],
            edges: [],
        };
        expect(buildPhasedPlan(transitionFlow)).toBeNull();
    });

    test('absent phaseTitle across a phase falls back to the phase key', () => {
        const plan = buildOrThrow(
            def([
                { id: 'a', display: { phase: 'impl' } },
                { id: 'b', display: { phase: 'impl', title: 'B state' } },
                { id: 'done' },
            ]),
        );
        expect(plan.find((i) => i.id === 'phase.impl')?.title).toBe('impl');
        expect(plan.find((i) => i.id === 'phase.impl')?.text).toBe('B impl');
    });
});

describe('insertOnEntry (1104 R2/AC4 label stability)', () => {
    const base = def([
        { id: 'test', display: { phase: 'test', phaseTitle: 'Test', title: 'Run quality gate' } },
        { id: 'test-fix', display: { phase: 'test', phaseTitle: 'Test', title: 'Fix failures', show: 'on-entry' } },
        {
            id: 'test-recheck',
            display: { phase: 'test', phaseTitle: 'Test', title: 'Re-run quality gate', show: 'on-entry' },
        },
        { id: 'done' },
    ]);
    const plan = buildOrThrow(base);

    test('inserts the next digit under the state phase without touching existing labels', () => {
        const before = plan.map((i) => i.label);
        const next = insertOnEntry(plan, 'test-fix', base);
        expect(next.map((i) => i.id)).toContain('test-fix');
        expect(next.find((i) => i.id === 'test-fix')).toMatchObject({ label: 'B2', parent: 'B' });
        expect(next.find((i) => i.id === 'test-fix')?.text).toBe('B2 Fix failures · test-fix');
        // Every pre-existing item keeps its label (AC4 second half).
        expect(plan.map((i) => i.label)).toEqual(before);
        // Pure: the input array is unchanged.
        expect(plan.some((i) => i.id === 'test-fix')).toBe(false);
        // Re-entry is idempotent — no duplicate, labels still stable.
        const again = insertOnEntry(next, 'test-fix', base);
        expect(again.filter((i) => i.id === 'test-fix')).toHaveLength(1);
    });

    test('unknown, terminal, or unannotated states leave the plan unchanged', () => {
        expect(insertOnEntry(plan, 'nope', base)).toEqual(plan);
        expect(insertOnEntry(plan, 'done', base)).toEqual(plan);
        expect(insertOnEntry(plan, 'test', def([{ id: 'test' }, { id: 'done' }]))).toEqual(plan);
    });
});

describe('validatePhaseTable (1104 AC3)', () => {
    test('unannotated defs and non-state-machine kinds are valid by omission', () => {
        expect(validatePhaseTable(def([{ id: 'start' }, { id: 'done' }]))).toEqual([]);
        expect(validatePhaseTable({ kind: 'dag', name: 'd', nodes: [] })).toEqual([]);
    });

    test('a fully annotated table is valid', () => {
        expect(
            validatePhaseTable(
                def([
                    { id: 'a', display: { phase: 'p1', title: 'A' } },
                    { id: 'b', display: { phase: 'p1', title: 'B', show: 'on-entry' } },
                    { id: 'done' },
                ]),
            ),
        ).toEqual([]);
    });

    test('non-terminal state without display is an error naming the state', () => {
        const errors = validatePhaseTable(
            def([{ id: 'a', display: { phase: 'p1', title: 'A' } }, { id: 'b' }, { id: 'done' }]),
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('b');
    });

    test('terminal state with display is an error naming the state', () => {
        const errors = validatePhaseTable(
            def([
                { id: 'a', display: { phase: 'p1', title: 'A' } },
                { id: 'done', display: { phase: 'p1' } },
            ]),
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('done');
    });

    test('more than 25 phases exceeds the A-Z cap', () => {
        const states: FixtureState[] = Array.from({ length: 26 }, (_, i) => ({
            id: `s${i}`,
            display: { phase: `p${i}`, title: `P${i}` },
        }));
        states.push({ id: 'done' });
        const errors = validatePhaseTable(def(states));
        expect(errors.some((e) => e.includes('26'))).toBe(true);
    });

    test('more than 9 states in one phase is an error naming the phase', () => {
        const states: FixtureState[] = Array.from({ length: 10 }, (_, i) => ({
            id: `s${i}`,
            display: { phase: 'busy', title: 'Busy', show: i > 0 ? ('on-entry' as const) : undefined },
        }));
        states.push({ id: 'done' });
        const errors = validatePhaseTable(def(states));
        expect(errors).toHaveLength(1);
        expect(errors.at(0)).toContain('busy');
    });

    test('conflicting phaseTitle within one phase is an error naming the phase', () => {
        const errors = validatePhaseTable(
            def([
                { id: 'a', display: { phase: 'p1', phaseTitle: 'First' } },
                { id: 'b', display: { phase: 'p1', phaseTitle: 'Second' } },
                { id: 'done' },
            ]),
        );
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('p1');
        expect(errors[0]).toContain('First');
        expect(errors[0]).toContain('Second');
    });
});

describe('buildBatchPlan (1104 AC5)', () => {
    const task = (n: number) => ({ wbs: `11${String(n).padStart(2, '0')}`, name: `Task number ${n}` });

    test('30 tasks split into waves of 24 with A prepare / B..Y tasks / Z report', () => {
        const waves = buildBatchPlan(Array.from({ length: 30 }, (_, i) => task(i + 1)));
        expect(waves).toHaveLength(2);
        const wave1 = waves.at(0) ?? [];
        const wave2 = waves.at(1) ?? [];
        expect(wave1).toHaveLength(24 + 1 + 4 + 1);
        const [prepare, ...prepareChildren] = wave1.slice(0, 5);
        expect(prepare).toMatchObject({ label: 'A', id: 'prepare', text: 'A Prepare batch' });
        expect(prepareChildren.map((i) => i.text)).toEqual([
            'A1 Resolve and freeze task set',
            'A2 Order by dependencies',
            'A3 Prepare Git',
            'A4 Publish plan',
        ]);
        const taskRows = wave1.filter((i) => i.id.startsWith('task.'));
        expect(taskRows).toHaveLength(24);
        expect(taskRows.map((i) => i.label)).toEqual('B C D E F G H I J K L M N O P Q R S T U V W X Y'.split(' '));
        expect(taskRows.every((i) => i.parent === undefined)).toBe(true);
        expect(wave1.at(-1)).toMatchObject({ label: 'Z', id: 'report', text: 'Z Batch report' });
        // wave 2 carries the remainder with its own prepare and report rows.
        expect(wave2.filter((i) => i.id.startsWith('task.'))).toHaveLength(6);
        expect(wave2.at(-1)).toMatchObject({ label: 'Z', id: 'report' });
    });

    test('long task names truncate to 60 chars ending with an ellipsis', () => {
        const waves = buildBatchPlan([{ wbs: '0001', name: 'x'.repeat(100) }]);
        const rows = (waves.at(0) ?? []).filter((i) => i.id === 'task.0001');
        expect(rows).toHaveLength(1);
        const title = rows[0]?.title;
        expect(title?.startsWith('0001 ')).toBe(true);
        // the task NAME (after the wbs prefix) truncates to 60 chars, ellipsis included
        expect(title?.slice(5).length).toBe(60);
        expect(title?.endsWith('…')).toBe(true);
    });

    test('truncation never splits a surrogate pair at the cut', () => {
        // 58 ASCII + astral emoji straddles the 59-unit cut point.
        const waves = buildBatchPlan([{ wbs: '0001', name: `${'x'.repeat(58)}😀${'y'.repeat(20)}` }]);
        const title = (waves.at(0) ?? []).find((i) => i.id === 'task.0001')?.title ?? '';
        expect(title.endsWith('…')).toBe(true);
        expect(title.isWellFormed()).toBe(true);
    });
});

describe('taskPhaseChildren (1104 R5)', () => {
    const annotated = def([
        { id: 'precheck', display: { phase: 'implement', phaseTitle: 'Implement', title: 'Check task readiness' } },
        { id: 'test', display: { phase: 'test', phaseTitle: 'Test', title: 'Run quality gate' } },
        { id: 'review', display: { phase: 'review', phaseTitle: 'Review', title: 'Review changes' } },
        { id: 'done' },
    ]);
    const plan = buildOrThrow(annotated);

    test('one digit per phase row under the task letter, phase row ids preserved', () => {
        const children = taskPhaseChildren('B', plan);
        expect(children.map((i) => [i.label, i.id])).toEqual([
            ['B1', 'phase.implement'],
            ['B2', 'phase.test'],
            ['B3', 'phase.review'],
        ]);
        expect(children.every((i) => i.parent === 'B')).toBe(true);
    });
});

describe('hostStatus / hostText (1104 AC6)', () => {
    test('engine-driving outcomes map completed→completed, active→in_progress, everything else→pending', () => {
        expect(hostStatus('completed')).toBe('completed');
        expect(hostStatus('active')).toBe('in_progress');
        for (const outcome of ['pending', 'skipped', 'failed', 'unattempted', 'blocked'] as const) {
            expect(hostStatus(outcome)).toBe('pending');
        }
    });

    test('hostText appends [outcome] only for the four host-decided outcomes', () => {
        const item = { label: 'B', id: 'phase.x', outcome: 'pending' as const, text: 'B X' };
        expect(hostText(item)).toBe('B X');
        expect(hostText({ ...item, outcome: 'completed' })).toBe('B X');
        expect(hostText({ ...item, outcome: 'active' })).toBe('B X');
        expect(hostText({ ...item, outcome: 'skipped' })).toBe('B X [skipped]');
        expect(hostText({ ...item, outcome: 'failed' })).toBe('B X [failed]');
        expect(hostText({ ...item, outcome: 'unattempted' })).toBe('B X [unattempted]');
        expect(hostText({ ...item, outcome: 'blocked' })).toBe('B X [blocked]');
    });
});
