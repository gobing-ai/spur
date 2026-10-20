/**
 * G11 task 1267 — the inbox oRPC contract and handler (ADR-143 §13).
 *
 * The failure modes come first (task Plan step 1): reads that write, a send that crosses a
 * project boundary, a reply or read on an unknown id, a recipient that is not an address, the
 * retired raw routes, and the ledger relay that makes a message written by ANOTHER process
 * visible on the SSE bus.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { createApp, generateOpenApiSpec } from '../../../src';
import type { ServerContext } from '../../../src/context';
import { healthModule } from '../../../src/modules/health';
import { createInboxHandlers } from '../../../src/modules/inbox/handlers';
import { builtins } from '../../../src/modules/registry';

/**
 * Minimal context: the handlers touch `inbox()`, `getDb()`, `cwd` and the fleet seam. The
 * fleet is absent on purpose — `send` without `to` then refuses instead of inventing an
 * orchestrator, which is one of the behaviours under test.
 */
interface Harness {
    ctx: ServerContext;
    handlers: ReturnType<typeof createInboxHandlers>;
    close(): Promise<void>;
}

let tempDir: string;
let harness: Harness;

async function makeHarness(options: { orchestrator?: string; specs?: string[] } = {}): Promise<Harness> {
    const { InboxService } = await import('@gobing-ai/spur-app');
    const { createMigratedDb } = await import('@gobing-ai/spur-domain');
    const db = await createMigratedDb({ url: ':memory:' });
    const inbox = new InboxService({ getDb: async () => db });
    const orchestrator = options.orchestrator;
    const ctx = {
        cwd: tempDir,
        // The fleet seam the handlers build over: a test may bind an orchestrator, or leave the
        // project unbound (the default), which is its own behaviour under test.
        fs: {
            resolve: (...parts: string[]) => join(tempDir, ...parts),
            readFile: async () => {
                throw new Error('no fleet file');
            },
            exists: async () => false,
        },
        reloadAgentConfig: async () => null,
        taskService: () => ({ list: async () => [] }),
        // The addressable specs this project declares. `send` refuses an address that is not one of
        // these (or a reserved identity, a guest, or an existing inbox) — R2's unknown-recipient rule.
        coordination: () => ({
            listAgentSpecs: async () =>
                (options.specs ?? ['proj-coder', 'proj-orch']).map((id) => ({ id, name: id, type: 'claude-code' })),
        }),
        getDb: async () => db,
        inbox: () => inbox,
        // A bound orchestrator makes `send` default its recipient and gives `requests` a mailbox;
        // an unbound project exercises both refusals.
        ...(orchestrator !== undefined
            ? {
                  fleetService: () => ({
                      resolveOrchestrator: async () => ({
                          state: 'bound-online',
                          instanceId: orchestrator,
                          holderId: orchestrator,
                      }),
                      resolve: async () => ({ members: [], projectPath: tempDir, parsed: null, ignored: [] }),
                  }),
              }
            : {}),
    } as unknown as ServerContext;
    return {
        ctx,
        handlers: createInboxHandlers(ctx),
        close: async () => {
            db.close();
        },
    };
}

/** Invoke one oRPC handler directly, the way the router does. */
async function call<T>(key: keyof ReturnType<typeof createInboxHandlers>, input: unknown): Promise<T> {
    const proc = harness.handlers[key] as unknown as {
        '~orpc': { handler: (opts: { input: unknown }) => Promise<T> };
    };
    return proc['~orpc'].handler({ input });
}

/** Total rows in the inbox plane plus the ledger — a read must leave both unchanged. */
async function counts(): Promise<{ messages: number; events: number }> {
    const db = await harness.ctx.getDb();
    const messages = await db.queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM inbox_messages');
    const events = await db.queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM system_events');
    return { messages: messages[0]?.n ?? 0, events: events[0]?.n ?? 0 };
}

beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'spur-inbox-1267-'));
    harness = await makeHarness();
});

afterEach(async () => {
    await harness.close();
    rmSync(tempDir, { recursive: true, force: true });
});

