import { createId, RunDao, TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { type WorkflowRunResult as EngineWorkflowRunResult, loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { computeDefinitionDigest } from '../workflow/composition-baseline';
import { assertStartStateStartable, readContinuedFrom, StartStateRefusedError } from '../workflow/start-state';
import { registeredWorkflowPaths, resolveWorkflowDefinition, resolveWorkflowFile } from '../workflow/workflow-resolver';
import { bridgeEventBus, dropRetiredActionBoundaryAliases, withWorkflowIdentity } from './event-bridge';
import type { WorkflowEngineFactory } from './workflow-engine-factory';
import { signalSubprocess, workflowVersionLiteral } from './workflow-run-recording';
import { mapFleetExecutorVar, mergeWorkflowRunVars, resolveDefaultAgentVar } from './workflow-run-vars';
import type {
    PausedRun,
    WorkflowAppServiceContext,
    WorkflowCancelResult,
    WorkflowRunOptions,
    WorkflowRunResult,
} from './workflow-service';

/** Workflow name that triggers a pipeline run-link (matches the shipped `workflows/task-pipeline.yaml`). */
const TASK_PIPELINE_WORKFLOW = 'task-pipeline';

/** Link kind for pipeline runs in `task_run_links` (additive to `kind='lifecycle'`). */
const PIPELINE_LINK_KIND = 'pipeline';

/**
 * Run-lifecycle verbs for {@link WorkflowAppService}: `workflow run`, `workflow cancel`, the latest
 * paused-run lookup, plan-artifact stamping, failure-reason stamping and the task-pipeline
 * run-link.
 */
export class WorkflowRunOps {
    constructor(
        private readonly ctx: WorkflowAppServiceContext,
        private readonly engine: WorkflowEngineFactory,
    ) {}

    /** Implementation of {@link WorkflowAppService.run} (see its doc comment for the contract). */
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
        const svc = await this.engine.createEngineService({
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

    /** Implementation of {@link WorkflowAppService.latestPausedRun} (see its doc comment for the contract). */
    async latestPausedRun(): Promise<PausedRun | null> {
        const svc = await this.engine.createEngineService();
        const paused = await svc.listPausedRuns({ limit: 1 });
        const first = paused[0];
        if (first === undefined) return null;
        return { runId: first.id, workflowName: first.workflow_name, startedAt: first.started_at };
    }

    /** Implementation of {@link WorkflowAppService.cancel} (see its doc comment for the contract). */
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
     * Persist a terminal failure reason into the run row's metadata_json so
     * `workflow trace` surfaces it (R7 of 0366). The engine returns the reason
     * in WorkflowRunResult but only persists status; this closes the gap. Uses
     * json_set so dryRun and staleReason coexist peacefully.
     */
    async stampFailureReason(runId: string, result: EngineWorkflowRunResult): Promise<void> {
        if (result.status !== 'failed' || typeof result.reason !== 'string' || result.reason === '') {
            return;
        }
        const db = await this.ctx.getDb();
        await new RunDao(db).stampFailureReason(runId, result.reason);
    }

    /** Implementation of {@link WorkflowAppService.stampPlanArtifactPath} (see its doc comment for the contract). */
    async stampPlanArtifactPath(runId: string, planArtifactPath: string): Promise<void> {
        const db = await this.ctx.getDb();
        await new RunDao(db).mergeMetadata(runId, { planArtifactPath });
    }
}
