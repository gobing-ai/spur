import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { requestId } from '../../src/middleware/request-id';

describe('requestId middleware', () => {
    test('injects a UUID v4 into c.var.requestId', async () => {
        const app = new Hono();
        let captured: string | undefined;

        app.use('*', requestId());
        app.get('/test', (c) => {
            captured = c.get('requestId');
            return c.text('ok');
        });

        await app.request('/test');
        expect(captured).toBeDefined();
        expect(captured).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('generates a unique requestId per request', async () => {
        const app = new Hono();
        const ids: string[] = [];

        app.use('*', requestId());
        app.get('/test', (c) => {
            ids.push(c.get('requestId'));
            return c.text('ok');
        });

        await app.request('/test');
        await app.request('/test');
        expect(ids[0]).not.toBe(ids[1]);
    });
});
