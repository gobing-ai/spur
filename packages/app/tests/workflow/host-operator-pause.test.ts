/**
 * Unanswered operator pauses on host runs (task 1248, feature D66 R10).
 *
 * On `executor=host` there is no in-process operator: the CLI's default responder answers
 * confirm `no` and an evidence defer clears the answer to `''`, so the gate fell through to a
 * downstream default-deny shell and the run ended cancelled with no pause. A `HitlResponder`
 * cannot suspend, so the pause lives in the action runners' `ActionResult.pause` — the same
 * seam `agent.run` host dispatch uses — and `operatorPauseAt` reads it back on the resume side.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { ActionRunContext, HitlRequest, HitlResponder, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { HitlConfirmActionRunner } from '../../src/workflow/actions/hitl-confirm';
import { HitlInputActionRunner } from '../../src/workflow/actions/hitl-input';
import { HitlSelectActionRunner } from '../../src/workflow/actions/hitl-select';
import type { DecisionConfig, DecisionEvaluator } from '../../src/workflow/decision-hitl-responder';
import { operatorPauseAt } from '../../src/workflow/host-executor';

/** The default responder the CLI picks on a non-TTY `--json` run: confirm/select answer `no`. */
function denyResponder(value = 'no'): HitlResponder & { respond: ReturnType<typeof mock> } {
    return { respond: mock(async () => ({ value })) };
}

function ctx(vars: Record<string, string> = {}): ActionRunContext {
    return { runId: 'run-1248', stateOrNodeId: 'gate', workdir: '/tmp', vars, env: {} };
}

/** An evaluator that answers (`accepted`) or defers, so both auto outcomes are observable. */
function evaluator(outcome: 'accepted' | 'deferred'): DecisionEvaluator {
    return {
        evaluate: async (_request: HitlRequest, config: DecisionConfig) => {
            const provenance = {
                mode: config.mode,
                outcome,
                reason: outcome === 'accepted' ? 'accepted' : 'missing-evidence',
                confidence: null,
                evidenceCount: 0,
            };
            return outcome === 'accepted'
                ? { kind: 'accepted', value: 'yes', provenance }
                : { kind: 'deferred', provenance };
        },
    } as unknown as DecisionEvaluator;
}

const EVIDENCE = { mode: 'evidence', statusVar: 'gateStatus', evidenceNodes: ['build'] };

describe('task 1248 R1: an unanswered operator gate pauses the host run', () => {
    test('hitl.confirm pauses with its question instead of taking the default no', async () => {
        const responder = denyResponder();
        const result = await new HitlConfirmActionRunner(responder).execute(
            { prompt: 'Approve the idea?', decision: { mode: 'never' } },
            ctx({ executor: 'host' }),
        );
        expect(result.ok).toBe(true);
        expect(result.pause).toBe(true);
        expect(result.data).toEqual({
            surface: 'host',
            reason: 'hitl-pause',
            kind: 'confirm',
            prompt: 'Approve the idea?',
        });
        // The answer var stays unset: `continue --answer` is the only source of the answer.
        expect(result.setVars).toBeUndefined();
        expect(responder.respond).not.toHaveBeenCalled();
    });

    test('hitl.select pauses without consulting the responder', async () => {
        const responder = denyResponder('alpha');
        const result = await new HitlSelectActionRunner(responder).execute(
            { prompt: 'Pick one', options: ['alpha', 'beta'], decision: { mode: 'never' } },
            ctx({ executor: 'host' }),
        );
        expect(result.pause).toBe(true);
        expect(result.data).toMatchObject({ kind: 'select', prompt: 'Pick one' });
        expect(result.setVars).toBeUndefined();
        expect(responder.respond).not.toHaveBeenCalled();
    });

    test('hitl.input pauses before the responder can invent a value', async () => {
        const responder = denyResponder('');
        const result = await new HitlInputActionRunner(responder).execute(
            { prompt: 'Describe the change' },
            ctx({ executor: 'host' }),
        );
        expect(result.pause).toBe(true);
        expect(result.data).toMatchObject({ kind: 'input', prompt: 'Describe the change' });
        expect(result.setVars).toBeUndefined();
        expect(responder.respond).not.toHaveBeenCalled();
    });

    test('a deferred profile=auto gate pauses and sets ONLY the decision status var', async () => {
        const result = await new HitlConfirmActionRunner(denyResponder(), evaluator('deferred')).execute(
            { prompt: 'Ship it?', decision: EVIDENCE },
            ctx({ executor: 'host', profile: 'auto' }),
        );
        expect(result.pause).toBe(true);
        expect(result.setVars).toEqual({ gateStatus: 'deferred' });
    });
});

