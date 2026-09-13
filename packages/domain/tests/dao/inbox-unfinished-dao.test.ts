import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, InboxUnfinishedDao } from '../../src/index';

/** Insert an inbox row with explicit status/created_at for deterministic ordering. */
async function insertInbox(
    adapter: DbAdapter,
    toId: string,
    status: string,
    createdAtMs: number,
    injectAttempts = 0,
): Promise<void> {
    await adapter.run(
        `INSERT INTO inbox_messages (id, from_id, to_id, body, status, created_at, updated_at, inject_attempts)
         VALUES (?1, 'operator', ?2, 'body', ?3, ?4, ?4, ?5)`,
        crypto.randomUUID(),
        toId,
        status,
        createdAtMs,
        injectAttempts,
    );
}

describe('InboxUnfinishedDao (0834)', () => {
    test('listUnfinished includes delivered rows because delivery is not a verified outcome', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new InboxUnfinishedDao(adapter);

        await insertInbox(adapter, 'bob', 'queued', 1000);
        await insertInbox(adapter, 'bob', 'injected', 2000, 1);
        await insertInbox(adapter, 'bob', 'failed', 3000, 3);
        await insertInbox(adapter, 'bob', 'delivered', 4000);

        const rows = await dao.listUnfinished();
        expect(rows).toHaveLength(4);
        expect(rows.map((r) => r.status)).toEqual(['delivered', 'failed', 'injected', 'queued']);
        const failed = rows.find((r) => r.status === 'failed');
        expect(failed?.inject_attempts).toBe(3);
    });

    test('listUnfinished scopes to one recipient and preserves newest-first order', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new InboxUnfinishedDao(adapter);

        await insertInbox(adapter, 'agent-a', 'queued', 1000);
        await insertInbox(adapter, 'agent-b', 'injected', 2000);

        const rows = await dao.listUnfinished('agent-a');
        expect(rows).toHaveLength(1);
        expect(rows[0]?.to_id).toBe('agent-a');
    });
});
