/**
 * Re-export of domain record and input types from their owning DAO modules.
 *
 * The DAO modules are the source of truth (record types are inferred from the
 * Drizzle schema); this barrel keeps a stable `@gobing-ai/spur-domain` type
 * surface for consumers that import types without the DAO classes.
 */

export type { ArtifactRecord, CreateArtifactInput } from './dao/artifact-dao';
export type { CreatePhaseRunInput, PhaseRunRecord } from './dao/phase-run-dao';
export type { CreateRunInput, RunRecord } from './dao/run-dao';
export type { CreateTransitionRunInput, TransitionRunRecord } from './dao/transition-run-dao';
export type { CreateWorkflowStateInput, WorkflowStateRecord } from './dao/workflow-state-dao';
export type { AddWorkspaceInput, WorkspaceRecord } from './dao/workspace-dao';
