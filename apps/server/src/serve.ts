import type { ApplicationRuntime, ApplicationStopReason } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createApp, serverBootstrapConfig } from './bootstrap';
import { createServerContext, type ServerContext, type ServerScheduler } from './context';
import { openUrl } from './open-url';

/** Options for {@link startServer}. */
export interface StartServerOptions {
    port: number;
    host: string;
    openBrowser: boolean;
}

/**
 * Single entry point for the `spur serve` launcher — shared by both the
 * standalone entry and the CLI `spur serve` command.
 *
 * Builds the `ApplicationRuntime`, wires the Hono app through `createApp`,
 * starts `Bun.serve`, optionally opens the browser, and installs
 * SIGINT/SIGTERM graceful shutdown. With `--json` prints `{ port, url, pid }`.
 */
export async function startServer(options: StartServerOptions): Promise<void> {
    const env = process.env as Record<string, string | undefined>;
    const bootConfig = serverBootstrapConfig(env);

    await runNodeApplication({
        config: bootConfig,
        async start(appRt: ApplicationRuntime) {
            const fs = createNodeFileSystem(process.cwd());

            // Platform-specific — scheduler-node doesn't exist on CF Workers.
            let scheduler: ServerScheduler | undefined;
            if (bootConfig.scheduler.enabled) {
                const { NodeSchedulerAdapter } = await import('@gobing-ai/ts-infra/scheduler-node');
                scheduler = new NodeSchedulerAdapter();
            }

            const ctx: ServerContext = createServerContext(appRt, {
                cwd: process.cwd(),
                fs,
                jobQueueEnabled: bootConfig.jobqueue.enabled,
                scheduler,
            });

            const app = createApp(appRt, { fs, ctx });

            if (scheduler) {
                await scheduler.start();
                appRt.logger.info('Scheduler started');
            }

            const server = Bun.serve({
                fetch: app.fetch,
                port: options.port,
                hostname: options.host,
            });

            const shutdown = async (signal: string) => {
                appRt.logger.info('Shutting down server', { signal });
                server.stop(true);
                if (scheduler) await scheduler.stop();
                await appRt.stop('shutdown' as ApplicationStopReason);
                process.exit(0);
            };

            process.on('SIGINT', () => void shutdown('SIGINT'));
            process.on('SIGTERM', () => void shutdown('SIGTERM'));

            const url = `http://${options.host}:${options.port}`;

            appRt.logger.info('Server started', { port: options.port, host: options.host });

            if (options.openBrowser) {
                await openUrl(`${url}/board`);
            }
        },
    });
}
