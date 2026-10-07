import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@gobing-ai/ts-infra';
import type { DecisionService } from '../../../src/decision/decision-service';
import { getDecisionService } from '../../../src/decision/decision-service';
import {
    CatalogDecideOptionsSchema,
    DecideActionRunner,
    DecideOptionsSchema,
    InlineDecideOptionsSchema,
    isCatalogDecideOptions,
} from '../../../src/workflow/actions/decide';
import {
    collectDecideViolations,
    collectInlineDecideWarnings,
    hasCatalogDecideAction,
} from '../../../src/workflow/composition-lint';

const catalogOptions = {
    id: 'lane-gate',
    decision: 'pick-lane',
    resultFile: 'out/lane.decision.json',
};

function fakeFs(files: Record<string, string> = {}): {
    fs: import('@gobing-ai/ts-runtime').FileSystem;
    writes: Record<string, string>;
} {
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
        } as unknown as import('@gobing-ai/ts-runtime').FileSystem,
    };
}

function makeContext(workdir: string): import('@gobing-ai/ts-dual-workflow-engine').ActionRunContext {
    return { runId: 'run-1', stateOrNodeId: 'classify', workdir, vars: {}, env: {} };
}

/** Fake served result with the real ServedDecision shape (makerSource included). */
function served(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        type: 'choice',
        value: 'retry',
        maker: 'fake-maker',
        makerSource: 'catalog-default',
        confidence: 0.91,
        source: 'model',
        reason: 'accepted',
        durationMs: 7,
        ...overrides,
    };
}

function fakeService(description: Record<string, unknown>, decideResult?: Record<string, unknown>): DecisionService {
    return {
        describe: (id: string) => {
            if (id === 'unknown-id') throw new Error(`unknown decision: ${id}`);
            return description;
        },
        decide: async () => {
            if (decideResult === undefined) throw new Error('decide not expected');
            return decideResult;
        },
    } as unknown as DecisionService;
}

function captureBus(): {
    bus: EventBus<Record<string, (event: unknown) => void>>;
    rejected: Record<string, unknown>[];
} {
    const rejected: Record<string, unknown>[] = [];
    const bus = new EventBus<Record<string, (event: unknown) => void>>();
    bus.on('decision.rejected', (event) => rejected.push(event as Record<string, unknown>));
    return { bus, rejected };
}

