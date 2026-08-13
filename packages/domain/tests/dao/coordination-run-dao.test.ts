import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, CoordinationRunDao } from '../../src/index';

describe('CoordinationRunDao', () => {
    test('insert start, get by runId, update exit', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'run-1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });

        const running = await dao.getByRunId('run-1');
        expect(running?.status).toBe('running');
        expect(running?.spec_id).toBe('reviewer');
        expect(running?.agent_kind).toBe('codex');
        expect(running?.artifact_refs_json).toBe('[]');

        await dao.updateExit(
            'run-1',
            'exited',
            '2026-08-13T01:00:05.000Z',
            '[{"kind":"log","path":".spur/run/run-1.log"}]',
        );

        const exited = await dao.getByRunId('run-1');
        expect(exited?.status).toBe('exited');
        expect(exited?.completed_at).toBe('2026-08-13T01:00:05.000Z');
        expect(exited?.artifact_refs_json).toContain('.spur/run/run-1.log');

        adapter.close();
    });

    test('getByRunId returns null for unknown run', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        expect(await dao.getByRunId('nope')).toBeNull();
        adapter.close();
    });

    test('maxGeneration is null then climbs monotonically per spec', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        expect(await dao.maxGeneration('reviewer')).toBeNull();

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });
        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r2',
            generation: 3,
            startedAt: '2026-08-13T02:00:00.000Z',
        });
        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r3',
            generation: 2,
            startedAt: '2026-08-13T03:00:00.000Z',
        });

        expect(await dao.maxGeneration('reviewer')).toBe(3);
        // other spec is independent
        expect(await dao.maxGeneration('coder')).toBeNull();
        adapter.close();
    });

    test('getLatestBySpecId returns highest generation then newest started', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });
        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r2',
            generation: 1,
            startedAt: '2026-08-13T05:00:00.000Z',
        });

        const latest = await dao.getLatestBySpecId('reviewer');
        expect(latest?.run_id).toBe('r2');
        adapter.close();
    });

    test('deleteAll clears rows', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new CoordinationRunDao(adapter);

        await dao.insertStart({
            specId: 'reviewer',
            agentKind: 'codex',
            processId: null,
            runId: 'r1',
            generation: 1,
            startedAt: '2026-08-13T01:00:00.000Z',
        });
        await dao.deleteAll();
        expect(await dao.getByRunId('r1')).toBeNull();
        adapter.close();
    });
});
