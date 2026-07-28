registerHappyDom();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import LeftSidebar from '../../src/components/LeftSidebar';
import { resetFetchForTesting, setFetchForTesting } from '../../src/lib/rpc-client';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

function silentProjectFetch(): void {
    setFetchForTesting(
        (async (_input: RequestInfo | URL, _init?: RequestInit) =>
            new Response(JSON.stringify({ name: null }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch,
    );
}

function renderSidebar(collapsed = false, onToggle: () => void = () => {}) {
    return render(
        <MemoryRouter>
            <LeftSidebar collapsed={collapsed} onToggle={onToggle} />
        </MemoryRouter>,
    );
}

describe('LeftSidebar project name', () => {
    test('shows the project name returned by /api/project instead of Modules', async () => {
        setFetchForTesting(
            (async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(JSON.stringify({ name: 'spur-new' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })) as typeof fetch,
        );

        const { getByText, queryByText } = renderSidebar();

        await waitFor(() => expect(getByText('spur-new')).toBeTruthy());
        expect(queryByText('Modules')).toBeNull();
    });

    test('falls back to Modules when the fetch fails', async () => {
        setFetchForTesting((async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
            throw new Error('offline');
        }) as typeof fetch);

        const { getByText } = renderSidebar();

        // Fallback must be visible immediately and stay after the rejected fetch settles.
        expect(getByText('Modules')).toBeTruthy();
        await waitFor(() => expect(getByText('Modules')).toBeTruthy());
    });

    test('falls back to Modules when the server reports no project (null name)', async () => {
        setFetchForTesting(
            (async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(JSON.stringify({ name: null }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                })) as typeof fetch,
        );

        const { getByText } = renderSidebar();

        await waitFor(() => expect(getByText('Modules')).toBeTruthy());
    });
});

describe('LeftSidebar fold / unfold controls', () => {
    test('collapsed rail exposes a single top expand control (no edge tab)', () => {
        silentProjectFetch();
        const onToggle = mock(() => {});
        const { getByTestId, queryByTestId, getByLabelText } = renderSidebar(true, onToggle);

        expect(getByTestId('sidebar-expand')).toBeTruthy();
        expect(queryByTestId('sidebar-expand-tab')).toBeNull();
        expect(queryByTestId('sidebar-collapse')).toBeNull();
        expect(getByLabelText('Expand sidebar')).toBeTruthy();

        fireEvent.click(getByTestId('sidebar-expand'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    test('expanded header exposes collapse control before the theme toggle', () => {
        silentProjectFetch();
        const onToggle = mock(() => {});
        const { getByTestId, queryByTestId, getByLabelText, container } = renderSidebar(false, onToggle);

        expect(getByTestId('sidebar-collapse')).toBeTruthy();
        expect(queryByTestId('sidebar-expand')).toBeNull();
        expect(queryByTestId('sidebar-expand-tab')).toBeNull();
        expect(getByLabelText('Collapse sidebar')).toBeTruthy();

        // Collapse sits before theme toggle in the header action group.
        const collapse = getByTestId('sidebar-collapse');
        const theme = getByLabelText(/Switch to (light|dark) mode/);
        const actions = collapse.parentElement;
        expect(actions).toBeTruthy();
        const kids = Array.from(actions?.children ?? []);
        expect(kids.indexOf(collapse)).toBeLessThan(kids.indexOf(theme));
        // Title still present so the header is not icon-only when expanded.
        expect(container.querySelector('aside span.font-semibold')).toBeTruthy();

        fireEvent.click(getByTestId('sidebar-collapse'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });
});
