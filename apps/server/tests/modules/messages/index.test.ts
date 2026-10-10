import { describe, expect, test } from 'bun:test';
import type { AgentCoordinationService, InboxResult, RecentMessagesResult, SendResult } from '@gobing-ai/spur-app';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { messagesModule } from '../../../src/modules/messages';

/**
 * Build a stub ServerContext whose coordination() returns canned inbox + recent results
 * and records the args it was called with. Unchecked cast — the module only touches
 * `coordination()`, so a partial object is sufficient and avoids dragging in every
 * ServerContext member.
 */
function ctxWithStubs(
    opts: {
        inbox?: InboxResult;
        recent?: RecentMessagesResult;
        /** When set, sendMessage throws this Error (simulates validation failure). */
        sendThrows?: Error;
        /** When set, replyToMessage throws this Error (simulates missing original). */
        replyThrows?: Error;
        /** Served project cwd (0844 projectPath guard). */
        cwd?: string;
    } = {},
): {
    ctx: ServerContext;
    calls: {
        inbox: Array<{ agent?: string; limit?: number; offset?: number }>;
        recent: Array<{ limit?: number }>;
        send: Array<{ from: string | null; to: string; body: string; requestKey?: string }>;
        reply: Array<{ id: string; body: string }>;
    };
} {
    const calls = {
        inbox: [] as Array<{ agent?: string; limit?: number; offset?: number }>,
        recent: [] as Array<{ limit?: number }>,
        send: [] as Array<{ from: string | null; to: string; body: string; requestKey?: string }>,
        reply: [] as Array<{ id: string; body: string }>,
    };
    const coordination = {
        getInbox: async (agent: string, limit?: number, offset?: number) => {
            calls.inbox.push({ agent, limit, offset });
            return opts.inbox ?? { messages: [], count: 0 };
        },
        listRecent: async (limit?: number) => {
            calls.recent.push({ limit });
            return opts.recent ?? { messages: [], count: 0 };
        },
        sendMessage: async (
            from: string | null,
            to: string,
            body: string,
            _replyTo?: string,
            requestKey?: string,
        ): Promise<SendResult> => {
            calls.send.push({ from, to, body, requestKey });
            if (opts.sendThrows) throw opts.sendThrows;
            return { msgId: `msg-${calls.send.length}`, toId: to, status: 'queued', injected: false };
        },
        replyToMessage: async (id: string, body: string): Promise<SendResult> => {
            calls.reply.push({ id, body });
            if (opts.replyThrows) throw opts.replyThrows;
            return { msgId: `reply-${calls.reply.length}`, toId: 'sender', status: 'queued', injected: false };
        },
    } as unknown as AgentCoordinationService;
    const ctx = { cwd: opts.cwd ?? '/repo/wt', coordination: () => coordination } as unknown as ServerContext;
    return { ctx, calls };
}

