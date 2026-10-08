registerHappyDom();

import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import type { DecisionLogDetail, DecisionLogListResponse, DecisionLogRow } from '@gobing-ai/spur-contracts';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import * as RealUI from '@/ui';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import type { ObservabilityNavIntent } from '../../../src/modules/observability/tabs';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// ── Mock @/ui Input: capture the real onChange and expose an uncontrolled input ──
// happy-dom's text-input events never reach React's onChange (see new-task-panel.test.tsx),
// so tests drive controlled inputs through the captured handler instead of fireEvent.change.
const inputOnChangeByLabel = new Map<string, (e: { target: { value: string } }) => void>();

function MockInput(props: Record<string, unknown>) {
    const { onChange, value, variant: _variant, size: _size, error: _error, ...rest } = props;
    const label = typeof rest['aria-label'] === 'string' ? rest['aria-label'] : '';
    if (label && typeof onChange === 'function') {
        inputOnChangeByLabel.set(label, onChange as (e: { target: { value: string } }) => void);
    }
    return React.createElement('input', { ...rest, defaultValue: typeof value === 'string' ? value : '' });
}

mock.module('@/ui', () => ({ ...RealUI, Input: MockInput }));

// Dynamic import so the @/ui mock intercepts before the real module loads.
const { default: DecisionsTab } = await import('../../../src/modules/observability/DecisionsTab');

/** Drive a controlled @/ui Input by invoking its captured onChange (happy-dom input events are broken). */
function setInputValue(label: string, value: string) {
    const onChange = inputOnChangeByLabel.get(label);
    if (!onChange) throw new Error(`no captured onChange for input labeled "${label}"`);
    act(() => onChange({ target: { value } }));
}

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function row(overrides: Partial<DecisionLogRow>): DecisionLogRow {
    return {
        id: 'row-1',
        decisionId: 'backend.selection',
        decisionType: 'backend.selection',
        caller: 'workflow',
        runId: 'run-abc',
        workflowName: 'demo',
        nodeId: null,
        wbs: null,
        makerName: 'robb',
        makerSource: 'config',
        catalogLayer: null,
        catalogSource: null,
        minConfidence: null,
        inputKeys: ['goal'],
        evidenceDigest: null,
        outcome: 'accepted',
        value: 'vercel',
        fallbackValue: null,
        source: null,
        reason: null,
        confidence: 0.9,
        confidenceLevel: 'HIGH',
        error: null,
        startedAt: '2026-07-15T10:00:00.000Z',
        endedAt: '2026-07-15T10:00:01.000Z',
        durationMs: 1000,
        schemaVersion: 1,
        ...overrides,
    };
}

const rowWithRun = row({});
const rowWithoutRun = row({ id: 'row-2', runId: null });

const mockListResponse: DecisionLogListResponse = {
    rows: [rowWithRun, rowWithoutRun],
    summary: { count: 2, acceptedRate: 0.5, fallbackRate: 0, p95DurationMs: 1000 },
    facets: { decisionIds: ['backend.selection'], makers: ['robb'] },
    nextCursor: null,
};

const mockDetails = new Map<string, DecisionLogDetail>([
    ['row-1', { ...rowWithRun, question: 'Which backend?', inputJson: '{"goal":"deploy"}', phases: [] }],
    ['row-2', { ...rowWithoutRun, question: null, inputJson: null, phases: [] }],
]);

/** Route `/decisions?` to the list fixture and `/decisions/:id` to the detail fixture, recording calls. */
function installFetchMock(fetchCalls?: string[]) {
    setFetchForTesting((async (req: RequestInfo | URL) => {
        const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
        fetchCalls?.push(url);
        const detailMatch = url.match(/\/decisions\/([^?]+)/);
        if (detailMatch !== null && detailMatch[1] !== undefined) {
            const detail = mockDetails.get(decodeURIComponent(detailMatch[1]));
            return detail ? jsonResponse(detail) : jsonResponse({ error: 'not found' }, 404);
        }
        if (url.includes('/decisions')) return jsonResponse(mockListResponse);
        return jsonResponse({});
    }) as unknown as typeof fetch);
}

