import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { contextInjector } from '../../src/middleware/context-injector';
import { mockRuntime } from './helpers';

describe('contextInjector middleware', () => {
    test('sets c.var.rt from ApplicationRuntime', async () => {
        const appRt = mockRuntime();
        const app = new Hono();
        let capturedRt: unknown;

        app.use('*', contextInjector(appRt));
        app.get('/test', (c) => {
            capturedRt = c.get('rt');
            return c.text('ok');
        });

        await app.request('/test');
        expect(capturedRt).toBe(appRt);
    });
});
