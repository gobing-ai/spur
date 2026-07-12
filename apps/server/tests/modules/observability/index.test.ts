import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { observabilityModule } from '../../../src/modules/observability';

function mountWithInventory(snapshot: unknown, snapshotImpl?: () => Promise<unknown>): Hono {
    const app = new Hono();
    const ctx = {
        processInventory: () => ({
            snapshot: snapshotImpl ?? (async () => snapshot),
        }),
    } as unknown as ServerContext;
    observabilityModule.mount(app, ctx);
    return app;
}

describe('observability module', () => {
    test('GET /api/observability/processes returns inventory snapshot', async () => {
        const snap = {
            processes: [
                {
                    pid: 1,
                    ppid: 0,
                    depth: 0,
                    source: 'serve',
                    label: 'spur serve',
                    command: 'serve',
                    status: 'running',
                    rssBytes: 1000,
                    elapsedSeconds: 1,
                    startedAt: null,
                },
            ],
            rootPid: 1,
            capturedAt: '2026-07-12T00:00:00.000Z',
        };
        const app = mountWithInventory(snap);
        const res = await app.request('/api/observability/processes');
        expect(res.status).toBe(200);
        const body = (await res.json()) as typeof snap;
        expect(body.rootPid).toBe(1);
        expect(body.processes).toHaveLength(1);
        expect(body.processes[0]?.source).toBe('serve');
    });

    test('GET /api/observability/processes returns 501 for unsupported platform', async () => {
        const { UnsupportedProcessPlatformError } = await import('@gobing-ai/spur-app');
        const app = mountWithInventory(null, async () => {
            throw new UnsupportedProcessPlatformError('win32');
        });
        const res = await app.request('/api/observability/processes');
        expect(res.status).toBe(501);
        const body = (await res.json()) as { code?: string; error?: string };
        expect(body.code).toBe('UNSUPPORTED_PLATFORM');
        expect(body.error).toContain('win32');
    });

    test('GET /api/observability/processes returns 500 on unexpected errors', async () => {
        const app = mountWithInventory(null, async () => {
            throw new Error('ps exploded');
        });
        const res = await app.request('/api/observability/processes');
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toContain('ps exploded');
    });

    test('mount is a no-op without context', () => {
        const app = new Hono();
        expect(() => observabilityModule.mount(app, undefined)).not.toThrow();
    });
});
