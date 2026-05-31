import { standardColumns } from '@gobing-ai/ts-db';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { runs } from './runs';

/** Reference to a captured output file (log, patch, report, generated config). */
export const artifacts = sqliteTable('artifacts', {
    id: text('id').primaryKey(),
    runId: text('run_id').references(() => runs.id),
    path: text('path').notNull(),
    kind: text('kind').notNull(),
    ...standardColumns,
});
