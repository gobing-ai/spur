/**
 * planning-admission — the pure readiness/admission policy (task 1176 ownership move).
 *
 * These assertions belong to the owner of the decision. The plugin adapter keeps its own contract
 * tests (`plugins/sp/tests/batch-preflight.test.ts`) for the CLI surface and recovery hints it still
 * owns; here the policy itself is exercised directly against the app module.
 */

import { describe, expect, test } from 'bun:test';
import {
    classifyFeaturePreflightFindings,
    NON_ABORTING_PREFLIGHT_CODES,
    type PreflightInput,
    preflightTask,
    type QuickReadinessInput,
    quickReadiness,
} from '../../src/services/planning-admission';

/** TABLE A STOP evaluation: happy path returns `run`; only a STOP row returns `skip`. */
describe('preflightTask — TABLE A STOP evaluation (task 0279)', () => {
    const input = (over: Partial<PreflightInput> = {}): PreflightInput => ({
        wbs: '0042',
        status: 'todo',
        dependencies: [],
        depStatuses: {},
        ...over,
    });

    test('A2 — a todo with an unmet dependency is skipped, naming the dep', () => {
        const r = preflightTask(input({ dependencies: ['0040'], depStatuses: { '0040': 'wip' } }));
        expect(r.action).toBe('skip');
        expect(r.action === 'skip' && r.code).toBe('A2');
        expect(r.action === 'skip' && r.unmetDeps).toEqual(['0040']);
    });

    test('A2 — a dependency with no status counts as unmet', () => {
        const r = preflightTask(input({ dependencies: ['0040'], depStatuses: {} }));
        expect(r.action).toBe('skip');
        expect(r.action === 'skip' && r.code).toBe('A2');
    });

    test('a ready todo, an empty dependency list, wip and testing all run', () => {
        expect(preflightTask(input({ dependencies: ['0040'], depStatuses: { '0040': 'done' } })).action).toBe('run');
        expect(preflightTask(input()).action).toBe('run');
        expect(preflightTask(input({ status: 'wip' })).action).toBe('run');
        expect(preflightTask(input({ status: 'testing' })).action).toBe('run');
    });

    test('A7 blocked, A8 done and A9 cancelled are STOP rows', () => {
        for (const [status, code] of [
            ['blocked', 'A7'],
            ['done', 'A8'],
            ['cancelled', 'A9'],
        ] as const) {
            const r = preflightTask(input({ status }));
            expect(r.action).toBe('skip');
            expect(r.action === 'skip' && r.code).toBe(code);
        }
    });
});

