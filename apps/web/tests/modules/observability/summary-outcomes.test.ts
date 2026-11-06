/**
 * Rendered Summary outcomes (task 1308). happy-dom stands in for a browser.
 * The block must show measured USD, the unknown bucket, task-count labels,
 * and links to the existing task and trace routes.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import type { ObservabilityOutcomes, ObservabilitySummaryResponse } from '@gobing-ai/spur-contracts';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();

const { cleanup, render, waitFor } = await import('@testing-library/react');
const { createElement } = await import('react');
const { MemoryRouter } = await import('react-router');
const { resetFetchForTesting, setFetchForTesting } = await import('../../../src/lib/rpc-client');
const { SummaryOutcomes } = await import('../../../src/modules/observability/SummaryOutcomes');
const { default: SummaryTab } = await import('../../../src/modules/observability/SummaryTab');

afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

function excluded(over: Partial<NonNullable<ObservabilityOutcomes['verified']>['excludedReasons']> = {}) {
    return {
        notDone: 0,
        forcedDone: 0,
        missingVerdict: 0,
        syntheticVerdict: 0,
        verdictNotPass: 0,
        proofAbsent: 0,
        certifyingRunFailed: 0,
        ...over,
    };
}

function outcomes(over: Partial<ObservabilityOutcomes> = {}): ObservabilityOutcomes {
    return {
        verified: {
            taskDenominator: 4,
            verifiedResults: 1,
            correctionCount: 1,
            retryExhaustedCount: 1,
            timeToVerified: { count: 1, meanMs: 7_200_000, maxMs: 7_200_000 },
            excludedReasons: excluded({ forcedDone: 1, notDone: 1, missingVerdict: 1 }),
        },
        measuredUsd: 0.25,
        tokens: 140,
        terminalRuns: 2,
        mappedRuns: 1,
        historyRows: 2,
        usdRows: 1,
        unknownUsdRows: 1,
        unknownCostRunCount: 1,
        terminalReasonMix: { done: 1, unclassified: 1 },
        gateDurationMs: null,
        gateSampleCount: 0,
        evidence: [
            { runId: 'run-1308', wbs: '1308', measuredUsd: 0.25, unknownUsdRows: 0 },
            { runId: 'run-none', wbs: null, measuredUsd: null, unknownUsdRows: 0 },
        ],
        evidenceTruncated: false,
        ...over,
    };
}

function renderBlock(value: ObservabilityOutcomes) {
    return render(createElement(MemoryRouter, null, createElement(SummaryOutcomes, { outcomes: value })));
}

describe('Summary outcomes', () => {
    test('shows known USD, unknown coverage, task counts, and existing routes', () => {
        const view = renderBlock(outcomes());
        expect(view.getByTestId('outcome-verified-tasks').textContent).toBe('1 of 4');
        expect(view.getByText('Corrections (tasks)')).toBeTruthy();
        expect(view.getByTestId('outcome-corrections').textContent).toBe('1');
        expect(view.getByText('Retry exhausted (tasks)')).toBeTruthy();
        expect(view.getByTestId('outcome-retry-exhausted').textContent).toBe('1');
        expect(view.getByTestId('outcome-measured-usd').textContent).toBe('0.25');
        expect(view.getByTestId('outcome-tokens').textContent).toBe('140');
        expect(view.getByTestId('outcome-unknown-cost').textContent).toContain('1 of 2 history rows');
        expect(view.getByTestId('outcome-unknown-cost').textContent).toContain('1 unknown USD rows');
        expect(view.getByTestId('outcome-unknown-cost').textContent).toContain('1 runs with unknown cost');
        expect(view.getByTestId('outcome-gate').textContent).toContain('Gate duration unavailable');
        expect(view.getByTestId('outcome-gate').textContent).toContain('0 samples');
        expect(view.getByTestId('outcome-time-to-verified').textContent).toContain('7200000');
        expect(view.getByTestId('outcome-excluded').textContent).toContain('Forced done: 1');
        const task = view.getByRole('link', { name: 'Task 1308' });
        expect(task.getAttribute('href')).toBe('/board/tasks/1308');
        const trace = view.getByRole('link', { name: 'Trace run-1308' });
        expect(trace.getAttribute('href')).toBe('/board/observability?tab=trace&wbs=1308');
        const unmapped = view.getByRole('link', { name: 'Trace run-none' });
        expect(unmapped.getAttribute('href')).toBe('/board/observability?tab=trace');
    });

    test('shows unavailable measured cost separately from a token total', () => {
        const view = renderBlock(outcomes({ measuredUsd: null, tokens: 20, usdRows: 0, unknownUsdRows: 2 }));
        expect(view.getByTestId('outcome-measured-usd').textContent).toBe('Measured USD unavailable');
        expect(view.getByTestId('outcome-tokens').textContent).toBe('20');
        expect(view.getByTestId('outcome-tokens').textContent).not.toContain('unavailable');
    });

    test('shows an em dash when tokens were not measured', () => {
        const view = renderBlock(outcomes({ tokens: null, verified: null }));
        expect(view.getByTestId('outcome-tokens').textContent).toBe('—');
        expect(view.getByTestId('outcome-verified-tasks').textContent).toBe('Verified outcomes unavailable');
    });

    test('says when the evidence list is truncated', () => {
        const view = renderBlock(outcomes({ evidenceTruncated: true }));
        expect(view.getByTestId('outcome-evidence-truncated').textContent).toBe(
            'Evidence list truncated at 100; totals cover the full window.',
        );
    });

    test('SummaryTab renders the block from the summary response and hides it when absent', async () => {
        const payload: ObservabilitySummaryResponse = {
            window: { since: '2026-08-20T00:00:00.000Z', until: '2026-08-20T04:00:00.000Z', range: '4h' },
            kpis: {
                totalEvents: 1,
                activeJobs: 0,
                completedJobs: 0,
                failedJobs: 0,
                successRatePct: 0,
                errorEventCount: 0,
                warningEventCount: 0,
            },
            eventVolumeBuckets: [],
            decisionVolumeBuckets: [],
            topEventTypes: [],
            recentErrors: [],
            outcomes: outcomes(),
        };
        setFetchForTesting(
            (async () =>
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })) as unknown as typeof fetch,
        );
        const view = render(createElement(MemoryRouter, null, createElement(SummaryTab, { timeRange: '4h' })));
        await waitFor(() => {
            expect(view.getByTestId('summary-outcomes')).toBeTruthy();
        });
        expect(view.getByTestId('outcome-measured-usd').textContent).toBe('0.25');

        cleanup();
        const bare = { ...payload, outcomes: undefined };
        setFetchForTesting(
            (async () =>
                new Response(JSON.stringify(bare), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })) as unknown as typeof fetch,
        );
        const hidden = render(createElement(MemoryRouter, null, createElement(SummaryTab, { timeRange: '4h' })));
        await waitFor(() => {
            expect(hidden.getByTestId('observability-summary-tab')).toBeTruthy();
        });
        expect(hidden.queryByTestId('summary-outcomes')).toBeNull();
    });
});
