import { createId, type SystemEventDao, type SystemEventRetentionQuotas } from '@gobing-ai/spur-domain';
import type { EventBus, Logger } from '@gobing-ai/ts-infra';
import { normalizeSystemEventPayload, SYSTEM_EVENT_CATALOG } from './event-names';
import type { SystemEventRetentionConfig } from './system-event-retention';
import { resolveRetentionQuotas } from './system-event-retention';

/**
 * Retention quotas resolved for every catalog prefix. Resolved once at tap
 * registration from the operator-facing {@link SystemEventRetentionConfig}
 * (task 0368 R3); never a compiled-in constant as the only knob.
 *
 * The tap receives a pre-resolved list (server boot resolves from config, the
 * CLI emitter resolves via the app default) so the tap stays a pure sink and
 * the policy lives in one place.
 */

/** Canonical server bus shape consumed by the system-event tap. */
export type SystemEventBus = EventBus<Record<string, (event: unknown) => void>>;
/** Compatibility alias for older imports. */
export type PlanningEventBus = SystemEventBus;

/** Handle returned by {@link registerSystemEventTap}. */
export interface SystemEventTap {
    /** Detach every handler wired by the tap; await no further work. */
    unsubscribe: () => void;
    /** Resolve once every in-flight persist has settled (test/shutdown drain). */
    flush: () => Promise<void>;
}

/**
 * Subscribe a {@link SystemEventDao} tap to the canonical SystemEventBus. Each
 * cataloged event is normalized/redacted and persisted as a `system_events` row.
 * A per-handler try/catch isolates persistence failures from other bus
 * subscribers — a tap failure is logged and swallowed, never thrown.
 *
 * Retention (task 0368 R2/R3): the insert-time backstop prunes only the just-
 * written prefix, scoping eviction so one prefix's overflow never evicts
 * another's. Quotas are resolved once from {@link SystemEventRetentionConfig};
 * absent config falls back to {@link DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA}.
 */
export function registerSystemEventTap(
    bus: SystemEventBus,
    dao: SystemEventDao,
    logger: Pick<Logger, 'warn' | 'debug'>,
    options: { diagnosticEnabled?: boolean; retention?: SystemEventRetentionConfig } = {},
): SystemEventTap {
    const handlers = new Map<string, (event: unknown) => void>();
    const inFlight = new Set<Promise<void>>();

    const diagnosticEnabled = options.diagnosticEnabled === true;
    const quotas = resolveRetentionQuotas(options.retention);
    for (const entry of SYSTEM_EVENT_CATALOG) {
        // Diagnostic entries only persist/stream when the toggle is on (R5).
        // `persisted`/`streamed` flags are always `true` on the catalog entry
        // (they describe capability, not active subscription); tier is the
        // runtime switch — consult it, not the flags.
        if (entry.tier === 'diagnostic' && !diagnosticEnabled) continue;
        const handler = (event: unknown) => {
            const occurredAt = new Date().toISOString();
            const payloadJson = safeStringify(normalizeSystemEventPayload(entry, event));
            const actor = extractSystemEventActor(event);
            const p = persist(dao, entry.prefix, entry.name, occurredAt, actor, payloadJson, quotas, logger);
            inFlight.add(p);
            p.finally(() => inFlight.delete(p));
        };
        handlers.set(entry.name, handler);
        bus.on(entry.name, handler);
    }
    return {
        unsubscribe: () => {
            for (const [name, handler] of handlers) {
                bus.off(name, handler);
            }
            handlers.clear();
        },
        flush: async () => {
            while (inFlight.size > 0) {
                await Promise.allSettled(inFlight);
            }
        },
    };
}

async function persist(
    dao: SystemEventDao,
    prefix: string,
    name: string,
    occurredAt: string,
    actor: string | null,
    payloadJson: string | null,
    quotas: SystemEventRetentionQuotas,
    logger: Pick<Logger, 'warn' | 'debug'>,
): Promise<void> {
    try {
        await dao.insert({
            id: createId('sev'),
            event_name: name,
            occurred_at: occurredAt,
            actor,
            payload_json: payloadJson,
        });
        // Insert-time per-prefix prune backstop (R5): scope to the just-written
        // prefix so one prefix's overflow can never evict another prefix's rows.
        await dao.pruneQuotas(quotas, prefix);
    } catch (error) {
        logger.warn('system_events tap: persist failed', { name, error: stringifyError(error) });
    }
}

/**
 * Safely serialize an event to JSON, returning `null` on failure (e.g. circular
 * references). Shared by the persistence tap and the CLI planning emitter so
 * both produce identical canonical payloads.
 */
export function safeStringify(event: unknown): string | null {
    try {
        return JSON.stringify(event ?? null);
    } catch {
        return null;
    }
}

/**
 * Extract the actor for system-event persistence / SSE. Prefer an explicit
 * `actor` field (task 0226 F5); fall back to `agentId` so process lifecycle
 * payloads (`process.spawned|exited|stopped`) surface identity on the Teams
 * Activity board (0269 residual).
 */
export function extractSystemEventActor(event: unknown): string | null {
    if (event && typeof event === 'object') {
        const obj = event as Record<string, unknown>;
        if (typeof obj.actor === 'string' && obj.actor.length > 0) return obj.actor;
        if (typeof obj.agentId === 'string' && obj.agentId.length > 0) return obj.agentId;
    }
    return null;
}

function stringifyError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}
