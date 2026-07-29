import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { generateOpenApiSpec } from './openapi';

interface ProcessMemory {
    rss: number;
    heapUsed: number;
}

interface ProcessGlobal {
    memoryUsage?: () => ProcessMemory;
}

const startedAt = Date.now();

function memoryUsage(): ProcessMemory {
    const processGlobal = (globalThis as typeof globalThis & { process?: ProcessGlobal }).process;
    return processGlobal?.memoryUsage?.() ?? { rss: 0, heapUsed: 0 };
}

/**
 * Create the Cloudflare Workers HTTP surface.
 *
 * Local corpus, SQLite, scheduler, job-queue, and process-control routes stay in
 * the Bun composition root because those dependencies are not available in Workers.
 */
export function createWorkerApp(env: Record<string, string | undefined> = {}): Hono {
    const app = new Hono();
    const corsOrigins = env.SPUR_CORS_ORIGINS
        ? env.SPUR_CORS_ORIGINS.split(',')
              .map((origin) => origin.trim())
              .filter(Boolean)
        : [];

    app.use('*', secureHeaders());
    app.use('*', cors({ origin: corsOrigins }));
    app.use('*', csrf({ origin: (origin, c) => origin === new URL(c.req.url).origin || corsOrigins.includes(origin) }));
    app.use('*', bodyLimit({ maxSize: 1_048_576 }));
    app.use('*', compress());

    app.get('/api/health', (c) => {
        const memory = memoryUsage();
        return c.json({
            status: 'ok',
            uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
            memory_rss_mb: Math.round((memory.rss / 1_048_576) * 100) / 100,
            memory_heap_mb: Math.round((memory.heapUsed / 1_048_576) * 100) / 100,
        });
    });
    app.get('/api/health/ready', (c) => c.json({ status: 'error', db: 'unavailable' }, 503));
    app.get('/api/project', (c) => c.json({ name: null }));
    app.get('/openapi.json', async (c) => c.json(await generateOpenApiSpec({})));
    app.get('/', (c) => c.redirect('/api/health'));
    app.all('/api/*', (c) =>
        c.json(
            {
                error: 'This endpoint requires the local Bun server runtime.',
            },
            503,
        ),
    );
    app.notFound((c) => c.json({ error: 'Not Found' }, 404));

    return app;
}
