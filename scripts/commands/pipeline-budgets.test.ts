import { describe, expect, test } from 'bun:test';
import { checkBudgets, detectSilentRaises, formatViolation, type PipelineBudget } from './pipeline-budgets';

const budget = (over: Partial<PipelineBudget> = {}): PipelineBudget => ({
    modelQueries: 4,
    wallClockMs: 2300000,
    tokenCostUsd: null,
    source: 'test',
    decision: null,
    ...over,
});

describe('checkBudgets (0607 R3)', () => {
    test('passes when measured values are at or under budget', () => {
        const budgets = { 'task-pipeline': budget() };
        const measured = { 'task-pipeline': { modelQueries: 4, wallClockMs: 2053000, tokenCostUsd: null } };
        expect(checkBudgets(measured, budgets)).toEqual([]);
    });

    test('fails naming the pipeline, the budget, and the measured value when exceeded', () => {
        const budgets = { 'task-pipeline': budget() };
        const measured = { 'task-pipeline': { modelQueries: 5, wallClockMs: 2400000, tokenCostUsd: null } };
        const violations = checkBudgets(measured, budgets);
        expect(violations).toHaveLength(2);
        const queries = violations.find((v) => v.kind === 'modelQueries');
        expect(queries).toMatchObject({ pipeline: 'task-pipeline', budget: 4, measured: 5 });
        const wall = violations.find((v) => v.kind === 'wallClockMs');
        expect(wall).toMatchObject({ pipeline: 'task-pipeline', budget: 2300000, measured: 2400000 });
        const queryLine = formatViolation(queries ?? { pipeline: '?', kind: 'modelQueries', budget: -1, measured: -1 });
        expect(queryLine).toContain('task-pipeline');
        expect(queryLine).toContain('budget=4');
        expect(queryLine).toContain('measured=5');
    });

    test('pr-review zero-query budget passes when measured is 0 (empty list handled)', () => {
        const budgets = { 'pr-review': budget({ modelQueries: 0 }) };
        const measured = { 'pr-review': { modelQueries: 0, wallClockMs: null, tokenCostUsd: null } };
        expect(checkBudgets(measured, budgets)).toEqual([]);
    });

    test('pr-review zero-query budget fails if a query somehow appears', () => {
        const budgets = { 'pr-review': budget({ modelQueries: 0 }) };
        const measured = { 'pr-review': { modelQueries: 1, wallClockMs: null, tokenCostUsd: null } };
        expect(checkBudgets(measured, budgets)).toHaveLength(1);
    });

    test('a null budget or null measured value is unenforced, never treated as 0', () => {
        const budgets = { docs: budget({ wallClockMs: null }), pr: budget({ wallClockMs: 1 }) };
        const measured = {
            docs: { modelQueries: 1, wallClockMs: 999999, tokenCostUsd: null },
            pr: { modelQueries: 0, wallClockMs: null, tokenCostUsd: null },
        };
        // docs wall is null-budgeted -> skipped; pr measured is null -> skipped.
        expect(checkBudgets(measured, budgets)).toEqual([]);
    });

    test('a pipeline with no measurement yields no verdict', () => {
        const budgets = { 'task-pipeline': budget() };
        expect(checkBudgets({}, budgets)).toEqual([]);
    });
});

describe('detectSilentRaises (0607 R3 — no silent budget bump)', () => {
    const before = {
        'task-pipeline': budget({ wallClockMs: 2300000 }),
        wrapup: budget({ modelQueries: 1 }),
        idea: budget({
            modelQueries: 5,
            wallClockMs: 7200000,
            decision: { date: '2026-08-20', wbs: '0607', note: 'initial' },
        }),
    };

    test('a numeric raise without a fresh decision is a silent raise', () => {
        const after = {
            'task-pipeline': budget({ wallClockMs: 2500000 }), // raised, no decision
            wrapup: budget({ modelQueries: 1 }),
            idea: budget({
                modelQueries: 5,
                wallClockMs: 7200000,
                decision: { date: '2026-08-20', wbs: '0607', note: 'initial' },
            }),
        };
        const raises = detectSilentRaises(before, after);
        expect(raises).toHaveLength(1);
        expect(raises[0]).toMatchObject({
            pipeline: 'task-pipeline',
            kind: 'wallClockMs',
            before: 2300000,
            after: 2500000,
        });
    });

    test('a raise WITH a fresh recorded decision is not silent', () => {
        const after = {
            'task-pipeline': budget({
                wallClockMs: 2500000,
                decision: { date: '2026-08-21', wbs: '0617', note: 'new executor is slower on cold cache' },
            }),
            wrapup: budget({ modelQueries: 1 }),
            idea: budget({
                modelQueries: 5,
                wallClockMs: 7200000,
                decision: { date: '2026-08-20', wbs: '0607', note: 'initial' },
            }),
        };
        expect(detectSilentRaises(before, after)).toEqual([]);
    });

    test('a raise reusing the OLD decision is silent (the decision does not cover the new bump)', () => {
        const priorDecision = { date: '2026-08-20', wbs: '0607', note: 'initial' };
        const withDecision = {
            'task-pipeline': budget({ wallClockMs: 2300000, decision: priorDecision }),
            wrapup: budget({ modelQueries: 1 }),
            idea: budget({ modelQueries: 5, wallClockMs: 7200000, decision: priorDecision }),
        };
        const after = {
            'task-pipeline': budget({ wallClockMs: 2500000, decision: priorDecision }), // raise, same stale decision
            wrapup: budget({ modelQueries: 1 }),
            idea: budget({ modelQueries: 5, wallClockMs: 7200000, decision: priorDecision }),
        };
        expect(detectSilentRaises(withDecision, after)).toHaveLength(1);
        expect(detectSilentRaises(withDecision, after)[0].pipeline).toBe('task-pipeline');
    });

    test('null → number establishes a budget, not a raise; new pipelines are not raises', () => {
        const after = {
            'task-pipeline': budget({ wallClockMs: 2300000 }),
            wrapup: budget({ modelQueries: 1 }),
            idea: budget({
                modelQueries: 5,
                wallClockMs: 7200000,
                decision: { date: '2026-08-20', wbs: '0607', note: 'initial' },
            }),
            'docs-pipeline': budget({ wallClockMs: 1000 }), // new entry
        };
        expect(detectSilentRaises(before, after)).toEqual([]);
    });

    test('equal or lower budgets are never raises', () => {
        const after = {
            'task-pipeline': budget({ wallClockMs: 2000000 }), // lowered
            wrapup: budget({ modelQueries: 1 }),
            idea: budget({
                modelQueries: 5,
                wallClockMs: 7200000,
                decision: { date: '2026-08-20', wbs: '0607', note: 'initial' },
            }),
        };
        expect(detectSilentRaises(before, after)).toEqual([]);
    });
});
