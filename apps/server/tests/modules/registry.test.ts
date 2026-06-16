import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createApp } from '../../src/bootstrap';
import { registerModules } from '../../src/modules/registry';
import type { ServerModule } from '../../src/modules/types';

describe('registerModules', () => {
    test('mounts all builtins (health)', async () => {
        const app = createApp();
        const res = await app.request('/api/health');
        expect(res.status).toBe(200);
    });

    test('fails fast on a broken module via registerModules', () => {
        const brokenModule: ServerModule = {
            name: 'broken',
            mount() {
                throw new Error('boom');
            },
        };

        const app = new Hono();
        expect(() => {
            registerModules(app, undefined, [brokenModule]);
        }).toThrow("Failed to mount server module 'broken': Error: boom");
    });

    test('routes via createApp work after registration', async () => {
        const app = createApp();

        // Health (liveness)
        const res = await app.request('/api/health');
        expect(res.status).toBe(200);

        // OpenAPI still served
        const openapiRes = await app.request('/openapi.json');
        expect(openapiRes.status).toBe(200);

        // Not found still returns 404
        const missingRes = await app.request('/missing');
        expect(missingRes.status).toBe(404);
    });
});
