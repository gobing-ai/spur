/**
 * Bounded guest lease renewal (G75 R1/R3, task 1279).
 *
 * The 30-second guest lease used to be renewed only by `wait --inbox` and the host Stop hook,
 * so 90 seconds of work with no inbox wait let the lease expire. The renewer is the missing
 * owner: a small loop that heartbeats the existing epoch-fenced claim while the *agent*
 * process is provably alive, and stops on the first sign that it is not.
 *
 * It is deliberately not a daemon: its lifetime is bounded by the guest record, by the agent
 * process fingerprint and by {@link DEFAULT_RENEWER_MAX_LIFETIME_MS}. It never signals,
 * adopts or kills a process — on loss it only stops itself.
 */

import type { FleetGuestService } from './fleet-guest-service';
import { type ProcessFingerprint, type ProcessIdentityReader, sameProcess } from './process-identity';

/** Why a renewer stopped. Every value is terminal; the loop never restarts itself. */
export type GuestRenewalStopReason = 'record-gone' | 'identity-lost' | 'fence-lost' | 'aborted' | 'max-lifetime';

/** Default hard cap on a single renewer's lifetime (12 h). */
export const DEFAULT_RENEWER_MAX_LIFETIME_MS = 12 * 60 * 60 * 1000;

/** Injected seams — the guest ledger, the recorded fingerprint and the host process table. */
export interface GuestLeaseRenewerContext {
    /** The lease owner. `heartbeat` is the epoch-fenced renew; `read` is the record check. */
    guests: Pick<FleetGuestService, 'read' | 'heartbeat'>;
    /** Fingerprint captured at join; `null` when identity could not be verified. */
    identity: ProcessFingerprint | null;
    /** Host process-table reader used to re-verify the fingerprint on every tick. */
    reader: ProcessIdentityReader;
    /** Renewal interval — must stay below the lease TTL (join uses `TTL / 3`). */
    intervalMs: number;
    /** Lifetime cap, so an orphaned renewer cannot renew forever. */
    maxLifetimeMs?: number;
    /** Clock seam. */
    now?: () => number;
    /** Sleep seam; an abort signal ends it early. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Observe a failed tick (transient ledger error) without ending renewal. */
    onTickError?: (error: unknown) => void;
}

/**
 * Renews one guest's lease until the guest, its agent process or its lease is gone.
 *
 * Stop conditions, in tick order: the record disappeared (`leave`, `expire`, another join
 * retired it), the recorded agent process is dead or its PID was reused, the claim's epoch
 * fence moved to another holder, the caller aborted, or the lifetime cap was reached.
 */
export class GuestLeaseRenewer {
    private readonly now: () => number;
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
    private readonly maxLifetimeMs: number;

    constructor(private readonly ctx: GuestLeaseRenewerContext) {
        this.now = ctx.now ?? Date.now;
        this.sleep = ctx.sleep ?? defaultSleep;
        this.maxLifetimeMs = ctx.maxLifetimeMs ?? DEFAULT_RENEWER_MAX_LIFETIME_MS;
    }

    /** Run the renewal loop for `guestId`; resolves with the reason it stopped. */
    async run(guestId: string, signal?: AbortSignal): Promise<GuestRenewalStopReason> {
        const startedAt = this.now();
        for (;;) {
            if (signal?.aborted === true) return 'aborted';
            if (this.now() - startedAt >= this.maxLifetimeMs) return 'max-lifetime';
            try {
                const record = await this.ctx.guests.read(guestId);
                if (record === null) return 'record-gone';
                if (this.ctx.identity !== null) {
                    const live = await this.ctx.reader.read(this.ctx.identity.pid);
                    if (!sameProcess(this.ctx.identity, live)) return 'identity-lost';
                }
                if (!(await this.ctx.guests.heartbeat(guestId))) return 'fence-lost';
            } catch (error) {
                // A transient ledger error (a locked database, a racing writer) must not end
                // renewal: the lease is what keeps the guest addressable, and the next tick
                // re-checks identity, record and fence from scratch.
                this.ctx.onTickError?.(error);
            }
            await this.sleep(this.ctx.intervalMs, signal);
        }
    }
}

/** `setTimeout` sleep that also resolves on abort, so a stopped renewer never lingers. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted === true) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}
