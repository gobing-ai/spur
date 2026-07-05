import { dirname, isAbsolute, join } from 'node:path';
import {
    AgentService,
    JobHandlerRegistry,
    JobWorkerService,
    resolvePlanningFolders,
    type TaskActionJob,
} from '@gobing-ai/spur-app';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import type { ApplicationRuntime, ApplicationStopReason } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createApp, serverBootstrapConfig } from './bootstrap';
import { createServerContext, type ServerContext, type ServerScheduler } from './context';
import { registerSystemEventTap, SYSTEM_EVENTS_CAP } from './modules/events/system-event-tap';
import { openUrl } from './open-url';

/** Built-in queue job kind for scheduled system_events retention pruning. */
export const SYSTEM_EVENTS_PRUNE_JOB = 'system-events-prune';

/** Built-in no-op queue job kind used as a scheduler/worker smoke path. */
export const SMOKE_JOB = 'smoke';

/** Built-in queue job kind for board-triggered task workflow actions. */
export const TASK_ACTION_JOB = 'task-action';

const SYSTEM_EVENTS_PRUNE_CRON = '300000';
const SMOKE_CRON = '600000';
/** Options for {@link startServer}. */
export interface StartServerOptions {
    port: number;
    host: string;
    openBrowser: boolean;
    webDistPath?: string | null;
    keepAlive?: boolean;
}

/**
 * Injectable collaborators for {@link startServer}. Defaults wire the real
 * implementations; tests pass fakes here instead of `mock.module` (which is
 * process-global in Bun and leaks across test files — see serve.test.ts).
 */
export interface StartServerDeps {
    serverBootstrapConfig: typeof serverBootstrapConfig;
    runNodeApplication: typeof runNodeApplication;
    createApp: typeof createApp;
    createNodeFileSystem: (cwd: string) => FileSystem;
    createServerContext: typeof createServerContext;
    createScheduler: () => Promise<ServerScheduler>;
    openUrl: typeof openUrl;
}

/** Default collaborators wiring the real implementations. Exported for coverage of the lazy scheduler import. */
export const defaultDeps: StartServerDeps = {
    serverBootstrapConfig,
    runNodeApplication,
    createApp,
    createNodeFileSystem,
    createServerContext,
    // Platform-specific — scheduler-node doesn't exist on CF Workers, so it's a lazy import.
    createScheduler: async () => {
        const { NodeSchedulerAdapter } = await import('@gobing-ai/ts-infra/scheduler-node');
        return new NodeSchedulerAdapter();
    },
    openUrl,
};

/** Register built-in scheduled queue entries for the Bun serve runtime. */
export function registerSchedulerEntries(scheduler: ServerScheduler, ctx: ServerContext): void {
    scheduler.register(SYSTEM_EVENTS_PRUNE_CRON, async () => {
        const queue = await ctx.jobQueue();
        await queue.enqueue(SYSTEM_EVENTS_PRUNE_JOB, { source: 'scheduler' }, { maxRetries: 1 });
    });
    scheduler.register(SMOKE_CRON, async () => {
        const queue = await ctx.jobQueue();
        await queue.enqueue(SMOKE_JOB, { source: 'scheduler' }, { maxRetries: 1 });
    });
}

/** Parse and validate the queue payload for a board-triggered task workflow action. */
export function parseTaskActionJob(payload: unknown): TaskActionJob {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid task-action payload: expected object');
    }
    const candidate = payload as Partial<TaskActionJob>;
    if (typeof candidate.wbs !== 'string' || typeof candidate.action !== 'string') {
        throw new Error('Invalid task-action payload: missing wbs/action');
    }
    if (typeof candidate.command !== 'string' || candidate.command.trim() === '') {
        throw new Error('Invalid task-action payload: missing command');
    }
    return {
        wbs: candidate.wbs,
        action: candidate.action,
        command: candidate.command,
        channel: typeof candidate.channel === 'string' ? candidate.channel : undefined,
        skipDeps: typeof candidate.skipDeps === 'boolean' ? candidate.skipDeps : undefined,
    };
}

/** Build the real AgentService facade used by queued task-action jobs. */
export function createTaskActionAgentService(options: ConstructorParameters<typeof AgentService>[0]): {
    run: AgentService['run'];
} {
    return new AgentService(options);
}

/** Execute a validated task-action job by dispatching its mapped command to the selected local agent. */
export async function runTaskActionJob(
    ctx: ServerContext,
    env: Record<string, string | undefined>,
    payload: unknown,
    createAgentService: (options: ConstructorParameters<typeof AgentService>[0]) => {
        run: AgentService['run'];
    } = createTaskActionAgentService,
) {
    const job = parseTaskActionJob(payload);
    const agentService = createAgentService({
        cwd: ctx.cwd,
        env,
        output: {
            write: () => {},
            error: () => {},
        },
    });
    const flags: Record<string, string | boolean> = {
        cwd: ctx.cwd,
        json: true,
        ...(job.channel !== undefined ? { agent: job.channel } : {}),
    };
    const exitCode = await agentService.run(job.command, flags);
    if (exitCode !== 0) {
        throw new Error(`Task action ${job.action} for ${job.wbs} failed with exit code ${exitCode}`);
    }
}

