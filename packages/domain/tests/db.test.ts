import { describe, expect, test } from 'bun:test';
import type { DbAdapter } from '@gobing-ai/ts-db';
import {
    createJobQueue,
    createMigratedDb,
    createMigratedDbViaRuntime,
    createQueueConsumer,
    dbHealthCheck,
} from '../src/db';

/**
 * Minimal mock that throws on queryFirst to exercise the dbHealthCheck catch path.
 */
function mockDb(shouldThrow: boolean): DbAdapter {
    return {
        queryFirst: async <T>(): Promise<T | undefined> => {
            if (shouldThrow) {
                throw new Error('Connection refused');
            }
            return { one: 1 } as unknown as T;
        },
        queryAll: async () => [],
        exec: async () => {},
        run: async () => {},
        close: () => {},
    } as unknown as DbAdapter;
}

describe('dbHealthCheck', () => {
    test('returns true when the DB responds to a trivial query', async () => {
        const db = mockDb(false);
        const result = await dbHealthCheck(db);
        expect(result).toBe(true);
    });

    test('returns false when the DB throws', async () => {
        const db = mockDb(true);
        const result = await dbHealthCheck(db);
        expect(result).toBe(false);
    });
});

describe('createMigratedDbViaRuntime', () => {
    // Exercises the R3 deliverable end-to-end on the node-bun runtime factory:
    // loadRuntimeFactory() -> factory.createDbAdapter() -> applyCliMigrations().
    // Uses :memory: so a real Bun SQLite adapter is created + migrated, proving
    // the platform-selected path works (not just the structural type assignment).
    test('creates a platform-selected, migrated adapter on the Bun runtime', async () => {
        const db = await createMigratedDbViaRuntime({ url: ':memory:' });
        try {
            // The adapter is connected and responds to a trivial query.
            expect(await dbHealthCheck(db)).toBe(true);
            // Migrations applied: a CLI-owned table exists and is queryable.
            // (queryAll on a known migrated table returns rows, not a "no such table" throw.)
            const rows = await db.queryAll<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='table' LIMIT 1",
            );
            expect(Array.isArray(rows)).toBe(true);
            expect(rows.length).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    test('parity: createMigratedDb (Bun-direct) and via-runtime both migrate the same schema', async () => {
        const direct = await createMigratedDb({ url: ':memory:' });
        const viaRuntime = await createMigratedDbViaRuntime({ url: ':memory:' });
        try {
            const tablesOf = async (db: DbAdapter): Promise<Set<string>> => {
                const rows = await db.queryAll<{ name: string }>(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
                );
                return new Set(rows.map((r) => r.name));
            };
            const a = await tablesOf(direct);
            const b = await tablesOf(viaRuntime);
            // Both paths apply the identical CLI schema → identical table set.
            expect([...b]).toEqual([...a]);
        } finally {
            direct.close();
            viaRuntime.close();
        }
    });
});

describe('createJobQueue / createQueueConsumer', () => {
    test('createJobQueue builds a DBJobQueue producer over the migrated queue_jobs table', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const queue = await createJobQueue<{ x: number }>(db);
            const id = await queue.enqueue('demo', { x: 1 });
            expect(typeof id).toBe('string');
            const stats = await queue.stats();
            expect(stats.pending).toBe(1);
        } finally {
            db.close();
        }
    });

    test('createQueueConsumer processes an enqueued job (enqueue → consume roundtrip)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const queue = await createJobQueue<{ x: number }>(db);
            const consumer = await createQueueConsumer<{ x: number }>(db);
            const seen: number[] = [];
            consumer.register('demo', async (job) => {
                seen.push(job.payload.x);
            });

            await queue.enqueue('demo', { x: 7 });
            const processed = await consumer.processOnce();

            expect(processed).toBe(1);
            expect(seen).toEqual([7]);
            const stats = await queue.stats();
            expect(stats.completed).toBe(1);
        } finally {
            db.close();
        }
    });
});
