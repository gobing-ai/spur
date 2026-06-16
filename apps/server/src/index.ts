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

    const bootConfig = serverBootstrapConfig(env);

    await runNodeApplication({
        config: bootConfig,
        async start(appRt: ApplicationRuntime) {
            const { createNodeFileSystem } = await import('@gobing-ai/ts-runtime');
            const { createServerContext } = await import('./context');
            const fs = createNodeFileSystem(process.cwd());

            // R3: on the Bun path the scheduler is the Node adapter (setInterval-based).
            // Built here (entry layer) — the platform divergence (Node vs Cloudflare
            // adapter) is selected by WHICH entry runs, never branched in app code.
            let scheduler: import('./context').ServerScheduler | undefined;
            if (bootConfig.scheduler.enabled) {
                const { NodeSchedulerAdapter } = await import('@gobing-ai/ts-infra/scheduler-node');
                scheduler = new NodeSchedulerAdapter();
            }

            const ctx = createServerContext(appRt, {
                cwd: process.cwd(),
                fs,
                jobQueueEnabled: bootConfig.jobqueue.enabled,
                scheduler,
            });
            const app = createApp(appRt, { fs, ctx });

            // R2: on the Bun path the entry STARTS a queue consumer (a stateless
            // Worker would enqueue-only — that divergence lives at the entry, not in
            // createApp). The consumer polls the migrated `queue_jobs` table. The
            // ts-db/ts-infra wiring is built by the spur-domain helper (apps/server
            // stays free of direct ts-db imports).
            let consumer: import('@gobing-ai/spur-domain').QueueConsumer | undefined;
            if (bootConfig.jobqueue.enabled) {
                const { createQueueConsumer } = await import('@gobing-ai/spur-domain');
                const db = await ctx.getDb();
                consumer = await createQueueConsumer(db);
                await consumer.start();
                appRt.logger.info('Job queue consumer started');
            }
            if (scheduler) {
                await scheduler.start();
                appRt.logger.info('Scheduler started');
            }

            const server = Bun.serve({
                fetch: app.fetch,
                port: config.server.port,
            });

            const shutdown = async (signal: string) => {
                appRt.logger.info('Shutting down server', { signal });
                server.stop(true); // drain in-flight requests
                if (consumer) await consumer.stop(); // drain in-flight jobs
                if (scheduler) await scheduler.stop();
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
