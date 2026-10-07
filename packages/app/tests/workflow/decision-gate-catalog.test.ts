/**
 * Evidence-mode operator gates through the catalog decision `gate-evidence` (task 1099):
 * confirm gates decide via DecisionService with caller `gate` lifecycle events and
 * correlation, `defer` and every served fallback defer to the operator, select gates and
 * direct construction keep the legacy maker, and evidence bounds run before any decide.
 */
import { describe, expect, mock, test } from 'bun:test';
import { join } from 'node:path';
import { getEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import type { ActionRunRow } from '@gobing-ai/spur-domain';
import { createDecisionMaker } from '@gobing-ai/ts-ai-runner';
import type { HitlRequest } from '@gobing-ai/ts-dual-workflow-engine';
import { DecisionService, type ServedDecision } from '../../src/decision/decision-service';
import type { SystemEventBus } from '../../src/services/system-event-tap';
import {
    type DecisionConfig,
    type DecisionEvaluationDeps,
    type DecisionEvaluationResult,
    evaluateDecision,
} from '../../src/workflow/decision-hitl-responder';

const CONFIRM: HitlRequest = { kind: 'confirm', prompt: 'Ship the batch?', runId: 'run-gate', node: 'approve-gate' };

const EVIDENCE_CONFIRM: DecisionConfig = {
    mode: 'evidence',
    statusVar: 'gateStatus',
    evidenceNodes: ['build'],
};

function producerRow(): ActionRunRow {
    return {
        id: 'a1',
        node: 'build',
        kind: 'shell',
        status: 'done',
        ok: 1,
        duration_ms: 1,
        result_json: JSON.stringify({ data: { stdout: '10 passed' } }),
        started_at: null,
        completed_at: '2026-01-01T00:00:00Z',
        created_at: 0,
    };
}

/** The choice variant of {@link ServedDecision} — the only shape `gate-evidence` can serve. */
type ServedChoice = Extract<ServedDecision, { type: 'choice' }>;

function servedChoice(overrides: Partial<ServedChoice> = {}): ServedChoice {
    const base: ServedChoice = {
        id: 'gate-evidence',
        type: 'choice',
        value: 'yes',
        confidence: 0.93,
        source: 'model',
        reason: 'accepted',
        maker: 'typesafe',
        durationMs: 4,
        makerSource: 'catalog-default',
    };
    return { ...base, ...overrides };
}

function fakeService(outcome: ServedDecision | Error): { service: DecisionService; decide: ReturnType<typeof mock> } {
    const decide = mock(async () => {
        if (outcome instanceof Error) throw outcome;
        return outcome;
    });
    return { service: { decide } as unknown as DecisionService, decide };
}

function recordingBus(): { bus: SystemEventBus; events: Array<{ name: string; payload: Record<string, unknown> }> } {
    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const bus = {
        emit: mock((name: string, payload: Record<string, unknown>) => {
            events.push({ name, payload });
            return Promise.resolve();
        }),
    } as unknown as SystemEventBus;
    return { bus, events };
}

function gateDeps(overrides: Partial<DecisionEvaluationDeps> = {}): DecisionEvaluationDeps {
    return { enabled: true, evidence: async () => [producerRow()], ...overrides };
}

describe('evidence-mode confirm gates through the catalog (task 1099)', () => {
    test('a model yes decides through gate-evidence with caller gate correlation and provenance', async () => {
        const { service, decide } = fakeService(servedChoice());
        const { bus } = recordingBus();
        const result = await evaluateDecision(
            CONFIRM,
            EVIDENCE_CONFIRM,
            gateDeps({ decisionService: () => Promise.resolve(service), bus }),
        );
        expect(result.kind).toBe('accepted');
        if (result.kind !== 'accepted') return;
        expect(result.value).toBe('yes');
        expect(result.provenance.mode).toBe('evidence');
        expect(result.provenance.outcome).toBe('accepted');
        expect(result.provenance.reason).toBe('accepted');
        expect(result.provenance.confidence).toBe(0.93);
        expect(result.provenance.evidenceActionIds).toEqual(['a1']);
        expect(result.provenance.evidenceDigest).toMatch(/^sha256:/);
        expect(result.provenance.artifactId).toBeNull();
        expect(decide).toHaveBeenCalledTimes(1);
        const [id, input, options] = decide.mock.calls[0] as [string, Record<string, unknown>, Record<string, unknown>];
        expect(id).toBe('gate-evidence');
        expect(input).toEqual({
            prompt: 'Ship the batch?',
            evidence: {
                actions: [{ actionId: 'a1', node: 'build', kind: 'shell', ok: true, result: '10 passed' }],
                summary: null,
                node: 'approve-gate',
            },
            node: 'approve-gate',
        });
        expect(options).toEqual({
            bus,
            context: { caller: 'gate', correlation: { runId: 'run-gate', nodeId: 'approve-gate' } },
        });
    });

    test('an explicit model defer defers to the operator as explicit-defer', async () => {
        const { service, decide } = fakeService(servedChoice({ value: 'defer', confidence: 0.99 }));
        const result = await evaluateDecision(
            CONFIRM,
            EVIDENCE_CONFIRM,
            gateDeps({ decisionService: () => Promise.resolve(service) }),
        );
        expect(result.kind).toBe('deferred');
        expect(result.provenance.reason).toBe('explicit-defer');
        expect(result.provenance.outcome).toBe('deferred');
        expect(decide).toHaveBeenCalledTimes(1);
    });

    test('a served default never yields accepted and carries the served reason', async () => {
        for (const served of [
            servedChoice({ source: 'default', reason: 'no-backend', value: 'yes', confidence: null }),
            servedChoice({ source: 'default', reason: 'low-confidence', value: 'no', confidence: 0.4 }),
            servedChoice({ source: 'default', reason: 'timeout', value: 'defer', confidence: null }),
        ] as ServedDecision[]) {
            const { service, decide } = fakeService(served);
            const result = await evaluateDecision(
                CONFIRM,
                EVIDENCE_CONFIRM,
                gateDeps({ decisionService: () => Promise.resolve(service) }),
            );
            expect(result.kind).toBe('deferred');
            expect(result.provenance.reason).toBe(served.reason);
            expect(decide).toHaveBeenCalledTimes(1);
        }
    });

    test('a service rejection (missing catalog, unregistered maker) fails closed to the operator', async () => {
        const { service } = fakeService(new Error('Unknown decision "gate-evidence"'));
        const result = await evaluateDecision(
            CONFIRM,
            EVIDENCE_CONFIRM,
            gateDeps({ decisionService: () => Promise.resolve(service) }),
        );
        expect(result.kind).toBe('deferred');
        expect(result.provenance.reason).toBe('provider-unavailable');
        expect(result.provenance.outcome).toBe('deferred');
    });

    test('oversized evidence defers before any catalog decide', async () => {
        const { service, decide } = fakeService(servedChoice());
        // Row text is bounded at selection (2k chars/row), so only a full window of 20 maxed
        // producer rows breaches the 32KB serialized-payload bound (MAX_SERIALIZED_BYTES).
        const nodes = Array.from({ length: 20 }, (_, i) => `n${i}`);
        const rows = nodes.map((node) => ({
            ...producerRow(),
            id: `id-${node}`,
            node,
            result_json: JSON.stringify({ data: { stdout: 'x'.repeat(2000) } }),
        }));
        const result = await evaluateDecision(
            CONFIRM,
            { ...EVIDENCE_CONFIRM, evidenceNodes: nodes },
            gateDeps({ evidence: async () => rows, decisionService: () => Promise.resolve(service) }),
        );
        expect(result.kind).toBe('deferred');
        expect(result.provenance.reason).toBe('oversized-evidence');
        expect(decide).not.toHaveBeenCalled();
    });

    test('never mode never decides and keeps the operator in the loop', async () => {
        const { service, decide } = fakeService(servedChoice());
        const result = await evaluateDecision(
            CONFIRM,
            { mode: 'never' },
            gateDeps({ decisionService: () => Promise.resolve(service) }),
        );
        expect(result.kind).toBe('delegate');
        expect(result.provenance.reason).toBe('policy-never');
        expect(decide).not.toHaveBeenCalled();
    });
});

describe('task 1099 boundaries: select and direct construction keep the legacy maker', () => {
    const acceptOption0Maker = async () =>
        createDecisionMaker({
            driver: {
                name: 'fake',
                ask: async () => ({
                    question: {
                        kind: 'choice' as const,
                        label: 'option_0',
                        confidence: 0.95,
                        probabilities: { option_0: 0.95, option_1: 0.04, defer: 0.01 },
                    },
                }),
            },
        });

    test('a select gate decides through the legacy maker, never through the catalog service', async () => {
        const { service, decide } = fakeService(servedChoice());
        const request: HitlRequest = {
            kind: 'select',
            prompt: 'Next?',
            options: ['repair', 'stop'],
            runId: 'run-gate',
            node: 'triage',
        };
        const config: DecisionConfig = { mode: 'evidence', statusVar: 's', evidenceNodes: ['build'] };
        const result = await evaluateDecision(
            request,
            config,
            gateDeps({ decisionService: () => Promise.resolve(service), decisionMaker: acceptOption0Maker }),
        );
        expect(result.kind).toBe('accepted');
        if (result.kind === 'accepted') expect(result.value).toBe('repair');
        expect(decide).not.toHaveBeenCalled();
    });

    test('a confirm gate without an injected service keeps the legacy maker (direct construction)', async () => {
        const { decide } = fakeService(servedChoice());
        const result = await evaluateDecision(
            CONFIRM,
            EVIDENCE_CONFIRM,
            gateDeps({ decisionMaker: acceptOption0Maker }),
        );
        expect(result.kind).toBe('accepted');
        if (result.kind === 'accepted') expect(result.value).toBe('yes');
        expect(decide).not.toHaveBeenCalled();
    });
});

describe('gate-evidence through the real bundled catalog (no backend)', () => {
    test('the run bus records start → failure → end with caller gate and the run correlation', async () => {
        const repoRoot = join(import.meta.dir, '..', '..', '..', '..');
        const service = await DecisionService.create(null, repoRoot, join(repoRoot, 'config'));
        const { bus, events } = recordingBus();
        // No decision backend: the typesafe maker needs TYPESAFE_API_KEY. Env is
        // seeded/restored through the config gateway (env-var-hygiene rule); the registry
        // only memoises successful factories, so removing the key around the call keeps
        // this deterministic on machines that export one.
        const saved = getEnvVar('TYPESAFE_API_KEY');
        setEnvVar('TYPESAFE_API_KEY', undefined);
        let result: DecisionEvaluationResult;
        try {
            result = await evaluateDecision(
                CONFIRM,
                EVIDENCE_CONFIRM,
                gateDeps({ decisionService: () => Promise.resolve(service), bus }),
            );
        } finally {
            setEnvVar('TYPESAFE_API_KEY', saved);
        }
        expect(result.kind).toBe('deferred');
        expect(result.provenance.mode).toBe('evidence');
        expect(result.provenance.outcome).toBe('deferred');
        expect(result.provenance.reason).toBe('no-backend');
        expect(events.map((event) => event.name)).toEqual(['decision.start', 'decision.failure', 'decision.end']);
        const start = events[0]?.payload as Record<string, unknown>;
        expect(start.decisionId).toBe('gate-evidence');
        expect(start.caller).toBe('gate');
        expect(start.correlation).toEqual({ runId: 'run-gate', nodeId: 'approve-gate' });
        expect(start.catalogLayer).toBe('shared');
        expect(start.makerSource).toBe('catalog-default');
        expect(start.minConfidence).toBe(0.7);
        expect(start.inputKeys).toEqual(['prompt', 'evidence', 'node']);
        const failure = events[1]?.payload as Record<string, unknown>;
        expect(failure.reason).toBe('no-backend');
        expect(failure.fallbackValue).toBe('defer');
        const end = events[2]?.payload as Record<string, unknown>;
        expect(end.source).toBe('default');
        expect(end.maker).toBe('typesafe');
    });
});
