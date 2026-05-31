import { standardColumns } from '@gobing-ai/ts-db';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { runs } from './runs';

/** One occupancy episode of a single workflow phase within a run. */
export const phaseRuns = sqliteTable('phase_runs', {
    id: text('id').primaryKey(),
    runId: text('run_id')
        .notNull()
        .references(() => runs.id),
    phase: text('phase').notNull(),
    status: text('status').notNull(),
    startedAt: integer('started_at'),
    completedAt: integer('completed_at'),
    ...standardColumns,
});
