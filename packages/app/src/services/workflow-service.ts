import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadSpurConfig, resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    type ActionCost,
    ActionRunDao,
    actionCost,
    actionCostEstimated,
    createId,
    loadAllEtlPayloads,
    matchEtlPayloads,
    PhaseRunDao,
    RunDao,
    TaskRunLinkDao,
    TransitionRunDao,
} from '@gobing-ai/spur-domain';
import { resolveAgentName } from '@gobing-ai/ts-ai-runner';

import {
    type ActionDef,
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    type WorkflowRunResult as EngineWorkflowRunResult,
    WorkflowService as EngineWorkflowService,
    type GuardDef,
    type HitlResponder,
    loadWorkflowDef,
    type StateMachineWorkflowDef,
    type TransitionFlowWorkflowDef,
    type WorkflowDef,
    type WorkflowPersistenceAdapter,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus } from '@gobing-ai/ts-infra';
import {
    createNodeFileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
    parseYamlObject,
} from '@gobing-ai/ts-runtime';
import type { WorkflowRunLogConfig } from '../observability/workflow-run-log-sink';
import type { HostAllowlist, HttpRequester } from '../workflow/actions/http-request';
import { registerSpurBuiltins } from '../workflow/builtins';
import { ObservableWorkflowAdapter, type WorkflowObservabilityBus } from '../workflow/observability';
import type { WorkflowSteeringController } from '../workflow/steering';
import type { AgentService } from './agent-service';
import { bridgeEventBus } from './event-bridge';
import type { RuleService } from './rule-service';

/** Workflow name that triggers a pipeline run-link (matches the shipped `workflows/task-pipeline.yaml`). */
const TASK_PIPELINE_WORKFLOW = 'task-pipeline';

/**
 * Sentinel manifest prefix for embedded-schema resolution (mirrors the config loader's
 * mechanism). ts-runtime resolves a bare package `$schema` ref by resolving
 * `<pkg>/package.json` then joining the schema subpath; returning this sentinel as the
 * manifest path makes the joined path start with the prefix, which the embedded reader
 * recognizes. The NUL byte guarantees it never collides with a real filesystem path.
 */
const EMBEDDED_SCHEMA_PREFIX = '\0embedded-spur';

/** The package whose `$schema` package-specifier refs resolve to the embedded map. */
const SPUR_SCHEMA_MANIFEST = '@gobing-ai/spur/package.json';

/** Link kind for pipeline runs in `task_run_links` (additive to `kind='lifecycle'`). */
const PIPELINE_LINK_KIND = 'pipeline';

/**
 * Send SIGTERM to an async run's worker and the agent subprocess it spawned.
 *
 * The async launcher starts the worker as a **process-group leader** (a detached
 * child), so the recorded pid is also the group id. Signalling the negated pid
 * (`-pid`) delivers SIGTERM to the whole group — the worker AND the `agent.run`
 * grandchild (`claude`/`codex`) it spawned — which is the process an operator
 * actually wants to stop. We fall back to a plain `kill(pid)` if the group kill
 * fails (e.g. the pid is not a group leader, as for a sync run, or on a platform
 * without POSIX process groups), so a recorded pid is always signalled some way.
 *
 * Returns `true` if a signal was delivered by either path, `false` if the process
 * was already gone (ESRCH) or the signal could not be delivered. Best-effort
 * cleanup — callers treat the run record, not the process exit, as the source of
 * truth.
 */
function signalSubprocess(pid: number): boolean {
    // Refuse self-kill and POSIX specials:
    // - pid <= 1: 0/-0 = own process group; 1/-1 = init / all processes
    // - process.pid / ppid: would tear down the CLI or test runner (CI SIGTERM 143)
    if (!Number.isInteger(pid) || pid <= 1) return false;
    if (pid === process.pid || pid === process.ppid) return false;

    // Group kill first: reaches the worker + its agent grandchild in one signal.
    try {
        process.kill(-pid, 'SIGTERM');
        return true;
    } catch {
        // No group (sync run / non-leader pid) or no POSIX groups — fall back to
        // signalling the single process directly.
    }
    try {
        process.kill(pid, 'SIGTERM');
        return true;
    } catch {
        // ESRCH (no such process) is the expected "already dead" case; any other
        // failure (EPERM, etc.) is also non-fatal — the run is finalized regardless.
        return false;
    }
}

/**
 * Wrap a persistence adapter so the current process stamps its own pid onto a run
 * row the instant the engine creates it (`createRun` / `createOrAttachRun`). Used
 * by the async **worker** so `spur workflow cancel` can signal the live process:
 * the worker self-records `process.pid` (the correct pid — the process actually
 * executing the run), eliminating the launcher-side race where the pid was written
 * before the run row existed. Every other persistence hook delegates unchanged.
 *
 * Implemented as a Proxy so the wide `WorkflowPersistenceAdapter` interface needs
 * no per-method boilerplate — only the two create hooks are intercepted; all reads
 * and other writes pass straight through to `inner`.
 */
