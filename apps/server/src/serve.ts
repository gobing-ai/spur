import { basename, dirname, isAbsolute, join } from 'node:path';
import type { SectionMatrix } from '@gobing-ai/spur-app';
import {
    type AgentQuotaUpdateConsumer,
    AgentService,
    configuredSecretValues,
    createSystemEventCatchAllSink,
    type FeatureActionJob,
    HISTORY_REFRESH_JOB,
    handleHistoryRefreshJob,
    handleSchedulerCustomJob,
    installSystemEventCatchAll,
    JobHandlerRegistry,
    JobWorkerService,
    ProjectRegistry,
    resolveAutostartSet,
    resolvePlanningFolders,
    resolveRetentionQuotas,
    resolveSchedulerCustomTimeoutMs,
    SCHEDULER_CUSTOM_JOB,
    startAgentQuotaUpdateConsumer,
    type TaskActionJob,
} from '@gobing-ai/spur-app';
import { IN_MEMORY_DATABASE_URL } from '@gobing-ai/spur-config';
import {
    bundledConfigRoot,
    loadSpurConfig,
    loadStructuredSpurConfig,
    resolveConfigFile,
} from '@gobing-ai/spur-config/loader';
import {
    failOrphanedProcessingJobs,
    failStaleSchedulerCustomJob,
    findActiveSchedulerCustomJob,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import type { ApplicationRuntime, ApplicationStopReason, SchedulerJobConfig } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { createApp, serverBootstrapConfig } from './bootstrap';
import { createServerContext, type ServerContext, type ServerScheduler } from './context';
import { registerSystemEventTap } from './modules/events/system-event-tap';
import { type SchedulerScheduleRegistration, setRegisteredSchedules } from './modules/jobs/schedule-registry';
import { openUrl } from './open-url';

/**
 * Load the Section-Status-Matrix (sole section authority, F92 R1): project-local
 * `.spur/tasks/section-matrix.yaml` first, then the bundled canonical
 * `tasks/section-matrix.yaml`. Throws with the attempted paths when neither is
 * reachable — no permissive hand-maintained fallback (it would make the same task
 * render differently by installation layout).
 */
async function loadServerSectionMatrix(): Promise<SectionMatrix> {
    const cwd = process.cwd();
    const nodeFs = createNodeFileSystem(cwd);
    const localPath = nodeFs.resolve('.spur', 'tasks', 'section-matrix.yaml');
    if (await nodeFs.exists(localPath)) {
        // SAFETY: the path pins the document shape — `.spur/tasks/section-matrix.yaml` is by contract a SectionMatrix; loader returns the generic structured-config envelope.
        return (await loadStructuredSpurConfig(localPath, { validateJsonSchema: false })) as unknown as SectionMatrix;
    }
    const root = bundledConfigRoot();
    if (root !== null) {
        const matrixPath = join(root, 'tasks', 'section-matrix.yaml');
        if (await nodeFs.exists(matrixPath)) {
            // SAFETY: same contract as the local path above — the canonical bundled `tasks/section-matrix.yaml` is a SectionMatrix by build-time generation.
            return (await loadStructuredSpurConfig(matrixPath, {
                validateJsonSchema: false,
            })) as unknown as SectionMatrix;
        }
    }
    throw new Error(
        `no canonical section-matrix found for task creation (F92 R1); tried:\n` +
            `  - ${localPath}\n` +
            (root !== null ? `  - ${join(root, 'tasks', 'section-matrix.yaml')}\n` : '') +
            'copy/generate section-matrix.yaml from the canonical build-time matrix asset (repo `config` `tasks` tree) into one of those paths',
    );
}

/** Built-in queue job kind for scheduled system_events retention pruning. */
export const SYSTEM_EVENTS_PRUNE_JOB = 'system-events-prune';

/** Built-in no-op queue job kind used as a scheduler/worker smoke path. */
export const SMOKE_JOB = 'smoke';

/** Built-in queue job kind for board-triggered task workflow actions. */
export const TASK_ACTION_JOB = 'task-action';

/** Built-in queue job kind for board-triggered feature workflow actions. */
export const FEATURE_ACTION_JOB = 'feature-action';

// Re-exported so server tests can exercise the refresh handler (task 0549 /
// feature E3) and the configured scheduler jobs (task 0734); the job kinds
// themselves are owned by the app services.
export { HISTORY_REFRESH_JOB, SCHEDULER_CUSTOM_JOB } from '@gobing-ai/spur-app';

const SYSTEM_EVENTS_PRUNE_CRON = '300000';
const SMOKE_CRON = '600000';
/** Options for {@link startServer}. */
export interface StartServerOptions {
    port: number;
    host: string;
    openBrowser: boolean;
    /** SQLite URL used by the server context. Omitted keeps createServerContext's test/Worker default. */
    dbUrl?: string;
    webDistPath?: string | null;
    keepAlive?: boolean;
    /** PATH-independent Spur invocation for the isolated history-refresh child (task 0717). */
    spurInvocation?: string;
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
    openUrl: typeof openUrl;
    resolveConfigFile: typeof resolveConfigFile;
}

/** Default collaborators wiring the real implementations. */
export const defaultDeps: StartServerDeps = {
    serverBootstrapConfig,
    runNodeApplication,
    createApp,
    createNodeFileSystem,
    createServerContext,
    openUrl,
    resolveConfigFile,
};

/** Options for {@link registerSchedulerEntries} (task 0803 R4). */
export interface SchedulerTickOptions {
    /**
     * The R1-resolved scheduler.custom child timeout in ms — the stale-processing sweep
     * threshold. Defaults to the env-resolved value so standalone callers agree with the
     * daemon boot resolution.
     */
    timeoutMs?: number;
}

/** Register built-in scheduled queue entries for the Bun serve runtime.
 * Each scheduled action emits `scheduler.job.executed` to the server EventBus
 * so the System Events tab surfaces scheduler activity alongside queue events.
 *
 * `jobs` (task 0734) are the validated `bootstrap.scheduler.jobs` definitions
 * resolved by the upstream runtime. Each configured job registers one entry
 * using its cron string or `intervalMinutes * 60_000`, enqueuing
 * `scheduler.custom` with payload `{ name, command }`. An absent/empty jobs
 * array leaves the built-in registrations unchanged.
 *
 * Task 0803 R3/R4: the tick enqueue carries `{ maxRetries: 1 }` so a failed
 * attempt goes terminal instead of re-pending and suppressing later ticks, and
 * a `processing` row older than `options.timeoutMs` is swept (failed in place,
 * `swept: true` event) before a fresh job is enqueued on the same tick. */
export function registerSchedulerEntries(
    scheduler: ServerScheduler,
    ctx: ServerContext,
    jobs: readonly SchedulerJobConfig[] = [],
    options: SchedulerTickOptions = {},
): void {
    const timeoutMs =
        options.timeoutMs ?? resolveSchedulerCustomTimeoutMs(process.env as Record<string, string | undefined>);
    const registrations: SchedulerScheduleRegistration[] = [];
    const now = Date.now();

    const register = (cron: string, name: string, action: () => Promise<void>): void => {
        scheduler.register(cron, async () => {
            const startedAt = Date.now();
            let error: unknown;
            try {
                await action();
            } catch (err) {
                error = err;
                throw err;
            } finally {
                ctx.eventBus().emit('scheduler.job.executed', {
                    name,
                    durationMs: Date.now() - startedAt,
                    ...(error !== undefined && { error: String(error) }),
                    severity: error !== undefined ? 'error' : 'info',
                });
            }
        });
    };
    register(SYSTEM_EVENTS_PRUNE_CRON, SYSTEM_EVENTS_PRUNE_JOB, async () => {
        const queue = await ctx.jobQueue();
        await queue.enqueue(SYSTEM_EVENTS_PRUNE_JOB, { source: 'scheduler' }, { maxRetries: 1 });
    });
    registrations.push({
        name: SYSTEM_EVENTS_PRUNE_JOB,
        schedule: SYSTEM_EVENTS_PRUNE_CRON,
        source: 'builtin',
        registeredAt: now,
    });

    register(SMOKE_CRON, SMOKE_JOB, async () => {
        const queue = await ctx.jobQueue();
        await queue.enqueue(SMOKE_JOB, { source: 'scheduler' }, { maxRetries: 1 });
    });
    registrations.push({
        name: SMOKE_JOB,
        schedule: SMOKE_CRON,
        source: 'builtin',
        registeredAt: now,
    });

    // Configured declarative jobs (task 0734): one queue entry per job, using the
    // validated cron string or the interval form. A tick is a normal non-coalesced
    // enqueue of `scheduler.custom`; the queue's existing retry/attempt policy owns
    // command execution, and `queue.job.*` events report the attempt outcome.
    for (const job of jobs) {
        const schedule = job.cron ?? String(job.intervalMinutes * 60_000);
        register(schedule, `${SCHEDULER_CUSTOM_JOB}:${job.name}`, async () => {
            const queue = await ctx.jobQueue();
            // Single-flight: skip if an active job with the same name already exists.
            // Without this guard, every cron tick enqueues a new row even when the
            // previous run is still processing — causing concurrent child processes
            // that compete for the SQLite write lock.
            const db = await ctx.getDb();
            const active = await findActiveSchedulerCustomJob(db, job.name);
            if (active !== undefined) {
                // Task 0803 R4: a `processing` row older than the resolved timeout means the
                // child was killed but the row never resolved (kill-delivery failure, handler
                // wedge). Sweep it and enqueue a fresh job on this same tick — no daemon
                // restart needed. Younger processing rows and any pending row keep the
                // single-flight skip.
                const now = Date.now();
                const stale =
                    active.status === 'processing' && now - (active.processingAt ?? active.updatedAt) > timeoutMs;
                if (stale) {
                    const reason = `watchdog: processing exceeded ${timeoutMs}ms`;
                    const swept = await failStaleSchedulerCustomJob(db, active.id, now, reason);
                    if (swept) {
                        ctx.eventBus().emit('scheduler.job.executed', {
                            name: `${SCHEDULER_CUSTOM_JOB}:${job.name}`,
                            durationMs: 0,
                            severity: 'info',
                            swept: true,
                            reason,
                        });
                    }
                } else {
                    ctx.eventBus().emit('scheduler.job.executed', {
                        name: `${SCHEDULER_CUSTOM_JOB}:${job.name}`,
                        durationMs: 0,
                        severity: 'info',
                        skipped: true,
                        reason: `active job ${active.id} already exists`,
                    });
                    return;
                }
            }
            // Task 0803 R3: one attempt per enqueue — the default 3-attempt policy re-pends a
            // failed row, and the single-flight lookup counts `pending` as active, so retries
            // would suppress later ticks for the whole backoff window. The next tick is the
            // natural retry for an idempotent periodic command.
            await queue.enqueue(SCHEDULER_CUSTOM_JOB, { name: job.name, command: job.command }, { maxRetries: 1 });
        });
        registrations.push({
            name: job.name,
            schedule,
            source: 'config',
            registeredAt: now,
        });
    }

    setRegisteredSchedules(registrations);
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

/**
 * Execute a validated task-action job by dispatching its mapped command to the
 * selected local agent.
 *
 * Process boundary policy (task 0226 F3): all 6 current task actions
 * (`refine`, `plan`, `run`, `verify`, `decompose`, `evaluate`) map to
 * AI-driven agent slash commands (`/sp:dev-*`). The server's `AgentService`
 * spawns a child CLI process to execute them. Parent-level `agent.invoke.*`
 * and `process.*` events ARE captured on the server bus because
 * `ctx.agentService()` threads `events: ctx.eventBus()` into the `AiRunner`.
 * However, if the child agent internally runs `spur workflow run` or
 * `spur rule run`, those nested CLI events happen in a separate process with
 * its own process-local bus and do NOT cross back to the parent server bus.
 *
 * This is an intentional v1 scope limit: only parent-level agent/process/queue
 * lifecycle events are board-observable for board-triggered task actions.
 * Nested workflow/rule events require either server-native execution
 * (`ctx.workflowService()` / `ctx.ruleService()` accessors, wired in F4) or
 * an explicit IPC event bridge, both deferred to follow-up tasks.
 */
export async function runTaskActionJob(
    ctx: ServerContext,
    env: Record<string, string | undefined>,
    payload: unknown,
    createAgentService: (options: ConstructorParameters<typeof AgentService>[0]) => {
        run: AgentService['run'];
    } = createTaskActionAgentService,
) {
    const job = parseTaskActionJob(payload);
    // Server-native jobs (task 0226 F2) use the canonical ctx.agentService()
    // accessor so the server EventBus is the same one the system-events tap
    // is subscribed to. Test/CF paths can still inject a custom
    // `createAgentService` for the agent-run seam.
    const agentService =
        createAgentService === createTaskActionAgentService
            ? ctx.agentService()
            : createAgentService({
                  cwd: ctx.cwd,
                  env,
                  events: ctx.eventBus(),
                  output: { write: () => {}, error: () => {} },
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

/** Parse and validate the queue payload for a board-triggered feature workflow action. */
export function parseFeatureActionJob(payload: unknown): FeatureActionJob {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid feature-action payload: expected object');
    }
    const candidate = payload as Partial<FeatureActionJob>;
    if (typeof candidate.featureId !== 'string' || typeof candidate.action !== 'string') {
        throw new Error('Invalid feature-action payload: missing featureId/action');
    }
    if (typeof candidate.command !== 'string' || candidate.command.trim() === '') {
        throw new Error('Invalid feature-action payload: missing command');
    }
    return {
        featureId: candidate.featureId,
        action: candidate.action,
        command: candidate.command,
        channel: typeof candidate.channel === 'string' ? candidate.channel : undefined,
        skipDeps: typeof candidate.skipDeps === 'boolean' ? candidate.skipDeps : undefined,
    };
}

/**
 * Execute a validated feature-action job by dispatching its mapped command to the
 * selected local agent.
 */
export async function runFeatureActionJob(
    ctx: ServerContext,
    env: Record<string, string | undefined>,
    payload: unknown,
    createAgentService: (options: ConstructorParameters<typeof AgentService>[0]) => {
        run: AgentService['run'];
    } = createTaskActionAgentService,
) {
    const job = parseFeatureActionJob(payload);
    const agentService =
        createAgentService === createTaskActionAgentService
            ? ctx.agentService()
            : createAgentService({
                  cwd: ctx.cwd,
                  env,
                  events: ctx.eventBus(),
                  output: { write: () => {}, error: () => {} },
              });
    const flags: Record<string, string | boolean> = {
        cwd: ctx.cwd,
        json: true,
        ...(job.channel !== undefined ? { agent: job.channel } : {}),
    };
    const exitCode = await agentService.run(job.command, flags);
    if (exitCode !== 0) {
        throw new Error(`Feature action ${job.action} for ${job.featureId} failed with exit code ${exitCode}`);
    }
}

/** Execute task action job payload. */
export async function handleTaskActionJob(
    ctx: ServerContext,
    env: Record<string, string | undefined>,
    payload: unknown,
): Promise<void> {
    await runTaskActionJob(ctx, env, payload);
}

/** Execute feature action job payload. */
export async function handleFeatureActionJob(
    ctx: ServerContext,
    env: Record<string, string | undefined>,
    payload: unknown,
): Promise<void> {
    await runFeatureActionJob(ctx, env, payload);
}

/**
 * Resolve the directory that holds the built Spur Board (Astro) static assets.
 *
 * Search order when no explicit path is configured:
 * 1. `cwd/dist/web` — monorepo / local `bun run build` output
 * 2. `import.meta.dir/web` — npm package layout (`web/` next to bundled `spur.js`)
 * 3. `dirname(process.execPath)/web` — standalone binary with sibling `web/`
 * 4. `dirname(process.execPath)/../web` — binary under `bin/` with `web/` as sibling of parent
 * 5. `import.meta.dir/../../../dist/web` — unbundled server source under `apps/server/src`
 *
 * When a configured path is set, only that path is tried (absolute, or relative to cwd).
 */
export async function resolveWebDistPath(configuredPath: string | null | undefined): Promise<string | undefined> {
    const candidates =
        configuredPath && configuredPath.trim() !== ''
            ? [isAbsolute(configuredPath) ? configuredPath : join(process.cwd(), configuredPath)]
            : [
                  join(process.cwd(), 'dist/web'),
                  // npm global/local install: package ships `web/` next to spur.js
                  join(import.meta.dir, 'web'),
                  join(dirname(process.execPath), 'web'),
                  join(dirname(process.execPath), '../web'),
                  // monorepo: apps/server/src → ../../../dist/web
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
    const configFile = deps.resolveConfigFile();

    await deps.runNodeApplication({
        config: bootConfig,
        configLoader: configFile ? { configFile, bootstrapSection: 'bootstrap' } : undefined,
        async start(appRt: ApplicationRuntime) {
            const fs = deps.createNodeFileSystem(process.cwd());
            if (options.dbUrl && options.dbUrl !== IN_MEMORY_DATABASE_URL) {
                await fs.ensureDir(dirname(options.dbUrl));
            }

            // The upstream runtime owns the sole scheduler lifecycle (task 0734 R4):
            // it constructs the adapter before this callback and its scheduler
            // plugin starts it after, so we only register entries against it. When
            // the scheduler is disabled, `appRt.scheduler` is undefined and there is
            // nothing to register.
            const scheduler = appRt.config.scheduler.enabled ? appRt.scheduler : undefined;

            const webDistPath = await resolveWebDistPath(options.webDistPath);
            if (!webDistPath) {
                appRt.logger.warn(
                    'Board UI static assets not found — /board will return 404. ' +
                        'Reinstall a package that includes the web board, or set server.webDistPath ' +
                        'to a built dist/web directory (index.html).',
                );
            }

            // Load the merged global+project config ONCE (A5/ADR-082) and thread
            // it into the server context so Team/Workflow services + the history-
            // refresh job (J8 R2) never re-read the config per slice. A load failure
            // degrades to null (env-only) here, same tolerance as the CLI root.
            const spurConfig = await loadSpurConfig(process.cwd()).catch(() => null);

            const ctx: ServerContext = deps.createServerContext(appRt, {
                cwd: process.cwd(),
                fs,
                dbUrl: options.dbUrl,
                folders: await resolvePlanningFolders(fs),
                sectionMatrix: await loadServerSectionMatrix(),
                webDistPath,
                jobQueueEnabled: bootConfig.jobqueue.enabled,
                scheduler,
                teamAutostart: bootConfig.teamAutostart,
                bootConfig,
                ...(spurConfig !== undefined ? { spurConfig } : {}),
            });
            let jobWorker: JobWorkerService<unknown> | undefined;

            // 0799 R5: the ONE project-scoped quota-update consumer starts BEFORE
            // autostart or any dispatch acceptance, so exhaustion/recovery
            // events (including CLI work emitted while the server was offline)
            // are subscribed before supervised agents can select executors.
            // Pending rows drain on the 30s poll cadence, not synchronously at
            // startup (dogfood 54D294E4D301 F1); the disable lands at the next
            // launch boundary. The consumer owns the exhaustion/recovery
            // subscriptions and drains them serially; startup failure is logged
            // and non-fatal so the server still serves (rows stay pending and
            // retry on the next start).
            let quotaConsumer: AgentQuotaUpdateConsumer | undefined;
            try {
                quotaConsumer = startAgentQuotaUpdateConsumer(ctx.eventBus(), {
                    getDb: () => ctx.getDb(),
                    projectRoot: ctx.cwd,
                    // Composition-root-owned loader call (ADR-082): serve.ts is
                    // an allowed root; the consumer gets the closed-over accessor.
                    loadAgentConfig: async () => {
                        try {
                            return await loadSpurConfig(ctx.cwd);
                        } catch {
                            return null;
                        }
                    },
                    warn: (message) => appRt.logger.warn(message),
                });
                appRt.logger.debug('agent quota update consumer started');
            } catch (error) {
                appRt.logger.warn('agent quota update consumer failed to start', { error: String(error) });
            }

            // Team process autostart (0195/0207 + 0258 R8): members whose effective
            // autostart is true across `agent.team.*`, unioned with the SPUR_TEAM_AUTOSTART
            // env. `resolveAutostartSet` handles both; a load failure degrades to env-only.
            // The same loaded config threads `agent` into the history-refresh job (J8 R2).
            const autostartIds = resolveAutostartSet(spurConfig, env.SPUR_TEAM_AUTOSTART);
            if (autostartIds.length > 0) {
                try {
                    const supervisor = ctx.supervisor();
                    await supervisor.startAutostart(autostartIds);
                    appRt.logger.info('Autostart agents spawned', { ids: autostartIds });
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
                    registerSystemEventTap(ctx.eventBus(), dao, appRt.logger, {
                        diagnosticEnabled: bootConfig.events.diagnostic === true,
                        retention: bootConfig.events.retention,
                        secretValues: configuredSecretValues(env),
                        projectContext: ctx.systemEventProjectContext(),
                    });
                    // Catalog-open ingestion (task 0794 R5): uncataloged names
                    // persist through the same DAO/quotas/secrets/project
                    // context; cataloged names stay tap-owned, so no duplicate
                    // row. Installed once per process (idempotent wrapper, Q4).
                    // Best-effort, lossy-on-shutdown (task 0802 R2 / D1): like
                    // the cataloged tap above, in-flight uncataloged persists are
                    // discarded when the server exits — there is no shutdown
                    // drain for either sink. Documented, not drained: a
                    // catch-all-only drain would not close the loss window and
                    // would add the asymmetry 0794 deliberately avoided. The CLI
                    // ledger path is the durable seam (it drains both).
                    installSystemEventCatchAll(
                        ctx.eventBus(),
                        createSystemEventCatchAllSink({
                            dao,
                            logger: appRt.logger,
                            retention: bootConfig.events.retention,
                            secretValues: configuredSecretValues(env),
                            projectContext: ctx.systemEventProjectContext(),
                        }),
                    );
                    appRt.logger.debug('system_events tap registered', {
                        diagnostic: bootConfig.events.diagnostic === true,
                    });
                } catch (error) {
                    appRt.logger.warn('system_events tap registration failed', { error: String(error) });
                }
            }

            const app = deps.createApp(appRt, { fs, ctx });

            // Task 0803 R1: the child watchdog timeout is resolved once at daemon boot and
            // threads into both child-spawning queue handlers and the tick's stale-row
            // sweep threshold, so env, kill deadline, and watchdog agree on one number.
            const schedulerCustomTimeoutMs = resolveSchedulerCustomTimeoutMs(env);

            if (bootConfig.jobqueue.enabled) {
                const registry = new JobHandlerRegistry();
                // Scheduled per-prefix retention prune (task 0368 R2): every
                // catalog prefix is pruned to its resolved quota on the cron.
                // Quotas resolved once here; the job body is a thin DAO call.
                const retentionQuotas = resolveRetentionQuotas(bootConfig.events.retention);
                registry.register(SYSTEM_EVENTS_PRUNE_JOB, async () => {
                    const dao = await ctx.systemEventDao();
                    await dao.pruneQuotas(retentionQuotas);
                });
                registry.register(SMOKE_JOB, async () => {});
                registry.register(TASK_ACTION_JOB, (payload) => handleTaskActionJob(ctx, env, payload));
                registry.register(FEATURE_ACTION_JOB, (payload) => handleFeatureActionJob(ctx, env, payload));
                // Completion-triggered history refresh (task 0549): enqueued (coalesced)
                // by CLI trigger points; consumed here. Since 0717 the job body runs
                // `history daily` in an isolated child process, so the server only
                // awaits its exit — the child owns every `history.*` event.
                const childExecutor = new NodeProcessExecutor();
                registry.register(HISTORY_REFRESH_JOB, (job) =>
                    handleHistoryRefreshJob(
                        {
                            cwd: ctx.cwd,
                            ...(options.dbUrl !== undefined ? { databaseUrl: options.dbUrl } : {}),
                            // Omitted invocation fails loudly in splitLaunchCommand at run time.
                            invocation: options.spurInvocation ?? '',
                            executor: childExecutor,
                            timeoutMs: schedulerCustomTimeoutMs,
                        },
                        job,
                    ),
                );
                // Configured `bootstrap.scheduler.jobs` ticks (task 0734): the
                // scheduler only enqueues; the command runs here, in a child, under
                // the queue's existing attempt/retry policy.
                registry.register(SCHEDULER_CUSTOM_JOB, (job) =>
                    handleSchedulerCustomJob(
                        { cwd: ctx.cwd, executor: childExecutor, timeoutMs: schedulerCustomTimeoutMs },
                        job,
                    ),
                );
                // Startup sweep: fail orphaned `processing` jobs left by a prior server
                // crash/restart. Without this, rows stuck in `processing` are never retried
                // and hold conceptual locks on resources like the SQLite database.
                const orphanCount = await failOrphanedProcessingJobs(await ctx.getDb(), Date.now());
                if (orphanCount > 0) {
                    appRt.logger.warn('Swept orphaned processing jobs at startup', {
                        count: orphanCount,
                    });
                }
                jobWorker = new JobWorkerService({
                    consumer: await ctx.queueConsumer(),
                    registry,
                });
                await jobWorker.start();
                appRt.logger.info('Job worker started');
            }

            if (scheduler) {
                // Register built-in + configured entries before the upstream
                // scheduler plugin auto-starts (registration order: user callback
                // runs before scheduler start — verified in ts-infra application
                // tests). Configured jobs come only from the resolved runtime config.
                registerSchedulerEntries(scheduler, ctx, appRt.config.scheduler.jobs, {
                    timeoutMs: schedulerCustomTimeoutMs,
                });
                appRt.logger.info('Scheduler entries registered', { jobs: appRt.config.scheduler.jobs.length });
            }

            const server = Bun.serve({
                fetch: app.fetch,
                port: options.port,
                hostname: options.host,
            });

            const projectRegistry = new ProjectRegistry();
            const projectCwd = process.cwd();
            const projectName = basename(projectCwd);
            try {
                await projectRegistry.upsert({ path: projectCwd, name: projectName, port: server.port });
            } catch (err) {
                appRt.logger.warn('Failed to register project in ProjectRegistry', { error: String(err) });
            }

            // Named handlers so shutdown can detach them before process.exit —
            // otherwise tests (and double-signals) keep firing into a dying process.
            let shuttingDown = false;
            const onSigInt = () => {
                void shutdown('SIGINT');
            };
            const onSigTerm = () => {
                void shutdown('SIGTERM');
            };

            const shutdown = async (signal: string) => {
                if (shuttingDown) return;
                shuttingDown = true;
                process.off('SIGINT', onSigInt);
                process.off('SIGTERM', onSigTerm);
                appRt.logger.info('Shutting down server', { signal });
                // 0799 R5: detach quota subscriptions and drain active persistence
                // writes (plus one final drain) before supervisor teardown and DB
                // close — a shutdown must never race or drop a recorded update.
                if (quotaConsumer) {
                    try {
                        await quotaConsumer.stop();
                    } catch (error) {
                        appRt.logger.warn('Agent quota update consumer shutdown error', { error: String(error) });
                    }
                }
                try {
                    await projectRegistry.setPort(projectCwd, 0);
                } catch (err) {
                    appRt.logger.warn('Failed to deregister project port in ProjectRegistry', { error: String(err) });
                }
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

            process.on('SIGINT', onSigInt);
            process.on('SIGTERM', onSigTerm);

            const url = `http://${options.host}:${options.port}`;

            appRt.logger.info('Server started', {
                port: options.port,
                host: options.host,
                board: webDistPath ? `${url}/board` : null,
            });

            if (options.openBrowser) {
                // Only open the board when static assets resolved; otherwise the
                // browser lands on a JSON 404 that looks like a broken install.
                await deps.openUrl(webDistPath ? `${url}/board` : `${url}/api/health`);
            }
        },
    });

    // Keep the process alive AFTER the user callback resolves. The callback must
    // return so the runtime's plugin chain can finish — the scheduler plugin
    // starts the adapter there (task 0734), and a never-resolving callback
    // starved it, leaving every registered cron entry dead (Sep 2 – Sep 6 2026).
    // Bun.serve alone does not hold the loop for the CLI `serve` command path.
    if (options.keepAlive !== false) {
        await new Promise<void>(() => {});
    }
}
