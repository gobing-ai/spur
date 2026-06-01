import { defineTable, standardColumns } from '@gobing-ai/ts-db/schema';
import { text } from 'drizzle-orm/sqlite-core';

/** Workspace registry — static binding of a repo/workdir to agents and purpose. */
export const workspacesTable = defineTable('workspaces', {
    id: text('id').primaryKey(),
    name: text('name').notNull().unique(),
    root: text('root').notNull(),
    purpose: text('purpose'),
    defaultAgent: text('default_agent'),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod are derived on `workspacesTable`. */
export const workspaces = workspacesTable.table;
