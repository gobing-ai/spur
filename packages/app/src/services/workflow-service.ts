import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AGENT_ROLE_NAMES, getEnvVars, type SpurConfig } from '@gobing-ai/spur-config';
import { resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    type ActionCostAttribution,
    ActionRunDao,
    ArtifactDao,
    attributeActionCost,
    CoordinationRunDao,
    createId,
    normalizePersistedWorkflowLayer,
    PhaseRunDao,
    RunDao,
    type RunDefinitionSource,
    redirectRunStorageReferences,
    TaskRunLinkDao,
    TransitionRunDao,
} from '@gobing-ai/spur-domain';
import { type DecisionMaker, resolveAgentName } from '@gobing-ai/ts-ai-runner';

import {
    type ActionRedactor,
    collectWorkflowExtensions,
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    type WorkflowRunResult as EngineWorkflowRunResult,
    WorkflowService as EngineWorkflowService,
    type HitlResponder,
    loadWorkflowDef,
    loadWorkflowExtensionsIntoHost,
    type ResumeOwnership,
    type WorkflowDef,
    type WorkflowEngineHost,
    type WorkflowPersistenceAdapter,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus } from '@gobing-ai/ts-infra';
import {
    createNodeFileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
    parseYamlObject,
} from '@gobing-ai/ts-runtime';
import { ValidationError } from '@gobing-ai/ts-utils';
import { getDecisionService } from '../decision/decision-service';
import { redactAndBound } from '../observability/agent-execution';
import type { SystemEventBus } from '../services/system-event-tap';
import { createRunLogTraceFailureRecorder, withActionTrace } from '../workflow/action-trace';
import type { HostAllowlist, HttpRequester } from '../workflow/actions/http-request';
import { resolveDurableArtifactPath, resolveRunArtifactPath } from '../workflow/actions/run-path';
import { registerSpurBuiltins } from '../workflow/builtins';
import {
    type CheckpointMetadata,
    checkpointStaleness,
    isTerminalCheckpointStatus,
    parseCheckpointMetadata,
} from '../workflow/checkpoint-contract';
import { computeDefinitionDigest } from '../workflow/composition-baseline';
import {
    type CompositionAdvisory,
    collectAgentRunRoleViolations,
    collectCompositionAdvisory,
    collectDecideViolations,
    collectHitlDecisionViolations,
    collectShellCommands,
    collectTerminalReasonViolations,
    collectUndeclaredShellVarViolations,
    gateSitesForState,
    hitlAnswerVar,
} from '../workflow/composition-lint';
import type { SummaryResolver } from '../workflow/decision-evidence';
import { type DecisionEvaluator, evaluateDecision } from '../workflow/decision-hitl-responder';
import type { FleetDispatchDeps } from '../workflow/fleet-dispatch';
import { ObservableWorkflowAdapter, type WorkflowObservabilityBus } from '../workflow/observability';
import { projectWorkflowProgress } from '../workflow/progress-projection';
import { loadRunCorrelation } from '../workflow/run-correlation';
import {
    type CheckpointReclamationResult,
    inspectWorkflowRunRecord,
    type ReclaimedCheckpoint,
    type ReclaimedRunLog,
    type RunLogReclamationResult,
    type SkippedCheckpoint,
    type WorkflowRunRecordInspection,
} from '../workflow/run-record';
import { assertStartStateStartable, readContinuedFrom, StartStateRefusedError } from '../workflow/start-state';
import type { WorkflowSteeringController } from '../workflow/steering';
import {
    type ResolvedWorkflowDefinition,
    registeredWorkflowPaths,
    resolveWorkflowDefinition,
    resolveWorkflowFile,
    type WorkflowLayerId,
    workflowLayers,
} from '../workflow/workflow-resolver';
import { AgentCoordinationService, type CoordinationEventBus } from './agent-coordination-service';
import type { AgentService } from './agent-service';
import { bridgeEventBus, dropRetiredActionBoundaryAliases, withWorkflowIdentity } from './event-bridge';
import { FleetDispatcher } from './fleet-dispatcher';
import { FleetService } from './fleet-service';
import type { RuleService } from './rule-service';
import {
    migrateRunStorage,
    type RunStorageMigrationResult,
    resolveRunRecordDir,
    runArtifactsDir,
    runStoragePaths,
} from './run-storage';
import {
    type SystemEventAction,
    type SystemEventProjectContext,
    systemEventProjectContext,
} from './system-event-envelope';

