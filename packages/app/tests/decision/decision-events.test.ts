import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
    CreateSystemEventInput,
    SystemEventDao,
    SystemEventRetentionQuota,
    SystemEventRow,
} from '@gobing-ai/spur-domain';
import { DecisionInputError } from '@gobing-ai/ts-ai-decision';
import { EventBus } from '@gobing-ai/ts-infra';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    beginDecisionInvocation,
    decisionCorrelationFromVars,
    decisionErrorKind,
    emitDecisionRejected,
} from '../../src/decision/decision-events';
import { getDecisionService } from '../../src/decision/decision-service';
import { systemEventCatalogEntry } from '../../src/services/event-names';
import { registerSystemEventTap } from '../../src/services/system-event-tap';
import { DecideActionRunner } from '../../src/workflow/actions/decide';

/** The five cataloged decision event names. */
type DecisionEventName =
    | 'decision.start'
    | 'decision.success'
    | 'decision.failure'
    | 'decision.end'
    | 'decision.rejected';

/** Decision-event capture bus: drains the synchronous emitter into an ordered list. */
const capture = (): {
    bus: EventBus<Record<string, (event: unknown) => void>>;
    events: Array<{ name: DecisionEventName; payload: Record<string, unknown> }>;
} => {
    const events: Array<{ name: DecisionEventName; payload: Record<string, unknown> }> = [];
    const bus = new EventBus<Record<string, (event: unknown) => void>>();
    for (const name of [
        'decision.start',
        'decision.success',
        'decision.failure',
        'decision.end',
        'decision.rejected',
    ]) {
        bus.on(name, (event) => {
            events.push({ name: name as DecisionEventName, payload: event as Record<string, unknown> });
        });
    }
    return { bus, events };
};

/** One catalog file per scenario, written into a private shared root (same fixture style as decision-service.test.ts). */
const CATALOG = `
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
`;

const roots: string[] = [];
const newRoot = async (): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), 'spur-decision-events-'));
    roots.push(root);
    return root;
};

const writeCatalog = async (dir: string, yaml: string): Promise<void> => {
    const shared = join(dir, 'shared', 'decisions');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'base.yaml'), yaml);
};

afterAll(async () => {
    await Promise.all(roots.map((r) => rm(r, { recursive: true, force: true })));
});

