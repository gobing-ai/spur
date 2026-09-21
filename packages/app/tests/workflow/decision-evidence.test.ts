/**
 * DecisionMaker decision policy (task 0911): parser contract, evidence selection and summary
 * envelope invariants, evaluator policy branches, HITL resolution semantics (status vars,
 * cleared answers), the workflow validation walker, and offline readiness projection.
 */
import { describe, expect, mock, test } from 'bun:test';
import type { ActionRunRow } from '@gobing-ai/spur-domain';
import { createDecisionMaker } from '@gobing-ai/ts-ai-runner';
import type { HitlRequest, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { collectHitlDecisionViolations } from '../../src/services/workflow-service';
import { validateEvidenceChoices } from '../../src/workflow/actions/hitl-select';
import { MAX_EVIDENCE_ROWS, parseSummaryEnvelope, selectEvidence } from '../../src/workflow/decision-evidence';
import {
    type DecisionConfig,
    type DecisionEvaluationDeps,
    type DecisionEvaluator,
    evaluateDecision,
    parseDecisionConfig,
    resolveDecision,
} from '../../src/workflow/decision-hitl-responder';

const CONFIRM: HitlRequest = { kind: 'confirm', prompt: 'ok?', runId: 'run1', node: 'decide' };

function producerRow(overrides: Partial<ActionRunRow> = {}): ActionRunRow {
    return {
        id: 'a1',
        node: 'test',
        kind: 'shell',
        status: 'done',
        ok: 1,
        duration_ms: 1,
        result_json: JSON.stringify({ data: { stdout: '10 passed' } }),
        started_at: null,
        completed_at: '2026-01-01T00:00:00Z',
        created_at: 0,
        ...overrides,
    };
}

const identityCleaner = (text: string, limit = 2000) => text.slice(0, limit);

describe('parseDecisionConfig', () => {
    test('omitted decision parses as legacy', () => {
        expect(parseDecisionConfig({ prompt: 'ok?' }, '__hitlAnswer', 'confirm')).toEqual({
            ok: true,
            config: { mode: 'legacy' },
        });
    });

    test('rejects non-object decision and hitl.input', () => {
        expect(parseDecisionConfig({ decision: 'never' }, '__hitlAnswer', 'confirm').ok).toBe(false);
        expect(parseDecisionConfig({ decision: { mode: 'never' } }, '__hitlAnswer', 'input').ok).toBe(false);
    });

    test('rejects unknown keys, unknown modes, and evidence options on never', () => {
        expect(parseDecisionConfig({ decision: { mode: 'never', statusVar: 'x' } }, 'v', 'confirm').ok).toBe(false);
        expect(parseDecisionConfig({ decision: { mode: 'sometimes' } }, 'v', 'confirm').ok).toBe(false);
        expect(parseDecisionConfig({ decision: { mode: 'evidence', bogus: 1 } }, 'v', 'confirm').ok).toBe(false);
    });

    test('evidence requires statusVar identifier distinct from the answer var and non-empty producers', () => {
        expect(parseDecisionConfig({ decision: { mode: 'evidence' } }, 'v', 'confirm').ok).toBe(false);
        expect(
            parseDecisionConfig(
                { decision: { mode: 'evidence', statusVar: '__hitlAnswer', evidenceNodes: ['a'] } },
                '__hitlAnswer',
                'confirm',
            ).ok,
        ).toBe(false);
        expect(
            parseDecisionConfig({ decision: { mode: 'evidence', statusVar: 's', evidenceNodes: [] } }, 'v', 'confirm')
                .ok,
        ).toBe(false);
        expect(
            parseDecisionConfig(
                { decision: { mode: 'evidence', statusVar: 's', evidenceNodes: ['a', 'a'] } },
                'v',
                'confirm',
            ).ok,
        ).toBe(false);
        const parsed = parseDecisionConfig(
            {
                decision: {
                    mode: 'evidence',
                    statusVar: 'decisionStatus',
                    evidenceNodes: ['assess'],
                    summaryArtifact: 's.md',
                },
            },
            '__hitlAnswer',
            'select',
        );
        expect(parsed).toEqual({
            ok: true,
            config: {
                mode: 'evidence',
                statusVar: 'decisionStatus',
                evidenceNodes: ['assess'],
                summaryArtifact: 's.md',
            },
        });
    });
});

describe('selectEvidence', () => {
    test('more producers than the row cap rejects instead of truncating', () => {
        const producers = Array.from({ length: MAX_EVIDENCE_ROWS + 1 }, (_, i) => `n${i}`);
        expect(selectEvidence([], producers, identityCleaner)).toEqual({ ok: false, reason: 'oversized-evidence' });
    });

    test('missing producer row rejects as missing-evidence', () => {
        expect(selectEvidence([producerRow()], ['ghost'], identityCleaner)).toEqual({
            ok: false,
            reason: 'missing-evidence',
        });
    });

    test('in-flight producer attempt defers as stale-evidence', () => {
        expect(selectEvidence([producerRow({ status: 'running', ok: null })], ['test'], identityCleaner)).toEqual({
            ok: false,
            reason: 'stale-evidence',
        });
    });

    test('two completed attempts sharing a timestamp defer as invalid-evidence', () => {
        const rows = [producerRow({ id: 'a1' }), producerRow({ id: 'a2' })];
        expect(selectEvidence(rows, ['test'], identityCleaner)).toEqual({ ok: false, reason: 'invalid-evidence' });
    });

    test('selects the latest completed attempt with projected bounded outcome fields', () => {
        const rows = [
            producerRow({
                id: 'older',
                completed_at: '2025-12-31T00:00:00Z',
                result_json: JSON.stringify({ data: { stdout: 'old' } }),
            }),
            producerRow(),
        ];
        const selection = selectEvidence(rows, ['test'], identityCleaner);
        if (!selection.ok) throw new Error('expected selection');
        expect(selection.rows).toHaveLength(1);
        expect(selection.rows[0]?.actionId).toBe('a1');
        expect(selection.rows[0]?.result).toBe('10 passed');
        expect(selection.actionIds).toEqual(['a1']);
    });
});

describe('parseSummaryEnvelope', () => {
    const selected = selectEvidence([producerRow()], ['test'], identityCleaner);
    if (!selected.ok) throw new Error('fixture selection failed');
    const envelope = (overrides: Record<string, unknown> = {}) =>
        JSON.stringify({
            schemaVersion: 1,
            runId: 'run1',
            producerNode: 'test',
            producerActionId: 'a1',
            summary: '10 passed',
            ...overrides,
        });

    test('happy path returns the verified summary', () => {
        expect(parseSummaryEnvelope(envelope(), 'run1', ['test'], selected.rows, identityCleaner)).toEqual({
            ok: true,
            summary: '10 passed',
        });
    });

    test('oversized, malformed, and wrong-schema envelopes reject', () => {
        expect(
            parseSummaryEnvelope('x'.repeat(8 * 1024 + 1), 'run1', ['test'], selected.rows, identityCleaner),
        ).toEqual({
            ok: false,
            reason: 'oversized-evidence',
        });
        expect(parseSummaryEnvelope('not-json', 'run1', ['test'], selected.rows, identityCleaner)).toEqual({
            ok: false,
            reason: 'invalid-evidence',
        });
        expect(
            parseSummaryEnvelope(envelope({ schemaVersion: 2 }), 'run1', ['test'], selected.rows, identityCleaner),
        ).toEqual({
            ok: false,
            reason: 'invalid-evidence',
        });
    });

    test('stale run, unknown producer, stale action, and divergent summary reject', () => {
        expect(
            parseSummaryEnvelope(envelope({ runId: 'run2' }), 'run1', ['test'], selected.rows, identityCleaner),
        ).toEqual({
            ok: false,
            reason: 'stale-evidence',
        });
        expect(
            parseSummaryEnvelope(envelope({ producerNode: 'ghost' }), 'run1', ['test'], selected.rows, identityCleaner),
        ).toEqual({
            ok: false,
            reason: 'invalid-evidence',
        });
        expect(
            parseSummaryEnvelope(
                envelope({ producerActionId: 'a9' }),
                'run1',
                ['test'],
                selected.rows,
                identityCleaner,
            ),
        ).toEqual({
            ok: false,
            reason: 'stale-evidence',
        });
        expect(
            parseSummaryEnvelope(envelope({ summary: 'divergent' }), 'run1', ['test'], selected.rows, identityCleaner),
        ).toEqual({
            ok: false,
            reason: 'stale-evidence',
        });
    });
});

describe('evaluateDecision policy branches', () => {
    const fakeChoiceMaker = () =>
        mock(async () =>
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
            }),
        );

    test('never mode always delegates to the human with policy-never provenance', async () => {
        const decisionMaker = fakeChoiceMaker();
        const result = await evaluateDecision(
            CONFIRM,
            { mode: 'never' },
            { enabled: true, evidence: async () => [], decisionMaker },
        );
        expect(result.kind).toBe('delegate');
        expect(result.provenance.mode).toBe('never');
        expect(result.provenance.reason).toBe('policy-never');
        expect(decisionMaker).not.toHaveBeenCalled();
    });

    test('evidence mode with DecisionMaker disabled defers without provider calls', async () => {
        const result = await evaluateDecision(
            CONFIRM,
            { mode: 'evidence', statusVar: 's', evidenceNodes: ['test'] },
            { enabled: false, evidence: async () => [producerRow()] },
        );
        expect(result.kind).toBe('deferred');
        expect(result.provenance.reason).toBe('disabled');
    });

    test('legacy mode with DecisionMaker disabled delegates like 0910', async () => {
        const result = await evaluateDecision(
            CONFIRM,
            { mode: 'legacy' },
            { enabled: false, evidence: async () => [] },
        );
        expect(result.kind).toBe('delegate');
        expect(result.provenance.mode).toBe('legacy');
    });

    test('evidence accept path carries provenance and digest over verified evidence', async () => {
        const summary = JSON.stringify({
            schemaVersion: 1,
            runId: 'run1',
            producerNode: 'test',
            producerActionId: 'a1',
            summary: '10 passed',
        });
        const decisionMaker = fakeChoiceMaker();
        const deps: DecisionEvaluationDeps = {
            enabled: true,
            evidence: async () => [producerRow()],
            summary: { resolve: async () => ({ ok: true, artifactId: 'art1', raw: summary }) },
            decisionMaker,
        };
        const request: HitlRequest = {
            kind: 'select',
            prompt: 'route?',
            options: ['tutorial', 'reference'],
            runId: 'run1',
            node: 'decide',
        };
        const config = {
            mode: 'evidence' as const,
            statusVar: 'decisionStatus',
            evidenceNodes: ['test'],
            summaryArtifact: 's.md',
        };
        const result = await evaluateDecision(request, config, deps);
        expect(result.kind).toBe('accepted');
        if (result.kind !== 'accepted') return;
        expect(result.value).toBe('tutorial');
        expect(result.provenance.mode).toBe('evidence');
        expect(result.provenance.outcome).toBe('accepted');
        expect(result.provenance.evidenceActionIds).toEqual(['a1']);
        expect(result.provenance.artifactId).toBe('art1');
        expect(result.provenance.evidenceDigest).toMatch(/^sha256:/);
    });

    test('evidence mode defers when the request exposes fewer than two choices', async () => {
        const result = await evaluateDecision(
            { kind: 'select', prompt: 'route?', options: ['only'], runId: 'run1', node: 'decide' },
            { mode: 'evidence', statusVar: 's', evidenceNodes: ['test'] },
            { enabled: true, evidence: async () => [producerRow()] },
        );
        expect(result.kind).toBe('deferred');
        expect(result.provenance.reason).toBe('invalid-evidence');
    });

    test('evidence mode defers when the declared summary artifact cannot be resolved', async () => {
        const result = await evaluateDecision(
            { kind: 'select', prompt: 'route?', options: ['a', 'b'], runId: 'run1', node: 'decide' },
            { mode: 'evidence', statusVar: 's', evidenceNodes: ['test'], summaryArtifact: 'gone.md' },
            {
                enabled: true,
                evidence: async () => [producerRow()],
                summary: { resolve: async () => ({ ok: false, reason: 'missing-evidence' }) },
            },
        );
        expect(result.kind).toBe('deferred');
        expect(result.provenance.reason).toBe('missing-evidence');
    });

    test('resolveDecision writes status vars and clears the answer var on evidence defer', async () => {
        const responder = { respond: mock(async () => ({ value: 'human' })) };
        const evaluator = {
            evaluate: (request: HitlRequest, config: DecisionConfig) =>
                evaluateDecision(request, config, { enabled: true, evidence: async () => [] }),
        } satisfies DecisionEvaluator;
        const resolved = await resolveDecision(responder, evaluator, CONFIRM, {
            mode: 'evidence',
            statusVar: 'decisionStatus',
            evidenceNodes: ['test'],
        });
        expect(resolved.answer).toEqual({ value: '' });
        expect(resolved.statusVar).toBe('decisionStatus');
        expect(resolved.statusValue).toBe('deferred');
        expect(responder.respond).not.toHaveBeenCalled();
    });
});

