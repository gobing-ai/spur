import type { DbAdapter } from '@gobing-ai/ts-db';
import type { JobQueue, QueueConsumer, QueueConsumerConfig } from '@gobing-ai/ts-infra';
import type { DatabaseConfig } from '@gobing-ai/ts-runtime';
import { applyCliMigrations } from './migrations';

/** Options for creating the Spur domain database. */
export interface CreateDomainDbOptions {
    /** SQLite URL or `:memory:`. */
    url: string;
}

/**
 * SQLite busy timeout for Spur's shared project database (bug-245 lineage,
 * dogfood 2026-08-31): the `self serve` daemon's daily pipeline imports with
 * concurrent fan-out while CLI processes open the same WAL database, and
 * multi-second write transactions outlast a 5s ceiling. 30s bounds that
 * contention without unbounded waits.
 */
export const SQLITE_BUSY_TIMEOUT_MS = 30_000;

/**
 * Create a bun-sqlite adapter and apply the Spur CLI-owned schema.
 *
 * `@gobing-ai/ts-db` (Bun SQLite, a native module) is imported LAZILY so that
 * importing this module's pure helpers (e.g. {@link dbHealthCheck}) from a
 * Cloudflare Workers bundle does NOT drag Bun-native code into the isolate at
 * module-init time (which crashes the Worker). The native dep loads only when a
 * Bun adapter is actually constructed — never on the Workers path.
 */
export async function createMigratedDb(options: CreateDomainDbOptions): Promise<DbAdapter> {
    const { createDbAdapter } = await import('@gobing-ai/ts-db');
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: options.url });
    // Concurrent spur processes (or a stale WAL lock) retry within
    // SQLITE_BUSY_TIMEOUT_MS instead of throwing SQLITE_BUSY immediately; the
    // upstream BunSqliteAdapter defaults omit busy_timeout. (Run via exec
    // because the typed pragmas option only accepts journalMode/synchronous/
    // foreignKeys — the runtime constructor only applies those three.)
    await adapter.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    await applyCliMigrations(adapter);
    return adapter;
}

/**
 * Create a platform-selected DB adapter via ts-runtime and apply Spur's
 * CLI schema migrations (design §2.3, §2.1.1, invariant #9).
 *
 * The runtime owns connection + platform selection; spur-domain owns schema
 * + the widening cast from RuntimeDbAdapter to the full DbAdapter.
 *
 * On the Cloudflare Workers path, `createDbAdapter` throws
 * `D1NotConfiguredError` until D1 ships — the caller propagates it.
 */
export async function createMigratedDbViaRuntime(config: DatabaseConfig): Promise<DbAdapter> {
    const { loadRuntimeFactory } = await import('@gobing-ai/ts-runtime');
    const factory = await loadRuntimeFactory();
    const runtimeAdapter = await factory.createDbAdapter(config);
    // Concurrent spur processes (or a stale WAL lock) retry within
    // SQLITE_BUSY_TIMEOUT_MS instead of throwing SQLITE_BUSY immediately; the
    // upstream BunSqliteAdapter defaults omit busy_timeout. (Run via exec
    // because the typed pragmas option only accepts journalMode/synchronous/
    // foreignKeys — the runtime constructor only applies those three.)
    await runtimeAdapter.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    await applyCliMigrations(runtimeAdapter as unknown as DbAdapter);
    return runtimeAdapter as unknown as DbAdapter;
}

export type { DbAdapter } from '@gobing-ai/ts-db';
export type { DatabaseConfig } from '@gobing-ai/ts-runtime';

/** Simple DB liveness probe — returns true when the adapter responds to a trivial query. */
export async function dbHealthCheck(db: DbAdapter): Promise<boolean> {
    try {
        await db.queryFirst<{ one: number }>('SELECT 1 AS one');
        return true;
    } catch {
        return false;
    }
}

/**
 * Build a `DBJobQueue` producer over the migrated `queue_jobs` table.
 *
 * The ts-db `QueueJobDao` + ts-infra `DBJobQueue` are imported LAZILY (and the
 * ts-infra value lives on the `/job-queue-db` subpath, not the root barrel) so a
 * Cloudflare Workers bundle that imports this module's pure helpers never drags
 * Bun-native ts-db onto the module-init path. `events` is an optional
 * `EventBus<QueueEvents>` for `queue.job.*` lifecycle telemetry.
 *
 * @returns a `JobQueue<T>` (`enqueue`/`enqueueBatch`/`stats`).
 */
