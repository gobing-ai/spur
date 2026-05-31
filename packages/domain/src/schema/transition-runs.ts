import { standardColumns } from '@gobing-ai/ts-db';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { runs } from './runs';

/** A recorded transition between workflow states within a run. */
export const transitionRuns = sqliteTable('transition_runs', {
    id: text('id').primaryKey(),
    runId: text('run_id')
        .notNull()
        .references(() => runs.id),
    fromState: text('from_state').notNull(),
    toState: text('to_state').notNull(),
    trigger: text('trigger'),
    status: text('status').notNull(),
    ...standardColumns,
});