function withSelfPidRecording(inner: WorkflowPersistenceAdapter, db: DbAdapter): WorkflowPersistenceAdapter {
    // Best-effort: a DB predating the `pid` column must not abort the run.
    const stamp = async (runId: string): Promise<void> => {
        try {
            await new RunDao(db).setPid(runId, process.pid);
        } catch {
            // pid persistence is best-effort; the run proceeds regardless.
        }
    };
    return new Proxy(inner, {
        get(target, prop, receiver) {
            if (prop === 'createRun') {
                return async (record: Parameters<WorkflowPersistenceAdapter['createRun']>[0]): Promise<void> => {
                    await target.createRun(record);
                    await stamp(record.id);
                };
            }
            if (prop === 'createOrAttachRun') {
                return async (record: Parameters<WorkflowPersistenceAdapter['createOrAttachRun']>[0]) => {
                    const result = await target.createOrAttachRun(record);
                    await stamp(result.id);
                    return result;
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a workflow validate operation. */
export type WorkflowValidateResult =
    | { ok: true; valid: true; workflow: WorkflowDef }
    | { ok: false; valid: false; file: string; errors: string[] };

/**
 * Result of a workflow run operation: the engine's run result, widened with an
 * index signature so it serializes cleanly via `toJson`.
 */
export type WorkflowRunResult = EngineWorkflowRunResult & {
    readonly [key: string]: unknown;
};

/** Options for a workflow run. */
export interface WorkflowRunOptions {
    runId?: string;
    vars?: Record<string, string>;
    /** Validate and walk the transition graph without executing actions. */
    dryRun?: boolean;
    /**
     * When true, the running process stamps its own pid onto the run row the
     * instant the engine creates it, so `spur workflow cancel` can signal it.
     * Set by the async worker (the detached `spur workflow run --run-id` child);
     * the worker is its process group's leader, so the recorded pid doubles as
     * the group id for a group-wide SIGTERM.
     */
    recordSelfPid?: boolean;
    /** Synchronous in-process steering only; intentionally never serialized for detached runs. */
    steeringController?: WorkflowSteeringController;
}

/** A paused run discovered for `spur workflow continue` (E3). */
export interface PausedRun {
    runId: string;
    workflowName: string;
    startedAt: string;
}

/** A stale run finalized by `spur workflow clean`. */
export interface CleanedRun {
    runId: string;
    startedAt: string;
}

/** Result of `spur workflow clean` — orphaned non-terminal runs finalized as `failed`. */
export interface WorkflowCleanResult {
    /** Minutes-stale threshold applied. */
    olderThanMinutes: number;
    /** Whether this was a dry run (no writes). */
    dryRun: boolean;
    /** The runs that were (or would be) finalized. */
    cleaned: CleanedRun[];
}

/** A retained run log reclaimed by `spur workflow clean` (feature D2 / task 0429). */
export interface ReclaimedRunLog {
    /** Run id derived from the log file name (`<runId>.log`). */
    runId: string;
    /** Path of the removed (or would-be-removed) log file. */
    path: string;
    /** File mtime at scan time (ISO 8601). */
    mtime: string;
}

/** Result of retained run-log reclamation (`.spur/run/<RUNID>.log`, task 0429). */
export interface RunLogReclamationResult {
    /** Retention threshold applied, in days. */
    retentionDays: number;
    /** Whether this was a dry run (no writes). */
    dryRun: boolean;
    /** The logs that were (or would be) removed. */
    reclaimed: ReclaimedRunLog[];
    /** Removal failures — best-effort: one file failing never aborts the rest. */
    failures: Array<{ path: string; error: string }>;
}

/** Result of `spur workflow cancel <run-id>` — one non-terminal run finalized as `failed`. */
export interface WorkflowCancelResult {
    /** The run id requested. */
    runId: string;
    /** Whether the run was actually transitioned to `failed` (false if it was already terminal or missing). */
    finalized: boolean;
    /** The run's status after the call (`failed`, the prior terminal status, or `not_found`). */
    status: string;
    /** Whether a recorded worker pid was signalled (SIGTERM). `false` when no pid was recorded, the pid was already dead (ESRCH), or the run was missing/terminal. */
    killed: boolean;
}

/** A single entry in a workflow file listing. */
export interface WorkflowListEntry {
    name: string;
    kind: string;
    path: string;
    source: 'project' | 'global';
    valid: boolean;
    error?: string;
}

/** Result of a workflow list operation — available workflow files. */
export interface WorkflowListResult {
    layers: Array<{ id: string; path: string }>;
    entries: WorkflowListEntry[];
    totalFiles: number;
}

/** Filter options for workflow run trace. */
export interface WorkflowTraceFilter {
    /** Filter by workflow name. */
    workflow?: string;
    /** Filter by run status: done, failed, running. */
    status?: string;
    /** Lower bound on started_at (ISO 8601). */
    since?: string;
    /** Limit results (default 20, most recent first). */
    last?: number;
}

/** A single run entry in a trace listing. */
export interface WorkflowTraceEntry {
    runId: string;
    workflowName: string;
    mode: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    isDryRun: boolean;
    /** Terminal failure reason (e.g. `no-passing-transition`) when the engine recorded one. */
    failureReason?: string;
}

/** Result of a trace listing (no run-id). */
export interface WorkflowTraceListResult {
    entries: WorkflowTraceEntry[];
    total: number;
}

/** A timeline event: phase entry, transition, or action execution. */
export type TimelineEvent =
    | { kind: 'phase'; phase: string; status: string; startedAt: string | null; completedAt: string | null }
    | { kind: 'transition'; from: string; to: string; trigger: string | null }
    | {
          kind: 'action';
          actionId: string;
          node: string;
          actionKind: string;
          status: string;
          duration: string;
          ok: boolean;
          label: string;
          /** Per-step cost + cache-hit computed from matched ETL records (R4). Undefined when cost hasn't been computed yet or isn't available. */
          cost?: ActionCost;
      };

/** Result of a per-run trace with timeline. */
export interface WorkflowTraceTimeline {
    run: WorkflowTraceEntry;
    events: TimelineEvent[];
    /**
     * Relative path to the per-run consolidated all-in-one log
     * (`.spur/run/<runId>.log`, feature D2 / task 0426) when the file exists.
     */
    outputArtifact?: string;
}

/** Runtime dependencies injected into WorkflowAppService. */
export interface WorkflowAppServiceContext {
    cwd: string;
    /** Secret values redacted before workflow action results are persisted. */
    secretValues?: readonly string[];
    /** Optional operational warning sink (CLI stderr / server logger). */
    warn?(message: string): void;
    getDb(): Promise<DbAdapter>;
    agentService(): AgentService;
    ruleService(): RuleService;
    hitlResponder(): HitlResponder;
    httpRequester?(): HttpRequester;
    hostAllowlist?(): HostAllowlist;
    /** Optional ProcessExecutor override. When provided, shell actions and guards use this executor instead of default NodeProcessExecutor. */
    processExecutor?(): ProcessExecutor;
    /**
     * Optional observability bus. When provided, per-step lifecycle hooks are
     * mirrored onto it (run/phase/transition/action events) for live consumers
     * such as the board. Persistence is unaffected whether or not it is present.
     */
    observabilityBus?(): WorkflowObservabilityBus;
    /**
     * Optional canonical server EventBus. When provided, the engine's
     * per-step lifecycle events (`workflow.run.started`, `workflow.action.start`,
     * etc.) are forwarded to the system_events tap (R3) and SSE stream. Engine
     * names are canonical — the observability adapter's verb-form names occupy
     * the same lifecycle moment and do not produce duplicate rows.
     */
    events?(): EventBus<Record<string, (event: unknown) => void>>;
    /**
     * Embedded Spur JSON schemas keyed by `schemas/<name>.schema.json` subpath. When
     * present, a bundled workflow's `$schema: "@gobing-ai/spur/schemas/..."` ref is
     * served from this map instead of resolved through `node_modules`. Required for
     * `bun --compile` binaries (no `node_modules` at runtime) and for `validate` calls
     * that run from a cwd outside the package tree (CI temp dirs), where
     * `Bun.resolveSync` cannot find the owning package and would otherwise fail.
     */
    embeddedSchemas?(): ReadonlyMap<string, string>;
}

// ---------------------------------------------------------------------------

/**
 * Application-layer orchestration for `spur workflow` commands.
 * Named WorkflowAppService to avoid collision with WorkflowService from
 * @gobing-ai/ts-dual-workflow-engine (the engine's high-level service class).
 */
export class WorkflowAppService {
    private readonly ctx: WorkflowAppServiceContext;

    constructor(ctx: WorkflowAppServiceContext) {
        this.ctx = ctx;
    }

    /**
     * Build the embedded-schema injection for {@link loadWorkflowDef}, or `undefined`
     * when no embedded schemas are configured (dev/runtime path: ts-runtime resolves the
     * `$schema` ref from `node_modules`).
     *
     * When present, a `$schema: "@gobing-ai/spur/schemas/<name>.schema.json"` ref is
     * served from the embedded map: the resolver maps the package manifest specifier to a
     * sentinel path, and the file system returns the embedded schema text for any read
     * under that sentinel. This makes validate independent of `node_modules` resolution —
     * essential in a `--compile` binary and when the cwd is outside the package tree.
     */
    private embeddedSchemaOptions():
        | { resolve: (s: string) => string; fileSystem: { readFile(p: string): Promise<string> } }
        | undefined {
        const embedded = this.ctx.embeddedSchemas?.();
        if (embedded === undefined) return undefined;
        const nodeFs = createNodeFileSystem();
        return {
            resolve: (specifier: string) =>
                specifier === SPUR_SCHEMA_MANIFEST ? `${EMBEDDED_SCHEMA_PREFIX}/package.json` : specifier,
            fileSystem: {
                readFile: async (path: string) => {
                    if (!path.startsWith(EMBEDDED_SCHEMA_PREFIX)) return nodeFs.readFile(path);
                    const subpath = path.slice(EMBEDDED_SCHEMA_PREFIX.length + 1);
                    const text = embedded.get(subpath);
                    if (text === undefined) throw new Error(`No embedded schema registered for "${subpath}".`);
                    return text;
                },
            },
        };
    }

    /** Validate a workflow YAML file. Returns a structured result instead of throwing. */
    async validate(file: string, opts: { validateSchema?: boolean } = {}): Promise<WorkflowValidateResult> {
        const absolute = resolve(this.ctx.cwd, file);

        if (!(await fileExists(absolute))) {
            return { ok: false, valid: false, file, errors: [`File not found: ${absolute}`] };
        }

        try {
            const embedded = this.embeddedSchemaOptions();
            const workflow = await loadWorkflowDef(absolute, {
                validateSchema: opts.validateSchema !== false,
                ...(embedded !== undefined ? embedded : {}),
            });

            // Post-schema shell syntax validation (R3, task 0453): walk the def for
            // shell-kind actions and guards, run `sh -n` on each command.
            const shellErrors: string[] = [];
            const commands = collectShellCommands(workflow);
            const executor = new NodeProcessExecutor();
            for (const { stateId, kind, index, command } of commands) {
                if (!command || command.trim().length === 0) continue;
                try {
                    const result = await executor.run({
                        command: 'sh',
                        args: ['-n', '-c', command],
                        rejectOnError: false,
                    });
                    if (result.exitCode !== 0) {
                        const stderr = (result.stderr ?? '').trim();
                        const location = stateId ? `${stateId}/${kind}[${index}]` : `${kind}[${index}]`;
                        shellErrors.push(`Shell syntax error at ${location}: ${stderr || 'non-zero exit'}`);
                    }
                } catch {
                    shellErrors.push(`Shell syntax check failed at ${stateId}/${kind}[${index}]: process error`);
                }
            }

            if (shellErrors.length > 0) {
                return { ok: false, valid: false, file, errors: shellErrors };
            }

            return { ok: true, valid: true, workflow };
        } catch (error) {
            return {
                ok: false,
                valid: false,
                file,
                errors: [error instanceof Error ? error.message : String(error)],
            };
        }
    }

    /**
     * Load and run a workflow file. Returns the engine run result.
     *
     * The workflow def is pre-loaded here with the same {@link embeddedSchemaOptions}
     * used by {@link validate}, then handed to the engine's `run(WorkflowDef)`. This
     * ensures `run` and `validate` share a single `$schema` resolution contract:
     * when `embeddedSchemas` is configured, a `@gobing-ai/spur/schemas/...` ref is
     * served from the embedded map regardless of cwd or `node_modules` state.
     * Without this, `runFile(path)` falls through to bare node resolution and can
     * cite a stale published-package schema path that `validate` never sees (task 0431).
     */
    async run(file: string, opts: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
        const eventsBus = this.ctx.events?.();
        const svc = await this.createEngineService({
            recordSelfPid: opts.recordSelfPid === true,
            events: eventsBus,
            steeringController: opts.steeringController,
        });
        const runId = opts.runId ?? crypto.randomUUID();
        const isDry = opts.dryRun === true;
        // R8 (0366): inject __runId so discovery artifacts can stamp run provenance.
        // Survives pause/resume via the effective-vars snapshot (R1–R3). Inert for
        // workflows that don't reference ${vars.__runId}.
        //
        // `agent` is injected on the same seam: every pipeline YAML declares a literal
        // `agent: "omp"` vars default, which bypassed `.spur/config.yaml` `agent.default`
        // entirely - config only ever reached an `agent.run` step when a caller passed the
        // literal `auto`, which the pipelines never do. That made the config knob dead for
        // pipelines: an operator whose default executor was failing had no supported way to
        // redirect them. Caller-supplied vars still win, so an explicit `--agent`/`--vars`
        // choice overrides config, and config in turn overrides the YAML literal.
        // (0485 R2) `implementAgent` is injected on the same seam so `agent.default` also
        // governs the implement hop; a stale default warns instead of failing dispatch.
        const warnings: string[] = [];
        const runVars = {
            ...(await resolveDefaultAgentVar(this.ctx.cwd, opts.vars, (m) => warnings.push(m))),
            ...(opts.vars ?? {}),
            __runId: runId,
        };
        // Pre-load with embedded-schema options so `run` resolves `$schema` through
        // the same map as `validate` (task 0431 R1/R4). `svc.runFile` would call
        // `loadWorkflowDef(path)` with no options, falling back to node resolution.
        // Explicit `validateSchema: true` matches `validate()` so the two verbs cannot
        // diverge on whether schema validation is on (task 0431 R4/R5).
        const absolute = resolve(this.ctx.cwd, file);
        const embedded = this.embeddedSchemaOptions();
        const workflow = await loadWorkflowDef(absolute, {
            validateSchema: true,
            ...(embedded !== undefined ? embedded : {}),
        });
        const result = await svc.run(workflow, {
            workdir: this.ctx.cwd,
            runId,
            vars: runVars,
            ...(isDry ? { dryRun: true } : {}),
            ...(eventsBus !== undefined ? { events: bridgeEventBus(eventsBus) } : {}),
        });
        // Stamp dryRun into metadata_json so trace can label dry runs
        if (isDry) {
            const db = await this.ctx.getDb();
            await new RunDao(db).stampMetadata(runId, { dryRun: true });
        }
        // R7 (0366): persist terminal failure reason so `workflow trace` can surface
        // `no-passing-transition` (and siblings) rather than only the command result.
        await this.stampFailureReason(runId, result);
        // R1 (task 0071): record a kind='pipeline' task_run_links row when a
        // task-pipeline run carries vars.wbs - links execution results back to
        // the task. Idempotent: a re-run with the same runId does not duplicate.
        await this.maybeLinkPipelineRun(file, runId, opts);
        const runResult = result as WorkflowRunResult;
        if (warnings.length > 0) {
            // 0485 R2: retain warnings in the serializable result and emit them
            // through the composition-root sink for human/server observability.
            // A logging/output failure must not turn a completed workflow into a
            // dispatch failure, so the optional sink stays best-effort.
            for (const warning of warnings) {
                try {
                    this.ctx.warn?.(warning);
                } catch {
                    // Warning delivery cannot change workflow semantics.
                }
            }
            (runResult as Record<string, unknown>).warnings = warnings;
        }
        return runResult;
    }

    /**
     * If the workflow is `task-pipeline` and `vars.wbs` is present, insert a
     * `kind='pipeline'` row into `task_run_links`. Idempotent per runId.
     */
    private async maybeLinkPipelineRun(file: string, runId: string, opts: WorkflowRunOptions): Promise<void> {
        const wbs = opts.vars?.wbs;
        if (wbs === undefined || wbs === '') return;

        // Load the def to check the workflow name (cheap YAML parse). The def was
        // already loaded and schema-validated by `run()`; skip re-validation here so
        // `maybeLinkPipelineRun` never falls back to bare node resolution for the
        // `$schema` ref (task 0431 R6). A parse failure means it's not a runnable
        // workflow file - nothing to link.
        let workflowName: string | undefined;
        try {
            const def = await loadWorkflowDef(resolve(this.ctx.cwd, file), { validateSchema: false });
            workflowName = def.name;
        } catch {
            return;
        }
        if (workflowName !== TASK_PIPELINE_WORKFLOW) return;

        const db = await this.ctx.getDb();
        const dao = new TaskRunLinkDao(db);
        // Idempotency: skip if a pipeline link already exists for this runId.
        const existing = await dao.listByRun(runId, 10);
        if (existing.some((row) => row.kind === PIPELINE_LINK_KIND)) return;

        await dao.insert({
            id: createId('trl'),
            wbs,
            run_id: runId,
            kind: PIPELINE_LINK_KIND,
            created_at: new Date().toISOString(),
        });
    }

    /**
     * Discover the most-recent paused run (E3), or `null` if none are paused.
     * Used by `spur workflow continue` with no run-id to find the run to resume.
     */
    async latestPausedRun(): Promise<PausedRun | null> {
        const svc = await this.createEngineService();
        const paused = await svc.listPausedRuns({ limit: 1 });
        const first = paused[0];
        if (first === undefined) return null;
        return { runId: first.id, workflowName: first.workflow_name, startedAt: first.started_at };
    }

    /**
     * Finalize orphaned runs — those stuck in `running`/`pending` past the staleness
     * threshold because the executing process was killed (timeout, crash, Ctrl-C)
     * before the engine could finalize them. Without this, such runs linger forever
     * and pollute `spur workflow trace`. Marks each as `failed` with a stamped reason.
     *
     * @param olderThanMinutes A run is stale if it started more than this many minutes
     *   ago and is still non-terminal. Default 30.
     * @param dryRun When true, report what would be cleaned without writing.
     */
    async clean(olderThanMinutes = 30, dryRun = false): Promise<WorkflowCleanResult> {
        const db = await this.ctx.getDb();
        const dao = new RunDao(db);
        const cutoffIso = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
        const stale = await dao.listStaleRuns(cutoffIso);
        if (!dryRun) {
            for (const run of stale) {
                await dao.finalizeStale(run.id, `stale: non-terminal > ${olderThanMinutes}m (spur workflow clean)`);
            }
        }
        return {
            olderThanMinutes,
            dryRun,
            cleaned: stale.map((r) => ({ runId: r.id, startedAt: r.started_at })),
        };
    }

    /**
     * Reclaim retained run logs (`.spur/run/<RUNID>.log`, feature D2 / task 0429):
     * remove every log whose mtime is older than the retention threshold. Age is
     * the only gate — a still-running run whose log is old enough is reclaimed
     * too (rare, and acceptable under the policy). A missing run dir is a no-op.
     *
     * @param retentionDays Logs older than this many days are reclaimed. Default 30.
     * @param dryRun When true, report what would be removed without unlinking.
     */
    async cleanRunLogs(retentionDays = 30, dryRun = false): Promise<RunLogReclamationResult> {
        const runDir = join(this.ctx.cwd, '.spur', 'run');
        const fs = createNodeFileSystem();
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const reclaimed: ReclaimedRunLog[] = [];
        const failures: RunLogReclamationResult['failures'] = [];

        let entries: string[];
        try {
            entries = (await fs.readDir(runDir)).filter((name) => name.endsWith('.log'));
        } catch {
            // No run dir yet — nothing to reclaim.
            return { retentionDays, dryRun, reclaimed, failures };
        }

        for (const name of entries) {
            const path = join(runDir, name);
            const stat = await fs.stat(path);
            if (stat === null || !stat.isFile() || stat.mtimeMs >= cutoffMs) continue;
            const entry = { runId: name.slice(0, -'.log'.length), path, mtime: new Date(stat.mtimeMs).toISOString() };
            if (dryRun) {
                reclaimed.push(entry);
                continue;
            }
            try {
                await fs.deleteFile(path);
                reclaimed.push(entry);
            } catch (err) {
                failures.push({ path, error: String(err) });
            }
        }
        return { retentionDays, dryRun, reclaimed, failures };
    }

    /**
     * Cancel a single non-terminal run by id — SIGTERM its worker process group (if
     * a pid was recorded) and mark the run `failed` with a `cancelled by operator`
     * reason. The discoverable single-run counterpart to `clean` (which finalizes
     * stale runs in bulk). Idempotent against already-terminal runs (no-op) and
     * reports `not_found` for an unknown id.
     *
     * The pid is the async worker's, self-recorded at run creation (see
     * {@link WorkflowRunOptions.recordSelfPid}); the worker is its group leader, so
     * the SIGTERM goes to the whole group — the worker AND the `agent.run`
     * grandchild it spawned — via {@link signalSubprocess}.
     *
     * Subprocess kill is best-effort: a recorded pid may already be dead (ESRCH is
     * tolerated and reported as not-killed-but-finalized) or, rarely, recycled to a
     * different process — we do not verify the target's identity (no portable way
     * without `/proc`/`ps` fragility). The run-record finalization is the source of
     * truth for "the run is cancelled"; the SIGTERM is process cleanup.
     */
    async cancel(runId: string): Promise<WorkflowCancelResult> {
        const db = await this.ctx.getDb();
        const dao = new RunDao(db);
        const before = await dao.traceRowById(runId);
        if (!before) {
            return { runId, finalized: false, status: 'not_found', killed: false };
        }
        // Only a non-terminal run has a live subprocess worth killing. Read the pid
        // before finalizing (finalizeStale's guard leaves terminal runs untouched).
        const isNonTerminal = before.status === 'running' || before.status === 'pending';
        const pid = isNonTerminal ? await dao.getPid(runId) : null;
        const killed = pid != null ? signalSubprocess(pid) : false;
        await dao.finalizeStale(runId, 'cancelled by operator (spur workflow cancel)');
        const after = await dao.traceRowById(runId);
        // finalizeStale's WHERE guard only transitions non-terminal runs; if the run
        // was already terminal, status is unchanged and finalized is false.
        const finalized = after?.status === 'failed' && before.status !== 'failed';
        return { runId, finalized, status: after?.status ?? 'not_found', killed };
    }

    /**
     * Resume a paused run (HITL continue, design §6 / D04). Works for both
     * lifecycle and pipeline runs. The run's `workflow_name` is resolved back to
     * its YAML definition (scanning the workflow search paths) so the engine can
     * resume from where it paused. Throws a clear error if the run is missing or
     * not paused.
     *
     * When `hitlAnswer` is supplied (R1 of 0433), the answer is injected into the
     * resume vars as `__hitlAnswer` (or the named `hitlVar`) **before** guards
     * re-evaluate. This overrides any stale headless default persisted by
     * `DefaultHitlResponder`. `--yes` on the CLI does NOT set this - it only
     * skips the CLI's own resume confirmation (R3).
     *
     * @param runId The run to resume.
     * @param opts Optional HITL answer to inject before guard re-evaluation.
     */
    async continuePaused(
        runId: string,
        opts?: { hitlAnswer?: 'yes' | 'no' | 'cancel'; hitlVar?: string },
    ): Promise<WorkflowRunResult> {
        // Same dual-bus wiring as run() (task 0370): adapter verb-form events via
        // observabilityBus inside createEngineService, engine-native names via the
        // resume options `events` field. CLI attaches a SystemEventDao tap to both.
        const eventsBus = this.ctx.events?.();
        const svc = await this.createEngineService({ events: eventsBus });
        const run = await svc.listPausedRuns();
        const target = run.find((r) => r.id === runId);
        if (target === undefined) {
            throw new Error(`Run "${runId}" is not paused (or does not exist) - nothing to continue.`);
        }
        const workflow = await this.resolveWorkflowDefByName(target.workflow_name);
        if (workflow === null) {
            throw new Error(
                `Cannot resume run "${runId}": workflow definition "${target.workflow_name}" not found in the workflow search paths.`,
            );
        }
        // R1 of 0433: inject the operator's HITL answer into resume vars so guard
        // re-evaluation sees the override, not the stale headless default. The
        // engine's resumeRun merges options.vars over the persisted snapshot
        // (caller overrides win - ts-dual-workflow-engine service.ts:127).
        const hitlVar = opts?.hitlVar ?? '__hitlAnswer';
        const resumeVars = opts?.hitlAnswer !== undefined ? { [hitlVar]: opts.hitlAnswer } : undefined;
        const result = await svc.resumeRun(workflow, runId, {
            workdir: this.ctx.cwd,
            ...(resumeVars !== undefined ? { vars: resumeVars } : {}),
            ...(eventsBus !== undefined ? { events: bridgeEventBus(eventsBus) } : {}),
        });
        await this.stampFailureReason(runId, result);
        return result as WorkflowRunResult;
    }

    /**
     * Persist a terminal failure reason into the run row's metadata_json so
     * `workflow trace` surfaces it (R7 of 0366). The engine returns the reason
     * in WorkflowRunResult but only persists status; this closes the gap. Uses
     * json_set so dryRun and staleReason coexist peacefully.
     */
    private async stampFailureReason(runId: string, result: EngineWorkflowRunResult): Promise<void> {
        if (result.status !== 'failed' || typeof result.reason !== 'string' || result.reason === '') {
            return;
        }
        const db = await this.ctx.getDb();
        await new RunDao(db).stampFailureReason(runId, result.reason);
    }

    /** Resolve a workflow definition by its `name` field, scanning the search paths. */
    private async resolveWorkflowDefByName(name: string): Promise<WorkflowDef | null> {
        const listing = await this.list();
        const entry = listing.entries.find((e) => e.name === name && e.valid);
        if (entry === undefined) return null;
        // `entry.path` is display-relative to its layer root; re-resolve from the layer.
        for (const layer of listing.layers) {
            const abs = resolve(layer.path, entry.path);
            if (await fileExists(abs)) {
                try {
                    return await loadWorkflowDef(abs, { validateSchema: false });
                } catch {
                    // try the next layer
                }
            }
        }
        return null;
    }

    /**
     * List available workflow YAML files across project and global layers.
     * `workflowPaths` are the configured search paths (default: `['.spur/workflows/']`).
     */
    async list(workflowPaths: string[] = ['.spur/workflows/']): Promise<WorkflowListResult> {
        const projectRoot = this.ctx.cwd;
        const globalRoot = join(homedir(), '.config', 'spur');

        const layers: Array<{ id: string; path: string }> = [];
        const entries: WorkflowListEntry[] = [];
        const scannedPaths = new Set<string>();

        // Project layer
        for (const relPath of workflowPaths) {
            const absPath = resolve(projectRoot, relPath);
            layers.push({ id: 'project', path: absPath });
            scannedPaths.add(absPath);
            try {
                const found = await scanWorkflowFiles(absPath, 'project');
                entries.push(...found);
            } catch {
                // Directory doesn't exist — skip gracefully
            }
        }

        // Global layer — mirror the project paths under ~/.config/spur/, skip duplicates
        for (const relPath of workflowPaths) {
            const absPath = resolve(globalRoot, relPath);
            if (scannedPaths.has(absPath)) continue;
            layers.push({ id: 'global', path: absPath });
            try {
                const found = await scanWorkflowFiles(absPath, 'global');
                entries.push(...found);
            } catch {
                // Directory doesn't exist — skip gracefully
            }
        }

        return { layers, entries, totalFiles: entries.length };
    }

    /**
     * Query persisted workflow runs. When called with a run-id, returns a per-run timeline.
     * When called with filter options (or no args), returns a filtered run listing.
     */
    async trace(runId: string): Promise<WorkflowTraceTimeline>;
    async trace(filter?: WorkflowTraceFilter): Promise<WorkflowTraceListResult>;
    async trace(
        runIdOrFilter?: string | WorkflowTraceFilter,
    ): Promise<WorkflowTraceListResult | WorkflowTraceTimeline> {
        const db = await this.ctx.getDb();
        if (typeof runIdOrFilter === 'string') {
            return this.traceRun(db, runIdOrFilter);
        }
        return this.traceList(db, runIdOrFilter ?? {});
    }
    private async traceList(db: DbAdapter, filter: WorkflowTraceFilter): Promise<WorkflowTraceListResult> {
        const dao = new RunDao(db);
        const rows = await dao.traceRows({
            workflow: filter.workflow,
            status: filter.status,
            since: filter.since,
            limit: filter.last ?? 20,
        });
        return {
            entries: rows.map(rowToTraceEntry),
            total: rows.length,
        };
    }

    private async traceRun(db: DbAdapter, runId: string): Promise<WorkflowTraceTimeline> {
        const runDao = new RunDao(db);
        const row = await runDao.traceRowById(runId);
        if (!row) throw new Error(`Run not found: ${runId}`);
        const run = rowToTraceEntry(row);

        const phaseRows = await new PhaseRunDao(db).phaseRowsByRunId(runId);
        const transitionRows = await new TransitionRunDao(db).transitionRowsByRunId(runId);
        const actionRows = await new ActionRunDao(db).actionRowsByRunId(runId);

        // Pre-compute per-step cost for agent.run actions via the history-ETL join (R4).
        // Costs are computed eagerly before the merge loop so the timeline merge is a
        // pure lookup — no async I/O inside the ordered-merge. The ETL source tables are
        // loaded once and matched in memory per action, not re-scanned per action.
        const costByActionId = new Map<string, ActionCost>();
        if (actionRows.some((a) => a.kind === 'agent.run')) {
            const etlPayloads = await loadAllEtlPayloads(db);
            for (const a of actionRows) {
                if (a.kind !== 'agent.run') continue;
                try {
                    const { records, estimated } = matchEtlPayloads(etlPayloads, a);
                    const cost = estimated ? actionCostEstimated(records, '') : actionCost(records, '');
                    costByActionId.set(a.id, cost);
                } catch {
                    // Cost lookup is best-effort — don't break the trace.
                }
            }
        }

        const events: TimelineEvent[] = [];
        let pi = 0;
        let ti = 0;
        let ai = 0;
        type PR = (typeof phaseRows)[number];
        type TR = (typeof transitionRows)[number];
        type AR = (typeof actionRows)[number];
        while (pi < phaseRows.length || ti < transitionRows.length || ai < actionRows.length) {
            const pCreated = pi < phaseRows.length ? (phaseRows[pi] as PR).created_at : Number.POSITIVE_INFINITY;
            const tCreated =
                ti < transitionRows.length ? (transitionRows[ti] as TR).created_at : Number.POSITIVE_INFINITY;
            const aCreated = ai < actionRows.length ? (actionRows[ai] as AR).created_at : Number.POSITIVE_INFINITY;
            if (pCreated <= tCreated && pCreated <= aCreated) {
                const p = phaseRows[pi++] as PR;
                events.push({
                    kind: 'phase',
                    phase: p.phase,
                    status: p.status,
                    startedAt: p.started_at,
                    completedAt: p.completed_at,
                });
            } else if (tCreated <= aCreated) {
                const t = transitionRows[ti++] as TR;
                events.push({ kind: 'transition', from: t.from_state, to: t.to_state, trigger: t.trigger });
            } else {
                const a = actionRows[ai++] as AR;
                const duration = a.duration_ms !== null ? `${a.duration_ms}ms` : '';
                const label = a.status === 'running' ? ' (in-flight)' : a.ok === 1 ? ' ✓' : ' ✗';
                events.push({
                    kind: 'action',
                    actionId: a.id,
                    node: a.node,
                    actionKind: a.kind,
                    status: a.status,
                    duration: duration,
                    ok: a.ok === 1,
                    label: label,
                    cost: costByActionId.get(a.id),
                } as TimelineEvent);
            }
        }

        const outputArtifact = await outputArtifactForRun(this.ctx.cwd, runId);
        return {
            run,
            events,
            ...(outputArtifact !== undefined ? { outputArtifact } : {}),
        };
    }

    private async createEngineService(
        opts: {
            recordSelfPid?: boolean;
            events?: EventBus<Record<string, (event: unknown) => void>>;
            steeringController?: WorkflowSteeringController;
        } = {},
    ): Promise<EngineWorkflowService> {
        const processExec = this.ctx.processExecutor?.();
        const host = createDefaultWorkflowEngineHost(processExec !== undefined ? { processExecutor: processExec } : {});
        const bus = this.ctx.observabilityBus?.();
        // R1 (0451): load agent config slice at composition root so AgentRunActionRunner
        // receives real config values instead of reading a fake context.config cast.
        // R4 (0451): also inject requireDiff excludeGlobs from all registered task folders
        // + features dir so multi-folder corpus edits never pass the empty-implement gate.
        let agentSlice: {
            default?: string;
            sessionAffinity?: boolean;
            excludeGlobs?: string[];
            secretValues?: readonly string[];
        } = {
            ...(this.ctx.secretValues !== undefined ? { secretValues: this.ctx.secretValues } : {}),
        };
        try {
            const agent = (await loadSpurConfig(this.ctx.cwd)).agent;
            agentSlice = {
                ...agentSlice,
                ...(agent?.default !== undefined ? { default: agent.default } : {}),
                ...(agent?.sessionAffinity !== undefined ? { sessionAffinity: agent.sessionAffinity } : {}),
            };
        } catch {
            // degrade empty — never block engine create
        }
        try {
            const fs = createNodeFileSystem(this.ctx.cwd);
            const { foldersConfig, featuresDir } = await resolvePlanningFolders(fs);
            const folderGlobs = Object.keys(foldersConfig.folders).map((k) => `${k}/*`);
            agentSlice = {
                ...agentSlice,
                excludeGlobs: [...folderGlobs, `${featuresDir}/*`],
            };
        } catch {
            // keep agent-run defaults (docs/tasks3 + docs/features) when folder resolve fails
        }
        registerSpurBuiltins(host, {
            agentService: this.ctx.agentService(),
            ruleService: this.ctx.ruleService(),
            hitlResponder: this.ctx.hitlResponder(),
            httpRequester: this.ctx.httpRequester?.(),
            hostAllowlist: this.ctx.hostAllowlist?.(),
            ...(bus !== undefined ? { observabilityBus: bus } : {}),
            ...(processExec !== undefined ? { processExecutor: processExec } : {}),
            ...(opts.steeringController !== undefined ? { steeringController: opts.steeringController } : {}),
            agentConfig: agentSlice,
        });
        const db = await this.ctx.getDb();
        let persistence: WorkflowPersistenceAdapter = new DbWorkflowPersistenceAdapter(db);
        // Async worker: stamp this process's pid onto the run row at creation so
        // `spur workflow cancel` can SIGTERM the live process group.
        if (opts.recordSelfPid === true) {
            persistence = withSelfPidRecording(persistence, db);
        }
        const adapter = bus ? new ObservableWorkflowAdapter(persistence, bus) : persistence;
        return new EngineWorkflowService(host, adapter);
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers (not exported)
// ---------------------------------------------------------------------------

interface ShellCommandEntry {
    /** State or node id where the command was found. */
    stateId: string;
    /** Whether it's an action or guard. */
    kind: 'action' | 'guard';
    /** Index within the action array or guard location. */
    index: number;
    /** The shell command string. */
    command: string;
}

/**
 * Walk a workflow def and collect all shell-kind commands for syntax validation.
 * Supports both state-machine and transition-flow workflow kinds.
 */
function collectShellCommands(def: WorkflowDef): ShellCommandEntry[] {
    const entries: ShellCommandEntry[] = [];

    const visitAction = (stateId: string, action: ActionDef, idx: number): void => {
        if (action.kind === 'shell') {
            const cmd = action.options?.command;
            if (typeof cmd === 'string' && cmd.length > 0) {
                entries.push({ stateId, kind: 'action', index: idx, command: cmd });
            }
        }
    };

    const visitGuard = (stateId: string, guard: GuardDef): void => {
        if (guard.kind === 'shell') {
            const cmd = guard.options?.command;
            if (typeof cmd === 'string' && cmd.length > 0) {
                entries.push({ stateId, kind: 'guard', index: 0, command: cmd });
            }
        }
    };

    if (def.kind === 'transition-flow' || def.kind === undefined) {
        // Transition-flow: walk nodes for actions, edges for guards.
        const flowDef = def as TransitionFlowWorkflowDef;
        for (const node of flowDef.nodes ?? []) {
            if (node.action) visitAction(node.id, node.action, 0);
        }
        for (const edge of flowDef.edges ?? []) {
            if (edge.condition) visitGuard(edge.from, edge.condition);
        }
    } else {
        // State-machine: walk states for onEnter/onExit, transitions for guards.
        const smDef = def as StateMachineWorkflowDef;
        for (const state of smDef.states ?? []) {
            if (state.onEnter) {
                state.onEnter.forEach((action, i) => {
                    visitAction(state.id, action, i);
                });
            }
            if (state.onExit) {
                state.onExit.forEach((action, i) => {
                    visitAction(state.id, action, i);
                });
            }
        }
        for (const trans of smDef.transitions ?? []) {
            if (trans.guard) visitGuard(`${trans.from}→${trans.to}`, trans.guard);
        }
    }

    return entries;
}

async function fileExists(path: string): Promise<boolean> {
    const fs = createNodeFileSystem();
    return await fs.exists(path);
}

/**
 * Resolve the `agent` / `implementAgent` run vars from `.spur/config.yaml`
 * `agent.default`, so the configured default executor reaches a workflow's
 * `agent.run` steps — including the implement hop, which previously read only the
 * pipeline's literal `implementAgent: "omp"` (task 0485 R2).
 *
 * Returns an empty object — leaving the YAML default in force — when the caller
 * already chose both agents, when no `agent.default` is configured, or when config
 * cannot be read. Each key is injected independently: a caller-set `agent` does not
 * suppress `implementAgent`. When the configured default names neither a configured
 * executor nor a canonical agent binary, one warning is emitted and nothing is
 * injected, so a stale `agent.default` (e.g. a commented-out executor) never fails
 * dispatch (AC3) — the pipeline YAML literal governs instead.
 *
 * Precedence, per var (task 0487 R4): caller `vars.implementAgent` > caller
 * `vars.agent` > `agent.default` > YAML literal. `--vars '{"agent":"claude"}'`
 * previously reached review/verify/test-fix but NOT the implement hop, which kept
 * getting `agent.default` — an operator who explicitly picked an executor watched
 * the run dispatch a different one (run `e8cb00e7`). The caller's choice is the
 * strongest signal, so it also seeds `implementAgent`; it is not validated against
 * config here because an explicit `--vars` agent is the operator's own assertion
 * (a bad one fails loudly at dispatch), unlike a stale config default.
 */
async function resolveDefaultAgentVar(
    cwd: string,
    callerVars: Record<string, string> | undefined,
    warn: (message: string) => void,
): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    if (callerVars?.implementAgent === undefined && callerVars?.agent !== undefined) {
        result.implementAgent = callerVars.agent;
    }
    let config: Awaited<ReturnType<typeof loadSpurConfig>>;
    try {
        config = await loadSpurConfig(cwd);
    } catch {
        return result;
    }
    const configured = config.agent?.default;
    if (typeof configured !== 'string' || configured.length === 0) {
        return result;
    }
    // Validate before injecting (AC3): accept iff the default names a configured
    // executor or a canonical agent binary. On mismatch, warn once and inject
    // nothing so the pipeline YAML literal governs instead of a dispatch-time
    // "Unknown agent" failure.
    const valid =
        config.agent?.executors?.some((e) => e.name === configured) === true ||
        resolveAgentName(configured) !== undefined;
    if (!valid) {
        warn(
            `agent.default "${configured}" does not name a configured executor or agent binary; leaving the pipeline's literal agent in force`,
        );
        return result;
    }
    if (callerVars?.agent === undefined) result.agent = configured;
    // Only when the caller pinned neither var does `agent.default` reach implement.
    if (result.implementAgent === undefined && callerVars?.implementAgent === undefined) {
        result.implementAgent = configured;
    }
    return result;
}

/**
 * Resolve per-run consolidated-log bounds from `.spur/config.yaml` `agent.output`
 * (feature D2 / task 0426). Best-effort: any config failure degrades to defaults
 * rather than failing the workflow run (R8).
 */
/**
 * Resolve the run-log retention threshold (days) from `.spur/config.yaml`
 * `workflow.logRetentionDays` (feature D2 / task 0429). Best-effort: any config
 * failure degrades to the 30-day default rather than failing the housekeeping
 * verb (same degrade-to-defaults pattern as `resolveOutputLogConfig`).
 */
export async function resolveWorkflowLogRetentionDays(cwd: string): Promise<number> {
    try {
        return (await loadSpurConfig(cwd)).workflow?.logRetentionDays ?? 30;
    } catch {
        return 30;
    }
}

/**
 * Resolve run-log size limits (`maxBytes`, `maxLines`) from `agent.output`
 * in the project config. Returns an empty object when the section is absent
 * or config loading fails - observability config must never break a run.
 */
export async function resolveOutputLogConfig(cwd: string): Promise<WorkflowRunLogConfig> {
    try {
        const output = (await loadSpurConfig(cwd)).agent?.output;
        if (output === undefined) return {};
        return {
            ...(output['max-bytes'] !== undefined ? { maxBytes: output['max-bytes'] } : {}),
            ...(output['max-lines'] !== undefined ? { maxLines: output['max-lines'] } : {}),
        };
    } catch {
        // Observability configuration must never fail a workflow run.
        return {};
    }
}

/**
 * Relative path to a run's consolidated all-in-one log
 * (`.spur/run/<runId>.log`, feature D2 / task 0426), when the file exists.
 */
async function outputArtifactForRun(cwd: string, runId: string): Promise<string | undefined> {
    const relative = join('.spur', 'run', `${runId}.log`);
    return (await fileExists(join(cwd, relative))) ? relative : undefined;
}

/**
 * Walk a directory (following symlinks) for .yaml/.yml files and extract name + kind.
 * Gracefully skips unparseable files (adds them with valid=false + error message).
 */
async function scanWorkflowFiles(rootPath: string, source: 'project' | 'global'): Promise<WorkflowListEntry[]> {
    const entries: WorkflowListEntry[] = [];
    const fs = createNodeFileSystem();

    const rootStat = await fs.stat(rootPath);
    if (!rootStat?.isDirectory()) {
        return entries;
    }

    const realPath = fs.realPath ? await fs.realPath(rootPath) : rootPath;

    async function walk(dirPath: string): Promise<void> {
        const names = await fs.readDir(dirPath);
        for (const name of names) {
            const fullPath = resolve(dirPath, name);
            const st = await fs.stat(fullPath);
            if (!st) continue;
            if (st.isDirectory()) {
                await walk(fullPath);
            } else if (st.isFile() && (name.endsWith('.yaml') || name.endsWith('.yml'))) {
                const displayPath = fullPath.startsWith(rootPath) ? fullPath.slice(rootPath.length + 1) : fullPath;
                const meta = await extractWorkflowMeta(fullPath);
                entries.push({ ...meta, path: displayPath, source });
            }
        }
    }

    await walk(realPath);
    return entries;
}

/** Parse a workflow YAML file to extract name and kind. Returns partial entry on failure. */
async function extractWorkflowMeta(
    filePath: string,
): Promise<Pick<WorkflowListEntry, 'name' | 'kind' | 'valid' | 'error'>> {
    try {
        const fs = createNodeFileSystem();
        const text = await fs.readFile(filePath);
        const parsed = parseYamlObject(text);
        if (typeof parsed !== 'object' || parsed === null) {
            return { name: '<unparseable>', kind: 'unknown', valid: false, error: 'Top-level value is not an object' };
        }
        const obj = parsed as Record<string, unknown>;
        const wfName = obj.name;
        const wfKind = obj.kind;
        if (typeof wfName !== 'string' || wfName.length === 0) {
            return {
                name: '<unnamed>',
                kind: typeof wfKind === 'string' ? wfKind : 'state-machine',
                valid: false,
                error: 'Missing or empty "name" field',
            };
        }
        return { name: wfName, kind: typeof wfKind === 'string' ? wfKind : 'state-machine', valid: true };
    } catch (err) {
        return {
            name: '<unparseable>',
            kind: 'unknown',
            valid: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// ---------------------------------------------------------------------------
// Trace helpers (not exported)
// ---------------------------------------------------------------------------

function rowToTraceEntry(row: {
    id: string;
    workflow_name: string;
    mode: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    metadata_json: string;
}): WorkflowTraceEntry {
    let isDryRun = false;
    let failureReason: string | undefined;
    try {
        const meta = JSON.parse(row.metadata_json);
        isDryRun = meta.dryRun === true;
        if (typeof meta.failureReason === 'string' && meta.failureReason !== '') {
            failureReason = meta.failureReason;
        }
    } catch {
        // metadata_json unparseable — treat as not dry-run
    }
    return {
        runId: row.id,
        workflowName: row.workflow_name,
        mode: row.mode,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        isDryRun,
        ...(failureReason !== undefined ? { failureReason } : {}),
    };
}
