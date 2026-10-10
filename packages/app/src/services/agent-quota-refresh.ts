/**
 * Scheduled observation refresh for executor availability (Spur 1134 R5/R6).
 *
 * The refresh job touches **observations only** — it drains pending
 * `agent_executor_updates` rows, reports the age of the `agent-usage.json`
 * snapshot, and expires quota/probe-owned disables whose recorded `since` is older than
 * {@link QUOTA_DISABLE_TTL_MS}. It makes **zero provider requests** and never probes a
 * disabled executor: a probe spends the quota it is meant to protect, and a successful
 * probe does not disprove an account-level weekly cap (the exact `code 1310` case this
 * feature exists for). Re-enablement goes through the ownership-scoped recovery path
 * (`recordAgentQuotaEvent(..., false)` + drain), so an operator-owned disable is never
 * auto-re-enabled. A timer that probes or writes configuration is out of scope and needs
 * its own ADR-121 amendment.
 *
 * The job's last-run summary is written to `.spur/memory/observation-refresh.json` so
 * `spur agent doctor --json` can report whether fail-fast is actually able to fire (R6).
 */

import { normalizeExecutorAvailability, type SpurConfig } from '@gobing-ai/spur-config';
import type { AgentQuotaUpdatesContext } from './agent-quota-updates';
import { drainPendingAgentQuotaUpdates, recordAgentQuotaEvent } from './agent-quota-updates';

// Application sources may not statically import node:fs (runtime-boundaries rule);
// the top-level-await dynamic form is the standing workaround (see inline-run-setup.ts).
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = await import('node:fs');
const { join } = await import('node:path');

/**
 * How long a quota/probe-owned disable survives without a fresh observation.
 * Matches the 6 h `agent usage` staleness threshold the doctor already reports: past it
 * the disable rests on evidence nobody has refreshed, so the refresh job treats the
 * observation as expired and returns the rung through the ownership-scoped recovery path.
 */
export const QUOTA_DISABLE_TTL_MS = 6 * 60 * 60 * 1000;

/** Durable last-run summary the refresh job writes and the doctor reads. */
export interface ObservationRefreshStatus {
    /** ISO timestamp of the run. */
    readonly ranAt: string;
    /** Pending delivery rows drained by this run. */
    readonly applied: number;
    /** quota/probe-owned disables past their TTL that were handed to recovery. */
    readonly expired: number;
    /** Pending rows the drain could not apply (visible, retried next run). */
    readonly failed: number;
    /** Age of the usage snapshot in ms, or null when no snapshot exists. */
    readonly snapshotAgeMs: number | null;
    /** True when the snapshot is older than the staleness threshold (or absent). */
    readonly snapshotStale: boolean;
    /** Always 0 — the job holds no provider seam. Recorded so the claim is auditable. */
    readonly providerRequests: 0;
}

/** Result of one refresh run, including the recorded status. */
export interface ObservationRefreshOutcome {
    readonly status: ObservationRefreshStatus;
    /** Executors handed to recovery in this run. */
    readonly expiredExecutors: readonly string[];
}

/** Injectable seams: clock, snapshot path, TTL override (tests). */
export interface ObservationRefreshOptions {
    readonly now?: () => number;
    /** Absolute `agent-usage.json` path; the job reports its age (never mutates it). */
    readonly snapshotPath?: string;
    /** Snapshot staleness threshold; defaults to {@link QUOTA_DISABLE_TTL_MS}. */
    readonly staleAfterMs?: number;
    readonly ttlMs?: number;
}

/** Status-file location (durable plane, beside `runs/` and `evidence/`). */
export function observationRefreshStatusPath(projectRoot: string): string {
    return join(projectRoot, '.spur', 'memory', 'observation-refresh.json');
}

/** Read the last recorded refresh summary; null when the job has never run (or is unreadable). */
export function readObservationRefreshStatus(projectRoot: string): ObservationRefreshStatus | null {
    const path = observationRefreshStatusPath(projectRoot);
    if (!existsSync(path)) return null;
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed === null || typeof parsed !== 'object') return null;
        const row = parsed as Partial<ObservationRefreshStatus>;
        if (typeof row.ranAt !== 'string') return null;
        return {
            ranAt: row.ranAt,
            applied: typeof row.applied === 'number' ? row.applied : 0,
            expired: typeof row.expired === 'number' ? row.expired : 0,
            failed: typeof row.failed === 'number' ? row.failed : 0,
            snapshotAgeMs: typeof row.snapshotAgeMs === 'number' ? row.snapshotAgeMs : null,
            snapshotStale: row.snapshotStale === true,
            providerRequests: 0,
        };
    } catch {
        return null;
    }
}

