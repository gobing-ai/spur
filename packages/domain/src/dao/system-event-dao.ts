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
    /**
     * Global monotonic ledger cursor assigned at persist time (task 0531).
     * Null only for legacy pre-0369 rows that predate the column.
     */
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
    /**
     * Optional explicit sequence. Omitted (or null) → a global monotonic
     * ledger cursor is auto-assigned on insert (task 0531).
     */
    sequence?: number | null;
}

/**
 * Exclusive keyset cursor for newest-first pagination (task 0372).
 * Rows strictly older than `(occurred_at, id)` are returned; concurrent inserts
 * with a newer timestamp cannot reappear on later pages.
 */
export interface SystemEventQueryCursor {
    /** ISO timestamp of the last row of the previous page. */
    occurred_at: string;
    /** Primary key of the last row of the previous page (tie-break). */
    id: string;
}

/** Filter options for {@link SystemEventDao.query}. */
export interface SystemEventQuery {
    /** Filter by event name (e.g. `task.updated`). */
    name?: string;
    /**
     * Multi-value event-name filter (task 0372). Applied as `event_name IN (...)`.
     * Empty arrays are ignored (no filter).
     */
    names?: readonly string[];
    /**
     * Event-name prefix filter (task 0372), e.g. `task` → `event_name LIKE 'task.%'`.
     * Catalog validation is the caller's responsibility (history endpoint rejects
     * uncataloged prefixes before reaching the DAO).
     */
    prefix?: string;
    /** ISO timestamp — only events strictly newer than this are returned. */
    since?: string;
    /** Filter by run id (task 0369 correlation column). */
    run_id?: string;
    /** Filter by entity kind (e.g. `task`, `feature`). */
    entity_kind?: string;
    /** Filter by entity id. */
    entity_id?: string;
    /** Filter by actor column (task 0372). */
    actor?: string;
    /**
     * Exclusive keyset cursor (task 0372). When set, only rows strictly older
     * than this position are returned (`ORDER BY occurred_at DESC, id DESC`).
     */
    before?: SystemEventQueryCursor;
    /** Max rows to return (newest first). Default 100. */
    limit?: number;
}

/** A single per-prefix retention quota: keep at most `quota` rows for `prefix`. */
export interface SystemEventRetentionQuota {
    /** Event-name prefix (e.g. `task`, `queue`) this quota applies to. */
    prefix: string;
    /** Maximum rows to retain for this prefix; older rows are pruned. */
    quota: number;
}

/** Ordered set of per-prefix retention quotas consumed by {@link SystemEventDao.pruneQuotas}. */
export type SystemEventRetentionQuotas = ReadonlyArray<SystemEventRetentionQuota>;

/** Window bounds for {@link SystemEventDao.routingSummary}. Inclusive on both ends. */
export interface RoutingSummaryWindow {
    /** Inclusive lower bound (ISO timestamp). */
    since: string;
    /** Inclusive upper bound (ISO timestamp). */
    until: string;
}

/**
 * One (role, executor) pair aggregated over a window (task 0546 R1).
 * `role` is null for dispatches that carried no role (a pure pin); the
 * `source` field keeps pinned (`explicit`) runs separate from role-resolved
 * (`role` / `default`) evidence (R4). Both are nullable because a routing
 * block admits an executor without role or source — `json_extract` of an
 * absent key yields NULL (0546 review P3).
 */
export interface RoutingSummaryPair {
    /** Role the run was serving; null when the dispatch recorded no role. */
    role: string | null;
    /** Executor that served the role. */
    executor: string;
    /** Selection source recorded on the dispatch (`role` | `explicit` | `default` | `phase` | `stage` | `priority`); null when absent. */
    source: string | null;
    /** Number of dispatches (`agent.invoke.start` rows with attribution) for the pair. */
    runs: number;
    /**
     * Number of escalations that started from this pair's executor on runs of
     * this role, joined by `run_id` (task 0546 R1). Zero when the pair never
     * escalated — absence, not a null.
     */
    escalations: number;
}

