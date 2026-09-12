import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Raw non-delivered inbox row for reconciliation (0834). `status` is any state
 * except the terminal success `delivered` — i.e. `queued`, `injected`, `failed`
 * — the exact scan set of the delivery reconciler's five-step precedence.
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
 * Read-side DAO over the `inbox_messages` table listing every message whose
 * delivery is not terminally successful (0834 R1). Extends the ts-db
 * {@link InboxMessageDao} surface — per-recipient `inbox()` has no status
 * filter and the reconciler must also scan across all recipients — with one
 * unfinished scan. Raw SQL lives here in domain so `packages/app` stays
 * raw-SQL-free (project rule `raw-sql-only-in-domain`). Returns `[]` when the
 * table is absent (unmigrated DB).
 */
export class InboxUnfinishedDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * List non-delivered messages (`status != 'delivered'`), newest first,
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
                         WHERE status != 'delivered' AND to_id = ?1
                         ORDER BY created_at DESC`,
                        toId,
                    )) ?? []
                );
            }
            return (
                (await this.db.queryAll<InboxUnfinishedRow>(
                    `SELECT id, to_id, status, inject_attempts, inject_error, created_at
                     FROM inbox_messages
                     WHERE status != 'delivered'
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
