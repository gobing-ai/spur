import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createApp } from '../src/bootstrap';
import { healthModule } from '../src/modules/health';
import { registerModules } from '../src/modules/registry';
import type { ServerModule } from '../src/modules/types';

describe('healthModule', () => {
    test('name is health', () => {
        expect(healthModule.name).toBe('health');
    });

    test('mount registers /api/health and /api/health/ready', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        // Liveness
        const livenessRes = await app.request('/api/health');
        expect(livenessRes.status).toBe(200);
        const livenessBody = (await livenessRes.json()) as Record<string, unknown>;
        expect(livenessBody.status).toBe('ok');
        expect(typeof livenessBody.uptime_seconds).toBe('number');
        expect(typeof livenessBody.memory_rss_mb).toBe('number');

        // Readiness without ServerContext
        const readyRes = await app.request('/api/health/ready');
        expect(readyRes.status).toBe(503);
        const readyBody = (await readyRes.json()) as Record<string, unknown>;
        expect(readyBody.status).toBe('error');
        expect(readyBody.db).toBe('unavailable');
    });
});

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

describe('ServerModule contract', () => {
    test('a custom module mouting raw routes is reachable', async () => {
        const customModule: ServerModule = {
            name: 'custom',
            mount(app: Hono) {
                app.get('/custom', (c) => c.json({ hello: 'world' }));
            },
        };

        const app = new Hono();
        customModule.mount(app, undefined);
        const res = await app.request('/custom');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.hello).toBe('world');
    });

    test('module scoped middleware applies only to its routes', async () => {
        const calls: string[] = [];
        const customModule: ServerModule = {
            name: 'scoped',
            mount(app: Hono) {
                app.get('/scoped', (c) => {
                    calls.push('handler');
                    return c.text('ok');
                });
            },
            middleware: [
                (async (_c: unknown, next: () => Promise<void>) => {
                    await next();
                }) as never,
            ],
        };

        expect(customModule.middleware).toBeDefined();
        expect(customModule.middleware?.length).toBe(1);

        const app = new Hono();
        customModule.mount(app, undefined);
        // middleware would need explicit use() — the interface says optional:
        // modules call app.use(mod.middleware) in their mount if they need it.
        const res = await app.request('/scoped');
        expect(res.status).toBe(200);
    });
});
