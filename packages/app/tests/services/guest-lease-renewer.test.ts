/**
 * Task 1279 R1/R3 — the bounded guest lease renewer.
 *
 * Failure list this pins:
 *   - 90 s of work with no `wait --inbox` lets the lease expire  → renewal keeps it live past 3× TTL
 *   - the agent process dies and the lease stays alive            → `identity-lost` within one interval
 *   - a reused PID keeps an unrelated process's lease alive       → birth time decides, not the pid
 *   - another holder takes the claim and renewal keeps writing    → `fence-lost`
 *   - an operator leaves and the renewer keeps heartbeating       → `record-gone`
 *   - an orphaned renewer outlives its usefulness                 → lifetime cap
 *
 * The TTL is injected (900 ms here instead of 30 s) so the 3×-TTL scenario runs in seconds
 * while keeping the real renewal ratio (`interval = TTL / 3`). A real long-lived child process
 * supplies the agent identity — a fixture fingerprint would prove nothing about `ps`.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, ProjectClaimDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    createPsProcessIdentityReader,
    FleetGuestService,
    GuestLeaseRenewer,
    type ProcessFingerprint,
    type ProcessIdentity,
} from '../../src/index';

const TTL_MS = 900;
const INTERVAL_MS = TTL_MS / 3;

async function makeGuestService(): Promise<{
    service: FleetGuestService;
    db: Awaited<ReturnType<typeof createMigratedDb>>;
    cwd: string;
    cleanup: () => Promise<void>;
}> {
    // Physical path: claims are keyed on the resolved project path (see FleetGuestService.projectPath).
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'spur-renewer-')));
    const db = await createMigratedDb({ url: ':memory:' });
    const service = new FleetGuestService({
        cwd,
        fs: createNodeFileSystem(cwd),
        getDb: async () => db,
        leaseTtlMs: TTL_MS,
    });
    return { service, db, cwd, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

const reader = createPsProcessIdentityReader();

/** A real, long-lived process to stand in for the agent. */
function startFixture(): { pid: number; stop: () => Promise<void> } {
    const child = Bun.spawn(['sleep', '60'], { stdout: 'ignore', stderr: 'ignore' });
    return {
        pid: child.pid,
        stop: async () => {
            child.kill();
            await child.exited;
        },
    };
}

/** Read a live process fingerprint, retrying until `ps` reports it. */
async function identityOf(pid: number): Promise<ProcessIdentity> {
    for (let attempt = 0; attempt < 40; attempt++) {
        const identity = await reader.read(pid);
        if (identity !== null) return identity;
        await Bun.sleep(25);
    }
    throw new Error(`fixture process ${pid} never appeared in the process table`);
}

async function joinVerified(
    service: FleetGuestService,
    id: string,
    identity: ProcessIdentity,
): Promise<ProcessFingerprint> {
    const result = await service.join({
        role: 'coder',
        id,
        sessionId: 'sess-renewer',
        pid: identity.pid,
        processStartedAt: identity.startedAt,
        executable: identity.executable,
        identity: 'verified',
    });
    if (!result.ok) throw new Error(`join failed: ${result.message}`);
    expect(result.guest.identity).toBe('verified');
    expect(result.guest.pid).toBe(identity.pid);
    return { pid: identity.pid, startedAt: identity.startedAt };
}

describe('GuestLeaseRenewer (1279 R1 — 3× TTL of work with no inbox wait)', () => {
    test('keeps the claim live past three lease TTLs and expire() never retires it', async () => {
        const { service, db, cwd, cleanup } = await makeGuestService();
        const fixture = startFixture();
        try {
            const fingerprint = await joinVerified(service, 'coder-g1', await identityOf(fixture.pid));
            const claimBefore = await new ProjectClaimDao(db).get(cwd, 'guest:coder-g1');
            const abort = new AbortController();
            const renewer = new GuestLeaseRenewer({
                guests: service,
                identity: fingerprint,
                reader,
                intervalMs: INTERVAL_MS,
            });
            const running = renewer.run('coder-g1', abort.signal);

            await Bun.sleep(3 * TTL_MS + 400);

            const claimAfter = await new ProjectClaimDao(db).get(cwd, 'guest:coder-g1');
            expect(claimAfter).not.toBeNull();
            expect(claimAfter?.holderId).toBe('coder-g1');
            // Same generation, later expiry: renewal, not a takeover.
            expect(claimAfter?.ownerEpoch).toBe(claimBefore?.ownerEpoch ?? -1);
            expect(claimAfter?.expiresAt ?? 0).toBeGreaterThan(Date.now());
            expect(await service.expire()).toEqual([]);

            abort.abort();
            expect(await running).toBe('aborted');
        } finally {
            await fixture.stop();
            await cleanup();
        }
    });
});

