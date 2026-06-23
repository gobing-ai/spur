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
    type WorkflowPersistenceAdapter,
} from '@gobing-ai/ts-dual-workflow-engine';
import { parseYamlObject } from '@gobing-ai/ts-runtime';
import type { HostAllowlist, HttpRequester } from '../workflow/actions/http-request';
import { registerSpurBuiltins } from '../workflow/builtins';
import { ObservableWorkflowAdapter, type WorkflowObservabilityBus } from '../workflow/observability';
import type { AgentService } from './agent-service';
import type { RuleService } from './rule-service';

/** Workflow name that triggers a pipeline run-link (matches `config/workflows/task-pipeline.yaml`). */
const TASK_PIPELINE_WORKFLOW = 'task-pipeline';

/** Link kind for pipeline runs in `task_run_links` (additive to `kind='lifecycle'`). */
const PIPELINE_LINK_KIND = 'pipeline';

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
}

// ---------------------------------------------------------------------------
// WorkflowAppService
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

    /** Validate a workflow YAML file. Returns a structured result instead of throwing. */
    async validate(file: string, opts: { validateSchema?: boolean } = {}): Promise<WorkflowValidateResult> {
        const absolute = resolve(this.ctx.cwd, file);

        if (!(await fileExists(absolute))) {
            return { ok: false, valid: false, file, errors: [`File not found: ${absolute}`] };
        }

        try {
            const workflow = await loadWorkflowDef(absolute, {
                validateSchema: opts.validateSchema !== false,
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
        const svc = await this.createEngineService();
        const runId = opts.runId ?? crypto.randomUUID();
        const isDry = opts.dryRun === true;
        const result = await svc.runFile(file, {
            workdir: this.ctx.cwd,
            runId,
            ...(opts.vars ? { vars: opts.vars } : {}),
            ...(isDry ? { dryRun: true } : {}),
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

    private async createEngineService(): Promise<EngineWorkflowService> {
        const host = createDefaultWorkflowEngineHost();
        registerSpurBuiltins(host, {
            agentService: this.ctx.agentService(),
            ruleService: this.ctx.ruleService(),
            hitlResponder: this.ctx.hitlResponder(),
            httpRequester: this.ctx.httpRequester?.(),
            hostAllowlist: this.ctx.hostAllowlist?.(),
        });
        const persistence: WorkflowPersistenceAdapter = new DbWorkflowPersistenceAdapter(await this.ctx.getDb());
        const bus = this.ctx.observabilityBus?.();
        const adapter = bus ? new ObservableWorkflowAdapter(persistence, bus) : persistence;
        return new EngineWorkflowService(host, adapter);
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
