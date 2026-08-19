import { dirname, join } from 'node:path';
import type {
    AgentService,
    FeatureService,
    PlanningEvent as PlanningEventType,
    PlanningFolders,
    ProcessInventoryService,
    RuleService,
    RunStoreService,
    SectionMatrix,
    SupervisorService,
    TaskService,
    TeamService,
    TokenLedgerService,
    WorkflowAppService,
} from '@gobing-ai/spur-app';
import {
    AgentService as AgentServiceImpl,
    BusPlanningEventEmitter,
    bridgeEventBus,
    configuredSecretValues,
    createPsProcessInspector,
    type EventEmitter,
    FeatureService as FeatureServiceImpl,
    hitlConfirmDefault,
    systemEventProjectContext as makeSystemEventProjectContext,
    type PlanningEventMap,
    PlanningWriteService as PlanningWriteServiceImpl,
    ProcessInventoryService as ProcessInventoryServiceImpl,
    RuleService as RuleServiceImpl,
    RunStoreService as RunStoreServiceImpl,
    SupervisorService as SupervisorServiceImpl,
    type SystemEventProjectContext,
    TaskService as TaskServiceImpl,
    TeamService as TeamServiceImpl,
    TokenLedgerService as TokenLedgerServiceImpl,
    WorkflowAppService as WorkflowAppServiceImpl,
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
import type { HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus, JobQueue, SchedulerAdapter } from '@gobing-ai/ts-infra';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { FileSystem, ProcessRegistry } from '@gobing-ai/ts-runtime';
import { createInMemoryProcessRegistry, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { ServerBootConfig } from './bootstrap';

/**
 * Shared no-op output sink for headless server services (AgentService, RuleService).
 * Hoisted to module scope so the two arrow closures (`write`, `error`) are counted
 * once by V8 coverage instead of once per accessor call.
 */
export const NOOP_OUTPUT = { write: (_s: string) => {}, error: (_s: string) => {} } satisfies {
    write: (s: string) => void;
    error: (s: string) => void;
};

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
            this.delegate = new BusPlanningEventEmitter(bridgeEventBus<PlanningEventMap>(this.bus), dao);
        }
        await this.delegate.emit(event);
    }
}

