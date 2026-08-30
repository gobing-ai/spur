import { describe, expect, test } from 'bun:test';
import type { WorkflowTripwireFiredEvent } from '../../src/workflow/observability';
import {
    CAPABILITY_BLOCK_PREFIX,
    evaluateTripWires,
    TRIPWIRE_CATALOG,
    TRIPWIRE_POLICY_IDS,
    type TripWireSignal,
} from '../../src/workflow/tripwire';

describe('trip-wire catalog (task 0708)', () => {
    test('catalog is closed: every policy id maps to a versioned entry with a next decision', () => {
        expect(TRIPWIRE_POLICY_IDS).toEqual([
            'retry-exhausted',
            'hard-budget',
            'capability-denied',
            'proof-invalidated',
            'output-drop',
        ]);
        for (const id of TRIPWIRE_POLICY_IDS) {
            const policy = TRIPWIRE_CATALOG[id];
            expect(policy.id).toBe(id);
            expect(policy.version).toBeGreaterThanOrEqual(1);
            expect(['fail', 'continue']).toContain(policy.response);
            expect(policy.nextDecision.length).toBeGreaterThan(0);
        }
    });

    test('fail policies stop the run; output-drop records and continues', () => {
        expect(TRIPWIRE_CATALOG['retry-exhausted'].response).toBe('fail');
        expect(TRIPWIRE_CATALOG['hard-budget'].response).toBe('fail');
        expect(TRIPWIRE_CATALOG['capability-denied'].response).toBe('fail');
        expect(TRIPWIRE_CATALOG['proof-invalidated'].response).toBe('fail');
        // Bounded-relay drop telemetry is evidence degradation for a completed
        // dispatch: failing healthy long-output runs would contradict the
        // "healthy result is unchanged" scenario.
        expect(TRIPWIRE_CATALOG['output-drop'].response).toBe('continue');
    });

    test('evaluation is deterministic: first signal wins, empty stays healthy', () => {
        const signals: TripWireSignal[] = [
            { policy: 'hard-budget', observed: 'maxTokens exceeded' },
            { policy: 'retry-exhausted', observed: 'attempt 3 of 2' },
        ];
        const decision = evaluateTripWires(signals);
        expect(decision.fired).toBe(true);
        expect(decision.policy?.id).toBe('hard-budget');
        expect(evaluateTripWires([])).toEqual({ fired: false });
        expect(evaluateTripWires(decision.policy ? signals : signals)).toEqual(decision);
    });

    test('unknown policy id fails closed instead of silently passing (R8)', () => {
        const decision = evaluateTripWires([
            { policy: 'zombie-signal' as TripWireSignal['policy'], observed: 'drifted emitter' },
        ]);
        expect(decision.fired).toBe(true);
        expect(decision.evaluationError).toBe('unknown-policy');
        expect(decision.reason).toContain('zombie-signal');
    });

    test('observed values are bounded', () => {
        const decision = evaluateTripWires([{ policy: 'output-drop', observed: 'x'.repeat(10_000) }]);
        expect((decision.observed ?? '').length).toBeLessThanOrEqual(513);
    });

    test('capability denial marker matches the attestation diagnostic prefix', () => {
        expect(CAPABILITY_BLOCK_PREFIX).toBe('agent dispatch blocked by capability attestation');
    });

    test('canonical event carries policy, correlation, threshold, and next decision (R4/R7)', () => {
        const decision = evaluateTripWires([
            {
                policy: 'proof-invalidated',
                observed: 'expected sha256:a, got sha256:b',
                threshold: 'expected sha256:a',
                evidenceRef: 'proof.fingerprint var=proofDigest',
            },
        ]);
        const event: WorkflowTripwireFiredEvent = {
            schemaVersion: 1,
            eventId: 'evt-1',
            runId: 'run-1',
            at: new Date().toISOString(),
            severity: 'warning',
            node: 'verify',
            kind: 'proof.fingerprint',
            policy: { id: decision.policy?.id ?? 'unknown', version: decision.policy?.version ?? 0 },
            response: decision.policy?.response ?? 'fail',
            observed: decision.observed ?? '',
            threshold: decision.threshold,
            actionId: 'run-1:verify',
            task: '0708',
            evidenceRefs: decision.evidenceRef ? [decision.evidenceRef] : [],
            nextDecision: decision.policy?.nextDecision ?? '',
        };
        expect(event.policy.id).toBe('proof-invalidated');
        expect(event.response).toBe('fail');
        expect(event.task).toBe('0708');
        expect(event.nextDecision).toContain('re-establish the verdict');
        expect(event.evidenceRefs).toEqual(['proof.fingerprint var=proofDigest']);
    });
});