/** Command-aware readiness: the operation decides whether a gap blocks or is work to do. */
describe('quickReadiness — command-aware admission (task 0814 R2)', () => {
    const input = (over: Partial<QuickReadinessInput> = {}): QuickReadinessInput => ({
        wbs: '0814',
        status: 'todo',
        operation: 'run',
        ...over,
    });

    test('runnable — a todo run with no required-section gaps', () => {
        const r = quickReadiness(input({ requiredSections: ['Design'], presentSections: ['Design'] }));
        expect(r.action).toBe('runnable');
    });

    test('needs-refinement — run with a missing required section reports the gap', () => {
        const r = quickReadiness(
            input({ requiredSections: ['Design', 'Review'], presentSections: ['Design'], sectionFindings: {} }),
        );
        expect(r.action).toBe('needs-refinement');
        expect(r.action === 'needs-refinement' && r.gaps).toEqual(['Review']);
    });

    test('refine treats the same planning gap as work to do, not a blocker', () => {
        const r = quickReadiness(
            input({ operation: 'refine', requiredSections: ['Design'], presentSections: [], sectionFindings: {} }),
        );
        expect(r.action).toBe('runnable');
    });

    test('blocked — run with an unmet out-of-set dependency', () => {
        const r = quickReadiness(input({ dependencies: ['0040'], depStatuses: { '0040': 'wip' } }));
        expect(r.action).toBe('blocked');
        expect(r.action === 'blocked' && r.unmetDeps).toEqual(['0040']);
    });

    test('skipped — the empty status-filtered set (zero-task rule), and terminal statuses', () => {
        expect(quickReadiness(input({ filteredCount: 0 })).action).toBe('skipped');
        expect(quickReadiness(input({ status: 'done' })).action).toBe('skipped');
        expect(quickReadiness(input({ status: 'cancelled' })).action).toBe('skipped');
    });

    test('invalid — an unknown operation or an ineligible run status', () => {
        expect(quickReadiness(input({ operation: 'nope' as never })).action).toBe('invalid');
        expect(quickReadiness(input({ status: 'backlog', operation: 'verify' })).action).toBe('invalid');
    });

    test('verify — testing and wip are runnable; blocked blocks', () => {
        expect(quickReadiness(input({ status: 'testing', operation: 'verify' })).action).toBe('runnable');
        expect(quickReadiness(input({ status: 'wip', operation: 'verify' })).action).toBe('runnable');
        expect(quickReadiness(input({ status: 'blocked', operation: 'verify' })).action).toBe('blocked');
    });

    test('verify --force re-verifies an already-done task instead of skipping it', () => {
        expect(quickReadiness(input({ status: 'done', operation: 'verify' })).action).toBe('skipped');
        expect(quickReadiness(input({ status: 'done', operation: 'verify', force: true })).action).toBe('runnable');
    });

    test('a negative filteredCount is invalid while zero is the empty-set skip', () => {
        expect(quickReadiness(input({ filteredCount: -1 })).action).toBe('invalid');
        expect(quickReadiness(input({ filteredCount: 0 })).action).toBe('skipped');
    });

    test('presentSections lets the policy detect a missing required section by itself', () => {
        const r = quickReadiness(input({ requiredSections: ['Plan'], presentSections: ['Design'] }));
        expect(r.action).toBe('needs-refinement');
        expect(r.action === 'needs-refinement' && r.gaps).toContain('Plan');
    });

    test('refine on a non-planning status is skipped, not run', () => {
        expect(quickReadiness(input({ status: 'testing', operation: 'refine' })).action).toBe('skipped');
    });
});

/** Feature preflight classification: the expected pre-run states never abort a batch. */
describe('classifyFeaturePreflightFindings (task 1132 R4)', () => {
    test('the two expected pre-run codes are non-aborting, in code and in the exported set', () => {
        expect(NON_ABORTING_PREFLIGHT_CODES.has('L4.scenario-unverified')).toBe(true);
        expect(NON_ABORTING_PREFLIGHT_CODES.has('L4.verifying-incomplete-tasks')).toBe(true);
        const result = classifyFeaturePreflightFindings([
            { layer: 'L4', code: 'L4.scenario-unverified', severity: 'error', message: 'not yet run' },
            { layer: 'L4', code: 'L4.verifying-incomplete-tasks', severity: 'error', message: 'new live tasks' },
        ]);
        expect(result.nonAborting).toHaveLength(2);
        expect(result.aborting).toEqual([]);
        expect(result.shouldAbort).toBe(false);
    });

    test('a structural finding still aborts', () => {
        const result = classifyFeaturePreflightFindings([
            { layer: 'L3', code: 'L3.scope-delineation', severity: 'error', message: 'no In/Out split' },
        ]);
        expect(result.aborting).toHaveLength(1);
        expect(result.shouldAbort).toBe(true);
    });

    test('a mixed list aborts on the structural finding alone', () => {
        const result = classifyFeaturePreflightFindings([
            { layer: 'L4', code: 'L4.scenario-unverified', severity: 'error', message: 'expected' },
            { layer: 'L4', code: 'L4.uncovered-feature-scenario', severity: 'error', message: 'real defect' },
        ]);
        expect(result.aborting.map((f) => f.code)).toEqual(['L4.uncovered-feature-scenario']);
        expect(result.shouldAbort).toBe(true);
    });
});