describe('DecisionsTab (task 1100 remediation)', () => {
    beforeAll(() => {
        registerHappyDom();
    });

    afterAll(async () => {
        await teardownHappyDom();
    });

    afterEach(() => {
        cleanup();
        resetFetchForTesting();
        inputOnChangeByLabel.clear();
    });

    test('R7: run-linked drawer offers "View run events" emitting the system-events nav intent; hidden without run id', async () => {
        installFetchMock();
        const navigated: ObservabilityNavIntent[] = [];
        const { getByTestId, getByTitle, getAllByTestId, queryByTestId } = render(
            <DecisionsTab timeRange="4h" onNavigate={(intent) => navigated.push(intent)} />,
        );

        await waitFor(() => {
            expect(getByTestId('decisions-table')).toBeDefined();
        });

        // Row with a run id: the drawer shows the nav button; it emits the run-scoped intent.
        fireEvent.click(getAllByTestId('decision-row')[0] as HTMLElement);
        await waitFor(() => {
            expect(getByTestId('decision-detail-drawer')).toBeDefined();
        });

        // DESIGN.md § Decisions drawer: Input section is pretty-printed JSON with a Copy action.
        const inputPre = getByTestId('decision-detail-input');
        expect(inputPre.textContent).toContain('"goal": "deploy"');
        expect(getByTitle('Copy input JSON')).toBeDefined();

        const navBtn = getByTestId('navigate-decision-run-events-btn');
        expect(navBtn.textContent).toBe('View run events');
        fireEvent.click(navBtn);
        expect(navigated).toEqual([{ tab: 'system-events', runId: 'run-abc' }]);

        fireEvent.click(getByTestId('close-decision-drawer'));
        await waitFor(() => {
            expect(queryByTestId('decision-detail-drawer')).toBeNull();
        });

        // Row without a run id: no nav button (shown only when a run id exists).
        fireEvent.click(getAllByTestId('decision-row')[1] as HTMLElement);
        await waitFor(() => {
            expect(getByTestId('decision-detail-drawer')).toBeDefined();
        });
        expect(queryByTestId('navigate-decision-run-events-btn')).toBeNull();
    });

    test('a11y: Enter opens the drawer and closing returns focus to the activating row (DESIGN.md:480,493)', async () => {
        installFetchMock();
        const { getByTestId, getAllByTestId, queryByTestId } = render(<DecisionsTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('decisions-table')).toBeDefined();
        });

        const firstRow = getAllByTestId('decision-row')[0] as HTMLElement;
        expect(firstRow.getAttribute('tabindex')).toBe('0');

        fireEvent.keyDown(firstRow, { key: 'Enter' });
        await waitFor(() => {
            expect(getByTestId('decision-detail-drawer')).toBeDefined();
        });

        fireEvent.click(getByTestId('close-decision-drawer'));
        await waitFor(() => {
            expect(queryByTestId('decision-detail-drawer')).toBeNull();
        });
        expect(document.activeElement ?? null).toBe(firstRow);
    });

    test('controls: outcome SegmentedToggle + caller select + run-id input drive the query (DESIGN.md:462-466)', async () => {
        const fetchCalls: string[] = [];
        installFetchMock(fetchCalls);
        const { getByRole, getByLabelText, getByTestId, container } = render(<DecisionsTab timeRange="4h" />);

        await waitFor(() => {
            expect(getByTestId('decisions-table')).toBeDefined();
        });

        // The outcome filter is a segmented radio group, not the off-pattern select.
        expect(container.querySelector('select[aria-label="Filter by outcome"]')).toBeNull();
        const acceptedRadio = getByRole('radio', { name: 'Accepted' }) as HTMLInputElement;
        expect(acceptedRadio.checked).toBe(false);
        fireEvent.click(acceptedRadio);
        await waitFor(() => {
            expect(fetchCalls.some((u) => u.includes('outcome=accepted'))).toBe(true);
        });

        // Caller select adds its query param.
        fireEvent.change(getByLabelText('Caller'), { target: { value: 'workflow' } });
        await waitFor(() => {
            expect(fetchCalls.some((u) => u.includes('caller=workflow'))).toBe(true);
        });

        // Run-id text input adds its query param (via captured onChange; happy-dom input events are broken).
        setInputValue('Filter by run id', 'run-abc');
        await waitFor(() => {
            expect(fetchCalls.some((u) => u.includes('run=run-abc'))).toBe(true);
        });
    });
});
