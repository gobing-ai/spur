import type { DbAdapter } from '@gobing-ai/ts-db';

/** Raw system_event row returned by query. */
export interface SystemEventRow {
    id: string;
    event_name: string;
    occurred_at: string;
    actor: string | null;
    payload_json: string | null;
    /** Workflow/agent run the event belongs to (task 0369). Null for planning events. */
    run_id: string | null;
    /** Entity kind for planning events (e.g. `task`, `feature`). Null for workflow/agent events. */
    entity_kind: string | null;
    /** Entity id for planning events. Null for workflow/agent events. */
    entity_id: string | null;
    /** Monotonic sequence within one run. Null for planning events. */
    sequence: number | null;
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
    /** Correlation: the workflow/agent run id (task 0369). */
    run_id?: string | null;
    /** Correlation: the planning entity kind (e.g. `task`, `feature`). */
    entity_kind?: string | null;
    /** Correlation: the planning entity id. */
    entity_id?: string | null;
    /** Correlation: monotonic sequence within one run. */
    sequence?: number | null;
}

/** Filter options for {@link SystemEventDao.query}. */
export interface SystemEventQuery {
    /** Filter by event name (e.g. `task.updated`). */
    name?: string;
    /** ISO timestamp — only events strictly newer than this are returned. */
    since?: string;
    /** Filter by run id (task 0369 correlation column). */
    run_id?: string;
    /** Filter by entity kind (e.g. `task`, `feature`). */
    entity_kind?: string;
    /** Filter by entity id. */
    entity_id?: string;
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

/** Column list every {@link SystemEventDao.query} projection returns, in row order. */
const SYSTEM_EVENT_COLUMNS =
    'id, event_name, occurred_at, actor, payload_json, run_id, entity_kind, entity_id, sequence';

export class SystemEventDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * Insert a single system event. Correlation columns default to null so a
     * caller with no run or entity identity (and any pre-0369 caller) writes a
     * row that reads back cleanly (R4).
     */
    async insert(input: CreateSystemEventInput): Promise<void> {
        await this.db.run(
            `INSERT INTO system_events (${SYSTEM_EVENT_COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
            input.id,
            input.event_name,
            input.occurred_at,
            input.actor ?? null,
            input.payload_json ?? null,
            input.run_id ?? null,
            input.entity_kind ?? null,
            input.entity_id ?? null,
            input.sequence ?? null,
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
     * Query events newest-first, optionally filtered by `name`, `since`
     * (ISO timestamp, exclusive), and the indexed correlation columns
     * (`run_id`, `entity_kind`, `entity_id` — task 0369). Filters compose with
     * AND, so `{ entity_kind, entity_id }` resolves one entity's stream through
     * `idx_system_events_entity` in a single indexed round trip rather than a
     * client-side scan of the newest-N window.
     *
     * Returns `[]` if the table is absent (e.g. an unmigrated DB) so a missing
     * ledger never breaks the history endpoint.
     */
    async query(spec: SystemEventQuery = {}): Promise<SystemEventRow[]> {
        const limit = spec.limit ?? 100;
        // Filters are assembled rather than branched: five optional predicates
        // would otherwise need 32 hand-written statements.
        const filters: Array<{ column: string; op: string; value: string }> = [];
        if (spec.name !== undefined) filters.push({ column: 'event_name', op: '=', value: spec.name });
        if (spec.since !== undefined) filters.push({ column: 'occurred_at', op: '>', value: spec.since });
        if (spec.run_id !== undefined) filters.push({ column: 'run_id', op: '=', value: spec.run_id });
        if (spec.entity_kind !== undefined) filters.push({ column: 'entity_kind', op: '=', value: spec.entity_kind });
        if (spec.entity_id !== undefined) filters.push({ column: 'entity_id', op: '=', value: spec.entity_id });

        const where =
            filters.length === 0
                ? ''
                : `WHERE ${filters.map((f, index) => `${f.column} ${f.op} ?${index + 1}`).join(' AND ')}`;
        const params: Array<string | number> = [...filters.map((f) => f.value), limit];

        try {
            return await this.db.queryAll<SystemEventRow>(
                `SELECT ${SYSTEM_EVENT_COLUMNS}
                 FROM system_events
                 ${where}
                 ORDER BY occurred_at DESC
                 LIMIT ?${params.length}`,
                ...params,
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
