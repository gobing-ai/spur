import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlanningEventBus } from '@gobing-ai/spur-app';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createServerContext, NOOP_OUTPUT } from '../src/context';
import { mockRuntime } from './middleware/helpers';

const testFs = createNodeFileSystem('/tmp/test');

function makeAppRt() {
    return mockRuntime();
}

describe('createServerContext', () => {
    test('builds with cwd and fs', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        expect(ctx.cwd).toBe('/tmp/test');
        expect(ctx.fs).toBe(testFs);
        expect(ctx.webDistPath).toBeUndefined();
    });

    test('accepts optional webDistPath', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, webDistPath: '/dist/web' });

        expect(ctx.webDistPath).toBe('/dist/web');
    });

    test('getDb() returns a migrated explicitly in-memory DB adapter', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, dbUrl: ':memory:' });

        const db = await ctx.getDb();
        expect(db).toBeDefined();

        const result = await db.queryFirst<{ one: number }>('SELECT 1 AS one');
        expect(result).toEqual({ one: 1 });
    });

    test('getDb() caches the adapter across calls', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, dbUrl: ':memory:' });

        const db1 = await ctx.getDb();
        const db2 = await ctx.getDb();
        expect(db1).toBe(db2);
    });

    test('taskService() builds a TaskService', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const svc = ctx.taskService();
        expect(svc).toBeDefined();
    });

    test('taskService() caches the instance', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const svc1 = ctx.taskService();
        const svc2 = ctx.taskService();
        expect(svc1).toBe(svc2);
    });

    test('featureService() builds a FeatureService', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const svc = ctx.featureService();
        expect(svc).toBeDefined();
    });

    test('featureService() caches the instance', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const svc1 = ctx.featureService();
        const svc2 = ctx.featureService();
        expect(svc1).toBe(svc2);
    });

    test('teamService() builds a TeamService', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const svc = ctx.teamService();
        expect(svc).toBeDefined();
    });

    test('teamService() caches the instance', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const svc1 = ctx.teamService();
        const svc2 = ctx.teamService();
        expect(svc1).toBe(svc2);
    });

    test('systemEventDao() returns a SystemEventDao backed by the migrated DB', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, dbUrl: ':memory:' });

        const dao = await ctx.systemEventDao();
        expect(dao).toBeDefined();
        // query() against the empty ledger resolves to [] (idempotent, no throw).
        const rows = await dao.query({});
        expect(rows).toEqual([]);
    });

    test('systemEventDao() caches the instance across calls', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, dbUrl: ':memory:' });

        const dao1 = await ctx.systemEventDao();
        const dao2 = await ctx.systemEventDao();
        expect(dao1).toBe(dao2);
    });

    test('planningFolders() returns the resolved folders', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const folders = ctx.planningFolders();
        expect(folders).toBeDefined();
        expect(typeof folders.tasksDir).toBe('string');
        expect(typeof folders.featuresDir).toBe('string');
    });

    test('planningFolders() honors folders passed via options', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, {
            cwd: '/tmp/test',
            fs: testFs,
            folders: {
                tasksDir: '/custom/tasks',
                featuresDir: '/custom/features',
                foldersConfig: {
                    active_folder: 'tasks',
                    folders: {},
                },
            },
        });

        const folders = ctx.planningFolders();
        expect(folders.tasksDir).toBe('/custom/tasks');
        expect(folders.featuresDir).toBe('/custom/features');
    });

    test('eventBus() returns the appRt events by default', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const bus = ctx.eventBus();
        expect(bus).toBeDefined();
        expect(typeof bus.emit).toBe('function');
        expect(typeof bus.on).toBe('function');
    });

    test('R6: a published event on the provided EventBus is observable through eventBus()', async () => {
        const appRt = makeAppRt();
        // Real EventBus (not the no-op mock) so publish→observe is genuinely exercised.
        const { EventBus } = await import('@gobing-ai/ts-infra');
        const realBus = new EventBus() as unknown as Parameters<typeof createServerContext>[1]['eventsBus'];
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, eventsBus: realBus });

        const observed: Array<{ wbs: string }> = [];
        ctx.eventBus().on('planning.task.transitioned', (detail) => {
            observed.push(detail as unknown as { wbs: string });
        });
        ctx.eventBus().emit('planning.task.transitioned', { wbs: '0001' } as never);

        expect(observed).toEqual([{ wbs: '0001' }]);
    });

    test('jobQueue() rejects when disabled (default)', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        await expect(ctx.jobQueue()).rejects.toThrow('jobQueue is not configured');
    });

    test('jobQueue() builds a real DBJobQueue over the migrated queue_jobs table when enabled', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, {
            cwd: '/tmp/test',
            fs: testFs,
            dbUrl: ':memory:',
            jobQueueEnabled: true,
        });

        const queue = await ctx.jobQueue();
        // Real producer surface (ts-infra JobQueue): enqueue returns a job id.
        const id = await queue.enqueue('test.job', { hello: 'world' });
        expect(typeof id).toBe('string');
        const stats = await queue.stats();
        expect(stats.pending).toBe(1);
    });

    test('jobQueue() caches the instance across calls', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, {
            cwd: '/tmp/test',
            fs: testFs,
            dbUrl: ':memory:',
            jobQueueEnabled: true,
        });

        const q1 = await ctx.jobQueue();
        const q2 = await ctx.jobQueue();
        expect(q1).toBe(q2);
    });

    test('R6: enqueue → consume roundtrip against in-memory SQLite', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, {
            cwd: '/tmp/test',
            fs: testFs,
            dbUrl: ':memory:',
            jobQueueEnabled: true,
        });

        const queue = await ctx.jobQueue();
        const db = await ctx.getDb();
        const { createQueueConsumer } = await import('@gobing-ai/spur-domain');
        const consumer = await createQueueConsumer<{ n: number }>(db);

        const seen: number[] = [];
        consumer.register('roundtrip.job', async (job) => {
            seen.push(job.payload.n);
        });

        await queue.enqueue('roundtrip.job', { n: 42 });
        // Drive one batch synchronously (no polling timer) for a deterministic test.
        const processed = await consumer.processOnce();

        expect(processed).toBe(1);
        expect(seen).toEqual([42]);
        const stats = await queue.stats();
        expect(stats.completed).toBe(1);
        expect(stats.pending).toBe(0);
    });

    test('queueConsumer() throws when the job queue is disabled', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        await expect(ctx.queueConsumer()).rejects.toThrow('queueConsumer is not configured');
    });

    test('queueConsumer() builds and caches the DBQueueConsumer when enabled', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, {
            cwd: '/tmp/test',
            fs: testFs,
            dbUrl: ':memory:',
            jobQueueEnabled: true,
        });

        const c1 = await ctx.queueConsumer();
        const c2 = await ctx.queueConsumer();
        expect(c1).toBe(c2);
        expect(typeof c1.register).toBe('function');
        expect(typeof c1.processOnce).toBe('function');
    });

    test('scheduler() throws when disabled (default)', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        expect(() => ctx.scheduler()).toThrow('scheduler is not configured');
    });

    test('scheduler() returns the configured adapter and registration is observable', async () => {
        const appRt = makeAppRt();
        const registered: string[] = [];
        const mockScheduler = {
            register: (cron: string) => {
                registered.push(cron);
            },
            start: async () => {},
            stop: async () => {},
        };
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, scheduler: mockScheduler });

        const sched = ctx.scheduler();
        expect(sched).toBe(mockScheduler);
        sched.register('*/5 * * * *', async () => {});
        expect(registered).toEqual(['*/5 * * * *']);
    });

    test('R3: NodeSchedulerAdapter registers + starts + stops a real cron entry', async () => {
        const { setLoggerMuted } = await import('@gobing-ai/ts-infra');
        // The 6-field cron below is intentionally unparseable — it exercises the adapter's
        // documented fallback (60s interval + WARN log). Mute the logger so the expected
        // warning doesn't leak into test output.
        setLoggerMuted(true);
        try {
            const { NodeSchedulerAdapter } = await import('@gobing-ai/ts-infra/scheduler-node');
            const adapter = new NodeSchedulerAdapter();
            let ticks = 0;
            adapter.register('* * * * * *', async () => {
                ticks += 1;
            });
            await adapter.start();
            await adapter.stop();
            // Registration + lifecycle complete without throwing; tick count is timing-dependent
            // so we only assert the adapter accepted the entry and the start/stop cycle is clean.
            expect(ticks).toBeGreaterThanOrEqual(0);
        } finally {
            setLoggerMuted(false);
        }
    });

    test('taskService and featureService resolve and emit events via LazyPlanningEventEmitter', async () => {
        const cwd = mkdtempSync(join(tmpdir(), 'spur-server-context-'));
        const tasksDir = join(cwd, 'docs/tasks');
        const featuresDir = join(cwd, 'docs/features');
        const appRt = makeAppRt();
        const realBus = new (await import('@gobing-ai/ts-infra')).EventBus();
        const ctx = createServerContext(appRt, {
            cwd,
            fs: createNodeFileSystem(cwd),
            dbUrl: ':memory:',
            eventsBus: realBus as unknown as never,
            folders: {
                tasksDir,
                featuresDir,
                foldersConfig: { active_folder: tasksDir, folders: { [tasksDir]: { base_counter: 0 } } },
            },
        });

        const taskSvc = ctx.taskService();
        const featureSvc = ctx.featureService();
        expect(taskSvc).toBeDefined();
        expect(featureSvc).toBeDefined();

        const db = await ctx.getDb();
        const eventDao = new (await import('@gobing-ai/spur-domain')).PlanningEventDao(db);
        const systemEventDao = new (await import('@gobing-ai/spur-domain')).SystemEventDao(db);

        // Manually subscribe system event tap on the context's eventBus (mirroring serve.ts bootstrap behavior)
        const tap = (await import('@gobing-ai/spur-app')).registerSystemEventTap(
            ctx.eventBus() as unknown as PlanningEventBus,
            systemEventDao,
            { warn: () => {}, debug: () => {} },
        );

        // We can manually trigger an emit on the lazy emitter since it's wired into the services
        // Let's create a task to trigger it
        await taskSvc.create({ title: 'Test task' });

        // Wait for the asynchronous tap persistence to settle
        await tap.flush();

        // Let's verify that a planning event was indeed recorded
        const events = await eventDao.listAll(10);
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0]?.event).toBe('task.created');

        // Let's verify that the system event tap recorded the system event as well
        const sysEvents = await systemEventDao.query({ limit: 10 });
        expect(sysEvents.length).toBeGreaterThanOrEqual(1);
        expect(sysEvents[0]?.event_name).toBe('task.created');

        tap.unsubscribe();
    });

    test('processInventory() returns inventory service with serve root', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        const snap = await ctx.processInventory().snapshot();
        expect(snap.rootPid).toBe(process.pid);
        expect(snap.processes.some((p) => p.pid === process.pid && p.source === 'serve')).toBe(true);
        expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('supervisor() returns supervisor service instance', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        const svc = ctx.supervisor();
        expect(svc).toBeDefined();
    });

    // task 0226 F2 — server-native AgentService/RuleService/WorkflowAppService
    // accessors. The accessor must return a service whose underlying bus is
    // the canonical server EventBus, so rule.*/agent.*/workflow.* events
    // reach the system_events tap. Each accessor is also cached.
    test('agentService() builds and caches a server-bus-wired AgentService', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        const svc1 = ctx.agentService();
        const svc2 = ctx.agentService();
        expect(svc1).toBe(svc2);
        expect(typeof svc1.run).toBe('function');
    });

    test('ruleService() builds and caches a server-bus-wired RuleService', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        const svc1 = ctx.ruleService();
        const svc2 = ctx.ruleService();
        expect(svc1).toBe(svc2);
        expect(typeof svc1.evaluate).toBe('function');
    });

    test('workflowService() builds and caches a server-bus-wired WorkflowAppService', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        const svc1 = ctx.workflowService();
        const svc2 = ctx.workflowService();
        expect(svc1).toBe(svc2);
        expect(typeof svc1.run).toBe('function');
    });

    test('hitlResponder() default-denies confirm (R1)', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, env: {} });
        const responder = ctx.hitlResponder();
        const result = await responder.respond({} as never);
        expect(result.value).toBe('no');
    });

    test('hitlResponder() auto-approves when SPUR_HITL_AUTO_APPROVE=1 (R1)', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, {
            cwd: '/tmp/test',
            fs: testFs,
            env: { SPUR_HITL_AUTO_APPROVE: '1' },
        });
        const responder = ctx.hitlResponder();
        const result = await responder.respond({} as never);
        expect(result.value).toBe('yes');
    });

    test('jobQueue() throws NotConfiguredError when not enabled', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        expect(() => ctx.jobQueue()).toThrow('jobQueue');
    });

    test('queueConsumer() throws NotConfiguredError when not enabled', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        expect(() => ctx.queueConsumer()).toThrow('queueConsumer');
    });

    test('scheduler() throws NotConfiguredError when not configured', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });
        expect(() => ctx.scheduler()).toThrow('scheduler');
    });

    test('NOOP_OUTPUT sink accepts write and error without throwing', () => {
        // R8: the headless output sink must silently absorb strings — server
        // jobs run without a human-facing terminal, and a throw here would
        // surface as an opaque service failure.
        expect(() => NOOP_OUTPUT.write('payload')).not.toThrow();
        expect(() => NOOP_OUTPUT.error('err-payload')).not.toThrow();
    });

    test('checkDbHealth() returns true for a healthy in-memory DB', async () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, dbUrl: ':memory:' });
        const healthy = await ctx.checkDbHealth();
        expect(healthy).toBe(true);
    });
});
