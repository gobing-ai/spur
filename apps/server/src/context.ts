import type {
    FeatureService,
    PlanningEvent as PlanningEventType,
    PlanningFolders,
    TaskService,
} from '@gobing-ai/spur-app';
import {
    FeatureService as FeatureServiceImpl,
    PlanningWriteService as PlanningWriteServiceImpl,
    TaskService as TaskServiceImpl,
} from '@gobing-ai/spur-app';
// CF-safe core import: DEFAULT_* are plain string constants in the dependency-free core
// entry of @gobing-ai/spur-config (no `yaml`/`node:fs`). This narrows the former inline-
// literal exception to a "core import only" boundary (ADR-027, planning-folder-hardcode rule).
import { DEFAULT_FEATURES_DIR, DEFAULT_TASKS_DIR } from '@gobing-ai/spur-config';
import { createMigratedDbViaRuntime, type DbAdapter, dbHealthCheck } from '@gobing-ai/spur-domain';
import type { EventBus, JobQueue, SchedulerAdapter } from '@gobing-ai/ts-infra';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';

type PlanningEventMap = Record<string, (detail: PlanningEventType) => void>;

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

    /**
     * Resolved planning folders (phase folders) from `.spur/config.yaml` (via
     * serve.ts), or schema defaults when no config/FS is available. The task.folders
     * endpoint derives its response from this — never reads `docs/.tasks/config.jsonc`.
     */
    planningFolders(): PlanningFolders;

    /** EventBus<PlanningEventMap> — pub/sub seam for SSE (S6) and planning events. */
    eventBus(): EventBus<PlanningEventMap>;

    /**
     * Job queue for async work (history import, rule runs) — a `DBJobQueue` over
     * `QueueJobDao` (the migrated `queue_jobs` table). Lazy + cached; async because
     * it resolves the DB adapter first. Opt-in via `jobQueueEnabled`; throws
     * `NotConfiguredError` when disabled (the single-operator default).
     */
    jobQueue(): Promise<ServerJobQueue>;

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
    fs: FileSystem;
    webDistPath?: string;
    dbUrl?: string;
    /** Pre-built EventBus from bootstrapper. Defaults to appRt.events. */
    eventsBus?: EventBus<PlanningEventMap>;
    /** Pre-built SchedulerAdapter from bootstrapper. */
    scheduler?: ServerScheduler;
    /** When true, jobQueue() returns a "not configured" stub. Default true. */
    jobQueueEnabled?: boolean;
    /**
     * Pre-resolved planning folders (phase folders) from `.spur/config.yaml`. The
     * bootstrap (`serve.ts`) resolves these async and passes them in so the sync
     * service accessors never hardcode `docs/tasks`. Omitted → schema defaults.
     */
    folders?: PlanningFolders;
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
    const dbUrl = options.dbUrl ?? ':memory:';
    const eventsBus = options.eventsBus ?? (appRt.events as unknown as EventBus<PlanningEventMap>);
    const jobQueueEnabled = options.jobQueueEnabled ?? false;
    // Planning folders (phase folders) come pre-resolved from `.spur/config.yaml` via
    // serve.ts — never hardcoded here. Fall back to schema defaults when absent.
    const folders = options.folders ?? DEFAULT_PLANNING_FOLDERS;

    // ── Lazy caches ──
    let dbPromise: Promise<DbAdapter> | undefined;
    let taskSvc: TaskService | undefined;
    let featureSvc: FeatureService | undefined;
    let jobQueuePromise: Promise<ServerJobQueue> | undefined;

    return {
        cwd,
        fs,
        webDistPath: options.webDistPath,

        async getDb(): Promise<DbAdapter> {
            dbPromise ??= createMigratedDbViaRuntime({ url: dbUrl });
            return dbPromise;
        },

        async checkDbHealth(): Promise<boolean> {
            const db = await this.getDb();
            return dbHealthCheck(db);
        },

        taskService(): TaskService {
            if (!taskSvc) {
                taskSvc = new TaskServiceImpl({
                    fs,
                    writeService: new PlanningWriteServiceImpl({ fs, projectName: 'spur' }),
                    tasksDir: folders.tasksDir,
                    foldersConfig: folders.foldersConfig,
                    projectName: 'spur',
                });
            }
            return taskSvc;
        },

        featureService(): FeatureService {
            if (!featureSvc) {
                featureSvc = new FeatureServiceImpl({
                    fs,
                    writeService: new PlanningWriteServiceImpl({ fs, projectName: 'spur' }),
                    featuresDir: folders.featuresDir,
                    tasksDir: folders.tasksDir,
                    projectName: 'spur',
                });
            }
            return featureSvc;
        },

        planningFolders(): PlanningFolders {
            return folders;
        },

        eventBus(): EventBus<PlanningEventMap> {
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

        scheduler(): ServerScheduler {
            if (options.scheduler) {
                return options.scheduler;
            }
            throw new NotConfiguredError('scheduler');
        },
    };
}