export async function createJobQueue<T = unknown>(db: DbAdapter, events?: unknown): Promise<JobQueue<T>> {
    const { DBJobQueue } = await import('@gobing-ai/ts-infra/job-queue-db');
    const { QueueJobDao } = await import('@gobing-ai/ts-db');
    return new DBJobQueue<T>(new QueueJobDao(db), events as never);
}

/**
 * A `QueueConsumer` that also exposes `processOnce()` — the synchronous
 * single-batch drain on `DBQueueConsumer`, used by schedulers, manual drains,
 * and deterministic tests. (The base `QueueConsumer` interface omits it.)
 */
export type ServerQueueConsumer<T = unknown> = QueueConsumer<T> & {
    processOnce(): Promise<number>;
};

/**
 * Build a `DBQueueConsumer` over the migrated `queue_jobs` table. The caller
 * registers handlers, then `start()`s it (Bun entry only — a stateless Worker
 * enqueues but does not consume). Same lazy-import discipline as
 * {@link createJobQueue}.
 */
export async function createQueueConsumer<T = unknown>(
    db: DbAdapter,
    config?: QueueConsumerConfig,
): Promise<ServerQueueConsumer<T>> {
    const { DBQueueConsumer } = await import('@gobing-ai/ts-infra/job-queue-db');
    const { QueueJobDao } = await import('@gobing-ai/ts-db');
    return new DBQueueConsumer<T>(new QueueJobDao(db), config) as ServerQueueConsumer<T>;
}

/** A pending queue job read back for coalescing (task 0549 / feature E3). */
export interface PendingQueueJob<T = unknown> {
    id: string;
    payload: T;
}

/**
 * Find the single pending job of a type — any retry state, oldest first —
 * without claiming it (task 0549 / feature E3).
 *
 * The coalescing writer needs "is there already a pending refresh for this
 * type?" regardless of `nextRetryAt`: a job still inside its debounce delay is
 * precisely the one a burst should join. `findPending(batchSize)` on
 * `QueueJobDao` is the wrong tool (it filters ready-for-processing); this
 * helper predicates on `(type, status)` via the DAO's structured list spec,
 * so the app layer never sees raw SQL or ts-db (ADR-011). Same lazy-import
 * discipline as {@link createJobQueue}.
 *
 * @returns the oldest pending job's id + parsed payload, or `undefined`.
 */
export async function findPendingQueueJob<T = unknown>(
    db: DbAdapter,
    type: string,
): Promise<PendingQueueJob<T> | undefined> {
    const { QueueJobDao } = await import('@gobing-ai/ts-db');
    const { queueJobs } = await import('@gobing-ai/ts-db/schema');
    const dao = new QueueJobDao(db);
    const row = await dao.list({
        where: {
            and: [
                { col: queueJobs.type, op: 'eq', value: type },
                { col: queueJobs.status, op: 'eq', value: 'pending' },
            ],
        },
        orderBy: [{ col: queueJobs.createdAt, dir: 'asc' }],
        limit: 1,
    });
    const first = row[0];
    if (first === undefined) return undefined;
    let payload: T;
    try {
        payload = JSON.parse(first.payload) as T;
    } catch {
        return undefined;
    }
    return { id: first.id, payload };
}

/**
 * Coalesce-update a pending queue job in place: replace its payload and push
 * its retry window out (task 0549 / feature E3). The debounce restart is what
 * makes a burst collapse into one row. Returns the updated row id, or
 * `undefined` when the job is gone.
 */
export async function updatePendingQueueJob<T = unknown>(
    db: DbAdapter,
    id: string,
    payload: T,
    nextRetryAt: number,
): Promise<string | undefined> {
    const { QueueJobDao } = await import('@gobing-ai/ts-db');
    const dao = new QueueJobDao(db);
    const updated = await dao.update(id, { payload: JSON.stringify(payload), nextRetryAt });
    return updated?.id;
}

export type { JobQueue, QueueConsumer, QueueConsumerConfig } from '@gobing-ai/ts-infra';

/** Options for {@link enqueueCoalesced}. */
export interface CoalescedEnqueueSpec {
    /** Job type (queue_jobs.type). */
    type: string;
    /** Payload for a fresh enqueue (any JSON-serializable value). */
    payload: unknown;
    /** Debounce window in ms — the job becomes ready this long after the LAST join. */
    debounceMs: number;
    /**
     * User/scheduler-initiated request: a fresh job is ready immediately (due now)
     * and joining a pending job can only SHORTEN its due time, never extend it.
     * Default false — completion events debounce by `debounceMs` (window slides).
     */
    immediate?: boolean;
    /** Merge an incoming payload into a pending job's payload (coalescing). */
    mergePayload?: (existing: unknown, incoming: unknown) => unknown;
    /** Clock seam for deterministic tests (default `Date.now`). */
    now?: () => number;
}

