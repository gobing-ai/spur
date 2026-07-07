import type { Stats } from 'node:fs';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { ActionRunDao, createId, PhaseRunDao, RunDao, TaskRunLinkDao, TransitionRunDao } from '@gobing-ai/spur-domain';

import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    type WorkflowRunResult as EngineWorkflowRunResult,
    WorkflowService as EngineWorkflowService,
    type HitlResponder,
    loadWorkflowDef,
    type WorkflowDef,
    type WorkflowEngineEvents,
    type WorkflowPersistenceAdapter,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem, parseYamlObject } from '@gobing-ai/ts-runtime';
import type { HostAllowlist, HttpRequester } from '../workflow/actions/http-request';
import { registerSpurBuiltins } from '../workflow/builtins';
import { ObservableWorkflowAdapter, type WorkflowObservabilityBus } from '../workflow/observability';
import type { AgentService } from './agent-service';
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
      };

/** Result of a per-run trace with timeline. */
export interface WorkflowTraceTimeline {
    run: WorkflowTraceEntry;
    events: TimelineEvent[];
}

/** Runtime dependencies injected into WorkflowAppService. */
export interface WorkflowAppServiceContext {
    cwd: string;
    getDb(): Promise<DbAdapter>;
    agentService(): AgentService;
    ruleService(): RuleService;
    hitlResponder(): HitlResponder;
    httpRequester?(): HttpRequester;
    hostAllowlist?(): HostAllowlist;
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

    /** Load and run a workflow file. Returns the engine run result. */
    async run(file: string, opts: WorkflowRunOptions = {}): Promise<WorkflowRunResult> {
        const eventsBus = this.ctx.events?.();
        const svc = await this.createEngineService({
            recordSelfPid: opts.recordSelfPid === true,
            events: eventsBus,
        });
        const runId = opts.runId ?? crypto.randomUUID();
        const isDry = opts.dryRun === true;
        const result = await svc.runFile(file, {
            workdir: this.ctx.cwd,
            runId,
            ...(opts.vars ? { vars: opts.vars } : {}),
            ...(isDry ? { dryRun: true } : {}),
            ...(eventsBus !== undefined ? { events: this.bridgeEngineEvents(eventsBus) } : {}),
        });
        // Stamp dryRun into metadata_json so trace can label dry runs
        if (isDry) {
            const db = await this.ctx.getDb();
            await new RunDao(db).stampMetadata(runId, { dryRun: true });
        }
        // R1 (task 0071): record a kind='pipeline' task_run_links row when a
        // task-pipeline run carries vars.wbs — links execution results back to
        // the task. Idempotent: a re-run with the same runId does not duplicate.
        await this.maybeLinkPipelineRun(file, runId, opts);
        return result as WorkflowRunResult;
    }

