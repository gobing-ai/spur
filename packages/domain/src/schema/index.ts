export { artifacts } from './artifacts';
export { phaseRuns } from './phase-runs';
export { runs } from './runs';
export { transitionRuns } from './transition-runs';
export { workflowStates } from './workflow-states';
export { workspaces } from './workspaces';

/**
 * CREATE TABLE SQL for the six Spur-owned domain tables.
 *
 * Kept as explicit SQL (not generated from the Drizzle objects) so the applied
 * schema is byte-stable and ADR-007 is preserved: the package owns its schema.
 * The Drizzle table objects above drive the typed DAO layer (EntityDao); this
 * SQL drives migrations. The two must stay in sync — every column here has a
 * matching column in its `schema/*.ts` table.
 */
export const DOMAIN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    root TEXT NOT NULL,
    purpose TEXT,
    default_agent TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    workflow_name TEXT,
    mode TEXT,
    status TEXT NOT NULL,
    agent TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS phase_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS transition_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    trigger TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS workflow_states (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    state TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);
`;
