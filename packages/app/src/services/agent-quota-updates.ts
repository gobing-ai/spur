/**
 * Durable `agent.quota.exhausted` / `agent.quota.recovered` →
 * `agent_executor_updates` consumer (feature B5 / task 0799, ADR-111).
 *
 * One shared app subscription persists trusted attributed quota events as the
 * latest-observation delivery record (independent of the prunable
 * `system_events` ledger), and a serial drain applies each pending
 * observation to the project YAML through
 * {@link setProjectExecutorDisabled} — the single disable writer (0797),
 * never a re-implementation. Validation order per event:
 *
 * 1. trusted shape (Zod, `@gobing-ai/spur-config/agent-quota-events`),
 * 2. exact project identity (attribution must name THIS serving project),
 * 3. exact executor entry in the effective config (case-sensitive name),
 * 4. unchanged profile binding (`agent` required-equal; `model` equal when
 *    both sides declare one — run-level model overrides stay acceptable),
 *
 * before any row is written. Anything else is a classified, reported
 * rejection: malformed or unattributed payloads stay observable without
 * becoming durable work. The drain revalidates binding against the CURRENT
 * effective config and acknowledges version-specifically, so a superseded
 * observation can never be marked applied by an older in-flight write.
 */

import type { SpurConfig } from '@gobing-ai/spur-config';
import {
    type AgentQuotaObservationInput,
    type AgentQuotaRecoveryInput,
    agentQuotaObservationSchema,
    agentQuotaRecoverySchema,
    normalizeQuotaTimestamp,
    type QuotaExecutorProfileBinding,
    resolveQuotaExecutorBinding,
} from '@gobing-ai/spur-config/agent-quota-events';
import { setProjectExecutorDisabled } from '@gobing-ai/spur-config/loader';
import { AgentExecutorUpdateDao, type AgentExecutorUpdateRow, type DbAdapter } from '@gobing-ai/spur-domain';
import type { EventBus } from '@gobing-ai/ts-infra';

/** Bus shape shared by agent-service, team/workflow services, CLI and the server. */
export type AgentQuotaEventBus = EventBus<Record<string, (event: unknown) => void>>;

/** Handle returned by {@link attachAgentQuotaUpdates}. */
export interface AgentQuotaUpdatesAttachment {
    /** Detach both quota handlers; safe to call more than once. */
    unsubscribe: () => void;
    /** Await in-flight recording so shutdown never races the process exit. */
    flush: () => Promise<void>;
}

/** Structural dependencies for the quota-update consumer (composition-root supplied). */
export interface AgentQuotaUpdatesContext {
    /** Opens the project SQLite database (same handle the ledger uses). */
    getDb: () => Promise<DbAdapter>;
    /** Trusted serving project root; attribution must match exactly. */
    projectRoot: string;
    /**
     * Effective project config accessor (ADR-082): the composition root owns
     * `loadSpurConfig` calls, so it threads this in instead of the service
     * loading per slice. Return `null` (or throw) when the config cannot be
     * loaded — surfaced as an "unavailable" rejection/failure, never fatal.
     */
    loadAgentConfig: (projectRoot: string) => Promise<SpurConfig | null>;
    /** Surfaced validation/persistence failures — never thrown into the emitting run. */
    warn: (message: string) => void;
}

/**
 * Outcome counters from one {@link drainPendingAgentQuotaUpdates} pass.
 * Every non-applied category names WHY, so a stuck row is visible in
 * operator output instead of silently retrying forever.
 */
export interface AgentQuotaDrainSummary {
    /** Rows applied to the project YAML (updater `updated` or idempotent `unchanged`). */
    applied: number;
    /** Rows acknowledged as no-ops because the profile binding was replaced. */
    skippedBindingReplaced: number;
    /** Rows acknowledged as no-ops because the executor entry no longer exists. */
    skippedUnknownExecutor: number;
    /** Rows left pending after a bounded failed write (retried on the next activation). */
    failed: number;
    /** Rows skipped this activation — per-activation retry bound reached. */
    deferred: number;
}

/** Failed writes allowed per executor per drain activation before deferral. */
export const MAX_QUOTA_DRAIN_ATTEMPTS_PER_ACTIVATION = 3;

/** Trailing-separator-insensitive root comparison — no fs resolution inside packages/app. */
function normalizeRootPath(root: string): string {
    return root.replace(/[\\/]+$/, '');
}