describe('messages module', () => {
    test('POST forwards the request key and rejects invalid keys before sending', async () => {
        const { ctx, calls } = ctxWithStubs();
        const app = new Hono();
        messagesModule.mount(app, ctx);
        for (const requestKey of ['key-1', '', 17]) {
            const response = await app.request('/api/messages', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ to: 'worker', body: 'work', requestKey }),
            });
            expect(response.status).toBe(requestKey === 'key-1' ? 201 : 400);
        }
        expect(calls.send).toEqual([{ from: null, to: 'worker', body: 'work', requestKey: 'key-1' }]);
    });

    describe('GET /api/messages/inbox', () => {
        test('returns 400 when agent query param is missing', async () => {
            const { ctx } = ctxWithStubs({});
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/messages/inbox'));
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('agent');
        });

        test('forwards agent + limit + offset to coordination().getInbox and returns its result', async () => {
            const inbox: InboxResult = {
                messages: [
                    {
                        id: 'm1',
                        fromId: 'agent-a',
                        body: 'hello',
                        status: 'delivered',
                        createdAt: '2026-07-04T10:00:00.000Z',
                        inReplyTo: null,
                    },
                ],
                count: 1,
            };
            const { ctx, calls } = ctxWithStubs({ inbox });
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages/inbox?agent=agent-b&limit=10&offset=5'),
            );
            expect(res.status).toBe(200);
            const body = (await res.json()) as InboxResult;
            expect(body).toEqual(inbox);
            expect(calls.inbox).toEqual([{ agent: 'agent-b', limit: 10, offset: 5 }]);
        });

        test('default limit is 50, clamped to max 500; offset omitted when not provided', async () => {
            const { ctx, calls } = ctxWithStubs({});
            const app = new Hono();
            messagesModule.mount(app, ctx);

            await app.fetch(new Request('http://localhost/api/messages/inbox?agent=x'));
            expect(calls.inbox[0]?.limit).toBe(50);
            expect(calls.inbox[0]?.offset).toBeUndefined();

            await app.fetch(new Request('http://localhost/api/messages/inbox?agent=x&limit=9999'));
            expect(calls.inbox[1]?.limit).toBe(500);
        });
    });

    describe('GET /api/messages', () => {
        test('returns global recent feed newest-first and forwards clamped limit', async () => {
            const recent: RecentMessagesResult = {
                messages: [
                    {
                        id: 'm2',
                        fromId: null,
                        toId: 'agent-c',
                        body: 'system notice',
                        status: 'delivered',
                        createdAt: '2026-07-04T11:00:00.000Z',
                        inReplyTo: null,
                        to: { agentId: 'agent-c' },
                        hasReply: false,
                        replyCount: 0,
                    },
                ],
                count: 1,
            };
            const { ctx, calls } = ctxWithStubs({ recent });
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(new Request('http://localhost/api/messages?limit=25'));
            expect(res.status).toBe(200);
            const body = (await res.json()) as RecentMessagesResult;
            expect(body).toEqual(recent);
            expect(calls.recent).toEqual([{ limit: 25 }]);
        });

        test('default limit is 50, clamped to max 500', async () => {
            const { ctx, calls } = ctxWithStubs({});
            const app = new Hono();
            messagesModule.mount(app, ctx);

            await app.fetch(new Request('http://localhost/api/messages'));
            expect(calls.recent[0]?.limit).toBe(50);

            await app.fetch(new Request('http://localhost/api/messages?limit=9999'));
            expect(calls.recent[1]?.limit).toBe(500);

            // Non-numeric falls back to default.
            await app.fetch(new Request('http://localhost/api/messages?limit=abc'));
            expect(calls.recent[2]?.limit).toBe(50);
        });
    });

    describe('POST /api/messages', () => {
        test('forwards from/to/body to coordination().sendMessage and returns 201', async () => {
            const { ctx, calls } = ctxWithStubs();
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ to: 'planner', body: 'hello', from: 'coder' }),
                }),
            );
            expect(res.status).toBe(201);
            const body = (await res.json()) as SendResult;
            expect(body.toId).toBe('planner');
            expect(body.status).toBe('queued');
            // The server POST path uses the same AgentCoordinationService method as the CLI — events fire identically.
            expect(calls.send).toEqual([{ from: 'coder', to: 'planner', body: 'hello' }]);
        });

        test('from defaults to null (operator-originated) when omitted', async () => {
            const { ctx, calls } = ctxWithStubs();
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ to: 'planner', body: 'hi' }),
                }),
            );
            expect(res.status).toBe(201);
            expect(calls.send[0]?.from).toBeNull();
        });

        test('rejects 400 when "to" is missing', async () => {
            const { ctx } = ctxWithStubs();
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ body: 'hi' }),
                }),
            );
            expect(res.status).toBe(400);
        });

        test('rejects 400 on malformed JSON body', async () => {
            const { ctx } = ctxWithStubs();
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: 'not-json',
                }),
            );
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('JSON');
        });

        test('surfaces AgentCoordinationService validation errors as 400', async () => {
            const { ctx } = ctxWithStubs({ sendThrows: new Error('Invalid agent id') });
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ to: 'bad id!', body: 'hi' }),
                }),
            );
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('Invalid agent id');
        });
    });

    describe('POST /api/messages/:id/reply', () => {
        test('forwards id + body to coordination().replyToMessage and returns 201', async () => {
            const { ctx, calls } = ctxWithStubs();
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages/msg-1/reply', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ body: 'ack' }),
                }),
            );
            expect(res.status).toBe(201);
            expect(calls.reply).toEqual([{ id: 'msg-1', body: 'ack' }]);
        });

        test('surfaces a missing original message as 400 (thread integrity via API)', async () => {
            const { ctx } = ctxWithStubs({ replyThrows: new Error('No message found with id "x"') });
            const app = new Hono();
            messagesModule.mount(app, ctx);

            const res = await app.fetch(
                new Request('http://localhost/api/messages/x/reply', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ body: 'ack' }),
                }),
            );
            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain('No message found');
        });
    });

    test('module is a no-op when ctx is undefined (Cloudflare Workers gate)', () => {
        const app = new Hono();
        // Should not throw and should register no routes.
        messagesModule.mount(app, undefined);
        // Nothing to assert beyond "did not throw"; route absence verified by fetch 404.
    });
});

