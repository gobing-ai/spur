import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../src/context';
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

    test('/api/project returns the basename of the served cwd', async () => {
        const app = new Hono();
        // Only `cwd` is read by this route — a partial context satisfies the mount.
        const ctx = { cwd: '/Users/robin/xprojects/spur-new' } as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/project');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.name).toBe('spur-new');
    });

    test('/api/project returns null name without ServerContext', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/project');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.name).toBeNull();
    });
});
