import type { DbAdapter } from '@gobing-ai/ts-db';
import { InboxDao } from './inbox-dao';

/**
 * Spec ids that own durable rows in the coordination store (0846 R4): the union of
 * `inbox_messages.to_id` (mailbox addresses) and `coordination_runs.spec_id` (occupant
 * addresses). A spec id in this set is a live identity — migration may preserve or
 * re-link it, never retire it. Read-only by contract: one grouped inbox read plus one
 * `SELECT DISTINCT`, no write path.
 *
 * The inbox half goes through {@link InboxDao.distinctRecipients} (G11 R2): this module
 * lives in `packages/domain`, so it cannot call the app-layer `InboxService`, and no
 * other module may name the inbox table.
 *
 * Missing tables contribute nothing (the read-path precedent in `CoordinationRunDao`):
 * a table that does not exist cannot hold rows, so "unaddressed" is the true answer,
 * not a swallowed error.
 */
export async function listAddressedSpecIds(db: DbAdapter): Promise<string[]> {
    const inboxIds = await inboxIdsOrEmpty(db);
    const runIds = await distinctOrEmpty(db, 'SELECT DISTINCT spec_id AS id FROM coordination_runs');
    return Array.from(new Set([...inboxIds, ...runIds])).sort();
}

async function inboxIdsOrEmpty(db: DbAdapter): Promise<string[]> {
    try {
        return (await new InboxDao(db).distinctRecipients()).map((entry) => entry.id);
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) return [];
        throw error;
    }
}

async function distinctOrEmpty(db: Pick<DbAdapter, 'queryAll'>, sql: string): Promise<string[]> {
    try {
        return (await db.queryAll<{ id: string }>(sql)).map((row) => row.id);
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table')) return [];
        throw error;
    }
}
