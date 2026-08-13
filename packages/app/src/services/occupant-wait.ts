/**
 * Occupant wait + lifecycle projection (G4/ADR-057 wave 2, task 0530 R4–R6).
 *
 * Identity-pinned wait: snapshots an occupant's {@link OccupantPin} (specId +
 * runId + generation) and polls until a {@link WaitUntil} condition is met, or
 * the pinned identity breaks (replaced / generation bump / gone), or a stall or
 * caller timeout fires. Wave 2 polls every {@link POLL_INTERVAL_MS}; 0531 will
 * replace the poll body with a `followSystemEventsAfter` helper.
 *
 * Lifecycle (R6) is derived purely from cataloged first-class events:
 * - `agent.invoke.start` (latest) → `working`
 * - `agent.invoke.exit`   (latest) → `idle` iff `countPending(specId)===0`,
 *   else `unknown` (exit with a queued inbox; will re-invoke)
 * - no events / other      → `unknown`
 * `blocked` requires a first-class blocked signal (none in this task) → never.
 */
import type { OccupantRef } from '@gobing-ai/spur-domain';

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

export class WaitError extends Error {
    constructor(
        readonly code: WaitErrorCode,
        message: string,
    ) {
        super(message);
        this.name = 'WaitError';
    }
}

/** Poll cadence for wave 2 (ms). 0531 swaps the poll body, not this interval. */
export const POLL_INTERVAL_MS = 100;

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
    /** Latest cataloged invoke event for a runId (null = none recorded). */
    latestInvokeEvent(runId: string): Promise<InvokeEventSnapshot | null>;
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
    lastInvokeSequence: number | null;
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
        lastInvokeSequence: latest?.sequence ?? null,
    };
}

/**
 * Identity-pinned wait loop (R4). Polls every {@link POLL_INTERVAL_MS} until:
 * - the `until` target is satisfied (resolve), or
 * - identity breaks: `run_replaced` (generation bump) / `occupant_gone`, or
 * - no progress inside the stall budget → `wait_stalled`, or
 * - caller `--timeout` elapses → `timeout`.
 *
 * `invoke-exit` is satisfied when an `agent.invoke.exit` for the pinned runId
 * arrives AFTER the snapshot (sequence advanced, or latest event is exit).
 */
export async function waitForOccupant(
    deps: OccupantWaitDeps,
    opts: WaitForOccupantOptions,
): Promise<{ pin: OccupantPin; satisfied: WaitUntil }> {
    const { pin, until, signal } = opts;
    const stallMs = opts.stallMs ?? DEFAULT_STALL_MS;
    const start = deps.now();
    const deadline = opts.timeoutMs === undefined ? Number.POSITIVE_INFINITY : start + opts.timeoutMs;

    // Track whether the occupant was working at wait start — drives the stall
    // budget. `invoke-exit` always targets a future exit, so it is never
    // "already working" for stall purposes.
    const initialSnapshot = await snapshotOccupant(deps, pin.specId, { runId: pin.runId });
    let lastSequence = initialSnapshot.lastInvokeSequence;
    let wasWorking = initialSnapshot.lifecycle === 'working';

    // Already satisfied at snapshot (e.g. --until idle and already idle)?
    if (until !== 'invoke-exit' && satisfies(initialSnapshot.lifecycle, until)) {
        return { pin: initialSnapshot.pin, satisfied: until };
    }

    // Send-wait default `invoke-exit`: if the snapshot's latest event is already
    // an exit, we still wait for the NEXT exit (the one this send triggers).

    for (;;) {
        if (signal?.aborted === true) {
            throw new WaitError('timeout', 'wait aborted');
        }
        const clock = deps.now();
        if (clock >= deadline) {
            throw new WaitError('timeout', `wait timed out after ${opts.timeoutMs}ms`);
        }

        // Identity check: occupant replaced / generation bump / gone.
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

        const latest = await deps.latestInvokeEvent(pin.runId);
        const pendingCount = await deps.countPending(pin.specId);
        const lifecycle = projectLifecycle({ latestInvokeEvent: latest, pendingCount });

        const progressed = latest !== null && (latest.sequence ?? 0) > (lastSequence ?? -1);

        if (until === 'invoke-exit') {
            // Satisfied by an agent.invoke.exit at/after snapshot.
            if (
                latest !== null &&
                latest.eventName === 'agent.invoke.exit' &&
                (latest.sequence ?? 0) >= (lastSequence ?? 0)
            ) {
                return { pin, satisfied: until };
            }
        } else if (satisfies(lifecycle, until)) {
            return { pin, satisfied: until };
        }

        // Stall detection: non-working at start, and no matching event + no
        // status change inside min(timeout, stallMs).
        const stallBudget = opts.timeoutMs === undefined ? stallMs : Math.min(opts.timeoutMs, stallMs);
        if (!wasWorking && !progressed && clock - start >= stallBudget) {
            throw new WaitError('wait_stalled', `no progress within ${stallBudget}ms from a non-working occupant`);
        }
        if (lifecycle === 'working') wasWorking = true;

        lastSequence = latest?.sequence ?? lastSequence;
        await deps.sleep(POLL_INTERVAL_MS);
    }
}
