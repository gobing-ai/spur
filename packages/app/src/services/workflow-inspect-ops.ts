import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    type ActionCostAttribution,
    ActionRunDao,
    attributeActionCost,
    PhaseRunDao,
    RunDao,
    TransitionRunDao,
} from '@gobing-ai/spur-domain';
import type { DecisionType } from '@gobing-ai/ts-ai-decision';
import { createDefaultWorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { getDecisionService } from '../decision/decision-service';
import {
    collectAgentRunRoleViolations,
    collectCompositionAdvisory,
    collectDecideViolations,
    collectHitlDecisionViolations,
    collectInlineDecideWarnings,
    collectSelfContainedStageViolations,
    collectShellCommands,
    collectTerminalReasonViolations,
    collectUndeclaredShellVarViolations,
    hasCatalogDecideAction,
} from '../workflow/composition-lint';
import { validatePhaseTable } from '../workflow/plan-projection';
import { inspectWorkflowRunRecord, type WorkflowRunRecordInspection } from '../workflow/run-record';
import {
    type ResolvedWorkflowDefinition,
    registeredWorkflowPaths,
    resolveWorkflowDefinition,
    resolveWorkflowFile,
    workflowLayers,
} from '../workflow/workflow-resolver';
import { resolveRunRecordDir } from './run-storage';
import type { WorkflowListEntryIdentity } from './workflow-catalog-scan';
import { extractWorkflowMeta, scanWorkflowFiles } from './workflow-catalog-scan';
import type { WorkflowEngineFactory } from './workflow-engine-factory';
import { workflowVersionLiteral } from './workflow-run-recording';
import type {
    TimelineEvent,
    WorkflowAppServiceContext,
    WorkflowListEntry,
    WorkflowListResult,
    WorkflowTraceFilter,
    WorkflowTraceListResult,
    WorkflowTraceTimeline,
    WorkflowValidateResult,
} from './workflow-service';
import {
    actionOutcome,
    outputArtifactForRun,
    partialArtifactForAction,
    persistedTimestamp,
    projectActionTraceResult,
    rowToTraceEntry,
    traceNextAction,
    traceTimestamp,
} from './workflow-trace-projection';

/**
 * Read-side workflow verbs for {@link WorkflowAppService}: `workflow validate`, `workflow list`,
 * the `workflow trace` list/timeline projections and bounded run-record inspection.
 */
export class WorkflowInspectOps {
    constructor(
        private readonly ctx: WorkflowAppServiceContext,
        private readonly engine: WorkflowEngineFactory,
    ) {}

    /** Implementation of {@link WorkflowAppService.validate} (see its doc comment for the contract). */
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

            // Self-contained stage check (D65 1233, design §4.4): every agent.run declares its
            // completion and names only artifacts an earlier state produced or `inputs:`
            // declares. A stage that is not self-contained cannot run under a fresh session.
            const selfContainedErrors = collectSelfContainedStageViolations(workflow);
            if (selfContainedErrors.length > 0) {
                return { ok: false, valid: false, file, errors: selfContainedErrors };
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

            // Decide-action check (0941 R6 + task 1094 R7): a decide action missing its
            // default, declaring a default outside choices, or omitting resultFile is rejected
            // with the SAME zod schema the runner executes — validation and execution cannot
            // drift. Catalog-reference actions additionally resolve against the loaded catalog
            // (unknown id / non-choice/noul type = error); inline actions are deprecated with
            // the same text the runner warns per run.
            let decideErrors: string[];
            if (hasCatalogDecideAction(workflow)) {
                let catalogTypes: Map<string, DecisionType>;
                try {
                    const service = await getDecisionService(this.ctx.spurConfig ?? null, this.ctx.cwd);
                    catalogTypes = new Map(service.list().map((entry) => [entry.id, entry.type]));
                } catch (error) {
                    return {
                        ok: false,
                        valid: false,
                        file,
                        errors: [
                            `decide validation failed: decision catalog unavailable — ${error instanceof Error ? error.message : String(error)}`,
                        ],
                    };
                }
                decideErrors = collectDecideViolations(workflow, catalogTypes);
            } else {
                decideErrors = collectDecideViolations(workflow);
            }
            for (const warning of collectInlineDecideWarnings(workflow)) this.ctx.warn?.(warning);
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

            // Phase-table check (1104 R3): once any state declares `display`, every
            // non-terminal state must carry a phase, terminals must stay bare, and the
            // A-Z/1-9 plan caps must hold — `workflow show --format todo` projects the
            // plan from these annotations, so a half-annotated table would render a
            // misleading plan. Opt-in per annotated workflow; unannotated defs are
            // valid by omission. Findings name the offending state or phase.
            const phaseErrors = validatePhaseTable(workflow);
            if (phaseErrors.length > 0) {
                return { ok: false, valid: false, file, errors: phaseErrors };
            }

            // 0614: warn-only composition advisory (shell measure + agent.run
            // prompt size + disposition suppression). Never affects validity.
            const composition = collectCompositionAdvisory(workflow, absolute);

            // 0533 R3: validate fails closed on a bad extension — a missing module,
            // an absolute/`..` path, or a mis-shaped export surfaces as a validation
            // error before any step. Same load path as run/continue (R2); a bare
            // default host is enough for the import + shape check (no builtins/DB).
            await this.engine.loadWorkflowExtensions(createDefaultWorkflowEngineHost(), workflow, absolute);

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

    /** Implementation of {@link WorkflowAppService.list} (see its doc comment for the contract). */
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

    /** Implementation of {@link WorkflowAppService.inspectRunRecord} (see its doc comment for the contract). */
    inspectRunRecord(runId: string): WorkflowRunRecordInspection {
        return inspectWorkflowRunRecord(resolveRunRecordDir(this.ctx.cwd, runId), runId, {
            secretValues: this.ctx.secretValues,
        });
    }

    async traceList(db: DbAdapter, filter: WorkflowTraceFilter): Promise<WorkflowTraceListResult> {
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

    async traceRun(db: DbAdapter, runId: string): Promise<WorkflowTraceTimeline> {
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
                const result = projectActionTraceResult(a.result_json, this.ctx.secretValues, a.kind);
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
}
