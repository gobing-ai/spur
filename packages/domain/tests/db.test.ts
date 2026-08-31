import { Database } from 'bun:sqlite';
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
import { applyCliMigrations } from '../src/migrations';

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

describe('migration 0016: history_message ts nullable', () => {
    test('fresh DBs get a nullable ts column without a rebuild', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const ts = (
                await db.queryAll<{ name: string; notnull: number }>('PRAGMA table_info(history_message)')
            ).find((c) => c.name === 'ts');
            expect(ts?.notnull).toBe(0);
            expect(
                await db.queryFirst<{ name: string }>(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='history_message_rebuild'",
                ),
            ).toBeNull();
        } finally {
            db.close();
        }
    });

    test('legacy NOT NULL ts is rebuilt: epoch-0 sentinel becomes NULL, index restored', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            // Rewind to the pre-0016 shape: sentinel rows under a NOT NULL ts.
            await db.exec('DROP TABLE history_message');
            await db.exec(`CREATE TABLE history_message (
                record_hash TEXT PRIMARY KEY, source TEXT NOT NULL, source_file TEXT NOT NULL,
                source_line INTEGER NOT NULL, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
                turn_index INTEGER, role TEXT NOT NULL, record_type TEXT NOT NULL,
                disposition TEXT NOT NULL, ts TEXT NOT NULL, duration_ms INTEGER, model TEXT,
                input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
                cache_write_tokens INTEGER, cost_usd REAL, content_text TEXT, cwd TEXT,
                provenance TEXT NOT NULL, run_id TEXT, task_wbs TEXT, imported_at TEXT NOT NULL)`);
            await db.exec(`INSERT INTO history_message (record_hash, source, source_file, source_line,
                session_id, seq, role, record_type, disposition, ts, provenance, imported_at) VALUES
                ('h1','codex','f',1,'s',1,'user','message','keep','1970-01-01T00:00:00.000Z','p','2026'),
                ('h2','codex','f',2,'s',2,'assistant','message','keep','2026-08-01T00:00:00.000Z','p','2026')`);
            await db.run('DELETE FROM "__spur_cli_migrations" WHERE id LIKE "0016%"');
            await applyCliMigrations(db);

            const ts = (
                await db.queryAll<{ name: string; notnull: number }>('PRAGMA table_info(history_message)')
            ).find((c) => c.name === 'ts');
            expect(ts?.notnull).toBe(0);
            const rows = await db.queryAll<{ record_hash: string; ts: string | null }>(
                'SELECT record_hash, ts FROM history_message ORDER BY seq',
            );
            expect(rows).toEqual([
                { record_hash: 'h1', ts: null },
                { record_hash: 'h2', ts: '2026-08-01T00:00:00.000Z' },
            ]);
            expect(
                await db.queryFirst<{ name: string }>(
                    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_history_message_provenance_run'",
                ),
            ).toBeDefined();
        } finally {
            db.close();
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
        // (queue_jobs_history_refresh_active_unique) makes the lookup-then-insert
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

    test('a claimed (processing) job is single-flight: the next producer gets already-running (0716 R4)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const first = await enqueueCoalesced(db, {
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
            expect(after.status).toBe('already-running');
            expect(after.jobId).toBe(first.jobId);
            // The in-flight job's payload is surfaced (parsed), and NO second row exists.
            expect(after.payload).toEqual({ start: t0, end: t0 });
            expect((await rows(db)).length).toBe(1);
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

    test('a pending job claimed between read and update resolves to already-running (0716 R4)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const first = await enqueueCoalesced(db, {
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
                    sql.includes('SELECT id, payload') &&
                    row !== undefined &&
                    row !== null &&
                    typeof row === 'object' &&
                    'id' in row
                ) {
                    // The adapter generic erases the row shape; the coalescing SELECT
                    // projects `id` directly, so the narrowed read is safe here.
                    const claimed = row as { id: string };
                    await db.run("UPDATE queue_jobs SET status = 'processing' WHERE id = ?", claimed.id);
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
            // Pass 0: INSERT conflicts, SELECT finds the pending row, the interceptor
            // claims it, the guarded UPDATE misses. Pass 1: INSERT conflicts with the
            // now-PROCESSING row (active index) and no pending row remains — the
            // in-flight job is reported instead of duplicated behind it.
            expect(after.status).toBe('already-running');
            expect(after.jobId).toBe(first.jobId);
            expect(after.payload).toEqual({ start: t0, end: t0 });
            expect((await rows(db)).length).toBe(1);
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
        ).rejects.toThrow(
            'enqueueCoalesced: history.refresh stayed active past 3 attempts without a resolvable outcome',
        );
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

    test('a PROCESSING row on another connection yields already-running — no duplicate (cross-process R4)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-singleflight-'));
        const file = join(dir, 'spur.db');
        try {
            const dbA = await createMigratedDb({ url: file });
            const dbB = await createMigratedDb({ url: file });
            try {
                const t0 = 1_000_000;
                const first = await enqueueCoalesced(dbA, {
                    type: 'history.refresh',
                    payload: { start: t0, end: t0 },
                    debounceMs: 60_000,
                    now: () => t0,
                });
                // A worker on connection A claims the job.
                await dbA.run("UPDATE queue_jobs SET status = 'processing' WHERE id = ?", first.jobId);

                // Producers on connection B must NOT enqueue behind the running job.
                const [rB1, rB2] = await Promise.all([
                    enqueueCoalesced(dbB, {
                        type: 'history.refresh',
                        payload: { start: t0 + 5_000, end: t0 + 5_000 },
                        debounceMs: 60_000,
                        now: () => t0 + 5_000,
                    }),
                    enqueueCoalesced(dbB, {
                        type: 'history.refresh',
                        payload: { start: t0 + 7_000, end: t0 + 7_000 },
                        debounceMs: 60_000,
                        now: () => t0 + 7_000,
                    }),
                ]);
                expect(rB1.status).toBe('already-running');
                expect(rB2.status).toBe('already-running');
                expect(rB1.jobId).toBe(first.jobId);
                expect(rB2.jobId).toBe(first.jobId);
                const all = await rows(dbA);
                expect(all.length).toBe(1); // still exactly the one active row
                expect(all[0]?.status).toBe('processing');
            } finally {
                dbA.close();
                dbB.close();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('immediate join SHORTENS the pending due time; a later immediate join never extends it (0716 R2)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            // Debounced completion first: due t0 + 60s.
            const first = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0, end: t0 },
                debounceMs: 60_000,
                now: () => t0,
            });
            expect(first.status).toBe('enqueued');

            // Immediate join 30s later pulls the due time in to now.
            const join = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0 + 30_000, end: t0 + 30_000 },
                debounceMs: 60_000,
                immediate: true,
                mergePayload: mergeWindow,
                now: () => t0 + 30_000,
            });
            expect(join.status).toBe('coalesced');
            expect((await rows(db))[0]?.next_retry_at).toBe(t0 + 30_000);

            // A later immediate join does NOT push the due time back out.
            await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { start: t0 + 50_000, end: t0 + 50_000 },
                debounceMs: 60_000,
                immediate: true,
                mergePayload: mergeWindow,
                now: () => t0 + 50_000,
            });
            expect((await rows(db))[0]?.next_retry_at).toBe(t0 + 30_000);
        } finally {
            db.close();
        }
    });

    test('immediate request with no active job enqueues a fresh job due now', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const t0 = 1_000_000;
            const result = await enqueueCoalesced(db, {
                type: 'history.refresh',
                payload: { trigger: 'manual' },
                debounceMs: 60_000,
                immediate: true,
                now: () => t0,
            });
            expect(result.status).toBe('enqueued');
            expect((await rows(db))[0]?.next_retry_at).toBe(t0);
        } finally {
            db.close();
        }
    });
});