/** Classified rejection of one quota event; `reason` is operator-facing. */
export type AgentQuotaRecordOutcome = 'recorded' | 'duplicate' | 'superseded' | { rejected: string };

/**
 * Validate one trusted-shape quota event against the serving project and
 * record it as the latest-observation delivery row. Pure decision logic,
 * shared by the bus subscription and tests.
 *
 * @param event - Parsed event payload (`unknown` until schema-validated here).
 * @param desiredDisabled - `true` for exhaustion, `false` for explicit recovery.
 */
export async function recordAgentQuotaEvent(
    context: AgentQuotaUpdatesContext,
    event: unknown,
    desiredDisabled: boolean,
): Promise<AgentQuotaRecordOutcome> {
    const parsed = desiredDisabled
        ? agentQuotaObservationSchema.safeParse(event)
        : agentQuotaRecoverySchema.safeParse(event);
    if (!parsed.success) {
        return { rejected: `malformed ${desiredDisabled ? 'exhaustion' : 'recovery'} payload` };
    }
    const payload = parsed.data as AgentQuotaObservationInput | AgentQuotaRecoveryInput;
    const attribution = payload.attribution;
    if (attribution?.projectId === undefined || attribution.executor === undefined) {
        return { rejected: 'missing project/executor attribution — observable only, not recorded' };
    }
    if (normalizeRootPath(attribution.projectId) !== normalizeRootPath(context.projectRoot)) {
        return { rejected: `foreign project attribution "${attribution.projectId}"` };
    }
    const observedAt = normalizeQuotaTimestamp('observedAt' in payload ? payload.observedAt : payload.recoveredAt);
    if (observedAt === undefined) {
        return { rejected: `unparsable timestamp on observation ${payload.observationId}` };
    }
    let entry: readonly QuotaExecutorProfileBinding[] | undefined;
    try {
        const config = await context.loadAgentConfig(context.projectRoot);
        if (config === null) throw new Error('config load failed');
        entry = config.agent?.executors;
    } catch (error) {
        return { rejected: `effective agent config unavailable: ${errorText(error)}` };
    }
    const profile = resolveQuotaExecutorBinding(entry, attribution.executor);
    if (profile === undefined) {
        return { rejected: `unknown executor "${attribution.executor}" for this project` };
    }
    if (attribution.agent !== undefined && attribution.agent !== profile.agent) {
        return {
            rejected: `profile binding replaced: executor "${attribution.executor}" now serves agent "${profile.agent}", event claimed "${attribution.agent}"`,
        };
    }
    if (attribution.model !== undefined && profile.model !== undefined && attribution.model !== profile.model) {
        return {
            rejected: `model binding replaced: executor "${attribution.executor}" now pins "${profile.model}", event claimed "${attribution.model}"`,
        };
    }
    const db = await context.getDb();
    const dao = new AgentExecutorUpdateDao(db);
    return dao.recordObservation({
        project_id: normalizeRootPath(context.projectRoot),
        executor_name: attribution.executor,
        observation_id: payload.observationId,
        observed_at: observedAt,
        agent: attribution.agent ?? null,
        model: attribution.model ?? null,
        disabled: desiredDisabled,
    });
}

/**
 * Subscribe both quota events on `bus` and persist trusted attributed
 * observations into `agent_executor_updates`. Failure isolation mirrors the
 * system-event tap: a persistence or validation failure is reported through
 * {@link AgentQuotaUpdatesContext.warn} and swallowed — the original agent
 * failure already surfaced through the run, and the immediate in-run
 * exclusion (agent-service) never waits on this path.
 */