// ── 0844 R4: project-scoped requests ──

describe('POST /api/messages projectPath guard (0844 R4)', () => {
    function app(ctx: ServerContext): Hono {
        const hono = new Hono();
        messagesModule.mount(hono, ctx);
        return hono;
    }

    test('matching projectPath is accepted and forwarded to AgentCoordinationService', async () => {
        const { ctx, calls } = ctxWithStubs({ cwd: '/repo/wt' });
        const res = await app(ctx).request('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: 'lead',
                from: 'board-operator',
                body: 'hi',
                requestKey: 'rk-1',
                projectPath: '/repo/wt',
            }),
        });
        expect(res.status).toBe(201);
        expect(calls.send).toHaveLength(1);
        expect(calls.send[0]?.requestKey).toBe('rk-1');
    });

    test('mismatched projectPath → 409 and NO row written', async () => {
        const { ctx, calls } = ctxWithStubs({ cwd: '/repo/wt' });
        const res = await app(ctx).request('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: 'lead',
                from: 'board-operator',
                body: 'hi',
                requestKey: 'rk-1',
                projectPath: '/other/project',
            }),
        });
        expect(res.status).toBe(409);
        const payload = (await res.json()) as { error?: string };
        expect(payload.error).toContain('project mismatch');
        expect(payload.error).toContain('/other/project');
        expect(calls.send).toHaveLength(0); // no row, no AgentCoordinationService traffic
    });

    test('absent projectPath keeps working (CLI + Inbox module parity)', async () => {
        const { ctx, calls } = ctxWithStubs({ cwd: '/repo/wt' });
        const res = await app(ctx).request('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'lead', body: 'plain message' }),
        });
        expect(res.status).toBe(201);
        expect(calls.send).toHaveLength(1);
    });

    test('present-but-empty projectPath → 400 (validated when present)', async () => {
        const { ctx, calls } = ctxWithStubs({ cwd: '/repo/wt' });
        const res = await app(ctx).request('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: 'lead', body: 'hi', projectPath: '' }),
        });
        expect(res.status).toBe(400);
        expect(calls.send).toHaveLength(0);
    });
});

// ─── 1164: the inbox offset is a position, not a page size ───────────────────────────────────

