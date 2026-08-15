import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/ts-db';
import {
    createJobQueue,
    createMigratedDb,
    createMigratedDbViaRuntime,
    createQueueConsumer,
    dbHealthCheck,
    enqueueCoalesced,
    findPendingQueueJob,
    updatePendingQueueJob,
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
        batch: async () => {},
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

describe('enqueueCoalesced (task 0549 R2)', () => {
    interface Window {
        start: number;
        end: number;
    }
    const mergeWindow = (existing: unknown, incoming: unknown): Window => {
        const a = (typeof existing === 'string' ? JSON.parse(existing) : existing) as Window;
        const b = (typeof incoming === 'string' ? JSON.parse(incoming) : incoming) as Window;
        return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
    };

    async function rows(
        db: DbAdapter,
    ): Promise<Array<{ id: string; payload: string; status: string; next_retry_at: number | null }>> {
        return db.queryAll('SELECT id, payload, status, next_retry_at FROM queue_jobs ORDER BY created_at ASC, id ASC');
    }

    test('fresh enqueue: one pending job delayed by debounceMs', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const result = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0, end: t0 },
                debounceMs: 60_000,
                now: () => t0,
            });
            expect(result.status).toBe('enqueued');
            const all = await rows(db);
            expect(all.length).toBe(1);
            expect(all[0]?.status).toBe('pending');
            expect(all[0]?.next_retry_at).toBe(t0 + 60_000);
        } finally {
            db.close();
        }
    });

    test('burst joins the pending job: same row, merged window, next_retry_at slides', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const t1 = t0 + 30_000;
            const first = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0, end: t0 },
                debounceMs: 60_000,
                mergePayload: mergeWindow,
                now: () => t0,
            });
            const second = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t1, end: t1 },
                debounceMs: 60_000,
                mergePayload: mergeWindow,
                now: () => t1,
            });
            expect(first.status).toBe('enqueued');
            expect(second.status).toBe('coalesced');
            expect(second.jobId).toBe(first.jobId);

            // P3: the returned payload is the POST-merge window, not just the incoming one.
            expect(second.payload).toEqual({ start: t0, end: t1 });

            const all = await rows(db);
            expect(all.length).toBe(1); // exactly one job after a burst of two
            const merged = JSON.parse(all[0]?.payload ?? '{}') as Window;
            expect(merged).toEqual({ start: t0, end: t1 }); // covered window spans both
            expect(all[0]?.next_retry_at).toBe(t1 + 60_000); // debounce from the LAST join
        } finally {
            db.close();
        }
    });

    test('concurrent enqueues from two connections coalesce to ONE pending job (cross-process R2)', async () => {
        // Two adapters on the same file DB simulate two processes (parallel agents in
        // runall, sharing .spur/spur.db). The partial unique index
        // (queue_jobs_history_refresh_pending_unique) makes the lookup-then-insert
        // atomic: one INSERT wins, the other conflicts and joins — exactly one job for
        // the burst, never two (P2 review fix).
        const dir = mkdtempSync(join(tmpdir(), 'spur-coalesce-'));
        const file = join(dir, 'spur.db');
        try {
            const dbA = await createMigratedDb({ url: file });
            const dbB = await createMigratedDb({ url: file });
            try {
                const t0 = 1_000_000;
                const [rA, rB] = await Promise.all([
                    enqueueCoalesced(dbA, {
                        type: 'history.refresh',
                        payload: { start: t0, end: t0 },
                        debounceMs: 60_000,
                        mergePayload: mergeWindow,
                        now: () => t0,
                    }),
                    enqueueCoalesced(dbB, {
                        type: 'history.refresh',
                        payload: { start: t0 + 30_000, end: t0 + 30_000 },
                        debounceMs: 60_000,
                        mergePayload: mergeWindow,
                        now: () => t0 + 30_000,
                    }),
                ]);
                // Exactly one enqueued + one coalesced join onto the SAME job id.
                expect([rA.status, rB.status].sort()).toEqual(['coalesced', 'enqueued']);
                expect(rA.jobId).toBe(rB.jobId);
                const all = await rows(dbA);
                expect(all.length).toBe(1); // single pending job for the burst
                const merged = JSON.parse(all[0]?.payload ?? '{}') as Window;
                expect(merged).toEqual({ start: t0, end: t0 + 30_000 }); // spans both completions
            } finally {
                dbA.close();
                dbB.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a claimed (processing) job is invisible to the join — next completion enqueues fresh', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0, end: t0 },
                debounceMs: 60_000,
                now: () => t0,
            });
            // Simulate the worker claiming the pending job.
            await db.run("UPDATE queue_jobs SET status = 'processing' WHERE type = 'history.refresh'");

            const after = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0 + 5, end: t0 + 5 },
                debounceMs: 60_000,
                now: () => t0 + 5,
            });
            expect(after.status).toBe('enqueued');
            expect((await rows(db)).length).toBe(2);
        } finally {
            db.close();
        }
    });

    test('join without mergePayload replaces the pending payload with the incoming one', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0, end: t0 },
                debounceMs: 60_000,
                now: () => t0,
            });
            const second = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0 + 1, end: t0 + 1 },
                debounceMs: 60_000,
                now: () => t0 + 1,
            });
            expect(second.status).toBe('coalesced');
            expect(second.payload).toEqual({ start: t0 + 1, end: t0 + 1 });
            const all = await rows(db);
            expect(all.length).toBe(1);
            expect(JSON.parse(all[0]?.payload ?? '{}')).toEqual({ start: t0 + 1, end: t0 + 1 });
        } finally {
            db.close();
        }
    });

    test('retries when the pending job is claimed between read and update', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0, end: t0 },
                debounceMs: 60_000,
                now: () => t0,
            });

            const original = db.queryFirst.bind(db);
            db.queryFirst = (async <T>(sql: string, ...params: unknown[]) => {
                const row = await original<T>(sql, ...params);
                if (
                    typeof sql === 'string' &&
                    sql.includes('SELECT id, payload FROM queue_jobs') &&
                    row !== undefined &&
                    row !== null &&
                    typeof row === 'object' &&
                    'id' in row
                ) {
                    await db.run(
                        "UPDATE queue_jobs SET status = 'processing' WHERE id = ?",
                        (row as { id: string }).id,
                    );
                }
                return row;
            }) as typeof db.queryFirst;

            const after = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0 + 1, end: t0 + 1 },
                debounceMs: 60_000,
                mergePayload: mergeWindow,
                now: () => t0 + 1,
            });
            // Pass 0: INSERT conflicts, SELECT finds the pending row, we claim it,
            // UPDATE misses, loop continues. Pass 1: INSERT wins (processing is
            // invisible to the unique pending index).
            expect(after.status).toBe('enqueued');
            expect((await rows(db)).length).toBe(2);
        } finally {
            db.close();
        }
    });

    test('throws after three failed enqueue attempts when no insert can land', async () => {
        const db = mockDb(false);
        db.queryFirst = async () => undefined;
        await expect(
            enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { x: 1 },
                debounceMs: 1000,
                now: () => 1,
            }),
        ).rejects.toThrow('enqueueCoalesced: could not enqueue history.refresh after 3 attempts');
    });

    test('fallback insert after three claimed-mid-merge passes still enqueues', async () => {
        const db = mockDb(false);
        let inserts = 0;
        db.queryFirst = async <T>(sql?: string) => {
            const text = String(sql ?? '');
            if (text.includes('INSERT INTO queue_jobs')) {
                inserts += 1;
                // Three loop-body inserts miss; the post-loop fallback lands.
                if (inserts <= 3) return undefined as T;
                return { id: 'fallback-id' } as T;
            }
            return undefined as T;
        };
        const result = await enqueueCoalesced(db, {
            type: 'history.refresh',
            payload: { x: 1 },
            debounceMs: 1000,
            now: () => 1,
        });
        expect(result).toEqual({ status: 'enqueued', jobId: 'fallback-id', payload: { x: 1 } });
        expect(inserts).toBe(4);
    });
});

