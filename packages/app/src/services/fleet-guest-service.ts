import { join } from 'node:path';
import type { RequiresCapabilities } from '@gobing-ai/spur-config';
import {
    CLAIM_TTL_MS,
    type ClaimSlot,
    CoordinationRunDao,
    type DbAdapter,
    ProjectClaimDao,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { InboxService, isReservedInboxId } from './inbox-service';
import { normalizeProjectPath } from './project-process';

// ---------------------------------------------------------------------------
// Fleet guest occupants (G73 R2/R5, task 1081)
// ---------------------------------------------------------------------------

/**
 * How long a guest lease survives without a heartbeat. Same granularity as the
 * write-slot lease: a live session heartbeats on every `wait --inbox` call and on
 * every Stop-hook fire; a session that stops looping expires.
 */
export const GUEST_LEASE_TTL_MS = CLAIM_TTL_MS;

/** Layer-1 roles a guest may claim; mirrors the `sp` role vocabulary. */
export const GUEST_ROLES: readonly string[] = ['scribe', 'coder', 'reviewer', 'planner'];

/** `.spur/run/guests/<id>.json`, relative to the project root. */
export const GUEST_RECORD_DIR = join('.spur', 'run', 'guests');

/**
 * One joined guest session. Written by `spur agent join`, read by the Stop hook
 * (`sessionId` match) and by `spur agent leave`/`heartbeat` — deliberately a file,
 * so a host hook finds the joined session without paying for a CLI round trip.
 */
export interface GuestRecord {
    id: string;
    role: string;
    /** Host session id the guest belongs to (`CLAUDE_CODE_SESSION_ID` by default). */
    sessionId: string | null;
    /**
     * The guest's **agent** process — never the short-lived joining CLI (G75 R2). `null`
     * when identity could not be verified, in which case the record makes no liveness claim.
     */
    pid: number | null;
    /** Executor the guest runs as; informational, never dispatched to. */
    executor: string;
    /** The `guest:<id>` claim's fencing token (R5). */
    ownerEpoch: number;
    /** The `coordination_runs` row that makes the guest addressable as an occupant. */
    runId: string;
    joinedAt: string;
    /** Whether {@link GuestRecord.pid} is a verified agent-process fingerprint (G75 R2). */
    identity: GuestIdentityState;
    /** `ps` `lstart` birth time of the agent process; the PID-reuse anchor. */
    processStartedAt?: string;
    /** Executable path of the agent process (`ps` `comm`). */
    executable?: string;
    /** The live lease renewer, so a rejoin spawns one owner, not two (G75 R1/R4). */
    renewerPid: number | null;
    /** Birth time of the renewer process, for the same PID-reuse check. */
    renewerStartedAt?: string;
    /**
     * Present when this occupant bound a **declared member** instead of joining as a plain
     * guest (G75 R3, task 1281). The record id is then the member id, so `wait --inbox
     * <member-id>` addresses the declared member's inbox.
     */
    memberBinding?: MemberBinding;
}

/** One fenced binding of a live session to a declared member (G75 R3, task 1281). */
export interface MemberBinding {
    memberId: string;
    /** `coordination_runs` generation this binder owns; a later generation makes it stale. */
    occupancyGeneration: number;
    /** The `guest:<memberId>` claim epoch at bind time. */
    ownerEpoch: number;
    /** Additive record version — the only shape this build writes. */
    version: 1;
    /**
     * Whether this occupant may run stages: false when the binder's host has only the
     * `pull-only` wake channel (1280's capability report) — it may still receive messages.
     */
    stageEligible: boolean;
    /**
     * When the attached handshake completed (task 1282): the first lifecycle report this
     * binder sent with a matching host binding pin (§4). Absent = never handshook — the
     * occupant is not stage-selectable even when it reports `idle`.
     */
    handshakeAt?: string;
    /**
     * Set by graceful `leave` on a bound member (task 1282): stop new assignment, let the
     * in-flight turn settle (outcome-unknown work stays resumable), then retire.
     */
    draining?: true;
    /** When draining began; the grace budget starts here. */
    drainingAt?: string;
}

/**
 * Grace window a draining bound occupant gets to settle its in-flight turn (task 1282).
 * Same granularity as the lease: one claim cycle. After the window the leave proceeds —
 * an unsettled turn stays outcome-unknown and resumable, never force-failed.
 */
export const ATTACHED_DRAIN_GRACE_MS = CLAIM_TTL_MS;

/** Whether a guest's process identity was proven against the host process table. */
export type GuestIdentityState = 'verified' | 'unverified';

/** Input for {@link FleetGuestService.join}. */
export interface GuestJoinInput {
    role: string;
    id?: string;
    sessionId?: string;
    /** Verified agent-process pid; omit when identity is unverified. */
    pid?: number;
    executor?: string;
    /** `ps` `lstart` of {@link GuestJoinInput.pid}. */
    processStartedAt?: string;
    /** Executable path of {@link GuestJoinInput.pid}. */
    executable?: string;
    /** Defaults to `unverified` — only a proven fingerprint may claim `verified`. */
    identity?: GuestIdentityState;
}

/** Why a join was refused. Both are operator errors → the CLI exits 2. */
export type GuestJoinFailureCode = 'unknown-role' | 'collision';

/** The host binding pin a bound occupant must present (design §4, task 1282). */
export interface MemberPin {
    ownerEpoch: number;
    occupancyGeneration: number;
}

/** Why a pin-fenced member operation was refused. Operator errors → the CLI exits 2. */
export type MemberPinFailureCode = 'unknown-guest' | 'not-bound' | 'stale-pin';

/** Result of the pin-fenced member operations ({@link FleetGuestService.fenceMemberReport}). */
export type MemberPinResult =
    | { ok: true; binding: MemberBinding }
    | { ok: false; code: MemberPinFailureCode; message: string };

/** Result of {@link FleetGuestService.join}. */
export type GuestJoinResult =
    | { ok: true; guest: GuestRecord }
    | { ok: false; code: GuestJoinFailureCode; message: string };

/** Injected seams — the ledger, the project filesystem and the declared roster. */
export interface FleetGuestServiceContext {
    cwd: string;
    fs: FileSystem;
    getDb(): Promise<DbAdapter>;
    /**
     * Declared member instance ids (never guests): a guest id must not collide with one,
     * and role resolution must never see a guest (R3). Required for {@link FleetGuestService.join}
     * — the only method that allocates or validates an id; {@link FleetGuestService.expire}
     * needs the ledger alone.
     */
    declaredMemberIds?(): Promise<string[]>;
    /** Resolve one declared member for a `--member` binding (roster view, never a guest). */
    resolveDeclaredMember?(memberId: string): Promise<DeclaredMemberView | null>;
    /** Capability proof for the member's declared executor; the app owns attestation. */
    attestMemberCapabilities?(member: DeclaredMemberView): Promise<{ ok: boolean; detail: string }>;
    /** The binder host's wake channel (1280's report); `pull-only` binds but is not stage-eligible. */
    hostWake?(executor: string): Promise<string | null>;
    /** Role vocabulary; defaults to {@link GUEST_ROLES}. */
    roles?: readonly string[];
    /** Lease TTL override — the test seam for renewal ratios; defaults to the real TTL. */
    leaseTtlMs?: number;
}

const GUEST_CLAIM_PREFIX = 'guest:';

/** The declared-member view a binding validates against — never a guest (G75 R3). */
export interface DeclaredMemberView {
    /** `<projectSlug>-<memberLocalId>`: the spec id and the inbox address. */
    instanceId: string;
    role?: string;
    /** Declared executor; `''` when the member is disabled and never resolved. */
    executor: string;
    enabled: boolean;
}

/**
 * Capability axes a stage-eligible binding must attest. A binding that cannot prove them is
 * refused rather than bound-and-disabled: an unverified stage capability is exactly what R3
 * forbids promising (0706 R5 — unknown never satisfies a requirement).
 */
export const MEMBER_BINDING_CAPABILITIES: Partial<RequiresCapabilities> = {
    fsRead: 'available',
    fsWrite: 'available',
    processSpawn: 'available',
};

/** Why a member binding was refused. Every code is an operator error → the CLI exits 2. */
export type GuestBindFailureCode =
    | 'unknown-role'
    | 'unknown-member'
    | 'disabled-member'
    | 'role-mismatch'
    | 'capability-unattested'
    | 'live-occupant'
    | 'collision';

/** Input for {@link FleetGuestService.bindMember}. */
export interface GuestBindInput extends GuestJoinInput {
    /** Declared member instance id to bind. */
    memberId: string;
}

/** Result of {@link FleetGuestService.bindMember}. */
export type GuestBindResult =
    | { ok: true; guest: GuestRecord }
    | { ok: false; code: GuestBindFailureCode; message: string };

/**
 * Guest occupancy: a live interactive session that joins the fleet to pull work
 * instead of being driven by it (G73 R2). A guest is registered only here — never
 * in the fleet declaration, never supervised, never restarted, never a role target.
 *
 * State lives in two places and no new table:
 * - identity = a `coordination_runs` row (`spec_id` = guest id), so ADR-075
 *   occupant pins and `hasRunning` behave as they already do;
 * - the lease = a `ProjectClaimDao` claim on the `guest:<id>` slot (R5), so the
 *   write slot's heartbeat semantics apply unchanged.
 * The record file lets the host Stop hook recognize its own session without a CLI call.
 */
export class FleetGuestService {
    constructor(private readonly ctx: FleetGuestServiceContext) {}

    /** Every joined guest, oldest first. Unreadable records are skipped, never thrown. */
    async list(): Promise<GuestRecord[]> {
        let names: string[];
        try {
            names = await this.ctx.fs.readDir(this.dir());
        } catch {
            return [];
        }
        const guests: GuestRecord[] = [];
        for (const name of names) {
            if (!name.endsWith('.json')) continue;
            const record = await this.read(name.slice(0, -'.json'.length));
            if (record !== null) guests.push(record);
        }
        return guests.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id));
    }

    /** One guest by id, or null when there is no readable record. */
    async read(id: string): Promise<GuestRecord | null> {
        try {
            const raw = await this.ctx.fs.readFile(join(this.dir(), `${id}.json`));
            const parsed = JSON.parse(raw) as Partial<GuestRecord>;
            if (typeof parsed.id !== 'string' || typeof parsed.role !== 'string') return null;
            return {
                id: parsed.id,
                role: parsed.role,
                sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
                pid: typeof parsed.pid === 'number' ? parsed.pid : null,
                executor: typeof parsed.executor === 'string' ? parsed.executor : parsed.role,
                ownerEpoch: typeof parsed.ownerEpoch === 'number' ? parsed.ownerEpoch : 0,
                runId: typeof parsed.runId === 'string' ? parsed.runId : '',
                joinedAt: typeof parsed.joinedAt === 'string' ? parsed.joinedAt : '',
                // A record written before G75 has no identity field: it never claimed a
                // verified agent process, so it reads as unverified rather than defaulting up.
                identity: parsed.identity === 'verified' ? 'verified' : 'unverified',
                ...(typeof parsed.processStartedAt === 'string' ? { processStartedAt: parsed.processStartedAt } : {}),
                ...(typeof parsed.executable === 'string' ? { executable: parsed.executable } : {}),
                renewerPid: typeof parsed.renewerPid === 'number' ? parsed.renewerPid : null,
                ...(typeof parsed.renewerStartedAt === 'string' ? { renewerStartedAt: parsed.renewerStartedAt } : {}),
                ...(isMemberBinding(parsed.memberBinding) ? { memberBinding: parsed.memberBinding } : {}),
            };
        } catch {
            return null;
        }
    }

    /**
     * Register a guest occupant (R2). Refuses an unknown role and an id that collides
     * with a declared member or an existing guest — both exit-2 operator errors, never a
     * silent rename, because the id is the address other agents send work to.
     */
    async join(input: GuestJoinInput): Promise<GuestJoinResult> {
        const roles = this.ctx.roles ?? GUEST_ROLES;
        const role = input.role.trim();
        if (!roles.includes(role)) {
            return {
                ok: false,
                code: 'unknown-role',
                message: `--role "${input.role}" is not a Layer-1 role (accepted: ${roles.join(', ')})`,
            };
        }
        const declared = new Set((await this.ctx.declaredMemberIds?.()) ?? []);
        const guests = await this.list();
        const joined = new Set(guests.map((g) => g.id));
        const requested = input.id?.trim();
        const id = requested !== undefined && requested !== '' ? requested : this.nextGuestId(role, declared, joined);
        // G11 R5: `operator` and `spur` are reserved inbox identities — a guest claiming one
        // would shadow the human's or the system's inbox.
        if (isReservedInboxId(id)) {
            return {
                ok: false,
                code: 'collision',
                message: `guest id "${id}" is a reserved inbox identity — pass a free --id`,
            };
        }
        // A restarted session rejoining its own live guest renews it rather than colliding:
        // the session id proves it is the same occupant. Absent or different sessions fall
        // through to the collision refusal below.
        const own = guests.find((g) => g.id === id);
        if (own !== undefined && own.sessionId !== null && own.sessionId === (input.sessionId ?? null)) {
            if (await this.heartbeat(id)) return { ok: true, guest: own };
        }
        if (declared.has(id) || joined.has(id)) {
            return {
                ok: false,
                code: 'collision',
                message: `guest id "${id}" already belongs to a declared member or a joined guest — pass a free --id`,
            };
        }

        const db = await this.ctx.getDb();
        // Claim before inserting the occupant row: a refused claim must not leave a
        // `running` occupant behind that nothing will ever retire.
        const claim = await new ProjectClaimDao(db).claim(this.projectPath(), this.slot(id), id, this.ttlMs());
        if (claim === null) {
            return {
                ok: false,
                code: 'collision',
                message: `guest id "${id}" already holds a live lease — leave it first or pass a free --id`,
            };
        }
        const runId = crypto.randomUUID();
        const generation = ((await new CoordinationRunDao(db).maxGeneration(id)) ?? 0) + 1;
        await new CoordinationRunDao(db).insertStart({
            specId: id,
            agentKind: input.executor ?? role,
            processId: input.pid !== null && input.pid !== undefined ? String(input.pid) : null,
            runId,
            generation,
            startedAt: new Date().toISOString(),
        });
        const record: GuestRecord = {
            id,
            role,
            sessionId: input.sessionId ?? null,
            pid: input.pid ?? null,
            executor: input.executor ?? role,
            ownerEpoch: claim.ownerEpoch,
            runId,
            joinedAt: new Date().toISOString(),
            // `verified` is only ever set alongside a pid: an identity with no process to
            // re-check is not a proof, and the renewer must not renew on it.
            identity: input.identity === 'verified' && input.pid !== undefined ? 'verified' : 'unverified',
            ...(input.processStartedAt !== undefined ? { processStartedAt: input.processStartedAt } : {}),
            ...(input.executable !== undefined ? { executable: input.executable } : {}),
            renewerPid: null,
        };
        await this.ctx.fs.ensureDir(this.dir());
        await this.ctx.fs.writeFile(join(this.dir(), `${id}.json`), `${JSON.stringify(record, null, 4)}\n`);
        return { ok: true, guest: record };
    }

    /**
     * Bind a live session to a **declared member** (G75 R3, task 1281) instead of joining as a
     * plain guest. Validation is fail-closed and ordered so a refusal leaves nothing behind:
     * member exists → enabled → role matches → executor attested → no live occupant → claim →
     * occupant row (generation + 1) → record. A failure after the claim releases it; a failure
     * after the occupant row marks that row exited.
     *
     * The record id IS the member id: `wait --inbox <member-id>` then addresses the declared
     * member's inbox, and a supervised spawn sees the member busy through `hasRunning`.
     */
    async bindMember(input: GuestBindInput): Promise<GuestBindResult> {
        const roles = this.ctx.roles ?? GUEST_ROLES;
        const role = input.role.trim();
        if (!roles.includes(role)) {
            return {
                ok: false,
                code: 'unknown-role',
                message: `--role "${input.role}" is not a Layer-1 role (accepted: ${roles.join(', ')})`,
            };
        }
        const memberId = input.memberId.trim();
        if (memberId === '' || isReservedInboxId(memberId)) {
            return { ok: false, code: 'unknown-member', message: `"${input.memberId}" is not a bindable member id` };
        }
        const resolve = this.ctx.resolveDeclaredMember;
        if (resolve === undefined) {
            return {
                ok: false,
                code: 'unknown-member',
                message: 'this caller has no roster seam, so `--member` cannot resolve a declared member',
            };
        }
        const member = await resolve(memberId);
        if (member === null) {
            return { ok: false, code: 'unknown-member', message: `"${memberId}" is not a declared member` };
        }
        if (!member.enabled) {
            return { ok: false, code: 'disabled-member', message: `member "${memberId}" is disabled` };
        }
        if (member.role !== undefined && member.role !== role) {
            return {
                ok: false,
                code: 'role-mismatch',
                message: `member "${memberId}" declares role "${member.role}", not "${role}"`,
            };
        }
        const attest = this.ctx.attestMemberCapabilities;
        const proof =
            attest === undefined ? { ok: false, detail: 'no capability attestation seam' } : await attest(member);
        if (!proof.ok) {
            return {
                ok: false,
                code: 'capability-unattested',
                message: `executor "${member.executor}" cannot attest the stage capabilities: ${proof.detail}`,
            };
        }
        // A plain guest already joined under this id is a collision, not an upgrade.
        const existing = await this.read(memberId);
        if (existing !== null && existing.memberBinding === undefined) {
            return {
                ok: false,
                code: 'collision',
                message: `"${memberId}" already belongs to a joined guest — leave it first`,
            };
        }
        const db = await this.ctx.getDb();
        if (await new CoordinationRunDao(db).hasRunning(memberId)) {
            return {
                ok: false,
                code: 'live-occupant',
                message: `member "${memberId}" already has a live occupant (a running agent or loop)`,
            };
        }
        const claim = await new ProjectClaimDao(db).claim(
            this.projectPath(),
            this.slot(memberId),
            memberId,
            this.ttlMs(),
        );
        if (claim === null) {
            return {
                ok: false,
                code: 'collision',
                message: `member "${memberId}" is already bound — leave the current binder first`,
            };
        }
        const runId = crypto.randomUUID();
        const occupancyGeneration = ((await new CoordinationRunDao(db).maxGeneration(memberId)) ?? 0) + 1;
        try {
            await new CoordinationRunDao(db).insertStart({
                specId: memberId,
                agentKind: input.executor ?? member.executor,
                processId: input.pid !== undefined ? String(input.pid) : null,
                runId,
                generation: occupancyGeneration,
                startedAt: new Date().toISOString(),
            });
        } catch (error) {
            await new ProjectClaimDao(db).release(this.projectPath(), this.slot(memberId), memberId, claim.ownerEpoch);
            return { ok: false, code: 'collision', message: `could not take the occupant row: ${String(error)}` };
        }
        const wake = this.ctx.hostWake === undefined ? null : await this.ctx.hostWake(member.executor);
        const record: GuestRecord = {
            id: memberId,
            role,
            sessionId: input.sessionId ?? null,
            pid: input.pid ?? null,
            executor: input.executor ?? member.executor,
            ownerEpoch: claim.ownerEpoch,
            runId,
            joinedAt: new Date().toISOString(),
            identity: input.identity === 'verified' && input.pid !== undefined ? 'verified' : 'unverified',
            ...(input.processStartedAt !== undefined ? { processStartedAt: input.processStartedAt } : {}),
            ...(input.executable !== undefined ? { executable: input.executable } : {}),
            renewerPid: null,
            memberBinding: {
                memberId,
                occupancyGeneration,
                ownerEpoch: claim.ownerEpoch,
                version: 1,
                stageEligible: wake !== null && wake !== 'pull-only',
            },
        };
        try {
            await this.ctx.fs.ensureDir(this.dir());
            await this.ctx.fs.writeFile(join(this.dir(), `${memberId}.json`), `${JSON.stringify(record, null, 4)}\n`);
        } catch (error) {
            await new CoordinationRunDao(db).updateExit(runId, 'exited', new Date().toISOString(), '[]', {
                messageIds: [],
                outcome: 'run-exit-only',
            });
            await new ProjectClaimDao(db).release(this.projectPath(), this.slot(memberId), memberId, claim.ownerEpoch);
            return { ok: false, code: 'collision', message: `could not write the record: ${String(error)}` };
        }
        return { ok: true, guest: record };
    }

    /**
     * Record the live lease renewer for a guest (G75 R4). A no-op when the record is gone:
     * the caller's renewer then stops itself on the next tick.
     */
    async attachRenewer(id: string, renewer: { pid: number; startedAt: string }): Promise<void> {
        const record = await this.read(id);
        if (record === null) return;
        const next: GuestRecord = {
            ...record,
            renewerPid: renewer.pid,
            renewerStartedAt: renewer.startedAt,
        };
        await this.ctx.fs.ensureDir(this.dir());
        await this.ctx.fs.writeFile(join(this.dir(), `${id}.json`), `${JSON.stringify(next, null, 4)}\n`);
    }

    /** Extend the lease (R5). False means the guest is gone or its lease was taken over. */
    async heartbeat(id: string): Promise<boolean> {
        const record = await this.read(id);
        if (record === null) return false;
        const db = await this.ctx.getDb();
        // A bound occupant is fenced twice: the claim epoch (below) and its occupancy
        // generation. A later generation means another binder took the member over, so every
        // renew — and therefore every claim/accept that follows a renew — is refused as stale.
        if (record.memberBinding !== undefined) {
            const generation = (await new CoordinationRunDao(db).maxGeneration(record.memberBinding.memberId)) ?? 0;
            if (generation > record.memberBinding.occupancyGeneration) return false;
        }
        const alive = await new ProjectClaimDao(db).heartbeat(
            this.projectPath(),
            this.slot(id),
            id,
            this.ttlMs(),
            record.ownerEpoch,
        );
        return alive;
    }

    /**
     * Fence a bound occupant's lifecycle report (task 1282, design §4): the report may
     * update the member only when the presented pin matches the record's binding. The first
     * matching report completes the attached handshake — after it, a yielded occupant is
     * stage-selectable; before it, never (AC2). Plain guests pass through untouched.
     */
    async fenceMemberReport(id: string, pin: MemberPin): Promise<MemberPinResult> {
        return await this.fenceMemberPin(id, pin);
    }

    /**
     * Begin the graceful drain for a bound member (task 1282): mark the record draining so
     * selection stops assigning new stages, fence on the pin like every member write.
     * The caller then waits {@link memberDrainSettled} within {@link ATTACHED_DRAIN_GRACE_MS}.
     */
    async beginMemberDrain(id: string, pin: MemberPin): Promise<MemberPinResult> {
        const fenced = await this.fenceMemberPin(id, pin);
        if (!fenced.ok) return fenced;
        if (fenced.binding.draining === true) return fenced; // Idempotent re-entry.
        const record = await this.read(id);
        if (record === null || record.memberBinding === undefined) {
            return { ok: false, code: 'unknown-guest', message: `no bound record for "${id}"` };
        }
        const next: GuestRecord = {
            ...record,
            memberBinding: {
                ...record.memberBinding,
                draining: true,
                drainingAt: new Date().toISOString(),
            },
        };
        await this.ctx.fs.ensureDir(this.dir());
        await this.ctx.fs.writeFile(join(this.dir(), `${id}.json`), `${JSON.stringify(next, null, 4)}\n`);
        return fenced;
    }

    /**
     * Whether a bound member has no in-flight turn: no claimed (accepted, unfinished) inbox
     * request remains. Draining waits on this; an unsettled turn past the grace window stays
     * outcome-unknown and resumable — never force-failed (task 1282 R5).
     */
    async memberDrainSettled(id: string): Promise<boolean> {
        const claimed = (await this.inbox().list(id, 'in', { limit: 1 })).messages.filter(
            (row) => row.status === 'claimed',
        );
        return claimed.length === 0;
    }

    /** Release the lease and retire the occupant. True when a record existed. */
    async leave(id: string): Promise<boolean> {
        const record = await this.read(id);
        if (record === null) return false;
        await this.retire(record);
        return true;
    }

    /**
     * Release every guest whose lease expired: claimed messages return to `queued`
     * (never lost), the occupant row is marked exited, and the record is removed.
     * Returns the expired ids, so a caller can report them.
     */
    async expire(): Promise<string[]> {
        const expired: string[] = [];
        const db = await this.ctx.getDb();
        for (const record of await this.list()) {
            const claim = await new ProjectClaimDao(db).get(this.projectPath(), this.slot(record.id));
            if (claim !== null && claim.expiresAt > Date.now()) continue;
            await this.retire(record);
            expired.push(record.id);
        }
        return expired;
    }

    /** Queued (unclaimed) messages waiting for this guest — the `wait --inbox` predicate. */
    async pendingCount(id: string): Promise<number> {
        return await this.inbox().countQueued(id);
    }

    private inbox(): InboxService {
        return new InboxService({ getDb: () => this.ctx.getDb() });
    }

    /** Shared pin fence: bound record must exist and match both pin halves (§4). */
    private async fenceMemberPin(id: string, pin: MemberPin): Promise<MemberPinResult> {
        const record = await this.read(id);
        if (record === null) {
            return { ok: false, code: 'unknown-guest', message: `no occupant record for "${id}"` };
        }
        const binding = record.memberBinding;
        if (binding === undefined) {
            return { ok: false, code: 'not-bound', message: `"${id}" is a plain guest, not a bound member` };
        }
        if (binding.ownerEpoch !== pin.ownerEpoch || binding.occupancyGeneration !== pin.occupancyGeneration) {
            return {
                ok: false,
                code: 'stale-pin',
                message: `binding pin mismatch for "${id}" — the occupant generation moved`,
            };
        }
        // The handshake completes on the first matched report: write it once, keep the earliest.
        // A pin-matched report proves the attached session is live and reads its inbox, so stage
        // work can reach it through the pull loop — the bind-time wake probe is only a hint.
        if (binding.handshakeAt === undefined) {
            const nextBinding = { ...binding, handshakeAt: new Date().toISOString(), stageEligible: true };
            const next: GuestRecord = { ...record, memberBinding: nextBinding };
            await this.ctx.fs.ensureDir(this.dir());
            await this.ctx.fs.writeFile(join(this.dir(), `${id}.json`), `${JSON.stringify(next, null, 4)}\n`);
            return { ok: true, binding: nextBinding };
        }
        return { ok: true, binding };
    }

    /** Release the lease, retire the occupant row and drop the record. Shared by leave/expire. */
    private async retire(record: GuestRecord): Promise<void> {
        const db = await this.ctx.getDb();
        // A stale record must never release the CURRENT owner's resources (G75 R3, task 1281):
        // the claim is released only at the epoch this record held, and a bound occupant whose
        // generation was taken over owns neither the occupant row nor the claimed messages.
        if (record.memberBinding !== undefined) {
            const generation = (await new CoordinationRunDao(db).maxGeneration(record.memberBinding.memberId)) ?? 0;
            if (generation > record.memberBinding.occupancyGeneration) return;
        }
        const claim = await new ProjectClaimDao(db).get(this.projectPath(), this.slot(record.id));
        if (claim !== null && claim.ownerEpoch === record.ownerEpoch) {
            await new ProjectClaimDao(db).release(
                this.projectPath(),
                this.slot(record.id),
                record.id,
                record.ownerEpoch,
            );
        }
        // A guest that dies mid-delivery must not strand its claimed messages: every claimed
        // row returns to `queued` through the service (G11 R10), so the next drain (or another
        // occupant) sees it again.
        const claimed = (await this.inbox().list(record.id, 'in', { limit: 500 })).messages.filter(
            (row) => row.status === 'claimed',
        );
        if (claimed.length > 0) await this.inbox().release(claimed);
        if (record.runId !== '') {
            await new CoordinationRunDao(db).updateExit(record.runId, 'exited', new Date().toISOString(), '[]', {
                messageIds: [],
                outcome: 'run-exit-only',
            });
        }
        try {
            await this.ctx.fs.deleteFile(join(this.dir(), `${record.id}.json`));
        } catch {
            // Already gone (or unwritable) — the lease is released either way.
        }
    }

    /** `<role>-g<n>`: the lowest free guest ordinal for this role. */
    private nextGuestId(role: string, declared: ReadonlySet<string>, joined: ReadonlySet<string>): string {
        for (let n = 1; n < 1000; n++) {
            const candidate = `${role}-g${n}`;
            if (!declared.has(candidate) && !joined.has(candidate)) return candidate;
        }
        return `${role}-g${Date.now()}`;
    }

    private slot(id: string): ClaimSlot {
        return `${GUEST_CLAIM_PREFIX}${id}` as ClaimSlot;
    }

    /**
     * The claim key: the **physical** project path. A guest's lease is renewed by a separate
     * process (G75 R1) whose cwd the OS reports physically, so keying on the caller's possibly
     * symlinked cwd (`/tmp/x` vs `/private/tmp/x` on macOS) would fence the renewer out of its
     * own claim.
     */
    private projectPath(): string {
        return normalizeProjectPath(this.ctx.cwd);
    }

    /** The lease TTL in force for this service — the injected test seam, else the real TTL. */
    private ttlMs(): number {
        return this.ctx.leaseTtlMs ?? GUEST_LEASE_TTL_MS;
    }

    private dir(): string {
        return join(this.ctx.cwd, GUEST_RECORD_DIR);
    }
}

/** Whether a parsed record carries a well-formed member binding (G75 R3, task 1281). */
function isMemberBinding(value: unknown): value is MemberBinding {
    if (value === null || typeof value !== 'object') return false;
    const binding = value as Partial<MemberBinding>;
    return (
        binding.version === 1 &&
        typeof binding.memberId === 'string' &&
        binding.memberId !== '' &&
        typeof binding.occupancyGeneration === 'number' &&
        typeof binding.ownerEpoch === 'number' &&
        typeof binding.stageEligible === 'boolean' &&
        (binding.handshakeAt === undefined || typeof binding.handshakeAt === 'string') &&
        ((binding.draining === undefined && binding.drainingAt === undefined) ||
            (binding.draining === true && typeof binding.drainingAt === 'string'))
    );
}
