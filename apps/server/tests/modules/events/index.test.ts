import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { eventsModule, sendKeepalive } from '../../../src/modules/events';

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
        expect(res.headers.get('Connection')).toBe('keep-alive');
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

        // After cancel, all 6 event handlers should be unsubscribed
        expect(offCalls.length).toBe(6);
        const offNames = offCalls.map((c) => c.name).sort();
        expect(offNames).toEqual([
            'feature.created',
            'feature.transitioned',
            'feature.updated',
            'task.created',
            'task.transitioned',
            'task.updated',
        ]);
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