describe('findPendingQueueJob / updatePendingQueueJob', () => {
    test('findPendingQueueJob returns undefined when no pending row exists', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            expect(await findPendingQueueJob(db, 'history.refresh')).toBeUndefined();
        } finally {
            db.close();
        }
    });

    test('findPendingQueueJob returns the oldest pending job of that type', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const first = await enqueueCoalesced(db, {
                type: 'demo',
                payload: { n: 1 },
                debounceMs: 1000,
                now: () => 10,
            });
            await enqueueCoalesced(db, {
                type: 'demo',
                payload: { n: 2 },
                debounceMs: 1000,
                now: () => 20,
            });
            const found = await findPendingQueueJob<{ n: number }>(db, 'demo');
            expect(found).toEqual({ id: first.jobId, payload: { n: 1 } });
        } finally {
            db.close();
        }
    });

    test('findPendingQueueJob ignores processing jobs and other types', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { n: 1 },
                debounceMs: 1000,
                now: () => 1,
            });
            await db.run("UPDATE queue_jobs SET status = 'processing' WHERE type = 'history.refresh'");
            await enqueueCoalesced(db, {
                type: 'other',
                payload: { n: 2 },
                debounceMs: 1000,
                now: () => 2,
            });
            expect(await findPendingQueueJob(db, 'history.refresh')).toBeUndefined();
            const other = await findPendingQueueJob<{ n: number }>(db, 'other');
            expect(other?.payload).toEqual({ n: 2 });
        } finally {
            db.close();
        }
    });

    test('findPendingQueueJob returns undefined when the pending payload is not JSON', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
                 VALUES (?, ?, ?, 'pending', 0, 3, ?, ?)`,
                'bad-json',
                'history.refresh',
                'not-json',
                1,
                1,
            );
            expect(await findPendingQueueJob(db, 'history.refresh')).toBeUndefined();
        } finally {
            db.close();
        }
    });

    test('updatePendingQueueJob replaces payload and nextRetryAt on a live row', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const first = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { n: 1 },
                debounceMs: 1000,
                now: () => 10,
            });
            const id = await updatePendingQueueJob(db, first.jobId, { n: 9 }, 99);
            expect(id).toBe(first.jobId);
            const found = await findPendingQueueJob<{ n: number }>(db, 'history.refresh');
            expect(found).toEqual({ id: first.jobId, payload: { n: 9 } });
            const row = await db.queryFirst<{ next_retry_at: number }>(
                'SELECT next_retry_at FROM queue_jobs WHERE id = ?',
                first.jobId,
            );
            expect(row?.next_retry_at).toBe(99);
        } finally {
            db.close();
        }
    });

    test('updatePendingQueueJob returns undefined when the job is gone', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            expect(await updatePendingQueueJob(db, 'missing-id', { n: 1 }, 1)).toBeUndefined();
        } finally {
            db.close();
        }
    });
});