/** Outcome of {@link enqueueCoalesced}. */
export type CoalescedEnqueueResult =
    | { status: 'enqueued'; jobId: string; payload: unknown }
    | { status: 'coalesced'; jobId: string; payload: unknown }
    | { status: 'already-running'; jobId: string; payload: unknown };

/**
 * Enqueue with debounce-style coalescing (task 0549 R2, extended by 0716): if an
 * **active** (pending or processing) job of the same type exists, the request
 * never creates a second row — a pending job is JOINED (merged payload, due time
 * pushed or shortened), a processing job yields `already-running` with its id — so
 * a burst of producers yields exactly one active job per coalesced type (0716
 * R3/R4). Only finished jobs are invisible: a completion arriving after the job
 * finished enqueues a fresh one.
 *
 * Due time: non-immediate requests debounce — a fresh job becomes ready at
 * `now + debounceMs` and every join slides the window out again (the covered
 * window always ends one debounce after the LAST joined event). Immediate requests
 * (manual refresh, schedule tick) are ready NOW, and joining a pending job can
 * only SHORTEN its due time (`min(existing, now)`) — an immediate request never
 * delays work an earlier request already scheduled.
 *
 * Atomicity (P2 review fix): the fresh-enqueue is an `INSERT … ON CONFLICT DO NOTHING`
 * against the `queue_jobs_history_refresh_active_unique` partial unique index
 * (`migrations.ts`, migration 0027), which enforces at most one ACTIVE row per
 * coalesced type at the DB level — two producers from different processes
 * (parallel agents in runall, sharing `.spur/spur.db`) serialize on the index
 * instead of enqueuing duplicates. The returned `payload` is the POST-merge
 * payload (P3 review fix) so an enqueue-time observable carries the merged burst
 * window, not just the incoming completion.
 *
 * The ts-db `QueueJobDao` + the `queue_jobs` drizzle schema are imported lazily for the
 * same Workers-bundle reason as {@link createJobQueue}.
 */
export async function enqueueCoalesced(db: DbAdapter, spec: CoalescedEnqueueSpec): Promise<CoalescedEnqueueResult> {
    const now = spec.now?.() ?? Date.now();
    const immediate = spec.immediate === true;
    const freshDueAt = immediate ? now : now + spec.debounceMs;

    // Atomic fresh-enqueue (no merge semantics in SQL — the merge payload is computed
    // in JS below). `ON CONFLICT DO NOTHING` without a target resolves against every
    // unique index; the scoped partial index only conflicts for ACTIVE rows of the
    // coalesced type, so other job types are unaffected. The adapter's `queryFirst`
    // returns `null` (not just `undefined`) for no-row, so normalize with `?? undefined`.
    const insertFresh = (dueAt: number) =>
        db
            .queryFirst<{ id: string }>(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                 VALUES (?, ?, ?, 'pending', 0, 3, ?, ?, ?)
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                crypto.randomUUID(),
                spec.type,
                JSON.stringify(spec.payload),
                now,
                now,
                dueAt,
            )
            .then((row) => row ?? undefined);

    const selectActive = (status: 'pending' | 'processing') =>
        db
            .queryFirst<{ id: string; payload: string; next_retry_at: number | null }>(
                `SELECT id, payload, next_retry_at FROM queue_jobs WHERE type = ? AND status = ? ORDER BY created_at DESC, id ASC LIMIT 1`,
                spec.type,
                status,
            )
            .then((row) => row ?? undefined);

    const parsePayload = (raw: string): unknown => {
        try {
            return JSON.parse(raw) as unknown;
        } catch {
            return raw;
        }
    };

    // Bounded retry: each pass enqueues fresh, coalesces into the pending row, or
    // reports the in-flight processing row. The loop covers a worker claiming the
    // pending job between our read and our guarded update.
    for (let pass = 0; pass < 3; pass++) {
        const inserted = await insertFresh(freshDueAt);
        if (inserted !== undefined) return { status: 'enqueued', jobId: inserted.id, payload: spec.payload };

        const pending = await selectActive('pending');
        if (pending !== undefined) {
            const merged = spec.mergePayload ? spec.mergePayload(pending.payload, spec.payload) : spec.payload;
            // Immediate requests may only SHORTEN an earlier request's due time;
            // debounced requests slide the window out to `now + debounceMs`.
            const joinDueAt = immediate ? Math.min(pending.next_retry_at ?? now, now) : now + spec.debounceMs;
            const updated = await db
                .queryFirst<{ id: string }>(
                    `UPDATE queue_jobs SET payload = ?, next_retry_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' RETURNING id`,
                    JSON.stringify(merged),
                    joinDueAt,
                    now,
                    pending.id,
                )
                .then((row) => row ?? undefined);
            if (updated !== undefined) return { status: 'coalesced', jobId: pending.id, payload: merged };
            continue; // pending was claimed between read and update — retry
        }

        // No pending row: the insert conflict came from a PROCESSING row (the
        // active index) — report it instead of enqueuing a duplicate behind it.
        const processing = await selectActive('processing');
        if (processing !== undefined) {
            return { status: 'already-running', jobId: processing.id, payload: parsePayload(processing.payload) };
        }
        // Pre-index DB with the row claimed+finished between passes — retry insert.
    }

    // Deterministic exhaustion (unreachable behind the active index): prefer
    // reporting the in-flight job; otherwise the final insert must succeed or the
    // caller hears a loud error — a uniqueness conflict never escapes as a
    // producer failure and never silently drops the request.
    const processing = await selectActive('processing');
    if (processing !== undefined) {
        return { status: 'already-running', jobId: processing.id, payload: parsePayload(processing.payload) };
    }
    const fallback = await insertFresh(freshDueAt);
    if (fallback === undefined) {
        throw new Error(`enqueueCoalesced: ${spec.type} stayed active past 3 attempts without a resolvable outcome`);
    }
    return { status: 'enqueued', jobId: fallback.id, payload: spec.payload };
}

