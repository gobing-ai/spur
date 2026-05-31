import { standardColumns } from '@gobing-ai/ts-db';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { runs } from './runs';

/** Persisted workflow state snapshot (live FSM cursor) for a run. */
export const workflowStates = sqliteTable('workflow_states', {
    id: text('id').primaryKey(),
    runId: text('run_id')
        .notNull()
        .references(() => runs.id),
    state: text('state').notNull(),
    dataJson: text('data_json').notNull(),
    ...standardColumns,
});
