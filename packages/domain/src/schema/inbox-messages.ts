import { defineTable, integer, text } from '@gobing-ai/ts-db/schema';

/**
 * The inbox message plane (G11, ADR-143): one durable inbox per fleet member address.
 *
 * Spur owns this table now. It replaces the ts-db `inbox_messages` mirror whose
 * `inject_*` columns and nullable sender could not express routing (`kind`), dispatch
 * linkage (`task_id`, `parent_run_id`) or guarded transitions. `InboxDao` is the only
 * module that names this table; `InboxService` is its only caller.
 */
export const inboxMessagesTable = defineTable('inbox_messages', {
    id: text('id').primaryKey(),
    /** Sender address. Never null — `operator` is the human, `spur` is the system. */
    fromId: text('from_id').notNull(),
    /** Recipient address: `<project-slug>-<member-id>`, `operator` or `spur`. */
    toId: text('to_id').notNull(),
    body: text('body').notNull(),
    /** `chat` or `request`. Only `request` rows enter receipt reconciliation. */
    kind: text('kind').notNull().default('chat'),
    /** `queued` → `claimed` → `delivered` | `failed`; the sweeper may requeue a claim. */
    status: text('status').notNull().default('queued'),
    claimedAt: integer('claimed_at'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    deliveredAt: integer('delivered_at'),
    readAt: integer('read_at'),
    inReplyTo: text('in_reply_to'),
    /** Root message id; a reply inherits it. */
    threadId: text('thread_id'),
    /** Idempotency only — never parsed. */
    requestKey: text('request_key'),
    taskId: text('task_id'),
    parentRunId: text('parent_run_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
});

/** The Drizzle table for DAOs/queries. */
export const inboxMessages = inboxMessagesTable.table;

/**
 * Inbox DDL plus its indexes, `;`-terminated and splittable.
 *
 * `(to_id, status)` serves the claim and queue-count reads, `(from_id, created_at)`
 * the out-direction list, `(thread_id)` the thread read, and the partial unique
 * `request_key` index arbitrates concurrent keyed sends while leaving keyless
 * sends unaffected (SQLite allows unlimited NULLs).
 */
export const INBOX_MESSAGES_TABLE_SQL = [
    inboxMessagesTable.createTableSql,
    'CREATE INDEX IF NOT EXISTS idx_inbox_messages_to_status ON inbox_messages (to_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_inbox_messages_from_created ON inbox_messages (from_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread ON inbox_messages (thread_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_request_key ON inbox_messages (request_key) WHERE request_key IS NOT NULL',
]
    .map((sql) => `${sql};`)
    .join('\n');
