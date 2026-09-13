import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, ProjectClaimDao } from '../../src/index';

const P = '/tmp/proj-a';

async function makeDao(): Promise<{ dao: ProjectClaimDao; adapter: DbAdapter }> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return { dao: new ProjectClaimDao(adapter), adapter };
}

describe('ProjectClaimDao (0836 R3)', () => {
    test('claims, then refuses a second live claimant — refused, not queued', async () => {
        const { dao, adapter } = await makeDao();
        const first = await dao.claim(P, 'orchestrator', 'proj-planner-1', 30_000);
        expect(first?.holderId).toBe('proj-planner-1');
        expect(first?.ownerEpoch).toBe(1);
        expect(first?.strategyVersion).toBeNull();

        const second = await dao.claim(P, 'orchestrator', 'proj-planner-2', 30_000);
        expect(second).toBeNull();

        const current = await dao.get(P, 'orchestrator');
        expect(current?.holderId).toBe('proj-planner-1');
        expect(current?.ownerEpoch).toBe(1);
        adapter.close();
    });

    test('claim after expiry succeeds and increments ownerEpoch (fencing token)', async () => {
        const { dao, adapter } = await makeDao();
        await dao.claim(P, 'orchestrator', 'proj-planner-1', 0); // instantly expired
        const takeover = await dao.claim(P, 'orchestrator', 'proj-planner-2', 30_000);
        expect(takeover?.holderId).toBe('proj-planner-2');
        expect(takeover?.ownerEpoch).toBe(2);
        adapter.close();
    });

    test('re-entrant claim by the same holder succeeds without a second row', async () => {
        const { dao, adapter } = await makeDao();
        await dao.claim(P, 'orchestrator', 'proj-planner-1', 30_000);
        const again = await dao.claim(P, 'orchestrator', 'proj-planner-1', 30_000);
        expect(again?.holderId).toBe('proj-planner-1');

        const rows = await adapter.queryAll('SELECT * FROM project_claims');
        expect(rows).toHaveLength(1);
        adapter.close();
    });

    test('heartbeat by a displaced holder returns false; the holder extends its lease', async () => {
        const { dao, adapter } = await makeDao();
        const first = await dao.claim(P, 'orchestrator', 'proj-planner-1', 0);
        await dao.claim(P, 'orchestrator', 'proj-planner-2', 30_000); // displaced planner-1

        expect(await dao.heartbeat(P, 'orchestrator', 'proj-planner-1', 30_000)).toBe(false);

        const before = await dao.get(P, 'orchestrator');
        expect(await dao.heartbeat(P, 'orchestrator', 'proj-planner-2', 60_000)).toBe(true);
        const after = await dao.get(P, 'orchestrator');
        expect(after?.expiresAt).toBeGreaterThanOrEqual(before?.expiresAt ?? 0);
        expect(after?.heartbeatAt).toBeGreaterThanOrEqual(before?.heartbeatAt ?? 0);
        expect(first).not.toBeNull();
        adapter.close();
    });

    test('release only by the current holder', async () => {
        const { dao, adapter } = await makeDao();
        await dao.claim(P, 'orchestrator', 'proj-planner-1', 30_000);

        expect(await dao.release(P, 'orchestrator', 'proj-planner-2')).toBe(false);
        expect((await dao.get(P, 'orchestrator'))?.holderId).toBe('proj-planner-1');

        expect(await dao.release(P, 'orchestrator', 'proj-planner-1')).toBe(true);
        expect(await dao.get(P, 'orchestrator')).toBeNull();
        adapter.close();
    });

    test('slots are independent claims (orchestrator vs write, 0837)', async () => {
        const { dao, adapter } = await makeDao();
        await dao.claim(P, 'orchestrator', 'proj-planner-1', 30_000);
        const write = await dao.claim(P, 'write', 'proj-coder-1', 30_000);
        expect(write?.holderId).toBe('proj-coder-1');
        expect((await dao.get(P, 'orchestrator'))?.holderId).toBe('proj-planner-1');
        adapter.close();
    });
});