describe('task 1248 R4: non-host and auto-answered runs are unchanged', () => {
    test('a headless non-host confirm still records the default no', async () => {
        const responder = denyResponder();
        const result = await new HitlConfirmActionRunner(responder).execute(
            { prompt: 'Approve?', decision: { mode: 'never' } },
            ctx(),
        );
        expect(result.pause).toBeUndefined();
        expect(result.setVars).toEqual({ __hitlAnswer: 'no' });
        expect(responder.respond).toHaveBeenCalledTimes(1);
    });

    test('an unset executor never pauses, even with a deferring binding', async () => {
        const result = await new HitlConfirmActionRunner(denyResponder(), evaluator('deferred')).execute(
            { prompt: 'Ship it?', decision: EVIDENCE },
            ctx({ profile: 'auto' }),
        );
        expect(result.pause).toBeUndefined();
        expect(result.setVars).toEqual({ __hitlAnswer: '', gateStatus: 'deferred' });
    });

    test('an accepted profile=auto binding answers a host run without pausing', async () => {
        const responder = denyResponder();
        const result = await new HitlConfirmActionRunner(responder, evaluator('accepted')).execute(
            { prompt: 'Ship it?', decision: EVIDENCE },
            ctx({ executor: 'host', profile: 'auto' }),
        );
        expect(result.pause).toBeUndefined();
        expect(result.setVars).toEqual({ __hitlAnswer: 'yes', gateStatus: 'accepted' });
        expect(responder.respond).not.toHaveBeenCalled();
    });

    test('a non-host executor (fleet) keeps the responder answer', async () => {
        const result = await new HitlConfirmActionRunner(denyResponder('yes')).execute(
            { prompt: 'Approve?', decision: { mode: 'never' } },
            ctx({ executor: 'fleet' }),
        );
        expect(result.pause).toBeUndefined();
        expect(result.setVars).toEqual({ __hitlAnswer: 'yes' });
    });
});

describe('task 1248 R3: operatorPauseAt classifies the paused action', () => {
    const def = (actions: unknown[]): WorkflowDef =>
        ({
            kind: 'state-machine',
            name: 'gate-pause',
            version: '1',
            states: [{ id: 'gate', onEnter: actions }],
        }) as unknown as WorkflowDef;

    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal workflow-template placeholder the engine interpolates, not a JS template
    const GATE = { kind: 'hitl.confirm', options: { prompt: 'Approve ${vars.wbs}?' } };
    const SHELL = { kind: 'shell', options: { command: 'true' } };

    test('resolves the gate at nextAction - 1 with its prompt templated from the snapshot vars', () => {
        const gate = operatorPauseAt(def([GATE, SHELL]), 'gate', {
            actionResume: { phase: 'enter', nextAction: 1 },
            effectiveVars: { wbs: '1248' },
        });
        expect(gate).toEqual({ kind: 'hitl.confirm', options: GATE.options, prompt: 'Approve 1248?' });
    });

    test('a cursor on a non-gate action is not an operator pause', () => {
        expect(operatorPauseAt(def([SHELL, GATE]), 'gate', { actionResume: { phase: 'enter', nextAction: 1 } })).toBe(
            null,
        );
    });

    test('a declared state pause persists no cursor, so it is not an operator pause', () => {
        expect(operatorPauseAt(def([GATE]), 'gate', { transitionsTaken: 1 })).toBe(null);
    });

    test('an unknown state or an out-of-range cursor is not an operator pause', () => {
        expect(operatorPauseAt(def([GATE]), 'other', { actionResume: { nextAction: 1 } })).toBe(null);
        expect(operatorPauseAt(def([GATE]), 'gate', { actionResume: { nextAction: 0 } })).toBe(null);
        expect(operatorPauseAt(def([GATE]), 'gate', undefined)).toBe(null);
    });

    test('reads a transition-flow node action', () => {
        const flow = {
            kind: 'transition-flow',
            name: 'flow',
            version: '1',
            nodes: [{ id: 'ask', action: { kind: 'hitl.input', options: { prompt: 'Why?' } } }],
        } as unknown as WorkflowDef;
        expect(operatorPauseAt(flow, 'ask', { actionResume: { nextAction: 1 } })).toMatchObject({
            kind: 'hitl.input',
            prompt: 'Why?',
        });
    });
});
