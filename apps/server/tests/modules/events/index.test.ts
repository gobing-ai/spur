import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { eventsModule } from '../../../src/modules/events';

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
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        // Read the first chunk — should contain the connected event
        const { value } = await reader.read();
        reader.cancel();

        const text = decoder.decode(value);
        expect(text).toContain('eventName');
        expect(text).toContain('connected');
    });
});
