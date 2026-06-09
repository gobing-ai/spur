import type { ApplicationRuntime, LoggingOptions } from '@gobing-ai/ts-infra/application';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { generateOpenApiSpec } from './openapi';
import { router } from './router';

const handler = new OpenAPIHandler(router);

// Declare the 'rt' Hono context variable so c.set('rt', appRt) / c.get('rt') type-checks.
declare module 'hono' {
    interface ContextVariableMap {
        rt: ApplicationRuntime;
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
            enabled: !isTest, // mute JSON log leakage in tests (parity with spur-cli)
            level: (env.SPUR_LOG_LEVEL as LoggingOptions['level']) ?? 'info',
        },
        telemetry: { enabled: false },
        events: { enabled: true },
    };
}

/**
 * Create the Hono app that mounts oRPC OpenAPI procedures and docs endpoints.
 *
 * When an `ApplicationRuntime` is provided, its `logger` and `events` are threaded
 * into the Hono context and the oRPC handler `context` for use by downstream
 * middleware / procedures.
 *
 * The no-arg form (no runtime) works stand-alone — used in tests that don't spin
 * up a full application bootstrap.
 */
export function createApp(appRt?: ApplicationRuntime): Hono {
    const app = new Hono();

    app.use('*', secureHeaders());

    app.get('/', (c) => c.redirect('/api/health'));

    app.get('/openapi.json', async (c) => c.json(await generateOpenApiSpec({})));

    app.use('/api/*', async (c, next) => {
        // Thread runtime services into the Hono context so downstream middleware
        // and procedures can access them via c.get('rt').
        if (appRt) {
            c.set('rt', appRt);
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
