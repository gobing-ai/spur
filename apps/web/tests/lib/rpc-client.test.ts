import { describe, expect, test } from 'bun:test';
import { contract } from '@gobing-ai/spur-contracts';
import { createORPCClient } from '@orpc/client';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { onError } from '@orpc/shared';
import {
    api,
    apiFetchWithTimeout,
    fetchWithTimeout,
    logTransportError,
    resetFetchForTesting,
    resolveApiUrl,
    setFetchForTesting,
} from '../../src/lib/rpc-client';

describe('rpc client', () => {
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
        const server = Bun.serve({ fetch: () => new Response('ok'), port: 0 });
        const res = await fetchWithTimeout(new Request(server.url.href), 5000);
        expect(res).toBeInstanceOf(Response);
        server.stop();
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
        const server = Bun.serve({ fetch: () => new Response('ok'), port: 0 });
        const res = await apiFetchWithTimeout(new Request(server.url.href));
        expect(res).toBeInstanceOf(Response);
        server.stop();
    });

    test('logTransportError dispatches api-error custom event', () => {
        const dispatched: CustomEvent[] = [];
        const origDispatch = globalThis.dispatchEvent;
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        globalThis.dispatchEvent = ((ev: Event) => dispatched.push(ev as CustomEvent)) as any;
        try {
            logTransportError(new Error('boom'));
            expect(dispatched).toHaveLength(1);
            expect(dispatched[0]?.type).toBe('api-error');
            expect((dispatched[0]?.detail as Record<string, unknown>).message).toBe('boom');
        } finally {
            globalThis.dispatchEvent = origDispatch;
        }
    });

    test('onError adapter interceptor catches a transport failure', async () => {
        const dispatched: CustomEvent[] = [];
        const origDispatch = globalThis.dispatchEvent;
        // biome-ignore lint/suspicious/noExplicitAny: test mock
        globalThis.dispatchEvent = ((ev: Event) => dispatched.push(ev as CustomEvent)) as any;
        const client = createORPCClient(
            new OpenAPILink(contract, {
                url: 'http://127.0.0.1:1/api',
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
});
