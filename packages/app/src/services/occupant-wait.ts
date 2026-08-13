/**
 * Occupant wait + lifecycle projection (G4/ADR-057 wave 2, task 0530 R4–R6).
 *
 * Identity-pinned wait: snapshots an occupant's {@link OccupantPin} (specId +
 * runId + generation) and follows the shared `system_events` ledger until a
 * {@link WaitUntil} condition is met, or the pinned identity breaks (replaced /
 * generation bump / gone), or a stall or caller timeout fires (G4 R8, task
 * 0531). Events are consumed snapshot-then-follow via the `follow` hook
 * (`followSystemEventsAfter` over the ledger) — no separate event ring; the
 * identity/stall/timeout contract from wave 2 is unchanged.
 *
 * Lifecycle (R6) is derived purely from cataloged first-class events:
 * - `agent.invoke.start` (latest) → `working`
 * - `agent.invoke.exit`   (latest) → `idle` iff `countPending(specId)===0`,
 *   else `unknown` (exit with a queued inbox; will re-invoke)
 * - no events / other      → `unknown`
 * `blocked` requires a first-class blocked signal (none in this task) → never.
 */
import type { OccupantRef, SystemEventRow } from '@gobing-ai/spur-domain';

/** Identity subset of an occupant — what a wait pins and re-validates each tick. */
export interface OccupantPin {
    specId: string;
    runId: string;
    generation: number;
}

/** One of the lifecycle states a wait can target. `unknown` is never a target. */
export type OccupantLifecycle = 'working' | 'idle' | 'unknown';

/** `--until` values. `blocked` is accepted but never satisfiable in wave 2. */
export type WaitUntil = 'idle' | 'working' | 'invoke-exit' | 'blocked';

/** Send-wait `--until` values (message-domain). */
export type SendWaitUntil = 'injected' | 'invoke-exit';

/** Latest cataloged invoke event for a runId, or null when none is recorded. */
export interface InvokeEventSnapshot {
    eventName: string;
    sequence: number | null;
}

/** Typed error code → exit-1 failure for a wait. */
export type WaitErrorCode = 'occupant_gone' | 'run_replaced' | 'wait_stalled' | 'timeout';

/** Typed wait failure (`occupant_gone` / `run_replaced` / `wait_stalled` / `timeout`). */
export class WaitError extends Error {
    constructor(
        readonly code: WaitErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'WaitError';
    }
}

/** Identity/deadline heartbeat cadence for the wait loop (ms). */
export const POLL_INTERVAL_MS = 100;

/** Sentinel distinguishing the heartbeat branch from a followed event row. */
const HEARTBEAT = 'heartbeat' as const;

/** Default stall budget when the occupant starts non-working (ms). */
export const DEFAULT_STALL_MS = 5000;

/**
 * Project a lifecycle state from the latest invoke event + pending count (R6).
 * Pure: no I/O. `blocked` is intentionally absent — it has no first-class
 * signal in wave 2 and is therefore never projected here.
 */
export function projectLifecycle(input: {
    latestInvokeEvent: InvokeEventSnapshot | null;
    pendingCount: number;
}): OccupantLifecycle {
    const { latestInvokeEvent, pendingCount } = input;
    if (latestInvokeEvent === null) return 'unknown';
    if (latestInvokeEvent.eventName === 'agent.invoke.start') return 'working';
    if (latestInvokeEvent.eventName === 'agent.invoke.exit') {
        return pendingCount === 0 ? 'idle' : 'unknown';
    }
    return 'unknown';
}

/** Whether a projected state satisfies a `--until` target. */
export function satisfies(lifecycle: OccupantLifecycle, until: WaitUntil): boolean {
    switch (until) {
        case 'idle':
            return lifecycle === 'idle';
        case 'working':
            return lifecycle === 'working';
        case 'blocked':
            // No first-class blocked signal in wave 2 — never satisfiable.
            return false;
        default:
            return false;
    }
}

