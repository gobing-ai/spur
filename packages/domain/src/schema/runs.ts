import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';
import { workspaces } from './workspaces';

/** Workflow run — one execution of a workflow against a task. */
export const runsTable = defineTable('runs', {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id),
    workflowName: text('workflow_name'),
    mode: text('mode'),
    status: text('status').notNull(),
    agent: text('agent'),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod are derived on `runsTable`. */
export const runs = runsTable.table;
