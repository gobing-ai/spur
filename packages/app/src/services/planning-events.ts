/**
 * Planning events — typed event map and bus-wired emitter.
 *
 * Design §7: the six planning events emitted at step 8 of the write sequence.
 * The `PlanningEventMap` is the typed contract for ts-infra `EventBus`.
 * `BusPlanningEventEmitter` both publishes to the bus AND persists via
 * `PlanningEventDao`, so every event is durable (append-only ledger, §2.5).
 */

import { createId, type PlanningEventDao } from '@gobing-ai/spur-domain';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { EventEmitter, PlanningEvent, PlanningEventName } from './planning-write-service';

/**
 * Typed event map for the ts-infra `EventBus<PlanningEventMap>`.
 * Every planning event carries the full `PlanningEvent` envelope.
 */
export type PlanningEventMap = Record<PlanningEventName, (event: PlanningEvent) => void>;

/**
 * Event emitter that publishes to `EventBus<PlanningEventMap>` AND persists
 * every event to the SQLite `planning_events` ledger via `PlanningEventDao`.
 *
 * Replaces the no-op/capturing emitters once DAOs are wired (0053).
 */
export class BusPlanningEventEmitter implements EventEmitter {
    private readonly bus: EventBus<PlanningEventMap>;
    private readonly dao: PlanningEventDao;

    constructor(bus: EventBus<PlanningEventMap>, dao: PlanningEventDao) {
        this.bus = bus;
        this.dao = dao;
    }

    /** Emit to bus AND persist to the planning_events table. */
    async emit(event: PlanningEvent): Promise<void> {
        // Persist first so the event is durable before subscribers run.
        await this.dao.insert({
            id: createId('pev'),
            entity_kind: event.entity.kind,
            entity_id: event.entity.id,
            event: event.event,
            from_status: event.from ?? null,
            to_status: event.to ?? null,
            payload: event.data ? JSON.stringify(event.data) : null,
            created_at: event.at,
        });

        // Then publish to subscribers.
        this.bus.emit(event.event, event);
    }
}
