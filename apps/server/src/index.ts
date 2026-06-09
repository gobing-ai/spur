import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import { createApp, serverBootstrapConfig } from './bootstrap';

export { createApp } from './bootstrap';
export { generateOpenApiSpec } from './openapi';
export type { AppRouter } from './router';
export { router } from './router';
export { default as worker } from './worker';

const isEntrypoint = import.meta.main;

if (isEntrypoint) {
    const env = process.env as Record<string, string | undefined>;
    const config = buildConfigFromEnv(env);

    await runNodeApplication({
        config: serverBootstrapConfig(env),
        async start(appRt: ApplicationRuntime) {
            Bun.serve({
                fetch: createApp(appRt).fetch,
                port: config.server.port,
            });
        },
    });
}

export { default } from './worker';
