import { describe, expect, test } from 'bun:test';
import { type ExecutorLatencyStats, ladderScore, resolveAdaptiveTimeoutMs } from '../../src/services/adaptive-timeout';

// D3 (task 1323) R2/R3 policy: adaptive per-node dispatch budgets and the
// measured latency x success ladder score. Pure policy — the executor applies
// it, these tests pin what it computes.

const stats = (over: Partial<ExecutorLatencyStats> = {}): ExecutorLatencyStats => ({
    meanMs: 1000,
    p95Ms: undefined,
    samples: 10,
    successRate: 1,
    ...over,
});

describe('resolveAdaptiveTimeoutMs (1323 R2)', () => {
    test('no history degrades to the static YAML budget unchanged', () => {
        const decision = resolveAdaptiveTimeoutMs(600_000, undefined);
        expect(decision.source).toBe('static');
        expect(decision.appliedMs).toBe(600_000);
        expect(decision.fits).toBe(true);
    });

    test('no static budget and no history leaves the dispatch unbounded as today', () => {
        const decision = resolveAdaptiveTimeoutMs(undefined, undefined);
        expect(decision.source).toBe('static');
        expect(decision.appliedMs).toBeUndefined();
        expect(decision.fits).toBe(true);
    });

    test('a history-measured latency derives the budget when the node declares none', () => {
        // mean-only source: 3x mean covers the measured tail without p95 data.
        const decision = resolveAdaptiveTimeoutMs(undefined, stats({ meanMs: 100_000, samples: 12 }));
        expect(decision.source).toBe('derived-latency');
        expect(decision.appliedMs).toBe(300_000);
        expect(decision.fits).toBe(true);
    });

    test('a p95 measurement uses the tighter 1.5x headroom', () => {
        const decision = resolveAdaptiveTimeoutMs(undefined, stats({ meanMs: 100_000, p95Ms: 200_000 }));
        expect(decision.source).toBe('derived-latency');
        expect(decision.appliedMs).toBe(300_000);
    });

    test('the derived budget never shrinks a declared YAML budget that the executor fits', () => {
        // Executor comfortably fits (derived 30s — 3s of headroom lifted by the
        // 30s floor — < static 600s): the operator budget stays — shrinking
        // healthy budgets only regresses success.
        const decision = resolveAdaptiveTimeoutMs(600_000, stats({ meanMs: 1000 }));
        expect(decision.source).toBe('static');
        expect(decision.appliedMs).toBe(600_000);
        expect(decision.fits).toBe(true);
        expect(decision.derivedMs).toBe(30_000);
    });

    test('measured latency beyond the static cap is marked timeout-exhausted under the hard cap', () => {
        // YAML is operator intent (hard cap): the budget cannot grow past it, so
        // the executor is marked as one that cannot fit — the ladder failovers.
        const decision = resolveAdaptiveTimeoutMs(1000, stats({ meanMs: 5000, samples: 12 }));
        expect(decision.fits).toBe(false);
        expect(decision.appliedMs).toBe(1000);
        // 15s of headroom, lifted to the 30s derived floor — still far beyond the cap.
        expect(decision.derivedMs).toBe(30_000);
        expect(decision.staticMs).toBe(1000);
    });

    test('an empty history (zero samples) is not evidence — static behavior applies', () => {
        const decision = resolveAdaptiveTimeoutMs(600_000, stats({ samples: 0 }));
        expect(decision.source).toBe('static');
        expect(decision.appliedMs).toBe(600_000);
        expect(decision.fits).toBe(true);
    });
});

describe('ladderScore (1323 R3)', () => {
    test('lower measured latency and higher success rate score better (lower)', () => {
        const fastReliable = ladderScore(stats({ meanMs: 1000, successRate: 0.99 }));
        const slowFlaky = ladderScore(stats({ meanMs: 9000, successRate: 0.4 }));
        expect(fastReliable).toBeLessThan(slowFlaky);
    });

    test('success rate is clamped so a broken executor cannot rank by latency alone', () => {
        const zeroSuccess = ladderScore(stats({ meanMs: 1000, successRate: 0 }));
        const halfSuccess = ladderScore(stats({ meanMs: 1000, successRate: 0.5 }));
        expect(zeroSuccess).toBeGreaterThan(halfSuccess);
    });
});
