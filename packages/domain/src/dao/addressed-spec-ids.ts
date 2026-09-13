import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Spec ids that own durable rows in the coordination store (0846 R4): the union of
 * `inbox_messages.to_id` (mailbox addresses) and `coordination_runs.spec_id` (occupant
 * addresses). A spec id in this set is a live identity — migration may preserve or
 * re-link it, never retire it. Read-only by contract: two `SELECT DISTINCT` queries,
 * no write path.
 *
 * Missing tables contribute nothing (the read-path precedent in `CoordinationRunDao`):
 * a table that does not exist cannot hold rows, so "unaddressed" is the true answer,
 * not a swallowed error.
 */
export async function listAddressedSpecIds(db: Pick<DbAdapter, 'queryAll'>): Promise<string[]> {
    const inboxIds = await distinctOrEmpty(db, 'SELECT DISTINCT to_id AS id FROM inbox_messages');
    const runIds = await distinctOrEmpty(db, 'SELECT DISTINCT spec_id AS id FROM coordination_runs');
    return Array.from(new Set([...inboxIds, ...runIds])).sort();
}

/** Inspect legacy schemas without opening a writer or applying migrations. */
export async function readAddressedSpecIds(databasePath: string): Promise<string[]> {
    const { Database } = await import('@gobing-ai/ts-runtime/bun-sqlite');
    const db = new Database(databasePath, { readonly: true });
    try {
        return await listAddressedSpecIds({
            queryAll: async <T>(sql: string): Promise<T[]> => db.query<T, []>(sql).all(),
        });
    } finally {
        db.close();
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
