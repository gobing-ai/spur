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
    // Set a busy timeout so concurrent spur processes (or a stale WAL lock) retry
    // briefly instead of throwing SQLITE_BUSY immediately. The upstream
    // BunSqliteAdapter defaults omit busy_timeout, which makes parallel CLI
    // invocations against the same project DB fail non-deterministically.
    // (Run via exec because the typed pragmas option only accepts journalMode/
    // synchronous/foreignKeys — the runtime constructor only applies those three.)
    await adapter.exec('PRAGMA busy_timeout = 5000');
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
    // Set a busy timeout so concurrent spur processes (or a stale WAL lock) retry
    // briefly instead of throwing SQLITE_BUSY immediately. The upstream
    // BunSqliteAdapter defaults omit busy_timeout, which makes parallel CLI
    // invocations against the same project DB fail non-deterministically.
    // (Run via exec because the typed pragmas option only accepts journalMode/
    // synchronous/foreignKeys — the runtime constructor only applies those three.)
    await runtimeAdapter.exec('PRAGMA busy_timeout = 5000');
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
    /** Merge an incoming payload into a pending job's payload (coalescing). */
    mergePayload?: (existing: unknown, incoming: unknown) => unknown;
    /** Clock seam for deterministic tests (default `Date.now`). */
    now?: () => number;
}

/** Outcome of {@link enqueueCoalesced}. */
export type CoalescedEnqueueResult =
    | { status: 'enqueued'; jobId: string; payload: unknown }
    | { status: 'coalesced'; jobId: string; payload: unknown };

/**
 * Enqueue with debounce-style coalescing (task 0549 R2): if a **pending** job of the
 * same type exists, join it — the merged payload replaces the row's payload and
 * `next_retry_at` is pushed to `now + debounceMs` — so a burst of operations yields
 * exactly one job whose covered window spans all of them. Otherwise enqueue a fresh
 * job delayed by `debounceMs`. Jobs already claimed (`processing`) or finished are
 * invisible to the join: a completion after the job started running enqueues a new one.
 *
 * Atomicity (P2 review fix): the fresh-enqueue is an `INSERT … ON CONFLICT DO NOTHING`
 * against the `queue_jobs_history_refresh_pending_unique` partial unique index
 * (`migrations.ts`), which enforces at most one pending row per coalesced type at the
 * DB level — two completions from different processes (parallel agents in runall,
 * sharing `.spur/spur.db`) serialize on the index instead of both enqueuing. The
 * returned `payload` is the POST-merge payload (P3 review fix) so an enqueue-time
 * observable carries the merged burst window, not just the incoming completion.
 *
 * The ts-db `QueueJobDao` + the `queue_jobs` drizzle schema are imported lazily for the
 * same Workers-bundle reason as {@link createJobQueue}.
 */
export async function enqueueCoalesced(db: DbAdapter, spec: CoalescedEnqueueSpec): Promise<CoalescedEnqueueResult> {
    const now = spec.now?.() ?? Date.now();
    const nextRetryAt = now + spec.debounceMs;

    // Atomic fresh-enqueue (no merge semantics in SQL — the merge payload is computed
    // in JS below). `ON CONFLICT DO NOTHING` without a target resolves against every
    // unique index; the scoped partial index only conflicts for pending rows of the
    // coalesced type, so other job types are unaffected. The adapter's `queryFirst`
    // returns `null` (not just `undefined`) for no-row, so normalize with `?? undefined`.
    const insertFresh = () =>
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
                nextRetryAt,
            )
            .then((row) => row ?? undefined);

    // Bounded retry: each pass enqueues fresh, or coalesces into the pending row. The
    // loop covers a worker claiming the pending job between our read and our guarded
    // update — in that case a fresh insert (which now must win) retries.
    for (let pass = 0; pass < 3; pass++) {
        const inserted = await insertFresh();
        if (inserted !== undefined) return { status: 'enqueued', jobId: inserted.id, payload: spec.payload };

        const pending = await db
            .queryFirst<{ id: string; payload: string }>(
                `SELECT id, payload FROM queue_jobs WHERE type = ? AND status = 'pending' ORDER BY created_at DESC, id ASC LIMIT 1`,
                spec.type,
            )
            .then((row) => row ?? undefined);
        if (pending === undefined) continue; // claimed between insert and read — retry

        const merged = spec.mergePayload ? spec.mergePayload(pending.payload, spec.payload) : spec.payload;
        const updated = await db
            .queryFirst<{ id: string }>(
                `UPDATE queue_jobs SET payload = ?, next_retry_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' RETURNING id`,
                JSON.stringify(merged),
                nextRetryAt,
                now,
                pending.id,
            )
            .then((row) => row ?? undefined);
        if (updated !== undefined) return { status: 'coalesced', jobId: pending.id, payload: merged };
        // pending was claimed between read and update — retry with a fresh insert
    }

    // Unreachable in practice: a pending row would have to be claimed mid-merge on
    // every pass. Guard loudly rather than loop forever (deterministic over hidden
    // automation) — the queue may already hold a duplicate in a pre-index DB.
    const fallback = await insertFresh();
    if (fallback === undefined) {
        throw new Error(`enqueueCoalesced: could not enqueue ${spec.type} after 3 attempts`);
    }
    return { status: 'enqueued', jobId: fallback.id, payload: spec.payload };
}