describe('decision-events emitter (task 1095, design §3.2)', () => {
    test('accepted path emits start → success → end in order with one shared invocationId', () => {
        const { bus, events } = capture();
        const invocation = beginDecisionInvocation(
            bus as never,
            { decisionId: 'pick-lane', caller: 'cli', correlation: { runId: 'r-1', wbs: '1095' } },
            {
                type: 'choice',
                maker: 'typesafe',
                makerSource: 'catalog-default',
                catalogLayer: 'shared',
                inputKeys: ['lane'],
                minConfidence: 0.8,
            },
        );
        invocation.succeed({ value: 'fast', confidence: 0.9, maker: 'typesafe' });
        invocation.end({
            durationMs: 12,
            value: 'fast',
            source: 'model',
            reason: 'accepted',
            maker: 'typesafe',
            confidence: 0.9,
        });
        expect(events.map((e) => e.name)).toEqual(['decision.start', 'decision.success', 'decision.end']);
        expect(new Set(events.map((e) => e.payload.invocationId)).size).toBe(1);
        expect(events.every((e) => e.payload.decisionId === 'pick-lane')).toBe(true);
        expect(events.every((e) => e.payload.caller === 'cli')).toBe(true);
        const start = events[0]?.payload as Record<string, unknown>;
        expect(start.severity).toBe('info');
        expect(start.makerSource).toBe('catalog-default');
        expect(start.inputKeys).toEqual(['lane']);
        expect((start.correlation as Record<string, unknown>).runId).toBe('r-1');
        expect((start.correlation as Record<string, unknown>).wbs).toBe('1095');
        expect(events[1]?.payload.severity).toBe('info');
        expect(events[2]?.payload).toMatchObject({ durationMs: 12, source: 'model', reason: 'accepted' });
    });

    test('failure carries warning severity (error reason ⇒ error) and the fallback value', () => {
        const { bus, events } = capture();
        const invocation = beginDecisionInvocation(
            bus as never,
            { decisionId: 'pick-lane', caller: 'workflow' },
            {
                type: 'choice',
                maker: 'typesafe',
                makerSource: 'inline',
                catalogLayer: '',
                inputKeys: [],
                minConfidence: 0.8,
            },
        );
        invocation.fail({ reason: 'no-backend', fallbackValue: 'slow', confidence: null, maker: 'none' });
        invocation.end({
            durationMs: 3,
            value: 'slow',
            source: 'default',
            reason: 'no-backend',
            maker: 'none',
            confidence: null,
        });
        expect(events.map((e) => e.name)).toEqual(['decision.start', 'decision.failure', 'decision.end']);
        expect(events[1]?.payload).toMatchObject({ severity: 'warning', reason: 'no-backend', fallbackValue: 'slow' });

        const { bus: bus2, events: events2 } = capture();
        const invocation2 = beginDecisionInvocation(
            bus2 as never,
            { decisionId: 'pick-lane', caller: 'workflow' },
            {
                type: 'choice',
                maker: 'typesafe',
                makerSource: 'inline',
                catalogLayer: '',
                inputKeys: [],
                minConfidence: 0.8,
            },
        );
        invocation2.fail({ reason: 'error', fallbackValue: 'slow', confidence: null, maker: 'none' });
        expect(events2[1]?.payload.severity).toBe('error');
    });

    test('rejected is a single event with a closed errorKind and a redacted bounded message', () => {
        const { bus, events } = capture();
        const long = `${'x'.repeat(600)} token=abc123`;
        emitDecisionRejected(
            bus as never,
            { decisionId: 'nope', caller: 'cli', correlation: { runId: 'r-2' } },
            new Error(long),
        );
        expect(events.map((e) => e.name)).toEqual(['decision.rejected']);
        const payload = events[0]?.payload as Record<string, unknown>;
        expect(payload.severity).toBe('error');
        expect(payload.errorKind).toBe('error');
        // redactAndBound appends an ellipsis after the 512-char bound.
        expect((payload.message as string).length).toBeLessThanOrEqual(513);
        expect(payload.message).not.toContain('abc123');
        expect(payload.invocationId).not.toBeUndefined();
    });

    test('an undefined bus is a full no-op and a throwing listener never propagates', () => {
        const invocation = beginDecisionInvocation(
            undefined,
            { decisionId: 'pick-lane', caller: 'cli' },
            {
                type: 'choice',
                maker: 'typesafe',
                makerSource: 'flag',
                catalogLayer: 'project',
                inputKeys: [],
                minConfidence: 0.8,
            },
        );
        expect(() => {
            invocation.succeed({ value: 'fast', confidence: 0.9, maker: 'typesafe' });
            invocation.end({
                durationMs: 1,
                value: 'fast',
                source: 'model',
                reason: 'accepted',
                maker: 'typesafe',
                confidence: 0.9,
            });
        }).not.toThrow();
        expect(() =>
            emitDecisionRejected(undefined, { decisionId: 'x', caller: 'cli' }, new Error('boom')),
        ).not.toThrow();

        const hostile = new EventBus<Record<string, (event: unknown) => void>>();
        hostile.on('decision.start', () => {
            throw new Error('listener bug');
        });
        const safe = beginDecisionInvocation(
            hostile as never,
            { decisionId: 'pick-lane', caller: 'cli' },
            {
                type: 'choice',
                maker: 'typesafe',
                makerSource: 'flag',
                catalogLayer: 'project',
                inputKeys: [],
                minConfidence: 0.8,
            },
        );
        expect(() =>
            safe.end({
                durationMs: 1,
                value: 'slow',
                source: 'default',
                reason: 'no-backend',
                maker: 'none',
                confidence: null,
            }),
        ).not.toThrow();
    });

    test('an async bus.emit rejection is swallowed and never reaches the decision caller', async () => {
        const rejectingBus = {
            emit: () => Promise.reject(new Error('bus downstream failure')),
        };
        const invocation = beginDecisionInvocation(
            rejectingBus as never,
            { decisionId: 'pick-lane', caller: 'cli' },
            {
                type: 'choice',
                maker: 'typesafe',
                makerSource: 'flag',
                catalogLayer: 'project',
                inputKeys: [],
                minConfidence: 0.8,
            },
        );
        expect(() => {
            invocation.succeed({ value: 'fast', confidence: 0.9, maker: 'typesafe' });
            invocation.end({
                durationMs: 1,
                value: 'fast',
                source: 'model',
                reason: 'accepted',
                maker: 'typesafe',
                confidence: 0.9,
            });
        }).not.toThrow();
        // Let the swallowed rejection settle; a lost `.catch` here surfaces as an
        // unhandled rejection and fails the run (design §5 R5 best-effort emit).
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
});

describe('DecisionService decision events (task 1095 R6/R7)', () => {
    test('decide without a bus is unchanged; with a bus it emits the fallback lifecycle in order', async () => {
        const root = await newRoot();
        await writeCatalog(root, CATALOG);
        const service = await getDecisionService(null as never, root, join(root, 'shared'));

        // No bus: no events possible, result unchanged (AC4: observability never gates decide).
        const silent = await service.decide('pick-lane');
        expect(silent.reason).toBe('no-backend');
        expect(silent.makerSource).toBe('catalog-default');

        const { bus, events } = capture();
        const served = await service.decide('pick-lane', undefined, {
            bus: bus as never,
            context: { caller: 'cli', correlation: { runId: 'r-9' } },
        });
        expect(served.value).toBe('slow');
        expect(events.map((e) => e.name)).toEqual(['decision.start', 'decision.failure', 'decision.end']);
        const start = events[0]?.payload as Record<string, unknown>;
        expect(start).toMatchObject({
            decisionId: 'pick-lane',
            caller: 'cli',
            type: 'choice',
            maker: 'typesafe',
            makerSource: 'catalog-default',
            catalogLayer: 'shared',
            minConfidence: 0.8,
            severity: 'info',
        });
        expect(start.inputKeys).toEqual([]);
        const end = events[2]?.payload as Record<string, unknown>;
        expect(end).toMatchObject({ source: 'default', reason: 'no-backend', maker: 'typesafe' });
        expect(typeof end.durationMs).toBe('number');
    });

    test('caller mistakes emit decision.rejected before any lifecycle event', async () => {
        const root = await newRoot();
        await writeCatalog(root, CATALOG);
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        const { bus, events } = capture();

        await expect(
            service.decide('unknown-id', {}, { bus: bus as never, context: { caller: 'cli' } }),
        ).rejects.toThrow();
        expect(events.map((e) => e.name)).toEqual(['decision.rejected']);
        expect(events[0]?.payload).toMatchObject({ errorKind: 'unknown-decision', caller: 'cli' });

        await expect(
            service.decide('pick-lane', {}, { maker: 'missing-maker', bus: bus as never, context: { caller: 'cli' } }),
        ).rejects.toThrow();
        expect(events.map((e) => e.name)).toEqual(['decision.rejected', 'decision.rejected']);
        expect(events[1]?.payload.maker).toBe('missing-maker');
    });

    test('input validation emits only decision.rejected with errorKind input (task 1113 R1)', async () => {
        const root = await newRoot();
        await writeCatalog(root, CATALOG);
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        const { bus, events } = capture();

        // An undeclared input key is a caller mistake: rejected BEFORE decision.start,
        // so the reliability report never reads it as a maker fault.
        await expect(
            service.decide('pick-lane', { bogus: 1 }, { bus: bus as never, context: { caller: 'cli' } }),
        ).rejects.toThrow('Unknown parameter "bogus"');
        expect(events.map((e) => e.name)).toEqual(['decision.rejected']);
        expect(events[0]?.payload).toMatchObject({ errorKind: 'input', caller: 'cli' });
    });

    test('a post-start hub throw keeps the fixed start → failure → end order (task 1113 R2)', async () => {
        const root = await newRoot();
        await writeCatalog(root, CATALOG);
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        const { bus, events } = capture();
        // The hub is constructed inside the service; swap in a throwing one to force
        // the post-start error path the old bare finally papered over. describe must
        // keep working — decide resolves the description through the hub first.
        const realHub = (service as unknown as { hub: { describe: (id: string) => unknown } }).hub;
        (service as unknown as { hub: unknown }).hub = {
            describe: (id: string) => realHub.describe(id),
            decide: async () => {
                throw new Error('maker exploded');
            },
        };

        await expect(
            service.decide('pick-lane', {}, { bus: bus as never, context: { caller: 'cli' } }),
        ).rejects.toThrow('maker exploded');
        expect(events.map((e) => e.name)).toEqual(['decision.start', 'decision.failure', 'decision.end']);
        expect(events[1]?.payload).toMatchObject({ reason: 'error', fallbackValue: 'slow', confidence: null });
        expect(String(events[1]?.payload.error)).toContain('maker exploded');
        expect(events[2]?.payload).toMatchObject({ reason: 'error', maker: 'typesafe' });
    });

    test('evidenceDigest prefers non-empty instructions, else a string evidence input (task 1113 R5)', async () => {
        const root = await newRoot();
        await writeCatalog(root, CATALOG);
        // A decision that declares the `evidence` parameter: the gate path passes its
        // evidence there, so the digest source falls back to it (design §3.1 R5).
        const shared = join(root, 'shared', 'decisions');
        await writeFile(
            join(shared, 'evidence.yaml'),
            [
                'version: 1',
                'defaults:',
                '    minConfidence: 0.8',
                '    maker: typesafe',
                'decisions:',
                '    gated-evidence:',
                '        type: choice',
                '        criteria:',
                '            a: a',
                '            b: b',
                '        fallback: a',
                '        parameters:',
                '            evidence:',
                '                type: string',
                "                default: ''",
                '',
            ].join('\n'),
        );
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        const { bus, events } = capture();
        await service.decide(
            'pick-lane',
            { instructions: 'evidence text' },
            { bus: bus as never, context: { caller: 'cli' } },
        );
        const digest = (events[0]?.payload as Record<string, unknown>).evidenceDigest;
        expect(digest).toBe(`sha256:${createHash('sha256').update('evidence text', 'utf8').digest('hex')}`);

        const second = capture();
        await service.decide(
            'gated-evidence',
            { evidence: 'raw evidence' },
            {
                bus: second.bus as never,
                context: { caller: 'cli' },
            },
        );
        const digest2 = (second.events[0]?.payload as Record<string, unknown>).evidenceDigest;
        expect(digest2).toBe(`sha256:${createHash('sha256').update('raw evidence', 'utf8').digest('hex')}`);
    });
});

describe('run correlation producers (task 1113 R3/R4)', () => {
    test('decisionCorrelationFromVars reads __runId/__workflowName/__nodeId/wbs', () => {
        expect(
            decisionCorrelationFromVars({
                __runId: 'r-9',
                __workflowName: 'task-pipeline',
                __nodeId: 'decide',
                wbs: '1113',
            }),
        ).toEqual({ runId: 'r-9', workflowName: 'task-pipeline', nodeId: 'decide', wbs: '1113' });
    });

    test('placeholder and malformed values stay absent; no __runId means no correlation', () => {
        expect(decisionCorrelationFromVars({ __runId: 'r-9', wbs: '0000' })).toEqual({ runId: 'r-9' });
        expect(decisionCorrelationFromVars({ __runId: 'r-9', wbs: 'abc' })).toEqual({ runId: 'r-9' });
        expect(decisionCorrelationFromVars({ __runId: 'r-9', wbs: '12345' })).toEqual({ runId: 'r-9' });
        expect(decisionCorrelationFromVars({})).toBeUndefined();
        expect(decisionCorrelationFromVars({ __runId: '' })).toBeUndefined();
    });

    test('decisionErrorKind maps DecisionInputError to input (task 1113 R1)', () => {
        expect(decisionErrorKind(new DecisionInputError('bad', 'pick-lane', 'lane'))).toBe('input');
    });
});

describe('decision catalog contract (task 1095 R1)', () => {
    test('decision entries are decision-source metadata-only and declared in the catalog', () => {
        for (const name of [
            'decision.start',
            'decision.success',
            'decision.failure',
            'decision.end',
            'decision.rejected',
        ]) {
            const entry = systemEventCatalogEntry(name);
            expect(entry?.source).toBe('decision');
            expect(entry?.payloadPolicy).toBe('metadata-only');
            expect(entry?.producerPackage).toBe('spur');
            expect(entry?.subsystem).toBe('decision');
        }
    });
});

/** In-memory fake DAO recording every insert (same shape as system-event-tap.test.ts). */
class FakeSystemEventDao {
    readonly inserted: CreateSystemEventInput[] = [];
    async insert(input: CreateSystemEventInput): Promise<void> {
        this.inserted.push(input);
    }
    async pruneQuotas(_quotas: SystemEventRetentionQuota[], _prefix?: string): Promise<number> {
        return 0;
    }
    async query(): Promise<SystemEventRow[]> {
        return [];
    }
    async deleteAll(): Promise<void> {}
}

describe('decision events × system-event ledger (task 1095 AC5)', () => {
    test('metadata-only projection keeps declared fields and correlation in persisted rows', async () => {
        const root = await newRoot();
        await writeCatalog(root, CATALOG);
        const service = await getDecisionService(null as never, root, join(root, 'shared'));
        const dao = new FakeSystemEventDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const tap = registerSystemEventTap(bus as never, dao as unknown as SystemEventDao, {
            warn: () => {},
            debug: () => {},
        });
        await service.decide('pick-lane', undefined, {
            bus: bus as never,
            context: { caller: 'cli', correlation: { runId: 'r-ledger', wbs: '1095' } },
        });
        await tap.flush();
        tap.unsubscribe();
        expect(dao.inserted.map((row) => row.event_name)).toEqual([
            'decision.start',
            'decision.failure',
            'decision.end',
        ]);
        // Correlation reaches the dedicated ledger column AND the envelope context.
        expect(dao.inserted[0]?.run_id).toBe('r-ledger');
        const failure = dao.inserted[1] as CreateSystemEventInput & { payload_json?: string };
        const envelope = JSON.parse(failure.payload_json as string) as {
            data: Record<string, unknown>;
            context: { correlation: Record<string, unknown> };
        };
        expect(envelope.data).toMatchObject({
            decisionId: 'pick-lane',
            reason: 'no-backend',
            fallbackValue: 'slow',
            caller: 'cli',
        });
        expect(envelope.context.correlation.runId).toBe('r-ledger');
        // Declared nested retain path survives projection; the envelope context keeps only run/entity.
        expect((envelope.data.correlation as Record<string, unknown>).wbs).toBe('1095');
    });

    test('decision.rejected persists errorKind; the metadata-only projection drops `message`', async () => {
        const dao = new FakeSystemEventDao();
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const tap = registerSystemEventTap(bus as never, dao as unknown as SystemEventDao, {
            warn: () => {},
            debug: () => {},
        });
        emitDecisionRejected(bus as never, { decisionId: 'pick-lane', caller: 'cli' }, new Error('refused: bad input'));
        await tap.flush();
        tap.unsubscribe();
        expect(dao.inserted).toHaveLength(1);
        const envelope = JSON.parse((dao.inserted[0]?.payload_json as string) ?? '{}') as {
            data: Record<string, unknown>;
            presentation: { summary: string };
        };
        expect(envelope.data.errorKind).toBe('error');
        // Residual (documented): the metadata-only OMITTED_KEY list drops any top-level
        // `message` key, so the redacted message survives only in the derived summary.
        expect(envelope.data.message).toBeUndefined();
        expect(envelope.presentation.summary).toContain('rejected');
    });
});

describe('DecideActionRunner decision events (task 1095 R8)', () => {
    const fakeFs = (): FileSystem =>
        ({
            readFile: async () => {
                throw new Error('no files');
            },
            writeFile: async () => {},
        }) as unknown as FileSystem;

    const options = {
        id: 'pick-lane',
        method: 'choice' as const,
        question: 'q',
        choices: ['yes', 'no'],
        default: 'no',
        resultFile: 'out/decide.json',
    };
    const runContext = { runId: 'r-run', stateOrNodeId: 'decide', workdir: '.', vars: {}, env: {} };

    test('reason disabled emits nothing even with a bus attached', async () => {
        const { bus, events } = capture();
        const runner = new DecideActionRunner(fakeFs(), { enabled: false, observabilityBus: bus as never });
        const result = await runner.execute(options, runContext as never);
        expect(result.ok).toBe(true);
        expect(events).toEqual([]);
    });

    test('degraded run emits start → failure → end with inline makerSource and run/node correlation', async () => {
        const { bus, events } = capture();
        // A failing maker factory resolves to reason `no-backend` with maker `none`.
        const runner = new DecideActionRunner(fakeFs() as never, {
            enabled: true,
            decisionMaker: async () => {
                throw new Error('no backend in tests');
            },
            observabilityBus: bus as never,
        });
        const result = await runner.execute(options, runContext as never);
        expect(result.ok).toBe(true);
        expect(events.map((e) => e.name)).toEqual(['decision.start', 'decision.failure', 'decision.end']);
        const start = events[0]?.payload as Record<string, unknown>;
        expect(start).toMatchObject({
            decisionId: 'pick-lane',
            caller: 'workflow',
            maker: 'none',
            makerSource: 'inline',
        });
        expect(start.correlation).toEqual({ runId: 'r-run', nodeId: 'decide' });
        expect(events[1]?.payload).toMatchObject({ reason: 'no-backend', fallbackValue: 'no', maker: 'none' });
    });
});
