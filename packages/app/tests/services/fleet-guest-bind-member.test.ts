/**
 * Task 1281 R1–R3 — fenced declared-member binding.
 *
 * Failure list this pins (Plan step 1), each as a refusal that leaves nothing behind:
 *   - an unknown or disabled member binds                       → named code, no claim/row/record
 *   - a role that is not the member's role binds                → `role-mismatch`
 *   - an executor with no attestation binds                     → `capability-unattested`
 *   - a member with a live supervised occupant binds            → `live-occupant`
 *   - two binders race and both win                             → exactly one wins, the loser is clean
 *   - a stale binder keeps claiming/accreting through `wait`    → the epoch/generation fence says no
 *   - a plain guest already joined under that id                → `collision`, not an upgrade
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationRunDao, createMigratedDb, ProjectClaimDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    type DeclaredMemberView,
    FleetGuestService,
    type GuestRecord,
    MEMBER_BINDING_CAPABILITIES,
} from '../../src/index';

const CODER: DeclaredMemberView = { instanceId: 'proj-coder-1', role: 'coder', executor: 'fast-lane', enabled: true };

interface Fixture {
    service: FleetGuestService;
    db: Awaited<ReturnType<typeof createMigratedDb>>;
    cwd: string;
    cleanup: () => Promise<void>;
}

async function makeService(
    overrides: {
        members?: DeclaredMemberView[];
        attest?: (member: DeclaredMemberView) => Promise<{ ok: boolean; detail: string }>;
        wake?: string | null;
    } = {},
): Promise<Fixture> {
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'spur-member-bind-')));
    const db = await createMigratedDb({ url: ':memory:' });
    const members = overrides.members ?? [CODER];
    const service = new FleetGuestService({
        cwd,
        fs: createNodeFileSystem(cwd),
        getDb: async () => db,
        declaredMemberIds: async () => members.map((member) => member.instanceId),
        resolveDeclaredMember: async (memberId) => members.find((member) => member.instanceId === memberId) ?? null,
        attestMemberCapabilities: overrides.attest ?? (async () => ({ ok: true, detail: 'all stage axes attested' })),
        hostWake: async () => (overrides.wake === undefined ? 'hook' : overrides.wake),
    });
    return { service, db, cwd, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

/** Nothing was left behind: no claim, no running occupant row, no record. */
async function expectClean(fixture: Fixture, memberId: string): Promise<void> {
    const claim = await new ProjectClaimDao(fixture.db).get(fixture.cwd, `guest:${memberId}`);
    const live = claim !== null && claim.expiresAt > Date.now();
    expect(live).toBe(false);
    expect(await new CoordinationRunDao(fixture.db).hasRunning(memberId)).toBe(false);
    expect(await fixture.service.read(memberId)).toBeNull();
}

