import { oc } from '@orpc/contract';
import { z } from 'zod';

// ─── Workflow run progress projection (task 1069 / feature E72 R5) ───
// Zod mirror of `WorkflowProgressProjection` in spur-app
// (`packages/app/src/workflow/progress-projection.ts`). Field-for-field parity
// is guarded by the bidirectional assignability assertions in
// `apps/server/tests/modules/runs/index.test.ts`.

/** One recorded execution attempt of a workflow action. */
export const workflowActionAttemptSchema = z.object({
    actionRunId: z.string(),
    status: z.string(),
    ok: z.boolean().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
});

/** Progress record for one action declared on a workflow state. */
export const workflowActionProgressSchema = z.object({
    actionKey: z.string(),
    kind: z.string(),
    stateEffect: z.enum(['read', 'write', 'may-write']),
    evidenceEffect: z.enum(['none', 'write']),
    status: z.enum(['pending', 'running', 'passed', 'failed', 'skipped', 'ambiguous']),
    attempts: z.array(workflowActionAttemptSchema),
});

/** Progress record for a single workflow state visit. */
export const workflowStateProgressSchema = z.object({
    state: z.string(),
    visit: z.number(),
    status: z.enum(['pending', 'running', 'passed', 'failed', 'skipped']),
    actions: z.array(workflowActionProgressSchema),
});

/** One chronological transition event. */
export const workflowTransitionProgressSchema = z.object({
    from: z.string(),
    to: z.string(),
    trigger: z.string().nullable(),
    at: z.string(),
});

/** One output artifact reference recorded for the run. */
export const workflowArtifactRefSchema = z.object({
    kind: z.string(),
    path: z.string(),
});

/** One outgoing transition path available from the current state. */
export const workflowNextTransitionSchema = z.object({
    from: z.string(),
    to: z.string(),
    trigger: z.string().nullable(),
    eligibility: z.enum(['eligible', 'blocked', 'unknown']),
});

/** One projection diagnostic warning. */
export const workflowProgressDiagnosticSchema = z.object({
    code: z.enum([
        'definition-unavailable',
        'definition-digest-missing',
        'definition-drift',
        'orphan-row',
        'orphan-action-row',
        'ambiguous-action',
    ]),
    message: z.string(),
});

/** Structured execution progress of a workflow run (schemaVersion 1). */
export const workflowProgressProjectionSchema = z.object({
    schemaVersion: z.literal(1),
    runId: z.string(),
    workflow: z.string(),
    status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'unknown']),
    definitionDigest: z.string().nullable(),
    version: z.string().nullable().optional(),
    currentState: z.string().nullable(),
    states: z.array(workflowStateProgressSchema),
    transitions: z.array(workflowTransitionProgressSchema),
    artifacts: z.array(workflowArtifactRefSchema),
    nextTransitions: z.array(workflowNextTransitionSchema),
    diagnostics: z.array(workflowProgressDiagnosticSchema),
    projectedAt: z.string(),
});

/** Wire DTO inferred from the progress projection schema. */
export type WorkflowProgressProjectionDto = z.infer<typeof workflowProgressProjectionSchema>;

/** Runs contract — CONTRACT ONLY, served by the Hono runs module. */
export const runsContract = {
    progress: oc
        .route({
            method: 'GET',
            path: '/runs/{runId}/progress',
            summary: 'Read the workflow run progress projection shared with `spur workflow progress`',
            tags: ['runs'],
        })
        .input(z.object({ runId: z.string() }))
        .output(workflowProgressProjectionSchema),
};
