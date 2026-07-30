import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { isPortLive, normalizeProjectPath, ProjectRegistry } from '@gobing-ai/spur-app';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/** Server start timestamp for uptime calculation. */
const startedAt = Date.now();

/**
 * Health module — the reference ServerModule implementation.
 *
 * Proves the registry pattern (design §2.4): the liveness + readiness
 * endpoints register through the same `ServerModule` interface every
 * domain module uses. Routes are raw Hono handlers (not oRPC) because
 * health is infrastructure, not an API domain.
 */
export const healthModule: ServerModule = {
    name: 'health',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        // ── Liveness ──
        app.get('/api/health', (c) => {
            const uptime = (Date.now() - startedAt) / 1000;
            const memory = process.memoryUsage();
            return c.json({
                status: 'ok',
                uptime_seconds: Math.round(uptime),
                memory_rss_mb: Math.round((memory.rss / 1_048_576) * 100) / 100,
                memory_heap_mb: Math.round((memory.heapUsed / 1_048_576) * 100) / 100,
            });
        });

        // ── Readiness ──
        app.get('/api/health/ready', async (c) => {
            if (!ctx) {
                return c.json({ status: 'error', db: 'unavailable' }, 503);
            }
            const ok = await ctx.checkDbHealth();
            if (ok) {
                return c.json({ status: 'ok', db: 'connected' });
            }
            return c.json({ status: 'error', db: 'unreachable' }, 503);
        });

        // ── Project identity ──
        // The board sidebar labels itself with the served project (basename of
        // the cwd `spur serve` runs in). `null` when there is no ServerContext
        // (e.g. the Cloudflare Worker, which has no meaningful cwd).
        app.get('/api/project', (c) => {
            return c.json({ name: ctx ? basename(ctx.cwd) : null });
        });

        // ── Multi-project list ──
        app.get('/api/projects', async (c) => {
            if (!ctx) {
                return c.json({ projects: [] });
            }
            const registry = new ProjectRegistry();
            const rawProjects = await registry.list();
            const currentNorm = normalizeProjectPath(ctx.cwd);

            const projects = await Promise.all(
                rawProjects.map(async (p) => {
                    const normPath = normalizeProjectPath(p.path);
                    const running = p.port > 0 ? await isPortLive(p.port) : false;
                    return {
                        name: p.name,
                        path: p.path,
                        port: p.port,
                        running,
                        current: normPath === currentNorm,
                    };
                }),
            );

            return c.json({ projects });
        });

        // ── Multi-project start ──
        app.post('/api/projects/start', async (c) => {
            if (!ctx) {
                return c.json({ error: 'Multi-project registry unavailable on Cloudflare Workers' }, 501);
            }
            let body: { name?: string; path?: string } = {};
            try {
                body = await c.req.json();
            } catch {
                // Empty body tolerated if target passed via path query
            }

            const target = body.name ?? body.path;
            if (!target) {
                return c.json({ error: 'Missing name or path in request body' }, 400);
            }

            const registry = new ProjectRegistry();
            let entry = (await registry.getByName(target)) ?? (await registry.getByPath(target));
            if (!entry) {
                const absPath = normalizeProjectPath(target);
                if (existsSync(absPath)) {
                    entry = await registry.upsert({ path: absPath, name: basename(absPath), port: 0 });
                } else {
                    return c.json({ error: `Project not found: ${target}` }, 404);
                }
            }

            if (entry.port > 0 && (await isPortLive(entry.port))) {
                return c.json({
                    name: entry.name,
                    path: entry.path,
                    port: entry.port,
                    running: true,
                    url: `http://localhost:${entry.port}`,
                });
            }

            const allocatedPort = await registry.allocatePort();
            const spurBin = process.argv[1] ?? 'spur';
            const child = Bun.spawn(
                [process.execPath, spurBin, 'serve', '--cwd', entry.path, '--port', String(allocatedPort), '--no-open'],
                {
                    cwd: entry.path,
                    detached: true,
                    stdio: ['ignore', 'ignore', 'ignore'],
                },
            );
            child.unref();

            let live = false;
            for (let i = 0; i < 50; i++) {
                await new Promise((r) => setTimeout(r, 100));
                if (await isPortLive(allocatedPort)) {
                    live = true;
                    break;
                }
            }

            if (!live) {
                return c.json({ error: `Failed to start server for ${entry.name} on port ${allocatedPort}` }, 500);
            }

            await registry.setPort(entry.path, allocatedPort);
            const updated = (await registry.getByPath(entry.path)) ?? entry;

            return c.json({
                name: updated.name,
                path: updated.path,
                port: allocatedPort,
                running: true,
                url: `http://localhost:${allocatedPort}`,
            });
        });
    },
};