describe('bindMember refusals (1281 R1/R2)', () => {
    test('an unknown member is refused with its own code and leaves nothing behind', async () => {
        const fixture = await makeService();
        try {
            const result = await fixture.service.bindMember({ memberId: 'nobody', role: 'coder' });
            expect(result.ok ? 'ok' : result.code).toBe('unknown-member');
            await expectClean(fixture, 'nobody');
        } finally {
            await fixture.cleanup();
        }
    });

    test('a disabled member is refused', async () => {
        const fixture = await makeService({ members: [{ ...CODER, enabled: false, executor: '' }] });
        try {
            const result = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' });
            expect(result.ok ? 'ok' : result.code).toBe('disabled-member');
            await expectClean(fixture, CODER.instanceId);
        } finally {
            await fixture.cleanup();
        }
    });

    test("a role that is not the member's role is refused", async () => {
        const fixture = await makeService();
        try {
            const result = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'reviewer' });
            expect(result.ok ? 'ok' : result.code).toBe('role-mismatch');
            expect(result.ok ? '' : result.message).toContain('coder');
            await expectClean(fixture, CODER.instanceId);
        } finally {
            await fixture.cleanup();
        }
    });

    test('an executor that cannot attest the stage capabilities is refused, not downgraded', async () => {
        const fixture = await makeService({
            attest: async () => ({ ok: false, detail: 'fsWrite: required=available actual=unknown' }),
        });
        try {
            const result = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' });
            expect(result.ok ? 'ok' : result.code).toBe('capability-unattested');
            expect(result.ok ? '' : result.message).toContain('fsWrite');
            await expectClean(fixture, CODER.instanceId);
        } finally {
            await fixture.cleanup();
        }
    });

    test('a member with a live supervised occupant is refused', async () => {
        const fixture = await makeService();
        try {
            await new CoordinationRunDao(fixture.db).insertStart({
                specId: CODER.instanceId,
                agentKind: 'coder',
                processId: null,
                runId: crypto.randomUUID(),
                generation: 1,
                startedAt: new Date().toISOString(),
            });
            const result = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' });
            expect(result.ok ? 'ok' : result.code).toBe('live-occupant');
            expect(await fixture.service.read(CODER.instanceId)).toBeNull();
            // The supervised occupant keeps its row: no orphan record was written for it.
            expect(await new CoordinationRunDao(fixture.db).hasRunning(CODER.instanceId)).toBe(true);
        } finally {
            await fixture.cleanup();
        }
    });

    test('a plain guest already joined under that id is a collision, not an upgrade', async () => {
        const fixture = await makeService();
        try {
            // A guest can never take a declared member id (that is `join`'s own refusal), so the
            // record is laid down directly here: the binding must still refuse to adopt it.
            const dir = join(fixture.cwd, '.spur/run/guests');
            await mkdir(dir, { recursive: true });
            await writeFile(
                join(dir, `${CODER.instanceId}.json`),
                `${JSON.stringify({
                    id: CODER.instanceId,
                    role: 'coder',
                    sessionId: null,
                    pid: null,
                    executor: 'coder',
                    ownerEpoch: 1,
                    runId: 'plain-guest-run',
                    joinedAt: '2026-10-22T00:00:00.000Z',
                    identity: 'unverified',
                    renewerPid: null,
                })}\n`,
            );
            const result = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' });
            expect(result.ok ? 'ok' : result.code).toBe('collision');
            expect((await fixture.service.read(CODER.instanceId))?.memberBinding).toBeUndefined();
        } finally {
            await fixture.cleanup();
        }
    });

    test('two concurrent binders: exactly one wins and the loser leaves no claim, row or record', async () => {
        const fixture = await makeService();
        try {
            const [first, second] = await Promise.all([
                fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' }),
                fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' }),
            ]);
            const winners = [first, second].filter((result) => result.ok);
            expect(winners).toHaveLength(1);
            const loser = [first, second].find((result) => !result.ok);
            expect(loser === undefined ? 'ok' : loser.code).not.toBe('ok');
            // The surviving binding owns exactly one occupant row and one record.
            const record = await fixture.service.read(CODER.instanceId);
            expect(record?.memberBinding?.memberId).toBe(CODER.instanceId);
            const rows = await fixture.db.queryAll<{ run_id: string }>(
                'SELECT run_id FROM coordination_runs WHERE spec_id = ?',
                CODER.instanceId,
            );
            expect(rows.filter((row) => row.run_id === record?.runId)).toHaveLength(1);
        } finally {
            await fixture.cleanup();
        }
    });
});

describe('a successful binding (1281 R1/R2/R3)', () => {
    test('records the fenced binding, makes the member busy, and keeps the member inbox addressable', async () => {
        const fixture = await makeService();
        try {
            const result = await fixture.service.bindMember({
                memberId: CODER.instanceId,
                role: 'coder',
                sessionId: 'sess-bind',
                pid: 4242,
                identity: 'unverified',
            });
            expect(result.ok).toBe(true);
            const guest: GuestRecord | undefined = result.ok ? result.guest : undefined;
            expect(guest?.memberBinding).toEqual({
                memberId: CODER.instanceId,
                occupancyGeneration: 1,
                ownerEpoch: guest?.ownerEpoch ?? -1,
                version: 1,
                stageEligible: true,
            });
            expect(guest?.id).toBe(CODER.instanceId);
            // The supervised side sees the member busy through the same row it always reads.
            expect(await new CoordinationRunDao(fixture.db).hasRunning(CODER.instanceId)).toBe(true);
            // The record id is the address: the pull surface reads the member's inbox.
            expect(await fixture.service.pendingCount(CODER.instanceId)).toBe(0);
            expect(await fixture.service.heartbeat(CODER.instanceId)).toBe(true);
        } finally {
            await fixture.cleanup();
        }
    });

    test('a pull-only host still binds but is not stage-eligible', async () => {
        const fixture = await makeService({ wake: 'pull-only' });
        try {
            const result = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' });
            expect(result.ok ? result.guest.memberBinding?.stageEligible : true).toBe(false);
        } finally {
            await fixture.cleanup();
        }
    });

    test('the stage-capability baseline is the three axes a task stage needs', () => {
        expect(Object.keys(MEMBER_BINDING_CAPABILITIES).sort()).toEqual(['fsRead', 'fsWrite', 'processSpawn']);
    });
});

