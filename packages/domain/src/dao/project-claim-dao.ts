import type { DbAdapter } from '@gobing-ai/ts-db';

// ── Types (0836, feature G62 — orchestrator binding with a single active owner) ──

/**
 * Claim slot vocabulary. `'orchestrator'` is this task's slot; `'write'` is the
 * per-worktree write slot 0837 claims on the same rows (no second migration —
 * the columns `owner_epoch`/`strategy_version` ship from the start).
 */
export type ClaimSlot = 'orchestrator' | 'write';

/**
 * Claim time-to-live (0836 Q&A — CLOSED): a module constant, not config. Nothing
 * needs to vary it yet; it becomes a knob when an operator has a reason.
 */
export const CLAIM_TTL_MS = 30_000;

/** Raw project_claims row (snake_case, as read from SQLite). */
export interface ProjectClaimRow {
    project_path: string;
    slot: string;
    holder_id: string;
    owner_epoch: number;
    strategy_version: number | null;
    claimed_at: number;
    heartbeat_at: number;
    expires_at: number;
}

/** A project claim: mutable singleton ownership of one (project, slot). */
export interface ProjectClaim {
    projectPath: string;
    slot: ClaimSlot;
    /** Spec id, verbatim. */
    holderId: string;
    /** Fencing token 0837 reads; bumped on takeover after expiry. */
    ownerEpoch: number;
    /** Written by 0838; NULL until then. */
    strategyVersion: number | null;
    claimedAt: number;
    heartbeatAt: number;
    expiresAt: number;
}

function toClaim(row: ProjectClaimRow): ProjectClaim {
    return {
        projectPath: row.project_path,
        slot: row.slot as ClaimSlot,
        holderId: row.holder_id,
        ownerEpoch: row.owner_epoch,
        strategyVersion: row.strategy_version,
        claimedAt: row.claimed_at,
        heartbeatAt: row.heartbeat_at,
        expiresAt: row.expires_at,
    };
}

// ── DAO ──

/**
 * DAO for the `project_claims` table (0836). Exclusivity is decided by ONE
 * atomic `INSERT … ON CONFLICT … DO UPDATE … WHERE` statement — never
 * read-then-write — so a second claimant is refused, not queued (R3). The
 * token-plus-expiry shape copies the `queue_jobs.attempt_token` /
 * `lease_expires_at` pattern; the table itself is Spur-local.
 */
