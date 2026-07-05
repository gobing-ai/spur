import { describe, expect, test } from 'bun:test';
import { createJobQueue, createMigratedDb, createQueueConsumer, type DbAdapter } from '@gobing-ai/spur-domain';
import { JobHandlerRegistry, type JobWorkerConsumer, JobWorkerService } from '../../src/services/job-worker-service';

interface DemoPayload {
    n: number;
}

function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

async function withDb<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T> {
    const db = await createMigratedDb({ url: ':memory:' });
    try {
        return await fn(db);
    } finally {
        db.close();
    }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timed out`)), 1000);
        }),
    ]);
}

describe('JobWorkerService', () => {
    test('registry applies handlers and worker start/stop are idempotent', async () => {
        const registered: string[] = [];
        let startCalls = 0;
        let stopCalls = 0;
        const consumer: JobWorkerConsumer<DemoPayload> = {
            register: (type) => {
                registered.push(type);
            },
            start: async () => {
                startCalls += 1;
            },
            stop: async () => {
                stopCalls += 1;
            },
            stats: async () => ({ pending: 0, processing: 0, completed: 0, failed: 0 }),
            processOnce: async () => 0,
        };
        const registry = new JobHandlerRegistry<DemoPayload>();

        expect(registry.size()).toBe(0);
        registry.register('demo.job', async () => {});
        expect(registry.size()).toBe(1);

        const worker = new JobWorkerService({ consumer, registry });
        await worker.stop();
        await worker.start();
        await worker.start();
        await worker.stop();
        await worker.stop();

        expect(registered).toEqual(['demo.job']);
        expect(startCalls).toBe(1);
        expect(stopCalls).toBe(1);
    });

    test('processOnce executes a registered job and marks it completed', async () => {
        await withDb(async (db) => {
            const queue = await createJobQueue<DemoPayload>(db);
            const consumer = await createQueueConsumer<DemoPayload>(db);
            const registry = new JobHandlerRegistry<DemoPayload>();
            const seen: number[] = [];

            registry.register('demo.job', async (job) => {
                seen.push(job.payload.n);
            });
            const worker = new JobWorkerService({ consumer, registry });

            await queue.enqueue('demo.job', { n: 7 });
            const processed = await worker.processOnce();

            expect(processed).toBe(1);
            expect(seen).toEqual([7]);
            await expect(worker.stats()).resolves.toMatchObject({ completed: 1, pending: 0 });
        });
    });

    test('processOnce fails an unknown job kind with an error naming the kind', async () => {
        await withDb(async (db) => {
            const queue = await createJobQueue<DemoPayload>(db);
            const consumer = await createQueueConsumer<DemoPayload>(db, { baseDelay: 1, maxDelay: 1 });
            const worker = new JobWorkerService({ consumer, registry: new JobHandlerRegistry<DemoPayload>() });

            await queue.enqueue('missing.job', { n: 1 }, { maxRetries: 1 });
            const processed = await worker.processOnce();

            expect(processed).toBe(1);
            await expect(worker.stats()).resolves.toMatchObject({ failed: 1, pending: 0 });
            const row = await db.queryFirst<{ status: string; last_error: string | null }>(
                'SELECT status, last_error FROM queue_jobs LIMIT 1',
            );
            expect(row?.status).toBe('failed');
            expect(row?.last_error).toContain('No handler registered for job type "missing.job"');
        });
    });

    test('stop waits for an in-flight job to complete instead of orphaning it', async () => {
        await withDb(async (db) => {
            const queue = await createJobQueue<DemoPayload>(db);
            const consumer = await createQueueConsumer<DemoPayload>(db, { pollInterval: 0, drainTimeoutMs: 1000 });
            const registry = new JobHandlerRegistry<DemoPayload>();
            const entered = deferred();
            const release = deferred();

            registry.register('slow.job', async () => {
                entered.resolve();
                await release.promise;
            });
            const worker = new JobWorkerService({ consumer, registry });

            await queue.enqueue('slow.job', { n: 1 });
            await worker.start();
            await withTimeout(entered.promise, 'worker entry');

            const stopped = worker.stop();
            release.resolve();
            await withTimeout(stopped, 'worker stop');

            await expect(worker.stats()).resolves.toMatchObject({ completed: 1, processing: 0, pending: 0 });
        });
    });
});
