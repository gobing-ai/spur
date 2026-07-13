/**
 * Durable, DAO-backed planning event emitter for the CLI mutation path
 * (task 0249). The spur-side analog of ts-libs 0049 — a process-independent
 * sink that persists `task.*` / `feature.*` events straight into the shared
 * `system_events` ledger so CLI-driven status changes appear in the System
 * Events tabview without requiring a running server at emit time.
 *
 * Reuses the SAME catalog normalization (`normalizeSystemEventPayload`),
 * actor extraction (`extractSystemEventActor`), and DAO persistence contract
 * as the server tap (`system-event-tap.ts`) — one canonical serialization of
 * planning events, not a fork (R3). Sink failures are logged and swallowed
 * so the underlying file mutation still succeeds (R5).
 */

import { createId, type SystemEventDao } from '@gobing-ai/spur-domain';
import type { Logger } from '@gobing-ai/ts-infra';
import { normalizeSystemEventPayload, systemEventCatalogEntry } from './event-names';
import type { EventEmitter, PlanningEvent } from './planning-write-service';
import { extractSystemEventActor, SYSTEM_EVENTS_CAP, safeStringify } from './system-event-tap';

/** Minimal logger surface required by {@link SystemEventEmitter}. */
export type SystemEventEmitterLogger = Pick<Logger, 'warn'>;

/**
 * Persists planning events (`task.*` / `feature.*`) into the shared
 * `system_events` ledger via {@link SystemEventDao}. Wired only on the CLI
 * mutation path (`task.ts` / `feature.ts` `makeService` builders); the server
 * path keeps {@link registerSystemEventTap}, so a status change flowing
 * through the Board API writes exactly one row (R6).
 *
 * The CLI already opens the shared SQLite DB (`CliContext.getDb()` →
 * `createMigratedDb`, which applies `drizzle/0006_spur_cli_system_events.sql`),
 * so the `system_events` table is present and rows written here reach the
 * same ledger the tabview reads (R4).
 */
export class SystemEventEmitter implements EventEmitter {
    constructor(
        private readonly dao: SystemEventDao,
        private readonly logger: SystemEventEmitterLogger,
    ) {}

    async emit(event: PlanningEvent): Promise<void> {
        const entry = systemEventCatalogEntry(event.event);
        // Unregistered names are a no-op — the catalog is the single source of
        // which planning events are board-observable.
        if (!entry) return;
        try {
            await this.dao.insert({
                id: createId('sev'),
                event_name: entry.name,
                occurred_at: event.at,
                actor: extractSystemEventActor(event),
                payload_json: safeStringify(normalizeSystemEventPayload(entry, event)),
            });
            // Honor the append-only cap (R7) — mirror the tap's insert-time prune.
            await this.dao.prune(SYSTEM_EVENTS_CAP);
        } catch (error) {
            // Failure isolation (R5): log + swallow. Never throw to the caller —
            // a sink write error must not abort or roll back the file mutation.
            this.logger.warn('system_events emitter: persist failed', {
                event: event.event,
                error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            });
        }
    }
}