/** Result of {@link SystemEventDao.routingSummary}: pairs plus the window actually covered (R5). */
export interface RoutingSummaryResult {
    /** The inclusive window the counts cover — reported, never implied. */
    window: RoutingSummaryWindow;
    /** Aggregated pairs, highest run count first. */
    pairs: RoutingSummaryPair[];
}

/** Options for {@link SystemEventDao.routingSummary}. */
export interface RoutingSummaryQuery {
    /** Inclusive lower bound (ISO); defaults to {@link ROUTING_SUMMARY_DEFAULT_WINDOW_MS} before `until`. */
    since?: string;
    /** Inclusive upper bound (ISO); defaults to now. */
    until?: string;
}

/**
 * Default "bounded recent" window for {@link SystemEventDao.routingSummary}
 * (task 0546 frozen names — "no unbounded scan"). One week of ledger.
 */
export const ROUTING_SUMMARY_DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Column list every {@link SystemEventDao.query} projection returns, in row order. */
const SYSTEM_EVENT_COLUMNS =
    'id, event_name, occurred_at, actor, payload_json, run_id, entity_kind, entity_id, sequence';

/**
 * DAO for the append-only `system_events` ledger, written by the server
 * EventBus tap (task 0189 wave A / 0198) and the CLI planning emitter
 * (task 0249). Retention is enforced per-prefix by the caller via
 * {@link pruneQuotas}; the DAO itself owns no policy constant. Raw SQL over
 * `DbAdapter` — same pattern as {@link PlanningEventDao}; apps/server never
 * imports ts-db.
 */