describe('GET /api/messages/inbox offset parsing (1164)', () => {
    const appFor = (ctx: ServerContext): Hono => {
        const app = new Hono();
        messagesModule.mount(app, ctx);
        return app;
    };
    const inboxRequest = (query: string) => new Request(`http://localhost/api/messages/inbox?agent=agent-b&${query}`);
    const offsetOf = (calls: { inbox: Array<{ offset?: number }> }) => calls.inbox[0]?.offset;
    const limitOf = (calls: { inbox: Array<{ limit?: number }> }) => calls.inbox[0]?.limit;

    /** Deterministic newest-first corpus: id-0000 (newest) … id-1199 (oldest). */
    const entries = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
            id: `id-${String(i).padStart(4, '0')}`,
            fromId: 'sender',
            body: `message ${i}`,
            status: 'queued',
            createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
            inReplyTo: null,
        }));

    /** Pagination-aware fixture: the service slices the corpus by the received offset/limit. */
    function ctxWithPagedInbox(count: number): {
        ctx: ServerContext;
        calls: { inbox: Array<{ agent?: string; limit?: number; offset?: number }> };
    } {
        const all = entries(count);
        const calls = { inbox: [] as Array<{ agent?: string; limit?: number; offset?: number }> };
        const coordination = {
            getInbox: async (agent: string, limit?: number, offset?: number) => {
                calls.inbox.push({ agent, limit, offset });
                const start = offset ?? 0;
                const page = all.slice(start, start + (limit ?? all.length));
                return { messages: page, count: page.length };
            },
        } as unknown as AgentCoordinationService;
        return { ctx: { cwd: '/repo/wt', coordination: () => coordination } as unknown as ServerContext, calls };
    }

    test.each([
        ['omitted offset stays undefined', '', undefined],
        ['a blank offset is zero', 'offset=', 0],
        ['a whitespace-only offset is zero', `offset=${encodeURIComponent('   ')}`, 0],
        ['a negative offset is zero', 'offset=-5', 0],
        ['an explicit plus sign is zero', `offset=${encodeURIComponent('+5')}`, 0],
        ['a fraction is zero', 'offset=1.5', 0],
        ['exponent notation is zero', 'offset=1e3', 0],
        ['hex notation is zero', 'offset=0x10', 0],
        ['trailing text is zero', `offset=${encodeURIComponent('12abc')}`, 0],
        ['an unsafe integer is zero', `offset=${Number.MAX_SAFE_INTEGER + 2}`, 0],
    ])('%s', async (_label, query, expected) => {
        const { ctx, calls } = ctxWithStubs();
        const res = await appFor(ctx).request(inboxRequest(query));
        expect(res.status).toBe(200);
        expect(offsetOf(calls)).toBe(expected);
    });

    test.each([500, 550, 1000])('offset %i is forwarded unchanged, past the page-size ceiling', async (offset) => {
        const { ctx, calls } = ctxWithStubs();
        const res = await appFor(ctx).request(inboxRequest(`limit=25&offset=${offset}`));
        expect(res.status).toBe(200);
        expect(offsetOf(calls)).toBe(offset);
    });

    test('a leading-zero offset and the maximum safe integer both round-trip', async () => {
        const first = ctxWithStubs();
        await appFor(first.ctx).request(inboxRequest('offset=00550'));
        expect(offsetOf(first.calls)).toBe(550);
        const last = ctxWithStubs();
        await appFor(last.ctx).request(inboxRequest(`offset=${Number.MAX_SAFE_INTEGER}`));
        expect(offsetOf(last.calls)).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('the page-size ceiling is independent of the offset (limit 9999 → 500, offset 1000 → 1000)', async () => {
        const { ctx, calls } = ctxWithStubs();
        await appFor(ctx).request(inboxRequest('limit=9999&offset=1000'));
        expect(limitOf(calls)).toBe(500);
        expect(offsetOf(calls)).toBe(1000);
    });

    test('AC1: successive offsets return distinct pages from a pagination-aware fixture', async () => {
        const { ctx, calls } = ctxWithPagedInbox(1200);
        const page = async (offset: number): Promise<string[]> => {
            const res = await appFor(ctx).request(inboxRequest(`limit=25&offset=${offset}`));
            const body = (await res.json()) as { messages: Array<{ id: string }>; count: number };
            expect(body.count).toBe(25);
            return body.messages.map((m) => m.id);
        };
        const [p500, p550, p1000] = [await page(500), await page(550), await page(1000)];
        expect(calls.inbox.map((c) => c.offset)).toEqual([500, 550, 1000]);
        expect(p500[0]).toBe('id-0500');
        expect(p550[0]).toBe('id-0550');
        expect(p1000[0]).toBe('id-1000');
        expect(new Set([...p500, ...p550, ...p1000]).size).toBe(75);
    });

    test('an offset past the end returns an empty page, never a wrapped or repeated one', async () => {
        const { ctx, calls } = ctxWithPagedInbox(1200);
        const res = await appFor(ctx).request(inboxRequest('limit=25&offset=5000'));
        expect(offsetOf(calls)).toBe(5000);
        expect(await res.json()).toEqual({ messages: [], count: 0 });
    });

    test('the global recent feed keeps its own clamped limit and no offset', async () => {
        const { ctx, calls } = ctxWithStubs();
        const app = appFor(ctx);
        await app.request(new Request('http://localhost/api/messages?limit=9999'));
        expect(calls.recent[0]?.limit).toBe(500);
        expect(JSON.stringify(calls.recent[0])).not.toContain('offset');
    });
});