/** Specification for querying queue jobs with pagination and filtering. */
export interface QueueJobQuerySpec {
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    since?: string | number;
    limit?: number;
    offset?: number;
}

/** Normalized queue job representation for queries. */
export interface QueueJobRecord {
    id: string;
    type: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    attempts: number;
    maxRetries: number;
    queuedAt: string;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
    lastError: string | null;
    payload: Record<string, unknown> | null;
}

/** Result shape for queryQueueJobs. */
export interface QueueJobQueryResult {
    jobs: QueueJobRecord[];
    total: number;
    hasMore: boolean;
    countsByStatus: {
        all: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    };
}

/**
 * Query queue_jobs rows with status/since filtering and newest-first ordering.
 */
export async function queryQueueJobs(db: DbAdapter, spec: QueueJobQuerySpec = {}): Promise<QueueJobQueryResult> {
    const limit = Math.min(500, Math.max(1, spec.limit ?? 100));
    const offset = Math.max(0, spec.offset ?? 0);
    let sinceMs: number | undefined;
    if (spec.since !== undefined) {
        sinceMs = typeof spec.since === 'number' ? spec.since : Date.parse(spec.since);
        if (Number.isNaN(sinceMs)) sinceMs = undefined;
    }

    try {
        // 1. countsByStatus over since window (ignoring status filter)
        const countConditions: string[] = ['1=1'];
        const countParams: unknown[] = [];
        if (sinceMs !== undefined) {
            countConditions.push('created_at >= ?');
            countParams.push(sinceMs);
        }

        const countRows = await db.queryAll<{ status: string; cnt: number }>(
            `SELECT status, COUNT(*) AS cnt
             FROM queue_jobs
             WHERE ${countConditions.join(' AND ')}
             GROUP BY status`,
            ...countParams,
        );

        const countsByStatus = {
            all: 0,
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
        };

        for (const row of countRows) {
            const count = Number(row.cnt);
            countsByStatus.all += count;
            if (row.status === 'pending') countsByStatus.pending = count;
            else if (row.status === 'processing') countsByStatus.processing = count;
            else if (row.status === 'completed') countsByStatus.completed = count;
            else if (row.status === 'failed') countsByStatus.failed = count;
        }

        // 2. Query jobs with status and since filter, limit + 1 probe
        const queryConditions: string[] = ['1=1'];
        const queryParams: unknown[] = [];

        if (spec.status !== undefined) {
            queryConditions.push('status = ?');
            queryParams.push(spec.status);
        }
        if (sinceMs !== undefined) {
            queryConditions.push('created_at >= ?');
            queryParams.push(sinceMs);
        }

        queryParams.push(limit + 1);
        queryParams.push(offset);

        const rows = await db.queryAll<{
            id: string;
            type: string;
            payload: string | null;
            status: 'pending' | 'processing' | 'completed' | 'failed';
            attempts: number;
            max_retries: number;
            created_at: number;
            updated_at: number;
            next_retry_at: number | null;
            last_error: string | null;
            processing_at: number | null;
            expires_at: number | null;
        }>(
            `SELECT id, type, payload, status, attempts, max_retries,
                    created_at, updated_at, next_retry_at, last_error,
                    processing_at, expires_at
             FROM queue_jobs
             WHERE ${queryConditions.join(' AND ')}
             ORDER BY created_at DESC, id DESC
             LIMIT ? OFFSET ?`,
            ...queryParams,
        );

        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;

        const jobs: QueueJobRecord[] = pageRows.map((r) => {
            const queuedAt = new Date(r.created_at).toISOString();
            const startedAt = r.processing_at ? new Date(r.processing_at).toISOString() : null;
            const endedAt =
                r.status === 'completed' || r.status === 'failed' ? new Date(r.updated_at).toISOString() : null;
            const durationMs = startedAt && endedAt && r.processing_at != null ? r.updated_at - r.processing_at : null;

            let parsedPayload: Record<string, unknown> | null = null;
            if (r.payload) {
                try {
                    const parsed = JSON.parse(r.payload);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        parsedPayload = parsed as Record<string, unknown>;
                    }
                } catch {
                    parsedPayload = null;
                }
            }

            return {
                id: r.id,
                type: r.type,
                status: r.status,
                attempts: r.attempts,
                maxRetries: r.max_retries,
                queuedAt,
                startedAt,
                endedAt,
                durationMs,
                lastError: r.last_error ?? null,
                payload: parsedPayload,
            };
        });

        const total = spec.status !== undefined ? (countsByStatus[spec.status] ?? 0) : countsByStatus.all;

        return {
            jobs,
            total,
            hasMore,
            countsByStatus,
        };
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: queue_jobs')) {
            return {
                jobs: [],
                total: 0,
                hasMore: false,
                countsByStatus: { all: 0, pending: 0, processing: 0, completed: 0, failed: 0 },
            };
        }
        throw error;
    }
}

