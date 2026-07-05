import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { eventsModule, sendKeepalive } from '../../../src/modules/events';
import { PLANNING_EVENT_NAMES } from '../../../src/modules/events/event-names';

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

        const testEvent = { entity: { kind: 'task', id: '0001' }, event: 'task.created', at: new Date().toISOString() };
        handler[0]?.(testEvent);

        // Read the SSE output — should contain the forwarded event
        const { value: eventValue } = await reader.read();
        reader.cancel();

        const eventText = decoder.decode(eventValue);
        expect(eventText).toContain('task.created');
        expect(eventText).toContain('"entity"');
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
        expect(offCalls.length).toBe(PLANNING_EVENT_NAMES.length);
        const offNames = offCalls.map((c) => c.name).sort();
        expect(offNames).toEqual([...PLANNING_EVENT_NAMES].sort());
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
        expect(offCalls.length).toBe(PLANNING_EVENT_NAMES.length);
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
        expect(offCalls.length).toBe(PLANNING_EVENT_NAMES.length);
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
});
