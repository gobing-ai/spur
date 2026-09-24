import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import TasksTab from '../../../src/modules/observability/TasksTab';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

const runEntry = {
    id: 'run-1',
    workflowName: 'wf-a',
    status: 'done',
    mode: 'auto',
    agent: null,
    startedAt: '2026-09-23T10:00:00.000Z',
    completedAt: '2026-09-23T10:01:00.000Z',
};

const runDetail = {
    run: runEntry,
    phases: [{ phase: 'build', status: 'completed', startedAt: null, completedAt: null }],
    transitions: [],
    actions: [],
};

function mockFetchFor(recordOutcome: unknown, recordStatus = 200) {
    return (async (req: RequestInfo | URL) => {
        const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
        if (url.includes('/runs?limit=')) {
            return jsonResponse({ runs: [runEntry], count: 1, nextCursor: null, hasMore: false });
        }
        if (url.includes('/events/history') || url.includes('/tasks?')) {
            return jsonResponse({}, 404);
        }
        if (url.endsWith('/runs/run-1')) return jsonResponse(runDetail);
        if (url.includes('/observability/run-record/run-1')) return jsonResponse(recordOutcome, recordStatus);
        return jsonResponse({ error: `unmocked ${url}` }, 500);
    }) as unknown as typeof fetch;
}

describe('TasksTab run record (task 0929 R3 — Board run detail)', () => {
    beforeAll(() => {
        registerHappyDom();
    });

    afterAll(async () => {
        await teardownHappyDom();
    });

    afterEach(() => {
        cleanup();
        resetFetchForTesting();
    });

    test('expanding a run reveals an accessible record action that loads the bounded record', async () => {
        setFetchForTesting(
            mockFetchFor({ status: 'record', markdown: '# run record body', state: { runId: 'run-1' } }),
        );

        const { getByText, getAllByText, getByRole, queryByText } = render(<TasksTab />);
        const recordText = () => document.querySelector('[data-run-record-text]');

        await waitFor(() => {
            expect(getByText('wf-a')).toBeDefined();
        });

        // Keyboard-operable expand (same pattern as the row toggle).
        const toggle = getByRole('button', { name: /wf-a/ });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(getByText('Phases')).toBeDefined();
        });

        // Screen-reader labelled record action (0929 R3).
        const viewBtn = getByRole('button', { name: 'View run record for run run-1' });
        fireEvent.click(viewBtn);

        await waitFor(() => {
            expect(recordText()?.textContent).toContain('# run record body');
        });
        // Status comes from the DB trace, never inferred from the record text —
        // the row badge AND the record section's trace badge both read 'done'.
        expect(queryByText('Run record is incomplete')).toBeNull();
        expect(getAllByText('done').length).toBe(2);
    });

    test('unavailable outcomes render explicit labels and never an expired claim', async () => {
        setFetchForTesting(mockFetchFor({ status: 'missing' }));

        const { getByText, getByRole } = render(<TasksTab />);

        await waitFor(() => {
            expect(getByText('wf-a')).toBeDefined();
        });
        fireEvent.click(getByRole('button', { name: /wf-a/ }));

        await waitFor(() => {
            expect(getByRole('button', { name: 'View run record for run run-1' })).toBeDefined();
        });
        fireEvent.click(getByRole('button', { name: 'View run record for run run-1' }));

        await waitFor(() => {
            expect(getByText('No run record found on disk.')).toBeDefined();
        });
        expect(document.body.textContent).not.toContain('expired');
    });

    test('a server error surfaces a role=alert message with retry', async () => {
        setFetchForTesting(mockFetchFor({ error: 'boom' }, 500));

        const { getByText, getByRole } = render(<TasksTab />);

        await waitFor(() => {
            expect(getByText('wf-a')).toBeDefined();
        });
        fireEvent.click(getByRole('button', { name: /wf-a/ }));

        await waitFor(() => {
            expect(getByRole('button', { name: 'View run record for run run-1' })).toBeDefined();
        });
        fireEvent.click(getByRole('button', { name: 'View run record for run run-1' }));

        await waitFor(() => {
            expect(getByText(/Failed to load run record/).textContent).toContain('boom');
        });
    });
});