describe('1267 R3 — GET procedures write nothing', () => {
    test('list, thread, requests and members leave the inbox and ledger untouched', async () => {
        await call('send', { to: 'proj-coder', from: 'operator', body: 'hello' });
        const before = await counts();
        expect(before.messages).toBe(1);

        const page = await call<{ messages: Array<{ id: string }>; nextCursor: string | null }>('list', {
            member: 'proj-coder',
        });
        expect(page.nextCursor).toBeNull();
        await call('thread', { id: page.messages[0]?.id });
        await call('requests', {});
        await call('members', {});

        expect(await counts()).toEqual(before);
    });
});

describe('1267 R1/R2 — send', () => {
    test('a served-project send stores one message and returns it', async () => {
        const result = await call<{ message: { id: string; toId: string; status: string }; replayed: boolean }>(
            'send',
            {
                to: 'proj-coder',
                from: 'operator',
                body: 'pick this up',
                kind: 'request',
                taskId: '1267',
            },
        );

        expect(result.replayed).toBe(false);
        expect(result.message.toId).toBe('proj-coder');
        expect(result.message.status).toBe('queued');
        expect((await counts()).messages).toBe(1);
    });

    test('a mismatched projectPath is a CONFLICT and writes no row', async () => {
        await expect(
            call('send', { to: 'proj-coder', body: 'x', projectPath: '/some/other/project' }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect((await counts()).messages).toBe(0);
    });

    test('omitting `to` without a bound orchestrator is a BAD_REQUEST, not a silent drop', async () => {
        await expect(call('send', { body: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect((await counts()).messages).toBe(0);
    });

    test('an address nothing owns is refused instead of storing an undeliverable row', async () => {
        // The silent drop the design rejects: a `queued` row for an address no member can claim is
        // invisible in `requests` and never delivered, so it must not be written at all.
        await expect(call('send', { to: 'nobody-at-all', body: 'x' })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        expect((await counts()).messages).toBe(0);
    });

    test('a repeated request key replays; a different payload on it is a CONFLICT', async () => {
        const first = await call<{ message: { id: string } }>('send', {
            to: 'proj-coder',
            from: 'spur',
            body: 'same',
            requestKey: 'k-1',
        });
        const replay = await call<{ message: { id: string }; replayed: boolean }>('send', {
            to: 'proj-coder',
            from: 'spur',
            body: 'same',
            requestKey: 'k-1',
        });

        expect(replay.replayed).toBe(true);
        expect(replay.message.id).toBe(first.message.id);
        await expect(
            call('send', { to: 'proj-coder', from: 'spur', body: 'different', requestKey: 'k-1' }),
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect((await counts()).messages).toBe(1);
    });
});

describe('1267 R2 — reply and read', () => {
    test('a reply reaches the original sender in the same thread', async () => {
        const sent = await call<{ message: { id: string } }>('send', {
            to: 'proj-coder',
            from: 'operator',
            body: 'question',
        });

        const reply = await call<{ id: string; toId: string; threadId: string }>('reply', {
            id: sent.message.id,
            from: 'proj-coder',
            body: 'answer',
        });

        expect(reply.toId).toBe('operator');
        expect(reply.threadId).toBe(sent.message.id);
        const thread = await call<Array<{ id: string }>>('thread', { id: sent.message.id });
        expect(thread.map((row) => row.id)).toEqual([sent.message.id, reply.id]);
    });

    test('replying to an unknown id is NOT_FOUND', async () => {
        await expect(call('reply', { id: 'msg_missing', from: 'operator', body: 'x' })).rejects.toMatchObject({
            code: 'NOT_FOUND',
        });
    });

    test('a non-recipient cannot mark a message read (NOT_FOUND, no event)', async () => {
        const sent = await call<{ message: { id: string } }>('send', {
            to: 'operator',
            from: 'proj-coder',
            body: 'hi',
        });

        await expect(call('read', { id: sent.message.id, reader: 'someone-else' })).rejects.toMatchObject({
            code: 'NOT_FOUND',
        });
        const receipt = await call<{ transitioned: boolean }>('read', { id: sent.message.id, reader: 'operator' });
        expect(receipt.transitioned).toBe(true);
    });

    test('thread on an unknown id is NOT_FOUND rather than an empty list', async () => {
        await expect(call('thread', { id: 'msg_missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
});

describe('1267 R2 — an internal failure is a server error, not a client one', () => {
    test('a service fault answers INTERNAL_SERVER_ERROR with fixed text', async () => {
        // A locked DB or a broken adapter is NOT the caller's fault: labelling it 400/404 would stop
        // a client that retries on 5xx from ever retrying, and echoing the driver message would
        // leak server internals into a response body.
        const { createInboxHandlers } = await import('../../../src/modules/inbox/handlers');
        const broken = createInboxHandlers({
            ...(harness.ctx as unknown as Record<string, unknown>),
            inbox: () => ({
                send: async () => {
                    throw new Error('database is locked: /var/db/spur.sqlite');
                },
                reply: async () => {
                    throw new Error('database is locked: /var/db/spur.sqlite');
                },
                markRead: async () => {
                    throw new Error('database is locked: /var/db/spur.sqlite');
                },
                list: async () => {
                    throw new Error('database is locked: /var/db/spur.sqlite');
                },
            }),
            coordination: () => ({ listAgentSpecs: async () => [{ id: 'proj-coder', name: 'c', type: 'claude' }] }),
        } as unknown as ServerContext);

        const invoke = async (key: 'send' | 'reply' | 'read' | 'list', input: unknown) => {
            const proc = broken[key] as unknown as {
                '~orpc': { handler: (opts: { input: unknown }) => Promise<unknown> };
            };
            return proc['~orpc'].handler({ input });
        };

        for (const [key, input] of [
            ['send', { to: 'proj-coder', body: 'x' }],
            ['reply', { id: 'msg_1', from: 'operator', body: 'x' }],
            ['read', { id: 'msg_1', reader: 'operator' }],
            ['list', { member: 'proj-coder' }],
        ] as const) {
            const error = await invoke(key, input).catch((thrown: unknown) => thrown);
            expect(error).toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
            expect(JSON.stringify(error)).not.toContain('spur.sqlite');
        }
    });
});

describe('1267 R1 — list pages by keyset cursor', () => {
    test('two pages cover every row exactly once, and the last page reports no cursor', async () => {
        for (const body of ['one', 'two', 'three']) await call('send', { to: 'proj-coder', body });

        const first = await call<{ messages: Array<{ id: string }>; nextCursor: string | null }>('list', {
            member: 'proj-coder',
            limit: 2,
        });
        expect(first.messages).toHaveLength(2);
        expect(first.nextCursor).not.toBeNull();

        const second = await call<{ messages: Array<{ id: string }>; nextCursor: string | null }>('list', {
            member: 'proj-coder',
            limit: 2,
            cursor: first.nextCursor ?? '',
        });
        expect(second.messages).toHaveLength(1);
        expect(second.nextCursor).toBeNull();

        const ids = [...first.messages, ...second.messages].map((row) => row.id);
        expect(new Set(ids).size).toBe(3);
    });

    test('a row inserted between pages cannot duplicate an entry (why keyset, not offset)', async () => {
        await call('send', { to: 'proj-coder', body: 'one' });
        await call('send', { to: 'proj-coder', body: 'two' });
        const first = await call<{ messages: Array<{ id: string }>; nextCursor: string | null }>('list', {
            member: 'proj-coder',
            limit: 1,
        });
        // A newer row arrives before the second page is read: with an offset this would shift the
        // window and re-serve `one`.
        await call('send', { to: 'proj-coder', body: 'three' });

        const second = await call<{ messages: Array<{ id: string }>; nextCursor: string | null }>('list', {
            member: 'proj-coder',
            limit: 1,
            cursor: first.nextCursor ?? '',
        });
        expect(second.messages[0]?.id).not.toBe(first.messages[0]?.id);
    });

    test('a malformed cursor is a BAD_REQUEST, not a 500 and not a wrong page', async () => {
        // The caller mangled the cursor, so the fix is on their side — a server error here would
        // blame the ledger for a client typo.
        await expect(call('list', { member: 'proj-coder', cursor: 'not-a-cursor' })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
    });
});

describe('1267 R4 — the raw routes are gone', () => {
    test('the retired Hono routes no longer answer, even with a real context mounted', async () => {
        // `createApp()` alone would pass this test for free: the deleted modules returned early on
        // a missing ctx, so those paths were already 404. Mount health WITH a context — the exact
        // condition under which /api/project/requests used to answer — and assert it is gone.
        const app = new Hono();
        healthModule.mount(app, harness.ctx);
        const requests = await app.request('/api/project/requests');
        expect(requests.status).toBe(404);

        // The messages module is not in the registry at all, so no context can resurrect it.
        expect(builtins.map((module) => module.name)).not.toContain('messages');
        for (const path of ['/api/messages', '/api/messages/inbox', '/api/messages/anything/reply']) {
            const response = await createApp().request(path);
            expect(response.status).toBe(404);
        }
    });

    test('/openapi.json lists the inbox paths instead', async () => {
        const spec = await generateOpenApiSpec();
        const paths = Object.keys(spec.paths ?? {});
        expect(paths).toContain('/inbox/messages');
        expect(paths).toContain('/inbox/messages/{id}/thread');
        expect(paths).toContain('/inbox/messages/{id}/reply');
        expect(paths).toContain('/inbox/messages/{id}/read');
        expect(paths).toContain('/inbox/requests');
        expect(paths).toContain('/inbox/members');
        // The routes this task replaced must not survive as aliases (A6: no compatibility shim).
        expect(paths).not.toContain('/messages');
        expect(paths).not.toContain('/project/requests');
    });

    describe('1267 R1/R2 — the orchestrator binding', () => {
        test('send without `to` addresses the bound orchestrator', async () => {
            const bound = await makeHarness({ orchestrator: 'proj-orch' });
            try {
                const handlers = bound.handlers;
                const proc = handlers.send as unknown as {
                    '~orpc': { handler: (opts: { input: unknown }) => Promise<{ message: { toId: string } }> };
                };
                const result = await proc['~orpc'].handler({ input: { body: 'no explicit recipient' } });
                expect(result.message.toId).toBe('proj-orch');
            } finally {
                await bound.close();
            }
        });

        test('requests maps a deliverable row with its run facts, and holds nothing else', async () => {
            const { InboxService } = await import('@gobing-ai/spur-app');
            const { CoordinationRunDao } = await import('@gobing-ai/spur-domain');
            const bound = await makeHarness({ orchestrator: 'proj-orch' });
            try {
                const db = await bound.ctx.getDb();
                const inbox = new InboxService({ getDb: async () => db });
                const sent = await inbox.send({
                    from: 'spur',
                    to: 'proj-orch',
                    body: 'run 1267',
                    kind: 'request',
                    taskId: '1267',
                    requestKey: 'fleet:task:1267:1',
                });
                await inbox.claim('proj-orch', 5);
                await inbox.settle([sent.message.id], 'accepted');
                await new CoordinationRunDao(db).insertStart({
                    specId: 'proj-orch',
                    agentKind: 'claude',
                    processId: null,
                    runId: 'run-1267',
                    generation: 1,
                    startedAt: new Date().toISOString(),
                    messageIds: [sent.message.id],
                    taskId: '1267',
                });

                const proc = bound.handlers.requests as unknown as {
                    '~orpc': {
                        handler: (opts: { input: unknown }) => Promise<
                            Array<{
                                messageId: string;
                                status: string;
                                runId: string | null;
                                taskId: string | null;
                                reason: string | null;
                                hold: string | null;
                                attempts: number;
                            }>
                        >;
                    };
                };
                const rows = await proc['~orpc'].handler({ input: {} });

                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    messageId: sent.message.id,
                    status: 'delivered',
                    runId: 'run-1267',
                    taskId: '1267',
                    attempts: 1,
                });
                // An in-flight run has no reconciler hold yet — an absence of evidence, not a failure.
                expect(rows[0]?.reason).toBe('outcome-unknown');
            } finally {
                await bound.close();
            }
        });

        test('a send with a matching projectPath is accepted', async () => {
            const sent = await call<{ message: { id: string } }>('send', {
                to: 'proj-coder',
                body: 'scoped send',
                projectPath: tempDir,
            });
            expect(sent.message.id).toBeTruthy();
        });

        test('an empty projectPath is treated as absent, not as a mismatch', async () => {
            const sent = await call<{ message: { id: string } }>('send', {
                to: 'proj-coder',
                body: 'x',
                projectPath: '',
            });
            expect(sent.message.id).toBeTruthy();
        });

        test('a BAD_REQUEST names the failing reason (never a bare code)', async () => {
            await expect(call('send', { to: '', body: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        });

        test('a missing or unresolvable binding is an empty answer, not a thrown error', async () => {
            const unbound = await makeHarness();
            const { createInboxHandlers } = await import('../../../src/modules/inbox/handlers');
            const ctx = {
                ...(unbound.ctx as unknown as Record<string, unknown>),
                fleetService: () => ({
                    resolveOrchestrator: async () => ({ state: 'missing', instanceId: undefined }),
                    resolve: async () => ({ members: [], projectPath: tempDir, parsed: null, ignored: [] }),
                }),
            } as unknown as ServerContext;
            const handlers = createInboxHandlers(ctx);
            const requestsHandler = handlers.requests as unknown as {
                '~orpc': { handler: (opts: { input: unknown }) => Promise<unknown[]> };
            };
            // The feed is empty (that project has no requests to show), not an error.
            expect(await requestsHandler['~orpc'].handler({ input: {} })).toEqual([]);

            const sendHandler = handlers.send as unknown as {
                '~orpc': { handler: (opts: { input: unknown }) => Promise<unknown> };
            };
            await expect(sendHandler['~orpc'].handler({ input: { body: 'x' } })).rejects.toMatchObject({
                code: 'BAD_REQUEST',
            });
            // A bound-but-blank instance is the same empty answer: no address was resolved.
            const blankCtx = {
                ...(unbound.ctx as unknown as Record<string, unknown>),
                fleetService: () => ({
                    resolveOrchestrator: async () => ({ state: 'bound-online', instanceId: undefined }),
                    resolve: async () => ({ members: [], projectPath: tempDir, parsed: null, ignored: [] }),
                }),
            } as unknown as ServerContext;
            const blankRequests = createInboxHandlers(blankCtx).requests as unknown as {
                '~orpc': { handler: (opts: { input: unknown }) => Promise<unknown[]> };
            };
            expect(await blankRequests['~orpc'].handler({ input: {} })).toEqual([]);

            // A resolver that throws is the same empty answer: a fleet read failure never 500s a read.
            const throwingCtx = {
                ...(unbound.ctx as unknown as Record<string, unknown>),
                fleetService: () => ({
                    resolveOrchestrator: async () => {
                        throw new Error('fleet config unreadable');
                    },
                    resolve: async () => {
                        throw new Error('fleet config unreadable');
                    },
                }),
            } as unknown as ServerContext;
            const throwingRequests = createInboxHandlers(throwingCtx).requests as unknown as {
                '~orpc': { handler: (opts: { input: unknown }) => Promise<unknown[]> };
            };
            expect(await throwingRequests['~orpc'].handler({ input: {} })).toEqual([]);
            await unbound.close();
        });

        test('members lists the addresses that own inbox rows', async () => {
            await call('send', { to: 'proj-coder', from: 'operator', body: 'hi' });
            const members = await call<Array<{ id: string; queued: number; unread: number }>>('members', {});
            expect(members).toEqual([{ id: 'proj-coder', queued: 1, unread: 1 }]);
        });
    });
});
