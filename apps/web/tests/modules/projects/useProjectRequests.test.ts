registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, renderHook } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { useProjectRequests } from '../../../src/modules/projects/useProjectRequests';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

describe('useProjectRequests (0844)', () => {
    test('unbound orchestrator → empty map, no fetch, not failed', async () => {
        const fetched: string[] = [];
        setFetchForTesting(((input: RequestInfo | URL) => {
            fetched.push(typeof input === 'string' ? input : (input as Request).url);
            return Promise.resolve(new Response('{}', { status: 200 }));
        }) as typeof fetch);
        const { result } = renderHook(() => useProjectRequests(null));
        await act(async () => {});
        expect(fetched).toEqual([]);
        expect(result.current.requests.size).toBe(0);
        expect(result.current.failed).toBe(false);
    });

    test('rows parse into a messageId-keyed map; malformed rows are dropped (named-state discipline)', async () => {
        setFetchForTesting(((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : (input as Request).url;
            if (new URL(url).pathname === '/api/project/requests') {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            requests: [
                                {
                                    messageId: 'm1',
                                    requestKey: 'rk1',
                                    deliveryStatus: 'queued',
                                    injectAttempts: 1,
                                    injectError: null,
                                    runId: null,
                                    taskId: '0844',
                                    outcome: null,
                                    reason: null,
                                    hold: null,
                                },
                                { nope: true },
                                'garbage',
                            ],
                        }),
                        { status: 200 },
                    ),
                );
            }
            return Promise.resolve(new Response('{}', { status: 200 }));
        }) as typeof fetch);
        const { result } = renderHook(() => useProjectRequests('lead'));
        await act(async () => {});
        expect(result.current.requests.size).toBe(1);
        expect(result.current.requests.get('m1')?.taskId).toBe('0844');
        expect(result.current.failed).toBe(false);
    });

    test('a failed read is a NAMED state (never a silent empty map) and unbinding clears the map (R4)', async () => {
        let status = 200;
        setFetchForTesting(((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : (input as Request).url;
            if (new URL(url).pathname === '/api/project/requests') {
                return Promise.resolve(
                    new Response('{"requests":[{"messageId":"m1","deliveryStatus":"queued","injectAttempts":0}]}', {
                        status,
                    }),
                );
            }
            return Promise.resolve(new Response('{}', { status: 200 }));
        }) as typeof fetch);
        const view = renderHook((instanceId: string | null) => useProjectRequests(instanceId), {
            initialProps: 'lead' as string | null,
        });
        await act(async () => {});
        expect(view.result.current.requests.size).toBe(1);

        // Server starts failing → the next identity-driven refetch names it.
        status = 503;
        await act(async () => {
            view.rerender('lead-2');
        });
        await act(async () => {});
        expect(view.result.current.failed).toBe(true);

        // Unbound → map cleared, failed reset.
        view.rerender(null);
        expect(view.result.current.requests.size).toBe(0);
        expect(view.result.current.failed).toBe(false);
    });

    test('polls on the injected cadence and stops on unmount (F1 refresh loop)', async () => {
        let hits = 0;
        setFetchForTesting(((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : (input as Request).url;
            if (new URL(url).pathname === '/api/project/requests') hits += 1;
            return Promise.resolve(new Response('{"requests":[]}', { status: 200 }));
        }) as typeof fetch);
        const view = renderHook(() => useProjectRequests('lead', 2));
        await Bun.sleep(15);
        const during = hits;
        expect(during).toBeGreaterThanOrEqual(2); // initial read + at least one poll tick
        view.unmount();
        const after = hits;
        await Bun.sleep(10);
        expect(hits).toBe(after); // interval cleared alongside the AbortController
    });
});