describe('migration 0027: history refresh active single-flight (task 0716)', () => {
    test('retires duplicate ACTIVE rows keeping the oldest, swaps the pending index for the active one', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            // Rewind to the pre-0027 shape: pending-only index + two ACTIVE rows.
            await db.exec('DROP INDEX queue_jobs_history_refresh_active_unique');
            await db.exec(
                "CREATE UNIQUE INDEX queue_jobs_history_refresh_pending_unique ON queue_jobs (type) WHERE type = 'history.refresh' AND status = 'pending'",
            );
            await db.run("DELETE FROM queue_jobs WHERE type = 'history.refresh'");
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                 VALUES ('job-old', 'history.refresh', '{"start":1,"end":1}', 'pending', 0, 3, 1000, 1000, 61000)`,
            );
            await db.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                 VALUES ('job-new', 'history.refresh', '{"start":2,"end":2}', 'processing', 0, 3, 2000, 2000, NULL)`,
            );
            await db.run('DELETE FROM "__spur_cli_migrations" WHERE id LIKE "0027%"');

            await applyCliMigrations(db);

            const retired = await db.queryAll<{ id: string; status: string; last_error: string | null }>(
                "SELECT id, status, last_error FROM queue_jobs WHERE type = 'history.refresh' ORDER BY created_at ASC",
            );
            expect(retired).toEqual([
                { id: 'job-old', status: 'pending', last_error: null },
                {
                    id: 'job-new',
                    status: 'failed',
                    last_error:
                        'retired by migration 0027_spur_cli_history_refresh_active_unique: superseded duplicate active history refresh',
                },
            ]);
            // Index swap landed: only the active index remains.
            const indexes = await db.queryAll<{ name: string }>(
                "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'queue_jobs_history_refresh%'",
            );
            expect(indexes.map((i) => i.name)).toEqual(['queue_jobs_history_refresh_active_unique']);
            // The active index actually enforces single-flight.
            expect(
                db.run(
                    `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                     VALUES ('job-dup', 'history.refresh', '{}', 'pending', 0, 3, 3000, 3000, NULL)`,
                ),
            ).rejects.toThrow();
        } finally {
            db.close();
        }
    });

    test('journals without executing when queue_jobs is absent (foundation-only DBs)', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            await db.exec('DROP TABLE queue_jobs');
            await db.run('DELETE FROM "__spur_cli_migrations" WHERE id LIKE "0027%"');

            const applied = await applyCliMigrations(db);

            expect(applied).toBe(1); // 0027 journaled and skipped, missing table untouched
            const journaled = await db.queryFirst<{ id: string }>(
                'SELECT id FROM "__spur_cli_migrations" WHERE id LIKE "0027%"',
            );
            expect(journaled?.id).toBe('0027_spur_cli_history_refresh_active_unique');
        } finally {
            db.close();
        }
    });

    test('an already-migrated DB is a pure read — no write lock taken', async () => {
        // Every CLI invocation calls applyCliMigrations, including read-only ones.
        // The CREATE TABLE it used to run unconditionally is DDL, so a read-only
        // `rule run` took a write lock and could lose to a long-lived `spur serve`
        // with SQLITE_BUSY. On an up-to-date DB there must be no write at all.
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const writes: string[] = [];
            const exec = db.exec.bind(db);
            const run = db.run.bind(db);
            db.exec = ((sql: string, ...rest: unknown[]) => {
                writes.push(sql);
                return exec(sql, ...(rest as []));
            }) as typeof db.exec;
            db.run = ((sql: string, ...rest: unknown[]) => {
                writes.push(sql);
                return run(sql, ...(rest as []));
            }) as typeof db.run;

            const applied = await applyCliMigrations(db);

            expect(applied).toBe(0);
            expect(writes).toEqual([]);
        } finally {
            db.close();
        }
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

describe('SQLite contention: WAL + busy_timeout bounded (task 0717 R5)', () => {
    test('cross-connection writer conflict fails bounded (~5s) with a visible SQLITE_BUSY, then recovers', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-0717-r5-'));
        const url = join(dir, 'spur.db');
        const a = await createMigratedDb({ url });
        try {
            // WAL is a file-level property of the shared DB (adapter default pragma); the
            // adapter maps pragma result rows to {}, so read it through raw bun:sqlite.
            // The 5s busy timeout is proven behaviorally by the bounded wait below.
            const raw = new Database(url);
            try {
                expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
            } finally {
                raw.close();
            }

            // The isolated child owns the write lock (its own connection/process)…
            await a.exec('BEGIN IMMEDIATE');
            await a.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                 VALUES ('holder', 'x', '{}', 'pending', 0, 0, 1, 1, NULL)`,
            );

            const b = await createMigratedDb({ url });
            try {
                const t0 = performance.now();
                let busy = '';
                try {
                    await b.exec('BEGIN IMMEDIATE');
                } catch (e) {
                    busy = String((e as Error).message ?? e);
                }
                const elapsedMs = performance.now() - t0;
                // Visible: the conflict surfaces as SQLITE_BUSY — no silent hang or skip.
                expect(busy.toLowerCase()).toContain('locked');
                // Bounded: ~the 5s busy timeout — retried, not instant-fail, not unbounded.
                expect(elapsedMs).toBeGreaterThanOrEqual(4500);
                expect(elapsedMs).toBeLessThan(15000);
                // bun:sqlite busy-waits synchronously on the calling thread, so loop
                // responsiveness under contention is a cross-process property (the child
                // process absorbs the wait) — covered by the R1 held-open-child test in
                // packages/app/tests/services/history-refresh-service.test.ts.
            } finally {
                b.close();
            }

            await a.exec('COMMIT');
            // After the holder commits, a fresh writer proceeds without error.
            const c = await createMigratedDb({ url });
            try {
                await c.run(
                    `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
                     VALUES ('after', 'x', '{}', 'pending', 0, 0, 2, 2, NULL)`,
                );
                const rows = await a.queryAll<{ id: string }>("SELECT id FROM queue_jobs WHERE type = 'x' ORDER BY id");
                expect(rows.map((r) => r.id)).toEqual(['after', 'holder']);
            } finally {
                c.close();
            }
        } finally {
            a.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 20_000); // default 5s test timeout < the 5s busy wait under contention
});
