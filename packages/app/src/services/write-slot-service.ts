import { randomUUID } from 'node:crypto';
import {
    type DbAdapter,
    type ProjectClaim,
    ProjectClaimDao,
    ProjectStrategyDao,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import type { FleetService, ResolvedFleetMember } from './fleet-service';
import { normalizeProjectPath } from './project-registry';

// ---------------------------------------------------------------------------
// Types (0837, feature G62 — per-project write-slot lease)
// ---------------------------------------------------------------------------

/**
 * A dispatch decision pinned at decision time to the fencing tokens it was
 * taken under; carried to claim time so a stale decision cannot dispatch
 * (R3/R4). `instanceId` is the DISPATCHING member's spec id, verbatim;
 * `ownerEpoch`/`strategyVersion` are the ORCHESTRATOR-claim values observed
 * when the decision was taken.
 */
export interface DispatchDecision {
    projectPath: string;
    /** Spec id, verbatim. */
    instanceId: string;
    /** Orchestrator epoch observed when the decision was taken. */
    ownerEpoch: number;
    /** Strategy version observed when the decision was taken (minted by 0838). */
    strategyVersion: number;
    /** From `ResolvedFleetMember.writeCapable` (0835). */
    requiresWrite: boolean;
    taskId?: string;
}

/** Why a claim was refused. First refusal in the precedence wins; never an exception. */
export type ClaimRefusal =
    | 'slot-held' // another live holder (R1, R2)
    | 'stale-owner' // owner generation differs or its lease expired (R3)
    | 'stale-strategy' // strategy generation differs or the strategy holds dispatch (R4)
    | 'write-capability-unproven'; // requiresWrite false but fsWrite not attested read-only (R5)

/**
 * `lease` is present only when the write slot was actually taken; a proven
 * read-only claim returns `{ ok: true }` WITHOUT a lease — that absence is
 * what makes read-only concurrency work (R5).
 */
export type ClaimOutcome = { ok: true; lease?: ProjectClaim } | { ok: false; refusal: ClaimRefusal };

/**
 * 0837 Q&A — CLOSED: TTL plus heartbeat, not hold-until-done. A crashed holder
 * must not wedge the project. Heartbeating is the holder run loop's job
 * (`ProjectClaimDao.heartbeat`) — that loop arrives with 0838/0839; this
 * service owns only claim/validate/release.
 */
export const WRITE_SLOT_TTL_MS = 30_000;

/** Stale-result reporting context — the run/task ids the diagnostic names. */
export interface ResultRef {
    runId?: string;
    taskId?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application-layer write-slot lease over 0836's `ProjectClaimDao`
 * (`slot: 'write'`) — one write slot per worktree in v1 (R1; a repository
 * invariant, not a knob). Exclusivity is the dao's single guarded-upsert
 * statement (R2) — no read-then-write is added here. Fencing: a decision
 * pinned below the current
 * `ownerEpoch` or `strategyVersion` is refused before the slot is touched, and
 * a result from a replaced owner is a diagnostic, never a task transition
 * (R3) — advancement stays with the workflow pipeline (task-pipeline.yaml),
 * never this service.
 */
export class WriteSlotService {
    constructor(
        private readonly ctx: {
            /** Fleet resolution — the member's `fsWrite` attestation for R5. */
            fleet: FleetService;
            /** Factory for the project's migrated SQLite adapter (the one holding `project_claims`). */
            openDb: (projectPath: string) => Promise<DbAdapter>;
        },
    ) {}

    /**
     * Refuse stale owner/strategy decisions, require proven read-only capability
     * for a slot-free claim, and atomically fence a writer's acquisition against
     * the observed owner and persisted strategy. Refusals never start work.
     */
    async claim(decision: DispatchDecision): Promise<ClaimOutcome> {
        const projectPath = normalizeProjectPath(decision.projectPath);
        const db = await this.ctx.openDb(projectPath);
        const dao = new ProjectClaimDao(db);

        // 1. stale-owner — the orchestrator claim is the fencing source (R3).
        const orchestrator = await dao.get(projectPath, 'orchestrator');
        if (
            orchestrator !== null &&
            (decision.ownerEpoch !== orchestrator.ownerEpoch || orchestrator.expiresAt <= Date.now())
        ) {
            return { ok: false, refusal: 'stale-owner' };
        }
        // The persisted strategy is authoritative; an orchestrator claim may
        // predate a strategy change and still carry NULL or an older version.
        const strategy = await new ProjectStrategyDao(db).get(projectPath);
        const currentVersion = strategy?.strategyVersion ?? orchestrator?.strategyVersion;
        if (
            (currentVersion !== null && currentVersion !== undefined && decision.strategyVersion !== currentVersion) ||
            (strategy !== null && strategy.strategy !== 'gtd')
        ) {
            return { ok: false, refusal: 'stale-strategy' };
        }
        // 3. read-only only with PROVEN-absent fsWrite (R5).
        if (!decision.requiresWrite) {
            const member = await this.findMember(projectPath, decision.instanceId);
            if (member?.capabilityState !== 'unavailable') {
                return { ok: false, refusal: 'write-capability-unproven' };
            }
            return { ok: true };
        }
        // 4. atomic claim — the dao's single ON CONFLICT statement IS R2.
        const lease = await dao.claim(
            projectPath,
            'write',
            decision.instanceId,
            WRITE_SLOT_TTL_MS,
            decision.strategyVersion,
            { ownerEpoch: orchestrator?.ownerEpoch, strategyVersion: strategy?.strategyVersion },
        );
        if (lease === null) {
            const ownerNow = await dao.get(projectPath, 'orchestrator');
            if (
                orchestrator !== null &&
                (ownerNow?.ownerEpoch !== decision.ownerEpoch || ownerNow.expiresAt <= Date.now())
            ) {
                return { ok: false, refusal: 'stale-owner' };
            }
            const strategyNow = await new ProjectStrategyDao(db).get(projectPath);
            if (
                strategy !== null &&
                (strategyNow?.strategyVersion !== decision.strategyVersion || strategyNow.strategy !== 'gtd')
            ) {
                return { ok: false, refusal: 'stale-strategy' };
            }
            return { ok: false, refusal: 'slot-held' };
        }
        // 0839 R1: a taken slot is a capacity change — one named ledger row so
        // an idle orchestrator wakes on the fact (proven read-only claims take
        // no slot and emit nothing).
        await new SystemEventDao(db).insert({
            id: randomUUID(),
            event_name: 'fleet.capacity.changed',
            occurred_at: new Date().toISOString(),
            actor: decision.instanceId,
            payload_json: JSON.stringify({
                projectPath,
                change: 'claim',
                holderId: decision.instanceId,
                ownerEpoch: decision.ownerEpoch,
                strategyVersion: decision.strategyVersion,
            }),
            entity_kind: decision.taskId !== undefined ? 'task' : null,
            entity_id: decision.taskId ?? null,
        });
        return { ok: true, lease };
    }

    /**
     * Accept only the current write holder and its exact claim generation.
     * Missing/released claims cannot certify results. Reconcile before release;
     * rejected results produce a diagnostic without advancing the task (R3).
     */
    async validateResult(
        projectPath: string,
        instanceId: string,
        ownerEpoch: number,
        ref?: ResultRef,
    ): Promise<'accepted' | 'stale-owner-rejected'> {
        const normalized = normalizeProjectPath(projectPath);
        const db = await this.ctx.openDb(normalized);
        const row = await new ProjectClaimDao(db).get(normalized, 'write');
        const current = row?.ownerEpoch ?? 0;
        if (row !== null && row.holderId === instanceId && ownerEpoch === current) return 'accepted';
        await new SystemEventDao(db).insert({
            id: randomUUID(),
            event_name: 'fleet.write-slot.stale-owner-rejected',
            occurred_at: new Date().toISOString(),
            actor: instanceId,
            payload_json: JSON.stringify({
                projectPath: normalized,
                instanceId,
                reportedOwnerEpoch: ownerEpoch,
                currentOwnerEpoch: current,
                currentHolderId: row?.holderId ?? null,
            }),
            run_id: ref?.runId ?? null,
            entity_kind: ref?.taskId !== undefined ? 'task' : null,
            entity_id: ref?.taskId ?? null,
        });
        return 'stale-owner-rejected';
    }

    /** Release the write slot — only the current holder can. True when this call released it. */
    async release(projectPath: string, instanceId: string): Promise<boolean> {
        const normalized = normalizeProjectPath(projectPath);
        const db = await this.ctx.openDb(normalized);
        const released = await new ProjectClaimDao(db).release(normalized, 'write', instanceId);
        // 0839 R1: a freed slot wakes capacity waiters; only the fact of an
        // actual release emits — a failed release changed nothing.
        if (released) {
            await new SystemEventDao(db).insert({
                id: randomUUID(),
                event_name: 'fleet.capacity.changed',
                occurred_at: new Date().toISOString(),
                actor: instanceId,
                payload_json: JSON.stringify({ projectPath: normalized, change: 'release', holderId: instanceId }),
            });
        }
        return released;
    }

    /** The resolved fleet member for `instanceId`, or undefined (an unresolvable member attests nothing — R5). */
    private async findMember(projectPath: string, instanceId: string): Promise<ResolvedFleetMember | undefined> {
        const resolved = await this.ctx.fleet.resolve(projectPath);
        return resolved.members.find((m) => m.instanceId === instanceId);
    }
}
