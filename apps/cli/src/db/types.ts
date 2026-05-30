/** Workspace registry row stored by the CLI. */
export interface WorkspaceRecord {
    id: string;
    name: string;
    root: string;
    purpose: string | null;
    defaultAgent: string | null;
    createdAt: number;
    updatedAt: number;
}

/** Input for adding a workspace binding. */
export interface AddWorkspaceInput {
    id?: string;
    name: string;
    root: string;
    purpose?: string;
    defaultAgent?: string;
}

/** Workflow run row stored by the CLI persistence layer. */
export interface RunRecord {
    id: string;
    workspaceId: string | null;
    status: string;
    agent: string | null;
    startedAt: number;
    completedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

/** Phase-level run row for future workflow integration. */
export interface PhaseRunRecord {
    id: string;
    runId: string;
    phase: string;
    status: string;
    startedAt: number | null;
    completedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

/** Transition-level run row for future workflow integration. */
export interface TransitionRunRecord {
    id: string;
    runId: string;
    fromState: string;
    toState: string;
    status: string;
    createdAt: number;
    updatedAt: number;
}

/** Persisted workflow state snapshot for future workflow integration. */
export interface WorkflowStateRecord {
    id: string;
    runId: string;
    state: string;
    dataJson: string;
    createdAt: number;
    updatedAt: number;
}

/** Artifact metadata row for CLI-created project files. */
export interface ArtifactRecord {
    id: string;
    runId: string | null;
    path: string;
    kind: string;
    createdAt: number;
    updatedAt: number;
}
