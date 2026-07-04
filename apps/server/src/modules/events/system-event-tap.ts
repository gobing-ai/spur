import type { PlanningEventName } from '@gobing-ai/spur-app';
import { createId, type SystemEventDao } from '@gobing-ai/spur-domain';
import type { EventBus, Logger } from '@gobing-ai/ts-infra';
import { PLANNING_EVENT_NAMES } from './event-names';

/** Cap for the append-only system_events ledger (task 0189). */
export const SYSTEM_EVENTS_CAP = 10_000;

/** The planning event bus shape consumed by the system-event tap. */
export type PlanningEventBus = EventBus<Record<PlanningEventName, (event: unknown) => void>>;

/** Handle returned by {@link registerSystemEventTap}. */
export interface SystemEventTap {
    /** Detach every handler wired by the tap; await no further work. */
    unsubscribe: () => void;
    /** Resolve once every in-flight persist has settled (test/shutdown drain). */
    flush: () => Promise<void>;
}

/**
 * Subscribe a {@link SystemEventDao} tap to the planning EventBus. Each emitted
 * event is persisted as a system_events row (newest-first ledger for the board's
 * history endpoint). A per-handler try/catch isolates persistence failures from
 * other bus subscribers — a tap failure is logged and swallowed, never thrown.
 */
export function registerSystemEventTap(
    bus: PlanningEventBus,
    dao: SystemEventDao,
    logger: Pick<Logger, 'warn' | 'debug'>,
): SystemEventTap {
    const handlers = new Map<PlanningEventName, (event: unknown) => void>();
    const inFlight = new Set<Promise<void>>();

    for (const name of PLANNING_EVENT_NAMES) {
        const handler = (event: unknown) => {
            const occurredAt = new Date().toISOString();
            const payloadJson = safeStringify(event);
            const actor = extractActor(event);
            const p = persist(dao, name, occurredAt, actor, payloadJson, logger);
            inFlight.add(p);
            p.finally(() => inFlight.delete(p));
        };
        handlers.set(name, handler);
        bus.on(name, handler);
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
    name: PlanningEventName,
    occurredAt: string,
    actor: string | null,
    payloadJson: string | null,
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
        // Insert-time prune backstop; moves to a scheduled job when task 0190 lands.
        await dao.prune(SYSTEM_EVENTS_CAP);
    } catch (error) {
        logger.warn('system_events tap: persist failed', { name, error: stringifyError(error) });
    }
}

function safeStringify(event: unknown): string | null {
    try {
        return JSON.stringify(event ?? null);
    } catch {
        return null;
    }
}

function extractActor(event: unknown): string | null {
    if (event && typeof event === 'object') {
        const candidate = (event as Record<string, unknown>).actor;
        if (typeof candidate === 'string') return candidate;
    }
    return null;
}

function stringifyError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
}
