import type { ApplicationRuntime, LoggingOptions } from '@gobing-ai/ts-infra/application';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { Hono } from 'hono';
import { mountMiddleware } from './middleware/pipeline';
import { generateOpenApiSpec } from './openapi';
import { router } from './router';

const handler = new OpenAPIHandler(router);

// Declare Hono context variables so c.set() / c.get() type-check.
// `ctx` (ServerContext) is wired in task 0073; `requestId` is set by the
// requestId middleware.
declare module 'hono' {
    interface ContextVariableMap {
        rt: ApplicationRuntime;
        ctx: undefined; // typed placeholder until ServerContext lands (0073)
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
            enabled: !isTest, // mute JSON log leakage in tests (parity with spur)
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
 *
 * The no-arg form (no runtime) works stand-alone — used in tests that don't
 * spin up a full application bootstrap.
 */
export function createApp(appRt?: ApplicationRuntime): Hono {
    const app = new Hono();

    // ── Cross-cutting middleware (design §2.2 — order is load-bearing) ──
    mountMiddleware(app, appRt);

    app.get('/', (c) => c.redirect('/api/health'));

    app.get('/openapi.json', async (c) => c.json(await generateOpenApiSpec({})));

    // ── Health endpoints (before oRPC wildcard mount so they win on /api/health) ──
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

    // Readiness stub — DB probe lands in 0073 once ServerContext.getDb() exists.
    // Returns 200 with a deferred flag; 0073 replaces with a real database probe → 200 / 503.
    app.get('/api/health/ready', (c) => c.json({ status: 'ok', db: 'deferred' }));

    // ── oRPC handler for /api/* (after explicit routes above) ──
    app.use('/api/*', async (c, next) => {
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