export function attachAgentQuotaUpdates(
    bus: AgentQuotaEventBus,
    context: AgentQuotaUpdatesContext,
): AgentQuotaUpdatesAttachment {
    const inFlight = new Set<Promise<unknown>>();
    let unsubscribed = false;
    const handlers: Array<{ name: string; handler: (event: unknown) => void }> = [];
    const track = (promise: Promise<unknown>): void => {
        inFlight.add(promise);
        void promise.catch(() => {}).finally(() => inFlight.delete(promise));
    };
    const subscribe = (eventName: 'agent.quota.exhausted' | 'agent.quota.recovered', disabled: boolean): void => {
        const handler = (event: unknown): void => {
            track(
                (async () => {
                    const outcome = await recordAgentQuotaEvent(context, event, disabled);
                    if (typeof outcome === 'object' && 'rejected' in outcome) {
                        context.warn(`agent quota update rejected: ${outcome.rejected}`);
                    } else if (outcome === 'superseded') {
                        context.warn('agent quota update superseded by a newer observation — ignored');
                    }
                })().catch((error) => {
                    // Persistence failure: report, never claim success, never throw.
                    context.warn(`agent quota update persistence failed: ${errorText(error)}`);
                }),
            );
        };
        handlers.push({ name: eventName, handler });
        bus.on(eventName, handler);
    };
    subscribe('agent.quota.exhausted', true);
    subscribe('agent.quota.recovered', false);
    return {
        unsubscribe: () => {
            if (unsubscribed) return;
            unsubscribed = true;
            for (const { name, handler } of handlers) bus.off(name, handler);
        },
        flush: async () => {
            await Promise.allSettled([...inFlight]);
        },
    };
}

/**
 * Apply every pending delivery row for the serving project, oldest
 * observation first. Per row: reload the effective config, verify the exact
 * profile binding, invoke {@link setProjectExecutorDisabled} (updater
 * idempotency makes replays `unchanged`), then acknowledge
 * version-specifically — a newer arrival during the write keeps the row
 * pending through the conditional ack. A failed write is recorded visibly
 * (attempts + last_error) and retried up to
 * {@link MAX_QUOTA_DRAIN_ATTEMPTS_PER_ACTIVATION} within this drain; the row
 * stays pending so a later restart or poll retries it. Never is a failed
 * write acknowledged.
 */
export async function drainPendingAgentQuotaUpdates(
    context: AgentQuotaUpdatesContext,
    options: { appliedAt?: () => string } = {},
): Promise<AgentQuotaDrainSummary> {
    const summary: AgentQuotaDrainSummary = {
        applied: 0,
        skippedBindingReplaced: 0,
        skippedUnknownExecutor: 0,
        failed: 0,
        deferred: 0,
    };
    const db = await context.getDb();
    const dao = new AgentExecutorUpdateDao(db);
    const projectId = normalizeRootPath(context.projectRoot);
    const rows = await dao.pendingUpdates(projectId);
    if (rows.length === 0) return summary;
    let config: SpurConfig | undefined;
    for (const row of rows) {
        let lastError: string | undefined;
        for (let attempt = 0; attempt < MAX_QUOTA_DRAIN_ATTEMPTS_PER_ACTIVATION; attempt += 1) {
            let effectiveConfig: SpurConfig;
            try {
                // Memoized across rows; a `null` accessor result normalizes to a
                // throw so the caller's single failure path records it visibly.
                effectiveConfig = config ?? (await requireAgentConfig(context));
            } catch (error) {
                lastError = `effective agent config unavailable: ${errorText(error)}`;
                await recordDrainFailure(dao, row, lastError);
                continue;
            }
            config = effectiveConfig;
            const profile = resolveQuotaExecutorBinding(effectiveConfig.agent?.executors, row.executor_name);
            if (profile === undefined) {
                await dao.ackApplied(projectId, row.executor_name, row.observation_id, appliedAtNow(options));
                summary.skippedUnknownExecutor += 1;
                context.warn(
                    `quota update for unknown executor "${row.executor_name}" acknowledged as a no-op (entry no longer configured)`,
                );
                lastError = undefined;
                break;
            }
            if (row.agent !== null && row.agent !== profile.agent) {
                await dao.ackApplied(projectId, row.executor_name, row.observation_id, appliedAtNow(options));
                summary.skippedBindingReplaced += 1;
                context.warn(
                    `quota update for "${row.executor_name}" acknowledged as a no-op: profile now serves agent "${profile.agent}", observation recorded "${row.agent}"`,
                );
                lastError = undefined;
                break;
            }
            if (row.model !== null && profile.model !== undefined && row.model !== profile.model) {
                await dao.ackApplied(projectId, row.executor_name, row.observation_id, appliedAtNow(options));
                summary.skippedBindingReplaced += 1;
                context.warn(
                    `quota update for "${row.executor_name}" acknowledged as a no-op: profile now pins model "${profile.model}", observation recorded "${row.model}"`,
                );
                lastError = undefined;
                break;
            }
            try {
                await setProjectExecutorDisabled(context.projectRoot, row.executor_name, row.disabled === 1);
                await dao.ackApplied(projectId, row.executor_name, row.observation_id, appliedAtNow(options));
                summary.applied += 1;
                lastError = undefined;
                break;
            } catch (error) {
                lastError = errorText(error);
                await recordDrainFailure(dao, row, lastError);
            }
        }
        if (lastError !== undefined && (await attemptBoundReached(dao, row, context))) {
            summary.failed += 1;
            summary.deferred += 1;
        } else if (lastError !== undefined) {
            summary.failed += 1;
        }
    }
    return summary;
}

