registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { type TeamGroup, useTeamsData } from '../../../src/modules/teams/useTeamsData';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

// ── parseTeamsResponse branches (exercised through the hook's fetch path) ──
// The parser is internal, so each branch is driven by feeding the matching
// body shape to a one-shot fetch mock and asserting the resulting `teams`
// array. A null/invalid body leaves the previous state untouched (initial []);

afterAll(teardownHappyDom);
afterEach(resetFetchForTesting);

describe('useTeamsData', () => {
    test('loads valid teams with members on mount (happy path)', async () => {
        const body = {
            teams: [
                {
                    teamId: 'alpha',
                    name: 'Alpha Team',
                    members: [
                        { id: 'm1', type: 'supervisor', status: 'running' },
                        { id: 'm2', type: 'worker', status: 'stopped' },
                    ],
                },
                { teamId: 'beta', name: 'Beta', members: [] },
            ],
        };
        setFetchForTesting((async () => jsonResponse(body)) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.teams.length).toBe(2));

        const [alpha, beta] = result.current.teams;
        expect(alpha?.teamId).toBe('alpha');
        expect(alpha?.members).toHaveLength(2);
        expect(alpha?.members[0]).toEqual({ id: 'm1', type: 'supervisor', status: 'running' });
        expect(beta?.members).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    test('ignores entries missing required string fields (parser skip branch)', async () => {
        const body = {
            teams: [
                { teamId: 'good', name: 'Good', members: [] },
                { teamId: 'no-name', members: [] }, // missing name
                { name: 'no-id', members: [] }, // missing teamId
                { teamId: 1, name: 'numeric-id', members: [] }, // teamId not string
                { teamId: 'ok', name: 2, members: [] }, // name not string
                null,
            ],
        };
        setFetchForTesting((async () => jsonResponse(body)) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.teams.length).toBe(1));
        expect(result.current.teams[0]?.teamId).toBe('good');
    });

    test('skips members with missing/non-string id, type, or status', async () => {
        const body = {
            teams: [
                {
                    teamId: 't',
                    name: 'T',
                    members: [
                        { id: 'ok', type: 'supervisor', status: 'running' },
                        { id: 1, type: 'supervisor', status: 'running' }, // id not string
                        { id: 'bad-type', type: 2, status: 'running' }, // type not string
                        { id: 'bad-status', type: 'supervisor', status: 3 }, // status not string
                        'not-an-object',
                        null,
                    ],
                },
            ],
        };
        setFetchForTesting((async () => jsonResponse(body)) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.teams.length).toBe(1));
        expect(result.current.teams[0]?.members).toEqual([{ id: 'ok', type: 'supervisor', status: 'running' }]);
    });

    test('leaves teams empty when body has no teams key', async () => {
        setFetchForTesting((async () => jsonResponse({ unrelated: 'shape' })) as unknown as typeof fetch);
        const { result } = renderHook(() => useTeamsData());
        // Allow the fetch + state cycle to settle; teams stays at initial []
        await act(async () => {
            await Promise.resolve(); // flush microtask queue without a real timer
        });
        expect(result.current.teams).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    test('leaves teams empty when teams is not an array', async () => {
        setFetchForTesting((async () => jsonResponse({ teams: 'not-an-array' })) as unknown as typeof fetch);
        const { result } = renderHook(() => useTeamsData());
        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current.teams).toEqual([]);
    });

    test('leaves teams empty when body is null or primitive', async () => {
        setFetchForTesting((async () => jsonResponse(null)) as unknown as typeof fetch);
        const { result } = renderHook(() => useTeamsData());
        await act(async () => {
            await Promise.resolve();
        });
        expect(result.current.teams).toEqual([]);
    });

    test('sets error when fetch rejects', async () => {
        setFetchForTesting((async () => {
            throw new Error('network down');
        }) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.error).not.toBeNull());
        expect(result.current.error).toBe('network down');
        expect(result.current.teams).toEqual([]);
    });

    test('sets error when res.ok is false (non-2xx)', async () => {
        setFetchForTesting((async () => jsonResponse({ error: 'boom' }, 500)) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.error).not.toBeNull());
        expect(result.current.error).toContain('500');
    });

    test('sets error from a non-Error thrown value (String fallback)', async () => {
        setFetchForTesting((async () => {
            throw 'string-error'; // not an Error instance
        }) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.error).toBe('string-error'));
    });

    test('reload() re-fetches and replaces teams with new data', async () => {
        let iteration = 0;
        const first: TeamGroup[] = [{ teamId: 'a', name: 'A', members: [] }];
        const second: TeamGroup[] = [{ teamId: 'b', name: 'B', members: [] }];
        setFetchForTesting((async () => {
            iteration += 1;
            return jsonResponse({ teams: iteration === 1 ? first : second });
        }) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.teams).toEqual(first));

        await act(async () => {
            await result.current.reload();
        });
        expect(result.current.teams).toEqual(second);
    });

    test('reload() clears error after a successful fetch following a failure', async () => {
        let iteration = 0;
        setFetchForTesting((async () => {
            iteration += 1;
            if (iteration === 1) throw new Error('first fail');
            return jsonResponse({ teams: [{ teamId: 'x', name: 'X', members: [] }] });
        }) as unknown as typeof fetch);

        const { result } = renderHook(() => useTeamsData());
        await waitFor(() => expect(result.current.error).toBe('first fail'));

        await act(async () => {
            await result.current.reload();
        });
        expect(result.current.error).toBeNull();
        expect(result.current.teams[0]?.teamId).toBe('x');
    });

    test('unmount prevents state updates after teardown (mountedRef guard)', async () => {
        const { promise, resolve } = Promise.withResolvers<Response>();
        setFetchForTesting((async () => promise) as unknown as typeof fetch);

        const { result, unmount } = renderHook(() => useTeamsData());
        // Unmount while the first fetch is still in-flight.
        unmount();
        // Now resolve the pending fetch. The hook's mountedRef.current is false,
        // so setTeams/setError must not run. We assert no React act warning is
        // thrown and the (now-detached) result stays at its initial value.
        await act(async () => {
            resolve(jsonResponse({ teams: [{ teamId: 'late', name: 'Late', members: [] }] }));
            await promise.catch(() => {}); // let the fetch settle
        });
        expect(result.current.teams).toEqual([]);
    });
});