/** Ports the wait loop calls. Injected for testability; wired in the CLI. */
export interface OccupantWaitDeps {
    /** Current occupant for a specId (null = no occupant / no DB). */
    getOccupant(specId: string): Promise<OccupantRef | null>;
    /** Count of queued messages for a specId. */
    countPending(specId: string): Promise<number>;
    /** Latest cataloged invoke event for a runId (null = none recorded). Used for the start snapshot. */
    latestInvokeEvent(runId: string): Promise<InvokeEventSnapshot | null>;
    /**
     * Snapshot-then-follow event feed (G4 R8): rows with `sequence > afterSequence`
     * as they arrive. Wired to `followSystemEventsAfter` over the shared ledger.
     */
    follow(afterSequence: number): AsyncIterable<SystemEventRow>;
    /** Wall clock in ms. */
    now(): number;
    /** Cancellable sleep. */
    sleep(ms: number): Promise<void>;
}

/** Options for {@link waitForOccupant}. */
export interface WaitForOccupantOptions {
    pin: OccupantPin;
    until: WaitUntil;
    /** Caller `--timeout`. Undefined = no caller deadline (stall budget still applies). */
    timeoutMs?: number;
    /** Stall budget for a non-working start. Defaults to {@link DEFAULT_STALL_MS}. */
    stallMs?: number;
    /** Abort signal (Ctrl-C). Aborted → the loop rethrows the abort as `timeout`. */
    signal?: AbortSignal;
}

/** A snapshot read at wait start — used for the initial satisfy check + stall. */
export interface WaitStartSnapshot {
    pin: OccupantPin;
    lifecycle: OccupantLifecycle;
    startClock: number;
    /** Latest invoke event at snapshot — seeds the follow cursor + lifecycle re-projection. */
    latestInvoke: InvokeEventSnapshot | null;
}

/**
 * Snapshot the occupant + its lifecycle at wait start. Throws `occupant_gone`
 * when no occupant exists for the specId (no run to pin).
 */
export async function snapshotOccupant(
    deps: OccupantWaitDeps,
    specId: string,
    opts: { runId?: string },
): Promise<WaitStartSnapshot> {
    const occupant = await deps.getOccupant(specId);
    if (occupant === null) {
        throw new WaitError('occupant_gone', `no occupant for specId "${specId}"`);
    }
    // `--run` pins an explicit runId; default to the spec's latest run.
    const runId = opts.runId ?? occupant.runId;
    if (opts.runId !== undefined && opts.runId !== occupant.runId) {
        // Caller asked for a run that is not the current occupant. Still pin it,
        // but read its own events. (It may be a completed run.)
    }
    const pin: OccupantPin = { specId, runId, generation: occupant.generation };
    const latest = await deps.latestInvokeEvent(runId);
    const pendingCount = await deps.countPending(specId);
    return {
        pin,
        lifecycle: projectLifecycle({ latestInvokeEvent: latest, pendingCount }),
        startClock: deps.now(),
        latestInvoke: latest,
    };
}

/**
 * Identity-pinned wait loop (R4, G4 R8). Snapshot-then-follow:
 * - snapshot the occupant + ledger sequence once, then follow `sequence > snapshot`
 *   from the shared `system_events` ledger via `deps.follow` (no event ring), and
 * - re-probe occupant identity + lifecycle on each followed event and on a
 *   {@link POLL_INTERVAL_MS} heartbeat (so a sparse event stream cannot starve
 *   the identity/stall/timeout checks — the wave-2 pin-break contract).
 *
 * Stops when: the `until` target is satisfied (resolve); identity breaks
 * (`run_replaced` / `occupant_gone`); no progress inside the stall budget
 * (`wait_stalled`); or the caller `--timeout` elapses (`timeout`).
 *
 * `invoke-exit` is satisfied when the pinned run's latest invoke event is an
 * `agent.invoke.exit` at/after the snapshot (wave-2 `>=` semantics, kept: an
 * exit already recorded at snapshot time satisfies — the 0530 CLI tests pin
 * this). A followed exit naturally qualifies; a followed start does not.
 */