/** Result shape for queueJobKpis. */
export interface QueueJobKpisResult {
    activeJobs: number;
    completedJobs: number;
    failedJobs: number;
    successRatePct: number;
    recentJobErrors: Array<{
        id: string;
        name: string;
        occurredAt: string;
        message: string;
    }>;
}

/**
 * Aggregate queue job KPIs and recent failed jobs across a time window.
 */
export async function queueJobKpis(db: DbAdapter, sinceMs: number, untilMs: number): Promise<QueueJobKpisResult> {
    try {
        const countsRows = await db.queryAll<{ status: string; cnt: number }>(
            `SELECT status, COUNT(*) AS cnt
             FROM queue_jobs
             WHERE created_at >= ?1 AND created_at < ?2
             GROUP BY status`,
            sinceMs,
            untilMs,
        );

        let pending = 0;
        let processing = 0;
        let completed = 0;
        let failed = 0;
        for (const row of countsRows) {
            const count = Number(row.cnt);
            if (row.status === 'pending') pending = count;
            else if (row.status === 'processing') processing = count;
            else if (row.status === 'completed') completed = count;
            else if (row.status === 'failed') failed = count;
        }

        const activeJobs = pending + processing;
        const totalTerminal = completed + failed;
        const successRatePct = totalTerminal > 0 ? Math.round((completed / totalTerminal) * 100) : 0;

        const errorRows = await db.queryAll<{
            id: string;
            type: string;
            updated_at: number;
            last_error: string | null;
        }>(
            `SELECT id, type, updated_at, last_error
             FROM queue_jobs
             WHERE status = 'failed' AND created_at >= ?1 AND created_at < ?2
             ORDER BY updated_at DESC, id DESC
             LIMIT 10`,
            sinceMs,
            untilMs,
        );

        const recentJobErrors = errorRows.map((r) => ({
            id: r.id,
            name: r.type,
            occurredAt: new Date(r.updated_at).toISOString(),
            message: r.last_error ?? 'Job failed with no error message',
        }));

        return {
            activeJobs,
            completedJobs: completed,
            failedJobs: failed,
            successRatePct,
            recentJobErrors,
        };
    } catch (error) {
        if (error instanceof Error && error.message.includes('no such table: queue_jobs')) {
            return {
                activeJobs: 0,
                completedJobs: 0,
                failedJobs: 0,
                successRatePct: 0,
                recentJobErrors: [],
            };
        }
        throw error;
    }
}
