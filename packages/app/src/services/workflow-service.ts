import type { SpurConfig } from '@gobing-ai/spur-config';
import type { ActionCostAttribution, DbAdapter } from '@gobing-ai/spur-domain';
import type { DecisionMaker } from '@gobing-ai/ts-ai-runner';

import type {
    ActionRedactor,
    WorkflowRunResult as EngineWorkflowRunResult,
    HitlResponder,
    ResumeOwnership,
    WorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import type { HostAllowlist, HttpRequester } from '../workflow/actions/http-request';
import type { CompositionAdvisory } from '../workflow/composition-lint';
import type { WorkflowObservabilityBus } from '../workflow/observability';
import type { WorkItem } from '../workflow/receipt';
import type {
    CheckpointReclamationResult,
    RunLogReclamationResult,
    ScratchReclamationResult,
    WorkflowRunRecordInspection,
} from '../workflow/run-record';
import type { WorkflowSteeringController } from '../workflow/steering';
import type { ResolvedWorkflowDefinition, WorkflowLayerId } from '../workflow/workflow-resolver';
import type { AgentService } from './agent-service';
import type { RuleService } from './rule-service';
import type { RunStorageMigrationResult } from './run-storage';
import type { SystemEventAction, SystemEventProjectContext } from './system-event-envelope';
import { WorkflowCleanOps } from './workflow-clean-ops';
import { WorkflowEngineFactory } from './workflow-engine-factory';
import { WorkflowInspectOps } from './workflow-inspect-ops';
import { WorkflowResumeOps } from './workflow-resume-ops';
import { WorkflowRunOps } from './workflow-run-ops';

export { workflowVersionLiteral } from './workflow-run-recording';
export { mergeWorkflowRunVars } from './workflow-run-vars';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of a workflow validate operation. */
export type WorkflowValidateResult =
    | { ok: true; valid: true; workflow: WorkflowDef; digest?: string; composition?: CompositionAdvisory }
    | { ok: false; valid: false; file: string; errors: string[] };

/**
 * Result of a workflow run operation: the engine's run result, widened with an
 * index signature so it serializes cleanly via `toJson`. run()/continuePaused()
 * additionally echo the run's PERSISTED identity (0768).
 */
export type WorkflowRunResult = EngineWorkflowRunResult & {
    /** sha256 digest recorded in the run row's metadata (null for legacy rows). */
    definitionDigest?: string | null;
    /** Workflow version literal recorded at creation; absent for pre-0768 rows. */
    version?: string | null;
    /**
     * D65 1232: present when the run paused on a host-executor `agent.run` stage — the
     * work item the host session performs before `spur workflow continue <run-id>
     * --answer-text <receipt-path>`. Additive: the engine's own result fields are unchanged.
     *
     * 1248: an operator-pause gate reports its question instead, answered with
     * `spur workflow continue <run-id> --answer yes|no|cancel` (`--answer-text` for input) —
     * never a work-item receipt.
     */
    pause?: { kind: 'input'; workItem: WorkItem } | { reason: 'hitl-pause'; kind: GateActionKind; prompt: string };
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
    /**
     * 0901 R5: redactor applied to persisted action results. Callers pass a
     * shared Spur redactor (secret values + bounded shell-output tails); the
     * engine applies it at finalize into `action_runs.result_json`.
     */
    redactor?: ActionRedactor;
    /** Synchronous in-process steering only; intentionally never serialized for detached runs. */
    steeringController?: WorkflowSteeringController;
    /**
     * Fresh-run start point (task 1072). The engine begins this run at the named
     * state/node instead of the definition's entry point, with fresh-run
     * semantics: no snapshot, no `resumeMode`, and the start state's action runs.
     * The definition must mark the target `startable: true`.
     */
    startState?: string;
    /**
     * Lineage to a prior run; only meaningful together with `startState`. Its last
     * snapshot's effective vars are inherited under `vars` (engine-internal `__*`
     * keys excluded) and `continuedFrom` / `continuedFromDigest` are stamped into
     * the new run's metadata. The source run is never mutated.
     */
    continuedFrom?: string;
    /**
     * Pre-resolved definition + digest (0768 R1). When provided, run() uses this
     * exact resolution for the engine, the identity stamp, and the plan preview
     * instead of re-resolving the file — the launcher and the run share one
     * resolved identity.
     */
    resolvedDefinition?: ResolvedWorkflowDefinition;
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
    /** Id of the workflow layer (ADR-113) the file was listed from. */
    source: WorkflowLayerId;
    valid: boolean;
    error?: string;
    /** Declared version literal, or null for a known-unversioned definition (0768 R1). */
    version?: string | null;
    /** Canonical definition digest, identical to what a run of this file stamps (0768 R1). */
    definitionDigest?: string;
    /** Definition's top-level description — the catalog intent (0819 R5); null when absent or unparseable. */
    description: string | null;
}

/** Result of a workflow list operation — available workflow files. */
export interface WorkflowListResult {
    layers: Array<{ id: WorkflowLayerId; path: string }>;
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
    project: SystemEventProjectContext;
    durationMs: number | null;
    outcome: string;
    nextAction?: SystemEventAction;
    /** Terminal failure reason (e.g. `no-passing-transition`) when the engine recorded one. */
    failureReason?: string;
    /**
     * Authoritative terminal reason from the run row (`done`, `cancelled`, `failed-check`, …).
     * Distinct from `failureReason`, which comes from run metadata and is absent on most rows.
     */
    terminalReason?: string;
    /** Declared version literal or null; absent for pre-0768 rows (unknown identity, 0768 R1). */
    version?: string | null;
    /** Persisted definition digest from run metadata (0768 R1). */
    definitionDigest?: string;
    /**
     * Fresh-run start point recorded at run start (task 1072 R7). Present only on
     * runs launched with `--from`; absent from every legacy row.
     */
    startState?: string;
    /** Source run id recorded at run start for a continued run (task 1072 R7). */
    continuedFrom?: string;
}

/** Result of a trace listing (no run-id). */
export interface WorkflowTraceListResult {
    entries: WorkflowTraceEntry[];
    total: number;
}

/** A timeline event: phase entry, transition, or action execution. */
export type TimelineEvent =
    | { kind: 'phase'; phase: string; status: string; startedAt: string | null; completedAt: string | null }
    | { kind: 'transition'; from: string; to: string; trigger: string | null; at: string }
    | {
          kind: 'action';
          actionId: string;
          node: string;
          actionKind: string;
          status: string;
          duration: string;
          durationMs: number | null;
          startedAt: string | null;
          completedAt: string | null;
          ok: boolean | null;
          outcome: string;
          result: Record<string, string | number | boolean> | null;
          invocation: Record<string, string | number | boolean> | null;
          /** Decision provenance persisted with a HITL action result (0911 R6); null when the
           * action carried no `decision` option or the outcome predates the policy. */
          decision?: TimelineActionDecision | null;
          error: string | null;
          artifacts: string[];
          nextAction?: SystemEventAction;
          label: string;
          /** Per-step token cost + cache-hit from `history_message` typed columns via the
           * run→session mapping (task 0559). Undefined when cost hasn't been computed or
           * isn't available. `exact` and `estimated` figures are never summed (R2). */
          cost?: ActionCostAttribution;
      };

/** Bounded decision provenance projected onto a HITL action trace event (0911 R6). */
export interface TimelineActionDecision {
    mode: string;
    outcome: string;
    reason: string;
    provider: string | null;
    confidence: number | null;
    selectedProbability: number | null;
    evidenceActionIds: string[];
    evidenceDigest: string | null;
    artifactId: string | null;
    durationMs: number;
}

/** Result of a per-run trace with timeline. */ export interface WorkflowTraceTimeline {
    run: WorkflowTraceEntry;
    events: TimelineEvent[];
    /**
     * Relative path to the per-run consolidated all-in-one log
     * (`.spur/memory/runs/<runId>.log`, feature D2 / task 0426) when the file exists.
     */
    outputArtifact?: string;
}

/** Runtime dependencies injected into WorkflowAppService. */
export interface WorkflowAppServiceContext {
    cwd: string;
    /**
     * Merged global+project config threaded from the composition root (A5 /
     * ADR-082) — the only app-config source. `null` = load failed/absent;
     * consumers degrade to today's defaults.
     */
    spurConfig?: SpurConfig | null;
    /** 0799 R3: launch boundaries reload merged config so quota-driven executor disables apply without a server restart. */
    reloadAgentConfig?: () => Promise<SpurConfig | null>;
    /** Secret values redacted before workflow action results are persisted. */
    secretValues?: readonly string[];
    /** Optional operational warning sink (CLI stderr / server logger). */
    warn?(message: string): void;
    getDb(): Promise<DbAdapter>;
    agentService(): AgentService;
    ruleService(): RuleService;
    hitlResponder(): HitlResponder;
    /** Optional provider factory for the enabled DecisionMaker integration. */
    decisionMaker?(): Promise<DecisionMaker>;
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
     * per-step lifecycle events (`workflow.run.started`, `workflow.node.enter`,
     * etc.) are forwarded to the system_events tap (R3) and SSE stream. The
     * action boundary is verb-form only (`workflow.action.started`/`.finished`
     * from the observability adapter); the engine-native
     * `workflow.action.start`/`.done` aliases are filtered out at the bridge
     * (0869 R2) so the boundary is never double-named.
     */
    events?(): EventBus<Record<string, (event: unknown) => void>>;
    /**
     * Called after a successful (non-dry) run reaches `done` (feature E3).
     * Must not throw into the run result.
     */
    onPipelineCompleted?: (detail: { runId: string; workflowName: string }) => Promise<void>;
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
    private readonly engine: WorkflowEngineFactory;
    private readonly runOps: WorkflowRunOps;
    private readonly resumeOps: WorkflowResumeOps;
    private readonly cleanOps: WorkflowCleanOps;
    private readonly inspectOps: WorkflowInspectOps;

    constructor(ctx: WorkflowAppServiceContext) {
        this.ctx = ctx;
        this.engine = new WorkflowEngineFactory(this.ctx);
        this.runOps = new WorkflowRunOps(this.ctx, this.engine);
        this.resumeOps = new WorkflowResumeOps(this, this.ctx, this.engine, this.runOps);
        this.cleanOps = new WorkflowCleanOps(this.ctx);
        this.inspectOps = new WorkflowInspectOps(this.ctx, this.engine);
    }

    /** Validate a workflow YAML file. Returns a structured result instead of throwing. */
    async validate(file: string, opts: { validateSchema?: boolean } = {}): Promise<WorkflowValidateResult> {
        return this.inspectOps.validate(file, opts);
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
        return this.runOps.run(file, opts);
    }

    /**
     * Discover the most-recent paused run (E3), or `null` if none are paused.
     * Used by `spur workflow continue` with no run-id to find the run to resume.
     */
    async latestPausedRun(): Promise<PausedRun | null> {
        return this.runOps.latestPausedRun();
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
        return this.cleanOps.clean(olderThanMinutes, dryRun);
    }

    /**
     * Migrate durable evidence out of the scratch plane (feature E71, task 1025):
     * task verdicts and feature run/latest receipts byte-copy into
     * `.spur/memory/evidence`, closed run records into `.spur/memory/runs`.
     * Sources under `.spur/run` are never removed; units owned by live,
     * paused or interrupted-recoverable runs are preserved. Dry-run writes
     * nothing and reports `would-migrate` outcomes.
     */
    async migrateRunStorage(opts: { dryRun?: boolean; logsOnly?: boolean } = {}): Promise<RunStorageMigrationResult> {
        return this.cleanOps.migrateRunStorage(opts);
    }

    /**
     * Reclaim expired terminal or unowned legacy run logs (feature D2 / task 0429).
     * Non-terminal runs, including paused/interrupted runs, remain protected.
     * If run ownership cannot be read, preserve all logs and report the failure.
     *
     * Scope (1026 R4): terminal `<runId>.log` files in the durable run-record plane
     * (`.spur/memory/runs/`) first, legacy scratch (`.spur/run/`) second — realpath/name
     * dedup across roots. A run whose DB row is non-terminal is never reclaimed.
     * The two-file run record (`<runId>.md` + `<runId>.state.json`) is NOT reclaimed until
     * a pair retention policy is selected.
     *
     * @param retentionDays Logs older than this many days are reclaimed. Default 30.
     * @param dryRun When true, report what would be removed without unlinking.
     */
    async cleanRunLogs(retentionDays = 30, dryRun = false): Promise<RunLogReclamationResult> {
        return this.cleanOps.cleanRunLogs(retentionDays, dryRun);
    }

    /**
     * Reclaim expired top-level `.spur/run/` scratch (ADR-131: scratch is disposable;
     * durable state lives in `.spur/memory/`). An entry is reclaimed only when its newest
     * subtree mtime is past retention, it is not a `.log` (owned by `cleanRunLogs`), not the
     * live fleet-lease dir `guests`, not a git worktree, and its name does not start with an
     * active run id. If run ownership cannot be read, nothing is reclaimed.
     */
    async cleanScratch(retentionDays = 30, dryRun = false): Promise<ScratchReclamationResult> {
        return this.cleanOps.cleanScratch(retentionDays, dryRun);
    }

    /**
     * Reclaim expired terminal session checkpoints (`.spur/memory/sessions/`,
     * task 0711 R5–R8). A checkpoint is reclaimed only when every guard holds:
     * it parses as canonical metadata (0711 R1), its status is terminal, its
     * `updated_at` (fallback mtime) is older than the retention threshold —
     * the same `workflows.logRetentionDays` knob that governs run logs (0711
     * R7) — its `run_id` references no active run, and its resolved path is
     * confined to the sessions directory (0711 R5). Anything else is kept and
     * reported with the reason: malformed files are never deleted because they
     * cannot prove they are terminal checkpoints (0711 R6), and this scan
     * never leaves `.spur/memory/sessions/`, so task/feature authority files
     * and `.spur/context` learnings are unreachable by construction (0711 R6).
     *
     * Idempotent: a reclaimed file is gone, so the next run reports nothing.
     *
     * @param retentionDays Checkpoints older than this many days are reclaimed. Default 30.
     * @param dryRun When true, report what would be removed without unlinking.
     */
    async cleanCheckpoints(retentionDays = 30, dryRun = false): Promise<CheckpointReclamationResult> {
        return this.cleanOps.cleanCheckpoints(retentionDays, dryRun);
    }

    /**
     * Cancel a single non-terminal run by id — SIGTERM its worker process group (if
     * a pid was recorded) and mark the run `failed` with the closed terminal reason
     * `cancelled` plus a `cancelled by operator` metadata message. The discoverable
     * single-run counterpart to `clean` (which finalizes stale runs in bulk). Every
     * resumable state is a target — `running`, `pending`, and since task 1048 also
     * `paused`/`interrupted` — with `terminal_reason` stamped so trace and reason
     * consumers report `cancelled` instead of unknown. Idempotent against
     * already-terminal runs (no-op, no signalling) and reports `not_found` for an
     * unknown id.
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
        return this.runOps.cancel(runId);
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
    async continuePaused(runId: string, opts?: ContinuePausedOptions): Promise<WorkflowRunResult> {
        return this.resumeOps.continuePaused(runId, opts);
    }

    /**
     * Read-only gate inspection (0932 R2): the HITL gate action pending at the
     * run's current state, or `null` when the run is not resumable (missing or
     * terminal), projects no current state, or that state declares no gate
     * action. The CLI calls this before both the sync and `--async` continue
     * paths so a mismatched answer flag fails with `VALIDATION_FAILED` before
     * the TTY confirmation, the async spawn, or any resume claim;
     * `continuePaused` re-checks it defensively. The definition is resolved
     * exactly like a resume (recorded launch source honored — shared helpers
     * with `continuePaused`), so the inspected gate is the gate a resume would
     * actually execute.
     */
    async pendingGate(runId: string): Promise<PendingGate | null> {
        return this.resumeOps.pendingGate(runId);
    }

    /**
     * List available workflow YAML files across the ordered workflow layers (ADR-113):
     * `project` (always listed), each registered extra folder from `workflowPaths`, then
     * the installed package's shared root (`bundledConfigRoot()`). `workflowPaths` are the registered
     * candidates (default: the legacy `.spur/workflows/` entry, which collapses into the
     * project layer), and bare-name resolution probes the same list, so `list` shows
     * exactly the folders a name can resolve from.
     */
    async list(workflowPaths: string[] = ['.spur/workflows/']): Promise<WorkflowListResult> {
        return this.inspectOps.list(workflowPaths);
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
            return this.inspectOps.traceRun(db, runIdOrFilter);
        }
        return this.inspectOps.traceList(db, runIdOrFilter ?? {});
    }

    /**
     * Bounded run-record inspection for the Board run detail (0929 R1/R2) —
     * the confined, redacted, bounded read over this project's `.spur/run`
     * directory. Read-only; the DB trace remains the lifecycle authority.
     */
    inspectRunRecord(runId: string): WorkflowRunRecordInspection {
        return this.inspectOps.inspectRunRecord(runId);
    }

    /**
     * Record the async run's plan artifact path in run metadata (0768 R2). The
     * artifact itself is written by the CLI launcher before the worker starts;
     * this stamps the pointer so trace/progress can surface it. Best-effort:
     * the worker has already been spawned, so a metadata failure must not undo
     * a registered run.
     */
    async stampPlanArtifactPath(runId: string, planArtifactPath: string): Promise<void> {
        return this.runOps.stampPlanArtifactPath(runId, planArtifactPath);
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers (not exported)
// ---------------------------------------------------------------------------

/** The three gate action kinds that carry an operator answer (0932). */
export type GateActionKind = 'hitl.confirm' | 'hitl.select' | 'hitl.input';

/** The gate action pending at a resumable run's current state (0932 R2). */
export interface PendingGate {
    /** State/node the run is paused at. */
    readonly stateId: string;
    /** The pending gate action kind. */
    readonly kind: GateActionKind;
    /** The var the gate writes its answer into (`options.var`, else the kind default). */
    readonly answerVar: string;
}

/** Continue/resume options shared by the CLI and the async worker (0901/0932). */
export interface ContinuePausedOptions {
    /** 0433 R1: yes|no|cancel gate answer injected before guard re-evaluation. */
    readonly hitlAnswer?: 'yes' | 'no' | 'cancel';
    /** 0932 R1: free-text answer for a pending hitl.input gate, stored verbatim. */
    readonly answerText?: string;
    /** Explicit var override for tests; names the var and skips the gate-kind check. */
    readonly hitlVar?: string;
    readonly allowDigestMismatch?: boolean;
    readonly force?: boolean;
    /** 0901 R5: redactor applied to persisted action results (shell tails). */
    readonly redactor?: ActionRedactor;
    /** 0901 R2/R4: resume ownership claim; async workers pass their own attempt+pid. */
    readonly resumeOwner?: ResumeOwnership;
    /** 0901 R4: the async continue worker stamps its pid at the resume claim. */
    readonly recordSelfPid?: boolean;
}

// Re-exported from `workflow/run-record` (0962): that module owns the traversal guard that throws
// it, and the class must not create a run-record → service edge. The public surface is unchanged.
export { InvalidWorkflowRunIdError } from '../workflow/run-record';
export {
    type ResolvedWorkflowDefinition,
    type ResolveWorkflowDefinitionOptions,
    type ResolveWorkflowFileResult,
    registeredWorkflowPaths,
    resolveWorkflowDefinition,
    resolveWorkflowFile,
    type WorkflowLayer,
    type WorkflowLayerId,
    workflowLayers,
} from '../workflow/workflow-resolver';
