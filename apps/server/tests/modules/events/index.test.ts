import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { eventsModule, sendKeepalive } from '../../../src/modules/events';
import { SYSTEM_EVENT_STREAMED_NAMES } from '../../../src/modules/events/event-names';

describe('eventsModule', () => {
    test('is a valid ServerModule with name "events"', () => {
        expect(eventsModule.name).toBe('events');
        expect(typeof eventsModule.mount).toBe('function');
    });

    test('mount is a no-op when ServerContext is undefined (Cloudflare Worker)', () => {
        const app = new Hono();
        // Should not throw — the module gates on missing ctx
        expect(() => eventsModule.mount(app, undefined)).not.toThrow();
    });

    test('registers GET /api/events/planning when ServerContext is provided', async () => {
        const app = new Hono();

        // Minimal ServerContext with a stub eventBus
        const ctx = {
            cwd: '/workspace/acme',
            systemEventProjectContext: () => ({ name: 'acme', root: '/workspace/acme' }),
            systemEventSecretValues: () => ['private-value'],
            eventBus: () => ({
                on: () => {},
                off: () => {},
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        // The route should be registered and respond with SSE headers
        const req = new Request('http://localhost/api/events/planning');
        const res = await app.fetch(req);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
        expect(res.headers.get('Cache-Control')).toBe('no-cache');
        // No explicit Connection header — the runtime owns this hop-by-hop header; setting
        // it caused ERR_INCOMPLETE_CHUNKED_ENCODING on Bun stream finalization.
        expect(res.headers.get('Connection')).toBeNull();
    });

    test('SSE stream sends initial connected event', async () => {
        const app = new Hono();

        const ctx = {
            eventBus: () => ({
                on: () => {},
                off: () => {},
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        const req = new Request('http://localhost/api/events/planning');
        const res = await app.fetch(req);

        expect(res.body).toBeDefined();
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();

        // Read the first chunk — should contain the connected event
        const { value } = await reader.read();
        reader.cancel();

        const text = decoder.decode(value);
        expect(text).toContain('eventName');
        expect(text).toContain('connected');
    });

    test('SSE stream forwards bus events to the client', async () => {
        const app = new Hono();
        const handlers = new Map<string, Array<(event: unknown) => void>>();
        const offCalls: Array<{ name: string; handler: unknown }> = [];

        const ctx = {
            cwd: '/workspace/acme',
            systemEventProjectContext: () => ({ name: 'acme', root: '/workspace/acme' }),
            systemEventSecretValues: () => ['private-value'],
            eventBus: () => ({
                on: (name: string, handler: (event: unknown) => void) => {
                    if (!handlers.has(name)) handlers.set(name, []);
                    (handlers.get(name) as Array<(event: unknown) => void>).push(handler);
                },
                off: (name: string, handler: (event: unknown) => void) => {
                    offCalls.push({ name, handler });
                },
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        const req = new Request('http://localhost/api/events/planning');
        const res = await app.fetch(req);
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const decoder = new TextDecoder();

        // Consume the initial connected event
        await reader.read();

        // Fire a task.created event through the bus
        const taskCreatedHandler = handlers.get('task.created');
        expect(taskCreatedHandler).toBeDefined();
        const handler = taskCreatedHandler as Array<(event: unknown) => void>;
        expect(handler.length).toBe(1);

        const testEvent = {
            entity: { kind: 'task', id: '0001' },
            event: 'task.created',
            at: new Date().toISOString(),
            metadata: { token: 'private-value' },
        };
        handler[0]?.(testEvent);

        // Read the SSE output — should contain the forwarded event
        const { value: eventValue } = await reader.read();
        reader.cancel();

        const eventText = decoder.decode(eventValue);
        expect(eventText).toContain('task.created');
        expect(eventText).toContain('"entity"');
        expect(eventText).toContain('"schemaVersion":2');
        expect(eventText).toContain('"name":"acme"');
        expect(eventText).not.toContain('private-value');
    });

    test('cancel cleans up bus subscriptions', async () => {
        const app = new Hono();
        const handlers = new Map<string, Array<(event: unknown) => void>>();
        const offCalls: Array<{ name: string; handler: unknown }> = [];

        const ctx = {
            eventBus: () => ({
                on: (name: string, handler: (event: unknown) => void) => {
                    if (!handlers.has(name)) handlers.set(name, []);
                    (handlers.get(name) as Array<(event: unknown) => void>).push(handler);
                },
                off: (name: string, handler: (event: unknown) => void) => {
                    offCalls.push({ name, handler });
                },
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        const req = new Request('http://localhost/api/events/planning');
        const res = await app.fetch(req);
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();

        // Consume the connected event, then cancel the stream
        await reader.read();
        await reader.cancel();

        // After cancel, every registered event handler should be unsubscribed.
        expect(offCalls.length).toBe(SYSTEM_EVENT_STREAMED_NAMES.length);
        const offNames = offCalls.map((c) => c.name).sort();
        expect(offNames).toEqual([...SYSTEM_EVENT_STREAMED_NAMES].sort());
    });

    test('client disconnect (request abort) tears down subscriptions and closes the stream', async () => {
        const app = new Hono();
        const handlers = new Map<string, Array<(event: unknown) => void>>();
        const offCalls: Array<{ name: string }> = [];

        const ctx = {
            eventBus: () => ({
                on: (name: string, handler: (event: unknown) => void) => {
                    if (!handlers.has(name)) handlers.set(name, []);
                    (handlers.get(name) as Array<(event: unknown) => void>).push(handler);
                },
                off: (name: string) => {
                    offCalls.push({ name });
                },
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        // Drive the request with an AbortController so we can simulate the client leaving.
        const controller = new AbortController();
        const req = new Request('http://localhost/api/events/planning', { signal: controller.signal });
        const res = await app.fetch(req);
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();

        // Consume the connected event so the stream is live, then abort (client disconnect).
        await reader.read();
        controller.abort();

        // The stream closes cleanly (no error), and all subscriptions are detached.
        const { done } = await reader.read();
        expect(done).toBe(true);
        expect(offCalls.length).toBe(SYSTEM_EVENT_STREAMED_NAMES.length);
    });

    test('does not double-tear-down when both abort and cancel fire', async () => {
        const app = new Hono();
        const offCalls: Array<{ name: string }> = [];
        const ctx = {
            eventBus: () => ({
                on: () => {},
                off: (name: string) => {
                    offCalls.push({ name });
                },
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        const controller = new AbortController();
        const req = new Request('http://localhost/api/events/planning', { signal: controller.signal });
        const res = await app.fetch(req);
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        await reader.read();

        // Abort then cancel — teardown is idempotent, so off() fires exactly once per registered event.
        controller.abort();
        await reader.cancel();
        expect(offCalls.length).toBe(SYSTEM_EVENT_STREAMED_NAMES.length);
    });

    test('SSE stream tears down immediately when signal is already aborted', async () => {
        const app = new Hono();
        const offCalls: Array<{ name: string }> = [];
        const ctx = {
            eventBus: () => ({
                on: () => {},
                off: (name: string) => {
                    offCalls.push({ name });
                },
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        // Create a request whose signal is already aborted before the fetch.
        const ac = new AbortController();
        ac.abort();
        const req = new Request('http://localhost/api/events/planning', { signal: ac.signal });
        const res = await app.fetch(req);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');

        // The stream should close immediately since signal.aborted === true in start().
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        const { done } = await reader.read();
        expect(done).toBe(true);
        // No subscriptions should have been registered — teardown fires but there's
        // nothing to clean up (off() was never preceded by on()).
        expect(offCalls.length).toBe(0);
    });
    test('mount subscribes the diagnostic tier when bootConfig.events.diagnostic is true', async () => {
        const onCalls: string[] = [];
        const app = new Hono();
        const ctx = {
            eventBus: () => ({
                on: (event: string) => {
                    onCalls.push(event);
                },
                off: () => {},
            }),
            bootConfig: () => ({
                events: { enabled: true, diagnostic: true },
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        // Hit the SSE endpoint once so start() runs and subscribes the bus;
        // read once and cancel to drive start() then let teardown close.
        const req = new Request('http://localhost/api/events/planning');
        const res = await app.fetch(req);
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        await reader.read().catch(() => undefined);
        reader.cancel();

        // Diagnostic events like `bus.handler.error` should be subscribed
        // alongside the default tier when the toggle is on.
        expect(onCalls).toContain('bus.handler.error');
        expect(onCalls).toContain('bus.emit.done');
        // Sanity check: a default-tier event is also present.
        const firstDefault = SYSTEM_EVENT_STREAMED_NAMES[0];
        if (firstDefault) expect(onCalls).toContain(firstDefault);
    });

    test('mount skips the diagnostic tier when bootConfig is absent (test ctx fallback)', async () => {
        const onCalls: string[] = [];
        const app = new Hono();
        const ctx = {
            eventBus: () => ({
                on: (event: string) => {
                    onCalls.push(event);
                },
                off: () => {},
            }),
        } as unknown as ServerContext;

        eventsModule.mount(app, ctx);

        const req = new Request('http://localhost/api/events/planning');
        const res = await app.fetch(req);
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        await reader.read().catch(() => undefined);
        reader.cancel();

        expect(onCalls).not.toContain('bus.handler.error');
        // Default-tier events are subscribed regardless.
        const firstDefault = SYSTEM_EVENT_STREAMED_NAMES[0];
        if (firstDefault) expect(onCalls).toContain(firstDefault);
    });
});

describe('sendKeepalive', () => {
    test('enqueues heartbeat comment', () => {
        const closed = { current: false };
        const encoder = new TextEncoder();
        const enqueued: Uint8Array[] = [];
        const controller = {
            enqueue: (data: Uint8Array) => {
                enqueued.push(data);
            },
        } as unknown as ReadableStreamDefaultController;
        sendKeepalive(closed, controller, encoder);
        expect(enqueued.length).toBe(1);
        const decoder = new TextDecoder();
        expect(decoder.decode(enqueued[0])).toBe(': keepalive\n\n');
    });

    test('is a no-op when closed', () => {
        const closed = { current: true };
        const enqueued: Uint8Array[] = [];
        const controller = {
            enqueue: (data: Uint8Array) => {
                enqueued.push(data);
            },
        } as unknown as ReadableStreamDefaultController;
        sendKeepalive(closed, controller, new TextEncoder());
        expect(enqueued.length).toBe(0);
    });

    test('the ledger relay re-emits a message row written by another process (G11 R5)', async () => {
        // The server's own InboxService is bus-less, and an agent CLI process writes the same
        // ledger rows without touching this process's bus. Following `system_events` is the only
        // channel that sees both, so this test writes a row the way an agent process would and
        // asserts it surfaces on the bus exactly once.
        const { createMigratedDb, SystemEventDao } = await import('@gobing-ai/spur-domain');
        const db = await createMigratedDb({ url: ':memory:' });
        const seen: Array<{ name: string; payload: unknown }> = [];
        const bus = {
            on: () => {},
            off: () => {},
            emit: (name: string, payload: unknown) => {
                seen.push({ name, payload });
            },
        };
        const ctx = {
            cwd: '/workspace/acme',
            getDb: async () => db,
            systemEventDao: async () => new SystemEventDao(db),
            systemEventProjectContext: () => ({ name: 'acme', root: '/workspace/acme' }),
            systemEventSecretValues: () => [],
            eventBus: () => bus,
        } as unknown as ServerContext;

        const app = new Hono();
        eventsModule.mount(app, ctx);
        // Let the relay take its boot snapshot first: rows written BEFORE it are history (the
        // history endpoint replays those), so this row must land after it to be a live event.
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Written AFTER boot, like an agent process replying mid-session.
        await new SystemEventDao(db).insert({
            id: 'sev_relay_1',
            event_name: 'message.replied',
            occurred_at: new Date().toISOString(),
            actor: 'proj-coder',
            payload_json: JSON.stringify({ msgId: 'msg_relay_1', fromId: 'proj-coder', toId: 'operator' }),
        });

        // The relay polls the ledger; give it a bounded window rather than a fixed sleep.
        for (let attempt = 0; attempt < 50 && seen.length === 0; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(seen.map((event) => event.name)).toEqual(['message.replied']);
        expect(seen[0]?.payload).toMatchObject({ msgId: 'msg_relay_1' });

        // Exactly once: a second poll must not re-emit the same row.
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(seen).toHaveLength(1);
        db.close();
    });

    test('a relayed stored envelope renders live exactly as history renders the same row (1267 #7/#8)', async () => {
        // The stored-v2 branch: InboxService persists the v2 envelope, and the ledger `actor`
        // column carries the member. Without the relay's column lookup the live frame showed
        // `actor: null` / no agent chip and a fresh `occurredAt`, while history showed both.
        const { createMigratedDb, SystemEventDao } = await import('@gobing-ai/spur-domain');
        const { EventBus } = await import('@gobing-ai/ts-infra');
        const { buildSystemEventEnvelope, systemEventCatalogEntry } = await import(
            '../../../src/modules/events/event-names'
        );
        const db = await createMigratedDb({ url: ':memory:' });
        const project = { name: 'acme', root: '/workspace/acme' };
        const bus = new EventBus<Record<string, (event: unknown) => void>>();
        const ctx = {
            cwd: '/workspace/acme',
            getDb: async () => db,
            systemEventDao: async () => new SystemEventDao(db),
            systemEventProjectContext: () => project,
            systemEventSecretValues: () => [],
            eventBus: () => bus,
        } as unknown as ServerContext;

        const app = new Hono();
        eventsModule.mount(app, ctx);
        const res = await app.fetch(new Request('http://localhost/api/events/planning'));
        const reader = (res.body as ReadableStream<Uint8Array>).getReader();
        await new Promise((resolve) => setTimeout(resolve, 250));

        const occurredAt = '2026-01-02T03:04:05.000Z';
        const stored = buildSystemEventEnvelope(
            systemEventCatalogEntry('message.replied'),
            { msgId: 'msg_relay_2', fromId: 'proj-coder', toId: 'operator', threadId: 'msg_root', status: 'queued' },
            project,
            [],
            'proj-coder',
        );
        expect(stored).toHaveProperty('schemaVersion');
        await new SystemEventDao(db).insert({
            id: 'sev_relay_2',
            event_name: 'message.replied',
            occurred_at: occurredAt,
            actor: 'proj-coder',
            payload_json: JSON.stringify(stored),
        });

        const decoder = new TextDecoder();
        let buffered = '';
        let live: Record<string, unknown> | undefined;
        const deadline = Date.now() + 3000;
        while (live === undefined && Date.now() < deadline) {
            const chunk = await Promise.race([
                reader.read(),
                new Promise<{ value: undefined }>((resolve) => setTimeout(() => resolve({ value: undefined }), 100)),
            ]);
            if (chunk.value !== undefined) buffered += decoder.decode(chunk.value);
            for (const frame of buffered.split('\n\n')) {
                if (!frame.startsWith('data: ')) continue;
                const parsed = JSON.parse(frame.slice(6)) as Record<string, unknown>;
                if (parsed.eventName === 'message.replied') live = parsed;
            }
        }
        await reader.cancel();

        const history = (await (
            await app.fetch(new Request('http://localhost/api/events/history?name=message.replied'))
        ).json()) as { events: Array<Record<string, unknown>> };
        const historic = history.events[0];

        expect(live).toBeDefined();
        expect(historic).toBeDefined();
        expect(live?.actor).toBe('proj-coder');
        expect(live?.occurredAt).toBe(occurredAt);
        expect(live?.actor).toBe(historic?.actor);
        expect(live?.occurredAt).toBe(historic?.occurredAt);
        // Same projection: summary, fields, data and the agent chip agree byte-for-byte.
        expect(live?.payload).toEqual(historic?.payload);
        db.close();
    });
});
