import type { ApiRegistry } from '@gobing-ai/spur-plugin-sdk';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { generateOpenApiSpec } from './openapi';
import { collectPluginOpenApiPaths, mountPluginRoutes } from './plugins';
import { router } from './router';

const handler = new OpenAPIHandler(router);

/** Options for assembling the server app. */
export interface CreateAppOptions {
    /** Plugin API registry; when present, plugin routes mount under /api/plugins/<prefix>. */
    apiRegistry?: ApiRegistry;
}

/** Create the Hono app that mounts oRPC OpenAPI procedures and docs endpoints. */
export function createApp(opts: CreateAppOptions = {}): Hono {
    const app = new Hono();

    app.use('*', secureHeaders());

    app.get('/', (c) => c.redirect('/api/health'));

    const pluginPaths = opts.apiRegistry ? collectPluginOpenApiPaths(opts.apiRegistry) : {};
    app.get('/openapi.json', async (c) => c.json(await generateOpenApiSpec(pluginPaths)));

    // Plugin routes mount before oRPC /api/* and notFound so their prefixes win.
    if (opts.apiRegistry) {
        mountPluginRoutes(app, opts.apiRegistry);
    }

    app.use('/api/*', async (c, next) => {
        const { matched, response } = await handler.handle(c.req.raw, {
            prefix: '/api',
            context: {},
        });

        if (matched) {
            return c.newResponse(response.body, response);
        }

        return next();
    });

    app.notFound((c) => c.json({ error: 'Not Found' }, 404));

    return app;
}
