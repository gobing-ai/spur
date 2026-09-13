import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Inbox candidate for request reconciliation, including delivered messages.
 * Delivery success alone does not establish a completed or verified run.
 */
export interface InboxUnfinishedRow {
    id: string;
    to_id: string;
    status: string;
    inject_attempts: number;
    inject_error: string | null;
    created_at: number;
}

/**
 * Read-side DAO over all request candidates in `inbox_messages` (0834 R1). Extends the ts-db
 * {@link InboxMessageDao} surface — per-recipient `inbox()` has no status
 * filter and the reconciler must also scan across all recipients — with one
 * unfinished scan. Raw SQL lives here in domain so `packages/app` stays
 * raw-SQL-free (project rule `raw-sql-only-in-domain`). Returns `[]` when the
 * table is absent (unmigrated DB).
 */
export class InboxUnfinishedDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * List request candidates, newest first,
     * optionally scoped to one recipient. An unknown future status is returned
     * too and simply falls through every classification branch upstream.
     */
    async listUnfinished(toId?: string): Promise<InboxUnfinishedRow[]> {
        try {
            if (toId !== undefined) {
                return (
                    (await this.db.queryAll<InboxUnfinishedRow>(
                        `SELECT id, to_id, status, inject_attempts, inject_error, created_at
                         FROM inbox_messages
                         WHERE to_id = ?1
                         ORDER BY created_at DESC`,
                        toId,
                    )) ?? []
                );
            }
            return (
                (await this.db.queryAll<InboxUnfinishedRow>(
                    `SELECT id, to_id, status, inject_attempts, inject_error, created_at
                     FROM inbox_messages
                     ORDER BY created_at DESC`,
                )) ?? []
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: inbox_messages')) {
                return [];
            }
            throw error;
        }
    }
}
