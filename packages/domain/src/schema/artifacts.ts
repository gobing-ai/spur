import { defineTable, standardColumns, text } from '@gobing-ai/ts-db/schema';
import { runs } from './runs';

/** Reference to a captured output file (log, patch, report, generated config). */
export const artifactsTable = defineTable('artifacts', {
    id: text('id').primaryKey(),
    runId: text('run_id').references(() => runs.id),
    path: text('path').notNull(),
    kind: text('kind').notNull(),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod are derived on `artifactsTable`. */
export const artifacts = artifactsTable.table;
