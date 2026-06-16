import type { ApplicationRuntime, LoggingOptions } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { Hono } from 'hono';
import type { ServerContext } from './context';
import { mountMiddleware } from './middleware/pipeline';
import { registerModules } from './modules/registry';
import { generateOpenApiSpec } from './openapi';
import { createRouter } from './router';

// OpenAPIHandler is created per-app (not at module level) because the router
// is now a factory that bakes in ServerContext-bound handlers.

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
    jobqueue: { enabled: boolean };
    scheduler: { enabled: boolean };
} {
    const isTest = env.NODE_ENV === 'test';
    return {
        logging: {
            enabled: !isTest,
            level: (env.SPUR_LOG_LEVEL as LoggingOptions['level']) ?? 'info',
        },
        telemetry: { enabled: false },
        events: { enabled: true },
        jobqueue: { enabled: false },
        scheduler: { enabled: false },
    };
}

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

    // ── Mount built-in server modules (health, future task/feature/…) ──
    registerModules(app, ctx);

    // ── oRPC handler for /api/* (after explicit routes above) ──
    const router = createRouter(ctx);
    const oapiHandler = new OpenAPIHandler(router);
    app.use('/api/*', async (c, next) => {
        if (ctx) {
            c.set('ctx', ctx);
        }
        const { matched, response } = await oapiHandler.handle(c.req.raw, {
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