describe('collectHitlDecisionViolations', () => {
    const def = (states: unknown[]): WorkflowDef =>
        ({ kind: 'state-machine', name: 't', version: '1', states }) as unknown as WorkflowDef;

    test('accepts legacy and never actions without violations', () => {
        const violations = collectHitlDecisionViolations(
            def([
                {
                    id: 'gate',
                    pause: true,
                    onEnter: [{ kind: 'hitl.confirm', options: { prompt: 'p?', decision: { mode: 'never' } } }],
                },
                { id: 'other', onEnter: [{ kind: 'hitl.confirm', options: { prompt: 'p?' } }] },
            ]),
        );
        expect(violations).toEqual([]);
    });

    test('rejects decision on hitl.input and unknown decision shapes', () => {
        const violations = collectHitlDecisionViolations(
            def([{ id: 'ask', onEnter: [{ kind: 'hitl.input', options: { decision: { mode: 'never' } } }] }]),
        );
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('only supported on hitl.confirm and hitl.select');
    });

    test('rejects evidence mode in pause=true states', () => {
        const violations = collectHitlDecisionViolations(
            def([
                {
                    id: 'gate',
                    pause: true,
                    onEnter: [
                        {
                            kind: 'hitl.confirm',
                            options: {
                                decision: { mode: 'evidence', statusVar: 's', evidenceNodes: ['gate'] },
                            },
                        },
                    ],
                },
            ]),
        );
        expect(violations.some((v) => v.includes('pause=true'))).toBe(true);
    });

    test('rejects multiple evidence actions in one state and unknown producer nodes', () => {
        const violations = collectHitlDecisionViolations(
            def([
                {
                    id: 'decide',
                    onEnter: [
                        {
                            kind: 'hitl.select',
                            options: {
                                options: ['a', 'b'],
                                decision: { mode: 'evidence', statusVar: 's1', evidenceNodes: ['ghost'] },
                            },
                        },
                        {
                            kind: 'hitl.confirm',
                            options: { decision: { mode: 'evidence', statusVar: 's2', evidenceNodes: ['decide'] } },
                        },
                    ],
                },
            ]),
        );
        expect(violations.some((v) => v.includes('At most one evidence-mode action'))).toBe(true);
        expect(violations.some((v) => v.includes('Unknown producer node(s)'))).toBe(true);
    });

    test('rejects evidence-select choices violating the invariants', () => {
        const violations = collectHitlDecisionViolations(
            def([
                {
                    id: 'decide',
                    onEnter: [
                        {
                            kind: 'hitl.select',
                            options: {
                                options: ['only'],
                                decision: { mode: 'evidence', statusVar: 's', evidenceNodes: ['decide'] },
                            },
                        },
                    ],
                },
            ]),
        );
        expect(violations.some((v) => v.includes('decide/hitl.select[0]'))).toBe(true);
    });

    test('validates the same choice key and normalization the runtime runner reads', () => {
        // A wrong key (`choices` instead of `options`) leaves the runner with no choices at run
        // time, so validation must never accept it: the walker reads `options.options` too.
        const wrongKey = collectHitlDecisionViolations(
            def([
                {
                    id: 'decide',
                    onEnter: [
                        {
                            kind: 'hitl.select',
                            options: {
                                choices: ['a', 'b'],
                                decision: { mode: 'evidence', statusVar: 's', evidenceNodes: ['decide'] },
                            },
                        },
                    ],
                },
            ]),
        );
        expect(wrongKey.some((v) => v.includes('at least two options'))).toBe(true);

        const emptyChoice = collectHitlDecisionViolations(
            def([
                {
                    id: 'decide',
                    onEnter: [
                        {
                            kind: 'hitl.select',
                            options: {
                                options: ['a', ''],
                                decision: { mode: 'evidence', statusVar: 's', evidenceNodes: ['decide'] },
                            },
                        },
                    ],
                },
            ]),
        );
        expect(emptyChoice.some((v) => v.includes('non-empty'))).toBe(true);
    });
});

describe('validateEvidenceChoices', () => {
    test('enforces the evidence invariants', () => {
        expect(validateEvidenceChoices(['a', 'b'])).toBeNull();
        expect(validateEvidenceChoices(['only'])).toContain('two');
        expect(validateEvidenceChoices(['a', 'a'])).toContain('distinct');
        expect(validateEvidenceChoices(['a', ''])).toContain('empty');
        expect(validateEvidenceChoices(['a', 'defer'])).toContain('defer');
    });
});
