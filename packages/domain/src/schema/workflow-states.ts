import { defineTable, standardColumns } from '@gobing-ai/ts-db/schema';
import { text } from 'drizzle-orm/sqlite-core';
import { runs } from './runs';

/** Persisted workflow state snapshot (live FSM cursor) for a run. */
export const workflowStatesTable = defineTable('workflow_states', {
    id: text('id').primaryKey(),
    runId: text('run_id')
        .notNull()
        .references(() => runs.id),
    state: text('state').notNull(),
    dataJson: text('data_json').notNull(),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod are derived on `workflowStatesTable`. */
export const workflowStates = workflowStatesTable.table;
