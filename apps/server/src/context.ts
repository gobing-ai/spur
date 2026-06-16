import type { FeatureService, PlanningEvent as PlanningEventType, TaskService } from '@gobing-ai/spur-app';
import {
    FeatureService as FeatureServiceImpl,
    PlanningWriteService as PlanningWriteServiceImpl,
    TaskService as TaskServiceImpl,
} from '@gobing-ai/spur-app';
import { createMigratedDbViaRuntime, type DbAdapter, dbHealthCheck } from '@gobing-ai/spur-domain';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';

type PlanningEventMap = Record<string, (detail: PlanningEventType) => void>;

/** Minimal job queue interface — the runtime shape of ts-infra's DBJobQueue. */
export interface ServerJobQueue {
    enqueue(type: string, payload: unknown): Promise<string>;
}

/** Minimal scheduler interface — the runtime shape of ts-infra's SchedulerAdapter. */
export interface ServerScheduler {
    register(cron: string, name: string, handler: () => Promise<void>): void;
    start(): Promise<void>;
    stop(): Promise<void>;
}

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

    /** EventBus<PlanningEventMap> — pub/sub seam for SSE (S6) and planning events. */
    eventBus(): EventBus<PlanningEventMap>;

    /**
     * Job queue for async work (history import, rule runs).
     * Returns a "not configured" guard when disabled in bootstrap config.
     */
    jobQueue(): ServerJobQueue;

    /**
     * Scheduler for periodic tasks (stale-lock cleanup, analytics).
     * Returns a "not configured" guard when disabled in bootstrap config.
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

    // ── Lazy caches ──
    let dbPromise: Promise<DbAdapter> | undefined;
    let taskSvc: TaskService | undefined;
    let featureSvc: FeatureService | undefined;
    let jobQueueCache: ServerJobQueue | undefined;

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
                    tasksDir: 'docs/tasks',
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
                    featuresDir: 'docs/features',
                    tasksDir: 'docs/tasks',
                    projectName: 'spur',
                });
            }
            return featureSvc;
        },

        eventBus(): EventBus<PlanningEventMap> {
            return eventsBus;
        },

        jobQueue(): ServerJobQueue {
            if (!jobQueueEnabled) {
                throw new NotConfiguredError('jobQueue');
            }
            // Real DBJobQueue wiring deferred until a job producer exists.
            // For now, the guard above always fires (jobQueueEnabled defaults false).
            if (!jobQueueCache) {
                throw new NotConfiguredError('jobQueue');
            }
            return jobQueueCache;
        },

        scheduler(): ServerScheduler {
            if (options.scheduler) {
                return options.scheduler;
            }
            throw new NotConfiguredError('scheduler');
        },
    };
}
