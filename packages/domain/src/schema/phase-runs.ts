import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';
import { runs } from './runs';

/** One occupancy episode of a single workflow phase within a run. */
export const phaseRunsTable = defineTable('phase_runs', {
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

/** The Drizzle table for DAOs/queries. DDL + zod are derived on `phaseRunsTable`. */
export const phaseRuns = phaseRunsTable.table;