describe('GuestLeaseRenewer (1279 R3 — renewal stops on loss)', () => {
    test('a dead agent process stops the renewer within one interval', async () => {
        const { service, cleanup } = await makeGuestService();
        const fixture = startFixture();
        try {
            const fingerprint = await joinVerified(service, 'coder-g2', await identityOf(fixture.pid));
            await fixture.stop();
            const renewer = new GuestLeaseRenewer({
                guests: service,
                identity: fingerprint,
                reader,
                intervalMs: INTERVAL_MS,
            });
            expect(await renewer.run('coder-g2')).toBe('identity-lost');
        } finally {
            await cleanup();
        }
    });

    test('a reused PID with a different birth time cannot keep the lease alive', async () => {
        const { service, cleanup } = await makeGuestService();
        const fixture = startFixture();
        try {
            const live = await identityOf(fixture.pid);
            // Same pid, older birth time — exactly what a recycled pid looks like.
            const fingerprint = { pid: live.pid, startedAt: 'Wed Jan  1 00:00:00 2020' };
            await joinVerified(service, 'coder-g3', live);
            const renewer = new GuestLeaseRenewer({
                guests: service,
                identity: fingerprint,
                reader,
                intervalMs: INTERVAL_MS,
            });
            expect(await renewer.run('coder-g3')).toBe('identity-lost');
        } finally {
            await fixture.stop();
            await cleanup();
        }
    });

    test('an explicit leave stops renewal instead of resurrecting the guest', async () => {
        const { service, cleanup } = await makeGuestService();
        const fixture = startFixture();
        try {
            const fingerprint = await joinVerified(service, 'coder-g4', await identityOf(fixture.pid));
            expect(await service.leave('coder-g4')).toBe(true);
            const renewer = new GuestLeaseRenewer({
                guests: service,
                identity: fingerprint,
                reader,
                intervalMs: INTERVAL_MS,
            });
            expect(await renewer.run('coder-g4')).toBe('record-gone');
        } finally {
            await fixture.stop();
            await cleanup();
        }
    });

    test('a lease taken by another holder fails the epoch fence', async () => {
        const { service, db, cwd, cleanup } = await makeGuestService();
        const fixture = startFixture();
        try {
            const fingerprint = await joinVerified(service, 'coder-g5', await identityOf(fixture.pid));
            const dao = new ProjectClaimDao(db);
            const held = await dao.get(cwd, 'guest:coder-g5');
            await dao.release(cwd, 'guest:coder-g5', 'coder-g5', held?.ownerEpoch ?? 0);
            expect(await dao.claim(cwd, 'guest:coder-g5', 'other-holder', TTL_MS)).not.toBeNull();

            const renewer = new GuestLeaseRenewer({
                guests: service,
                identity: fingerprint,
                reader,
                intervalMs: INTERVAL_MS,
            });
            expect(await renewer.run('coder-g5')).toBe('fence-lost');
        } finally {
            await fixture.stop();
            await cleanup();
        }
    });

    test('a transient ledger error does not end renewal — the next tick re-checks everything', async () => {
        const { service, cleanup } = await makeGuestService();
        try {
            const joined = await service.join({ role: 'coder', id: 'coder-g7', identity: 'unverified' });
            expect(joined.ok).toBe(true);
            let ticks = 0;
            const flaky = {
                read: async (id: string) => await service.read(id),
                heartbeat: async (id: string) => {
                    ticks += 1;
                    if (ticks === 1) throw new Error('SQLITE_BUSY: database is locked');
                    return await service.heartbeat(id);
                },
            };
            const errors: unknown[] = [];
            const abort = new AbortController();
            const renewer = new GuestLeaseRenewer({
                guests: flaky,
                identity: null,
                reader,
                intervalMs: 20,
                onTickError: (error) => errors.push(error),
            });
            const running = renewer.run('coder-g7', abort.signal);
            await Bun.sleep(150);
            abort.abort();
            expect(await running).toBe('aborted');
            expect(errors).toHaveLength(1);
            expect(ticks).toBeGreaterThan(1);
        } finally {
            await cleanup();
        }
    });

    test('an unverified identity still renews, and the lifetime cap bounds an orphaned renewer', async () => {
        const { service, cleanup } = await makeGuestService();
        try {
            const joined = await service.join({ role: 'coder', id: 'coder-g6', identity: 'unverified' });
            expect(joined.ok).toBe(true);
            const guest = joined.ok ? joined.guest : undefined;
            expect(guest?.pid).toBeNull();
            expect(guest?.identity).toBe('unverified');

            const capped = new GuestLeaseRenewer({
                guests: service,
                identity: null,
                reader,
                intervalMs: INTERVAL_MS,
                maxLifetimeMs: 0,
            });
            expect(await capped.run('coder-g6')).toBe('max-lifetime');
        } finally {
            await cleanup();
        }
    });
});
