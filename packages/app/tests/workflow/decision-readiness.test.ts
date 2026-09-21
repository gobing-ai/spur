/** Offline DecisionMaker readiness projection (task 0911) and evidence digest determinism. */
import { describe, expect, test } from 'bun:test';
import { evidencePayloadDigest } from '../../src/workflow/decision-evidence';
import { computeDecisionReadiness } from '../../src/workflow/decision-readiness';

describe('computeDecisionReadiness', () => {
    test('projects the four offline states without probing', () => {
        expect(computeDecisionReadiness(false, false)).toMatchObject({
            enabled: false,
            state: 'disabled',
            connectivity: 'not-probed',
        });
        expect(computeDecisionReadiness(true, false).state).toBe('missing-key');
        expect(computeDecisionReadiness(true, true)).toMatchObject({
            enabled: true,
            state: 'configured-not-probed',
            credentialPresent: true,
            provider: 'typesafe',
            inlineSupport: 'defer-only',
        });
    });

    test('evidence digest is deterministic over the canonical payload', () => {
        expect(evidencePayloadDigest({ b: 1, a: 2 })).toBe(evidencePayloadDigest({ a: 2, b: 1 }));
        expect(evidencePayloadDigest({ a: 2 })).not.toBe(evidencePayloadDigest({ a: 3 }));
    });
});
