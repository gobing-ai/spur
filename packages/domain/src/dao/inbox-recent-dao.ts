import type { DbAdapter } from '@gobing-ai/ts-db';

/** Raw inbox row returned by {@link InboxRecentDao.listRecent}. */
export interface InboxRecentRow {
    id: string;
    from_id: string | null;
    to_id: string;
    body: string;
    status: string;
    created_at: number;
    in_reply_to: string | null;
}

/**
 * Read-side DAO over the `inbox_messages` table for cross-recipient recent
 * queries (read-only team message board, task 0189 wave A / 0198). Extends the
 * ts-db {@link InboxMessageDao} surface — which is per-recipient only — with a
 * single cross-recipient newest-first query. Raw SQL lives here in domain so
 * `packages/app` stays raw-SQL-free (project rule `raw-sql-only-in-domain`).
 * Returns `[]` when the table is absent (unmigrated DB).
 */
export class InboxRecentDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * List the most recent inbox messages across all recipients, newest first.
     * `limit` is clamped to `[1, 500]`.
     */
    async listRecent(limit = 50): Promise<InboxRecentRow[]> {
        const capped = Math.max(1, Math.min(limit, 500));
        try {
            return await this.db.queryAll<InboxRecentRow>(
                `SELECT id, from_id, to_id, body, status, created_at, in_reply_to
                 FROM inbox_messages
                 ORDER BY created_at DESC
                 LIMIT ?1`,
                capped,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: inbox_messages')) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Count replies (children) for each of the given message ids, scoped to the
     * `inbox_messages` table. Returns a `Map<msgId, count>` — ids with zero replies
     * are omitted from the map. The reply graph is `in_reply_to` → parent id.
     * Returns an empty map when the table is absent.
     */
    async countReplies(ids: string[]): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        if (ids.length === 0) return result;
        const placeholders = ids.map((_, i) => `?${i + 1}`).join(', ');
        try {
            const rows = await this.db.queryAll<{ in_reply_to: string; n: number }>(
                `SELECT in_reply_to, COUNT(*) AS n
                 FROM inbox_messages
                 WHERE in_reply_to IS NOT NULL AND in_reply_to IN (${placeholders})
                 GROUP BY in_reply_to`,
                ...ids,
            );
            for (const row of rows) {
                result.set(row.in_reply_to, row.n);
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: inbox_messages')) {
                return result;
            }
            throw error;
        }
        return result;
    }
}