export class SystemEventDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * Insert a single system event. Correlation columns default to null so a
     * caller with no run or entity identity (and any pre-0369 caller) writes a
     * row that reads back cleanly (R4).
     *
     * `sequence` is auto-assigned as a global monotonic ledger cursor when the
     * caller omits it (task 0531): the follow helper keys off `sequence >
     * cursor`, so every persisted row must carry one. The assignment is one
     * atomic `INSERT ... SELECT` — the `MAX(sequence)` subquery runs under the
     * same statement's write lock, so concurrent inserts cannot both read the
     * same max. An explicit sequence (tests, backfills) is honored verbatim.
     */
    async insert(input: CreateSystemEventInput): Promise<void> {
        await this.db.run(
            `INSERT INTO system_events (${SYSTEM_EVENT_COLUMNS})
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                    CASE WHEN ?9 IS NULL THEN COALESCE(MAX(sequence), 0) + 1 ELSE ?9 END
             FROM system_events`,
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
     * Query events newest-first, optionally filtered by name(s), prefix, since,
     * actor, the indexed correlation columns (`run_id`, `entity_kind`,
     * `entity_id` — task 0369), and an exclusive keyset cursor (`before` —
     * task 0372). Filters compose with AND and are applied in SQL, never by
     * post-filtering a prefetched page.
     *
     * Ordering is `occurred_at DESC, id DESC` so a `(occurred_at, id)` cursor is
     * a total order: concurrent inserts newer than the cursor cannot reappear on
     * later pages, and rows older than the cursor are never skipped.
     *
     * Returns `[]` if the table is absent (e.g. an unmigrated DB) so a missing
     * ledger never breaks the history endpoint.
     */
    async query(spec: SystemEventQuery = {}): Promise<SystemEventRow[]> {
        const limit = spec.limit ?? 100;
        // Clause fragments + bound params assembled together so IN / LIKE /
        // keyset predicates share one parameter counter with the simple equals.
        const clauses: string[] = [];
        const params: Array<string | number> = [];
        const pushEq = (column: string, value: string) => {
            params.push(value);
            clauses.push(`${column} = ?${params.length}`);
        };

        if (spec.name !== undefined) pushEq('event_name', spec.name);
        if (spec.names !== undefined && spec.names.length > 0) {
            const placeholders: string[] = [];
            for (const name of spec.names) {
                params.push(name);
                placeholders.push(`?${params.length}`);
            }
            clauses.push(`event_name IN (${placeholders.join(', ')})`);
        }
        if (spec.prefix !== undefined) {
            // Prefix is a cataloged family name (`task`, `workflow`, …), never a
            // user-supplied LIKE pattern — still escape LIKE metacharacters so a
            // future prefix containing `_` cannot broaden the match.
            const escaped = spec.prefix.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
            params.push(`${escaped}.%`);
            clauses.push(`event_name LIKE ?${params.length} ESCAPE '\\'`);
        }
        if (spec.since !== undefined) {
            params.push(spec.since);
            clauses.push(`occurred_at > ?${params.length}`);
        }
        if (spec.run_id !== undefined) pushEq('run_id', spec.run_id);
        if (spec.entity_kind !== undefined) pushEq('entity_kind', spec.entity_kind);
        if (spec.entity_id !== undefined) pushEq('entity_id', spec.entity_id);
        if (spec.actor !== undefined) pushEq('actor', spec.actor);
        if (spec.before !== undefined) {
            // Exclusive keyset: strictly older than the previous page's last row.
            params.push(spec.before.occurred_at);
            const atIdx = params.length;
            params.push(spec.before.id);
            const idIdx = params.length;
            clauses.push(`(occurred_at < ?${atIdx} OR (occurred_at = ?${atIdx} AND id < ?${idIdx}))`);
        }

        const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
        params.push(limit);

        try {
            return await this.db.queryAll<SystemEventRow>(
                `SELECT ${SYSTEM_EVENT_COLUMNS}
                 FROM system_events
                 ${where}
                 ORDER BY occurred_at DESC, id DESC
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

    /**
     * Keyset-follow over the append-only ledger (G4 R8 / task 0531): rows with
     * `sequence > afterSequence` in ascending `(sequence, id)` order, capped at
     * `limit`. The sequence column is a monotonically increasing row marker, so
     * this is the follow source for wait/reconnect consumers — the app-side
     * `followSystemEventsAfter` helper owns the cursor/poll loop over this.
     * Mirrors {@link query}'s safety pattern: a missing table returns `[]`.
     */
    async follow(afterSequence: number, limit = 100): Promise<SystemEventRow[]> {
        try {
            return await this.db.queryAll<SystemEventRow>(
                `SELECT ${SYSTEM_EVENT_COLUMNS}
                 FROM system_events
                 WHERE sequence > ?1
                 ORDER BY sequence ASC, id ASC
                 LIMIT ?2`,
                afterSequence,
                limit,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: system_events')) {
                return [];
            }
            throw error;
        }
    }

    /**
     * Return the maximum sequence number present in the ledger, or 0 if empty.
     */
    async latestSequence(): Promise<number> {
        try {
            const rows = await this.db.queryAll<{ max_seq: number | null }>(
                'SELECT MAX(sequence) as max_seq FROM system_events',
            );
            return rows[0]?.max_seq ?? 0;
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: system_events')) {
                return 0;
            }
            throw error;
        }
    }

    /**
     * Aggregate role→executor routing over a bounded window in one indexed
     * round trip (task 0546 R1/R2).
     *
     * The answer to "which executor served which role, how often, and how often
     * did it escalate" is computed in SQL — never by sifting a fixed row window
     * client-side (the failure mode feature J3 fixed on this ledger). The
     * `event_name` + window predicates are served by the composite
     * `idx_system_events_name_occurred` index (task 0546 R2); the escalation
     * join uses the indexed `run_id` column, so work is bounded to the
     * attribution families and result size does not depend on unrelated event
     * families.
     *
     * Counts:
     * - `runs` — `agent.invoke.start` rows carrying a routing block, grouped by
     *   (role, executor, source). Start (not exit) is the dispatch moment, so a
     *   run is never double-counted, and an escalated re-dispatch is its own
     *   serve on the executor it landed on.
     * - `escalations` — `agent.invoke.escalated` rows whose `fromExecutor` and
     *   `run_id` match the pair's dispatch: "this pairing started too cheap and
     *   had to escalate", not "this pairing was escalated to".
     *
     * Pre-attribution rows (no routing metadata — `data.routing.executor` is
     * NULL) and malformed payloads (non-JSON) are excluded from counts rather
     * than imputed as an unknown role (R5); the covered window is reported on
     * the result. Rows with a NULL `role` (pure pins) group under `role: null`.
     *
     * Mirrors {@link query}'s safety pattern: a missing table returns an empty
     * result rather than throwing.
     */
    async routingSummary(spec: RoutingSummaryQuery = {}): Promise<RoutingSummaryResult> {
        const until = spec.until ?? new Date().toISOString();
        const since = spec.since ?? new Date(Date.parse(until) - ROUTING_SUMMARY_DEFAULT_WINDOW_MS).toISOString();
        try {
            const rows = await this.db.queryAll<RoutingSummaryPair>(
                `WITH routed AS (
                     SELECT id, run_id, occurred_at,
                            json_extract(payload_json, '$.data.routing.role') AS role,
                            json_extract(payload_json, '$.data.routing.executor') AS executor,
                            json_extract(payload_json, '$.data.routing.source') AS source
                     FROM system_events
                     WHERE event_name = 'agent.invoke.start'
                       AND occurred_at >= ?1 AND occurred_at <= ?2
                       AND json_valid(payload_json) = 1
                       AND json_extract(payload_json, '$.data.routing.executor') IS NOT NULL
                 ),
                 esc AS (
                     SELECT id, run_id,
                            json_extract(payload_json, '$.data.fromExecutor') AS from_executor
                     FROM system_events
                     WHERE event_name = 'agent.invoke.escalated'
                       AND occurred_at >= ?1 AND occurred_at <= ?2
                       AND json_valid(payload_json) = 1
                       AND json_extract(payload_json, '$.data.fromExecutor') IS NOT NULL
                 ),
                 -- One dispatch row per (run_id, executor): the earliest. An
                 -- escalation record names only run_id + fromExecutor, so it is
                 -- attributed to a single dispatch — the one that started the
                 -- run on that executor — never fanned out to every (role,
                 -- source) group sharing the pair (0546 review P3).
                 first_routed AS (
                     SELECT r.*
                     FROM routed r
                     WHERE r.id = (
                         SELECT r2.id
                         FROM routed r2
                         WHERE r2.run_id = r.run_id AND r2.executor = r.executor
                         ORDER BY r2.occurred_at, r2.id
                         LIMIT 1
                     )
                 )
                 SELECT r.role AS role,
                        r.executor AS executor,
                        r.source AS source,
                        COUNT(DISTINCT r.id) AS runs,
                        COUNT(DISTINCT e.id) AS escalations
                 FROM routed r
                 LEFT JOIN first_routed fr ON fr.id = r.id
                 LEFT JOIN esc e ON e.run_id = fr.run_id AND e.from_executor = fr.executor
                 GROUP BY r.role, r.executor, r.source
                 -- Deterministic tie order: runs DESC, executor ASC, then the
                 -- group keys (SQLite NULLs sort first on ASC) — equal-count
                 -- pairs must not come back in optimizer-dependent order.
                 ORDER BY runs DESC, executor ASC, role ASC, source ASC`,
                since,
                until,
            );
            return { window: { since, until }, pairs: rows };
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: system_events')) {
                return { window: { since, until }, pairs: [] };
            }
            throw error;
        }
    }

    /** Delete all rows (test teardown + future scheduler reset). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM system_events');
    }
}
