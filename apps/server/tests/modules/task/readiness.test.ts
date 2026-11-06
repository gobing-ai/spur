import { expect, test } from 'bun:test';
import { TaskRunLinkDao } from '@gobing-ai/spur-domain';
import { readinessFixture } from '../../../../../packages/app/tests/services/planning-readiness.fixture';
import { createApp } from '../../../src/bootstrap';
import { createServerContext } from '../../../src/context';
import { mockRuntime } from '../../middleware/helpers';

test('GET readiness uses real context/check/run wiring and never dispatches a model or job', async () => {
    const f = readinessFixture();
    f.task('0001');
    f.task('0002', 'wip');
    f.task('0003');
    const ctx = createServerContext(mockRuntime(), {
        cwd: f.root,
        fs: f.fs,
        dbUrl: ':memory:',
        sectionMatrix: f.matrix,
        folders: {
            tasksDir: f.tasksDir,
            featuresDir: f.featuresDir,
            foldersConfig: { active_folder: 'docs/tasks', folders: { 'docs/tasks': { baseCounter: 0 } } },
        },
    });
    let dispatches = 0;
    ctx.agentService = () => {
        dispatches++;
        throw new Error('unexpected model dispatch');
    };
    ctx.jobQueue = async () => {
        dispatches++;
        throw new Error('unexpected job dispatch');
    };
    try {
        const db = await ctx.getDb();
        // Multiple paused runs must stay distinct, sort by WBS/run ID, and block todo work.
        for (const [runId, wbs] of [
            ['paused-z', '0002'],
            ['paused-a', '0002'],
            ['paused-3', '0003'],
        ] as const) {
            await db.run(
                'INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [runId, 'task-pipeline', 'state-machine', 'paused', '2026-11-05T00:00:00Z', '{}', 1, 1],
            );
            await new TaskRunLinkDao(db).insert({
                id: `link-${runId}`,
                wbs,
                run_id: runId,
                kind: 'task',
                created_at: '2026-11-05T00:00:00Z',
            });
        }
        const app = createApp(undefined, { ctx, fs: f.fs });
        const response = await app.request('/api/tasks/readiness');
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({
            ok: true,
            data: {
                tasks: [
                    { wbs: '0001', state: 'ready', nextAction: { command: '/sp:dev-run 0001' } },
                    { wbs: '0002', state: 'not-startable', nextAction: null },
                    {
                        wbs: '0003',
                        state: 'blocked',
                        reasons: [expect.objectContaining({ code: 'run-paused' })],
                        nextAction: null,
                    },
                ],
                pausedRuns: [
                    { runId: 'paused-a', wbs: '0002' },
                    { runId: 'paused-z', wbs: '0002' },
                    { runId: 'paused-3', wbs: '0003' },
                ],
                diagnostics: [],
            },
        });
        expect(dispatches).toBe(0);
    } finally {
        await ctx.closeDb();
        f.cleanup();
    }
});
