import { describe, expect, test } from 'bun:test';
import { createGatewayHandler } from '../../src/services/project-gateway';

/**
 * The gateway must reach a local serve on whichever loopback family it bound: a registry-spawned
 * serve binds 127.0.0.1, a hand-started `spur self serve` binds ::1 on macOS. A dial that only knows
 * 127.0.0.1 turned a healthy project into a 502.
 */

const entry = {
    name: 'spur-new',
    path: '/Users/robin/xprojects/spur-new',
    host: 'localhost',
    port: 3000,
    prefix: '/spur-new',
};

/** A fetch stub answering only for the given authority, with a count of dial attempts. */
function fetchForLiveAuthority(liveAuthority: string) {
    const dialed: string[] = [];
    const impl = (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        dialed.push(url.host);
        if (url.host !== liveAuthority) {
            const err = new Error('Unable to connect. Is the computer able to access the url?') as Error & {
                code?: string;
            };
            err.code = 'ECONNREFUSED';
            throw err;
        }
        return new Response('<html><body>board</body></html>', { headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
    return { impl, dialed };
}

function handlerWith(fetchImpl: typeof fetch) {
    return createGatewayHandler({
        listProjects: async () => [entry],
        ensureUpstream: async () => entry.port,
        port: 3000,
        fetchUpstream: fetchImpl,
    });
}

describe('gateway upstream dial (Q R1/R2/R4)', () => {
    test('reaches a serve that bound ::1 only', async () => {
        const { impl, dialed } = fetchForLiveAuthority('[::1]:3000');
        const res = await handlerWith(impl)(new Request('http://localhost:3000/spur-new/board'));
        expect(res.status).toBe(200);
        expect(dialed).toEqual(['127.0.0.1:3000', '[::1]:3000']);
    });

    test('reaches a serve that bound 127.0.0.1 on the first attempt', async () => {
        const { impl, dialed } = fetchForLiveAuthority('127.0.0.1:3000');
        const res = await handlerWith(impl)(new Request('http://localhost:3000/spur-new/board'));
        expect(res.status).toBe(200);
        expect(dialed).toEqual(['127.0.0.1:3000']);
    });

    test('remembers the answering family instead of re-probing a dead one', async () => {
        const { impl, dialed } = fetchForLiveAuthority('[::1]:3000');
        const handler = handlerWith(impl);
        await handler(new Request('http://localhost:3000/spur-new/board'));
        await handler(new Request('http://localhost:3000/spur-new/board'));
        expect(dialed).toEqual(['127.0.0.1:3000', '[::1]:3000', '[::1]:3000']);
    });

    test('reports every dialed address and the log path when no family answers', async () => {
        const { impl } = fetchForLiveAuthority('127.0.0.1:9');
        const res = await handlerWith(impl)(new Request('http://localhost:3000/spur-new/api/health'));
        expect(res.status).toBe(502);
        const body = await res.text();
        expect(body).toContain('"spur-new" (localhost)');
        expect(body).toContain('127.0.0.1:3000');
        expect(body).toContain('[::1]:3000');
        expect(body).toContain('.spur/run/serve-spawn.log');
    });

    test('a request with a body still reaches a ::1-only serve', async () => {
        const { impl, dialed } = fetchForLiveAuthority('[::1]:3000');
        const res = await handlerWith(impl)(
            new Request('http://localhost:3000/spur-new/api/tasks', { method: 'POST', body: '{"a":1}' }),
        );
        expect(res.status).toBe(200);
        expect(dialed).toEqual(['127.0.0.1:3000', '[::1]:3000']);
    });
});
