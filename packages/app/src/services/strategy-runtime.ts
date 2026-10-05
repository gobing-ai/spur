import { randomUUID } from 'node:crypto';
import type { FleetStrategy } from '@gobing-ai/spur-config';
import {
    CoordinationRunDao,
    type DbAdapter,
    InboxUnfinishedDao,
    type InboxUnfinishedRow,
    ProjectClaimDao,
    ProjectStrategyDao,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import { DeliveryReconciler, type UnresolvedDelivery } from './delivery-reconciler';
import type { FleetDispatcher, FleetReceipt } from './fleet-dispatcher';
import type { FleetService, OrchestratorBinding, ResolvedFleetMember } from './fleet-service';
import { normalizeProjectPath } from './project-registry';
import type { TaskService, TaskSummary } from './task-service';
import { type DispatchDecision, WRITE_SLOT_TTL_MS, WriteSlotService } from './write-slot-service';

// ---------------------------------------------------------------------------
// Frozen vocabulary (0838, feature G62 — persisted rest/GTD strategy runtime)
// ---------------------------------------------------------------------------

/**
 * The closed strategy set (R5): adding a name is a typed code change, not a plugin.
 * Derived from the config tuple (0858 R1) — `agent.fleet.strategy` validates against
 * the same list, so the two surfaces cannot drift into different vocabularies.
 */
export type StrategyName = FleetStrategy;

/** An unconfigured project starts NOTHING (Q&A — CLOSED): the default is `rest`. */
export const DEFAULT_STRATEGY: StrategyName = 'rest';

/** The "authorized" carrier (Q&A — CLOSED): the task tag `fleet:auto`. Default is never-dispatch. */
export const FLEET_AUTO_TAG = 'fleet:auto';
/** Definitive dispatches of a still-todo task before GTD stops retrying it. */
export const MAX_DISPATCH_ATTEMPTS = 3;

/**
 * The keyed-dispatch prefix a task's attempts live under (G71 R1). The attempt number
 * is the trailing segment, so the prefix is an exact filter and the suffix an ordinal.
 */
export function fleetTaskKeyPrefix(wbs: string): string {
    return `fleet:task:${wbs}:`;
}

/**
 * Parse the attempt ordinal out of a `fleet:task:<wbs>:<n>` request key, or null when the
 * key is unrelated or malformed. Refusing to guess keeps a malformed key from silently
 * becoming "attempt 1" and resetting a task's retry budget.
 */
export function parseFleetTaskAttempt(requestKey: string, wbs: string): number | null {
    const prefix = fleetTaskKeyPrefix(wbs);
    if (!requestKey.startsWith(prefix)) return null;
    const suffix = requestKey.slice(prefix.length);
    if (!/^[1-9][0-9]*$/.test(suffix)) return null;
    return Number.parseInt(suffix, 10);
}

/** The task wbs named by a `fleet:task:<wbs>:<n>` request key, or undefined for any other key. */
function fleetTaskWbs(requestKey: string | null): string | undefined {
    return /^fleet:task:([^:]+):[1-9][0-9]*$/.exec(requestKey ?? '')?.[1];
}

/**
 * Why a candidate was not dispatched (R4). Deliberately DISTINCT from G61
 * 0834's `HoldReason` — that one is delivery state, this is dispatch state;
 * one shared union would re-conflate the separation G61 exists to preserve.
 */
export type DispatchHoldReason =
    | 'unauthorized'
    | 'not-ready'
    | 'unmet-dependency'
    | 'no-idle-instance'
    | 'executor-unavailable'
    | 'rest-after-drain'
    /**
     * A keyed dispatch has no definite receipt yet (G71 R1): the member may still be
     * working, so nothing new may be dispatched. Never a reason to retry or to fail.
     */
    | 'dispatch-in-flight';

/**
 * One candidate's latest keyed dispatch attempt (G71 R1). `receipt` is absent while the
 * attempt has no DEFINITE receipt — pending, claimed, running, or `outcome-unknown`, all of
 * which keep the dispatch in flight because the work may still happen (R2).
 */
export interface DispatchAttemptState {
    /** Attempt number of the latest keyed dispatch (the trailing `:<n>` in its request key). */
    attempt: number;
    receipt?: 'completed' | 'failed' | 'not-started';
}

/** One skipped candidate with its actionable hold reason (R4) — never a silent skip. */
export interface DispatchHold {
    wbs: string;
    reason: DispatchHoldReason;
    detail?: string;
}

/** Everything a strategy sees — assembled by {@link StrategyRuntime.selectNext}, never the strategy. */
export interface StrategyContext {
    projectPath: string;
    strategyVersion: number;
    /** From the live orchestrator claim (0836); 0 when none is live (fences every claim). */
    ownerEpoch: number;
    /** `TaskService.list({ status: 'todo' })` — candidates are TaskSummary values, no second backlog. */
    candidates: TaskSummary[];
    /** Enabled fleet members (0835) not currently holding a run (the live write-slot holder). */
    idleInstances: ResolvedFleetMember[];
    /**
     * Injected dependency readiness (Q&A — CLOSED, sourced from
     * `TaskCheckService.firstBlockingPrerequisite` ← task-check.ts L4 rule):
     * null = satisfied, else the blocking wbs. The strategy never parses
     * `dependencies[]` itself.
     */
    dependencyBlocked: (wbs: string) => string | null;
    ready?: (wbs: string) => boolean;
    /**
     * Latest keyed dispatch attempt per candidate wbs (G71 R1). Absent = never
     * dispatched. Assembled by {@link StrategyRuntime} from the inbox request keys;
     * the strategy itself does no I/O — this is what keeps `select` pure.
     */
    dispatchAttempts: ReadonlyMap<string, DispatchAttemptState>;
}

/** The strategy's whole output: decisions to dispatch, holds for everything skipped. */
export interface StrategyResult {
    decisions: DispatchDecision[];
    holds: DispatchHold[];
}

/** Options for selecting work without changing persisted runtime state. */
export interface SelectNextOptions {
    /** Read-only callers must not persist defaults or reconcile delivery rows. */
    readOnly?: boolean;
}

/**
 * R5's declared extension point: a frozen `Record<StrategyName, Strategy>`
 * literal. No loader, no discovery, no dynamic `import()` — a third strategy
 * is a code change, which is what keeps the closed `StrategyName` union honest.
 */
export interface Strategy {
    readonly name: StrategyName;
    select(ctx: StrategyContext): StrategyResult;
}

/**
 * `rest` (R2): accepts input, starts nothing — including previously queued
 * assignments that have not started — and lets running work finish. One
 * `rest-after-drain` hold PER candidate (a global flag would hide which work
 * is being held). It does not touch messages, does not cancel running work,
 * and does not release a held write slot: the slot is released by the run's own
 * completion or TTL expiry (0837).
 */
export const restStrategy: Strategy = {
    name: 'rest',
    select: (ctx) => ({
        decisions: [],
        holds: ctx.candidates.map((c) => ({ wbs: c.wbs, reason: 'rest-after-drain' as const })),
    }),
};

/**
 * `gtd` (R3, R4): selects already-authorized eligible work within the existing
 * gates. Per candidate, evaluated in this order, first failure recorded as the
 * hold and the candidate skipped: (1) no `fleet:auto` tag → `unauthorized`;
 * (2) status ≠ todo → `not-ready`; (3) injected dependency gate →
 * `unmet-dependency`; (4) no idle instance → `no-idle-instance`; (5) the chosen
 * instance's executor unresolved → `executor-unavailable`. Candidates sort by
 * `priority` ascending as a string (the existing P0<P1<… vocabulary; a missing
 * priority sorts last under the sentinel `'P9'`) then by wbs ascending before
 * allocating capacity, and
 * carry `strategyVersion` + `ownerEpoch` for 0837's fences. Never advances,
 * transitions, or verifies a task — `task-pipeline.yaml` owns advancement.
 */
export const gtdStrategy: Strategy = {
    name: 'gtd',
    select: (ctx) => {
        const decisions: DispatchDecision[] = [];
        const holds: DispatchHold[] = [];
        const idle = [...ctx.idleInstances];
        // G71 R1: one in-flight keyed dispatch blocks every NEW write dispatch — the
        // single write slot is held by that member until a definite receipt lands.
        const inFlight = [...ctx.dispatchAttempts.entries()]
            .filter(([, state]) => state.receipt === undefined)
            .map(([wbs, state]) => `${wbs} (attempt ${state.attempt})`);
        const priorityOf = (c: TaskSummary): string => {
            const p = c.frontmatter.priority;
            return typeof p === 'string' && p !== '' ? p : 'P9';
        };
        // Allocate scarce instances in dispatch order, not corpus order.
        const candidates = [...ctx.candidates].sort(
            (a, b) => priorityOf(a).localeCompare(priorityOf(b)) || a.wbs.localeCompare(b.wbs),
        );
        for (const candidate of candidates) {
            const hold = (reason: DispatchHoldReason, detail?: string): void => {
                holds.push({ wbs: candidate.wbs, reason, ...(detail !== undefined && { detail }) });
            };
            // 1. authorization — the `fleet:auto` tag, nothing else (never status, never inference).
            const tags = candidate.frontmatter.tags;
            if (!Array.isArray(tags) || !tags.includes(FLEET_AUTO_TAG)) {
                hold('unauthorized');
                continue;
            }
            // 2. readiness — dispatch readiness, not refine-readiness.
            if (candidate.status !== 'todo' || ctx.ready?.(candidate.wbs) === false) {
                hold('not-ready');
                continue;
            }
            // 3. dependencies — the injected L4 rule, never a second parse here.
            const blocking = ctx.dependencyBlocked(candidate.wbs);
            if (blocking !== null) {
                hold('unmet-dependency', blocking);
                continue;
            }
            // 3b. dispatch freshness + in-flight exclusivity (G71 R1). The candidate's
            //     OWN in-flight attempt is named first so the hold reads specifically;
            //     any other in-flight attempt then blocks this candidate too.
            const attempt = ctx.dispatchAttempts.get(candidate.wbs);
            if (attempt !== undefined && attempt.receipt === undefined) {
                hold('dispatch-in-flight', `attempt ${attempt.attempt} has no terminal receipt yet`);
                continue;
            }
            if (inFlight.length > 0) {
                hold('dispatch-in-flight', `waiting on in-flight dispatch ${inFlight.join(', ')}`);
                continue;
            }
            // 4. capacity — an instance holding a run is not idle; once idle
            //    runs out every remaining survivor holds (R4: no silent skip).
            const assignee = candidate.frontmatter.assignee;
            const memberIndex = idle.findIndex((member) =>
                typeof assignee === 'string' && assignee !== ''
                    ? member.instanceId === assignee
                    : member.role === undefined || member.role === 'coder',
            );
            const member = memberIndex < 0 ? undefined : idle.splice(memberIndex, 1)[0];
            if (member === undefined) {
                hold('no-idle-instance');
                continue;
            }
            // 5. executor resolution — '' is the unresolved marker (0835); the
            //    unusable member stays consumed.
            if (member.executor === '' || member.capabilityState === 'unknown') {
                hold('executor-unavailable');
                continue;
            }
            decisions.push({
                projectPath: ctx.projectPath,
                instanceId: member.instanceId,
                ownerEpoch: ctx.ownerEpoch,
                strategyVersion: ctx.strategyVersion,
                // 0837: requiresWrite mirrors the member's fsWrite attestation —
                // a proven read-only member claims no slot; anything less proven
                // is refused at claim time, never here.
                requiresWrite: member.writeCapable,
                taskId: candidate.wbs,
            });
        }
        return { decisions, holds };
    },
};

/** The frozen strategy record (R5) — two entries, typed code change to extend. */
export const STRATEGIES: Readonly<Record<StrategyName, Strategy>> = { rest: restStrategy, gtd: gtdStrategy };

// ---------------------------------------------------------------------------
// StrategyRuntime
// ---------------------------------------------------------------------------

/** Injected seams — the gate owners named in the 0838 Background, never reimplemented here. */
export interface StrategyRuntimeContext {
    /** Factory for the project's migrated SQLite adapter (project_strategy + project_claims + inbox/coordination tables). */
    openDb: (projectPath: string) => Promise<DbAdapter>;
    /** Candidate enumeration — `TaskService.list` (the Background's named gate owner). */
    tasks: Pick<TaskService, 'list'>;
    /** Fleet resolution + orchestrator binding (0835/0836). */
    fleet: Pick<FleetService, 'resolve' | 'resolveOrchestrator'>;
    /**
     * Dependency readiness per candidate, sourced in production from
     * `TaskCheckService.firstBlockingPrerequisite` (the task-check.ts:1343 L4
     * rule) — injected, never re-parsed here (Q&A — CLOSED).
     */
    dependencyBlocked: (projectPath: string, wbs: string) => Promise<string | null>;
    ready?: (candidate: TaskSummary) => Promise<boolean>;
    /**
     * The single fleet dispatch primitive (G71 R1). Absent means this host cannot
     * dispatch (the Board's read-only views, tests) — {@link StrategyRuntime.tick}
     * then dispatches nothing and says so instead of faking a decision.
     */
    dispatcher?: Pick<FleetDispatcher, 'enqueue' | 'receipt'>;
}

/** R6: what a restart found and whether the runtime may accept dispatch work. */
export interface ResumeReport {
    strategy: StrategyName;
    version: number;
    orchestrator: OrchestratorBinding;
    unresolved: UnresolvedDelivery[];
    reconciled: boolean;
}

/** What one {@link StrategyRuntime.tick} did (G71 R1). */
export interface TickReport {
    dispatched: DispatchDecision[];
    holds: DispatchHold[];
}

/** What one {@link StrategyRuntime.observe} resolved (G71 R1). */
export interface ObserveReport {
    /** Member instance id whose write slot was released, when one was. */
    released: string[];
}

/**
 * The strategy runtime (0838): persists the active strategy per project (R1),
 * asks a named strategy for dispatch decisions (R2/R3/R4), and reconciles
 * before accepting work at startup (R6). It NEVER advances, transitions, or
 * verifies a task, never schedules itself (0839 owns wakeup), and the Board
 * reads through {@link getStrategy}/{@link resume} and never writes on open —
 * starting the Board does not reset the active strategy (R1).
 */
export class StrategyRuntime {
    constructor(private readonly ctx: StrategyRuntimeContext) {}

    /**
     * The persisted strategy, or the `rest` default (R1). A pure read — the
     * Board may call it freely; only {@link resume} persists the default.
     */
    async getStrategy(projectPath: string): Promise<{ name: StrategyName; version: number }> {
        const normalized = normalizeProjectPath(projectPath);
        const row = await new ProjectStrategyDao(await this.ctx.openDb(normalized)).get(normalized);
        return row === null
            ? { name: DEFAULT_STRATEGY, version: 1 }
            : { name: row.strategy === 'gtd' ? 'gtd' : DEFAULT_STRATEGY, version: row.strategyVersion };
    }

    /**
     * Persist a strategy change; returns the new version. The version
     * increments on EVERY set — a no-op re-set of the same name included — so
     * 0837's `stale-strategy` fence stays monotonic (Q&A — CLOSED).
     */
    async setStrategy(projectPath: string, name: StrategyName): Promise<number> {
        const normalized = normalizeProjectPath(projectPath);
        const db = await this.ctx.openDb(normalized);
        const row = await new ProjectStrategyDao(db).set(normalized, name);
        // 0839 R1: the strategy change is a named ledger event — the wake fact
        // an idle orchestrator loop follows (same db as the persisted row, so
        // the fact is durable before any consumer wakes).
        await new SystemEventDao(db).insert({
            id: randomUUID(),
            event_name: 'strategy.changed',
            occurred_at: new Date().toISOString(),
            actor: 'strategy-runtime',
            payload_json: JSON.stringify({ projectPath: normalized, strategy: name, version: row.strategyVersion }),
        });
        return row.strategyVersion;
    }

    /**
     * Reconcile the DECLARED strategy (0859 R1) into the persisted row: read first, write only
     * on a real difference, and report whether the row changed.
     *
     * `setStrategy` bumps the version on EVERY call, so calling it unconditionally at each
     * start would advance 0837's `stale-strategy` fence and emit a `strategy.changed` wake fact
     * on every restart of an unchanged project. The comparison therefore belongs here, next to
     * the row and the event, rather than at the caller.
     */
    async reconcileStrategy(projectPath: string, name: StrategyName): Promise<boolean> {
        const current = await this.getStrategy(projectPath);
        if (current.name === name) {
            return false;
        }
        await this.setStrategy(projectPath, name);
        return true;
    }

    /**
     * R6 resume, strict order — nothing dispatches until it finishes:
     * (1) read the persisted strategy, persisting `rest` at version 1 when
     * absent (R1); (2) resolve the orchestrator — any non-`bound-online` state
     * returns `reconciled: false` and NO dispatch; (3) reconcile unresolved
     * deliveries (0834) against completion receipts (0833); (4) only then may
     * {@link selectNext} be called.
     */
    async resume(projectPath: string, options: { readOnly?: boolean } = {}): Promise<ResumeReport> {
        const normalized = normalizeProjectPath(projectPath);
        const dao = new ProjectStrategyDao(await this.ctx.openDb(normalized));
        const row = options.readOnly ? await dao.get(normalized) : await dao.set(normalized, DEFAULT_STRATEGY, true);
        const strategy: StrategyName = row?.strategy === 'gtd' ? 'gtd' : DEFAULT_STRATEGY;
        const version = row?.strategyVersion ?? 1;

        const orchestrator = await this.ctx.fleet.resolveOrchestrator(normalized);
        if (orchestrator.state !== 'bound-online') {
            return { strategy, version, orchestrator, unresolved: [], reconciled: false };
        }
        const reconciler = new DeliveryReconciler({ getDb: async () => this.ctx.openDb(normalized) });
        // Only the fleet's own requests can hold its dispatch; an unscoped scan let a
        // stale ad-hoc message to any agent block GTD forever.
        const unresolved: UnresolvedDelivery[] = [];
        for (const member of (await this.ctx.fleet.resolve(normalized)).members) {
            unresolved.push(
                ...(options.readOnly
                    ? await reconciler.classify(member.instanceId)
                    : (await reconciler.reconcile(member.instanceId)).unresolved),
            );
        }
        return { strategy, version, orchestrator, unresolved, reconciled: true };
    }

    /**
     * One non-blocking orchestrator turn (G71 R1/R3). Reconciles once, asks the pure
     * strategy for decisions over a fresh snapshot, then — per decision — claims the write
     * slot and enqueues ONE keyed inbox message through the shared dispatcher. It never
     * awaits a member run: completion is a later wake's {@link observe}, resolved from the
     * `coordination_runs` receipt, never from a terminal or a filesystem poll.
     */
    async tick(projectPath: string, opts: { ownerEpoch: number; orchestratorId: string }): Promise<TickReport> {
        const normalized = normalizeProjectPath(projectPath);
        // Reconcile once, then work from one snapshot: a second selectNext per decision
        // (the pre-G71 shape) re-reconciled twice per tick for no new information.
        const resumed = await this.resume(normalized);
        const { result } = await this.selectFrom(normalized, resumed);
        const holds: DispatchHold[] = [...result.holds];
        const dispatcher = this.ctx.dispatcher;
        if (dispatcher === undefined) {
            return {
                dispatched: [],
                holds: [
                    ...holds,
                    ...result.decisions.map((decision) => ({
                        wbs: decision.taskId ?? '',
                        reason: 'no-idle-instance' as const,
                        detail: 'this host wired no fleet dispatcher — nothing was enqueued',
                    })),
                ],
            };
        }
        const db = await this.ctx.openDb(normalized);
        const inbox = new InboxUnfinishedDao(db);
        const slots = new WriteSlotService(this.ctx);
        const dispatched: DispatchDecision[] = [];
        for (const decision of result.decisions) {
            if (decision.ownerEpoch !== opts.ownerEpoch) break;
            const wbs = decision.taskId;
            if (wbs === undefined) continue;
            const claim = await slots.claim(decision);
            if (!claim.ok) {
                holds.push({ wbs, reason: 'no-idle-instance', detail: claim.refusal });
                continue;
            }
            try {
                const attempt = (await this.readAttempts(inbox, wbs)).count + 1;
                await dispatcher.enqueue({
                    member: decision.instanceId,
                    fromId: opts.orchestratorId,
                    body: `/sp:dev-run ${wbs} --auto`,
                    requestKey: `${fleetTaskKeyPrefix(wbs)}${attempt}`,
                });
                dispatched.push(decision);
                // The slot stays held until the receipt lands: the orchestrator keeps it
                // alive across the gap before the member picks the message up.
                this.startHeartbeat(normalized, decision.instanceId, opts.ownerEpoch);
            } catch (error) {
                // Nothing was enqueued, so the slot must not stay claimed — a dead
                // dispatch channel must not wedge the project for a TTL.
                if (claim.lease !== undefined) {
                    await slots.release(claim.lease.projectPath, claim.lease.holderId, claim.lease.ownerEpoch);
                }
                holds.push({
                    wbs,
                    reason: 'executor-unavailable',
                    detail: `enqueue failed: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
        return { dispatched, holds };
    }

    /**
     * Settle an in-flight dispatch (G71 R1/R4). Reads the receipt for the member that holds
     * the write slot; when it is definite, validates the result against the holder
     * generation and releases the slot. Retry needs no code here: the next {@link tick}
     * re-reads freshness and re-dispatches under a new attempt key.
     */
    async observe(projectPath: string, opts: { ownerEpoch: number }): Promise<ObserveReport> {
        const normalized = normalizeProjectPath(projectPath);
        const db = await this.ctx.openDb(normalized);
        const claims = new ProjectClaimDao(db);
        const orchestrator = await claims.get(normalized, 'orchestrator');
        // A replaced or expired owner must not settle another owner's dispatch.
        if (
            orchestrator === null ||
            orchestrator.ownerEpoch !== opts.ownerEpoch ||
            orchestrator.expiresAt <= Date.now()
        ) {
            return { released: [] };
        }
        const holder = await claims.get(normalized, 'write');
        if (holder === null || holder.expiresAt <= Date.now()) {
            this.stopHeartbeat(normalized);
            return { released: [] };
        }
        // The member picked the message up: its own run loop heartbeats the slot now
        // (1074 R2), so the orchestrator's standby heartbeat is finished.
        if (await new CoordinationRunDao(db).hasRunning(holder.holderId)) {
            this.stopHeartbeat(normalized);
            return { released: [] };
        }
        const dispatcher = this.ctx.dispatcher;
        if (dispatcher === undefined) return { released: [] };
        const rows = await new InboxUnfinishedDao(db).listUnfinished(holder.holderId);
        const pending = rows.find((row) => (row.request_key ?? '').startsWith('fleet:task:'));
        if (pending === undefined) return { released: [] };
        const receipt: FleetReceipt | null = await dispatcher.receipt(pending.id, holder.holderId);
        if (receipt === null) return { released: [] };
        this.stopHeartbeat(normalized);
        const slots = new WriteSlotService(this.ctx);
        await slots.validateResult(normalized, holder.holderId, holder.ownerEpoch, {
            taskId: fleetTaskWbs(pending.request_key),
        });
        const released = await slots.release(normalized, holder.holderId, holder.ownerEpoch);
        return { released: released ? [holder.holderId] : [] };
    }

    /**
     * Orchestrator-owned standby heartbeat for the write slot (G71 R1). The member cannot
     * heartbeat a slot it has not claimed yet, so while a dispatch waits to be picked up
     * the orchestrator keeps the lease alive at `WRITE_SLOT_TTL_MS / 3`. One timer per
     * project: repeating ticks reuse it rather than stacking intervals.
     */
    private startHeartbeat(projectPath: string, member: string, ownerEpoch: number): void {
        if (this.heartbeats.has(projectPath)) return;
        const timer = setInterval(() => {
            void this.ctx
                .openDb(projectPath)
                .then((db) =>
                    new ProjectClaimDao(db).heartbeat(projectPath, 'write', member, WRITE_SLOT_TTL_MS, ownerEpoch),
                )
                .catch(() => undefined);
        }, WRITE_SLOT_TTL_MS / 3);
        // A standby heartbeat must never hold the host process open by itself.
        (timer as { unref?: () => void }).unref?.();
        this.heartbeats.set(projectPath, { timer });
    }

    /** Stop the standby heartbeat — the member owns the slot now, or the dispatch settled. */
    stopHeartbeat(projectPath: string): void {
        const entry = this.heartbeats.get(projectPath);
        if (entry === undefined) return;
        clearInterval(entry.timer);
        this.heartbeats.delete(projectPath);
    }

    /** Stop every standby heartbeat (loop shutdown). */
    stop(): void {
        for (const projectPath of [...this.heartbeats.keys()]) this.stopHeartbeat(projectPath);
    }

    /** Standby write-slot heartbeats, one per project path. */
    private readonly heartbeats = new Map<string, { timer: ReturnType<typeof setInterval> }>();

    /**
     * Ask the active strategy for dispatch decisions over the current corpus (the pure half
     * of {@link tick}, also the read-only basis for `recordIdleHold` and inspection).
     * Assembles the {@link StrategyContext} from the gate owners — candidates
     * from `TaskService.list({ status: 'todo' })`, idle instances from the
     * resolved fleet minus the live write-slot holder (an instance holding the
     * run is holding the slot; a crashed holder self-heals at TTL, 0837), the
     * orchestrator claim's epoch for fencing (offline ownership and unresolved
     * deliveries hold GTD selection), the injected dependency gate resolved per
     * candidate up front, and each candidate's latest keyed dispatch attempt
     * (G71 R1) so the strategy itself stays I/O-free.
     */
    async selectNext(projectPath: string, options: SelectNextOptions = {}): Promise<StrategyResult> {
        const normalized = normalizeProjectPath(projectPath);
        const resumed = await this.resume(normalized, options);
        return (await this.selectFrom(normalized, resumed)).result;
    }

    /** Build the strategy snapshot from the gate owners and ask the named strategy. */
    private async selectFrom(
        normalized: string,
        resumed: ResumeReport,
    ): Promise<{ name: StrategyName; result: StrategyResult }> {
        const { strategy: name, version } = resumed;
        const db = await this.ctx.openDb(normalized);
        const claims = new ProjectClaimDao(db);

        const orchestrator = await claims.get(normalized, 'orchestrator');
        const ownerEpoch = orchestrator !== null && orchestrator.expiresAt > Date.now() ? orchestrator.ownerEpoch : 0;

        const candidates = await this.ctx.tasks.list({ status: 'todo' });
        if (name === 'gtd') {
            if (!resumed.reconciled || resumed.unresolved.length > 0) {
                const detail = !resumed.reconciled
                    ? `orchestrator:${resumed.orchestrator.state}; restore its live claim before dispatch`
                    : 'unresolved-deliveries; reconcile prior results before dispatch';
                return {
                    name,
                    result: {
                        decisions: [],
                        holds: candidates.map((candidate) => ({
                            wbs: candidate.wbs,
                            reason: 'no-idle-instance' as const,
                            detail,
                        })),
                    },
                };
            }
        }

        const resolved = await this.ctx.fleet.resolve(normalized);
        const writeHolder = await claims.get(normalized, 'write');
        const writeHeldLive = writeHolder !== null && writeHolder.expiresAt > Date.now() ? writeHolder.holderId : null;
        const runs = new CoordinationRunDao(db);
        const idleInstances: ResolvedFleetMember[] = [];
        for (const member of resolved.members) {
            const busy = await runs.hasRunning(member.instanceId);
            if (member.enabled && member.instanceId !== writeHeldLive && !busy) {
                idleInstances.push(member);
            }
        }
        const inbox = new InboxUnfinishedDao(db);
        const dispatchAttempts = new Map<string, DispatchAttemptState>();
        const ready = new Map<string, boolean>();
        const blocked = new Map<string, string | null>();
        for (const candidate of candidates) {
            // G71 R1 freshness: the keyed dispatch rows ARE the outstanding-work record
            // (a fleet run carries no task_id until its drain names one), so a restarted
            // orchestrator rebuilds its dispatch state from the database on the first tick.
            const attempts = await this.readAttempts(inbox, candidate.wbs);
            const latest = attempts.latest;
            let state: DispatchAttemptState | undefined;
            if (latest !== null) {
                const receipt = await this.ctx.dispatcher?.receipt(latest.row.id, latest.row.to_id);
                state = {
                    attempt: latest.attempt,
                    // Only a DEFINITE receipt leaves the attempt in flight (R2): a
                    // pending/claimed/running row and an `outcome-unknown` wait both
                    // keep it open, because the member may still be working.
                    ...(receipt !== null && receipt !== undefined && receipt.status !== 'outcome-unknown'
                        ? { receipt: receipt.status }
                        : {}),
                };
                dispatchAttempts.set(candidate.wbs, state);
            }
            // A completed attempt, or one that exhausted MAX_DISPATCH_ATTEMPTS, is no
            // longer a candidate (same as the prior invocation check). An in-flight
            // attempt stays "ready" here so select() reports the precise
            // `dispatch-in-flight` hold rather than a generic not-ready.
            const retryable =
                state === undefined ||
                state.receipt === undefined ||
                (state.receipt !== 'completed' && state.attempt < MAX_DISPATCH_ATTEMPTS);
            try {
                const eligible = retryable && (await this.ctx.ready?.(candidate)) === true;
                ready.set(candidate.wbs, eligible);
                if (eligible) blocked.set(candidate.wbs, await this.ctx.dependencyBlocked(normalized, candidate.wbs));
            } catch {
                ready.set(candidate.wbs, false);
            }
        }

        const result = (STRATEGIES[name] ?? STRATEGIES[DEFAULT_STRATEGY]).select({
            projectPath: normalized,
            strategyVersion: version,
            ownerEpoch,
            candidates,
            idleInstances,
            dependencyBlocked: (wbs) => blocked.get(wbs) ?? null,
            ready: (wbs) => ready.get(wbs) === true,
            dispatchAttempts,
        });
        return { name, result };
    }

    /**
     * Every keyed dispatch attempt recorded for `wbs`: the total count (the next attempt
     * number is `count + 1`) and the latest attempt by ordinal. A malformed key is skipped
     * rather than read as attempt 1 — guessing would silently reset a retry budget.
     */
    private async readAttempts(
        inbox: InboxUnfinishedDao,
        wbs: string,
    ): Promise<{
        count: number;
        latest: { row: InboxUnfinishedRow; attempt: number } | null;
    }> {
        const rows = await inbox.listByRequestKeyPrefix(fleetTaskKeyPrefix(wbs));
        let latest: { row: InboxUnfinishedRow; attempt: number } | null = null;
        for (const row of rows) {
            const attempt = parseFleetTaskAttempt(row.request_key ?? '', wbs);
            if (attempt === null) continue;
            if (latest === null || attempt > latest.attempt) latest = { row, attempt };
        }
        return { count: rows.length, latest };
    }
}