/** Workflow name that triggers a pipeline run-link (matches the shipped `workflows/task-pipeline.yaml`). */
const TASK_PIPELINE_WORKFLOW = 'task-pipeline';

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
            // 0901 R4: resume claims are the continue worker's creation moment —
            // stamp the pid at the actual resume mutation so `workflow cancel`
            // can reach the detached resumer. A stale pid on a crashed worker
            // row is tolerated by cancel's ESRCH handling, so no exit-clearing.
            if (prop === 'claimRunOwnership') {
                return async (
                    runId: string,
                    owner: Parameters<WorkflowPersistenceAdapter['claimRunOwnership']>[1],
                    expectedStatuses: Parameters<WorkflowPersistenceAdapter['claimRunOwnership']>[2],
                ) => {
                    const claimed = await target.claimRunOwnership(runId, owner, expectedStatuses);
                    if (claimed !== undefined) await stamp(runId);
                    return claimed;
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * The identity stamped onto every new run row at creation (0768 R1): the
 * canonical definition digest plus the definition's version literal (or `null`
 * for a known-unversioned definition). `source` (0784 R1) pins the resolved
 * launch file + layer + workdir so resume replays the launched definition
 * instead of re-deriving it from `workflow_name`.
 */
interface WorkflowRunIdentity {
    definitionDigest: string;
    workflowVersion: string | null;
    source?: RunDefinitionSource;
}

/**
 * Stamp workflow identity onto the run row at creation (tasks 0603/0768). The
 * digest + version literal are written in ONE json_set call so a row can never
 * be half-identified. Persistence is NOT best-effort (0768): a run that starts
 * without its identity would resume through the unguarded null-digest path and
 * read as pre-0768 legacy, so a failed identity merge fails run creation
 * before any action executes.
 */
function withRunIdentityRecording(
    inner: WorkflowPersistenceAdapter,
    db: DbAdapter,
    identity: WorkflowRunIdentity,
): WorkflowPersistenceAdapter {
    const stamp = async (runId: string): Promise<void> => {
        // json_set (via stampRunIdentity), not json_patch: RFC-7396 merge patch
        // deletes keys whose value is null, which would erase a known-unversioned
        // workflowVersion instead of recording it. The DAO merge is conditional on
        // an absent digest, so identity is immutable once stamped (0784 R1).
        await new RunDao(db).stampRunIdentity(
            runId,
            identity.definitionDigest,
            identity.workflowVersion,
            identity.source,
        );
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
                    // 0784 R1: attaching an already-persisted run must retain its
                    // recorded identity (or its documented pre-0768 legacy absence) —
                    // stamp only a genuinely new row, never the attach target.
                    const existing = await new RunDao(db).traceRowById(record.id);
                    const result = await target.createOrAttachRun(record);
                    if (existing === undefined) await stamp(result.id);
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

    constructor(ctx: WorkflowAppServiceContext) {
        this.ctx = ctx;
    }

    /** Validate a workflow YAML file. Returns a structured result instead of throwing. */
    async validate(file: string, opts: { validateSchema?: boolean } = {}): Promise<WorkflowValidateResult> {
        let resolved: ResolvedWorkflowDefinition;
        try {
            resolved = await resolveWorkflowDefinition(this.ctx.cwd, file, {
                validateSchema: opts.validateSchema !== false,
                embeddedSchemas: this.ctx.embeddedSchemas?.(),
                registered: registeredWorkflowPaths(this.ctx.spurConfig ?? null),
            });
        } catch (error) {
            const probeMatch = resolveWorkflowFile(this.ctx.cwd, file);
            if (probeMatch.path === null) {
                const [probedProject, probedShared] = probeMatch.probed;
                return {
                    ok: false,
                    valid: false,
                    file,
                    errors: [
                        `File not found: ${probedProject}${probedShared !== null ? ` (shared: ${probedShared})` : ''}`,
                    ],
                };
            }
            return {
                ok: false,
                valid: false,
                file,
                errors: [error instanceof Error ? error.message : String(error)],
            };
        }
        const absolute = resolved.path;
        const workflow = resolved.workflow;

        try {
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

            // Declared step role (0538 R2): every agent.run step must declare a
            // Layer-1 role beside its agent: pin. The JSON-schema validator is a
            // keyword subset (no if/then — ts-runtime schema-validation), so this
            // post-schema walk is the enforcement surface, same pattern as the
            // shell-syntax check above. Both `validate` and `run` share it.
            const roleErrors = collectAgentRunRoleViolations(workflow);
            if (roleErrors.length > 0) {
                return { ok: false, valid: false, file, errors: roleErrors };
            }

            // Undeclared shell-var check (0674 R5): every `$var` a shell action/guard references
            // must have a declared home in the workflow's vars: block (or be assigned/sourced
            // locally). Same post-schema enforcement surface as the role check above.
            const varErrors = collectUndeclaredShellVarViolations(workflow);
            if (varErrors.length > 0) {
                return { ok: false, valid: false, file, errors: varErrors };
            }

            // Decision-policy check (0911 D2/D5): decision: options on hitl.* actions are parsed
            // with the runtime parser and structurally validated (pause conflict, one-per-state,
            // evidence choice invariants, producer-node existence). Same post-schema surface.
            const decisionErrors = collectHitlDecisionViolations(workflow);
            if (decisionErrors.length > 0) {
                return { ok: false, valid: false, file, errors: decisionErrors };
            }

            // Decide-action check (0941 R6): a decide action missing its default, declaring a
            // default outside choices, or omitting resultFile is rejected with the SAME zod
            // schema the runner executes — validation and execution cannot drift.
            const decideErrors = collectDecideViolations(workflow);
            if (decideErrors.length > 0) {
                return { ok: false, valid: false, file, errors: decideErrors };
            }

            // Terminal-reason check (0937 R3): every transition into a `failureStates`
            // member must declare a valid `terminalReason` enum value, so a failed run's
            // reason is per-edge, not the ambiguous `terminal:<stateId>` built-in. Same
            // post-schema surface as the checks above.
            const terminalReasonErrors = collectTerminalReasonViolations(workflow);
            if (terminalReasonErrors.length > 0) {
                return { ok: false, valid: false, file, errors: terminalReasonErrors };
            }

            // 0614: warn-only composition advisory (shell measure + agent.run
            // prompt size + disposition suppression). Never affects validity.
            const composition = collectCompositionAdvisory(workflow, absolute);

            // 0533 R3: validate fails closed on a bad extension — a missing module,
            // an absolute/`..` path, or a mis-shaped export surfaces as a validation
            // error before any step. Same load path as run/continue (R2); a bare
            // default host is enough for the import + shape check (no builtins/DB).
            await this.loadWorkflowExtensions(createDefaultWorkflowEngineHost(), workflow, absolute);

            return { ok: true, valid: true, workflow, digest: resolved.digest, composition };
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
        // Pre-load with embedded-schema options so `run` resolves `$schema` through
        // the same map as `validate` (task 0431 R1/R4). `svc.runFile` would call
        // `loadWorkflowDef(path)` with no options, falling back to node resolution.
        // Explicit `validateSchema: true` matches `validate()` so the two verbs cannot
        // diverge on whether schema validation is on (task 0431 R4/R5). Loaded first
        // so YAML-declared extensions can be registered on the host (0533 R1).
        // 0768 R1: a pre-resolved definition from the caller (async launcher / sync
        // CLI resolve-once) is reused verbatim so plan, identity stamp, and engine
        // share one resolution.
        const resolved =
            opts.resolvedDefinition ??
            (await resolveWorkflowDefinition(this.ctx.cwd, file, {
                validateSchema: true,
                embeddedSchemas: this.ctx.embeddedSchemas?.(),
                registered: registeredWorkflowPaths(this.ctx.spurConfig ?? null),
            }));
        const absolute = resolved.path;
        const workflow = resolved.workflow;
        // Fresh-run start state (task 1072 R2/R3/R5). Validation and lineage resolution
        // happen BEFORE any side effect — no run row, run record, plan artifact or worker.
        const startState = opts.startState;
        const continuedFrom = opts.continuedFrom;
        if (continuedFrom !== undefined && startState === undefined) {
            throw new StartStateRefusedError('--from-run requires --from: lineage needs a start state.');
        }
        if (startState !== undefined) {
            assertStartStateStartable(workflow, startState);
        }
        const continued =
            continuedFrom === undefined ? undefined : await readContinuedFrom(await this.ctx.getDb(), continuedFrom);
        const svc = await this.createEngineService({
            recordSelfPid: opts.recordSelfPid === true,
            events: eventsBus,
            steeringController: opts.steeringController,
            extensions: { workflow, file: absolute },
            // 0784 R1: pin the resolved launch source + workdir with the run
            // identity (one json_set, before any action executes) so resume
            // replays this exact definition even from another ambient cwd.
            definitionSource: { path: absolute, layer: resolved.layer, workdir: this.ctx.cwd },
        });
        const runId = opts.runId ?? crypto.randomUUID();
        const isDry = opts.dryRun === true;
        // R8 (0366): inject __runId so discovery artifacts can stamp run provenance.
        // Survives pause/resume via the effective-vars snapshot (R1–R3). Inert for
        // workflows that don't reference ${vars.__runId}.
        //
        // `agent` is injected on the same seam: pipeline YAML used to declare a named
        // executor literal (`agent: "omp"`) as its vars default, which bypassed
        // `.spur/config.yaml` `agent.default` entirely - config only ever reached an
        // `agent.run` step when a caller passed the literal `auto`. That made the config
        // knob dead for pipelines: an operator whose default executor was failing had no
        // supported way to redirect them. The shipped pipelines now declare `auto`, so both
        // rungs agree; this injection remains the seam that carries a configured default
        // into runs. Caller-supplied vars still win, so an explicit `--agent`/`--vars`
        // choice overrides config, and config in turn overrides the YAML literal.
        // (0485 R2) `implementAgent` is injected on the same seam so `agent.default` also
        // governs the implement hop; a stale default warns instead of failing dispatch.
        const warnings: string[] = [];
        const callerVars = mapFleetExecutorVar(opts.vars);
        const mergedCallerVars = { ...(continued?.vars ?? {}), ...callerVars };
        if (continued?.digest !== undefined && continued.digest !== resolved.digest) {
            // Q&A Q5: a differing definition prints a warning, never a refusal — the
            // lineage is recorded so the difference stays auditable.
            warnings.push(
                `--from-run ${continuedFrom}: source definition digest differs from the current definition ` +
                    `(source ${continued.digest.slice(0, 19)}…, current ${resolved.digest.slice(0, 19)}…). ` +
                    'The new run executes the CURRENT definition; the difference is recorded.',
            );
        }
        // Declared defaults are the base. Caller --vars overlay them; an explicit
        // empty string that would blank a declared var is rejected (0948 R2).
        // The engine also merges, but the map handed to it is already complete so
        // a replace-style consumer cannot drop a declared var the caller omitted.
        const runVars = {
            ...mergeWorkflowRunVars(workflow.vars as Record<string, unknown> | undefined, {
                // R5 var precedence: workflow defaults < source-run effective vars (already
                // stripped of engine-internal `__*` keys) < caller `--vars`.
                ...resolveDefaultAgentVar(this.ctx.spurConfig ?? null, mergedCallerVars, (m) => warnings.push(m)),
                ...mergedCallerVars,
            }),
            __runId: runId,
            // Task 1113 R3: full run correlation rides the same engine-var seam —
            // decide producers read __workflowName (and the snapshot-restored wbs)
            // so every decision event joins back to this run (feature P1 R7).
            __workflowName: workflow.name,
            // 0759 R5: inject the canonical definition digest on the same seam as __runId so a
            // pipeline can stamp it into its verdict proof block — verified-outcome then binds
            // the record to the certifying run AND its exact definition (a stale-definition
            // resume or a definition edited between run and record cannot certify silently).
            // The run row already carries the same digest (createEngineService stamps it via
            // withDefinitionDigestRecording); computing it here keeps the two identical.
            __definitionDigest: computeDefinitionDigest(workflow),
        };
        // Pre-load with embedded-schema options so `run` resolves `$schema` through
        // the same map as `validate` (task 0431 R1/R4). `svc.runFile` would call
        // `loadWorkflowDef(path)` with no options, falling back to node resolution.
        // Explicit `validateSchema: true` matches `validate()` so the two verbs cannot
        // diverge on whether schema validation is on (task 0431 R4/R5).
        const result = await svc.run(workflow, {
            workdir: this.ctx.cwd,
            runId,
            vars: runVars,
            ...(isDry ? { dryRun: true } : {}),
            ...(startState !== undefined ? { startState } : {}),
            ...(opts.redactor !== undefined ? { redactor: opts.redactor } : {}),
            ...(eventsBus !== undefined
                ? {
                      // R3 (0601): engine-native events also carry workflow identity;
                      // the retired action-boundary aliases are filtered out first (0869 R2).
                      events: withWorkflowIdentity(
                          dropRetiredActionBoundaryAliases(bridgeEventBus(eventsBus)),
                          workflow,
                      ),
                  }
                : {}),
        });
        // Stamp dryRun and any start-state lineage into metadata_json so `workflow trace`
        // can label a dry run and a continued run's source (task 1072 R4/R7).
        if (isDry || startState !== undefined) {
            const db = await this.ctx.getDb();
            await new RunDao(db).mergeMetadata(runId, {
                ...(isDry ? { dryRun: true } : {}),
                ...(startState !== undefined ? { startState } : {}),
                ...(continuedFrom !== undefined
                    ? {
                          continuedFrom,
                          ...(continued?.digest !== undefined ? { continuedFromDigest: continued.digest } : {}),
                      }
                    : {}),
            });
        }
        // R7 (0366): persist terminal failure reason so `workflow trace` can surface
        // `no-passing-transition` (and siblings) rather than only the command result.
        await this.stampFailureReason(runId, result);
        // R1 (task 0071): record a kind='pipeline' task_run_links row when a
        // task-pipeline run carries vars.wbs - links execution results back to
        // the task. Idempotent: a re-run with the same runId does not duplicate.
        await this.maybeLinkPipelineRun(file, runId, opts);
        const runResult = result as WorkflowRunResult;
        // 0768 R1: surface the run's identity on the result. A fresh run is always
        // identity-stamped, so version is the literal or null (known-unversioned) —
        // never absent; absence is reserved for pre-0768 rows.
        runResult.definitionDigest = resolved.digest;
        runResult.version = workflowVersionLiteral(workflow);
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
        if (!isDry && runResult.status === 'done') {
            try {
                await this.ctx.onPipelineCompleted?.({
                    runId: runResult.runId,
                    workflowName: runResult.workflowName,
                });
            } catch {
                // Refresh enqueue must not fail a completed pipeline.
            }
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
            const resolved = resolveWorkflowFile(this.ctx.cwd, file);
            if (resolved.path === null) return;
            const def = await loadWorkflowDef(resolved.path, { validateSchema: false });
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
            // 0901 R2: a stale claimed run is an owner the engine lost — mark it
            // `interrupted` (rerun-resumable) rather than `failed` (wedged).
            // Rows the engine cannot interrupt (pending / pre-0.5.0) keep the
            // legacy finalize-to-failed path.
            const engine = new EngineWorkflowService(
                createDefaultWorkflowEngineHost({}),
                new DbWorkflowPersistenceAdapter(db),
            );
            for (const run of stale) {
                const interrupted =
                    run.status === 'running'
                        ? await engine.interruptRun(
                              run.id,
                              // 0937 review: the engine mirrors this reason into the closed-enum
                              // runs.terminal_reason, so pass the declared value — the human detail
                              // lands in metadata_json below under finalizeStale's key.
                              'interrupted',
                          )
                        : undefined;
                if (interrupted === undefined) {
                    await dao.finalizeStale(run.id, `stale: non-terminal > ${olderThanMinutes}m (spur workflow clean)`);
                } else {
                    await dao.mergeMetadata(run.id, {
                        staleReason: `stale: owner lost > ${olderThanMinutes}m (spur workflow clean)`,
                    });
                }
            }
        }
        return {
            olderThanMinutes,
            dryRun,
            cleaned: stale.map((r) => ({ runId: r.id, startedAt: r.started_at })),
        };
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
        const paths = runStoragePaths(this.ctx.cwd);
        const db = await this.ctx.getDb();
        const runDao = new RunDao(db);
        return migrateRunStorage({
            dirs: paths,
            readRunStatus: async (runId) => (await runDao.traceRowById(runId))?.status ?? null,
            registeredArtifacts: await new ArtifactDao(db).storageReferences(),
            redirectReferences: async (entries) => {
                const moves = new Map<string, string>();
                for (const entry of entries) {
                    if (entry.target === null) continue;
                    const canonicalTarget = realpathSync(entry.target);
                    moves.set(entry.source, canonicalTarget);
                    moves.set(realpathSync(entry.source), canonicalTarget);
                    moves.set(relative(paths.projectRoot, entry.source), canonicalTarget);
                    for (
                        let source = dirname(entry.source), target = dirname(canonicalTarget);
                        source.startsWith(paths.scratchDir + sep);
                        source = dirname(source), target = dirname(target)
                    ) {
                        moves.set(source, target);
                        moves.set(realpathSync(source), target);
                        moves.set(relative(paths.projectRoot, source), target);
                    }
                }
                await redirectRunStorageReferences(
                    db,
                    Array.from(moves, ([source, target]) => {
                        const stat = statSync(target);
                        return {
                            source,
                            target,
                            ...(stat.isFile()
                                ? {
                                      sourceSize: stat.size,
                                      sourceMtimeMs: stat.mtimeMs,
                                  }
                                : {}),
                        };
                    }),
                );
            },
            dryRun: opts.dryRun === true,
            logsOnly: opts.logsOnly === true,
        });
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
        const fs = createNodeFileSystem();
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const reclaimed: ReclaimedRunLog[] = [];
        const failures: RunLogReclamationResult['failures'] = [];

        const liveIds = new Set<string>();
        try {
            for (const row of await new RunDao(await this.ctx.getDb()).listActiveRuns()) {
                liveIds.add(row.id);
            }
        } catch (err) {
            failures.push({ path: runStoragePaths(this.ctx.cwd).recordsDir, error: String(err) });
            return { retentionDays, dryRun, reclaimed, failures };
        }

        const runDirs = [runStoragePaths(this.ctx.cwd).recordsDir, join(this.ctx.cwd, '.spur', 'run')];
        const seen = new Set<string>();
        for (const runDir of runDirs) {
            let entries: string[];
            try {
                entries = (await fs.readDir(runDir)).filter((name) => name.endsWith('.log'));
            } catch {
                // Absent root — nothing to reclaim there.
                continue;
            }
            for (const name of entries) {
                if (seen.has(name)) continue;
                const path = join(runDir, name);
                if (liveIds.has(name.slice(0, -'.log'.length))) continue;
                const stat = await fs.stat(path);
                if (stat === null || !stat.isFile() || stat.mtimeMs >= cutoffMs) continue;
                const entry = {
                    runId: name.slice(0, -'.log'.length),
                    path,
                    mtime: new Date(stat.mtimeMs).toISOString(),
                };
                seen.add(name);
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
        }
        return { retentionDays, dryRun, reclaimed, failures };
    }

    /**
     * Reclaim expired terminal session checkpoints (`.spur/memory/sessions/`,
     * task 0711 R5–R8). A checkpoint is reclaimed only when every guard holds:
     * it parses as canonical metadata (0711 R1), its status is terminal, its
     * `updated_at` (fallback mtime) is older than the retention threshold —
     * the same `workflow.logRetentionDays` knob that governs run logs (0711
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
        const sessionsDir = join(this.ctx.cwd, '.spur', 'memory', 'sessions');
        const fs = createNodeFileSystem();
        let sessionsReal: string;
        try {
            sessionsReal = realpathSync(sessionsDir);
        } catch {
            sessionsReal = resolve(sessionsDir);
        }
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const reclaimed: ReclaimedCheckpoint[] = [];
        const skipped: SkippedCheckpoint[] = [];
        const failures: CheckpointReclamationResult['failures'] = [];

        let entries: string[];
        try {
            entries = (await fs.readDir(sessionsDir)).filter((name) => name.endsWith('.md'));
        } catch {
            // No sessions dir yet — nothing to reclaim.
            return { retentionDays, dryRun, reclaimed, skipped, failures };
        }

        const activeRunIds = new Set((await new RunDao(await this.ctx.getDb()).listActiveRuns()).map((r) => r.id));

        for (const name of entries) {
            const path = join(sessionsDir, name);
            // Confinement guard (0711 R5): the candidate must resolve back into the sessions dir.
            // `realpath` (not `resolve`) — `resolve` never follows symlinks, so a link escaping
            // the dir would pass a plain-normalize check and get deleted through the link.
            let resolved: string;
            try {
                resolved = realpathSync(path);
            } catch {
                resolved = resolve(path);
            }
            if (!resolved.startsWith(sessionsReal + sep)) {
                skipped.push({ name, reason: 'path-confinement: resolved outside .spur/memory/sessions' });
                continue;
            }
            let meta: CheckpointMetadata | null = null;
            let mtimeMs = 0;
            try {
                meta = parseCheckpointMetadata(await fs.readFile(path));
                const stat = await fs.stat(path);
                mtimeMs = stat?.mtimeMs ?? 0;
            } catch (err) {
                skipped.push({ name, reason: `unreadable: ${String(err)}` });
                continue;
            }
            if (meta === null) {
                skipped.push({ name, reason: 'malformed: not canonical checkpoint metadata (0711 R3/R6)' });
                continue;
            }
            if (!isTerminalCheckpointStatus(meta.status)) {
                skipped.push({ name, reason: `non-terminal: status=${meta.status || 'unset'}` });
                continue;
            }
            if (meta.runId !== '' && activeRunIds.has(meta.runId)) {
                skipped.push({ name, reason: `active-run reference: ${meta.runId}` });
                continue;
            }
            const ageMs = Number.isFinite(Date.parse(meta.updatedAt)) ? Date.parse(meta.updatedAt) : mtimeMs;
            if (ageMs >= cutoffMs) {
                skipped.push({ name, reason: 'not expired: within retention window' });
                continue;
            }
            const entry: ReclaimedCheckpoint = {
                name,
                path,
                age: new Date(ageMs).toISOString(),
            };
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
        return { retentionDays, dryRun, reclaimed, skipped, failures };
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
        const db = await this.ctx.getDb();
        const dao = new RunDao(db);
        const before = await dao.traceRowById(runId);
        if (!before) {
            return { runId, finalized: false, status: 'not_found', killed: false };
        }
        // Only a non-terminal run has a live subprocess worth killing — paused and
        // interrupted workers stay alive too (they are resumable), so they count.
        // Read the pid before finalizing; a terminal run is never signalled (1048).
        const isNonTerminal =
            before.status === 'running' ||
            before.status === 'pending' ||
            before.status === 'paused' ||
            before.status === 'interrupted';
        const pid = isNonTerminal ? await dao.getPid(runId) : null;
        const killed = pid != null ? signalSubprocess(pid) : false;
        // Explicit-cancellation owner (1048 R2): the conditional write covers exactly
        // the resumable statuses, so a run that became terminal between the lookup
        // and this write is left untouched — no clobbered terminal metadata.
        await dao.cancelRun(runId);
        const after = await dao.traceRowById(runId);
        // cancelRun's WHERE guard only transitions resumable runs; if the run was
        // already terminal (or raced to terminal), status is unchanged and finalized
        // is false. A pre-existing `failed` row also stays untouched.
        const finalized = after?.status === 'failed' && isNonTerminal;
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
    async continuePaused(runId: string, opts?: ContinuePausedOptions): Promise<WorkflowRunResult> {
        // Same dual-bus wiring as run() (task 0370): adapter verb-form events via
        // observabilityBus inside createEngineService, engine-native names via the
        // resume options `events` field. CLI attaches a SystemEventDao tap to both.
        const eventsBus = this.ctx.events?.();
        // Locate the paused run via RunDao (no engine service needed yet) so the
        // workflow def is available for extension loading (0533 R1/R4).
        // 0901 R2: interrupted runs are resumable too (engine 0.5.0 reclaims
        // ownership via CAS; paused defaults to skip-enter, interrupted to
        // rerun-enter) — the engine is the authority on resumability.
        const row = await new RunDao(await this.ctx.getDb()).traceRowById(runId);
        if (row?.status !== 'paused' && row?.status !== 'interrupted') {
            throw new Error(
                `Run "${runId}" is not resumable (status: ${row?.status ?? 'missing'}) - only paused or interrupted runs can be continued.`,
            );
        }

        // Parse persisted metadata FIRST (0784 R1): the recorded launch source
        // decides how the definition is resolved, before any name-based lookup.
        let rawMeta: Record<string, unknown> = {};
        try {
            rawMeta = JSON.parse(row.metadata_json || '{}');
        } catch {
            rawMeta = {};
        }
        const warnings: string[] = [];
        const emitWarning = (message: string): void => {
            warnings.push(message);
            // Best-effort human visibility; a sink failure must not block resume.
            try {
                this.ctx.warn?.(message);
            } catch {
                // Warning delivery cannot change resume semantics.
            }
        };

        // 0784 R1/R2: honor the recorded launch source (shared with pendingGate,
        // 0932, so gate inspection and resume agree on the launch identity).
        const pinned = this.pinnedLaunchSource(runId, rawMeta);

        // Launch workdir grounds checkpoint artifacts, git freshness, and the
        // engine resume snapshot (0784 R3) — never the ambient process cwd.
        const launchWorkdir = pinned?.workdir ?? this.ctx.cwd;

        // R5: Resume validates checkpoint freshness on the resume side (ADR-099).
        await this.validateResumeCheckpointFreshness(runId, row, launchWorkdir);

        // R1/R4 + 0784 R1/R2: resolve the launched definition. Shared with
        // pendingGate (0932) so the inspected gate is the gate a resume executes.
        const resolved = await this.resolveResumableDefinition(runId, row, pinned, emitWarning);

        // R3: Compare persisted definitionDigest against re-resolved definition.
        const persistedDigest = typeof rawMeta.definitionDigest === 'string' ? rawMeta.definitionDigest : null;
        // 0768 R1: a row's identity era is read from the PRESENCE of the
        // metadata.workflowVersion key — never by re-resolving today's definition.
        // Pre-0768 rows (no key) keep the null-digest skip; a post-0768 row with an
        // absent digest cannot be compared against any baseline, so resume is
        // refused outright — allowing it would silently resume unguarded forever.
        const identityStamped = 'workflowVersion' in rawMeta;
        const persistedVersion =
            identityStamped && (typeof rawMeta.workflowVersion === 'string' || rawMeta.workflowVersion === null)
                ? (rawMeta.workflowVersion as string | null)
                : undefined;
        if (identityStamped && persistedDigest === null) {
            throw new Error(
                `Cannot resume run "${runId}": workflow definition drift detected (identity-stamped run has no recorded definition digest, currently ${resolved.digest}). Resume refused.`,
            );
        }
        // R1 of 0433: inject the operator's HITL answer into resume vars so guard
        // re-evaluation sees the override, not the stale headless default. The
        // engine's resumeRun merges options.vars over the persisted snapshot
        // (caller overrides win - ts-dual-workflow-engine service.ts:127).
        // 0932 R2: the answer is validated against the pending gate HERE — before
        // the drift-consent and stale-consent metadata writes below — so a rejected
        // answer never mutates the run record (R2: no status, var or metadata
        // change). The engine re-checks defensively inside resumeRun's ownership
        // claim window, closing the inspect-vs-resume race.
        const resumeVars: Record<string, string> = await this.resolveResumeAnswerVars(runId, opts);
        if (persistedDigest !== null && persistedDigest !== resolved.digest) {
            if (opts?.allowDigestMismatch !== true && opts?.force !== true) {
                const prompt = `Workflow definition drift detected for run "${runId}": launched with ${persistedDigest}, currently ${resolved.digest}. Continue with modified definition?`;
                const answer = await this.ctx.hitlResponder().respond({
                    kind: 'confirm',
                    prompt,
                    runId,
                    node: 'continue',
                });
                if (answer.value !== 'yes') {
                    throw new Error(
                        `Cannot resume run "${runId}": workflow definition drift detected (launched with ${persistedDigest}, currently ${resolved.digest}). Resume refused.`,
                    );
                }
            }
            // 0784 R2: consented drift is recorded and made visible — the launch
            // identity stays immutable, the executed identity is stamped alongside
            // it and carried into proof vars so mixed-definition execution cannot
            // masquerade as single-definition evidence.
            const db = await this.ctx.getDb();
            await new RunDao(db).mergeMetadata(runId, {
                resumeDefinitionDigest: resolved.digest,
                resumeWorkflowVersion: workflowVersionLiteral(resolved.workflow),
            });
            emitWarning(
                `Consented definition drift on resume of run "${runId}": launched ${persistedDigest}, executing ${resolved.digest}; launch identity preserved, proof vars carry the executed digest.`,
            );
        } else if (
            ('resumeDefinitionDigest' in rawMeta || 'resumeWorkflowVersion' in rawMeta) &&
            (persistedDigest === null || persistedDigest === resolved.digest)
        ) {
            // 0784 R2: an earlier consented drift no longer applies — clear the
            // stale resume identity so diagnostics stay truthful.
            const db = await this.ctx.getDb();
            await new RunDao(db).mergeMetadata(runId, {
                resumeDefinitionDigest: null,
                resumeWorkflowVersion: null,
            });
        }

        const svc = await this.createEngineService({
            events: eventsBus,
            extensions: { workflow: resolved.workflow, file: resolved.path },
            ...(opts?.recordSelfPid === true ? { recordSelfPid: true } : {}),
        });
        const workflow = resolved.workflow;
        // 0784 R2: on consented drift the executed digest overrides the proof
        // binding var (__definitionDigest) for this resume only. (Answer vars were
        // resolved and validated above, before any metadata mutation.)
        if (persistedDigest !== null && persistedDigest !== resolved.digest && 'resumeDefinitionDigest' in rawMeta) {
            resumeVars.__definitionDigest = resolved.digest;
        }
        const result = await svc.resumeRun(workflow, runId, {
            // 0784 R1/R3: resume inside the recorded launch workdir (legacy: the
            // ambient service cwd), never the ambient process cwd.
            workdir: launchWorkdir,
            ...(Object.keys(resumeVars).length > 0 ? { vars: resumeVars } : {}),
            ...(opts?.redactor !== undefined ? { redactor: opts.redactor } : {}),
            ...(opts?.resumeOwner !== undefined ? { resumeOwner: opts.resumeOwner } : {}),
            ...(eventsBus !== undefined
                ? {
                      // R3 (0601): engine-native resume events carry workflow identity;
                      // the retired action-boundary aliases are filtered out first (0869 R2).
                      events: withWorkflowIdentity(
                          dropRetiredActionBoundaryAliases(bridgeEventBus(eventsBus)),
                          workflow,
                      ),
                  }
                : {}),
        });
        await this.stampFailureReason(runId, result);
        const runResult = result as WorkflowRunResult;
        // 0768 R1: echo the run's PERSISTED identity (not the re-resolved one) so
        // callers see what the run was launched with; version stays absent for
        // pre-0768 rows (unknown legacy identity).
        runResult.definitionDigest = persistedDigest;
        if (persistedVersion !== undefined) runResult.version = persistedVersion;
        // 0784 R2: surface degraded/consented-drift resume diagnostics.
        if (warnings.length > 0) (runResult as Record<string, unknown>).warnings = warnings;
        return runResult;
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
        const db = await this.ctx.getDb();
        const row = await new RunDao(db).traceRowById(runId);
        if (row?.status !== 'paused' && row?.status !== 'interrupted') return null;
        let rawMeta: Record<string, unknown> = {};
        try {
            rawMeta = JSON.parse(row.metadata_json || '{}');
        } catch {
            rawMeta = {};
        }
        const pinned = this.pinnedLaunchSource(runId, rawMeta);
        // Inspection is silent: the legacy name-only warning stays owned by the
        // resume path, which surfaces it when the resume actually proceeds.
        const resolved = await this.resolveResumableDefinition(runId, row, pinned, () => {});
        const projection = await projectWorkflowProgress(runId, {
            db,
            projectRoot: this.ctx.cwd,
            workflowDef: resolved.workflow,
        });
        const stateId = projection.currentState;
        if (stateId === null) return null;
        const site = gateSitesForState(resolved.workflow, stateId)[0];
        if (site === undefined) return null;
        return {
            stateId,
            kind: site.kind as GateActionKind,
            answerVar: hitlAnswerVar(site.kind, site.options),
        };
    }

    /**
     * Parse a run's persisted `definitionSource` metadata into a pinned launch
     * source (0784 R1). A present-but-malformed record throws — resuming (or
     * inspecting, 0932) a run must never silently degrade to legacy name lookup.
     */
    private pinnedLaunchSource(runId: string, rawMeta: Record<string, unknown>): RunDefinitionSource | null {
        const rawSource: unknown = rawMeta.definitionSource;
        if (rawSource === undefined) return null;
        if (rawSource === null || typeof rawSource !== 'object' || Array.isArray(rawSource)) {
            throw new Error(
                `Cannot resume run "${runId}": recorded definitionSource metadata is malformed (expected {path, layer, workdir}). Resume refused.`,
            );
        }
        const candidate = rawSource as Record<string, unknown>;
        const sourcePath = candidate.path;
        const sourceWorkdir = candidate.workdir;
        // 0819 R4: the layer vocabulary is project|registered|shared; a pre-rename row
        // carrying the legacy `bundled` alias still resumes and reads as `shared`.
        const sourceLayer = normalizePersistedWorkflowLayer(candidate.layer);
        if (
            typeof sourcePath !== 'string' ||
            sourcePath === '' ||
            sourceLayer === null ||
            typeof sourceWorkdir !== 'string' ||
            sourceWorkdir === ''
        ) {
            throw new Error(
                `Cannot resume run "${runId}": recorded definitionSource metadata is malformed (expected an absolute path, a project|registered|shared layer — legacy "bundled" accepted — and a workdir). Resume refused.`,
            );
        }
        return { path: sourcePath, layer: sourceLayer, workdir: sourceWorkdir };
    }

    /**
     * Resolve the definition a resume of this run would execute (0784 R1/R2).
     * With a recorded source, verify the file still exists BEFORE invoking the
     * resolver so a deleted source can never silently resolve a same-named
     * replacement; require resolution to land exactly on the recorded path.
     * Without one, retain legacy name-only lookup with an explicit
     * degraded-identity warning. Shared by `continuePaused` (resume) and
     * `pendingGate` (read-only gate inspection, 0932) so both walk the same
     * definition.
     */
    private async resolveResumableDefinition(
        runId: string,
        row: { workflow_name: string },
        pinned: RunDefinitionSource | null,
        emitWarning: (message: string) => void,
    ): Promise<ResolvedWorkflowDefinition> {
        if (pinned !== null) {
            const fs = createNodeFileSystem();
            if (!fs.exists(pinned.path)) {
                throw new Error(
                    `Cannot resume run "${runId}": recorded launch source "${pinned.path}" no longer exists. Repair the source or start a new run; name-based fallback is refused.`,
                );
            }
            const resolved = await resolveWorkflowDefinition(pinned.workdir, pinned.path, {
                validateSchema: true,
                embeddedSchemas: this.ctx.embeddedSchemas?.(),
            });
            if (resolved.path !== pinned.path) {
                throw new Error(
                    `Cannot resume run "${runId}": definition resolved to "${resolved.path}" instead of the recorded launch source "${pinned.path}". Resume refused.`,
                );
            }
            return resolved;
        }
        let resolved: ResolvedWorkflowDefinition;
        try {
            resolved = await resolveWorkflowDefinition(this.ctx.cwd, row.workflow_name, {
                validateSchema: true,
                embeddedSchemas: this.ctx.embeddedSchemas?.(),
                registered: registeredWorkflowPaths(this.ctx.spurConfig ?? null),
            });
        } catch {
            throw new Error(
                `Cannot resume run "${runId}": workflow definition "${row.workflow_name}" not found in the workflow search paths.`,
            );
        }
        emitWarning(
            `Run "${runId}" resumed by workflow name "${row.workflow_name}" (no recorded launch source — pre-source-pin run); identity checks run against the name-resolved definition.`,
        );
        return resolved;
    }

    /**
     * 0932 R1/R2: validate the operator's answer flags against the gate the run
     * is actually paused on, then build the resume vars that inject the answer.
     * Called BEFORE `svc.resumeRun`, so a rejected call never reaches the
     * resume-ownership claim and mutates nothing.
     *
     * - `--answer-text` (free text, R1) requires a pending `hitl.input` gate;
     *   the text is stored verbatim under the gate's answer var (`options.var`,
     *   else `__hitlInput`) and an empty string is rejected.
     * - `--answer` (yes|no|cancel) requires a pending `hitl.confirm` or
     *   `hitl.select` gate and lands in the gate's answer var — no longer the
     *   hard-coded `__hitlAnswer` (R2).
     * - Both flags together are rejected; a kind mismatch throws the typed
     *   `ValidationError` every transport maps to `VALIDATION_FAILED`.
     * - A resumable run with no pending gate action (for example `interrupted`)
     *   has no gate contract to match and resumes exactly as before, with the
     *   legacy var defaults.
     * - `hitlVar` stays an explicit override for tests: it names the var
     *   directly and skips the gate-kind check.
     */
    private async resolveResumeAnswerVars(
        runId: string,
        opts?: ContinuePausedOptions,
    ): Promise<Record<string, string>> {
        const resumeVars: Record<string, string> = {};
        const answerText = opts?.answerText;
        const hitlAnswer = opts?.hitlAnswer;
        if (answerText !== undefined && hitlAnswer !== undefined) {
            throw new ValidationError(
                'Pass either --answer <yes|no|cancel> or --answer-text <text>, not both (0932 R2).',
            );
        }
        if (answerText !== undefined) {
            if (answerText === '') {
                throw new ValidationError('--answer-text must be a non-empty string (0932 R1).');
            }
            const gate = await this.pendingGate(runId);
            if (gate !== null && gate.kind !== 'hitl.input') {
                throw new ValidationError(pendingGateMismatchMessage(runId, gate, '--answer-text'));
            }
            resumeVars[opts?.hitlVar ?? gate?.answerVar ?? hitlAnswerVar('hitl.input', undefined)] = answerText;
            return resumeVars;
        }
        if (hitlAnswer !== undefined) {
            const gate = await this.pendingGate(runId);
            if (gate !== null && gate.kind !== 'hitl.confirm' && gate.kind !== 'hitl.select') {
                throw new ValidationError(pendingGateMismatchMessage(runId, gate, '--answer'));
            }
            resumeVars[opts?.hitlVar ?? gate?.answerVar ?? hitlAnswerVar('hitl.confirm', undefined)] = hitlAnswer;
        }
        return resumeVars;
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

    /**
     * Validate checkpoint freshness on resume (task 0752 / R5 / ADR-099; reworked
     * by 0784 R3). For every checkpoint associated with the resumed run: accept
     * pending/running/approved as the nonterminal advisory projections of a paused
     * engine run (consumer-local mapping — no new persisted enum), then validate
     * workflow/WBS ownership, current HEAD (probed in the launch workdir only when
     * the checkpoint participates in commit tracking) and workdir-resolved artifact
     * existence. Missing/unreadable git freshness is a named refusal, never an
     * empty-string fallback. A missing checkpoint is a supported engine-only resume.
     */
    private async validateResumeCheckpointFreshness(
        runId: string,
        row: { id: string; workflow_name: string; status: string; metadata_json?: string },
        workdir: string,
    ): Promise<void> {
        const sessionsDir = join(workdir, '.spur', 'memory', 'sessions');
        const fs = createNodeFileSystem();
        let entries: string[];
        try {
            entries = (await fs.readDir(sessionsDir)).filter((name) => name.endsWith('.md'));
        } catch {
            return;
        }

        let rawMeta: Record<string, unknown> = {};
        try {
            rawMeta = JSON.parse(row.metadata_json || '{}');
        } catch {
            rawMeta = {};
        }
        const wbs = typeof rawMeta.wbs === 'string' ? rawMeta.wbs : undefined;

        // HEAD is probed lazily (first commit-tracking checkpoint) and cached; a
        // probe failure is a refusal, never an empty-string fallback (0784 R3).
        const executor = this.ctx.processExecutor?.() ?? new NodeProcessExecutor();
        let head: string | null = null;
        const resolveHead = async (): Promise<string> => {
            if (head !== null) return head;
            const probe = await executor.run({
                command: 'git',
                args: ['rev-parse', 'HEAD'],
                cwd: workdir,
                forceBuffered: true,
                rejectOnError: false,
            });
            if (probe.exitCode !== 0 || probe.stdout.trim() === '') {
                throw new Error(
                    `Cannot resume run "${runId}": checkpoint freshness requires the launch workdir's git HEAD, but "git rev-parse HEAD" failed in "${workdir}". Refusing rather than skipping the commit-drift check.`,
                );
            }
            head = probe.stdout.trim();
            return head;
        };

        for (const name of entries) {
            const filePath = join(sessionsDir, name);
            let raw: string;
            try {
                raw = await fs.readFile(filePath);
            } catch {
                continue;
            }
            const meta = parseCheckpointMetadata(raw);
            if (meta === null) {
                if (raw.includes(`run_id: "${runId}"`) || raw.includes(`run_id: ${runId}`)) {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (malformed: not canonical checkpoint metadata).`,
                    );
                }
                continue;
            }

            const isForThisRun =
                meta.runId === runId ||
                (wbs !== undefined && meta.taskWbs === wbs && (meta.runId === '' || meta.runId === runId));

            if (isForThisRun) {
                if (meta.workflow !== '' && meta.workflow !== row.workflow_name) {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (workflow-mismatch: checkpoint workflow "${meta.workflow}" != "${row.workflow_name}").`,
                    );
                }
                // 0784 R3: consumer-local status mapping. The persisted run row is
                // authoritative; a checkpoint's status is advisory and must project
                // a nonterminal engine state for the resume to proceed.
                if (meta.status === '') {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (status-missing: checkpoint carries no status).`,
                    );
                }
                if (isTerminalCheckpointStatus(meta.status)) {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (terminal: status=${meta.status}).`,
                    );
                }
                if (meta.status !== 'pending' && meta.status !== 'running' && meta.status !== 'approved') {
                    throw new Error(
                        `Cannot resume run "${runId}": checkpoint is stale (unknown checkpoint status "${meta.status}" — expected pending/running/approved).`,
                    );
                }
                const staleness = checkpointStaleness(meta, {
                    ...(wbs !== undefined ? { taskWbs: wbs } : {}),
                    ...(meta.sourceCommit === '' ? {} : { sourceCommit: await resolveHead() }),
                    artifactExists: (p: string) => fs.exists(isAbsolute(p) ? p : join(workdir, p)) as boolean,
                });
                if (staleness.stale) {
                    throw new Error(`Cannot resume run "${runId}": checkpoint is stale (${staleness.reason}).`);
                }
            }
        }
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
        const layers = workflowLayers({ cwd: this.ctx.cwd, registered: workflowPaths });
        const entries: WorkflowListEntry[] = [];

        for (const layer of layers) {
            try {
                const found = await scanWorkflowFiles(layer.path, layer.id, (filePath) => this.loadListEntry(filePath));
                entries.push(...found);
            } catch {
                // Directory doesn't exist — skip gracefully (the layer stays listed).
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

    /**
     * Bounded run-record inspection for the Board run detail (0929 R1/R2) —
     * the confined, redacted, bounded read over this project's `.spur/run`
     * directory. Read-only; the DB trace remains the lifecycle authority.
     */
    inspectRunRecord(runId: string): WorkflowRunRecordInspection {
        return inspectWorkflowRunRecord(resolveRunRecordDir(this.ctx.cwd, runId), runId, {
            secretValues: this.ctx.secretValues,
        });
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
            entries: rows.map((row) => rowToTraceEntry(row, this.ctx.cwd)),
            total: rows.length,
        };
    }

    private async traceRun(db: DbAdapter, runId: string): Promise<WorkflowTraceTimeline> {
        const runDao = new RunDao(db);
        const row = await runDao.traceRowById(runId);
        if (!row) throw new Error(`Run not found: ${runId}`);
        const run = rowToTraceEntry(row, this.ctx.cwd);

        const phaseRows = await new PhaseRunDao(db).phaseRowsByRunId(runId);
        const transitionRows = await new TransitionRunDao(db).transitionRowsByRunId(runId);
        const actionRows = await new ActionRunDao(db).actionRowsByRunId(runId);

        // Pre-compute per-step cost for agent.run actions via the run→session mapping
        // (task 0559): `history_run_session` maps the run to (source, session_id) pairs,
        // and `history_message` typed token columns are folded per mapping — exact and
        // estimated figures separately, never summed (R2). No dollar value is computed (R3).
        const costByActionId = new Map<string, ActionCostAttribution>();
        if (actionRows.some((a) => a.kind === 'agent.run')) {
            for (const a of actionRows) {
                if (a.kind !== 'agent.run') continue;
                try {
                    costByActionId.set(a.id, await attributeActionCost(db, runId, a));
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
                events.push({
                    kind: 'transition',
                    from: t.from_state,
                    to: t.to_state,
                    trigger: t.trigger,
                    at: persistedTimestamp(t.created_at),
                });
            } else {
                const a = actionRows[ai++] as AR;
                const duration = a.duration_ms !== null ? `${a.duration_ms}ms` : '';
                const ok = a.ok === null ? null : a.ok === 1;
                const label = a.status === 'running' ? ' (in-flight)' : ok === true ? ' ✓' : ' ✗';
                const result = projectActionTraceResult(a.result_json, this.ctx.secretValues);
                const partialArtifact = await partialArtifactForAction(this.ctx.cwd, runId, a.node, ok);
                const artifacts = partialArtifact === undefined ? [] : [partialArtifact];
                events.push({
                    kind: 'action',
                    actionId: a.id,
                    node: a.node,
                    actionKind: a.kind,
                    status: a.status,
                    duration: duration,
                    durationMs: a.duration_ms,
                    startedAt: a.started_at === null ? null : traceTimestamp(a.started_at),
                    completedAt: a.completed_at === null ? null : traceTimestamp(a.completed_at),
                    ok,
                    outcome: actionOutcome(a.status, ok),
                    result: result.result,
                    invocation: result.invocation,
                    decision: result.decision,
                    error: result.error,
                    artifacts,
                    ...(partialArtifact !== undefined
                        ? { nextAction: { label: 'Inspect partial work', kind: 'path', value: partialArtifact } }
                        : {}),
                    label: label,
                    cost: costByActionId.get(a.id),
                } as TimelineEvent);
            }
        }

        const outputArtifact = await outputArtifactForRun(this.ctx.cwd, runId);
        run.nextAction = traceNextAction(run, outputArtifact);
        return {
            run,
            events,
            ...(outputArtifact !== undefined ? { outputArtifact } : {}),
        };
    }

    /**
     * Resolve one workflow file for `list` through the SAME shared resolver as
     * show/run/resume (0768 R1), so a valid entry carries the identity a run of
     * it would stamp: version (literal or null) + canonical definition digest.
     * On resolution failure the light-parse name/kind are kept best-effort for
     * the invalid entry, with the resolver's error message — no invented valid
     * identity.
     */
    private async loadListEntry(filePath: string): Promise<WorkflowListEntryIdentity> {
        try {
            const resolved = await resolveWorkflowDefinition(this.ctx.cwd, filePath, {
                validateSchema: true,
                embeddedSchemas: this.ctx.embeddedSchemas?.(),
            });
            return {
                name: resolved.workflow.name,
                kind: resolved.workflow.kind ?? 'state-machine',
                valid: true,
                version: workflowVersionLiteral(resolved.workflow),
                definitionDigest: resolved.digest,
                description: typeof resolved.workflow.description === 'string' ? resolved.workflow.description : null,
            };
        } catch (error) {
            const meta = await extractWorkflowMeta(filePath);
            return {
                name: meta.name,
                kind: meta.kind,
                valid: false,
                error: error instanceof Error ? error.message : String(error),
                description: null,
            };
        }
    }

    /**
     * Record the async run's plan artifact path in run metadata (0768 R2). The
     * artifact itself is written by the CLI launcher before the worker starts;
     * this stamps the pointer so trace/progress can surface it. Best-effort:
     * the worker has already been spawned, so a metadata failure must not undo
     * a registered run.
     */
    async stampPlanArtifactPath(runId: string, planArtifactPath: string): Promise<void> {
        const db = await this.ctx.getDb();
        await new RunDao(db).mergeMetadata(runId, { planArtifactPath });
    }

    private async createEngineService(
        opts: {
            recordSelfPid?: boolean;
            events?: EventBus<Record<string, (event: unknown) => void>>;
            steeringController?: WorkflowSteeringController;
            /** Workflow def + source file to load YAML extensions from (0533 R1). */
            extensions?: { workflow: WorkflowDef; file: string };
            /** Resolved launch source recorded with the run identity (0784 R1). */
            definitionSource?: RunDefinitionSource;
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
        // A5/ADR-082: the merged config is threaded on the context — no per-slice load.
        // 0799 R3: the launch boundary prefers a fresh merged config so a quota
        // event applied by the updater gates this workflow run immediately.
        const agent =
            this.ctx.reloadAgentConfig !== undefined
                ? (await this.ctx.reloadAgentConfig())?.agent
                : this.ctx.spurConfig?.agent;
        agentSlice = {
            ...agentSlice,
            ...(agent?.default !== undefined ? { default: agent.default } : {}),
            ...(agent?.sessionAffinity !== undefined ? { sessionAffinity: agent.sessionAffinity } : {}),
        };
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
        // 0942/ADR-126: the fleet executor surface deps — composed from the same ctx
        // slice the CLI threads (A5/ADR-082). Both services are cheap and lazy (the DB
        // opens on first use); selecting the surface still requires the run var, so an
        // engine host that never opts in keeps today's dispatch behavior byte-for-byte.
        const fleetFs = createNodeFileSystem(this.ctx.cwd);
        const fleetCoordination = new AgentCoordinationService({
            cwd: this.ctx.cwd,
            env: getEnvVars(),
            ...(this.ctx.spurConfig !== undefined ? { spurConfig: this.ctx.spurConfig } : {}),
            ...(this.ctx.reloadAgentConfig !== undefined ? { reloadAgentConfig: this.ctx.reloadAgentConfig } : {}),
            getDb: () => this.ctx.getDb(),
            fs: fleetFs,
            ...(bus !== undefined ? { eventBus: bus as unknown as CoordinationEventBus } : {}),
        });
        const fleetDispatchDeps: FleetDispatchDeps = {
            fleet: new FleetService({
                fs: fleetFs,
                ...(this.ctx.spurConfig !== undefined ? { spurConfig: this.ctx.spurConfig } : {}),
                ...(this.ctx.reloadAgentConfig !== undefined ? { reloadAgentConfig: this.ctx.reloadAgentConfig } : {}),
                openDb: () => this.ctx.getDb(),
            }),
            // G71 R1/R5: the one fleet dispatch primitive — the stage adapter resolves
            // the role + prompt and hands the enqueue and receipt wait to this.
            dispatcher: new FleetDispatcher({
                coordination: fleetCoordination,
                // Lazy: the workflow ctx opens its DB asynchronously, so resolve the
                // adapter per receipt read rather than at composition time.
                runs: {
                    listByMessageId: async (messageId: string) =>
                        new CoordinationRunDao(await this.ctx.getDb()).listByMessageId(messageId),
                },
            }),
            now: () => Date.now(),
        };
        registerSpurBuiltins(host, {
            agentService: this.ctx.agentService(),
            ruleService: this.ctx.ruleService(),
            hitlResponder: this.ctx.hitlResponder(),
            decisionEvaluator: this.buildDecisionEvaluator(bus),
            httpRequester: this.ctx.httpRequester?.(),
            hostAllowlist: this.ctx.hostAllowlist?.(),
            ...(bus !== undefined ? { observabilityBus: bus } : {}),
            ...(processExec !== undefined ? { processExecutor: processExec } : {}),
            ...(opts.steeringController !== undefined ? { steeringController: opts.steeringController } : {}),
            agentConfig: agentSlice,
            getDb: () => this.ctx.getDb(),
            // 0941 R4: decide degrades to its declared default unless the config switch is on.
            decideDecisionMaker: this.ctx.spurConfig?.workflow?.decideDecisionMaker === true,
            // 0941 R4: the backend comes from existing DecisionMaker config when the composition root supplies one.
            ...(this.ctx.decisionMaker !== undefined ? { decideMaker: this.ctx.decisionMaker } : {}),
            // 0942/ADR-126: the fleet executor surface for `agent.run`.
            fleetDispatchDeps,
            // 0901 R5: configured secrets redact streamed shell output at the
            // emission boundary (bus → CLI logs + system-event ledger).
            ...(this.ctx.secretValues !== undefined ? { secretValues: this.ctx.secretValues } : {}),
        });
        // 0533 R1/R4: register YAML-declared extensions (actions/guards) on the
        // same host run/continue use, before the service is constructed. The
        // shared loader validates relative paths (abs/`..` rejected) and fails
        // closed on a missing or mis-shaped module — before any workflow step.
        if (opts.extensions !== undefined) {
            await this.loadWorkflowExtensions(host, opts.extensions.workflow, opts.extensions.file);
        }
        const db = await this.ctx.getDb();
        // ADR-117 / task 0868: the action-boundary emission is best-effort through the
        // SAME writer the inline driver calls — a persistence failure is recorded to the
        // run log and never wedges the run. The run-row closure (`finalizeRun`) is NOT
        // best-effort: it propagates, so the engine's terminal closure fails loudly as it
        // did before the writer. Pure pass-through otherwise, so engine behavior is
        // unchanged on success.
        let persistence: WorkflowPersistenceAdapter = withActionTrace(
            new DbWorkflowPersistenceAdapter(db),
            createRunLogTraceFailureRecorder(this.ctx.cwd),
        );
        // Async worker: stamp this process's pid onto the run row at creation so
        // `spur workflow cancel` can SIGTERM the live process group.
        if (opts.recordSelfPid === true) {
            persistence = withSelfPidRecording(persistence, db);
        }
        if (opts.extensions !== undefined) {
            // 0768 R1: one identity merge (digest + version literal) at run creation;
            // a merge failure propagates and aborts the run before any action runs.
            // 0784 R1: launch sites additionally pin path/layer/workdir in the same
            // statement so resume can replay the launched definition exactly.
            persistence = withRunIdentityRecording(persistence, db, {
                definitionDigest: computeDefinitionDigest(opts.extensions.workflow),
                workflowVersion: workflowVersionLiteral(opts.extensions.workflow),
                ...(opts.definitionSource !== undefined ? { source: opts.definitionSource } : {}),
            });
        }
        const adapter = bus
            ? new ObservableWorkflowAdapter(
                  persistence,
                  // R3 (0601): decorate the observability bus with workflow identity so
                  // every adapter event carries workflowName + nodeLabel. The def is
                  // available here via the extension registration seam (0533).
                  opts.extensions !== undefined ? withWorkflowIdentity(bus, opts.extensions.workflow) : bus,
              )
            : persistence;
        return new EngineWorkflowService(host, adapter);
    }

    /**
     * Application decision evaluator for explicit never/evidence HITL modes (0911). Composes the
     * merged-config activation switch, action-evidence DAO, optional provider factory, configured
     * secrets and the registered-summary artifact resolver. `bus` is the run's observability bus:
     * evidence-mode operator gates decide through the catalog service (1099) and its lifecycle
     * events flow on the same bus with caller `gate`.
     */
    private buildDecisionEvaluator(bus?: WorkflowObservabilityBus): DecisionEvaluator {
        const summary: SummaryResolver = {
            resolve: async (runId, path) => {
                const fs = createNodeFileSystem(this.ctx.cwd);
                let canonicalPath: string | undefined;
                for (const root of ['scratch', 'runs', 'evidence'] as const) {
                    try {
                        canonicalPath =
                            root === 'scratch'
                                ? await resolveRunArtifactPath(fs, this.ctx.cwd, path)
                                : await resolveDurableArtifactPath(fs, this.ctx.cwd, path, root);
                        break;
                    } catch {
                        /* Try the other owned plane; each enforces physical confinement. */
                    }
                }
                if (canonicalPath === undefined) return { ok: false, reason: 'invalid-evidence' };
                const dao = new ArtifactDao(await this.ctx.getDb());
                const registered = await dao.artifactsWithIdByRunId(runId);
                let match = registered.find((row) => row.path === canonicalPath);
                if (match === undefined) {
                    const source = relative(fs.realPath?.(this.ctx.cwd) ?? this.ctx.cwd, canonicalPath);
                    for (const row of registered) {
                        try {
                            const retained = await resolveDurableArtifactPath(fs, this.ctx.cwd, row.path, 'runs');
                            const identity = await resolveDurableArtifactPath(
                                fs,
                                this.ctx.cwd,
                                `${row.path}.source`,
                                'runs',
                            );
                            if ((await fs.readFile(identity)) !== source) continue;
                            canonicalPath = retained;
                            match = row;
                            break;
                        } catch {
                            /* An unproven source cannot satisfy registered-summary evidence. */
                        }
                    }
                }
                if (match === undefined) return { ok: false, reason: 'invalid-evidence' };
                let raw: string;
                try {
                    raw = await fs.readFile(canonicalPath);
                } catch {
                    return { ok: false, reason: 'invalid-evidence' };
                }
                return { ok: true, artifactId: match.id, raw };
            },
        };
        return {
            evaluate: (request, config) =>
                evaluateDecision(request, config, {
                    enabled: this.ctx.spurConfig?.workflow?.hitlDecisionMaker === true,
                    evidence: async (request) =>
                        new ActionRunDao(await this.ctx.getDb()).actionRowsByRunId(request.runId),
                    decisionMaker: this.ctx.decisionMaker,
                    secrets: this.ctx.secretValues,
                    warn: this.ctx.warn,
                    summary,
                    // 1099: evidence-mode confirm gates decide through the catalog decision
                    // `gate-evidence` (same construction the `decision` CLI serves).
                    decisionService: () => getDecisionService(this.ctx.spurConfig ?? null, this.ctx.cwd),
                    // Task 1113 R3: gate events join the run — workflowName from the run
                    // row, wbs from the snapshot's effective vars (never throws).
                    runCorrelation: async (runId) =>
                        loadRunCorrelation(new DbWorkflowPersistenceAdapter(await this.ctx.getDb()), runId),
                    // SAFETY: WorkflowObservabilityBus and SystemEventBus are nominal names over
                    // one structural ts-infra EventBus instance (ADR-044 event bridge), decide.ts.
                    ...(bus !== undefined ? { bus: bus as unknown as SystemEventBus } : {}),
                }),
        };
    }

    /**
     * Load YAML-declared `extensions.actions` / `extensions.guards` modules onto a
     * workflow host (0533 R1). Paths are resolved against the workflow file's own
     * directory; the shared loader rejects absolute paths and `..` traversal and
     * fails closed when a module is missing or lacks the declared capability.
     * The YAML declaration itself is the allowExtensions signal (R3) — a listed
     * extension is always loaded, never silently dropped.
     */
    private async loadWorkflowExtensions(host: WorkflowEngineHost, workflow: WorkflowDef, file: string): Promise<void> {
        const refs = collectWorkflowExtensions(workflow.name, dirname(file), workflow.extensions);
        if (refs.length === 0) return;
        const nodeFs = createNodeFileSystem();
        await loadWorkflowExtensionsIntoHost(host, refs, {
            allowExtensions: true,
            moduleLoader: async (absPath) => (await import(absPath)) as Record<string, unknown>,
            realPath: (absPath) => (nodeFs.realPath ? nodeFs.realPath(absPath) : absPath),
        });
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * A definition's public version identity (0768): the declared non-empty
 * `version` literal, or `null` for a known-unversioned definition. `undefined`
 * is reserved for pre-0768 rows with no recorded identity and is never derived
 * from a definition.
 */
export function workflowVersionLiteral(workflow: WorkflowDef): string | null {
    return typeof workflow.version === 'string' && workflow.version !== '' ? workflow.version : null;
}

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

/**
 * 0932 R2: the rejection message for an answer flag that does not match the
 * gate the run is actually paused on — it names the pending gate kind and state.
 */
function pendingGateMismatchMessage(
    runId: string,
    gate: PendingGate | null,
    flag: '--answer' | '--answer-text',
): string {
    const pending =
        gate === null
            ? 'the run has no pending gate action'
            : `the run is paused at state "${gate.stateId}" on a ${gate.kind} gate`;
    const requires =
        flag === '--answer-text'
            ? '--answer-text requires a pending hitl.input gate'
            : '--answer requires a pending hitl.confirm or hitl.select gate';
    return `Cannot resume run "${runId}": ${pending} — ${requires} (0932 R2). Resume refused; nothing was mutated.`;
}
async function fileExists(path: string): Promise<boolean> {
    const fs = createNodeFileSystem();
    return await fs.exists(path);
}

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

/**
 * Overlay caller `--vars` on a workflow's declared defaults (0948 R2).
 *
 * Omitted keys keep the definition default. An explicit empty string for a key
 * the definition already set to a non-empty value is a blanking override and is
 * rejected by name — a partial map must not silently empty `spurBin` or any
 * other declared var. Non-string declared values are ignored; workflow vars are
 * `Record<string, string>`.
 */
export function mergeWorkflowRunVars(
    declared: Record<string, unknown> | undefined,
    overrides: Record<string, string> | undefined,
): Record<string, string> {
    const base: Record<string, string> = {};
    if (declared !== undefined) {
        for (const [key, value] of Object.entries(declared)) {
            if (typeof value === 'string') base[key] = value;
        }
    }
    const user = overrides ?? {};
    const blanked = Object.keys(user).filter((key) => user[key] === '' && (base[key] ?? '') !== '');
    if (blanked.length > 0) {
        throw new Error(`--vars leaves declared vars unset: ${blanked.sort().join(', ')}`);
    }
    return { ...base, ...user };
}

// Re-exported from `workflow/run-record` (0962): that module owns the traversal guard that throws
// it, and the class must not create a run-record → service edge. The public surface is unchanged.
export { InvalidWorkflowRunIdError } from '../workflow/run-record';

/**
 * `--agent fleet` selects the fleet executor surface (task 0942, ADR-126). 'fleet' is
 * a surface, not an agent binary — left in `agent` it would never survive dispatch
 * resolution, so it maps to the `executor` run var and is dropped from the agent
 * ladder: the configured default executor then governs review/verify/implement if a
 * declared fallback (`executorFallback: traditional`) runs. Any other `--agent`
 * value, and explicit `--vars` `executor`, passes through untouched.
 */
function mapFleetExecutorVar(callerVars: Record<string, string> | undefined): Record<string, string> {
    if (callerVars?.agent !== 'fleet') return callerVars ?? {};
    const { agent: _agent, ...rest } = callerVars;
    return { ...rest, executor: 'fleet' };
}

/**
 * Resolve the `agent` / `implementAgent` run vars from `.spur/config.yaml`
 * `agent.default`, so the configured default executor reaches a workflow's
 * `agent.run` steps — including the implement hop, which previously read only the
 * pipeline's literal `implementAgent` (task 0485 R2).
 *
 * Returns an empty object — leaving the YAML default in force — when the caller
 * already chose both agents, when no `agent.default` is configured, or when config
 * cannot be read. Each key is injected independently: a caller-set `agent` does not
 * suppress `implementAgent`. When the configured default names none of a Layer-1 role,
 * a configured executor, or a canonical agent binary, one warning is emitted and nothing is
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
/**
 * Resolve default agent vars from the threaded config (A5/ADR-082) and caller
 * vars. Sync & pure: a load failure is already surfaced once at the composition
 * root; `config === null` degrades to empty (today's defaults).
 */
function resolveDefaultAgentVar(
    config: SpurConfig | null,
    callerVars: Record<string, string> | undefined,
    warn: (message: string) => void,
): Record<string, string> {
    const result: Record<string, string> = {};
    if (callerVars?.implementAgent === undefined && callerVars?.agent !== undefined) {
        result.implementAgent = callerVars.agent;
    }
    const configured = config?.agent?.default;
    if (typeof configured !== 'string' || configured.length === 0) {
        return result;
    }
    // Validate before injecting (AC3): accept iff the default names a Layer-1 role,
    // a configured executor, or a canonical agent binary. On mismatch, warn once and
    // inject nothing so the pipeline YAML literal governs instead of a dispatch-time
    // "Unknown agent" failure.
    //
    // The role branch is what task 0542 moved the value domain to: `config.example.yaml`
    // ships `agent.default: coder`, and `spur agent run --agent <role>` resolves
    // role -> tier -> cheapest usable executor. Without it, the recommended config value
    // was rejected here and every engine-driven `agent.run` silently fell back to the
    // pipeline YAML literal, defeating the whole role ladder.
    const valid =
        (AGENT_ROLE_NAMES as readonly string[]).includes(configured) ||
        config?.agent?.executors?.some((e) => e.name === configured) === true ||
        resolveAgentName(configured) !== undefined;
    if (!valid) {
        warn(
            `agent.default "${configured}" does not name a Layer-1 role, a configured executor, or an agent binary; leaving the pipeline's literal agent in force`,
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
 * Relative path to a run's human run record — `.spur/memory/runs/<runId>.md` for new
 * runs (E7 / task 0925), with the legacy `.spur/memory/runs/<runId>.log` (feature D2 /
 * task 0426) as a read-only fallback — for `run.artifact` metadata. The pair's
 * `.state.json` is intentionally not linked here; the DB trace stays the
 * completion authority (0925 R2/R3).
 */
async function outputArtifactForRun(cwd: string, runId: string): Promise<string | undefined> {
    const dir = resolveRunRecordDir(cwd, runId);
    for (const name of [`${runId}.md`, `${runId}.log`]) {
        const path = join(dir, name);
        if (await fileExists(path)) return relative(cwd, path);
    }
    return undefined;
}

/**
 * Walk a directory (following symlinks) for .yaml/.yml files and extract name + kind.
 * Gracefully skips unparseable files (adds them with valid=false + error message).
 */
/**
 * Per-file identity payload for `list`, produced by the shared resolver (0768 R1).
 */
type WorkflowListEntryIdentity = Pick<WorkflowListEntry, 'name' | 'kind' | 'valid' | 'description'> &
    Partial<Pick<WorkflowListEntry, 'error' | 'version' | 'definitionDigest'>>;

async function scanWorkflowFiles(
    rootPath: string,
    source: WorkflowLayerId,
    loadEntry: (filePath: string) => Promise<WorkflowListEntryIdentity>,
): Promise<WorkflowListEntry[]> {
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
                const entry = await loadEntry(fullPath);
                entries.push({ ...entry, path: displayPath, source });
            }
        }
    }

    await walk(realPath);
    return entries;
}

/** Parse a workflow YAML file to extract name and kind. Returns partial entry on failure. */
async function extractWorkflowMeta(
    filePath: string,
): Promise<Pick<WorkflowListEntry, 'name' | 'kind' | 'valid' | 'error' | 'description'>> {
    try {
        const fs = createNodeFileSystem();
        const text = await fs.readFile(filePath);
        const parsed = parseYamlObject(text);
        if (typeof parsed !== 'object' || parsed === null) {
            return {
                name: '<unparseable>',
                kind: 'unknown',
                valid: false,
                error: 'Top-level value is not an object',
                description: null,
            };
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
                description: null,
            };
        }
        return {
            name: wfName,
            kind: typeof wfKind === 'string' ? wfKind : 'state-machine',
            valid: true,
            description: null,
        };
    } catch (err) {
        return {
            name: '<unparseable>',
            kind: 'unknown',
            valid: false,
            error: err instanceof Error ? err.message : String(err),
            description: null,
        };
    }
}

// ---------------------------------------------------------------------------
// Trace helpers (not exported)
// ---------------------------------------------------------------------------

function rowToTraceEntry(
    row: {
        id: string;
        workflow_name: string;
        mode: string;
        status: string;
        started_at: string;
        completed_at: string | null;
        metadata_json: string;
        terminal_reason?: string | null;
    },
    cwd: string,
): WorkflowTraceEntry {
    let isDryRun = false;
    let failureReason: string | undefined;
    let version: string | null | undefined;
    let definitionDigest: string | undefined;
    let startState: string | undefined;
    let continuedFrom: string | undefined;
    try {
        const meta = JSON.parse(row.metadata_json);
        isDryRun = meta.dryRun === true;
        if (typeof meta.failureReason === 'string' && meta.failureReason !== '') {
            failureReason = meta.failureReason;
        }
        // 0768 R1: identity is surfaced only when actually recorded — the key's
        // presence separates post-0768 rows (version: literal|null) from legacy rows.
        if ('workflowVersion' in meta && (typeof meta.workflowVersion === 'string' || meta.workflowVersion === null)) {
            version = meta.workflowVersion as string | null;
        }
        if (typeof meta.definitionDigest === 'string' && meta.definitionDigest !== '') {
            definitionDigest = meta.definitionDigest;
        }
        // 1072 R7: start-state lineage, surfaced only when recorded.
        if (typeof meta.startState === 'string' && meta.startState !== '') {
            startState = meta.startState;
        }
        if (typeof meta.continuedFrom === 'string' && meta.continuedFrom !== '') {
            continuedFrom = meta.continuedFrom;
        }
    } catch {
        // metadata_json unparseable — treat as not dry-run
    }
    const entry: WorkflowTraceEntry = {
        runId: row.id,
        workflowName: row.workflow_name,
        mode: row.mode,
        status: row.status,
        startedAt: traceTimestamp(row.started_at),
        completedAt: row.completed_at === null ? null : traceTimestamp(row.completed_at),
        isDryRun,
        project: systemEventProjectContext(cwd),
        durationMs: durationBetween(row.started_at, row.completed_at),
        outcome: traceOutcome(row.status),
        ...(failureReason !== undefined ? { failureReason } : {}),
        ...(typeof row.terminal_reason === 'string' && row.terminal_reason !== ''
            ? { terminalReason: row.terminal_reason }
            : {}),
        ...(version !== undefined ? { version } : {}),
        ...(definitionDigest !== undefined ? { definitionDigest } : {}),
        ...(startState !== undefined ? { startState } : {}),
        ...(continuedFrom !== undefined ? { continuedFrom } : {}),
    };
    const nextAction = traceNextAction(entry);
    if (nextAction !== undefined) entry.nextAction = nextAction;
    return entry;
}

const TRACE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
// B7 R6/R7 (task 0895): trace gains the dispatched executor, the stage's session
// id, the reuse/fresh outcome, and the pin re-resolution columns.
const TRACE_RESULT_FIELDS = [
    'agent',
    'exitCode',
    'executor',
    'sessionId',
    'session',
    'pinReresolved',
    'pinReresolvedFrom',
    'pinReresolvedOwner',
    'pinReresolvedReason',
] as const;
const TRACE_INVOCATION_FIELDS = [
    'agent',
    'source',
    'command',
    'cwd',
    'mode',
    'outputMode',
    'timeoutMs',
    'continue',
    'stdinInteractive',
    'model',
    'translatedFrom',
    'sessionId',
] as const;

function durationBetween(startedAt: string, completedAt: string | null): number | null {
    if (completedAt === null) return null;
    const start = Date.parse(startedAt);
    const end = Date.parse(completedAt);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function traceTimestamp(value: string): string {
    return Number.isFinite(Date.parse(value)) ? value : 'unavailable';
}

function persistedTimestamp(value: number): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'unavailable' : date.toISOString();
}

function traceOutcome(status: string): string {
    if (status === 'done') return 'success';
    if (status === 'failed') return 'failure';
    if (status === 'running' || status === 'pending' || status === 'paused') return status;
    return 'unavailable';
}

function actionOutcome(status: string, ok: boolean | null): string {
    if (status === 'running' || status === 'pending') return status;
    if (ok === true) return 'success';
    if (ok === false) return 'failure';
    return 'unavailable';
}

function traceNextAction(run: WorkflowTraceEntry, outputArtifact?: string): SystemEventAction | undefined {
    if (!TRACE_IDENTIFIER.test(run.runId)) return undefined;
    if (run.status === 'running' || run.status === 'pending') {
        return { label: 'Follow run', kind: 'command', value: `spur workflow trace ${run.runId} --follow` };
    }
    if (run.status === 'paused' || run.status === 'interrupted') {
        return { label: 'Continue run', kind: 'command', value: `spur workflow continue ${run.runId}` };
    }
    if (run.status === 'failed' && outputArtifact !== undefined) {
        return { label: 'Inspect run log', kind: 'path', value: outputArtifact };
    }
    return undefined;
}

function projectActionTraceResult(
    resultJson: string | null,
    secretValues: readonly string[] = [],
): {
    result: Record<string, string | number | boolean> | null;
    invocation: Record<string, string | number | boolean> | null;
    decision: TimelineActionDecision | null;
    error: string | null;
} {
    if (!resultJson) return { result: null, invocation: null, decision: null, error: null };
    let parsed: unknown;
    try {
        parsed = JSON.parse(resultJson);
    } catch {
        return {
            result: null,
            invocation: null,
            decision: null,
            error: null,
        };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            result: null,
            invocation: null,
            decision: null,
            error: null,
        };
    }
    const result = parsed as Record<string, unknown>;
    const data =
        result.data && typeof result.data === 'object' && !Array.isArray(result.data)
            ? (result.data as Record<string, unknown>)
            : {};
    const invocationSource =
        data.invocation && typeof data.invocation === 'object' && !Array.isArray(data.invocation)
            ? (data.invocation as Record<string, unknown>)
            : undefined;
    const resultFields: Record<string, string | number | boolean> = {};
    for (const field of TRACE_RESULT_FIELDS) {
        const value = data[field];
        if (typeof value === 'string') resultFields[field] = redactAndBound(value, secretValues, 256);
        else if (typeof value === 'number' || typeof value === 'boolean') resultFields[field] = value;
    }
    // 0901 R5: shell results carry persisted byte-tails (≤ 65,536 bytes, already
    // secret-redacted at persist time by the Spur ActionRedactor). Project them
    // verbatim — NOT through the 256-char bound — plus the truncation flags, so
    // trace surfaces the tail without re-reading the run log.
    if (result.kind === 'shell') {
        for (const [field, source] of [
            ['stdoutTail', 'stdout'],
            ['stderrTail', 'stderr'],
        ] as const) {
            const value = data[source];
            if (typeof value === 'string') resultFields[field] = value;
        }
        for (const flag of ['stdoutTruncated', 'stderrTruncated'] as const) {
            const value = data[flag];
            if (typeof value === 'boolean') resultFields[flag] = value;
        }
    }
    const invocation: Record<string, string | number | boolean> = {};
    if (invocationSource !== undefined) {
        for (const field of TRACE_INVOCATION_FIELDS) {
            const value = invocationSource[field];
            if (typeof value === 'string') invocation[field] = redactAndBound(value, secretValues, 256);
            else if (typeof value === 'number' || typeof value === 'boolean') invocation[field] = value;
        }
    }
    const error = typeof result.error === 'string' ? redactAndBound(result.error, secretValues, 512) : null;
    return {
        result: Object.keys(resultFields).length === 0 ? null : resultFields,
        invocation: Object.keys(invocation).length === 0 ? null : invocation,
        decision: projectDecisionProvenance(data.decision, secretValues),
        error,
    };
}

/**
 * Project persisted decision provenance (0911 R6) into a bounded, redacted trace object. The
 * source shape is application-owned, so the projection re-checks every field type and drops
 * anything that is not part of the closed vocabulary — raw evidence and provider exception text
 * never live in this object to begin with.
 */
function projectDecisionProvenance(value: unknown, secretValues: readonly string[]): TimelineActionDecision | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (source.schemaVersion !== 1) return null;
    const mode = typeof source.mode === 'string' ? source.mode : null;
    const outcome = typeof source.outcome === 'string' ? source.outcome : null;
    const reason = typeof source.reason === 'string' ? source.reason : null;
    if (mode === null || outcome === null || reason === null) return null;
    const evidenceActionIds = Array.isArray(source.evidenceActionIds)
        ? source.evidenceActionIds
              .filter((id): id is string => typeof id === 'string')
              .slice(0, 20)
              .map((id) => redactAndBound(id, secretValues, 64))
        : [];
    return {
        mode: redactAndBound(mode, secretValues, 32),
        outcome: redactAndBound(outcome, secretValues, 32),
        reason: redactAndBound(reason, secretValues, 64),
        provider: typeof source.provider === 'string' ? redactAndBound(source.provider, secretValues, 64) : null,
        confidence: typeof source.confidence === 'number' ? source.confidence : null,
        selectedProbability: typeof source.selectedProbability === 'number' ? source.selectedProbability : null,
        evidenceActionIds,
        evidenceDigest:
            typeof source.evidenceDigest === 'string' ? redactAndBound(source.evidenceDigest, secretValues, 128) : null,
        artifactId: typeof source.artifactId === 'string' ? redactAndBound(source.artifactId, secretValues, 64) : null,
        durationMs: typeof source.durationMs === 'number' ? source.durationMs : 0,
    };
}

async function partialArtifactForAction(
    cwd: string,
    runId: string,
    node: string,
    ok: boolean | null,
): Promise<string | undefined> {
    if (ok !== false || !TRACE_IDENTIFIER.test(runId) || !TRACE_IDENTIFIER.test(node)) return undefined;
    const relativePath = join('.spur', 'run', `${runId}-${node}-partial.md`);
    const retained = join(runArtifactsDir(cwd, runId), basename(relativePath));
    if (await fileExists(retained)) return relative(cwd, retained);
    return (await fileExists(resolve(cwd, relativePath))) ? relativePath : undefined;
}
