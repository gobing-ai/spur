/**
 * Operator gates under every profile (task 1236, feature D65): interactively the operator
 * responder answers whatever the gate declares, `profile=auto` lets the declared binding answer
 * (evidence status, else the catalog decision), a degrading maker leaves the catalog default
 * recorded as a fallback, and `workflow validate` refuses a gate with no declared binding.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { ActionRunRow } from '@gobing-ai/spur-domain';
import type { ActionRunContext, HitlRequest, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import type { DecisionService } from '../../src/decision/decision-service';
import { HitlConfirmActionRunner } from '../../src/workflow/actions/hitl-confirm';
import { collectHitlDecisionViolations } from '../../src/workflow/composition-lint';
import {
    type DecisionConfig,
    type DecisionEvaluationDeps,
    type DecisionEvaluator,
    evaluateDecision,
    resolveDecision,
} from '../../src/workflow/decision-hitl-responder';

const CONFIRM: HitlRequest = { kind: 'confirm', prompt: 'Ship the batch?', runId: 'run-gate', node: 'approve-gate' };

const EVIDENCE: DecisionConfig = { mode: 'evidence', statusVar: 'gateStatus', evidenceNodes: ['build'] };

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

function gateDeps(rows = [producerRow()], service?: DecisionService): DecisionEvaluationDeps {
    const deps: DecisionEvaluationDeps = { enabled: true, evidence: async () => rows };
    if (service !== undefined) deps.decisionService = () => Promise.resolve(service);
    return deps;
}

/** A `gate-evidence` catalog answer: `source: 'model'` accepted, anything else is a served default. */
function catalogService(value: string, source: 'model' | 'default', reason: string): DecisionService {
    const served = {
        id: 'gate-evidence',
        type: 'choice',
        value,
        confidence: source === 'model' ? 0.93 : null,
        source,
        reason,
        maker: 'typesafe',
        durationMs: 3,
        makerSource: 'catalog-default',
    };
    return { decide: mock(async () => served) } as unknown as DecisionService;
}

/** An evaluator that counts calls, so "the operator was asked" is observable, not inferred. */
function countingEvaluator(deps: DecisionEvaluationDeps): { evaluator: DecisionEvaluator; calls: () => number } {
    let calls = 0;
    return {
        evaluator: {
            evaluate: (request, config) => {
                calls++;
                return evaluateDecision(request, config, deps);
            },
        },
        calls: () => calls,
    };
}

function operatorResponder(value = 'yes'): { respond: ReturnType<typeof mock> } {
    return { respond: mock(async () => ({ value })) };
}

function gateDef(states: unknown[]): WorkflowDef {
    return { kind: 'state-machine', name: 'profile-gates', version: '1', states } as unknown as WorkflowDef;
}

describe('task 1236 R1: the interactive profile delegates every gate to the operator', () => {
    test('an evidence gate prompts the operator and never reaches the evaluator', async () => {
        const responder = operatorResponder();
        const { evaluator, calls } = countingEvaluator(
            gateDeps([producerRow()], catalogService('yes', 'model', 'accepted')),
        );
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, EVIDENCE, 'standard');
        expect(responder.respond).toHaveBeenCalledTimes(1);
        expect(calls()).toBe(0);
        expect(resolved.answer).toEqual({ value: 'yes' });
        // No status var: the operator answered the gate itself, not the declared evidence binding.
        expect(resolved.statusVar).toBeUndefined();
        expect(resolved.provenance).toMatchObject({ mode: 'evidence', outcome: 'fallback', reason: 'operator' });
    });

    test('an undeclared profile is interactive, including for a legacy gate', async () => {
        const responder = operatorResponder();
        const { evaluator, calls } = countingEvaluator(gateDeps());
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, { mode: 'legacy' });
        expect(calls()).toBe(0);
        expect(resolved.provenance).toMatchObject({ mode: 'legacy', outcome: 'fallback', reason: 'operator' });
    });

    test('a never gate keeps its policy-never provenance and still prompts', async () => {
        const responder = operatorResponder();
        const { evaluator, calls } = countingEvaluator(gateDeps());
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, { mode: 'never' });
        expect(calls()).toBe(0);
        expect(resolved.answer).toEqual({ value: 'yes' });
        expect(resolved.provenance).toMatchObject({ mode: 'never', outcome: 'fallback', reason: 'policy-never' });
    });

    test('hitl.confirm reads the profile from the run vars', async () => {
        const { evaluator, calls } = countingEvaluator(
            gateDeps([producerRow()], catalogService('yes', 'model', 'accepted')),
        );
        const interactive = operatorResponder('no');
        const ctx = (profile: string): ActionRunContext => ({
            runId: 'r1',
            stateOrNodeId: 'approve-gate',
            workdir: '/tmp',
            vars: { profile },
            env: {},
        });

        const prompted = await new HitlConfirmActionRunner(interactive, evaluator).execute(
            { prompt: 'Ship it?', decision: { mode: 'evidence', statusVar: 'gateStatus', evidenceNodes: ['build'] } },
            ctx('standard'),
        );
        expect(calls()).toBe(0);
        expect(prompted.setVars).toEqual({ __hitlAnswer: 'no' });

        const decided = await new HitlConfirmActionRunner(operatorResponder('no'), evaluator).execute(
            { prompt: 'Ship it?', decision: { mode: 'evidence', statusVar: 'gateStatus', evidenceNodes: ['build'] } },
            ctx('auto'),
        );
        expect(calls()).toBe(1);
        expect(decided.setVars).toEqual({ __hitlAnswer: 'yes', gateStatus: 'accepted' });
    });
});