describe('a stale record cannot release the new owner (1281 R3)', () => {
    test('leave on a superseded binding leaves the current claim and occupant row alone', async () => {
        const fixture = await makeService();
        try {
            const bound = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' });
            expect(bound.ok).toBe(true);
            // Takeover: a newer occupant generation and a new lease epoch for the same member.
            const db = fixture.db;
            const held = await new ProjectClaimDao(db).get(fixture.cwd, `guest:${CODER.instanceId}`);
            await new ProjectClaimDao(db).release(
                fixture.cwd,
                `guest:${CODER.instanceId}`,
                CODER.instanceId,
                held?.ownerEpoch ?? 0,
            );
            const taken = await new ProjectClaimDao(db).claim(
                fixture.cwd,
                `guest:${CODER.instanceId}`,
                CODER.instanceId,
                30_000,
            );
            await new CoordinationRunDao(db).insertStart({
                specId: CODER.instanceId,
                agentKind: 'coder',
                processId: null,
                runId: 'new-owner-run',
                generation: (bound.ok ? (bound.guest.memberBinding?.occupancyGeneration ?? 1) : 1) + 1,
                startedAt: new Date().toISOString(),
            });

            // The superseded binder calls leave: it must not release the new owner's lease or row.
            expect(await fixture.service.leave(CODER.instanceId)).toBe(true);
            const after = await new ProjectClaimDao(db).get(fixture.cwd, `guest:${CODER.instanceId}`);
            expect(after?.expiresAt ?? 0).toBeGreaterThan(Date.now());
            expect(after?.ownerEpoch).toBe(taken?.ownerEpoch ?? -1);
            expect(await new CoordinationRunDao(db).hasRunning(CODER.instanceId)).toBe(true);
        } finally {
            await fixture.cleanup();
        }
    });
});

describe('fenced pull after a takeover (1281 R3)', () => {
    test('a newer generation makes the old binder stale — every later heartbeat/claim is refused', async () => {
        const fixture = await makeService();
        try {
            const bound = await fixture.service.bindMember({ memberId: CODER.instanceId, role: 'coder' });
            expect(bound.ok).toBe(true);
            const db = fixture.db;
            // A competing binder takes the member over: release the claim, then claim + row again.
            const taken = await new ProjectClaimDao(db).get(fixture.cwd, `guest:${CODER.instanceId}`);
            await new ProjectClaimDao(db).release(
                fixture.cwd,
                `guest:${CODER.instanceId}`,
                CODER.instanceId,
                taken?.ownerEpoch ?? 0,
            );
            expect(
                await new ProjectClaimDao(db).claim(fixture.cwd, `guest:${CODER.instanceId}`, CODER.instanceId, 30_000),
            ).not.toBeNull();
            await new CoordinationRunDao(db).insertStart({
                specId: CODER.instanceId,
                agentKind: 'coder',
                processId: null,
                runId: crypto.randomUUID(),
                generation: (bound.ok ? (bound.guest.memberBinding?.occupancyGeneration ?? 1) : 1) + 1,
                startedAt: new Date().toISOString(),
            });

            // The old binder's renew (and therefore its claim/accept in `wait --inbox`) is refused.
            expect(await fixture.service.heartbeat(CODER.instanceId)).toBe(false);
        } finally {
            await fixture.cleanup();
        }
    });
});
