registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { ProjectProvider, useProjectContext } from '../../../src/modules/projects/useProjectContext';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function Probe({ onValue }: { onValue: (v: ReturnType<typeof useProjectContext>) => void }) {
    onValue(useProjectContext());
    return null;
}

function renderProvider(onValue: (v: ReturnType<typeof useProjectContext>) => void, initial = ['/board/tasks']) {
    return render(
        <MemoryRouter initialEntries={initial}>
            <Routes>
                <Route
                    path="*"
                    element={
                        <ProjectProvider>
                            <Probe onValue={onValue} />
                        </ProjectProvider>
                    }
                />
            </Routes>
        </MemoryRouter>,
    );
}

describe('ProjectProvider (0840 R4)', () => {
    test('resolves identity + fleet on a NON-Projects board route (context is board-wide)', async () => {
        let latest: ReturnType<typeof useProjectContext> | undefined;
        setFetchForTesting((async (req: Request) => {
            if (req.url.includes('/project/fleet')) {
                return jsonResponse({
                    path: '/repo/wt',
                    strategy: { name: 'gtd', version: 1 },
                    orchestrator: { state: 'bound-offline', reason: 'no-live-claim' },
                    members: [],
                    capacity: { total: 0, enabled: 0, writeCapable: 0, missing: ['no-declaration'] },
                });
            }
            if (req.url.endsWith('/project')) return jsonResponse({ name: 'spur', path: '/repo/wt' });
            return new Response('not found', { status: 404 });
        }) as typeof fetch);
        renderProvider((v) => (latest = v), ['/board/inbox']);
        await waitFor(() => expect(latest?.state).toBe('ready'));
        expect(latest?.path).toBe('/repo/wt');
        expect(latest?.name).toBe('spur');
        expect(latest?.fleet?.orchestrator.state).toBe('bound-offline');
        expect(latest?.fleet?.capacity.total).toBe(0);
    });

    test('missing path in /api/project → unresolvable (identity is required)', async () => {
        let latest: ReturnType<typeof useProjectContext> | undefined;
        setFetchForTesting((async (req: Request) => {
            if (req.url.includes('/project/fleet')) return jsonResponse({ path: null, members: [], capacity: {} });
            return jsonResponse({ name: 'spur', path: null });
        }) as typeof fetch);
        renderProvider((v) => (latest = v));
        await waitFor(() => expect(latest?.state).toBe('unresolvable'));
        expect(latest?.path).toBeNull();
    });

    test('fetch rejection → unresolvable and does not throw', async () => {
        let latest: ReturnType<typeof useProjectContext> | undefined;
        setFetchForTesting((async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch);
        renderProvider((v) => (latest = v));
        await waitFor(() => expect(latest?.state).toBe('unresolvable'));
    });

    test('identity resolution does not clobber a fleet snapshot that landed first (parallel race)', async () => {
        let latest: ReturnType<typeof useProjectContext> | undefined;
        setFetchForTesting((async (req: Request) => {
            if (req.url.includes('/project/fleet')) {
                return jsonResponse({
                    path: '/repo/wt',
                    strategy: { name: 'rest', version: 1 },
                    orchestrator: { state: 'bound-offline', reason: 'no-live-claim' },
                    members: [],
                    capacity: { total: 0, enabled: 0, writeCapable: 0, missing: [] },
                });
            }
            // Identity resolves AFTER the fleet snapshot.
            await new Promise((resolve) => setTimeout(resolve, 20));
            return jsonResponse({ name: 'spur', path: '/repo/wt' });
        }) as typeof fetch);
        renderProvider((v) => (latest = v));
        await waitFor(() => expect(latest?.state).toBe('ready'));
        expect(latest?.path).toBe('/repo/wt');
        expect(latest?.fleet).not.toBeNull();
        expect(latest?.fleet?.strategy).toEqual({ name: 'rest', version: 1 });
    });

    test('fleet fetch failure degrades fleet only — identity stays ready', async () => {
        let latest: ReturnType<typeof useProjectContext> | undefined;
        setFetchForTesting((async (req: Request) => {
            if (req.url.includes('/project/fleet')) throw new Error('fleet down');
            return jsonResponse({ name: 'spur', path: '/repo/wt' });
        }) as typeof fetch);
        renderProvider((v) => (latest = v));
        await waitFor(() => expect(latest?.state).toBe('ready'));
        expect(latest?.fleet).toBeNull();
        expect(latest?.path).toBe('/repo/wt');
    });

    test('context falls back to a loading default outside a provider', () => {
        let value: ReturnType<typeof useProjectContext> | undefined;
        const probe = render(<Probe onValue={(v) => (value = v)} />);
        expect(value).toEqual({ path: null, name: '', fleet: null, state: 'loading' });
        probe.unmount();
    });
});
