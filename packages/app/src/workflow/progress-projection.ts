import type { DbAdapter } from '@gobing-ai/spur-domain';
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
        | 'ambiguous-action';
    /** Human-readable explanation. */
    message: string;
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

    if (!currentState) {
        currentState = normalizedStatus === 'pending' || normalizedStatus === 'running' ? initialState : null;
    }

    // Build state visit sequence from transition history
    const stateVisits: Array<{ state: string; visit: number }> = [];
    const visitCounter: Record<string, number> = {};

    const recordVisit = (stateId: string): number => {
        const count = (visitCounter[stateId] ?? 0) + 1;
        visitCounter[stateId] = count;
        stateVisits.push({ state: stateId, visit: count });
        return count;
    };

    if (transitions.length === 0) {
        if (initialState) {
            recordVisit(initialState);
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

    for (const { state: stateId, visit } of stateVisits) {
        const defState = defStates.find((s) => s.id === stateId);
        const onEnterActions = Array.isArray(defState?.onEnter) ? defState.onEnter : [];
        const onExitActions = Array.isArray(defState?.onExit) ? defState.onExit : [];
        const defActionList = [
            ...onEnterActions.map((a: ActionDef, i: number) => ({ action: a, type: 'onEnter', idx: i })),
            ...onExitActions.map((a: ActionDef, i: number) => ({ action: a, type: 'onExit', idx: i })),
        ];

        const isVisited = visitedStateIds.has(stateId);
        const isCurrent = currentState === stateId;
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

        const stateActionRows = actionsByNode[stateId] ?? [];
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
                    // Map candidate rows (or first available)
                    const matchingRow = candidateRows[0];
                    if (matchingRow) {
                        usedActionRowIds.add(matchingRow.id);

                        attempts.push({
                            actionRunId: matchingRow.id,
                            status: matchingRow.status,
                            ok: matchingRow.ok !== null ? matchingRow.ok === 1 : null,
                            startedAt: matchingRow.started_at,
                            completedAt: matchingRow.completed_at,
                            durationMs: matchingRow.duration_ms,
                        });

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

    return {
        schemaVersion: 1,
        runId,
        workflow: smDef.name || workflowName,
        status: normalizedStatus,
        definitionDigest: recordedDigest,
        currentState,
        states: statesProgress,
        transitions,
        artifacts: artifactRows.map((a) => ({ kind: a.kind, path: a.path })),
        nextTransitions,
        diagnostics,
        projectedAt,
    };
}
