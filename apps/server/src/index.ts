import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { startServer } from './serve';

export { createApp } from './bootstrap';
export { generateOpenApiSpec } from './openapi';
export type { AppRouter } from './router';
export { createRouter } from './router';
export type { StartServerOptions } from './serve';
export { startServer } from './serve';
export { default as worker } from './worker';

if (import.meta.main) {
    const config = buildConfigFromEnv(process.env as Record<string, string | undefined>);
    await startServer({
        port: config.server.port,
        host: config.server.host,
        openBrowser: false,
    });
}

export { default } from './worker';
