import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRegistry } from '@gobing-ai/spur-app';
import { Hono } from 'hono';
import type { ServerContext } from '../../src/context';
import { healthModule } from '../../src/modules/health';

describe('healthModule', () => {
    let tempDir: string;
    let projectsFile: string;
    const origAllocate = ProjectRegistry.prototype.allocatePort;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-health-test-'));
        projectsFile = join(tempDir, 'projects.json');
        process.env.SPUR_PROJECTS_FILE = projectsFile;
    });

    afterEach(() => {
        ProjectRegistry.prototype.allocatePort = origAllocate;
        delete process.env.SPUR_PROJECTS_FILE;
        if (existsSync(tempDir)) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

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

    test('readiness with ServerContext calling checkDbHealth', async () => {
        const app = new Hono();
        const ctxOk = { checkDbHealth: async () => true } as unknown as ServerContext;
        healthModule.mount(app, ctxOk);

        const resOk = await app.request('/api/health/ready');
        expect(resOk.status).toBe(200);
        const bodyOk = (await resOk.json()) as Record<string, unknown>;
        expect(bodyOk.status).toBe('ok');

        const appFail = new Hono();
        const ctxFail = { checkDbHealth: async () => false } as unknown as ServerContext;
        healthModule.mount(appFail, ctxFail);

        const resFail = await appFail.request('/api/health/ready');
        expect(resFail.status).toBe(503);
    });

    test('/api/project returns the basename of the served cwd', async () => {
        const app = new Hono();
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

    test('/api/projects lists projects and marks current project', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'Project A', path: tempDir, port: 0 });

        const app = new Hono();
        const ctx = { cwd: tempDir } as ServerContext;
        healthModule.mount(app, ctx);

        const res = await app.request('/api/projects');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { projects: Array<{ name: string; current: boolean; running: boolean }> };
        expect(body.projects.length).toBe(1);
        expect(body.projects[0]?.name).toBe('Project A');
        expect(body.projects[0]?.current).toBe(true);
        expect(body.projects[0]?.running).toBe(false);
    });

    test('/api/projects returns empty projects list without ServerContext', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/projects');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { projects: unknown[] };
        expect(body.projects).toEqual([]);
    });

    test('/api/projects/start returns 501 without ServerContext (Worker env)', async () => {
        const app = new Hono();
        healthModule.mount(app, undefined);

        const res = await app.request('/api/projects/start', {
            method: 'POST',
            body: JSON.stringify({ name: 'Test' }),
            headers: { 'content-type': 'application/json' },
        });
        expect(res.status).toBe(501);
    });

    test('/api/projects/start handles validation and target lookup errors', async () => {
        const app = new Hono();
        const ctx = { cwd: tempDir } as ServerContext;
        healthModule.mount(app, ctx);

        // Missing body target
        const resMissing = await app.request('/api/projects/start', {
            method: 'POST',
            body: JSON.stringify({}),
            headers: { 'content-type': 'application/json' },
        });
        expect(resMissing.status).toBe(400);

        // Non-existent project
        const resNotFound = await app.request('/api/projects/start', {
            method: 'POST',
            body: JSON.stringify({ name: 'NonExistentProject' }),
            headers: { 'content-type': 'application/json' },
        });
        expect(resNotFound.status).toBe(404);
    });

    test('/api/projects/start handles already running project', async () => {
        const registry = new ProjectRegistry(projectsFile);
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const livePort = (server.address() as { port: number }).port;

        try {
            await registry.upsert({ name: 'RunningApp', path: tempDir, port: livePort });

            const app = new Hono();
            const ctx = { cwd: tempDir } as ServerContext;
            healthModule.mount(app, ctx);

            const res = await app.request('/api/projects/start', {
                method: 'POST',
                body: JSON.stringify({ name: 'RunningApp' }),
                headers: { 'content-type': 'application/json' },
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as { running: boolean; port: number };
            expect(body.running).toBe(true);
            expect(body.port).toBe(livePort);
        } finally {
            server.close();
        }
    });

    test('/api/projects/start starts stopped project and updates registry when port is live', async () => {
        const registry = new ProjectRegistry(projectsFile);
        await registry.upsert({ name: 'StoppedApp', path: tempDir, port: 0 });

        const targetPort = 3991;
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(targetPort, '127.0.0.1', () => resolve()));
        ProjectRegistry.prototype.allocatePort = async () => targetPort;

        try {
            const app = new Hono();
            const ctx = { cwd: tempDir } as ServerContext;
            healthModule.mount(app, ctx);

            const res = await app.request('/api/projects/start', {
                method: 'POST',
                body: JSON.stringify({ name: 'StoppedApp' }),
                headers: { 'content-type': 'application/json' },
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as { running: boolean; url: string; port: number };
            expect(body.running).toBe(true);
            expect(body.port).toBe(targetPort);
        } finally {
            server.close();
        }
    });

    test('/api/projects/start auto-registers target path if existing directory on disk', async () => {
        const targetPort = 3990;
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(targetPort, '127.0.0.1', () => resolve()));
        ProjectRegistry.prototype.allocatePort = async () => targetPort;

        try {
            const app = new Hono();
            const ctx = { cwd: tempDir } as ServerContext;
            healthModule.mount(app, ctx);

            const res = await app.request('/api/projects/start', {
                method: 'POST',
                body: JSON.stringify({ path: tempDir }),
                headers: { 'content-type': 'application/json' },
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as { running: boolean; url: string };
            expect(body.running).toBe(true);
        } finally {
            server.close();
        }
    });
});
