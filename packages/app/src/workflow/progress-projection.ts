import type { ActionRunRow, DbAdapter } from '@gobing-ai/spur-domain';
import { ActionRunDao, ArtifactDao, RunDao, TransitionRunDao } from '@gobing-ai/spur-domain';
import type { ActionDef, StateMachineWorkflowDef, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { computeDefinitionDigest } from './composition-baseline';
import { resolveWorkflowDefinition } from './workflow-resolver';

/**
 * Pure read-only projection representing the structured execution progress of a workflow run.
 */
export interface WorkflowProgressProjection {
    /** Schema version identifier. */
    schemaVersion: 1;
    /** Run identifier. */
    runId: string;
    /** Resolved workflow name. */
    workflow: string;
    /** Execution status of the workflow run. */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
    /** Recorded definition digest stamped at run initiation. */
    definitionDigest: string | null;
    /**
     * Workflow version identity persisted at run creation (0768 R1). A string is
     * the declared version literal; `null` = known-unversioned definition. The key
     * is ABSENT for pre-0768 rows (unknown legacy identity).
     */
    version?: string | null;
    /** Currently active state if determinable from transitions. */
    currentState: string | null;
    /** State-level progress records. */
    states: WorkflowStateProgress[];
    /** Chronological transition events. */
    transitions: WorkflowTransitionProgress[];
    /** Output artifact references recorded for this run. */
    artifacts: WorkflowArtifactRef[];
    /** Outgoing transition paths available from current state. */
    nextTransitions: WorkflowNextTransition[];
    /** Diagnostic warnings such as definition drift or ambiguous action rows. */
    diagnostics: WorkflowProgressDiagnostic[];
    /** Timestamp when projection was computed. */
    projectedAt: string;
}

/**
 * Progress record for a single workflow state visit.
 */
export interface WorkflowStateProgress {
    /** Workflow state identifier. */
    state: string;
    /** 1-based visit count for cyclic state machines. */
    visit: number;
    /** Execution status of this state visit. */
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
    /** Action execution records in declared order. */
    actions: WorkflowActionProgress[];
}

/**
 * Progress record for an action declared on a workflow state.
 */
export interface WorkflowActionProgress {
    /** Unique indexed key for the action within the state visit. */
    actionKey: string;
    /** Action runner kind. */
    kind: string;
    /** Mutation classification of state effect. */
    stateEffect: 'read' | 'write' | 'may-write';
    /** Mutation classification of evidence creation effect. */
    evidenceEffect: 'none' | 'write';
    /** Execution status of the action. */
    status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'ambiguous';
    /** Individual attempt records matching this action definition. */
    attempts: WorkflowActionAttempt[];
}

/**
 * Recorded execution attempt for an action run.
 */
export interface WorkflowActionAttempt {
    /** Database action_runs row identifier. */
    actionRunId: string;
    /** Persisted action status string. */
    status: string;
    /** Boolean success flag. */
    ok: boolean | null;
    /** Start timestamp. */
    startedAt: string | null;
    /** Completion timestamp. */
    completedAt: string | null;
    /** Elapsed duration in milliseconds. */
    durationMs: number | null;
    /**
     * Who reported `durationMs` (1070 R4): the inline host session stamps
     * `host-reported` into the row's `result_json`; every other row (engine, legacy,
     * unparseable) is `unknown` and reads as unlabelled.
     */
    provenance: 'host-reported' | 'unknown';
    /** True only for a `host-reported` row whose stamp declares the duration estimated. */
    estimated: boolean;
}

/**
 * Recorded transition between workflow states.
 */
export interface WorkflowTransitionProgress {
    /** Source state. */
    from: string;
    /** Destination state. */
    to: string;
    /** Trigger reason or description. */
    trigger: string | null;
    /** Timestamp of transition. */
    at: string;
}

/**
 * Potential outgoing transition from the current state.
 */
export interface WorkflowNextTransition {
    /** Source state. */
    from: string;
    /** Destination state. */
    to: string;
    /** Transition description or trigger. */
    trigger: string | null;
    /** Eligibility classification based on run status. */
    eligibility: 'eligible' | 'blocked' | 'unknown';
}

/**
 * Recorded artifact reference associated with a workflow run.
 */
export interface WorkflowArtifactRef {
    /** Artifact kind classification. */
    kind: string;
    /** Artifact file path. */
    path: string;
}

/**
 * Diagnostic anomaly identified during workflow progress projection.
 */
export interface WorkflowProgressDiagnostic {
    /** Diagnostic category code. */
    code:
        | 'definition-unavailable'
        | 'definition-digest-missing'
        | 'definition-drift'
        | 'orphan-row'
        | 'orphan-action-row'
        | 'unvisited-state-row'
        | 'ambiguous-action';
    /** Human-readable explanation. */
    message: string;
}

/**
 * One state visit derived from recorded action rows for a run with no transition history.
 */
interface DerivedStateVisit {
    /** Workflow state identifier. */
    state: string;
    /** 1-based visit count for this state, numbered in recorded order. */
    visit: number;
    /** The contiguous rows that produced this visit, in recorded order. */
    rows: ActionRunRow[];
}

/**
 * Options configuring workflow progress projection.
 */
export interface ProjectWorkflowProgressOptions {
    /** Database adapter. */
    db: DbAdapter;
    /** Project root directory. */
    projectRoot?: string;
    /** Optional explicit workflow definition override. */
    workflowDef?: WorkflowDef;
    /** FileSystem abstraction. */
    fileSystem?: FileSystem;
}

/**
 * Derive one attempt's duration provenance from its `action_runs.result_json` stamp (1070 R4).
 *
 * The inline driver writes `{provenance: 'host-reported', estimated}` through the trace writer's
 * `result` boundary; every other row (engine-written, pre-stamp legacy, or unparseable) reads as
 * `unknown`/`false`. A malformed blob is unlabelled, never an error and never a diagnostic.
 */
function readProvenance(resultJson: string | null): { provenance: 'host-reported' | 'unknown'; estimated: boolean } {
    if (resultJson === null) return { provenance: 'unknown', estimated: false };
    try {
        const parsed = JSON.parse(resultJson) as { provenance?: unknown; estimated?: unknown } | null;
        if (parsed?.provenance !== 'host-reported') return { provenance: 'unknown', estimated: false };
        return { provenance: 'host-reported', estimated: parsed.estimated === true };
    } catch {
        return { provenance: 'unknown', estimated: false };
    }
}

/**
 * Derive the visit sequence of a run that has no transition history (1085 R2/R3).
 *
 * Inline-driven runs write `action_runs` rows and no state or transition rows (the engine's
 * persistence adapter is not part of the inline path), so the recorded rows are the only visit
 * evidence. Contiguous rows of the same `node` are one visit, numbered per state; a state the run
 * re-entered (`loopBack`) therefore reads as visit 1 then visit 2, each owning the rows recorded
 * for it. Rows whose `node` names no declared state start, split and extend no visit — they stay
 * the `orphan-action-row` diagnostic's business.
 */
function deriveInlineStateVisits(
    defStates: readonly { id: string }[],
    rows: readonly ActionRunRow[],
): DerivedStateVisit[] {
    const declaredStateIds = new Set(defStates.map((state) => state.id));
    const visits: DerivedStateVisit[] = [];
    const visitCounts: Record<string, number> = {};

    for (const row of rows) {
        if (!declaredStateIds.has(row.node)) continue;
        const open = visits[visits.length - 1];
        if (open && open.state === row.node) {
            open.rows.push(row);
            continue;
        }
        const visit = (visitCounts[row.node] ?? 0) + 1;
        visitCounts[row.node] = visit;
        visits.push({ state: row.node, visit, rows: [row] });
    }

    return visits;
}

/**
 * Computes a pure read-only progress projection for a workflow run from persisted database rows.
 *
 * @param runId - Workflow run identifier.
 * @param options - Projection options including DB adapter.
 * @returns Structured workflow progress projection.
 */
export async function projectWorkflowProgress(
    runId: string,
    options: ProjectWorkflowProgressOptions,
): Promise<WorkflowProgressProjection> {
    const projectRoot = options.projectRoot ?? process.cwd();
    const projectedAt = new Date().toISOString();
    const diagnostics: WorkflowProgressDiagnostic[] = [];

    const runDao = new RunDao(options.db);
    const actionRunDao = new ActionRunDao(options.db);
    const transitionRunDao = new TransitionRunDao(options.db);
    const artifactDao = new ArtifactDao(options.db);

    const runRow = await runDao.traceRowById(runId);
    if (!runRow) {
        diagnostics.push({
            code: 'orphan-row',
            message: `No workflow run found with id "${runId}"`,
        });
        return {
            schemaVersion: 1,
            runId,
            workflow: 'unknown',
            status: 'unknown',
            definitionDigest: null,
            currentState: null,
            states: [],
            transitions: [],
            artifacts: [],
            nextTransitions: [],
            diagnostics,
            projectedAt,
        };
    }

    let rawMeta: Record<string, unknown> = {};
    try {
        if (runRow.metadata_json) {
            rawMeta = JSON.parse(runRow.metadata_json);
        }
    } catch {
        // malformed metadata handled as empty
    }

    const recordedDigest = typeof rawMeta.definitionDigest === 'string' ? rawMeta.definitionDigest : null;
    // 0768 R1: workflowVersion presence distinguishes identity-stamped rows from
    // pre-0768 legacy rows; its value (string|null) distinguishes versioned from
    // known-unversioned definitions.
    const recordedVersion =
        'workflowVersion' in rawMeta &&
        (typeof rawMeta.workflowVersion === 'string' || rawMeta.workflowVersion === null)
            ? (rawMeta.workflowVersion as string | null)
            : undefined;

    let normalizedStatus: WorkflowProgressProjection['status'] = 'unknown';
    const statusLower = (runRow.status ?? '').toLowerCase();
    if (statusLower === 'done' || statusLower === 'completed') {
        normalizedStatus = 'completed';
    } else if (statusLower === 'running') {
        normalizedStatus = 'running';
    } else if (statusLower === 'pending') {
        normalizedStatus = 'pending';
    } else if (statusLower === 'failed') {
        normalizedStatus = 'failed';
    } else if (statusLower === 'cancelled') {
        normalizedStatus = 'cancelled';
    }

    const transitionRows = await transitionRunDao.transitionRowsByRunId(runId);
    const actionRows = await actionRunDao.actionRowsByRunId(runId);
    const artifactRows = await artifactDao.artifactsByRunId(runId);

    const transitions: WorkflowTransitionProgress[] = transitionRows.map((t) => ({
        from: t.from_state,
        to: t.to_state,
        trigger: t.trigger ?? null,
        at: new Date(t.created_at).toISOString(),
    }));

    let currentState: string | null = null;
    if (transitions.length > 0) {
        currentState = transitions[transitions.length - 1]?.to ?? null;
    }

    // Resolve definition
    let workflowDef = options.workflowDef;
    const workflowName = runRow.workflow_name || 'unknown';

    if (!workflowDef && workflowName !== 'unknown') {
        try {
            const resolved = await resolveWorkflowDefinition(projectRoot, workflowName, { validateSchema: true });
            workflowDef = resolved.workflow;
        } catch {
            // fall through to definition-unavailable diagnostic
        }
    }

    if (!workflowDef) {
        diagnostics.push({
            code: 'definition-unavailable',
            message: `Definition unavailable for workflow "${workflowName}"`,
        });
        if (recordedDigest === null) {
            diagnostics.push({
                code: 'definition-digest-missing',
                message: `Run ${runId} metadata has no recorded definitionDigest`,
            });
        }
        return {
            schemaVersion: 1,
            runId,
            workflow: workflowName,
            status: normalizedStatus,
            definitionDigest: recordedDigest,
            ...(recordedVersion !== undefined ? { version: recordedVersion } : {}),
            currentState,
            states: [],
            transitions,
            artifacts: artifactRows.map((a) => ({ kind: a.kind, path: a.path })),
            nextTransitions: [],
            diagnostics,
            projectedAt,
        };
    }

    const currentComputedDigest = computeDefinitionDigest(workflowDef);
    if (recordedDigest === null) {
        diagnostics.push({
            code: 'definition-digest-missing',
            message: `Run ${runId} metadata has no recorded definitionDigest`,
        });
    } else if (recordedDigest !== currentComputedDigest) {
        diagnostics.push({
            code: 'definition-drift',
            message: `Recorded definition digest ${recordedDigest} differs from current definition digest ${currentComputedDigest}`,
        });
    }

    const smDef = workflowDef as StateMachineWorkflowDef;
    const defStates = Array.isArray(smDef.states) ? smDef.states : [];
    const initialState = smDef.initialState ?? (defStates[0]?.id || 'start');

    // 1085 R2/R3: with no transition history (every inline run) the recorded action rows are the
    // visit evidence. Engine runs keep the transition-derived visits below, untouched.
    const inlineVisits = transitions.length === 0 ? deriveInlineStateVisits(defStates, actionRows) : [];

    if (!currentState) {
        if (normalizedStatus === 'pending' || normalizedStatus === 'running') {
            currentState = inlineVisits[inlineVisits.length - 1]?.state ?? initialState;
        } else if (normalizedStatus === 'failed' && inlineVisits.length > 0) {
            // A failed transition-less run names its failing state (the last derived visit) so the
            // Trace tab marks it `failed` like the engine path does, instead of every visited
            // state reading `passed` while its own action row reads `failed` (1085 review P4).
            currentState = inlineVisits[inlineVisits.length - 1]?.state ?? null;
        }
    }

    // Build state visit sequence from transition history
    const stateVisits: Array<{ state: string; visit: number; rows?: ActionRunRow[] }> = [];
    const visitCounter: Record<string, number> = {};

    const recordVisit = (stateId: string): number => {
        const count = (visitCounter[stateId] ?? 0) + 1;
        visitCounter[stateId] = count;
        stateVisits.push({ state: stateId, visit: count });
        return count;
    };

    if (transitions.length === 0) {
        if (inlineVisits.length === 0) {
            if (initialState) {
                recordVisit(initialState);
            }
        } else {
            for (const derived of inlineVisits) {
                stateVisits.push(derived);
            }
        }
    } else {
        const firstFrom = transitions[0]?.from;
        if (firstFrom) {
            recordVisit(firstFrom);
        }
        for (const tr of transitions) {
            recordVisit(tr.to);
        }
    }

    // Ensure all declared states appear at least once (visit: 1, status: 'pending') if not visited
    const visitedStateIds = new Set(stateVisits.map((v) => v.state));
    for (const defState of defStates) {
        if (!visitedStateIds.has(defState.id)) {
            stateVisits.push({ state: defState.id, visit: 1 });
        }
    }

    // Map actions and state progress
    const statesProgress: WorkflowStateProgress[] = [];

    // Group action rows by node
    const actionsByNode: Record<string, typeof actionRows> = {};
    for (const row of actionRows) {
        const group = actionsByNode[row.node] ?? [];
        group.push(row);
        actionsByNode[row.node] = group;
    }

    // Rows that matched a declared onEnter/onExit action (0868 finding #7: orphan rows
    // would otherwise silently vanish from the projection).
    const matchedActionRowIds = new Set<string>();

    // The current visit is the LAST visit of the current state: a re-entered (`loopBack`) state
    // has several visits, and only the most recent one is current (1085 review P4 — comparing
    // state ids alone marked every visit of the current state `running`).
    const lastVisitByState = new Map<string, number>();
    for (const entry of stateVisits) {
        lastVisitByState.set(entry.state, Math.max(lastVisitByState.get(entry.state) ?? 0, entry.visit));
    }

    for (const { state: stateId, visit, rows: visitRows } of stateVisits) {
        const defState = defStates.find((s) => s.id === stateId);
        const onEnterActions = Array.isArray(defState?.onEnter) ? defState.onEnter : [];
        const onExitActions = Array.isArray(defState?.onExit) ? defState.onExit : [];
        const defActionList = [
            ...onEnterActions.map((a: ActionDef, i: number) => ({ action: a, type: 'onEnter', idx: i })),
            ...onExitActions.map((a: ActionDef, i: number) => ({ action: a, type: 'onExit', idx: i })),
        ];

        const isVisited = visitedStateIds.has(stateId);
        const isCurrent = currentState === stateId && visit === lastVisitByState.get(stateId);
        let stateStatus: WorkflowStateProgress['status'] = 'pending';

        if (isVisited) {
            if (isCurrent) {
                if (normalizedStatus === 'running' || normalizedStatus === 'pending') {
                    stateStatus = 'running';
                } else if (normalizedStatus === 'completed') {
                    stateStatus = 'passed';
                } else if (normalizedStatus === 'failed') {
                    stateStatus = 'failed';
                } else {
                    stateStatus = 'passed';
                }
            } else {
                stateStatus = 'passed';
            }
        }

        // A derived visit maps only the rows recorded for it; every other visit (engine or
        // declared-but-unvisited) uses the state's rows as before.
        const stateActionRows = visitRows ?? actionsByNode[stateId] ?? [];
        const actionsProgress: WorkflowActionProgress[] = [];

        // Track used action row ids
        const usedActionRowIds = new Set<string>();

        for (const item of defActionList) {
            const actionKey = `${stateId}:${item.type}:${item.idx}`;
            const kind = item.action.kind;
            // Fixed classifications: the composition baseline never carried per-action
            // effects (0 of 120 actions declared one) and no caller ever passed a
            // baseline in, so every action always projected these defaults.
            const stateEffect = 'may-write' as const;
            const evidenceEffect = 'none' as const;

            // Find matching rows by node + kind
            const candidateRows = stateActionRows.filter((r) => r.kind === kind && !usedActionRowIds.has(r.id));
            if (isVisited) {
                // A visited state consumes its candidate rows (mapped as an attempt below, or
                // reported by the ambiguous branch). Rows of a state the run never visited stay
                // unclaimed so the trailing pass names them (1085 R4).
                for (const r of candidateRows) matchedActionRowIds.add(r.id);
            }

            let actionStatus: WorkflowActionProgress['status'] = 'pending';
            const attempts: WorkflowActionAttempt[] = [];

            if (!isVisited) {
                actionStatus = 'pending';
            } else if (candidateRows.length === 0) {
                actionStatus = stateStatus === 'passed' ? 'skipped' : 'pending';
            } else {
                // If there are multiple definition actions with the same kind in this state
                const sameKindDefCount = defActionList.filter((a) => a.action.kind === kind).length;
                if (sameKindDefCount > 1 && candidateRows.length > 1 && candidateRows.length !== sameKindDefCount) {
                    diagnostics.push({
                        code: 'ambiguous-action',
                        message: `Ambiguous mapping for action ${actionKey} (kind ${kind}) in state ${stateId}`,
                    });
                    actionStatus = 'ambiguous';
                } else {
                    // Map candidate rows. A single declared action of this kind owns ALL its
                    // recorded rows as attempts — retries stay visible in recorded order instead
                    // of vanishing claimed-but-unsurfaced (1085 R4 residual). With several
                    // same-kind def actions, rows keep distributing one per action as before.
                    const matchingRow = candidateRows[0];
                    if (matchingRow) {
                        const rowsToMap = sameKindDefCount === 1 ? candidateRows : [matchingRow];
                        for (const row of rowsToMap) {
                            usedActionRowIds.add(row.id);

                            attempts.push({
                                actionRunId: row.id,
                                status: row.status,
                                ok: row.ok !== null ? row.ok === 1 : null,
                                startedAt: row.started_at,
                                completedAt: row.completed_at,
                                durationMs: row.duration_ms,
                                ...readProvenance(row.result_json),
                            });
                        }

                        // Action status keeps today's semantics: the first recorded row decides.
                        if (matchingRow.status === 'running') {
                            actionStatus = 'running';
                        } else if (matchingRow.status === 'passed') {
                            actionStatus = 'passed';
                        } else if (matchingRow.status === 'failed') {
                            actionStatus = 'failed';
                        } else if (matchingRow.status === 'skipped') {
                            actionStatus = 'skipped';
                        } else {
                            actionStatus = 'passed';
                        }
                    }
                }
            }

            actionsProgress.push({
                actionKey,
                kind,
                stateEffect,
                evidenceEffect,
                status: actionStatus,
                attempts,
            });
        }

        statesProgress.push({
            state: stateId,
            visit,
            status: stateStatus,
            actions: actionsProgress,
        });
    }

    // Next transitions from currentState
    const nextTransitions: WorkflowNextTransition[] = [];
    if (currentState && Array.isArray(smDef.transitions)) {
        const outgoing = smDef.transitions.filter((t) => t.from === currentState);
        for (const tr of outgoing) {
            let eligibility: WorkflowNextTransition['eligibility'] = 'unknown';
            if (normalizedStatus === 'running') {
                eligibility = 'blocked';
            } else if (normalizedStatus === 'completed') {
                eligibility = 'eligible';
            } else {
                eligibility = 'unknown';
            }
            nextTransitions.push({
                from: tr.from,
                to: tr.to,
                trigger: tr.description ?? null,
                eligibility,
            });
        }
    }

    // Surface rows no declared state action claimed — the invisible-orphan failure mode (0868 #7),
    // split into its two causes (1085 R4): a node with no declared state, or a declared state the
    // run did not visit. Every unclaimed row produces exactly one diagnostic naming it.
    const declaredStateIds = new Set(defStates.map((state) => state.id));
    for (const row of actionRows) {
        if (matchedActionRowIds.has(row.id)) continue;
        if (declaredStateIds.has(row.node) && !visitedStateIds.has(row.node)) {
            diagnostics.push({
                code: 'unvisited-state-row',
                message: `Action row ${row.id} (node ${row.node}, kind ${row.kind}) belongs to state ${row.node}, which run ${runId} did not visit`,
            });
            continue;
        }
        diagnostics.push({
            code: 'orphan-action-row',
            message: `Action row ${row.id} (node ${row.node}, kind ${row.kind}) matches no declared state action`,
        });
    }

    return {
        schemaVersion: 1,
        runId,
        workflow: smDef.name || workflowName,
        status: normalizedStatus,
        definitionDigest: recordedDigest,
        ...(recordedVersion !== undefined ? { version: recordedVersion } : {}),
        currentState,
        states: statesProgress,
        transitions,
        artifacts: artifactRows.map((a) => ({ kind: a.kind, path: a.path })),
        nextTransitions,
        diagnostics,
        projectedAt,
    };
}
