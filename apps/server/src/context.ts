import { dirname, join } from 'node:path';
import type {
    FeatureService,
    PlanningEvent as PlanningEventType,
    PlanningFolders,
    SupervisorService,
    TaskService,
    TeamService,
} from '@gobing-ai/spur-app';
import {
    BusPlanningEventEmitter,
    type EventEmitter,
    FeatureService as FeatureServiceImpl,
    type PlanningEventMap,
    PlanningWriteService as PlanningWriteServiceImpl,
    SupervisorService as SupervisorServiceImpl,
    TaskService as TaskServiceImpl,
    TeamService as TeamServiceImpl,
} from '@gobing-ai/spur-app';
// CF-safe core import: DEFAULT_* are plain string constants in the dependency-free core
// entry of @gobing-ai/spur-config (no `yaml`/`node:fs`). This narrows the former inline-
// literal exception to a "core import only" boundary (ADR-027, planning-folder-hardcode rule).
import {
    DEFAULT_DATABASE_URL,
    DEFAULT_FEATURES_DIR,
    DEFAULT_TASKS_DIR,
    IN_MEMORY_DATABASE_URL,
} from '@gobing-ai/spur-config';
import {
    createMigratedDbViaRuntime,
    type DbAdapter,
    dbHealthCheck,
    PlanningEventDao,
    type ServerQueueConsumer,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import type { EventBus, JobQueue, SchedulerAdapter } from '@gobing-ai/ts-infra';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { ProcessExecutor } from '@gobing-ai/ts-runtime';

type ServerEventMap = Record<string, (detail: PlanningEventType | unknown) => void>;

class LazyPlanningEventEmitter implements EventEmitter {
    private delegate: EventEmitter | null = null;
    constructor(
        private readonly getDb: () => Promise<DbAdapter>,
        private readonly bus: EventBus<ServerEventMap>,
    ) {}

    async emit(event: PlanningEventType): Promise<void> {
        if (!this.delegate) {
            const db = await this.getDb();
            const dao = new PlanningEventDao(db);
            this.delegate = new BusPlanningEventEmitter(this.bus as unknown as EventBus<PlanningEventMap>, dao);
        }
        await this.delegate.emit(event);
    }
}

// Schema-default planning folders, used when serve.ts passes no resolved folders
// (e.g. pure Workers bootstrap with no FS). Sourced from the config SSOT, not inlined.
const DEFAULT_PLANNING_FOLDERS: PlanningFolders = {
    tasksDir: DEFAULT_TASKS_DIR,
    featuresDir: DEFAULT_FEATURES_DIR,
    foldersConfig: { active_folder: DEFAULT_TASKS_DIR, folders: { [DEFAULT_TASKS_DIR]: { base_counter: 0 } } },
};

/**
 * Server job-queue handle — the ts-infra `JobQueue` producer interface
 * (`enqueue`/`enqueueBatch`/`stats`), backed by `DBJobQueue` over `QueueJobDao`.
 */
export type ServerJobQueue = JobQueue<unknown>;

/**
 * Server scheduler handle — the ts-infra `SchedulerAdapter` interface
 * (`register(cron, action)`/`start`/`stop`), backed by `NodeSchedulerAdapter`
 * on Bun or a Cloudflare adapter on Workers.
 */
export type ServerScheduler = SchedulerAdapter;

/**
 * Server-side analogue of the CLI's `CliContext`. Lazily-initialized
 * service accessors built from the ApplicationRuntime's db/events/logger,
 * plus a cwd-bound FileSystem.
 *
 * @see design §2.3
 */
export interface ServerContext {
    readonly cwd: string;
    readonly fs: FileSystem;
    readonly webDistPath?: string;

    /** Lazy, cached migrated DbAdapter. May throw D1NotConfiguredError on CF. */
    getDb(): Promise<DbAdapter>;

    /** Readiness probe: resolve the DB then run a trivial liveness query. */
    checkDbHealth(): Promise<boolean>;

    /** Lazy, cached TaskService (planning layer). */
    taskService(): TaskService;

    /** Lazy, cached FeatureService (planning layer). */
    featureService(): FeatureService;

    /** Lazy, cached TeamService (messaging + team status). */
    teamService(): TeamService;

    /** Lazy, cached SupervisorService (process supervision, task 0195/0207). */
    supervisor(): SupervisorService;

    /** Lazy SystemEventDao (system_events ledger) for the history endpoint + tap. */
    systemEventDao(): Promise<SystemEventDao>;

    /**
     * Resolved planning folders (phase folders) from `.spur/config.yaml` (via
     * serve.ts), or schema defaults when no config/FS is available. The task.folders
     * endpoint derives its response from this — never reads `docs/.tasks/config.jsonc`.
     */
    planningFolders(): PlanningFolders;

    /** EventBus<ServerEventMap> — pub/sub seam for SSE, planning, queue, and scheduler events. */
    eventBus(): EventBus<ServerEventMap>;

    /**
     * Job queue for async work (history import, rule runs) — a `DBJobQueue` over
     * `QueueJobDao` (the migrated `queue_jobs` table). Lazy + cached; async because
     * it resolves the DB adapter first. Opt-in via `jobQueueEnabled`; throws
     * `NotConfiguredError` when disabled (the single-operator default).
     */
    jobQueue(): Promise<ServerJobQueue>;

    /**
     * Job worker consumer for the in-process Bun serve worker. Shares the same
     * migrated DB and EventBus as {@link jobQueue}. Disabled with the queue.
     */
    queueConsumer(): Promise<ServerQueueConsumer<unknown>>;

    /**
     * Scheduler for periodic tasks (stale-lock cleanup, analytics) — a real
     * `SchedulerAdapter` (`NodeSchedulerAdapter` on Bun, a Cloudflare adapter on
     * Workers, supplied by the entry). Opt-in; throws `NotConfiguredError` when
     * no adapter is configured (the default).
     */
    scheduler(): ServerScheduler;
}

/** Options for `createServerContext`. */
export interface CreateServerContextOptions {
    cwd: string;
    /** Environment map for subprocess-aware services (TeamService). Defaults to {}. */
    env?: Record<string, string | undefined>;
    fs: FileSystem;
    webDistPath?: string;
    dbUrl?: string;
    /** Pre-built EventBus from bootstrapper. Defaults to appRt.events. */
    eventsBus?: EventBus<ServerEventMap>;
    /** Pre-built SchedulerAdapter from bootstrapper. */
    scheduler?: ServerScheduler;
    /** When true, jobQueue()/queueConsumer() are available. Default false. */
    jobQueueEnabled?: boolean;
    /**
     * Pre-resolved planning folders (phase folders) from `.spur/config.yaml`. The
     * bootstrap (`serve.ts`) resolves these async and passes them in so the sync
     * service accessors never hardcode `docs/tasks`. Omitted → schema defaults.
     */
    folders?: PlanningFolders;
    /**
     * Agent spec ids for autostart (task 0195/0207). The supervisor spawns these
     * at serve boot; a missing spec id fails loud. Omitted → no autostart.
     */
    teamAutostart?: string[];
}

/** Error thrown when a disabled facility accessor is called. */
class NotConfiguredError extends Error {
    constructor(facility: string) {
        super(`${facility} is not configured — enable it in the bootstrap/server config`);
        this.name = 'NotConfiguredError';
    }
}

/**
 * Build a server-side context from an ApplicationRuntime (design §2.3).
 *
 * Services are lazy-initialized on first accessor call and cached per
 * process/isolate — same pattern as CliContext.
 *
 * The `fs` parameter is required — the caller (bootstrap.ts or index.ts)
 * obtains it from ts-runtime via dynamic import to avoid platform-detection
 * code loading at module-init time in the Cloudflare Workers path.
 */
export function createServerContext(appRt: ApplicationRuntime, options: CreateServerContextOptions): ServerContext {
    const cwd = options.cwd;
    const fs = options.fs;
    const dbUrl = options.dbUrl ?? join(cwd, DEFAULT_DATABASE_URL);
    const eventsBus = options.eventsBus ?? (appRt.events as unknown as EventBus<ServerEventMap>);
    const jobQueueEnabled = options.jobQueueEnabled ?? false;
    // Planning folders (phase folders) come pre-resolved from `.spur/config.yaml` via
    // serve.ts — never hardcoded here. Fall back to schema defaults when absent.
    const folders = options.folders ?? DEFAULT_PLANNING_FOLDERS;

    // ── Lazy caches ──
    let dbPromise: Promise<DbAdapter> | undefined;
    let taskSvc: TaskService | undefined;
    let featureSvc: FeatureService | undefined;
    let teamSvc: TeamService | undefined;
    let supervisorSvc: SupervisorService | undefined;
    let systemEventDaoPromise: Promise<SystemEventDao> | undefined;
    let jobQueuePromise: Promise<ServerJobQueue> | undefined;
    let queueConsumerPromise: Promise<ServerQueueConsumer<unknown>> | undefined;

    return {
        cwd,
        fs,
        webDistPath: options.webDistPath,

        async getDb(): Promise<DbAdapter> {
            dbPromise ??= (async () => {
                if (dbUrl !== IN_MEMORY_DATABASE_URL) {
                    await fs.ensureDir(dirname(dbUrl));
                }
                return createMigratedDbViaRuntime({ url: dbUrl });
            })();
            return dbPromise;
        },

        async checkDbHealth(): Promise<boolean> {
            const db = await this.getDb();
            return dbHealthCheck(db);
        },

        taskService(): TaskService {
            if (!taskSvc) {
                const lazyEmitter = new LazyPlanningEventEmitter(() => this.getDb(), eventsBus);
                taskSvc = new TaskServiceImpl({
                    fs,
                    writeService: new PlanningWriteServiceImpl({ fs, projectName: 'spur', emitter: lazyEmitter }),
                    tasksDir: folders.tasksDir,
                    foldersConfig: folders.foldersConfig,
                    projectName: 'spur',
                });
            }
            return taskSvc;
        },

        featureService(): FeatureService {
            if (!featureSvc) {
                const lazyEmitter = new LazyPlanningEventEmitter(() => this.getDb(), eventsBus);
                featureSvc = new FeatureServiceImpl({
                    fs,
                    writeService: new PlanningWriteServiceImpl({ fs, projectName: 'spur', emitter: lazyEmitter }),
                    featuresDir: folders.featuresDir,
                    tasksDir: folders.tasksDir,
                    projectName: 'spur',
                });
            }
            return featureSvc;
        },

        teamService(): TeamService {
            if (!teamSvc) {
                teamSvc = new TeamServiceImpl({
                    cwd,
                    env: options.env ?? {},
                    fs,
                    getDb: () => this.getDb(),
                    // Wire the server bus so message lifecycle events flow to the
                    // system_events tap + SSE stream (task 0193/0204). Structurally
                    // compatible — both are Record<string, (event) => void> buses.
                    eventBus: eventsBus as unknown as never,
                });
            }
            return teamSvc;
        },

        supervisor(): SupervisorService {
            if (!supervisorSvc) {
                const pe = new ProcessExecutor();
                supervisorSvc = new SupervisorServiceImpl({
                    processExecutor: pe,
                    eventBus: eventsBus as unknown as never,
                    configDir: `${cwd}/.spur/agents`,
                });
            }
            return supervisorSvc;
        },

        async systemEventDao(): Promise<SystemEventDao> {
            systemEventDaoPromise ??= this.getDb().then((db) => new SystemEventDao(db));
            return systemEventDaoPromise;
        },

        planningFolders(): PlanningFolders {
            return folders;
        },

        eventBus(): EventBus<ServerEventMap> {
            return eventsBus;
        },

        async jobQueue(): Promise<ServerJobQueue> {
            if (!jobQueueEnabled) {
                throw new NotConfiguredError('jobQueue');
            }
            // Real DBJobQueue over QueueJobDao (the migrated queue_jobs table).
            // Lazy + cached; resolves the DB adapter, then builds the producer.
            jobQueuePromise ??= (async () => {
                // The ts-db/ts-infra job-queue wiring lives in @gobing-ai/spur-domain
                // (which owns the ts-db boundary + the queue_jobs schema), so apps/server
                // imports neither ts-db nor the ts-infra subpath directly. The domain
                // helper lazy-imports both, keeping this file Worker-safe.
                const { createJobQueue } = await import('@gobing-ai/spur-domain');
                const db = await this.getDb();
                return createJobQueue(db, eventsBus);
            })();
            return jobQueuePromise;
        },

        async queueConsumer(): Promise<ServerQueueConsumer<unknown>> {
            if (!jobQueueEnabled) {
                throw new NotConfiguredError('queueConsumer');
            }
            queueConsumerPromise ??= (async () => {
                const { createQueueConsumer } = await import('@gobing-ai/spur-domain');
                const db = await this.getDb();
                return createQueueConsumer(db, { events: eventsBus as never });
            })();
            return queueConsumerPromise;
        },

        scheduler(): ServerScheduler {
            if (options.scheduler) {
                return options.scheduler;
            }
            throw new NotConfiguredError('scheduler');
        },
    };
}
