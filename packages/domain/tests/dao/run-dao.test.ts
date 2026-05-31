import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/dao/run-dao';
import { WorkspaceDao } from '../../src/dao/workspace-dao';
import { applyCliMigrations } from '../../src/migrations';

describe('RunDao', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return adapter;
    }

    test('creates and finds a run', async () => {
        const adapter = await setup();
        const ws = await new WorkspaceDao(adapter).add({ name: 'test-ws', root: '/tmp/test' });

        const dao = new RunDao(adapter);
        const run = await dao.open({ workspaceId: ws.id, agent: 'pi' });
        expect(run.agent).toBe('pi');
        expect(run.workspaceId).toBe(ws.id);
        expect(run.status).toBe('pending');
        expect(run.completedAt).toBeNull();
        expect(run.id).toStartWith('run_');

        const found = await dao.findById(run.id);
        expect(found?.id).toBe(run.id);
        expect(found?.agent).toBe('pi');

        adapter.close();
    });

    test('creates run with default values', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const run = await dao.open({});
        expect(run.workspaceId).toBeNull();
        expect(run.agent).toBeNull();
        expect(run.status).toBe('pending');
        expect(run.startedAt).toBeGreaterThan(0);
        expect(run.createdAt).toBeGreaterThan(0);
        expect(run.updatedAt).toBeGreaterThan(0);
        adapter.close();
    });

    test('creates run with custom status', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const run = await dao.open({ status: 'running' });
        expect(run.status).toBe('running');
        adapter.close();
    });

    test('returns undefined for non-existent run', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const found = await dao.findById('run_nonexistent');
        expect(found).toBeUndefined();
        adapter.close();
    });

    test('creates multiple runs', async () => {
        const adapter = await setup();
        const dao = new RunDao(adapter);
        const r1 = await dao.open({ agent: 'pi' });
        const r2 = await dao.open({ agent: 'claude' });
        expect(r1.id).not.toBe(r2.id);
        expect(await dao.findById(r1.id)).toBeDefined();
        expect(await dao.findById(r2.id)).toBeDefined();
        adapter.close();
    });
});
