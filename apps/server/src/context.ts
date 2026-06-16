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

    /**
     * Readiness probe: resolve the DB then run a trivial liveness query.
     * Returns false if the adapter is unreachable or throws (e.g. D1 not
     * configured). Lives here (Bun-path-only context) so `bootstrap.ts` — which
     * also loads on Cloudflare Workers — never imports the domain barrel (which
     * statically pulls `node:fs`, crashing the Worker isolate).
     */
    checkDbHealth(): Promise<boolean>;

    /** Lazy, cached TaskService (planning layer). */
    taskService(): TaskService;

    /** Lazy, cached FeatureService (planning layer). */
    featureService(): FeatureService;

    /** EventBus accessor — body wired in 0074; returns appRt.events for now. */
    eventBus(): EventBus<PlanningEventMap>;
}

/** Options for `createServerContext`. */
export interface CreateServerContextOptions {
    cwd: string;
    /** Required on Bun; optional on CF (where ctx is never built). */
    fs: FileSystem;
    webDistPath?: string;
    dbUrl?: string;
}

/**
 * Build a server-side context from an ApplicationRuntime (design §2.3).
 *
 * Services are lazy-initialized on first accessor call and cached per
 * process/isolate — same pattern as CliContext.
 *
 * The `fs` parameter is required — the caller (bootstrap.ts) obtains it
 * from ts-runtime via dynamic import to avoid platform-detection code
 * loading at module-init time in the Cloudflare Workers path.
 */
export function createServerContext(appRt: ApplicationRuntime, options: CreateServerContextOptions): ServerContext {
    const cwd = options.cwd;
    const fs = options.fs;
    const dbUrl = options.dbUrl ?? ':memory:';

    // ── Lazy caches ──
    let dbPromise: Promise<DbAdapter> | undefined;
    let taskSvc: TaskService | undefined;
    let featureSvc: FeatureService | undefined;

    return {
        cwd,
        fs,
        webDistPath: options.webDistPath,

        async getDb(): Promise<DbAdapter> {
            dbPromise ??= createMigratedDbViaRuntime({ url: dbUrl });
            return dbPromise;
        },

        async checkDbHealth(): Promise<boolean> {
            try {
                const db = await this.getDb();
                return await dbHealthCheck(db);
            } catch {
                return false;
            }
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
            return appRt.events as unknown as EventBus<PlanningEventMap>;
        },
    };
}
