import { join } from 'node:path';
import {
    CLAIM_TTL_MS,
    type ClaimSlot,
    CoordinationRunDao,
    type DbAdapter,
    InboxMessageDao,
    InboxUnfinishedDao,
    ProjectClaimDao,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';

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
    /** The joining process, best-effort — guests are never supervised or restarted. */
    pid: number | null;
    /** Executor the guest runs as; informational, never dispatched to. */
    executor: string;
    /** The `guest:<id>` claim's fencing token (R5). */
    ownerEpoch: number;
    /** The `coordination_runs` row that makes the guest addressable as an occupant. */
    runId: string;
    joinedAt: string;
}

/** Input for {@link FleetGuestService.join}. */
export interface GuestJoinInput {
    role: string;
    id?: string;
    sessionId?: string;
    pid?: number;
    executor?: string;
}

/** Why a join was refused. Both are operator errors → the CLI exits 2. */
export type GuestJoinFailureCode = 'unknown-role' | 'collision';

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
    /** Role vocabulary; defaults to {@link GUEST_ROLES}. */
    roles?: readonly string[];
}

const GUEST_CLAIM_PREFIX = 'guest:';

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
        const joined = new Set((await this.list()).map((g) => g.id));
        const requested = input.id?.trim();
        const id = requested !== undefined && requested !== '' ? requested : this.nextGuestId(role, declared, joined);
        if (declared.has(id) || joined.has(id)) {
            return {
                ok: false,
                code: 'collision',
                message: `guest id "${id}" already belongs to a declared member or a joined guest — pass a free --id`,
            };
        }

        const db = await this.ctx.getDb();
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
        const claim = await new ProjectClaimDao(db).claim(this.ctx.cwd, this.slot(id), id, GUEST_LEASE_TTL_MS);
        if (claim === null) {
            return {
                ok: false,
                code: 'collision',
                message: `guest id "${id}" already holds a live lease — leave it first or pass a free --id`,
            };
        }
        const record: GuestRecord = {
            id,
            role,
            sessionId: input.sessionId ?? null,
            pid: input.pid ?? null,
            executor: input.executor ?? role,
            ownerEpoch: claim.ownerEpoch,
            runId,
            joinedAt: new Date().toISOString(),
        };
        await this.ctx.fs.ensureDir(this.dir());
        await this.ctx.fs.writeFile(join(this.dir(), `${id}.json`), `${JSON.stringify(record, null, 4)}\n`);
        return { ok: true, guest: record };
    }

    /** Extend the lease (R5). False means the guest is gone or its lease was taken over. */
    async heartbeat(id: string): Promise<boolean> {
        const record = await this.read(id);
        if (record === null) return false;
        const alive = await new ProjectClaimDao(await this.ctx.getDb()).heartbeat(
            this.ctx.cwd,
            this.slot(id),
            id,
            GUEST_LEASE_TTL_MS,
            record.ownerEpoch,
        );
        return alive;
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
            const claim = await new ProjectClaimDao(db).get(this.ctx.cwd, this.slot(record.id));
            if (claim !== null && claim.expiresAt > Date.now()) continue;
            await this.retire(record);
            expired.push(record.id);
        }
        return expired;
    }

    /** Queued (unclaimed) messages waiting for this guest — the `wait --inbox` predicate. */
    async pendingCount(id: string): Promise<number> {
        return await new InboxMessageDao(await this.ctx.getDb()).countPending(id);
    }

    /** Release the lease, retire the occupant row and drop the record. Shared by leave/expire. */
    private async retire(record: GuestRecord): Promise<void> {
        const db = await this.ctx.getDb();
        const claim = await new ProjectClaimDao(db).get(this.ctx.cwd, this.slot(record.id));
        if (claim !== null) {
            await new ProjectClaimDao(db).release(this.ctx.cwd, this.slot(record.id), record.id, claim.ownerEpoch);
        }
        // A guest that dies mid-delivery must not strand its claimed messages: every
        // `injected` row for it returns to `queued` so the next drain (or another
        // occupant) sees it again.
        const unfinished = await new InboxUnfinishedDao(db).listUnfinished(record.id);
        const claimed = unfinished.filter((row) => row.status === 'injected').map((row) => row.id);
        if (claimed.length > 0) await new InboxMessageDao(db).release(claimed);
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

    private dir(): string {
        return join(this.ctx.cwd, GUEST_RECORD_DIR);
    }
}
