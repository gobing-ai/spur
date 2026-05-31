import { standardColumns } from '@gobing-ai/ts-db';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Workspace registry — static binding of a repo/workdir to agents and purpose. */
export const workspaces = sqliteTable('workspaces', {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    root: text('root').notNull(),
    purpose: text('purpose'),
    defaultAgent: text('default_agent'),
    ...standardColumns,
});
