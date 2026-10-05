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
    /** 0832 keyed-submission identity; null for a keyless send (G71 R1 attempt derivation). */
    request_key: string | null;
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
                        `SELECT id, to_id, status, inject_attempts, inject_error, created_at, request_key
                         FROM inbox_messages
                         WHERE to_id = ?1
                         ORDER BY created_at DESC`,
                        toId,
                    )) ?? []
                );
            }
            return (
                (await this.db.queryAll<InboxUnfinishedRow>(
                    `SELECT id, to_id, status, inject_attempts, inject_error, created_at, request_key
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

    /**
     * Every inbox row whose request key starts with `prefix`, newest first, all statuses
     * (G71 R1). The strategy derives a task's attempt number from the count of
     * `fleet:task:<wbs>:` rows, so this read must see settled rows too. An empty prefix
     * is refused here rather than widening to the whole table — a blank prefix is a bug
     * in the caller, not a request for everything.
     */
    async listByRequestKeyPrefix(prefix: string): Promise<InboxUnfinishedRow[]> {
        if (prefix === '') {
            throw new Error('listByRequestKeyPrefix requires a non-empty prefix');
        }
        try {
            return (
                (await this.db.queryAll<InboxUnfinishedRow>(
                    `SELECT id, to_id, status, inject_attempts, inject_error, created_at, request_key
                     FROM inbox_messages
                     WHERE request_key LIKE ?1 ESCAPE '\\'
                     ORDER BY created_at DESC`,
                    `${prefix.replace(/[\\%_]/g, '\\$&')}%`,
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
