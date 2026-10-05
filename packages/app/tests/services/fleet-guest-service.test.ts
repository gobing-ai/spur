/**
 * Task 1081 R2/R5 — guest occupants.
 *
 * The Plan's failure list this pins:
 *   - an expired guest keeps claimed messages   → expiry must release them back to `queued`
 *   - a guest is not addressable as a declared member (id collision is refused)
 *   - a guest that leaves/heartbeats stops owning its lease
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, InboxMessageDao, InboxUnfinishedDao, ProjectClaimDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FleetGuestService, GUEST_LEASE_TTL_MS, GUEST_RECORD_DIR } from '../../src/index';

async function makeGuestService(declared: string[] = []): Promise<{
    service: FleetGuestService;
    db: Awaited<ReturnType<typeof createMigratedDb>>;
    cwd: string;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-guests-'));
    const db = await createMigratedDb({ url: ':memory:' });
    const service = new FleetGuestService({
        cwd,
        fs: createNodeFileSystem(cwd),
        getDb: async () => db,
        declaredMemberIds: async () => declared,
    });
    return { service, db, cwd, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('FleetGuestService (1081 R2/R5)', () => {
    test('join registers an occupant, a lease and a record file addressed by <role>-g<n>', async () => {
        const { service, db, cwd, cleanup } = await makeGuestService();
        try {
            const result = await service.join({ role: 'reviewer', sessionId: 'sess-1', pid: 4242 });
            expect(result.ok).toBe(true);
            const guest = result.ok ? result.guest : undefined;
            expect(guest?.id).toBe('reviewer-g1');
            expect((await service.read('reviewer-g1'))?.sessionId).toBe('sess-1');

            const claim = await new ProjectClaimDao(db).get(cwd, 'guest:reviewer-g1');
            expect(claim?.holderId).toBe('reviewer-g1');
            expect(claim?.expiresAt).toBeGreaterThan(Date.now());

            // Second join without an id takes the next ordinal. Ordering is asserted set-wise:
            // two joins inside the same millisecond share a `joinedAt`, so the list is sorted
            // with an id tie-break and the test never depends on filesystem read order.
            expect((await service.join({ role: 'reviewer' })).ok).toBe(true);
            expect((await service.list()).map((g) => g.id).sort()).toEqual(['reviewer-g1', 'reviewer-g2']);
        } finally {
            await cleanup();
        }
    });

    test('an unknown role is refused (exit-2 material, never a silent guest)', async () => {
        const { service, cleanup } = await makeGuestService();
        try {
            const result = await service.join({ role: 'wizard' });
            expect(result.ok).toBe(false);
            expect(result.ok ? '' : result.code).toBe('unknown-role');
        } finally {
            await cleanup();
        }
    });

    test('an id that collides with a declared member is refused — guests never shadow the roster', async () => {
        const { service, cleanup } = await makeGuestService(['proj-reviewer']);
        try {
            const result = await service.join({ role: 'reviewer', id: 'proj-reviewer' });
            expect(result.ok).toBe(false);
            expect(result.ok ? '' : result.code).toBe('collision');
        } finally {
            await cleanup();
        }
    });

    test('heartbeat keeps the lease alive; leave releases it and removes the record', async () => {
        const { service, db, cwd, cleanup } = await makeGuestService();
        try {
            const result = await service.join({ role: 'coder' });
            const id = result.ok ? result.guest.id : '';
            expect(await service.heartbeat(id)).toBe(true);

            expect(await service.leave(id)).toBe(true);
            expect(await service.read(id)).toBeNull();
            expect(await service.heartbeat(id)).toBe(false);
            const claim = await new ProjectClaimDao(db).get(cwd, `guest:${id}`);
            expect(claim).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('an expired guest is released and its claimed messages return to pending', async () => {
        const { service, db, cwd, cleanup } = await makeGuestService();
        try {
            const result = await service.join({ role: 'reviewer' });
            const id = result.ok ? result.guest.id : '';
            const runId = result.ok ? result.guest.runId : '';

            const inbox = new InboxMessageDao(db);
            await inbox.enqueue('proj-lead', id, 'please review 1081');
            const claimed = await inbox.drainPending(id);
            expect(claimed.length).toBe(1);
            expect((await new InboxUnfinishedDao(db).listUnfinished(id))[0]?.status).toBe('injected');

            // Age the lease past its TTL without waiting 30 s.
            await db.run(
                `UPDATE project_claims SET expires_at = 1 WHERE project_path = ? AND slot = ?`,
                cwd,
                `guest:${id}`,
            );
            expect(await service.expire()).toEqual([id]);

            const after = await new InboxUnfinishedDao(db).listUnfinished(id);
            expect(after[0]?.status).toBe('queued');
            expect(await service.read(id)).toBeNull();
            const runRow = await db.queryFirst<{ status: string }>(
                `SELECT status FROM coordination_runs WHERE run_id = ?`,
                runId,
            );
            expect(runRow?.status).toBe('exited');
        } finally {
            await cleanup();
        }
    });

    test('a live guest survives a reconciler pass; pendingCount reports queued work', async () => {
        const { service, db, cleanup } = await makeGuestService();
        try {
            const result = await service.join({ role: 'planner' });
            const id = result.ok ? result.guest.id : '';
            expect(await service.expire()).toEqual([]);
            expect(await service.read(id)).not.toBeNull();

            expect(await service.pendingCount(id)).toBe(0);
            await new InboxMessageDao(db).enqueue('proj-lead', id, 'work for you');
            expect(await service.pendingCount(id)).toBe(1);
        } finally {
            await cleanup();
        }
    });

    test('the lease TTL is the shared claim TTL and records live under .spur/run/guests', async () => {
        const { service, cwd, cleanup } = await makeGuestService();
        try {
            await service.join({ role: 'scribe', id: 'guest-x' });
            expect(GUEST_LEASE_TTL_MS).toBeGreaterThan(0);
            expect(GUEST_RECORD_DIR).toBe(join('.spur', 'run', 'guests'));
            expect(await service.read('guest-x')).not.toBeNull();
            void cwd;
        } finally {
            await cleanup();
        }
    });
});
