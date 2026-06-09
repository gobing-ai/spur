import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { generateOpenApiSpec } from './openapi';
import { router } from './router';

const handler = new OpenAPIHandler(router);

/** Create the Hono app that mounts oRPC OpenAPI procedures and docs endpoints. */
export function createApp(): Hono {
    const app = new Hono();

    app.use('*', secureHeaders());

    app.get('/', (c) => c.redirect('/api/health'));

    app.get('/openapi.json', async (c) => c.json(await generateOpenApiSpec({})));

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
