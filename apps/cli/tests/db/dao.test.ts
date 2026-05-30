import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    applyCliMigrations,
    loadSqlMigrations,
    PhaseRunDao,
    RunDao,
    TransitionRunDao,
    WorkflowStateDao,
    WorkspaceDao,
} from '../../src/db';

describe('CLI DAOs', () => {
    test('persist core workflow records against ts-db', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);

        const workspace = await new WorkspaceDao(adapter).add({ name: 'main', root: '/tmp/spur' });
        const run = await new RunDao(adapter).create({ workspaceId: workspace.id, agent: 'pi' });
        const foundRun = await new RunDao(adapter).findById(run.id);
        const phase = await new PhaseRunDao(adapter).create({ runId: run.id, phase: 'implement' });
        const transition = await new TransitionRunDao(adapter).create({
            runId: run.id,
            fromState: 'plan',
            toState: 'implement',
        });
        const state = await new WorkflowStateDao(adapter).create({
            runId: run.id,
            state: 'running',
            data: { phase: 1 },
        });

        expect(workspace.name).toBe('main');
        expect(run.workspaceId).toBe(workspace.id);
        expect(foundRun?.id).toBe(run.id);
        expect(phase.phase).toBe('implement');
        expect(transition.fromState).toBe('plan');
        expect(JSON.parse(state.dataJson)).toEqual({ phase: 1 });

        adapter.close();
    });

    test('loads SQL migrations from a folder', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cli-migrations-'));
        await Bun.write(join(dir, '0002_extra.sql'), 'CREATE TABLE IF NOT EXISTS extra_table_2 (id TEXT PRIMARY KEY);');
        await Bun.write(join(dir, '0001_extra.sql'), 'CREATE TABLE IF NOT EXISTS extra_table_1 (id TEXT PRIMARY KEY);');

        const migrations = await loadSqlMigrations(dir);
        expect(migrations).toHaveLength(2);
        expect(migrations[0]?.id).toBe('0001_extra');
    });

    test('falls back to embedded migrations for an empty folder', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cli-empty-migrations-'));
        const migrations = await loadSqlMigrations(dir);
        expect(migrations[0]?.id).toBe('0000_spur_cli_foundation');
    });
});
