import { describe, expect, test } from 'bun:test';
import type { DecisionMaker } from '@gobing-ai/ts-ai-runner';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { collectDecideViolations } from '../../../src/services/workflow-service';
import { DECIDE_KIND, DecideActionRunner, DecideOptionsSchema } from '../../../src/workflow/actions/decide';

/**
 * Runner-level coverage for the non-pausing decide action (0941): the zod option schema
 * (R1) is the SAME schema `collectDecideViolations` walks workflows with (R6), and a valid
 * run writes the resultFile row and returns `data.value` without ever reading it back.
 */

function fakeFs(files: Record<string, string> = {}): { fs: FileSystem; writes: Record<string, string> } {
    const writes: Record<string, string> = {};
    return {
        writes,
        fs: {
            readFile: async (path: string) => {
                if (files[path] === undefined) throw new Error(`ENOENT: ${path}`);
                return files[path];
            },
            writeFile: async (path: string, content: string) => {
                writes[path] = content;
            },
        } as unknown as FileSystem,
    };
}

function makeContext(workdir: string): ActionRunContext {
    return { runId: 'run-1', stateOrNodeId: 'classify', workdir, vars: {}, env: {} };
}

function fakeMaker(answer: { label: string; confidence: number }): () => Promise<DecisionMaker> {
    const maker = {
        driver: 'fake',
        ask: () => Promise.reject(new Error('not used')),
        choice: () => Promise.resolve({ ...answer, kind: 'choice' as const, probabilities: {} }),
        score: () => Promise.reject(new Error('not used')),
        noul: () => Promise.reject(new Error('not used')),
    };
    return () => Promise.resolve(maker as unknown as DecisionMaker);
}

const validOptions = {
    id: 'recovery-classify',
    method: 'choice',
    question: 'retry or stop?',
    choices: ['retry', 'stop'],
    default: 'stop',
    resultFile: '.spur/run/x-recovery.decision.json',
};

describe('DecideOptionsSchema (0941 R1)', () => {
    test('accepts a valid choice and a valid noul options object', () => {
        expect(DecideOptionsSchema.safeParse(validOptions).success).toBe(true);
        expect(
            DecideOptionsSchema.safeParse({
                id: 'gate',
                method: 'noul',
                question: 'is the fix verified?',
                default: 'no',
                resultFile: 'out/decision.json',
            }).success,
        ).toBe(true);
    });

    test('choice requires at least two choices and the default inside them (0941 R6)', () => {
        const noChoices = DecideOptionsSchema.safeParse({ ...validOptions, choices: undefined });
        expect(noChoices.success).toBe(false);
        const outside = DecideOptionsSchema.safeParse({ ...validOptions, default: 'pause' });
        expect(outside.success).toBe(false);
    });

    test('noul forbids choices and pins default to yes/no (0941 R1)', () => {
        const withChoices = DecideOptionsSchema.safeParse({
            id: 'gate',
            method: 'noul',
            question: 'q',
            choices: ['yes', 'no'],
            default: 'yes',
            resultFile: 'd.json',
        });
        expect(withChoices.success).toBe(false);
        const badDefault = DecideOptionsSchema.safeParse({
            id: 'gate',
            method: 'noul',
            question: 'q',
            default: 'maybe',
            resultFile: 'd.json',
        });
        expect(badDefault.success).toBe(false);
    });

    test('resultFile and unknown keys are validated (strict schema)', () => {
        const noResultFile = DecideOptionsSchema.safeParse({ ...validOptions, resultFile: undefined });
        expect(noResultFile.success).toBe(false);
        const unknownKey = DecideOptionsSchema.safeParse({ ...validOptions, temperature: 1 });
        expect(unknownKey.success).toBe(false);
    });
});

