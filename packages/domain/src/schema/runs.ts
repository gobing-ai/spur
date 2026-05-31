import { standardColumns } from '@gobing-ai/ts-db';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { workspaces } from './workspaces';

/** Workflow run — one execution of a workflow against a task. */
export const runs = sqliteTable('runs', {
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