/**
 * Resolve the effective config for a drain attempt; a `null` result from the
 * injected accessor normalizes to a throw so the caller's failure path stays
 * single (visible `recordDrainFailure`, bounded retries).
 */
async function requireAgentConfig(context: AgentQuotaUpdatesContext): Promise<SpurConfig> {
    const config = await context.loadAgentConfig(context.projectRoot);
    if (config === null) throw new Error('config unavailable');
    return config;
}

/** Long-running consumer: bus subscription + bounded polling feeding one serialized drain. */
export interface AgentQuotaUpdateConsumer {
    /** Run one serialized drain pass now (also triggered by the poll timer). */
    drain: () => Promise<AgentQuotaDrainSummary>;
    /** Stop polling + detach handlers + final drain (graceful shutdown). */
    stop: () => Promise<void>;
}

/**
 * Start the ONE project-scoped quota-update consumer. The bus wake-up and the
 * poll timer feed the same serialized drain, so restarts, offline-emitted
 * work and live events all converge without ordering races. Callers must
 * start this BEFORE autostart/dispatch (server composition order, design §5).
 */
export function startAgentQuotaUpdateConsumer(
    bus: AgentQuotaEventBus,
    context: AgentQuotaUpdatesContext,
    options: { pollIntervalMs?: number } = {},
): AgentQuotaUpdateConsumer {
    const attachment = attachAgentQuotaUpdates(bus, context);
    const pollIntervalMs = options.pollIntervalMs ?? 30_000;
    let chain: Promise<unknown> = Promise.resolve();
    const serialized = <T>(work: () => Promise<T>): Promise<T> => {
        const next = chain.then(work, work);
        chain = next.catch(() => {});
        return next;
    };
    const wake = (): void => {
        void serialized(() => drainPendingAgentQuotaUpdates(context)).catch((error) => {
            context.warn(`agent quota update drain failed: ${errorText(error)}`);
        });
    };
    const timer = setInterval(wake, pollIntervalMs);
    // Unref so a short-lived embedding (tests, CLI embeds) can exit naturally.
    timer.unref?.();
    return {
        drain: () => serialized(() => drainPendingAgentQuotaUpdates(context)),
        stop: async () => {
            clearInterval(timer);
            attachment.unsubscribe();
            await attachment.flush();
            await serialized(() => drainPendingAgentQuotaUpdates(context)).catch((error) => {
                context.warn(`agent quota update final drain failed: ${errorText(error)}`);
            });
        },
    };
}

/** Persist a visible failure on the exact observation version; never throws into the drain loop. */
async function recordDrainFailure(
    dao: AgentExecutorUpdateDao,
    row: AgentExecutorUpdateRow,
    error: string,
): Promise<void> {
    try {
        await dao.recordFailure(row.project_id, row.executor_name, row.observation_id, error.slice(0, 500), null);
    } catch {
        // The failure row IS the last-resort surface; if even that fails the
        // drain caller still sees the thrown updater error via the summary.
    }
}

/** True when the row exhausted its per-activation attempts (visible deferred state). */
async function attemptBoundReached(
    dao: AgentExecutorUpdateDao,
    row: AgentExecutorUpdateRow,
    context: AgentQuotaUpdatesContext,
): Promise<boolean> {
    try {
        const current = await dao.getUpdate(row.project_id, row.executor_name);
        return (current?.attempts ?? 0) >= MAX_QUOTA_DRAIN_ATTEMPTS_PER_ACTIVATION;
    } catch (error) {
        context.warn(`agent quota update retry state unreadable: ${errorText(error)}`);
        return false;
    }
}

function appliedAtNow(options: { appliedAt?: () => string }): string {
    return options.appliedAt?.() ?? new Date().toISOString();
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
