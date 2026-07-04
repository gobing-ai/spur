import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, InboxRecentDao } from '../../src/index';

/** Insert an inbox row with an explicit created_at (ms epoch) for deterministic ordering. */
async function insertInbox(
    adapter: DbAdapter,
    fromId: string | null,
    toId: string,
    body: string,
    createdAtMs: number,
): Promise<void> {
    await adapter.run(
        `INSERT INTO inbox_messages (id, from_id, to_id, body, status, created_at, updated_at, inject_attempts)
         VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?5, 0)`,
        crypto.randomUUID(),
        fromId,
        toId,
        body,
        createdAtMs,
    );
}

describe('InboxRecentDao', () => {
    test('listRecent returns messages newest-first across all recipients', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new InboxRecentDao(adapter);

        await insertInbox(adapter, 'alice', 'bob', 'older message', 1000);
        await insertInbox(adapter, 'carol', 'bob', 'newer message', 2000);

        const rows = await dao.listRecent(10);
        expect(rows).toHaveLength(2);
        // Newest first — the row with the later created_at surfaces first.
        expect(rows[0]?.body).toBe('newer message');
        expect(rows[1]?.body).toBe('older message');
        // Cross-recipient: both alice→bob and carol→bob surface.
        expect(rows[0]?.from_id).toBe('carol');
        expect(rows[1]?.from_id).toBe('alice');

        adapter.close();
    });

    test('listRecent clamps limit to [1, 500]', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new InboxRecentDao(adapter);

        for (let i = 0; i < 5; i++) {
            await insertInbox(adapter, 'alice', 'bob', `msg ${i}`, 1000 + i);
        }

        // Limit 0 clamps to 1.
        const one = await dao.listRecent(0);
        expect(one).toHaveLength(1);

        // Limit 1000 clamps to 500, but only 5 rows exist.
        const all = await dao.listRecent(1000);
        expect(all).toHaveLength(5);

        adapter.close();
    });

    test('listRecent defaults to 50', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new InboxRecentDao(adapter);

        // No rows — exercise the default-50 path on an empty table.
        const rows = await dao.listRecent();
        expect(rows).toHaveLength(0);

        adapter.close();
    });

    test('listRecent returns [] when the inbox table is absent', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        // No migrations applied — inbox_messages does not exist.
        const dao = new InboxRecentDao(adapter);

        const rows = await dao.listRecent(10);
        expect(rows).toEqual([]);

        adapter.close();
    });
});
