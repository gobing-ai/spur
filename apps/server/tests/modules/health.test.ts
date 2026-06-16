import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { healthModule } from '../../src/modules/health';

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
