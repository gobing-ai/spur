import { expect, mock, test } from 'bun:test';
import type { ActionRunRow } from '@gobing-ai/spur-domain';
import { createDecisionMaker, type DecisionDriver, type DecisionMaker } from '@gobing-ai/ts-ai-runner';
import type { ActionRunContext, HitlRequest } from '@gobing-ai/ts-dual-workflow-engine';
import { HitlConfirmActionRunner } from '../../src/workflow/actions/hitl-confirm';
import { HitlSelectActionRunner } from '../../src/workflow/actions/hitl-select';
import { createDecisionHitlResponder, type DecisionHitlOptions } from '../../src/workflow/decision-hitl-responder';

const request: HitlRequest = { kind: 'confirm', prompt: 'Tests passed?', runId: 'run1', node: 'review' };
const row: ActionRunRow = {
    id: 'a',
    node: 'test',
    kind: 'shell',
    status: 'done',
    ok: 1,
    duration_ms: 1,
    result_json: JSON.stringify({
        data: { stdout: '10 tests passed private-token', env: 'DO NOT SEND' },
        setVars: { secret: 'DO NOT SEND' },
    }),
    started_at: null,
    completed_at: null,
    created_at: 0,
};
function setup(overrides: Partial<DecisionHitlOptions> = {}) {
    const fallback = { respond: mock(async () => ({ value: 'legacy' })) };
    const ask = mock(async () => ({
        question: {
            kind: 'choice' as const,
            label: 'option_0',
            confidence: 0.95,
            probabilities: { option_0: 0.95, option_1: 0.03, defer: 0.02 },
        },
    }));
    const decisionMaker = mock(async () => createDecisionMaker({ driver: { name: 'fake', ask } }));
    const evidence = mock(async () => [row]);
    const responder = createDecisionHitlResponder({
        enabled: true,
        fallback,
        decisionMaker,
        evidence,
        secrets: ['private-token'],
        ...overrides,
    });
    return { responder, fallback, ask, decisionMaker, evidence };
}

test('disabled returns the exact legacy responder without evidence or provider construction', async () => {
    const s = setup({ enabled: false });
    expect(s.responder).toBe(s.fallback);
    expect(await s.responder.respond(request)).toEqual({ value: 'legacy' });
    expect(s.decisionMaker).not.toHaveBeenCalled();
    expect(s.evidence).not.toHaveBeenCalled();
});

test('confirm uses bounded redacted outcomes without vars/environment, preserving events and vars', async () => {
    const s = setup();
    const emit = mock(() => {});
    const context = {
        runId: 'run1',
        stateOrNodeId: 'review',
        workdir: '/tmp',
        env: {},
        vars: {},
        events: { emit },
    } as unknown as ActionRunContext;
    const result = await new HitlConfirmActionRunner(s.responder).execute(
        { prompt: 'Tests passed?', var: 'approval' },
        context,
    );
    expect(result.setVars).toEqual({ approval: 'yes' });
    expect(emit.mock.calls).toHaveLength(2);
    const payload = JSON.stringify(s.ask.mock.calls);
    expect(payload).toContain('10 tests passed [REDACTED]');
    expect(payload).not.toContain('private-token');
    expect(payload).not.toContain('DO NOT SEND');
    expect(s.fallback.respond).not.toHaveBeenCalled();
});

test('select returns the original option string via the existing action', async () => {
    const s = setup();
    const result = await new HitlSelectActionRunner(s.responder).execute(
        { prompt: 'Next?', options: ['repair', 'stop'] },
        { runId: 'run1', stateOrNodeId: 'review', workdir: '/tmp', env: {}, vars: {} },
    );
    expect(result.setVars).toEqual({ __hitlAnswer: 'repair' });
});

test('input and missing evidence delegate without constructing a provider', async () => {
    const s = setup();
    await s.responder.respond({ ...request, kind: 'input' });
    expect(s.decisionMaker).not.toHaveBeenCalled();
    const empty = setup({ evidence: async () => [] });
    expect(await empty.responder.respond(request)).toEqual({ value: 'legacy' });
    expect(empty.decisionMaker).not.toHaveBeenCalled();
});

test('unavailable provider and missing API key delegate without exposing error details', async () => {
    for (const factory of [
        async () => {
            throw new Error('secret provider error');
        },
        async () => createDecisionMaker({ env: {} }),
    ]) {
        const warn = mock(() => {});
        const s = setup({ decisionMaker: factory, warn });
        expect(await s.responder.respond(request)).toEqual({ value: 'legacy' });
        expect(warn).toHaveBeenCalledWith('DecisionMaker unavailable; using the existing HITL responder.');
    }
});

test('uncertainty, defer and invalid labels delegate', async () => {
    for (const [label, confidence, probabilities] of [
        ['option_0', 0.6, { option_0: 0.6, option_1: 0.2, defer: 0.2 }],
        ['defer', 0.95, { option_0: 0.03, option_1: 0.02, defer: 0.95 }],
        ['option_99', 0.95, { option_99: 0.95 }],
    ] as [string, number, Record<string, number>][]) {
        const driver: DecisionDriver = {
            name: 'fake',
            ask: async () => ({ question: { kind: 'choice', label, confidence, probabilities } }),
        };
        const s = setup({ decisionMaker: async () => createDecisionMaker({ driver }) });
        expect(await s.responder.respond(request)).toEqual({ value: 'legacy' });
    }
});

test('running actions and malformed evidence never reach the provider', async () => {
    for (const bad of [
        { ...row, status: 'running' },
        { ...row, result_json: 'invalid json' },
    ]) {
        const s = setup({ evidence: async () => [bad] });
        expect(await s.responder.respond(request)).toEqual({ value: 'legacy' });
        expect(s.decisionMaker).not.toHaveBeenCalled();
    }
});

test('injected facades cannot bypass select bounds or inconsistent probabilities', async () => {
    for (const malformed of [
        { label: 'option_99', probabilities: { option_99: 0.95 } },
        { label: 'option_0', probabilities: { option_0: 0.95, option_1: 0.95, defer: 0 } },
        { label: 'option_0', probabilities: { option_0: 0.95, option_1: Number.NaN, defer: 0 } },
        { label: { toString: () => 'option_0' }, probabilities: { option_0: 0.95, option_1: 0.03, defer: 0.02 } },
    ]) {
        const s = setup({
            decisionMaker: async () =>
                ({
                    ...createDecisionMaker({ env: {} }),
                    choice: async () => ({ kind: 'choice', confidence: 0.95, ...malformed }),
                }) as unknown as DecisionMaker,
        });
        expect(await s.responder.respond(request)).toEqual({ value: 'legacy' });
    }
});
