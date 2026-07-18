registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
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

function renderSidebar() {
    return render(
        <MemoryRouter>
            <LeftSidebar collapsed={false} onToggle={() => {}} />
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
