import { artifactsTable } from './artifacts';
import { phaseRunsTable } from './phase-runs';
import { runsTable } from './runs';
import { transitionRunsTable } from './transition-runs';
import { workflowStatesTable } from './workflow-states';
import { workspacesTable } from './workspaces';

export { artifacts, artifactsTable } from './artifacts';
export { phaseRuns, phaseRunsTable } from './phase-runs';
export { PLANNING_SCHEMA_SQL, planningEvents, planningEventsTable, taskRunLinks, taskRunLinksTable } from './planning';
export { transitionRuns, transitionRunsTable } from './transition-runs';
export { workflowStates, workflowStatesTable } from './workflow-states';
export { workspaces, workspacesTable } from './workspaces';

/**
 * Schema DDL for the six Spur-owned domain tables — the single source of truth
 * (ADR-011). Each statement is DERIVED from its `defineTable` definition via
 * `createTableSql`; there is no hand-written DDL to keep in sync.
 *
 * Order matters: a table must be created after any table its foreign keys
 * reference (workspaces → runs → phase/transition/workflow_state/artifacts).
 * Each statement is `;`-terminated so the composed script is a valid,
 * splittable multi-statement migration.
 */
export const DOMAIN_SCHEMA_SQL = [
    workspacesTable.createTableSql,
    runsTable.createTableSql,
    phaseRunsTable.createTableSql,
    transitionRunsTable.createTableSql,
    workflowStatesTable.createTableSql,
    artifactsTable.createTableSql,
]
    .map((sql) => `${sql};`)
    .join('\n\n');
