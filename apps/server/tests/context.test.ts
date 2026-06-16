import { describe, expect, test } from 'bun:test';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createServerContext } from '../src/context';
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

    test('getDb() returns a migrated in-memory DB adapter', async () => {
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

    test('eventBus() returns the appRt events', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        const bus = ctx.eventBus();
        expect(bus).toBeDefined();
        expect(typeof bus.emit).toBe('function');
        expect(typeof bus.on).toBe('function');
    });

    test('jobQueue() throws when disabled (default)', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        expect(() => ctx.jobQueue()).toThrow('jobQueue is not configured');
    });

    test('scheduler() throws when disabled (default)', () => {
        const appRt = makeAppRt();
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs });

        expect(() => ctx.scheduler()).toThrow('scheduler is not configured');
    });

    test('scheduler() returns the adapter when provided', () => {
        const appRt = makeAppRt();
        const mockScheduler = {
            register: () => {},
            start: async () => {},
            stop: async () => {},
        };
        const ctx = createServerContext(appRt, { cwd: '/tmp/test', fs: testFs, scheduler: mockScheduler });

        expect(ctx.scheduler()).toBe(mockScheduler);
    });
});