export async function waitForOccupant(
    deps: OccupantWaitDeps,
    opts: WaitForOccupantOptions,
): Promise<{ pin: OccupantPin; satisfied: WaitUntil }> {
    const { pin, until, signal } = opts;
    const stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
    const start = deps.now();
    const deadline = opts.timeoutMs === undefined ? Number.POSITIVE_INFINITY : start + opts.timeoutMs;

    const initialSnapshot = await snapshotOccupant(deps, pin.specId, { runId: pin.runId });
    let latestInvoke = initialSnapshot.latestInvoke;
    let lastSequence = latestInvoke?.sequence ?? 0;
    let wasWorking = initialSnapshot.lifecycle === 'working';

    // Already satisfied at snapshot (e.g. --until idle and already idle)?
    if (until !== 'invoke-exit' && satisfies(initialSnapshot.lifecycle, until)) {
        return { pin: initialSnapshot.pin, satisfied: until };
    }

    // Follow `sequence > snapshot`. One in-flight read is kept alive and raced
    // against the heartbeat, so a resolved read is never dropped (no event loss
    // on heartbeat wins) and a sparse stream cannot starve deadline/stall/identity.
    const events = deps.follow(lastSequence)[Symbol.asyncIterator]();
    let pending = events.next();

    const stallBudget = opts.timeoutMs === undefined ? stallMs : Math.min(opts.timeoutMs, stallMs);
    let lastStallSequence = lastSequence;

    for (;;) {
        if (signal?.aborted === true) {
            throw new WaitError('timeout', 'wait aborted');
        }
        const clock = deps.now();
        if (clock >= deadline) {
            throw new WaitError('timeout', `wait timed out after ${opts.timeoutMs}ms`);
        }

        const next = await Promise.race([
            pending,
            deps.sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - clock))).then(() => HEARTBEAT),
        ]);

        if (next === HEARTBEAT) {
            // Periodic tick with no new event: identity + lifecycle re-probe only.
        } else {
            // A followed event arrived — advance the cursor and re-probe.
            if (next.done === true) {
                // Follow terminated (abort) — surface as an aborted wait.
                throw new WaitError('timeout', 'wait aborted');
            }
            pending = events.next();
            latestInvoke = { eventName: next.value.event_name, sequence: next.value.sequence };
            lastSequence = Math.max(lastSequence, next.value.sequence ?? 0);
        }

        // Identity: occupant replaced / generation bump / gone.
        const occupant = await deps.getOccupant(pin.specId);
        if (occupant === null) {
            throw new WaitError('occupant_gone', `occupant for specId "${pin.specId}" is gone`);
        }
        if (occupant.runId !== pin.runId) {
            throw new WaitError('run_replaced', `run ${pin.runId} replaced by ${occupant.runId}`);
        }
        if (occupant.generation > pin.generation) {
            throw new WaitError('run_replaced', `generation ${pin.generation} → ${occupant.generation}`);
        }

        const pendingCount = await deps.countPending(pin.specId);
        const lifecycle = projectLifecycle({ latestInvokeEvent: latestInvoke, pendingCount });

        if (until === 'invoke-exit') {
            // Satisfied by an agent.invoke.exit at/after the snapshot (wave-2
            // `>=`): the snapshot's own exit qualifies, as does any followed exit.
            if (latestInvoke !== null && latestInvoke.eventName === 'agent.invoke.exit') {
                return { pin, satisfied: until };
            }
        } else if (satisfies(lifecycle, until)) {
            return { pin, satisfied: until };
        }

        if (lifecycle === 'working') wasWorking = true;

        // Stall detection: non-working at start, and no sequence progress inside
        // min(timeout, stallMs). Progress must be fresh per window, mirroring wave 2.
        const progressed = lastSequence > lastStallSequence;
        lastStallSequence = lastSequence;
        if (!wasWorking && !progressed && clock - start >= stallBudget) {
            throw new WaitError('wait_stalled', `no progress within ${stallBudget}ms from a non-working occupant`);
        }
    }
}
