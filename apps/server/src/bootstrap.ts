import { dbHealthCheck } from '@gobing-ai/spur-domain';
import type { ApplicationRuntime, LoggingOptions } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { Hono } from 'hono';
import type { ServerContext } from './context';
import { mountMiddleware } from './middleware/pipeline';
import { generateOpenApiSpec } from './openapi';
import { router } from './router';

const handler = new OpenAPIHandler(router);

// Declare Hono context variables so c.set() / c.get() type-check.
declare module 'hono' {
    interface ContextVariableMap {
        rt: ApplicationRuntime;
        ctx: ServerContext;
        requestId: string;
    }
}

// Re-export types for consumers that need the portable ApplicationRuntime shape.
export type { ApplicationRuntime, LoggingOptions };

/** Shared bootstrap configuration for the portable `runApplication` block. */
export function serverBootstrapConfig(env: Record<string, string | undefined>): {
    logging: LoggingOptions;
    telemetry: { enabled: boolean };
    events: { enabled: boolean };
} {
    const isTest = env.NODE_ENV === 'test';
    return {
        logging: {
            enabled: !isTest,
            level: (env.SPUR_LOG_LEVEL as LoggingOptions['level']) ?? 'info',
        },
        telemetry: { enabled: false },
        events: { enabled: true },
    };
}

/** Server start timestamp for uptime calculation. */
const startedAt = Date.now();

/**
 * Create the Hono app that mounts the middleware pipeline, health endpoints,
 * oRPC OpenAPI procedures, and docs endpoints.
 *
 * When an `ApplicationRuntime` is provided, its `logger` and `events` are
 * threaded through the middleware pipeline and into the oRPC handler context.
 * A `ServerContext` is built and injected into `c.var.ctx`.
 *
 * The no-arg form (no runtime) works stand-alone — used in tests that don't
 * spin up a full application bootstrap. ServerContext is passed via opts.ctx
 * (Bun path) or omitted (CF path — no @gobing-ai/spur-app transitives).
 */
export function createApp(appRt?: ApplicationRuntime, opts?: { fs?: FileSystem; ctx?: ServerContext }): Hono {
    const app = new Hono();

    // ── Cross-cutting middleware (design §2.2 — order is load-bearing) ──
    mountMiddleware(app, appRt);

    app.get('/', (c) => c.redirect('/api/health'));

    app.get('/openapi.json', async (c) => c.json(await generateOpenApiSpec({})));

    // ── ServerContext (Bun path only via opts.ctx; CF passes nothing) ──
    const ctx: ServerContext | undefined = opts?.ctx;

    // ── Health endpoints (before oRPC wildcard mount) ──
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

    // Readiness probe — calls getDb() then a liveness query; 200 when up, 503 when unreachable.
    app.get('/api/health/ready', async (c) => {
        if (!ctx) {
            return c.json({ status: 'error', db: 'unavailable' }, 503);
        }
        try {
            const db = await ctx.getDb();
            const ok = await dbHealthCheck(db);
            if (ok) {
                return c.json({ status: 'ok', db: 'connected' });
            }
            return c.json({ status: 'error', db: 'unreachable' }, 503);
        } catch {
            return c.json({ status: 'error', db: 'unreachable' }, 503);
        }
    });

    // ── oRPC handler for /api/* (after explicit routes above) ──
    app.use('/api/*', async (c, next) => {
        if (ctx) {
            c.set('ctx', ctx);
        }
        const { matched, response } = await handler.handle(c.req.raw, {
            prefix: '/api',
            context: appRt ? { logger: appRt.logger, events: appRt.events, db: appRt.db } : {},
        });

        if (matched) {
            return c.newResponse(response.body, response);
        }

        return next();
    });

    app.notFound((c) => c.json({ error: 'Not Found' }, 404));

    return app;
}
