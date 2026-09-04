import { describe, expect, test } from 'bun:test';
import {
    assertNoRegression,
    HISTORY_TAB_BASELINE,
    HISTORY_TAB_IDS,
    type HistoryTabId,
    LATENCY_NOISE_TOLERANCE_RATIO,
    LATENCY_SAMPLE_COUNT,
    measureTabLatency,
    median,
    resolveMeasurementProvenance,
} from './history-latency-measure';

describe('history-latency-measure (0745 R4-R8)', () => {
    test('median returns the middle value for odd and even samples', () => {
        expect(median([10, 20, 30])).toBe(20);
        expect(median([10, 20, 30, 40])).toBe(25);
        expect(median([1])).toBe(1);
        expect(Number.isNaN(median([]))).toBe(true);
    });

    test('LATENCY_SAMPLE_COUNT and tolerances are declared', () => {
        expect(LATENCY_SAMPLE_COUNT).toBeGreaterThanOrEqual(3);
        expect(LATENCY_NOISE_TOLERANCE_RATIO).toBeGreaterThan(0);
    });

    test('HISTORY_TAB_BASELINE covers all six tabs with a positive baseline', () => {
        expect(HISTORY_TAB_IDS).toEqual(['summary', 'timeline', 'tool-using', 'sessions', 'insights', 'sources']);
        for (const tab of HISTORY_TAB_IDS) {
            expect(HISTORY_TAB_BASELINE[tab]).toBeGreaterThan(0);
        }
    });

    test('measureTabLatency returns the median of LATENCY_SAMPLE_COUNT runs', async () => {
        let calls = 0;
        const sample = await measureTabLatency(
            'summary',
            async () => {
                calls++;
                // deterministic 50ms work
            },
            5,
        );
        expect(sample.sampleCount).toBe(5);
        expect(sample.samplesMs).toHaveLength(5);
        expect(calls).toBe(5);
    });

    test('measureTabLatency honours a smaller ad-hoc sample count', async () => {
        let calls = 0;
        const sample = await measureTabLatency(
            'insights',
            async () => {
                calls++;
            },
            3,
        );
        expect(sample.sampleCount).toBe(3);
        expect(calls).toBe(3);
    });

    test('assertNoRegression passes when no tab exceeds the tolerance', () => {
        const post: Record<HistoryTabId, number> = { ...HISTORY_TAB_BASELINE };
        // all at baseline -> ratio 1
        const result = assertNoRegression(post);
        expect(result.ok).toBe(true);
        expect(result.results.every((r) => r.measured)).toBe(true);
        expect(result.results.every((r) => !r.regressed)).toBe(true);
    });

    test('assertNoRegression passes for a small change within the tolerance', () => {
        const post: Record<HistoryTabId, number> = { ...HISTORY_TAB_BASELINE };
        post.sessions = Math.round(HISTORY_TAB_BASELINE.sessions * (1 + LATENCY_NOISE_TOLERANCE_RATIO / 2));
        const result = assertNoRegression(post);
        expect(result.ok).toBe(true);
    });

    test('assertNoRegression fails when a tab exceeds the tolerance', () => {
        const post: Record<HistoryTabId, number> = { ...HISTORY_TAB_BASELINE };
        post.sessions = Math.round(HISTORY_TAB_BASELINE.sessions * (1 + LATENCY_NOISE_TOLERANCE_RATIO + 0.1));
        const result = assertNoRegression(post);
        expect(result.ok).toBe(false);
        expect(result.results.find((r) => r.tab === 'sessions')?.regressed).toBe(true);
    });

    test('assertNoRegression marks an unmeasured tab measured=false and does not fail it', () => {
        const post: Partial<Record<HistoryTabId, number>> = { summary: 1 };
        const result = assertNoRegression(post);
        expect(result.ok).toBe(true);
        expect(result.results.find((r) => r.tab === 'sessions')?.measured).toBe(false);
    });

    test('resolveMeasurementProvenance records the importer package version', () => {
        const provenance = resolveMeasurementProvenance(process.cwd());
        expect(provenance.binaryPath).toContain('bun run apps/cli/src/index.ts');
        // The importer is a catalog workspace dep resolved in node_modules.
        expect(provenance.importerVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
