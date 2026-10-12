import { describe, expect, test } from 'bun:test';
import { contract } from '@gobing-ai/spur-contracts';
import { createORPCClient } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { onError } from '@orpc/shared';
import {
    api,
    apiFetchWithTimeout,
    decodeApiError,
    fetchWithTimeout,
    logTransportError,
    resetFetchForTesting,
    resolveApiUrl,
    setFetchForTesting,
} from '../../src/lib/rpc-client';

describe('rpc client', () => {
    test('fetchWithTimeout preserves a request that was already cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetcher: typeof fetch = Object.assign(
            async (request: RequestInfo | URL) => {
                const signal = (request as Request).signal;
                signal.throwIfAborted();
                return new Response('unexpected request');
            },
            { preconnect: fetch.preconnect },
        );
        setFetchForTesting(fetcher);
        try {
            await expect(
                fetchWithTimeout(new Request('http://localhost/test', { signal: controller.signal })),
            ).rejects.toThrow('aborted');
        } finally {
            resetFetchForTesting();
        }
    });

    test.each(['success', 'failure'])('fetchWithTimeout removes its abort listener after %s', async (outcome) => {
        const request = new Request('http://localhost/test');
        const signal = request.signal;
        const add = signal.addEventListener.bind(signal);
        const remove = signal.removeEventListener.bind(signal);
        let added: unknown;
        let removed: unknown;
        signal.addEventListener = (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions,
        ) => {
            if (type === 'abort') added = listener;
            add(type, listener, options);
        };
        signal.removeEventListener = (
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions,
        ) => {
            if (type === 'abort') removed = listener;
            remove(type, listener, options);
        };
        const fetcher: typeof fetch = Object.assign(
            async () => {
                if (outcome === 'failure') throw new Error('network failure');
                return new Response('ok');
            },
            { preconnect: fetch.preconnect },
        );
        setFetchForTesting(fetcher);
        try {
            const result = fetchWithTimeout(request);
            if (outcome === 'failure') await expect(result).rejects.toThrow('network failure');
            else expect((await result).status).toBe(200);
            expect(added).toBeDefined();
            expect(removed).toBe(added);
        } finally {
            resetFetchForTesting();
        }
    });
    test('resolveApiUrl returns default URL', () => {
        const url = resolveApiUrl();
        expect(url).toContain('/api');
    });

    test('resolveApiUrl uses provided URL', () => {
        const url = resolveApiUrl('https://example.com/api');
        expect(url).toBe('https://example.com/api');
    });

    test('resolveApiUrl returns absolute same-origin URL in production browser context', () => {
        expect(resolveApiUrl(undefined, 'http://localhost:3000', false)).toBe('http://localhost:3000/api');
    });

    test('api is a typed client with health method', () => {
        expect(api).toBeDefined();
        expect(typeof (api as Record<string, unknown>).health).toBe('function');
    });

    test('api has task and feature methods', () => {
        const a = api as Record<string, unknown>;
        expect(typeof a.health).toBe('function');
        expect(typeof a.task).toBe('function');
        expect(typeof a.feature).toBe('function');
    });

    test('fetchWithTimeout resolves when fetch succeeds', async () => {
        setFetchForTesting((async () => new Response('ok')) as unknown as typeof fetch);
        try {
            const res = await fetchWithTimeout(new Request('http://localhost/test'), 5000);
            expect(res).toBeInstanceOf(Response);
        } finally {
            resetFetchForTesting();
        }
    });

    test('fetchWithTimeout aborts on timeout', async () => {
        let aborted = false;
        const mock = (url: RequestInfo | URL): Promise<Response> => {
            return new Promise((_resolve, reject) => {
                const signal = (url as Request).signal;
                if (signal?.aborted) {
                    aborted = true;
                    return reject(new DOMException('The operation was aborted', 'AbortError'));
                }
                const timer = setTimeout(() => {}, 200);
                signal?.addEventListener('abort', () => {
                    aborted = true;
                    clearTimeout(timer);
                    reject(new DOMException('The operation was aborted', 'AbortError'));
                });
            });
        };
        setFetchForTesting(mock as unknown as typeof fetch);
        try {
            await expect(fetchWithTimeout(new Request('http://localhost/test'), 1)).rejects.toThrow(
                'The operation was aborted',
            );
            expect(aborted).toBe(true);
        } finally {
            resetFetchForTesting();
        }
    });

    test('apiFetchWithTimeout delegates to fetchWithTimeout with default ms', async () => {
        setFetchForTesting((async () => new Response('ok')) as unknown as typeof fetch);
        try {
            const res = await apiFetchWithTimeout(new Request('http://localhost/test'));
            expect(res).toBeInstanceOf(Response);
        } finally {
            resetFetchForTesting();
        }
    });

    test('logTransportError dispatches api-error custom event', () => {
        const dispatched: CustomEvent[] = [];
        const origDispatch = globalThis.dispatchEvent;
        globalThis.dispatchEvent = (ev: Event): boolean => {
            dispatched.push(ev as CustomEvent);
            return true;
        };
        try {
            logTransportError(new Error('boom'));
            expect(dispatched).toHaveLength(1);
            expect(dispatched[0]?.type).toBe('api-error');
            const detail = dispatched[0]?.detail as Record<string, unknown> | undefined;
            expect(detail?.message).toBe('boom');
        } finally {
            globalThis.dispatchEvent = origDispatch;
        }
    });

    test('onError adapter interceptor catches a transport failure', async () => {
        const dispatched: CustomEvent[] = [];
        const origDispatch = globalThis.dispatchEvent;
        globalThis.dispatchEvent = (ev: Event): boolean => {
            dispatched.push(ev as CustomEvent);
            return true;
        };
        const client = createORPCClient(
            new OpenAPILink(contract, {
                url: 'http://127.0.0.1:1/api',
                fetch: () => Promise.reject(new TypeError('Failed to fetch')),
                adapterInterceptors: [onError(logTransportError)],
            }),
        ) as { health: () => Promise<unknown> };
        try {
            await expect(client.health()).rejects.toBeDefined();
            expect(dispatched).toHaveLength(1);
        } finally {
            globalThis.dispatchEvent = origDispatch;
        }
    });

    // Task 1185: the `/api/*` seam re-shapes typed domain errors into `{ ok:false, error:{…} }`
    // (apps/server/src/bootstrap.ts), which OpenAPILink cannot match to `isORPCErrorJson` — so
    // without a decoder the client threw a synthesised `ORPCError('CONFLICT', 409, 'Conflict')` and
    // callers lost both the domain code and the reason the transition was refused.
    describe('typed domain errors decode with their code and reason (task 1185)', () => {
        const clientWith = (respond: () => Promise<Response>, decode: boolean) =>
            createORPCClient(
                new OpenAPILink(contract, {
                    url: 'http://localhost/api',
                    fetch: respond,
                    ...(decode
                        ? { customErrorResponseBodyDecoder: (body, response) => decodeApiError(body, response) }
                        : {}),
                }),
            ) as { health: () => Promise<unknown> };

        const envelope = (code: string, message: string, status: number) => (): Promise<Response> =>
            Promise.resolve(
                new Response(JSON.stringify({ ok: false, error: { code, message } }), {
                    status,
                    headers: { 'content-type': 'application/json' },
                }),
            );

        test('decodes code, status and the guard reason; without the decoder it degrades to CONFLICT', async () => {
            const respond = envelope('GUARD_DENIED', 'undeclared edge deprecated → done', 409);
            await expect(clientWith(respond, true).health()).rejects.toMatchObject({
                code: 'GUARD_DENIED',
                status: 409,
                message: 'undeclared edge deprecated → done',
            });
            // The pre-fix behaviour, pinned: no decoder → the reason is unreachable.
            await expect(clientWith(respond, false).health()).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
        });

        test('the status comes from the response, not a second code→status table', async () => {
            await expect(clientWith(envelope('LOCK_TIMEOUT', 'lock held', 503), true).health()).rejects.toMatchObject({
                code: 'LOCK_TIMEOUT',
                status: 503,
            });
        });

        test("a body that is not the envelope keeps oRPC's own handling", async () => {
            const respond = (): Promise<Response> =>
                Promise.resolve(
                    new Response(
                        JSON.stringify({
                            defined: false,
                            code: 'INTERNAL_SERVER_ERROR',
                            status: 500,
                            message: 'boom',
                        }),
                        { status: 500, headers: { 'content-type': 'application/json' } },
                    ),
                );
            await expect(clientWith(respond, true).health()).rejects.toMatchObject({
                code: 'INTERNAL_SERVER_ERROR',
                status: 500,
                message: 'boom',
            });
        });
    });
});
