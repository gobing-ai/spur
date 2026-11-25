import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, queryQueueJobs, queueJobKpis } from '../../src';

describe('queryQueueJobs and queueJobKpis', () => {
    test('queryQueueJobs handles ordering, filtering, pagination, and timing mapping', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);

        const now = Date.now();
        // 1. Pending job
        await adapter.run(
            `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, next_retry_at)
             VALUES (?, ?, ?, 'pending', 0, 3, ?, ?, ?)`,
            'job-pending',
            'smoke.tick',
            JSON.stringify({ check: 'ok' }),
            now - 10_000,
            now - 10_000,
            now,
        );

        // 2. Processing job
        await adapter.run(
            `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, processing_at)
             VALUES (?, ?, ?, 'processing', 1, 3, ?, ?, ?)`,
            'job-processing',
            'system.events.prune',
            JSON.stringify({ quota: 100 }),
            now - 8_000,
            now - 4_000,
            now - 4_000,
        );

        // 3. Completed job
        await adapter.run(
            `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, processing_at)
             VALUES (?, ?, ?, 'completed', 1, 3, ?, ?, ?)`,
            'job-completed',
            'smoke.tick',
            JSON.stringify({ result: 'pass' }),
            now - 6_000,
            now - 2_000,
            now - 5_000,
        );

        // 4. Failed job with malformed payload
        await adapter.run(
            `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, processing_at, last_error)
             VALUES (?, ?, ?, 'failed', 3, 3, ?, ?, ?, ?)`,
            'job-failed',
            'scheduler.custom',
            'not-valid-json',
            now - 4_000,
            now - 1_000,
            now - 3_000,
            'Execution error: exit code 1',
        );

        // All jobs, limit 2
        const page1 = await queryQueueJobs(adapter, { limit: 2 });
        expect(page1.total).toBe(4);
        expect(page1.hasMore).toBe(true);
        expect(page1.jobs).toHaveLength(2);
        // Newest first by created_at: job-failed (now-4000), job-completed (now-6000)
        expect(page1.jobs[0]?.id).toBe('job-failed');
        expect(page1.jobs[1]?.id).toBe('job-completed');

        // Check malformed payload degraded to null
        expect(page1.jobs[0]?.payload).toBeNull();
        expect(page1.jobs[0]?.lastError).toBe('Execution error: exit code 1');
        expect(page1.jobs[0]?.durationMs).toBe(2000); // (now - 1000) - (now - 3000) = 2000

        // Check completed job timing
        expect(page1.jobs[1]?.startedAt).not.toBeNull();
        expect(page1.jobs[1]?.endedAt).not.toBeNull();
        expect(page1.jobs[1]?.durationMs).toBe(3000); // (now - 2000) - (now - 5000) = 3000

        // Page 2: offset 2, limit 2
        const page2 = await queryQueueJobs(adapter, { limit: 2, offset: 2 });
        expect(page2.hasMore).toBe(false);
        expect(page2.jobs).toHaveLength(2);
        expect(page2.jobs[0]?.id).toBe('job-processing');
        expect(page2.jobs[1]?.id).toBe('job-pending');

        // Check processing job timing: startedAt set, endedAt and durationMs null
        expect(page2.jobs[0]?.startedAt).not.toBeNull();
        expect(page2.jobs[0]?.endedAt).toBeNull();
        expect(page2.jobs[0]?.durationMs).toBeNull();

        // Check pending job timing: both null
        expect(page2.jobs[1]?.startedAt).toBeNull();
        expect(page2.jobs[1]?.endedAt).toBeNull();
        expect(page2.jobs[1]?.durationMs).toBeNull();

        // Filter by status: 'failed'
        const failedQuery = await queryQueueJobs(adapter, { status: 'failed' });
        expect(failedQuery.jobs).toHaveLength(1);
        expect(failedQuery.jobs[0]?.id).toBe('job-failed');
        expect(failedQuery.total).toBe(1);
        // countsByStatus keeps ALL buckets even when status filter is applied!
        expect(failedQuery.countsByStatus).toEqual({
            all: 4,
            pending: 1,
            processing: 1,
            completed: 1,
            failed: 1,
        });

        // Filter by since
        const sinceQuery = await queryQueueJobs(adapter, { since: new Date(now - 5_000).toISOString() });
        expect(sinceQuery.jobs).toHaveLength(1); // only job-failed was created at now - 4000
        expect(sinceQuery.total).toBe(1);

        adapter.close();
    });

    test('queryQueueJobs excludes built-in types and scheduler.custom names safely across jobs and countsByStatus', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);

        const now = Date.now();
        const rows = [
            {
                id: 'prune-1',
                type: 'system-events-prune',
                payload: JSON.stringify({ source: 'scheduler' }),
                status: 'completed',
                createdAt: now - 8_000,
            },
            {
                id: 'smoke-1',
                type: 'smoke',
                payload: JSON.stringify({ source: 'scheduler' }),
                status: 'failed',
                createdAt: now - 7_000,
            },
            {
                id: 'custom-history-1',
                type: 'scheduler.custom',
                payload: JSON.stringify({ name: 'history-refresh', command: 'echo 1' }),
                status: 'completed',
                createdAt: now - 6_000,
            },
            {
                id: 'custom-daily-1',
                type: 'scheduler.custom',
                payload: JSON.stringify({ name: 'database-daily-maintenance', command: 'echo 2' }),
                status: 'pending',
                createdAt: now - 5_000,
            },
            {
                id: 'custom-empty-string-payload',
                type: 'scheduler.custom',
                payload: '',
                status: 'completed',
                createdAt: now - 4_000,
            },
            {
                id: 'custom-empty-json',
                type: 'scheduler.custom',
                payload: '{}',
                status: 'completed',
                createdAt: now - 3_000,
            },
            {
                id: 'custom-malformed-json',
                type: 'scheduler.custom',
                payload: 'not-valid-json',
                status: 'failed',
                createdAt: now - 2_000,
            },
            {
                id: 'adhoc-named-like-custom',
                type: 'history-refresh',
                payload: JSON.stringify({ taskId: 't-1' }),
                status: 'processing',
                createdAt: now - 1_000,
            },
        ] as const;

        for (const r of rows) {
            await adapter.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 1, 3, ?, ?)`,
                r.id,
                r.type,
                r.payload,
                r.status,
                r.createdAt,
                r.createdAt,
            );
        }

        // 1. excludeTypes removes matching built-in jobs from both jobs and countsByStatus
        const withoutBuiltins = await queryQueueJobs(adapter, {
            excludeTypes: ['system-events-prune', 'smoke', 'observation-refresh'],
        });
        expect(withoutBuiltins.jobs.map((j) => j.id)).toEqual([
            'adhoc-named-like-custom',
            'custom-malformed-json',
            'custom-empty-json',
            'custom-empty-string-payload',
            'custom-daily-1',
            'custom-history-1',
        ]);
        expect(withoutBuiltins.total).toBe(6);
        expect(withoutBuiltins.countsByStatus).toEqual({
            all: 6,
            pending: 1,
            processing: 1,
            completed: 3,
            failed: 1,
        });

        // 2. excludeCustomNames removes matching scheduler.custom rows while keeping empty/malformed JSON
        //    and non-scheduler.custom rows whose type matches the excluded name.
        const withoutHistory = await queryQueueJobs(adapter, {
            excludeTypes: ['system-events-prune', 'smoke'],
            excludeCustomNames: ['history-refresh'],
        });
        expect(withoutHistory.jobs.map((j) => j.id)).toEqual([
            'adhoc-named-like-custom',
            'custom-malformed-json',
            'custom-empty-json',
            'custom-empty-string-payload',
            'custom-daily-1',
        ]);
        expect(withoutHistory.total).toBe(5);
        expect(withoutHistory.countsByStatus).toEqual({
            all: 5,
            pending: 1,
            processing: 1,
            completed: 2,
            failed: 1,
        });

        // 3. Combined status, since, pagination, and exclusion filters
        const filteredFailed = await queryQueueJobs(adapter, {
            status: 'failed',
            since: now - 8_500,
            excludeTypes: ['smoke'],
        });
        expect(filteredFailed.jobs.map((j) => j.id)).toEqual(['custom-malformed-json']);
        expect(filteredFailed.total).toBe(1);
        expect(filteredFailed.countsByStatus).toEqual({
            all: 7,
            pending: 1,
            processing: 1,
            completed: 4,
            failed: 1,
        });

        const paged = await queryQueueJobs(adapter, {
            excludeTypes: ['system-events-prune', 'smoke'],
            limit: 2,
            offset: 2,
        });
        expect(paged.jobs.map((j) => j.id)).toEqual(['custom-empty-json', 'custom-empty-string-payload']);
        expect(paged.hasMore).toBe(true);

        // 4. Empty / whitespace-only exclusion arrays are no-ops
        const noop = await queryQueueJobs(adapter, {
            excludeTypes: ['', '   '],
            excludeCustomNames: [''],
        });
        expect(noop.total).toBe(8);

        adapter.close();
    });

    test('queueJobKpis computes rates, counts, and returns recent errors', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);

        const now = Date.now();
        const sinceMs = now - 60_000;
        const untilMs = now + 1_000;

        // Empty window: successRatePct = 0
        const emptyKpis = await queueJobKpis(adapter, sinceMs, untilMs);
        expect(emptyKpis.activeJobs).toBe(0);
        expect(emptyKpis.completedJobs).toBe(0);
        expect(emptyKpis.failedJobs).toBe(0);
        expect(emptyKpis.successRatePct).toBe(0);
        expect(emptyKpis.recentJobErrors).toEqual([]);

        // Insert 1 pending, 1 processing, 3 completed, 1 failed
        await adapter.run(
            `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
             VALUES ('p-1', 'job.p', '{}', 'pending', 0, 3, ?, ?)`,
            now - 10_000,
            now - 10_000,
        );
        await adapter.run(
            `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
             VALUES ('pr-1', 'job.pr', '{}', 'processing', 1, 3, ?, ?)`,
            now - 9_000,
            now - 9_000,
        );
        for (let i = 1; i <= 3; i++) {
            await adapter.run(
                `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at)
                 VALUES (?, 'job.c', '{}', 'completed', 1, 3, ?, ?)`,
                `c-${i}`,
                now - (8_000 - i * 100),
                now - (7_000 - i * 100),
            );
        }
        await adapter.run(
            `INSERT INTO queue_jobs (id, type, payload, status, attempts, max_retries, created_at, updated_at, last_error)
             VALUES ('f-1', 'job.f', '{}', 'failed', 3, 3, ?, ?, 'Timeout during execution')`,
            now - 5_000,
            now - 4_000,
        );

        const kpis = await queueJobKpis(adapter, sinceMs, untilMs);
        expect(kpis.activeJobs).toBe(2); // 1 pending + 1 processing
        expect(kpis.completedJobs).toBe(3);
        expect(kpis.failedJobs).toBe(1);
        // successRatePct = round(3 / (3 + 1) * 100) = 75
        expect(kpis.successRatePct).toBe(75);

        expect(kpis.recentJobErrors).toHaveLength(1);
        expect(kpis.recentJobErrors[0]?.id).toBe('f-1');
        expect(kpis.recentJobErrors[0]?.name).toBe('job.f');
        expect(kpis.recentJobErrors[0]?.message).toBe('Timeout during execution');

        adapter.close();
    });
});
