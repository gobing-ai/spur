/**
 * A822 R1-R4 (task 1468) — the remote half of an outbound A2A dialog.
 *
 * The failure modes this suite pins, in the task's order: an `a2a` peer and an unregistered project
 * are marked without any fetch (never guessed), a dead gateway / 500 / timeout / redirect /
 * malformed body each degrade to `unavailable` with a reason, and the happy path returns the remote
 * thread oldest first, over a loopback GET that carries no credential and follows no redirect.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import type { ProjectEntry } from '@gobing-ai/spur-config';
import { readRemoteDialog } from '../../src/services/a2a-remote-dialog';

const cleanups: Array<() => void> = [];
afterAll(() => {
    for (const stop of cleanups) stop();
});

/** One inbox message in the wire shape the `inbox.thread` route answers with. */
function message(id: string, createdAt: number, inReplyTo: string | null = null, threadId = 'th-1') {
    return {
        id,
        fromId: 'ts-libs-coder',
        toId: 'operator',
        body: `body ${id}`,
        kind: 'chat' as const,
        status: 'delivered' as const,
        attempts: 1,
        error: null,
        claimedAt: null,
        deliveredAt: createdAt,
        readAt: null,
        inReplyTo,
        threadId,
        requestKey: null,
        taskId: null,
        parentRunId: null,
        createdAt,
    };
}

/** A stub loopback "gateway": `/api/health` plus whatever `thread` answers for the inbox route. */
function stubGateway(thread: (req: Request) => Response | Promise<Response>): {
    port: number;
    requests: Request[];
} {
    const requests: Request[] = [];
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: (req) => {
            const url = new URL(req.url);
            if (url.pathname === '/api/health') return Response.json({ ok: true, gateway: true });
            requests.push(req);
            return thread(req);
        },
    });
    cleanups.push(() => server.stop(true));
    return { port: server.port as number, requests };
}

const entry: ProjectEntry = { name: 'ts-libs', path: '/tmp/ts-libs', port: 0, prefix: '/tslibs' };

/** Deps with the registry and gateway the tests vary; `fetchCalls` counts real network attempts. */
function deps(port: number, overrides: Partial<Parameters<typeof readRemoteDialog>[0]> = {}) {
    return {
        member: { kind: 'project' as const, target: 'ts-libs/coder' },
        remoteContextId: 'th-1',
        gatewayPort: port,
        listProjects: async () => [entry],
        ...overrides,
    };
}

/** A port nothing listens on: Bun.serve with port 0 then stopped, so the number is real but free. */
function deadPort(): number {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') });
    const port = server.port as number;
    server.stop(true);
    return port;
}

describe('1468 R1/AC1 — same-gateway project reads its remote thread', () => {
    test('returns the thread oldest first and asks the gateway inbox route', async () => {
        const gateway = stubGateway(() =>
            Response.json([message('m3', 3000), message('m1', 1000), message('m2', 2000)]),
        );
        const result = await readRemoteDialog(deps(gateway.port));
        expect(result.status).toBe('remote');
        if (result.status !== 'remote') return;
        expect(result.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
        expect(gateway.requests).toHaveLength(1);
        expect(new URL(gateway.requests[0]?.url ?? '').pathname).toBe('/tslibs/api/inbox/messages/th-1/thread');
    });

    test('forwards no credential header and no local token (R4)', async () => {
        const gateway = stubGateway(() => Response.json([message('m1', 1000)]));
        await readRemoteDialog(deps(gateway.port));
        const headers = gateway.requests[0]?.headers;
        // The remote project authenticates its own gateway; this read carries nothing of ours.
        expect(headers?.get('authorization')).toBeNull();
        expect(headers?.get('cookie')).toBeNull();
        expect(headers?.get('x-api-key')).toBeNull();
        expect(headers?.get('x-spur-token')).toBeNull();
    });
});

describe('1468 R2/AC2 — a peer outside the gateway is marked, never guessed', () => {
    test('an a2a-kind member is outside-gateway and issues no fetch', async () => {
        const gateway = stubGateway(() => Response.json([]));
        const result = await readRemoteDialog(
            deps(gateway.port, { member: { kind: 'a2a', target: 'https://example.test/a2a' } }),
        );
        expect(result).toEqual({ status: 'outside-gateway' });
        expect(gateway.requests).toHaveLength(0);
    });

    test('an unregistered project is outside-gateway and issues no fetch', async () => {
        const gateway = stubGateway(() => Response.json([]));
        const result = await readRemoteDialog(deps(gateway.port, { listProjects: async () => [] }));
        expect(result).toEqual({ status: 'outside-gateway' });
        expect(gateway.requests).toHaveLength(0);
    });
});

describe('1468 R2/AC3 — a failed remote read degrades to the marker', () => {
    test('a registry read failure is unavailable without starting a fetch', async () => {
        const result = await readRemoteDialog(
            deps(0, {
                listProjects: async () => {
                    throw new Error('registry unavailable');
                },
            }),
        );
        expect(result).toEqual({ status: 'unavailable', reason: 'could not read the project registry' });
    });

    test('no gateway listening is unavailable with the gateway reason', async () => {
        const result = await readRemoteDialog(deps(deadPort()));
        expect(result.status).toBe('unavailable');
        if (result.status !== 'unavailable') return;
        expect(result.reason).toContain('no gateway is listening');
    });

    test('a non-2xx answer is unavailable with the status', async () => {
        const gateway = stubGateway(() => new Response('boom', { status: 500 }));
        const result = await readRemoteDialog(deps(gateway.port));
        expect(result.status).toBe('unavailable');
        if (result.status !== 'unavailable') return;
        expect(result.reason).toContain('HTTP 500');
    });

    test('a redirect is a failure, not a detour (redirect: error)', async () => {
        const target = stubGateway(() => Response.json([message('m1', 1000)]));
        const redirecting = stubGateway(
            () =>
                new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${target.port}/elsewhere` } }),
        );
        const result = await readRemoteDialog(deps(redirecting.port));
        expect(result.status).toBe('unavailable');
        // Nothing was followed: the redirect target never saw the read.
        expect(target.requests).toHaveLength(0);
    });

    test('a malformed body is unavailable rather than a partial dialog', async () => {
        const gateway = stubGateway(() => Response.json({ messages: 'not-an-array' }));
        const result = await readRemoteDialog(deps(gateway.port));
        expect(result).toEqual({ status: 'unavailable', reason: 'remote thread body is not an inbox message list' });
    });

    test('invalid JSON is unavailable without throwing', async () => {
        const gateway = stubGateway(() => new Response('{'));
        expect(await readRemoteDialog(deps(gateway.port))).toEqual({
            status: 'unavailable',
            reason: 'remote thread body is not an inbox message list',
        });
    });

    test('a slow peer hits the 2 s budget and reports a timeout', async () => {
        const gateway = stubGateway(async () => {
            await Bun.sleep(2_500);
            return Response.json([message('m1', 1000)]);
        });
        const result = await readRemoteDialog(deps(gateway.port));
        expect(result.status).toBe('unavailable');
        if (result.status !== 'unavailable') return;
        expect(result.reason).toContain('timed out after 2000 ms');
    }, 15_000);

    test('a missing remote context id is unavailable, not a fetch', async () => {
        const gateway = stubGateway(() => Response.json([]));
        const result = await readRemoteDialog(deps(gateway.port, { remoteContextId: null }));
        expect(result.status).toBe('unavailable');
        expect(gateway.requests).toHaveLength(0);
    });
});
