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
 * DAO for the append-only `system_events` ledger, written by the server
 * EventBus tap (task 0189 wave A / 0198) and the CLI planning emitter
 * (task 0249). Retention is enforced per-prefix by the caller via
 * {@link pruneQuotas}; the DAO itself owns no policy constant. Raw SQL over
 * `DbAdapter` — same pattern as {@link PlanningEventDao}; apps/server never
 * imports ts-db.
 */

/** A single per-prefix retention quota: keep at most `quota` rows for `prefix`. */
export interface SystemEventRetentionQuota {
    /** Event-name prefix (e.g. `task`, `queue`) this quota applies to. */
    prefix: string;
    /** Maximum rows to retain for this prefix; older rows are pruned. */
    quota: number;
}

/** Ordered set of per-prefix retention quotas consumed by {@link SystemEventDao.pruneQuotas}. */
export type SystemEventRetentionQuotas = ReadonlyArray<SystemEventRetentionQuota>;

export class SystemEventDao {
    constructor(private readonly db: DbAdapter) {}

    /** Insert a single system event. */
    async insert(input: CreateSystemEventInput): Promise<void> {
        await this.db.run(
            `INSERT INTO system_events (id, event_name, occurred_at, actor, payload_json)
             VALUES (?1, ?2, ?3, ?4, ?5)`,
            input.id,
            input.event_name,
            input.occurred_at,
            input.actor ?? null,
            input.payload_json ?? null,
        );
    }

    /**
     * Delete the oldest rows beyond each prefix's retention quota (R2).
     * Scoping is per-prefix: one prefix's overflow can never evict another
     * prefix's rows. When `prefix` is supplied, only that prefix's quota is
     * enforced — used by the insert-time backstop for efficiency. No-op when
     * the table holds `quota` or fewer rows for every pruned prefix.
     *
     * Returns the total number of rows deleted across all pruned prefixes
     * (R5 — return-count contract).
     *
     * A missing or unmigrated `system_events` table logs and returns 0,
     * never throws (R4) — mirrors {@link query}'s safety pattern.
     */
    async pruneQuotas(quotas: SystemEventRetentionQuotas, prefix?: string): Promise<number> {
        try {
            const entries = prefix !== undefined ? quotas.filter((q) => q.prefix === prefix) : quotas;
            let deleted = 0;
            for (const { prefix: p, quota } of entries) {
                const pattern = `${p}.%`;
                const before = await this.db.queryFirst<{ c: number }>(
                    'SELECT COUNT(*) AS c FROM system_events WHERE event_name LIKE ?1',
                    pattern,
                );
                await this.db.run(
                    `DELETE FROM system_events
                     WHERE event_name LIKE ?1
                     AND id NOT IN (
                         SELECT id FROM system_events
                         WHERE event_name LIKE ?1
                         ORDER BY occurred_at DESC
                         LIMIT ?2
                     )`,
                    pattern,
                    quota,
                );
                const after = await this.db.queryFirst<{ c: number }>(
                    'SELECT COUNT(*) AS c FROM system_events WHERE event_name LIKE ?1',
                    pattern,
                );
                deleted += (before?.c ?? 0) - (after?.c ?? 0);
            }
            return deleted;
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: system_events')) {
                return 0;
            }
            throw error;
        }
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