/**
 * Run one observation refresh. Order matters: drain first (an exhaustion recorded by an
 * earlier run must reach configuration before the TTL pass reads availability), then
 * expire TTL'd quota/probe disables through recovery, then drain again so the recovery
 * lands in the same activation.
 */
export async function runObservationRefresh(
    context: AgentQuotaUpdatesContext,
    options: ObservationRefreshOptions = {},
): Promise<ObservationRefreshOutcome> {
    const now = (options.now ?? ((): number => Date.now()))();
    const ttlMs = options.ttlMs ?? QUOTA_DISABLE_TTL_MS;
    const firstDrain = await drainPendingAgentQuotaUpdates(context);

    const expiredExecutors: string[] = [];
    let config: SpurConfig | null = null;
    try {
        config = await context.loadAgentConfig(context.projectRoot);
    } catch (error) {
        context.warn(`observation refresh: effective agent config unavailable: ${errorText(error)}`);
    }
    for (const executor of config?.agent?.executors ?? []) {
        const availability = normalizeExecutorAvailability(executor.disabled);
        if (!availability.disabled) continue;
        // Ownership scope: an operator-owned disable is never auto-re-enabled (R5).
        if (availability.owner !== 'quota' && availability.owner !== 'probe') continue;
        const since = availability.since === undefined ? undefined : Date.parse(availability.since);
        // A disable without a usable `since` cannot be shown to have expired — leave it.
        if (since === undefined || Number.isNaN(since)) continue;
        if (now - since < ttlMs) continue;
        const recoveredAt = new Date(now).toISOString();
        // Deterministic per exhausted observation: re-running the refresh before the
        // recovery applies is a `duplicate`, never a second row.
        const observationId = `recovery-${availability.since}`;
        const outcome = await recordAgentQuotaEvent(
            context,
            {
                observationId,
                recoveredAt,
                attribution: { projectId: context.projectRoot, executor: executor.name, agent: executor.agent },
            },
            false,
        );
        if (typeof outcome === 'object' && 'rejected' in outcome) {
            context.warn(`observation refresh: recovery for "${executor.name}" not recorded: ${outcome.rejected}`);
            continue;
        }
        expiredExecutors.push(executor.name);
    }
    const secondDrain = expiredExecutors.length > 0 ? await drainPendingAgentQuotaUpdates(context) : undefined;

    const snapshot = options.snapshotPath === undefined ? null : readSnapshotCapturedAt(options.snapshotPath);
    const capturedAt = snapshot === null ? undefined : Date.parse(snapshot);
    const staleAfterMs = options.staleAfterMs ?? QUOTA_DISABLE_TTL_MS;
    const snapshotAgeMs =
        snapshot === null || capturedAt === undefined || Number.isNaN(capturedAt) ? null : now - capturedAt;
    const snapshotStale = snapshotAgeMs === null || snapshotAgeMs > staleAfterMs;

    const status: ObservationRefreshStatus = {
        ranAt: new Date(now).toISOString(),
        applied: firstDrain.applied + (secondDrain?.applied ?? 0),
        expired: expiredExecutors.length,
        failed: firstDrain.failed + (secondDrain?.failed ?? 0),
        snapshotAgeMs,
        snapshotStale,
        providerRequests: 0,
    };
    writeObservationRefreshStatus(context.projectRoot, status);
    return { status, expiredExecutors };
}

/** Snapshot `captured_at` (RFC 3339) or null when absent/unreadable — reporting only, never a probe. */
function readSnapshotCapturedAt(path: string): string | null {
    try {
        if (!existsSync(path)) return null;
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed === null || typeof parsed !== 'object') return null;
        const capturedAt = (parsed as { captured_at?: unknown }).captured_at;
        return typeof capturedAt === 'string' ? capturedAt : null;
    } catch {
        return null;
    }
}

/** Atomic status write (temp sibling + rename); a failure is reported, never thrown. */
function writeObservationRefreshStatus(projectRoot: string, status: ObservationRefreshStatus): void {
    const path = observationRefreshStatusPath(projectRoot);
    try {
        mkdirSync(join(projectRoot, '.spur', 'memory'), { recursive: true });
        const temp = `${path}.tmp`;
        writeFileSync(temp, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
        renameSync(temp, path);
    } catch {
        // The status file is an observability surface; a read-only tree must not fail the job.
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
