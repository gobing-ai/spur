import { randomUUID } from 'node:crypto';
import {
    CoordinationRunDao,
    type DbAdapter,
    ProjectClaimDao,
    ProjectStrategyDao,
    SystemEventDao,
} from '@gobing-ai/spur-domain';
import { DeliveryReconciler, type UnresolvedDelivery } from './delivery-reconciler';
import type { FleetService, OrchestratorBinding, ResolvedFleetMember } from './fleet-service';
import { normalizeProjectPath } from './project-registry';
import type { TaskService, TaskSummary } from './task-service';
import { type DispatchDecision, WRITE_SLOT_TTL_MS, WriteSlotService } from './write-slot-service';

// ---------------------------------------------------------------------------
// Frozen vocabulary (0838, feature G62 — persisted rest/GTD strategy runtime)
// ---------------------------------------------------------------------------

/** The closed strategy set (R5): adding a name is a typed code change, not a plugin. */
export type StrategyName = 'rest' | 'gtd';

/** An unconfigured project starts NOTHING (Q&A — CLOSED): the default is `rest`. */
export const DEFAULT_STRATEGY: StrategyName = 'rest';

/** The "authorized" carrier (Q&A — CLOSED): the task tag `fleet:auto`. Default is never-dispatch. */
export const FLEET_AUTO_TAG = 'fleet:auto';

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
    | 'rest-after-drain';

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
}

/** R6: what a restart found and whether the runtime may accept dispatch work. */
export interface ResumeReport {
    strategy: StrategyName;
    version: number;
    orchestrator: OrchestratorBinding;
    unresolved: UnresolvedDelivery[];
    reconciled: boolean;
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
        const unresolved = options.readOnly ? await reconciler.classify() : (await reconciler.reconcile()).unresolved;
        return { strategy, version, orchestrator, unresolved, reconciled: true };
    }

    /** A managed wake dispatches through the existing agent runner, never transitions tasks. */
    async dispatchNext(
        projectPath: string,
        ownerEpoch: number,
        invoke: (decision: DispatchDecision, signal: AbortSignal, beforeDispatch: () => Promise<void>) => Promise<void>,
    ): Promise<StrategyResult> {
        const selected = await this.selectNext(projectPath);
        const slots = new WriteSlotService(this.ctx);
        const claims = new ProjectClaimDao(await this.ctx.openDb(normalizeProjectPath(projectPath)));
        const dispatched: DispatchDecision[] = [];
        for (const decision of selected.decisions) {
            if (decision.ownerEpoch !== ownerEpoch) break;
            // Recheck task gates after preceding work, then atomically re-fence
            // the persisted strategy and owner at acquisition (rest holds queues).
            const current = await this.selectNext(projectPath);
            if (!current.decisions.some((d) => d.taskId === decision.taskId && d.instanceId === decision.instanceId))
                continue;
            const outcome = await slots.claim(decision);
            if (!outcome.ok) {
                selected.holds.push({
                    wbs: decision.taskId ?? '',
                    reason: 'no-idle-instance',
                    detail: outcome.refusal,
                });
                continue;
            }
            const controller = new AbortController();
            const lease = outcome.lease;
            let heartbeat = Promise.resolve();
            const timer = setInterval(() => {
                heartbeat = heartbeat
                    .then(async () => {
                        // Keep a running writer reserved even if its owner is replaced;
                        // abort that run, reconcile, and only then release its slot.
                        if (
                            lease &&
                            !(await claims.heartbeat(
                                lease.projectPath,
                                'write',
                                lease.holderId,
                                WRITE_SLOT_TTL_MS,
                                lease.ownerEpoch,
                            ))
                        )
                            controller.abort();
                        const owner = await claims.get(decision.projectPath, 'orchestrator');
                        if (owner?.ownerEpoch !== ownerEpoch || owner.expiresAt <= Date.now()) controller.abort();
                    })
                    .catch(() => controller.abort());
            }, WRITE_SLOT_TTL_MS / 3);
            try {
                await invoke(decision, controller.signal, async () => {
                    const owner = await claims.get(decision.projectPath, 'orchestrator');
                    const strategy = await this.getStrategy(decision.projectPath);
                    if (owner?.ownerEpoch !== ownerEpoch || owner.expiresAt <= Date.now())
                        throw new Error('stale-owner');
                    if (strategy.name !== 'gtd' || strategy.version !== decision.strategyVersion)
                        throw new Error('stale-strategy');
                    if (
                        lease &&
                        (await slots.validateResult(lease.projectPath, lease.holderId, lease.ownerEpoch)) !== 'accepted'
                    ) {
                        throw new Error('stale-owner');
                    }
                });
                dispatched.push(decision);
                if (lease)
                    await slots.validateResult(lease.projectPath, lease.holderId, lease.ownerEpoch, {
                        taskId: decision.taskId,
                    });
            } finally {
                try {
                    await new DeliveryReconciler({ getDb: () => this.ctx.openDb(decision.projectPath) }).reconcile();
                    if (lease) await slots.release(lease.projectPath, lease.holderId, lease.ownerEpoch);
                } finally {
                    clearInterval(timer);
                    await heartbeat;
                }
            }
        }
        return { decisions: dispatched, holds: selected.holds };
    }

    /**
     * Ask the active strategy for dispatch decisions over the current corpus.
     * Assembles the {@link StrategyContext} from the gate owners — candidates
     * from `TaskService.list({ status: 'todo' })`, idle instances from the
     * resolved fleet minus the live write-slot holder (an instance holding the
     * run is holding the slot; a crashed holder self-heals at TTL, 0837), the
     * orchestrator claim's epoch for fencing (offline ownership and unresolved
     * deliveries hold GTD selection), and the injected
     * dependency gate resolved per candidate up front.
     */
    async selectNext(projectPath: string, options: SelectNextOptions = {}): Promise<StrategyResult> {
        const normalized = normalizeProjectPath(projectPath);
        const resumed = await this.resume(normalized, options);
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
                    decisions: [],
                    holds: candidates.map((candidate) => ({ wbs: candidate.wbs, reason: 'no-idle-instance', detail })),
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
        const ready = new Map<string, boolean>();
        const blocked = new Map<string, string | null>();
        for (const candidate of candidates) {
            const previous = await runs.listByTaskId(candidate.wbs);
            // A prior invocation is not a fresh todo, even after a restart.
            // Malformed candidate documents hold that task without starving others.
            try {
                const eligible = previous.length === 0 && (await this.ctx.ready?.(candidate)) === true;
                ready.set(candidate.wbs, eligible);
                if (eligible) blocked.set(candidate.wbs, await this.ctx.dependencyBlocked(normalized, candidate.wbs));
            } catch {
                ready.set(candidate.wbs, false);
            }
        }

        return (STRATEGIES[name] ?? STRATEGIES[DEFAULT_STRATEGY]).select({
            projectPath: normalized,
            strategyVersion: version,
            ownerEpoch,
            candidates,
            idleInstances,
            dependencyBlocked: (wbs) => blocked.get(wbs) ?? null,
            ready: (wbs) => ready.get(wbs) === true,
        });
    }
}
