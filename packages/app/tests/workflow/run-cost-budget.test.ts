import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkBudgetCoverage,
    checkBudgets,
    defaultGitShow,
    detectSilentRaises,
    formatViolation,
    loadPipelineBudgets,
    loadQueryCounts,
    type PipelineBudget,
    runBudgetGate,
} from '../../src/workflow/run-cost';

const REPO_ROOT = join(import.meta.dir, '../../../..');
// WHY split join (as in workflow/wrapup/drift-probe.ts): rule sp-runtime-path forbids the
// config/<dir> literal; this anchors the repo's build-time definition tree — the coverage
// target of config/pipeline-budgets.json — not a runtime config read.
const WORKFLOWS_DIR = join(REPO_ROOT, 'config', 'workflows');
const BUDGETS_PATH = join(REPO_ROOT, 'config/pipeline-budgets.json');

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
        expect(detectSilentRaises(withDecision, after)[0]?.pipeline).toBe('task-pipeline');
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

describe('checkBudgetCoverage (0826 R2)', () => {
    test('a model-query workflow without an entry is returned by name', () => {
        expect(checkBudgetCoverage({ 'new-pipeline': 2 }, {})).toEqual(['new-pipeline']);
    });

    test('a zero-query workflow without an entry passes', () => {
        expect(checkBudgetCoverage({ 'task-lifecycle': 0 }, {})).toEqual([]);
    });

    test('an entry for a zero-query workflow is allowed', () => {
        expect(checkBudgetCoverage({ 'pr-review': 0 }, { 'pr-review': budget({ modelQueries: 0 }) })).toEqual([]);
    });

    test('every live workflow definition with a query count has an entry (anti-vacuous)', async () => {
        const counts = await loadQueryCounts(WORKFLOWS_DIR);
        // loadQueryCounts returns {} on any read or parse error — pin the key set to the
        // directory so a swallowed error cannot make this test pass vacuously.
        const files = (await readdir(join(REPO_ROOT, 'config', 'workflows')))
            .filter((f) => /\.ya?ml$/.test(f))
            .map((f) => f.replace(/\.ya?ml$/, ''))
            .sort();
        expect(Object.keys(counts).sort()).toEqual(files);
        const { budgets } = await loadPipelineBudgets(BUDGETS_PATH);
        expect(checkBudgetCoverage(counts, budgets)).toEqual([]);
        const measured = Object.fromEntries(
            Object.entries(counts).map(([name, modelQueries]) => [
                name,
                { modelQueries, wallClockMs: null, tokenCostUsd: null },
            ]),
        );
        expect(checkBudgets(measured, budgets)).toEqual([]);
    });
});

describe('runBudgetGate (spur workflow cost --budget)', () => {
    async function scratch(): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), 'budget-gate-'));
        await mkdir(join(dir, 'wf'), { recursive: true });
        await writeFile(
            join(dir, 'budgets.json'),
            JSON.stringify({ schemaVersion: 1, generatedAt: 'x', note: 'n', budgets: { a: budget(), b: budget() } }),
        );
        return dir;
    }
    const noGit = async (): Promise<string | null> => null;

    test('PASS with notes when no DB exists (never creates one)', async () => {
        const dir = await scratch();
        try {
            const r = await runBudgetGate({
                cwd: dir,
                budgetPath: 'budgets.json',
                workflowsDir: join(dir, 'wf'),
                dbPath: join(dir, 'missing.db'),
                filters: [],
                gitShow: noGit,
            });
            expect(r.exitCode).toBe(0);
            expect(r.errors).toEqual([]);
            expect(r.lines.at(-1)).toBe('workflow cost --budget: PASS (2 pipelines, 0 violations)');
            expect(r.lines.filter((l) => l.startsWith('note: '))).toHaveLength(2);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('measured-file over budget, a silent raise vs HEAD, and a missing budget all fail', async () => {
        const dir = await scratch();
        try {
            await writeFile(
                join(dir, 'measured.json'),
                JSON.stringify({ a: { modelQueries: 9, wallClockMs: null, tokenCostUsd: null } }),
            );
            await writeFile(
                join(dir, 'wf', 'c.yaml'),
                'name: c\ninitial: s\nstates:\n  s:\n    actions:\n      - type: agent.run\n        prompt: hi\n    on:\n      done: end\n  end:\n    type: final\n',
            );
            const head = JSON.stringify({ budgets: { b: budget({ wallClockMs: 1 }) } });
            const r = await runBudgetGate({
                cwd: dir,
                budgetPath: join(dir, 'budgets.json'),
                workflowsDir: join(dir, 'wf'),
                dbPath: join(dir, 'missing.db'),
                filters: [],
                measuredFile: join(dir, 'measured.json'),
                gitShow: async () => head,
            });
            expect(r.exitCode).toBe(1);
            expect(r.errors.some((e) => e.startsWith('BUDGET EXCEEDED: pipeline=a modelQueries'))).toBe(true);
            expect(
                r.errors.some((e) => e.startsWith('SILENT BUDGET RAISE: pipeline=b wallClockMs: 1 -> 2300000')),
            ).toBe(true);
            expect(r.lines.at(-1)).toMatch(/^workflow cost --budget: FAIL \(\d+ failure\(s\)\)$/);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('reads the DB when present; a DB without tables reads as unmeasured; junk HEAD is ignored', async () => {
        const dir = await scratch();
        try {
            const dbPath = join(dir, 'spur.db');
            new Database(dbPath).close();
            const r = await runBudgetGate({
                cwd: dir,
                budgetPath: 'budgets.json',
                workflowsDir: join(dir, 'wf'),
                dbPath,
                filters: ['a'],
                gitShow: async () => 'not json',
            });
            expect(r.exitCode).toBe(0);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('a DB error other than a missing table propagates', async () => {
        const dir = await scratch();
        try {
            const dbPath = join(dir, 'spur.db');
            await writeFile(dbPath, '');
            const failing = {
                close: () => {},
            };
            await expect(
                runBudgetGate({
                    cwd: dir,
                    budgetPath: 'budgets.json',
                    workflowsDir: join(dir, 'wf'),
                    dbPath,
                    filters: [],
                    gitShow: noGit,
                    openDb: async () => failing as never,
                }),
            ).rejects.toThrow();
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('defaultGitShow returns null outside a repo and the committed text inside one', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'budget-git-'));
        try {
            expect(await defaultGitShow(dir, 'nope.json')).toBeNull();
            expect(await defaultGitShow(REPO_ROOT, 'config/pipeline-budgets.json')).toContain('"budgets"');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
