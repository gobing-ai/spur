import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, CoordinationRunDao, InboxDao, listAddressedSpecIds } from '../../src/index';

describe('listAddressedSpecIds', () => {
    test('unions inbox to_id and coordination_runs.spec_id, deduped and sorted', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);

        // G11: the inbox half of the union now reads through InboxDao.distinctRecipients().
        const inbox = new InboxDao(adapter);
        const seed = (to: string, body: string) =>
            inbox.insert(
                {
                    id: `msg_${to}_${body.replace(/\s/g, '-')}`,
                    fromId: 'operator',
                    toId: to,
                    body,
                    kind: 'chat',
                    status: 'queued',
                    requestKey: null,
                    taskId: null,
                    parentRunId: null,
                    inReplyTo: null,
                    threadId: `msg_${to}_${body.replace(/\s/g, '-')}`,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                },
                (row) => ({
                    id: `sev_${row.id}`,
                    event_name: 'message.sent',
                    occurred_at: new Date(row.createdAt).toISOString(),
                }),
            );
        await seed('beta', 'for beta');
        await seed('alpha', 'for alpha');
        await seed('alpha', 'again'); // duplicate to_id → one entry

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

    test('any other read failure propagates — only a missing table means "unaddressed"', async () => {
        const db = {
            queryAll: async () => {
                throw new Error('database is locked');
            },
        } as unknown as Parameters<typeof listAddressedSpecIds>[0];
        await expect(listAddressedSpecIds(db)).rejects.toThrow('database is locked');
    });
});