export class ProjectClaimDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * Attempt to claim `(projectPath, slot)` for `holderId` for `ttlMs`. The
     * upsert's WHERE admits only an expired claim. Even the same spec in another
     * process is refused while the current generation is live —
     * returns `null`, never queues (R3). Takeover on
     * expiry bumps `ownerEpoch` (the fencing token 0837 reads). The optional
     * `strategyVersion` (0837) is written on insert AND on takeover; omitted
     * (0836 orchestrator callers) stays/lands NULL. Optional owner/strategy
     * fences are checked inside the acquisition statement.
     */
    async claim(
        projectPath: string,
        slot: ClaimSlot,
        holderId: string,
        ttlMs: number,
        strategyVersion?: number,
        fence?: { ownerEpoch?: number; strategyVersion?: number },
    ): Promise<ProjectClaim | null> {
        const now = Date.now();
        const version = strategyVersion ?? null;
        // ONE statement decides AND reports: `RETURNING` emits a row only when
        // the insert/update actually landed (a WHERE-failed conflict emits
        // none), so a refused claimant reads null and a winner reads the row
        // ITS OWN statement wrote — no `SELECT changes()` probe that a
        // concurrent claimant's statement could alias on a shared adapter
        // (found by the 0837 two-claimant race test), and no post-write `get`
        // that could describe someone else's win.
        const row = await this.db.queryFirst<ProjectClaimRow>(
            `INSERT INTO project_claims (project_path, slot, holder_id, owner_epoch, strategy_version, claimed_at, heartbeat_at, expires_at)
             SELECT ?, ?, ?, 1, ?, ?, ?, ?
             WHERE (? IS NULL OR EXISTS (
                 SELECT 1 FROM project_claims WHERE project_path = ? AND slot = 'orchestrator'
                 AND owner_epoch = ? AND expires_at > ?
             )) AND (? IS NULL OR EXISTS (
                 SELECT 1 FROM project_strategy WHERE project_path = ?
                 AND strategy_version = ? AND strategy = 'gtd'
             ))
             ON CONFLICT(project_path, slot) DO UPDATE SET
                 holder_id = excluded.holder_id,
                 owner_epoch = project_claims.owner_epoch + 1,
                 strategy_version = excluded.strategy_version,
                 claimed_at = excluded.claimed_at,
                 heartbeat_at = excluded.heartbeat_at,
                 expires_at = excluded.expires_at
             WHERE project_claims.expires_at <= excluded.claimed_at
             RETURNING project_path, slot, holder_id, owner_epoch, strategy_version, claimed_at, heartbeat_at, expires_at`,
            projectPath,
            slot,
            holderId,
            version,
            now,
            now,
            now + ttlMs,
            fence?.ownerEpoch ?? null,
            projectPath,
            fence?.ownerEpoch ?? null,
            now,
            fence?.strategyVersion ?? null,
            projectPath,
            fence?.strategyVersion ?? null,
        );
        return row === undefined ? null : toClaim(row);
    }

    /**
     * Refresh the liveness of the claim `holderId` holds. Returning false means
     * the holder has been displaced (or never held the claim) — the caller must
     * stop acting as owner.
     */
    async heartbeat(
        projectPath: string,
        slot: ClaimSlot,
        holderId: string,
        ttlMs: number,
        ownerEpoch: number,
    ): Promise<boolean> {
        const now = Date.now();
        const changed = await this.db.queryFirst<{ holder_id: string }>(
            `UPDATE project_claims SET heartbeat_at = ?, expires_at = ?
             WHERE project_path = ? AND slot = ? AND holder_id = ? AND owner_epoch = ? AND expires_at > ?
             RETURNING holder_id`,
            now,
            now + ttlMs,
            projectPath,
            slot,
            holderId,
            ownerEpoch,
            now,
        );
        return changed !== undefined;
    }

    /** SQLite's actual backing file; empty only for an in-memory adapter. */
    async databasePath(): Promise<string> {
        const rows = await this.db.queryAll<{ name: string; file: string }>('PRAGMA database_list');
        return rows?.find((row) => row.name === 'main')?.file ?? '';
    }

    /** Current unreleased claim, or null. Liveness is the caller's clock check (`expiresAt > now`). */
    async get(projectPath: string, slot: ClaimSlot): Promise<ProjectClaim | null> {
        const row = await this.db.queryFirst<ProjectClaimRow>(
            `SELECT project_path, slot, holder_id, owner_epoch, strategy_version, claimed_at, heartbeat_at, expires_at
             FROM project_claims
             WHERE project_path = ? AND slot = ? AND expires_at > 0`,
            projectPath,
            slot,
        );
        return row === undefined ? null : toClaim(row);
    }

    /** Release the claim, only if `holderId` still holds it. True when this call released it. */
    async release(projectPath: string, slot: ClaimSlot, holderId: string, ownerEpoch: number): Promise<boolean> {
        // Keep the generation after release: deleting it lets a later run reuse
        // epoch 1 and accept an old result. Zero expiry is the released marker.
        const changed = await this.db.queryFirst<{ holder_id: string }>(
            `UPDATE project_claims SET expires_at = 0
             WHERE project_path = ? AND slot = ? AND holder_id = ? AND owner_epoch = ? AND expires_at > 0
             RETURNING holder_id`,
            projectPath,
            slot,
            holderId,
            ownerEpoch,
        );
        return changed !== undefined;
    }
}