describe('DecideActionRunner', () => {
    test('kind is the frozen `decide` name (0941)', () => {
        const { fs } = fakeFs();
        expect(new DecideActionRunner(fs, { enabled: true }).kind).toBe(DECIDE_KIND);
        expect(DECIDE_KIND).toBe('decide');
    });

    test('invalid options fail closed with a `decide:` error and write nothing (0941 R3)', async () => {
        const { fs, writes } = fakeFs();
        const runner = new DecideActionRunner(fs, { enabled: true });
        const result = await runner.execute({ ...validOptions, default: 'pause' }, makeContext('.'));
        expect(result.ok).toBe(false);
        expect(result.error).toContain('decide: invalid options');
        expect(Object.keys(writes)).toHaveLength(0);
    });

    test('accepted decision writes the resultFile row and returns data.value (0941 R2)', async () => {
        const { fs, writes } = fakeFs({
            '/tmp/decide-workdir/summary.txt': 'verification failed twice; retry is safe',
        });
        const runner = new DecideActionRunner(fs, {
            enabled: true,
            decisionMaker: fakeMaker({ label: 'retry', confidence: 0.91 }),
        });
        const result = await runner.execute(
            { ...validOptions, evidence: ['summary.txt'] },
            makeContext('/tmp/decide-workdir'),
        );
        expect(result.ok).toBe(true);
        expect(result.data?.value).toBe('retry');
        const decision = result.data?.decision as { schemaVersion: number; degraded: boolean; reason: string };
        expect(decision.schemaVersion).toBe(1);
        expect(decision.degraded).toBe(false);
        // resultFile row written under the workdir with the frozen v1 shape.
        const rows = Object.keys(writes);
        expect(rows).toHaveLength(1);
        const resultPath = rows[0] ?? '';
        expect(resultPath.endsWith('.spur/run/x-recovery.decision.json')).toBe(true);
        const row = JSON.parse(writes[resultPath] ?? '{}') as Record<string, unknown>;
        expect(row.value).toBe('retry');
        expect(row.reason).toBe('accepted');
        expect(row.schemaVersion).toBe(1);
    });

    test('degraded decision still ok:true with value=default — the run continues (0941 R3/R4)', async () => {
        const { fs, writes } = fakeFs();
        // Switch off (R4 default): no backend configured anywhere.
        const runner = new DecideActionRunner(fs, { enabled: false });
        const result = await runner.execute(validOptions, makeContext('.'));
        expect(result.ok).toBe(true);
        expect(result.data?.value).toBe('stop');
        const decision = result.data?.decision as { degraded: boolean; reason: string };
        expect(decision.degraded).toBe(true);
        expect(decision.reason).toBe('disabled');
        const degradedRowText = writes['.spur/run/x-recovery.decision.json'] ?? '{}';
        expect((JSON.parse(degradedRowText) as Record<string, unknown>).reason).toBe('disabled');
    });
});

describe('collectDecideViolations (0941 R6)', () => {
    test('accepts a state-machine workflow with a valid decide action and ignores other kinds', () => {
        const def = {
            kind: 'state-machine',
            name: 'wf',
            initialState: 'a',
            states: [
                {
                    id: 'a',
                    onEnter: [
                        { kind: DECIDE_KIND, options: validOptions },
                        { kind: 'shell', options: { command: 'true' } },
                    ],
                },
            ],
            transitions: [],
        };
        expect(collectDecideViolations(def as never)).toEqual([]);
    });

    test('rejects decide without default, default outside choices, and missing resultFile', () => {
        const base = {
            kind: 'state-machine',
            name: 'wf',
            initialState: 'a',
            states: [{ id: 'a', onEnter: [] }],
            transitions: [],
        };
        const withOptions = (options: Record<string, unknown>) => ({
            ...base,
            states: [{ id: 'a', onEnter: [{ kind: DECIDE_KIND, options }] }],
        });
        const missingDefault = collectDecideViolations(withOptions({ ...validOptions, default: undefined }) as never);
        expect(missingDefault).toHaveLength(1);
        expect(missingDefault[0]).toContain('a/decide[0]');
        const outsideChoices = collectDecideViolations(withOptions({ ...validOptions, default: 'pause' }) as never);
        expect(outsideChoices).toHaveLength(1);
        expect(outsideChoices[0]).toContain('default "pause" is not one of choices');
        const missingResultFile = collectDecideViolations(withOptions({ ...validOptions, resultFile: '' }) as never);
        expect(missingResultFile).toHaveLength(1);
    });

    test('walks transition-flow nodes too', () => {
        const def = {
            kind: 'transition-flow',
            name: 'wf',
            nodes: [
                {
                    id: 'classify',
                    action: { kind: DECIDE_KIND, options: { ...validOptions, choices: ['retry'] } },
                },
            ],
        };
        const violations = collectDecideViolations(def as never);
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('classify/decide[0]');
    });
});
