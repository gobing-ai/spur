import type { DbAdapter } from '@gobing-ai/ts-db';

/** Raw system_event row returned by query. */
export interface SystemEventRow {
    id: string;
    event_name: string;
    occurred_at: string;
    actor: string | null;
    payload_json: string | null;
}

/** Input for inserting a system event. */
export interface CreateSystemEventInput {
    id: string;
    event_name: string;
    /** ISO timestamp; persisted verbatim (the tap supplies `new Date().toISOString()`). */
    occurred_at: string;
    actor?: string | null;
    /** Pre-serialized JSON payload (`JSON.stringify(event)`), or null. */
    payload_json?: string | null;
}

/** Filter options for {@link SystemEventDao.query}. */
export interface SystemEventQuery {
    /** Filter by event name (e.g. `task.updated`). */
    name?: string;
    /** ISO timestamp — only events strictly newer than this are returned. */
    since?: string;
    /** Max rows to return (newest first). Default 100. */
    limit?: number;
}

/**
 * DAO for the capped append-only `system_events` ledger, written by the server
 * EventBus tap (task 0189 wave A / 0198). The cap is enforced by the caller via
 * {@link prune}; the DAO itself owns no policy constant. Raw SQL over `DbAdapter`
 * — same pattern as {@link PlanningEventDao}; apps/server never imports ts-db.
 */
export class SystemEventDao {
    constructor(private readonly db: DbAdapter) {}

    /** Insert a single system event. */
    async insert(input: CreateSystemEventInput): Promise<void> {
        await this.db.run(
            `INSERT INTO system_events (id, event_name, occurred_at, actor, payload_json)
             VALUES (?, ?, ?, ?, ?)`,
            [input.id, input.event_name, input.occurred_at, input.actor ?? null, input.payload_json ?? null],
        );
    }

    /**
     * Delete the oldest rows beyond `cap`, keeping at most `cap` most-recent rows.
     * No-op when the table holds `cap` or fewer rows. Called by the tap after each
     * insert (insert-time prune backstop; moves to a scheduled job when 0190 lands).
     * Returns the number of rows deleted for observability/testing.
     */
    async prune(cap: number): Promise<number> {
        // Correlated delete: identify the cutoff row id (the cap-th newest by
        // occurred_at) and delete everything strictly older than it. A single
        // statement keeps this atomic and avoids a separate count round-trip.
        const before = await this.db.queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM system_events');
        await this.db.run(
            `DELETE FROM system_events
             WHERE id IN (
                 SELECT id FROM system_events
                 WHERE id NOT IN (
                     SELECT id FROM system_events
                     ORDER BY occurred_at DESC
                     LIMIT ?1
                 )
             )`,
            [cap],
        );
        const after = await this.db.queryFirst<{ c: number }>('SELECT COUNT(*) AS c FROM system_events');
        return (before?.c ?? 0) - (after?.c ?? 0);
    }
    /**
     * Query events newest-first, optionally filtered by `name` and/or `since`
     * (ISO timestamp, exclusive). Returns `[]` if the table is absent (e.g. an
     * unmigrated DB) so a missing ledger never breaks the history endpoint.
     */
    async query(spec: SystemEventQuery = {}): Promise<SystemEventRow[]> {
        const limit = spec.limit ?? 100;
        try {
            if (spec.name !== undefined && spec.since !== undefined) {
                return await this.db.queryAll<SystemEventRow>(
                    `SELECT id, event_name, occurred_at, actor, payload_json
                     FROM system_events
                     WHERE event_name = ?1 AND occurred_at > ?2
                     ORDER BY occurred_at DESC
                     LIMIT ?3`,
                    spec.name,
                    spec.since,
                    limit,
                );
            }
            if (spec.name !== undefined) {
                return await this.db.queryAll<SystemEventRow>(
                    `SELECT id, event_name, occurred_at, actor, payload_json
                     FROM system_events
                     WHERE event_name = ?1
                     ORDER BY occurred_at DESC
                     LIMIT ?2`,
                    spec.name,
                    limit,
                );
            }
            if (spec.since !== undefined) {
                return await this.db.queryAll<SystemEventRow>(
                    `SELECT id, event_name, occurred_at, actor, payload_json
                     FROM system_events
                     WHERE occurred_at > ?1
                     ORDER BY occurred_at DESC
                     LIMIT ?2`,
                    spec.since,
                    limit,
                );
            }
            return await this.db.queryAll<SystemEventRow>(
                `SELECT id, event_name, occurred_at, actor, payload_json
                 FROM system_events
                 ORDER BY occurred_at DESC
                 LIMIT ?1`,
                limit,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: system_events')) {
                return [];
            }
            throw error;
        }
    }

    /** Delete all rows (test teardown + future scheduler reset). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM system_events');
    }
}