describe('task 1236 R2: profile=auto answers from the declared binding', () => {
    test('an accepted catalog answer writes the accepted status var', async () => {
        const responder = operatorResponder();
        const { evaluator } = countingEvaluator(gateDeps([producerRow()], catalogService('yes', 'model', 'accepted')));
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, EVIDENCE, 'auto');
        expect(responder.respond).not.toHaveBeenCalled();
        expect(resolved.answer).toEqual({ value: 'yes' });
        expect(resolved.statusVar).toBe('gateStatus');
        expect(resolved.statusValue).toBe('accepted');
        expect(resolved.provenance).toMatchObject({ mode: 'evidence', outcome: 'accepted', reason: 'accepted' });
    });

    test('no evidence for a declared producer defers the gate with the deferred status var', async () => {
        const responder = operatorResponder();
        const { evaluator } = countingEvaluator(gateDeps([], catalogService('yes', 'model', 'accepted')));
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, EVIDENCE, 'auto');
        expect(responder.respond).not.toHaveBeenCalled();
        expect(resolved.answer).toEqual({ value: '' });
        expect(resolved.statusValue).toBe('deferred');
        expect(resolved.provenance).toMatchObject({
            mode: 'evidence',
            outcome: 'deferred',
            reason: 'missing-evidence',
        });
    });

    test('a degrading maker applies the catalog default and the trace records the fallback', async () => {
        const responder = operatorResponder();
        const { evaluator } = countingEvaluator(
            gateDeps([producerRow()], catalogService('defer', 'default', 'low-confidence')),
        );
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, EVIDENCE, 'auto');
        expect(responder.respond).not.toHaveBeenCalled();
        expect(resolved.statusValue).toBe('deferred');
        // Fallback, not maker: the served default carries no confidence and its own reason.
        expect(resolved.provenance).toMatchObject({
            mode: 'evidence',
            outcome: 'fallback',
            reason: 'low-confidence',
            confidence: null,
        });
    });

    test('a never gate still prompts the operator under auto', async () => {
        const responder = operatorResponder();
        const { evaluator, calls } = countingEvaluator(gateDeps());
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, { mode: 'never' }, 'auto');
        expect(calls()).toBe(1);
        expect(responder.respond).toHaveBeenCalledTimes(1);
        expect(resolved.provenance).toMatchObject({ mode: 'never', outcome: 'fallback', reason: 'policy-never' });
    });
});

describe('task 1236 R3: workflow validate requires a declared binding', () => {
    test('rejects a confirm gate that declares no decision binding', () => {
        const violations = collectHitlDecisionViolations(
            gateDef([{ id: 'gate', onEnter: [{ kind: 'hitl.confirm', options: { prompt: 'p?' } }] }]),
        );
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('gate/hitl.confirm[0]');
        expect(violations[0]).toContain('no decision binding');
    });

    test('rejects an unbound select gate', () => {
        const violations = collectHitlDecisionViolations(
            gateDef([
                { id: 'pick', onEnter: [{ kind: 'hitl.select', options: { prompt: 'p?', options: ['a', 'b'] } }] },
            ]),
        );
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('pick/hitl.select[0]');
    });

    test('accepts mode: never while a workflow is unmigrated', () => {
        const violations = collectHitlDecisionViolations(
            gateDef([
                {
                    id: 'gate',
                    pause: true,
                    onEnter: [{ kind: 'hitl.confirm', options: { prompt: 'p?', decision: { mode: 'never' } } }],
                },
            ]),
        );
        expect(violations).toEqual([]);
    });

    test('requires no binding on hitl.input, which has no decision surface', () => {
        const violations = collectHitlDecisionViolations(
            gateDef([{ id: 'ask', onEnter: [{ kind: 'hitl.input', options: { prompt: 'p?' } }] }]),
        );
        expect(violations).toEqual([]);
    });
});
