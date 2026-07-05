import { describe, expect, test } from 'bun:test';
import type { InboxResult, RecentMessagesResult, SendResult, TeamService } from '@gobing-ai/spur-app';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { messagesModule } from '../../../src/modules/messages';

/**
 * Build a stub ServerContext whose teamService returns canned inbox + recent results
 * and records the args it was called with. Unchecked cast — the module only touches
 * `teamService()`, so a partial object is sufficient and avoids dragging in every
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
    } = {},
): {
    ctx: ServerContext;
    calls: {
        inbox: Array<{ agent?: string; limit?: number; offset?: number }>;
        recent: Array<{ limit?: number }>;
        send: Array<{ from: string | null; to: string; body: string }>;
        reply: Array<{ id: string; body: string }>;
    };
} {
    const calls = {
        inbox: [] as Array<{ agent?: string; limit?: number; offset?: number }>,
        recent: [] as Array<{ limit?: number }>,
        send: [] as Array<{ from: string | null; to: string; body: string }>,
        reply: [] as Array<{ id: string; body: string }>,
    };
    const teamService = {
        getInbox: async (agent: string, limit?: number, offset?: number) => {
            calls.inbox.push({ agent, limit, offset });
            return opts.inbox ?? { messages: [], count: 0 };
        },
        listRecent: async (limit?: number) => {
            calls.recent.push({ limit });
            return opts.recent ?? { messages: [], count: 0 };
        },
        sendMessage: async (from: string | null, to: string, body: string): Promise<SendResult> => {
            calls.send.push({ from, to, body });
            if (opts.sendThrows) throw opts.sendThrows;
            return { msgId: `msg-${calls.send.length}`, toId: to, status: 'queued', injected: false };
        },
        replyToMessage: async (id: string, body: string): Promise<SendResult> => {
            calls.reply.push({ id, body });
            if (opts.replyThrows) throw opts.replyThrows;
            return { msgId: `reply-${calls.reply.length}`, toId: 'sender', status: 'queued', injected: false };
        },
    } as unknown as TeamService;
    const ctx = { teamService: () => teamService } as unknown as ServerContext;
    return { ctx, calls };
}

describe('messages module', () => {
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

        test('forwards agent + limit + offset to teamService.getInbox and returns its result', async () => {
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
        test('forwards from/to/body to teamService.sendMessage and returns 201', async () => {
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
            // The server POST path uses the same TeamService method as the CLI — events fire identically.
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

        test('surfaces TeamService validation errors as 400', async () => {
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
        test('forwards id + body to teamService.replyToMessage and returns 201', async () => {
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