async function resolveWebDistPath(configuredPath: string | null | undefined): Promise<string | undefined> {
    const candidates =
        configuredPath && configuredPath.trim() !== ''
            ? [isAbsolute(configuredPath) ? configuredPath : join(process.cwd(), configuredPath)]
            : [
                  join(process.cwd(), 'dist/web'),
                  join(dirname(process.execPath), '../web'),
                  join(import.meta.dir, '../../../dist/web'),
              ];

    for (const candidate of candidates) {
        if (await Bun.file(join(candidate, 'index.html')).exists()) {
            return candidate;
        }
    }

    return undefined;
}

/**
 * Single entry point for the `spur serve` launcher — shared by both the
 * standalone entry and the CLI `spur serve` command.
 *
 * Builds the `ApplicationRuntime`, wires the Hono app through `createApp`,
 * starts `Bun.serve`, optionally opens the browser, and installs
 * SIGINT/SIGTERM graceful shutdown. With `--json` prints `{ port, url, pid }`.
 *
 * `deps` is injectable for testing; production callers pass only `options`.
 */
export async function startServer(options: StartServerOptions, deps: StartServerDeps = defaultDeps): Promise<void> {
    const env = process.env as Record<string, string | undefined>;
    const bootConfig = deps.serverBootstrapConfig(env);

    await deps.runNodeApplication({
        config: bootConfig,
        async start(appRt: ApplicationRuntime) {
            const fs = deps.createNodeFileSystem(process.cwd());

            // Platform-specific — scheduler-node doesn't exist on CF Workers.
            let scheduler: ServerScheduler | undefined;
            if (bootConfig.scheduler.enabled) {
                scheduler = await deps.createScheduler();
            }

            const ctx: ServerContext = deps.createServerContext(appRt, {
                cwd: process.cwd(),
                fs,
                folders: await resolvePlanningFolders(fs),
                webDistPath: await resolveWebDistPath(options.webDistPath),
                jobQueueEnabled: bootConfig.jobqueue.enabled,
                scheduler,
                teamAutostart: bootConfig.teamAutostart,
            });
            let jobWorker: JobWorkerService<unknown> | undefined;

            // Team process autostart (task 0195/0207): spawn supervised agents listed
            // in SPUR_TEAM_AUTOSTART at serve boot. Fails loud on unknown spec ids.
            if (bootConfig.teamAutostart.length > 0) {
                try {
                    const supervisor = ctx.supervisor();
                    await supervisor.startAutostart(bootConfig.teamAutostart);
                    appRt.logger.info('Autostart agents spawned', { ids: bootConfig.teamAutostart });
                } catch (error) {
                    appRt.logger.error(
                        'Autostart failed — server will continue but supervised agents are not running',
                        {
                            error: String(error),
                        },
                    );
                    throw error;
                }
            }

            // System-event persistence tap (task 0189 wave A / 0198). Best-effort:
            // tap failures are isolated by registerSystemEventTap and never break
            // other EventBus subscribers. Bun-only — the Workers path has no long-lived bus.
            if (bootConfig.events.enabled) {
                try {
                    const dao = new SystemEventDao(await ctx.getDb());
                    registerSystemEventTap(ctx.eventBus(), dao, appRt.logger);
                    appRt.logger.debug('system_events tap registered');
                } catch (error) {
                    appRt.logger.warn('system_events tap registration failed', { error: String(error) });
                }
            }

            const app = deps.createApp(appRt, { fs, ctx });

            if (bootConfig.jobqueue.enabled) {
                const registry = new JobHandlerRegistry();
                registry.register(SYSTEM_EVENTS_PRUNE_JOB, async () => {
                    const dao = await ctx.systemEventDao();
                    await dao.prune(SYSTEM_EVENTS_CAP);
                });
                registry.register(SMOKE_JOB, async () => {});
                registry.register(TASK_ACTION_JOB, async (payload) => {
                    await runTaskActionJob(ctx, env, payload);
                });
                jobWorker = new JobWorkerService({
                    consumer: await ctx.queueConsumer(),
                    registry,
                });
                await jobWorker.start();
                appRt.logger.info('Job worker started');
            }

            if (scheduler) {
                registerSchedulerEntries(scheduler, ctx);
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
                if (scheduler) await scheduler.stop();
                if (jobWorker) await jobWorker.stop();
                try {
                    await ctx.supervisor().stopAll();
                } catch (error) {
                    appRt.logger.warn('Supervisor shutdown error', { error: String(error) });
                }
                server.stop(true);
                await appRt.stop('shutdown' as ApplicationStopReason);
                process.exit(0);
            };

            process.on('SIGINT', () => void shutdown('SIGINT'));
            process.on('SIGTERM', () => void shutdown('SIGTERM'));

            const url = `http://${options.host}:${options.port}`;

            appRt.logger.info('Server started', { port: options.port, host: options.host });

            if (options.openBrowser) {
                await deps.openUrl(`${url}/board`);
            }

            if (options.keepAlive !== false) {
                await new Promise<void>(() => {});
            }
        },
    });
}
