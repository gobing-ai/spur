import { defineTable, text } from '@gobing-ai/ts-db/schema';

/** Append-only event ledger table (design §2.5). Uses text timestamps per the design contract. */
export const planningEventsTable = defineTable('planning_events', {
    id: text('id').primaryKey(),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    event: text('event').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    payload: text('payload'),
    createdAt: text('created_at').notNull(),
});

/** The Drizzle table for DAOs/queries. */
export const planningEvents = planningEventsTable.table;

/** Task ↔ engine-run traceability table (design §2.5, D06). */
export const taskRunLinksTable = defineTable('task_run_links', {
    id: text('id').primaryKey(),
    wbs: text('wbs').notNull(),
    runId: text('run_id').notNull(),
    kind: text('kind').notNull(),
    createdAt: text('created_at').notNull(),
});

/** The Drizzle table for DAOs/queries. */
export const taskRunLinks = taskRunLinksTable.table;

/** Combined planning DDL, ;-terminated and splittable. */
export const PLANNING_SCHEMA_SQL = [planningEventsTable.createTableSql, taskRunLinksTable.createTableSql]
    .map((sql) => `${sql};`)
    .join('\n\n');
