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

export type { JobQueue, QueueConsumer, QueueConsumerConfig } from '@gobing-ai/ts-infra';