    /**
     * If the workflow is `task-pipeline` and `vars.wbs` is present, insert a
     * `kind='pipeline'` row into `task_run_links`. Idempotent per runId.
     */
    private async maybeLinkPipelineRun(file: string, runId: string, opts: WorkflowRunOptions): Promise<void> {
        const wbs = opts.vars?.wbs;
        if (wbs === undefined || wbs === '') return;

        // Load the def to check the workflow name (cheap YAML parse).
        let workflowName: string | undefined;
        try {
            const def = await loadWorkflowDef(resolve(this.ctx.cwd, file));
            workflowName = def.name;
        } catch {
            return; // Not a runnable workflow file — nothing to link.
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
     * @param runId The run to resume.
     */
    async continuePaused(runId: string): Promise<WorkflowRunResult> {
        const svc = await this.createEngineService();
        const run = await svc.listPausedRuns();
        const target = run.find((r) => r.id === runId);
        if (target === undefined) {
            throw new Error(`Run "${runId}" is not paused (or does not exist) — nothing to continue.`);
        }
        const workflow = await this.resolveWorkflowDefByName(target.workflow_name);
        if (workflow === null) {
            throw new Error(
                `Cannot resume run "${runId}": workflow definition "${target.workflow_name}" not found in the workflow search paths.`,
            );
        }
        const result = await svc.resumeRun(workflow, runId, { workdir: this.ctx.cwd });
        return result as WorkflowRunResult;
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
                } as TimelineEvent);
            }
        }

        return { run, events };
    }

    private async createEngineService(
        opts: { recordSelfPid?: boolean; events?: EventBus<Record<string, (event: unknown) => void>> } = {},
    ): Promise<EngineWorkflowService> {
        const host = createDefaultWorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: this.ctx.agentService(),
            ruleService: this.ctx.ruleService(),
            hitlResponder: this.ctx.hitlResponder(),
            httpRequester: this.ctx.httpRequester?.(),
            hostAllowlist: this.ctx.hostAllowlist?.(),
        });
        const db = await this.ctx.getDb();
        let persistence: WorkflowPersistenceAdapter = new DbWorkflowPersistenceAdapter(db);
        // Async worker: stamp this process's pid onto the run row at creation so
        // `spur workflow cancel` can SIGTERM the live process group.
        if (opts.recordSelfPid === true) {
            persistence = withSelfPidRecording(persistence, db);
        }
        const bus = this.ctx.observabilityBus?.();
        const adapter = bus ? new ObservableWorkflowAdapter(persistence, bus) : persistence;
        return new EngineWorkflowService(host, adapter);
    }

    /**
     * Wrap the canonical server EventBus into the typed
     * `EventBus<WorkflowEngineEvents>` shape the engine accepts. Engine names
     * are the canonical names in `SYSTEM_EVENT_CATALOG` — no alias needed.
     * R4 alias policy: the engine and the persistence-observability adapter
     * emit at slightly different lifecycles (`workflow.action.start` vs
     * `workflow.action.started`), so they occupy distinct board rows even
     * though they describe the same moment.
     */
    private bridgeEngineEvents(
        serverBus: EventBus<Record<string, (event: unknown) => void>>,
    ): EventBus<WorkflowEngineEvents> {
        const bridge = {
            on: (event: string, listener: (event: unknown) => void) => serverBus.on(event, listener),
            off: (event: string, listener: (event: unknown) => void) => serverBus.off(event, listener),
            emit: (event: string, detail: unknown) => Promise.resolve(serverBus.emit(event, detail)),
        };
        return bridge as unknown as EventBus<WorkflowEngineEvents>;
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers (not exported)
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

/**
 * Walk a directory (following symlinks) for .yaml/.yml files and extract name + kind.
 * Gracefully skips unparseable files (adds them with valid=false + error message).
 */
async function scanWorkflowFiles(rootPath: string, source: 'project' | 'global'): Promise<WorkflowListEntry[]> {
    const entries: WorkflowListEntry[] = [];

    let rootStat: Stats;
    try {
        rootStat = await stat(rootPath);
    } catch {
        return entries; // path doesn't exist — empty
    }

    // Resolve symlink to real path for directory walking
    const realPath = rootStat.isSymbolicLink() ? await realpath(rootPath) : rootPath;

    const dirents = await readdir(realPath, { withFileTypes: true, recursive: true });
    for (const dirent of dirents) {
        if (!dirent.isFile()) continue;
        const name = dirent.name;
        if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;

        const fullPath = resolve(dirent.parentPath, name);
        // Display path: rootPath-relative when under the root, else absolute
        const displayPath = fullPath.startsWith(rootPath) ? fullPath.slice(rootPath.length + 1) : fullPath;

        const meta = await extractWorkflowMeta(fullPath);
        entries.push({ ...meta, path: displayPath, source });
    }

    return entries;
}

/** Parse a workflow YAML file to extract name and kind. Returns partial entry on failure. */
async function extractWorkflowMeta(
    filePath: string,
): Promise<Pick<WorkflowListEntry, 'name' | 'kind' | 'valid' | 'error'>> {
    try {
        const text = await readFile(filePath, 'utf-8');
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
    try {
        const meta = JSON.parse(row.metadata_json);
        isDryRun = meta.dryRun === true;
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
    };
}