describe('decide catalog schema (task 1094 R4)', () => {
    test('catalog form parses with the optional channels; inline form still parses', () => {
        expect(CatalogDecideOptionsSchema.safeParse(catalogOptions).success).toBe(true);
        expect(
            CatalogDecideOptionsSchema.safeParse({
                ...catalogOptions,
                params: { lane: 'fast' },
                evidence: ['notes.md'],
            }).success,
        ).toBe(true);
        expect(
            CatalogDecideOptionsSchema.safeParse({
                ...catalogOptions,
                params: { lane: 'fast' },
                instructions: 'pick one',
            }).success,
        ).toBe(true);
        expect(
            InlineDecideOptionsSchema.safeParse({
                id: 'x',
                method: 'choice',
                question: 'q',
                choices: ['a', 'b'],
                default: 'a',
                resultFile: 'o.json',
            }).success,
        ).toBe(true);
        expect(isCatalogDecideOptions(catalogOptions)).toBe(true);
        expect(
            isCatalogDecideOptions({
                id: 'x',
                method: 'choice',
                question: 'q',
                default: 'a',
                resultFile: 'o.json',
            }),
        ).toBe(false);
    });

    test('evidence and instructions are mutually exclusive with the reserved message', () => {
        const result = CatalogDecideOptionsSchema.safeParse({
            ...catalogOptions,
            evidence: ['a.md'],
            instructions: 'x',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toContain('instructions is reserved');
        }
    });

    test('catalog form is strict: unknown keys fail', () => {
        expect(CatalogDecideOptionsSchema.safeParse({ ...catalogOptions, question: 'q' }).success).toBe(false);
        expect(CatalogDecideOptionsSchema.safeParse({ ...catalogOptions, minConfidence: 0.5 }).success).toBe(false);
    });

    test('union accepts both shapes through DecideOptionsSchema', () => {
        expect(DecideOptionsSchema.safeParse(catalogOptions).success).toBe(true);
    });
});

// readDecisionEvidence unit tests live at the rule-required mirror path:
// tests/decision/decision-evidence-input.test.ts (task 1094 R3).

describe('DecideActionRunner catalog path (task 1094 R4)', () => {
    test('accepted served result maps onto the frozen row and writes the resultFile', async () => {
        const { fs, writes } = fakeFs();
        const service = fakeService({ id: 'pick-lane', type: 'choice', fallback: 'slow', parameters: [] }, served());
        const runner = new DecideActionRunner(fs, {
            enabled: true,
            decisionService: async () => service,
        });
        const result = await runner.execute({ ...catalogOptions, params: { lane: 'fast' } }, makeContext('.'));
        expect(result.ok).toBe(true);
        expect(result.data?.value).toBe('retry');
        const row = JSON.parse(writes['out/lane.decision.json'] ?? '{}') as Record<string, unknown>;
        expect(row).toMatchObject({
            schemaVersion: 1,
            id: 'lane-gate',
            value: 'retry',
            method: 'choice',
            backend: 'fake-maker',
            confidence: 0.91,
            degraded: false,
            reason: 'accepted',
            source: 'model',
            durationMs: 7,
        });
    });

    test('unknown decision id: describe throw emits decision.rejected and fails the action', async () => {
        const { fs, writes } = fakeFs();
        const { bus, rejected } = captureBus();
        const runner = new DecideActionRunner(fs, {
            enabled: true,
            decisionService: async () => fakeService({ type: 'choice', fallback: 'slow' }),
            observabilityBus: bus as never,
        });
        const result = await runner.execute({ ...catalogOptions, decision: 'unknown-id' }, makeContext('.'));
        expect(result.ok).toBe(false);
        expect(result.error).toContain('unknown decision');
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toMatchObject({ decisionId: 'unknown-id', caller: 'workflow' });
        expect(Object.keys(writes)).toHaveLength(0);
    });

    test('unreadable evidence degrades to the declared fallback row and emits rejected', async () => {
        const { fs, writes } = fakeFs();
        const { bus, rejected } = captureBus();
        const runner = new DecideActionRunner(fs, {
            enabled: true,
            decisionService: async () => fakeService({ id: 'pick-lane', type: 'choice', fallback: 'slow' }),
            observabilityBus: bus as never,
        });
        const result = await runner.execute({ ...catalogOptions, evidence: ['missing.md'] }, makeContext('.'));
        expect(result.ok).toBe(true);
        expect(result.data?.value).toBe('slow');
        const row = JSON.parse(writes['out/lane.decision.json'] ?? '{}') as Record<string, unknown>;
        expect(row).toMatchObject({ value: 'slow', degraded: true, reason: 'error', source: 'default', durationMs: 0 });
        expect(rejected).toHaveLength(1);
        expect(String(rejected[0]?.message)).toContain('is unreadable');
    });

    test('switch off: no events, no decide call — the disabled row from the fallback', async () => {
        const { fs, writes } = fakeFs();
        const { bus, rejected } = captureBus();
        const runner = new DecideActionRunner(fs, {
            enabled: false,
            decisionService: async () => fakeService({ id: 'pick-lane', type: 'choice', fallback: 'slow' }),
            observabilityBus: bus as never,
        });
        const result = await runner.execute(catalogOptions, makeContext('.'));
        expect(result.ok).toBe(true);
        expect(result.data?.value).toBe('slow');
        const row = JSON.parse(writes['out/lane.decision.json'] ?? '{}') as Record<string, unknown>;
        expect(row).toMatchObject({
            value: 'slow',
            degraded: true,
            reason: 'disabled',
            source: 'default',
            backend: null,
        });
        expect(rejected).toHaveLength(0);
    });

    test('params.instructions is reserved: fails the action without events or a row', async () => {
        const { fs, writes } = fakeFs();
        const { bus, rejected } = captureBus();
        const runner = new DecideActionRunner(fs, {
            enabled: true,
            decisionService: async () => fakeService({ type: 'choice', fallback: 'slow' }),
            observabilityBus: bus as never,
        });
        const result = await runner.execute(
            { ...catalogOptions, params: { instructions: 'override' } },
            makeContext('.'),
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('params.instructions is reserved');
        expect(rejected).toHaveLength(0);
        expect(Object.keys(writes)).toHaveLength(0);
    });

    test('score-type decision fails the action at the runtime backstop (inline driver has no validate)', async () => {
        const { fs, writes } = fakeFs();
        const runner = new DecideActionRunner(fs, {
            enabled: true,
            decisionService: async () => fakeService({ type: 'score', fallback: 1 }),
        });
        const result = await runner.execute(catalogOptions, makeContext('.'));
        expect(result.ok).toBe(false);
        expect(result.error).toContain('workflow decide supports choice and noul');
        expect(Object.keys(writes)).toHaveLength(0);
    });
});

describe('DecideActionRunner inline deprecation warnings (task 1094 R7)', () => {
    test('warns once per run per action id; catalog actions never warn', async () => {
        const { fs } = fakeFs();
        const warnings: string[] = [];
        const runner = new DecideActionRunner(fs, { enabled: false, warn: (m) => warnings.push(m) });
        const ctx = makeContext('.');
        await runner.execute({ id: 'legacy', method: 'noul', question: 'q', default: 'no', resultFile: 'a.json' }, ctx);
        await runner.execute({ id: 'legacy', method: 'noul', question: 'q', default: 'no', resultFile: 'a.json' }, ctx);
        await runner.execute(
            { id: 'legacy2', method: 'noul', question: 'q', default: 'no', resultFile: 'b.json' },
            ctx,
        );
        expect(warnings).toHaveLength(2);
        expect(warnings[0]).toContain('decide classify/legacy: inline decide options are deprecated');

        const catalogWarnings: string[] = [];
        const catalogRunner = new DecideActionRunner(fs, {
            enabled: false,
            decisionService: async () => fakeService({ type: 'choice', fallback: 'slow' }),
            warn: (m) => catalogWarnings.push(m),
        });
        await catalogRunner.execute(catalogOptions, makeContext('.'));
        expect(catalogWarnings).toHaveLength(0);
    });
});

describe('real catalog integration (task 1094 R2 — service composed from the config chain)', () => {
    const roots: string[] = [];
    afterAll(async () => {
        await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
    });

    test('choice + noul decisions resolve through the real service; rows carry the fallback', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-decide-catalog-'));
        roots.push(root);
        const shared = join(root, 'shared', 'decisions');
        await mkdir(shared, { recursive: true });
        await writeFile(
            join(shared, 'base.yaml'),
            `
version: 1
defaults:
    minConfidence: 0.8
    maker: typesafe
decisions:
    pick-lane:
        type: choice
        criteria:
            fast: go fast
            slow: go slow
        fallback: slow
    is-clean:
        type: noul
        criteria:
            true: all good
            false: problems found
        fallback: false
`,
        );
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        const { fs, writes } = fakeFs();
        const runner = new DecideActionRunner(fs, { enabled: true, decisionService: async () => service });

        const choiceRow = await runner.execute(
            { id: 'lane-gate', decision: 'pick-lane', resultFile: 'out/lane.json' },
            makeContext(root),
        );
        expect(choiceRow.ok).toBe(true);
        expect(JSON.parse(writes[join(root, 'out/lane.json')] ?? '{}')).toMatchObject({
            value: 'slow',
            method: 'choice',
            backend: 'typesafe',
            degraded: true,
            reason: 'no-backend',
            source: 'default',
        });

        const noulRow = await runner.execute(
            { id: 'clean-gate', decision: 'is-clean', resultFile: 'out/clean.json' },
            makeContext(root),
        );
        expect(noulRow.ok).toBe(true);
        expect(JSON.parse(writes[join(root, 'out/clean.json')] ?? '{}')).toMatchObject({ value: 'no', method: 'noul' });
    });
});

describe('composition-lint catalog checks (task 1094 R7)', () => {
    const smDef = (options: Record<string, unknown>) => ({
        kind: 'state-machine',
        name: 'wf',
        initialState: 'a',
        states: [{ id: 'a', onEnter: [{ kind: 'decide', options }] }],
        transitions: [],
    });

    test('unknown id and score type are violations when the catalog map is supplied', () => {
        const types = new Map([
            ['pick-lane', 'choice' as const],
            ['level', 'score' as const],
        ]);
        const unknown = collectDecideViolations(
            smDef({ id: 'g', decision: 'nope', resultFile: 'o.json' }) as never,
            types,
        );
        expect(unknown).toHaveLength(1);
        expect(unknown[0]).toContain('unknown decision "nope"');
        const score = collectDecideViolations(
            smDef({ id: 'g', decision: 'level', resultFile: 'o.json' }) as never,
            types,
        );
        expect(score).toHaveLength(1);
        expect(score[0]).toContain('type "score"');
    });

    test('valid catalog id and inline actions pass with the map supplied', () => {
        const types = new Map([['pick-lane', 'choice' as const]]);
        expect(collectDecideViolations(smDef(catalogOptions) as never, types)).toEqual([]);
        expect(collectDecideViolations(smDef(catalogOptions) as never)).toEqual([]);
    });

    test('hasCatalogDecideAction and collectInlineDecideWarnings discriminate the forms', () => {
        const catalogDef = smDef(catalogOptions) as never;
        const inlineDef = smDef({
            id: 'legacy',
            method: 'noul',
            question: 'q',
            default: 'no',
            resultFile: 'o.json',
        }) as never;
        expect(hasCatalogDecideAction(catalogDef)).toBe(true);
        expect(hasCatalogDecideAction(inlineDef)).toBe(false);
        expect(collectInlineDecideWarnings(inlineDef)).toHaveLength(1);
        expect(collectInlineDecideWarnings(catalogDef)).toEqual([]);
    });
});
