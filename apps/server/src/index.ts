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
            const { createNodeFileSystem } = await import('@gobing-ai/ts-runtime');
            const { createServerContext } = await import('./context');
            const fs = createNodeFileSystem(process.cwd());
            const ctx = createServerContext(appRt, { cwd: process.cwd(), fs });
            const app = createApp(appRt, { fs, ctx });

            const server = Bun.serve({
                fetch: app.fetch,
                port: config.server.port,
            });

            const shutdown = async (signal: string) => {
                appRt.logger.info('Shutting down server', { signal });
                server.stop(true); // drain in-flight requests
                await appRt.stop('shutdown'); // close DB, flush logs
                process.exit(0);
            };

            process.on('SIGINT', () => void shutdown('SIGINT'));
            process.on('SIGTERM', () => void shutdown('SIGTERM'));

            appRt.logger.info('Server started', { port: config.server.port });
        },
    });
}

export { default } from './worker';
