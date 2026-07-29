import { describe, expect, test } from 'bun:test';
import { createWorkerApp } from '../src/worker-app';

describe('Cloudflare Worker app', () => {
    test('serves the portable health, readiness, identity, and OpenAPI surface', async () => {
        const app = createWorkerApp();

        const health = await app.request('/api/health');
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({
            status: 'ok',
            uptime_seconds: expect.any(Number),
            memory_rss_mb: expect.any(Number),
            memory_heap_mb: expect.any(Number),
        });

        const ready = await app.request('/api/health/ready');
        expect(ready.status).toBe(503);
        expect(await ready.json()).toEqual({ status: 'error', db: 'unavailable' });

        const project = await app.request('/api/project');
        expect(await project.json()).toEqual({ name: null });

        const openapi = await app.request('/openapi.json');
        expect(openapi.status).toBe(200);
        expect(await openapi.json()).toMatchObject({ openapi: '3.1.1' });
    });

    test('redirects root and fails unavailable or unknown routes explicitly', async () => {
        const app = createWorkerApp();

        const root = await app.request('/');
        expect(root.status).toBe(302);
        expect(root.headers.get('location')).toBe('/api/health');

        const localOnly = await app.request('/api/tasks');
        expect(localOnly.status).toBe(503);
        expect(await localOnly.json()).toEqual({ error: 'This endpoint requires the local Bun server runtime.' });

        const missing = await app.request('/missing');
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: 'Not Found' });
    });

    test('uses the configured CORS allowlist', async () => {
        const app = createWorkerApp({ SPUR_CORS_ORIGINS: 'https://board.example, https://ops.example' });
        const response = await app.request('/api/health', {
            headers: { origin: 'https://ops.example' },
        });

        expect(response.headers.get('access-control-allow-origin')).toBe('https://ops.example');
    });
});