// Schema-default planning folders, used when serve.ts passes no resolved folders
// (e.g. pure Workers bootstrap with no FS). Sourced from the config SSOT, not inlined.
const DEFAULT_PLANNING_FOLDERS: PlanningFolders = {
    tasksDir: DEFAULT_TASKS_DIR,
    featuresDir: DEFAULT_FEATURES_DIR,
    foldersConfig: { active_folder: DEFAULT_TASKS_DIR, folders: { [DEFAULT_TASKS_DIR]: { baseCounter: 0 } } },
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

    /**
     * Lazy, cached serve-rooted process inventory (task 0243).
     * OS tree walk + supervisor overlay for Observability → Processes.
     */
    processInventory(): ProcessInventoryService;

    /**
     * Shared ProcessExecutor registry for this serve process (ts-runtime 0.4.10 /
     * spur#0264). Injected into supervisor + AgentService executors so the Teams
     * Processes tab can list all harness-launched runs, not only supervisor rows.
     */
    processRegistry(): ProcessRegistry;

    /**
     * Lazy, cached token-ledger tail reader (task 0245).
     * Observability → Tool Using over `.spur/context/token-ledger.jsonl`.
     */
    tokenLedger(): TokenLedgerService;

    /**
     * Lazy, cached AgentService. The server-side bus is threaded in as
     * `events` so `agent.invoke.*` and `agent.*` lifecycle events reach the
     * system_events tap (R3) and SSE stream (task 0226 F2).
     */
    agentService(): AgentService;

    /**
     * Lazy, cached RuleService. Threads the server EventBus so rule engine
     * lifecycle events (`rule.run.start`, `rule.eval.*`, `rule.run.done`)
     * flow into the system_events ledger (task 0226 F2).
     */
    ruleService(): RuleService;

    /**
     * Lazy, cached WorkflowAppService. Threads the server EventBus through
     * `events()` so workflow engine lifecycle events (`workflow.run.started`,
     * `workflow.action.*`) reach the system_events tap and SSE stream
     * (task 0226 F2). Lazy + cached; agent/rule service accessors are
     * passed in as constructor-time closures so circular dependencies
     * resolve at first call.
     */
    workflowService(): WorkflowAppService;

    /**
     * Lazy HITL responder for workflow runs. Defaults to a no-op
     * auto-confirm responder for server-native jobs; tests/CF can override.
     */
    hitlResponder(): HitlResponder;

    /** Lazy SystemEventDao (system_events ledger) for the history endpoint + tap. */
    systemEventDao(): Promise<SystemEventDao>;

    /** Current-project identity injected into persisted, streamed, and legacy-projected envelopes. */
    systemEventProjectContext(): SystemEventProjectContext;

    /** Configured secret values applied before System Event projection bounds. */
    systemEventSecretValues(): readonly string[];

    /**
     * Lazy run-store read service (task 0373) — list / detail / WBS lookup over
     * `runs` + child tables. Application layer owns query composition + redaction;
     * the HTTP module stays thin (ADR-021).
     */
    runStoreService(): RunStoreService;

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

    /**
     * Resolved boot config (events enabled, diagnostic toggle, scheduling/queue
     * toggles, etc.). The system-events tap (R3) and SSE module consult this to
     * decide which catalog tier to consume.
     */
    bootConfig(): ServerBootConfig;
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
     * Pre-resolved Section-Status-Matrix (the SOLE section authority, F92 R1).
     * `serve.ts` loads it async (project-local → bundled canonical) and passes it
     * so the sync service accessors never block. Omitted → the TaskService has no
     * matrix and task creation fails loudly (a permissive fallback would defeat
     * the SSOT). Tests that call create must pass one.
     */
    sectionMatrix?: SectionMatrix;
    /**
     * Agent spec ids for autostart (task 0195/0207). The supervisor spawns these
     * at serve boot; a missing spec id fails loud. Omitted → no autostart.
     */
    teamAutostart?: string[];

    /**
     * Resolved server boot config. Falls back to a sensible default when omitted
     * (so tests/CF Workers that don't bootstrap through serve.ts keep working).
     */
    bootConfig?: ServerBootConfig;
}
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
    const eventProjectContext = makeSystemEventProjectContext(cwd);
    const eventSecretValues = configuredSecretValues(options.env ?? process.env);
    // Planning folders (phase folders) come pre-resolved from `.spur/config.yaml` via
    // serve.ts — never hardcoded here. Fall back to schema defaults when absent.
    const folders = options.folders ?? DEFAULT_PLANNING_FOLDERS;
    // Default boot config — matches `serverBootstrapConfig({})` with everything off
    // except `events.enabled`. Tests pass a real config via the bootConfig option.
    const bootConfig: ServerBootConfig = options.bootConfig ?? {
        logging: { enabled: false, level: 'info', console: false },
        telemetry: { enabled: false },
        events: { enabled: true, diagnostic: false },
        jobqueue: { enabled: jobQueueEnabled },
        scheduler: { enabled: Boolean(options.scheduler) },
        teamAutostart: options.teamAutostart ?? [],
    };
    // ── Lazy caches ──
    let dbPromise: Promise<DbAdapter> | undefined;
    let taskSvc: TaskService | undefined;
    let featureSvc: FeatureService | undefined;
    let teamSvc: TeamService | undefined;
    let supervisorSvc: SupervisorService | undefined;
    let processInventorySvc: ProcessInventoryService | undefined;
    let processRegistrySvc: ProcessRegistry | undefined;
    let tokenLedgerSvc: TokenLedgerService | undefined;
    let agentSvc: AgentService | undefined;
    let ruleSvc: RuleService | undefined;
    let workflowSvc: WorkflowAppService | undefined;
    let runStoreSvc: RunStoreService | undefined;
    let systemEventDaoPromise: Promise<SystemEventDao> | undefined;
    let jobQueuePromise: Promise<ServerJobQueue> | undefined;
    let queueConsumerPromise: Promise<ServerQueueConsumer<unknown>> | undefined;
    return {
        cwd,
        fs,
        webDistPath: options.webDistPath,

        async getDb(): Promise<DbAdapter> {
            if (!dbPromise) {
                const created = (async () => {
                    if (dbUrl !== IN_MEMORY_DATABASE_URL) {
                        await fs.ensureDir(dirname(dbUrl));
                    }
                    return createMigratedDbViaRuntime({ url: dbUrl });
                })();
                // Do not cache a rejection: a transient first-touch failure must not
                // brick every later request of a long-lived server (same pattern as
                // the config loader's cache).
                created.catch(() => {
                    if (dbPromise === created) dbPromise = undefined;
                });
                dbPromise = created;
            }
            return dbPromise;
        },

        async checkDbHealth(): Promise<boolean> {
            const db = await this.getDb();
            return dbHealthCheck(db);
        },

        taskService(): TaskService {
            if (!taskSvc) {
                const lazyEmitter = new LazyPlanningEventEmitter(this.getDb.bind(this), eventsBus);
                taskSvc = new TaskServiceImpl({
                    fs,
                    writeService: new PlanningWriteServiceImpl({ fs, projectName: 'spur', emitter: lazyEmitter }),
                    tasksDir: folders.tasksDir,
                    foldersConfig: folders.foldersConfig,
                    projectName: 'spur',
                    ...(options.sectionMatrix !== undefined ? { sectionMatrix: options.sectionMatrix } : {}),
                });
            }
            return taskSvc;
        },

        featureService(): FeatureService {
            if (!featureSvc) {
                const lazyEmitter = new LazyPlanningEventEmitter(this.getDb.bind(this), eventsBus);
                featureSvc = new FeatureServiceImpl({
                    fs,
                    writeService: new PlanningWriteServiceImpl({ fs, projectName: 'spur', emitter: lazyEmitter }),
                    featuresDir: folders.featuresDir,
                    tasksDir: folders.tasksDir,
                    foldersConfig: folders.foldersConfig,
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
                    getDb: this.getDb.bind(this),
                    // Wire the server bus so message lifecycle events flow to the
                    // system_events tap + SSE stream (task 0193/0204 / 0237).
                    eventBus: bridgeEventBus(eventsBus),
                    events: bridgeEventBus(eventsBus),
                });
            }
            return teamSvc;
        },

        processRegistry(): ProcessRegistry {
            processRegistrySvc ??= createInMemoryProcessRegistry();
            return processRegistrySvc;
        },

        supervisor(): SupervisorService {
            if (!supervisorSvc) {
                const pe = new NodeProcessExecutor({ registry: this.processRegistry() });
                supervisorSvc = new SupervisorServiceImpl({
                    processExecutor: pe,
                    eventBus: bridgeEventBus(eventsBus),
                    configDir: `${cwd}/.spur/agents`,
                });
            }
            return supervisorSvc;
        },

        processInventory(): ProcessInventoryService {
            if (!processInventorySvc) {
                processInventorySvc = new ProcessInventoryServiceImpl({
                    inspector: createPsProcessInspector(),
                    rootPid: process.pid,
                    listSupervised: () => this.supervisor().list(),
                });
            }
            return processInventorySvc;
        },

        tokenLedger(): TokenLedgerService {
            if (!tokenLedgerSvc) {
                tokenLedgerSvc = new TokenLedgerServiceImpl({ cwd });
            }
            return tokenLedgerSvc;
        },

        agentService(): AgentService {
            // No-op output sink: server jobs run headless. The CLI surfaces
            // human output, but the server jobs/API never should — a stray
            // stdout write would corrupt SSE/SSE-adjacent response framing.
            agentSvc ??= new AgentServiceImpl({
                cwd,
                env: options.env ?? {},
                output: NOOP_OUTPUT,
                events: bridgeEventBus(eventsBus),
                processRegistry: this.processRegistry(),
                getDb: this.getDb.bind(this),
            });
            return agentSvc;
        },

        ruleService(): RuleService {
            ruleSvc ??= new RuleServiceImpl({
                cwd,
                env: options.env ?? {},
                fs,
                output: NOOP_OUTPUT,
                getDb: this.getDb.bind(this),
                events: bridgeEventBus(eventsBus),
            });
            return ruleSvc;
        },

        workflowService(): WorkflowAppService {
            // Lazy + cached. The agent/rule service accessors are passed as
            // closures so the workflow service can build them on first run
            // without forcing their construction at context build time.
            workflowSvc ??= new WorkflowAppServiceImpl({
                cwd,
                secretValues: configuredSecretValues(options.env ?? process.env),
                warn: (message) => appRt.logger.warn(message),
                getDb: this.getDb.bind(this),
                agentService: this.agentService.bind(this),
                ruleService: this.ruleService.bind(this),
                hitlResponder: this.hitlResponder.bind(this),
                // Wire both buses onto the canonical server EventBus so the
                // system_events tap + SSE stream capture engine-native names
                // (via `events` → bridgeEngineEvents) AND the adapter's richer
                // verb-form events (via `observabilityBus` → ObservableWorkflowAdapter).
                // `workflow.run.started` fires from both paths — harmless v1
                // duplication; dedup deferred (task 0236 R3).
                observabilityBus: () => bridgeEventBus(eventsBus),
                events: () => bridgeEventBus(eventsBus),
            });
            return workflowSvc;
        },

        hitlResponder(): HitlResponder {
            // Default-deny: server HITL never auto-approves unless the operator
            // opts in with SPUR_HITL_AUTO_APPROVE=1 (headless/CI explicit consent).
            const confirm = hitlConfirmDefault(options.env ?? process.env);
            return {
                respond: async () => ({ value: confirm }),
            };
        },
        async systemEventDao(): Promise<SystemEventDao> {
            systemEventDaoPromise ??= this.getDb().then((db) => new SystemEventDao(db));
            return systemEventDaoPromise;
        },

        systemEventProjectContext(): SystemEventProjectContext {
            return eventProjectContext;
        },

        systemEventSecretValues(): readonly string[] {
            return eventSecretValues;
        },

        runStoreService(): RunStoreService {
            runStoreSvc ??= new RunStoreServiceImpl({
                getDb: this.getDb.bind(this),
                secretValues: eventSecretValues,
            });
            return runStoreSvc;
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
                return createQueueConsumer(db, { events: eventsBus as never, queueName: 'server-jobs' });
            })();
            return queueConsumerPromise;
        },

        scheduler(): ServerScheduler {
            if (options.scheduler) {
                return options.scheduler;
            }
            throw new NotConfiguredError('scheduler');
        },

        bootConfig(): ServerBootConfig {
            return bootConfig;
        },
    };
}
