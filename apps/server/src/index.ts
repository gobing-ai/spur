import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { createApp } from './app';

export { createApp } from './app';
export { generateOpenApiSpec } from './openapi';
export type { AppRouter } from './router';
export { router } from './router';
export { default as worker } from './worker';

const isEntrypoint = import.meta.main;

if (isEntrypoint) {
    const config = buildConfigFromEnv();
    Bun.serve({
        fetch: createApp().fetch,
        port: config.server.port,
    });
}

export { default } from './worker';
