import {
    type CreateSystemEventInput,
    createId,
    type SystemEventDao,
    type SystemEventRetentionQuotas,
} from '@gobing-ai/spur-domain';
import type { EventBus, Logger } from '@gobing-ai/ts-infra';
import { SYSTEM_EVENT_CATALOG } from './event-names';
import {
    buildSystemEventEnvelope,
    type SystemEventProjectContext,
    systemEventProjectContext,
} from './system-event-envelope';
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
    options: {
        diagnosticEnabled?: boolean;
        retention?: SystemEventRetentionConfig;
        secretValues?: readonly string[];
        projectContext?: SystemEventProjectContext;
    } = {},
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
            const actor = extractSystemEventActor(event);
            const p = persist(
                dao,
                entry.prefix,
                {
                    id: createId('sev'),
                    event_name: entry.name,
                    occurred_at: new Date().toISOString(),
                    actor,
                    payload_json: safeStringify(
                        buildSystemEventEnvelope(
                            entry,
                            event,
                            options.projectContext ?? systemEventProjectContext(''),
                            options.secretValues,
                            actor,
                        ),
                    ),
                    // Indexed correlation columns (task 0369): derived from the
                    // same event the payload is serialized from, so a row's
                    // columns and payload can never disagree.
                    ...extractSystemEventCorrelation(event),
                },
                quotas,
                logger,
            );
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
    input: CreateSystemEventInput,
    quotas: SystemEventRetentionQuotas,
    logger: Pick<Logger, 'warn' | 'debug'>,
): Promise<void> {
    try {
        await dao.insert(input);
        // Insert-time per-prefix prune backstop (R5): scope to the just-written
        // prefix so one prefix's overflow can never evict another prefix's rows.
        await dao.pruneQuotas(quotas, prefix);
    } catch (error) {
        logger.warn('system_events tap: persist failed', {
            name: input.event_name,
            error: stringifyError(error),
        });
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
 * Activity board (0269 residual); then `memberId` for the team.* family
 * (task 0371 R4) when the payload uses member identity rather than agentId.
 */
export function extractSystemEventActor(event: unknown): string | null {
    if (event && typeof event === 'object') {
        const obj = event as Record<string, unknown>;
        if (typeof obj.actor === 'string' && obj.actor.length > 0) return obj.actor;
        if (typeof obj.agentId === 'string' && obj.agentId.length > 0) return obj.agentId;
        if (typeof obj.memberId === 'string' && obj.memberId.length > 0) return obj.memberId;
    }
    return null;
}

/**
 * Correlation identity persisted into the indexed `system_events` columns
 * (task 0369). Every field is nullable: an event carrying neither run nor
 * entity identity persists with nulls and still reads back cleanly (R4).
 */
export interface SystemEventCorrelation {
    run_id: string | null;
    entity_kind: string | null;
    entity_id: string | null;
    sequence: number | null;
}

/**
 * Extract the indexed correlation columns from an event (task 0369). Shared by
 * the persistence tap and the CLI planning emitter so both write paths derive
 * identity identically — the same one-canonical-derivation contract
 * {@link extractSystemEventActor} holds for actor.
 *
 * Two producers feed it: the 0365 observability envelope, whose `workflow.*`
 * and agent events carry `runId` plus a monotonic `sequence`; and planning
 * events, whose `task.*` / `feature.*` payloads carry `entity: { kind, id }`.
 * The two are disjoint in practice, but nothing here assumes that — an event
 * carrying both persists both.
 */
export function extractSystemEventCorrelation(event: unknown): SystemEventCorrelation {
    const correlation: SystemEventCorrelation = { run_id: null, entity_kind: null, entity_id: null, sequence: null };
    if (!event || typeof event !== 'object') return correlation;
    const obj = event as Record<string, unknown>;

    const nested =
        obj.correlation && typeof obj.correlation === 'object' ? (obj.correlation as Record<string, unknown>) : {};
    const runId = obj.runId ?? obj.run_id ?? nested.runId;
    if (typeof runId === 'string' && runId.length > 0) correlation.run_id = runId;
    // Reject non-finite sequences rather than persisting NaN into an INTEGER column.
    if (typeof obj.sequence === 'number' && Number.isFinite(obj.sequence)) correlation.sequence = obj.sequence;

    const entity = obj.entity;
    if (entity && typeof entity === 'object') {
        const { kind, id } = entity as Record<string, unknown>;
        if (typeof kind === 'string' && kind.length > 0) correlation.entity_kind = kind;
        if (typeof id === 'string' && id.length > 0) correlation.entity_id = id;
    }
    if (typeof obj.entityKind === 'string' && obj.entityKind.length > 0) correlation.entity_kind = obj.entityKind;
    if (typeof obj.entityId === 'string' && obj.entityId.length > 0) correlation.entity_id = obj.entityId;
    return correlation;
}

function stringifyError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}
