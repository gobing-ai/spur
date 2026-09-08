/**
 * Task 0799: trusted-shape schemas for `agent.quota.*` payloads and the
 * exact executor-binding lookup used by the durable consumer.
 */

import { describe, expect, test } from 'bun:test';
import {
    agentQuotaObservationSchema,
    agentQuotaRecoverySchema,
    normalizeQuotaTimestamp,
    type QuotaExecutorProfileBinding,
    resolveQuotaExecutorBinding,
} from '../src/agent-quota-events';

const validObservation = {
    observationId: 'obs-1',
    observedAt: '2026-02-01T10:00:00.000Z',
    evidenceSource: 'buffered-error',
    reason: 'usage_limit_reached',
    attribution: { projectId: '/repo', executor: 'alpha', agent: 'omp', model: 'gpt-5' },
    correlation: { runId: 'run-1' },
};

describe('agent-quota-events (0799)', () => {
    test('accepts a well-formed exhaustion observation and rejects unknown fields', () => {
        expect(agentQuotaObservationSchema.safeParse(validObservation).success).toBe(true);
        expect(agentQuotaObservationSchema.safeParse({ ...validObservation, extra: true }).success).toBe(false);
        expect(agentQuotaObservationSchema.safeParse({ ...validObservation, reason: 'something-else' }).success).toBe(
            false,
        );
        expect(agentQuotaObservationSchema.safeParse({ ...validObservation, observationId: '' }).success).toBe(false);
    });

    test('accepts a recovery payload; attribution and correlation stay optional', () => {
        expect(
            agentQuotaRecoverySchema.safeParse({ observationId: 'obs-1', recoveredAt: '2026-02-01T11:00:00.000Z' })
                .success,
        ).toBe(true);
        expect(
            agentQuotaRecoverySchema.safeParse({
                observationId: 'obs-1',
                recoveredAt: '2026-02-01T11:00:00.000Z',
                attribution: { projectId: '/repo', executor: 'alpha' },
            }).success,
        ).toBe(true);
    });

    test('normalizeQuotaTimestamp normalizes to UTC ISO ms and rejects unparsable input', () => {
        expect(normalizeQuotaTimestamp('2026-02-01T02:00:00-08:00')).toBe('2026-02-01T10:00:00.000Z');
        expect(normalizeQuotaTimestamp('2026-02-01T10:00:00Z')).toBe('2026-02-01T10:00:00.000Z');
        expect(normalizeQuotaTimestamp('not-a-date')).toBeUndefined();
    });

    test('resolveQuotaExecutorBinding matches exactly and returns undefined for unknown names', () => {
        const executors: QuotaExecutorProfileBinding[] = [
            { name: 'alpha', agent: 'omp', model: 'gpt-5' },
            { name: 'beta', agent: 'claude' },
        ];
        expect(resolveQuotaExecutorBinding(executors, 'alpha')?.model).toBe('gpt-5');
        expect(resolveQuotaExecutorBinding(executors, 'Alpha')).toBeUndefined();
        expect(resolveQuotaExecutorBinding(executors, 'ghost')).toBeUndefined();
        expect(resolveQuotaExecutorBinding(undefined, 'alpha')).toBeUndefined();
    });
});
