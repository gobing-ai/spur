import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, CoordinationRunDao, InboxMessageDao, listAddressedSpecIds } from '../../src/index';

describe('listAddressedSpecIds', () => {
    test('unions inbox to_id and coordination_runs.spec_id, deduped and sorted', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);

        const inbox = new InboxMessageDao(adapter);
        await inbox.enqueue('operator', 'beta', 'for beta');
        await inbox.enqueue('operator', 'alpha', 'for alpha');
        await inbox.enqueue('operator', 'alpha', 'again'); // duplicate to_id → one entry

        const runs = new CoordinationRunDao(adapter);
        await runs.insertStart({
            specId: 'gamma',
            agentKind: 'claude-code',
            processId: null,
            runId: 'run-1',
            generation: 1,
            startedAt: '2026-09-10T00:00:00.000Z',
        });

        expect(await listAddressedSpecIds(adapter)).toEqual(['alpha', 'beta', 'gamma']);
    });

    test('empty coordination store → returns [] without throwing', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        expect(await listAddressedSpecIds(adapter)).toEqual([]);
    });

    test('missing tables contribute nothing (read-path precedent, no throw)', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        expect(await listAddressedSpecIds(adapter)).toEqual([]);
    });
});
