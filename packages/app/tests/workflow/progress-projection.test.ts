import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ArtifactDao, applyCliMigrations, TransitionRunDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { computeDefinitionDigest } from '../../src/workflow/composition-baseline';
import { projectWorkflowProgress } from '../../src/workflow/progress-projection';

const PROJECT_ROOT = resolve(__dirname, '../../../..');

describe('projectWorkflowProgress', () => {
    async function setupDb() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return adapter;
    }

    const testWorkflowDef: WorkflowDef = {
        kind: 'state-machine',
        name: 'test-pipeline',
        initialState: 'precheck',
        terminalStates: ['done', 'failed'],
        states: [
            {
                id: 'precheck',
                onEnter: [{ kind: 'shell', options: { command: 'echo precheck' } }],
            },
            {
                id: 'implement',
                onEnter: [
                    { kind: 'agent.run', options: { input: 'do work' } },
                    { kind: 'shell', options: { command: 'echo format' } },
                ],
                onExit: [{ kind: 'shell', options: { command: 'echo cleanup' } }],
            },
            {
                id: 'done',
                onEnter: [{ kind: 'shell', options: { command: 'echo done' } }],
            },
            {
                id: 'failed',
            },
        ],
        transitions: [
            { from: 'precheck', to: 'implement', description: 'precheck passed' },
            { from: 'implement', to: 'done', description: 'implement passed' },
            { from: 'implement', to: 'failed', description: 'implement failed' },
        ],
    };

    test('returns orphan-row diagnostic when runId does not exist', async () => {
        const db = await setupDb();
        const projection = await projectWorkflowProgress('non-existent-run', { db });
        expect(projection.schemaVersion).toBe(1);
        expect(projection.status).toBe('unknown');
        expect(projection.diagnostics.some((d) => d.code === 'orphan-row')).toBe(true);
        db.close();
    });

    test('returns definition-unavailable and definition-digest-missing when definition not found and no digest', async () => {
        const db = await setupDb();
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r1', 'unknown-pipeline', 'running', '2026-08-19T00:00:00Z', '{}', ?, ?)",
            now,
            now,
        );

        const projection = await projectWorkflowProgress('r1', { db, projectRoot: PROJECT_ROOT });
        expect(projection.status).toBe('running');
        expect(projection.workflow).toBe('unknown-pipeline');
        expect(projection.definitionDigest).toBeNull();
        expect(projection.diagnostics.some((d) => d.code === 'definition-unavailable')).toBe(true);
        expect(projection.diagnostics.some((d) => d.code === 'definition-digest-missing')).toBe(true);
        db.close();
    });

    test('surfaces workflowVersion as version: literal, known-null, and legacy-absent (0768 R1)', async () => {
        const db = await setupDb();
        const now = Date.now();
        const digest = computeDefinitionDigest(testWorkflowDef);

        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-ver', 'test-pipeline', 'running', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: digest, workflowVersion: '2.0.0' }),
            now,
            now,
        );
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-null', 'test-pipeline', 'running', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: digest, workflowVersion: null }),
            now,
            now,
        );
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-legacy', 'test-pipeline', 'running', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: digest }),
            now,
            now,
        );

        // Post-0768 row with a versioned definition: the literal surfaces.
        const versioned = await projectWorkflowProgress('r-ver', { db, workflowDef: testWorkflowDef });
        expect(versioned.version).toBe('2.0.0');

        // Post-0768 row for a known-unversioned definition: version is explicitly null.
        const unversioned = await projectWorkflowProgress('r-null', { db, workflowDef: testWorkflowDef });
        expect(unversioned.version).toBeNull();

        // Pre-0768 legacy row (no workflowVersion key): version stays absent.
        const legacy = await projectWorkflowProgress('r-legacy', { db, workflowDef: testWorkflowDef });
        expect('version' in legacy).toBe(false);

        db.close();
    });

    test('returns definition-drift when recorded digest does not match current definition', async () => {
        const db = await setupDb();
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r1', 'test-pipeline', 'running', '2026-08-19T00:00:00Z', '{\"definitionDigest\":\"sha256:olddigest00000000000000000000000000000000000000000000000000000000\"}', ?, ?)",
            now,
            now,
        );

        const projection = await projectWorkflowProgress('r1', {
            db,
            workflowDef: testWorkflowDef,
        });

        expect(projection.status).toBe('running');
        expect(projection.definitionDigest).toBe(
            'sha256:olddigest00000000000000000000000000000000000000000000000000000000',
        );
        expect(projection.diagnostics.some((d) => d.code === 'definition-drift')).toBe(true);
        db.close();
    });

    test('projects accurate states, actions, attempts, transitions, artifacts, and nextTransitions for completed run', async () => {
        const db = await setupDb();
        const now = Date.now();
        const digest = computeDefinitionDigest(testWorkflowDef);

        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r1', 'test-pipeline', 'done', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: digest }),
            now,
            now,
        );

        const transitionDao = new TransitionRunDao(db);
        await transitionDao.open({ runId: 'r1', fromState: 'precheck', toState: 'implement', status: 'completed' });
        await transitionDao.open({ runId: 'r1', fromState: 'implement', toState: 'done', status: 'completed' });

        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a1', 'r1', 'precheck', 'shell', 'success', 1, 100, '2026-08-19T00:00:01Z', '2026-08-19T00:00:02Z', ?)",
            now + 10,
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a2', 'r1', 'implement', 'agent.run', 'success', 1, 500, '2026-08-19T00:00:03Z', '2026-08-19T00:00:04Z', ?)",
            now + 20,
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a3', 'r1', 'implement', 'shell', 'success', 1, 50, '2026-08-19T00:00:05Z', '2026-08-19T00:00:06Z', ?)",
            now + 30,
        );

        const artifactDao = new ArtifactDao(db);
        await artifactDao.record({ runId: 'r1', path: '.spur/run/out.json', kind: 'test-artifact' });

        const projection = await projectWorkflowProgress('r1', {
            db,
            workflowDef: testWorkflowDef,
        });

        expect(projection.status).toBe('completed');
        expect(projection.definitionDigest).toBe(digest);
        expect(projection.currentState).toBe('done');
        expect(projection.diagnostics).toEqual([]);

        expect(projection.transitions.length).toBe(2);
        expect(projection.transitions[0]?.from).toBe('precheck');
        expect(projection.transitions[0]?.to).toBe('implement');
        expect(projection.transitions[1]?.from).toBe('implement');
        expect(projection.transitions[1]?.to).toBe('done');

        expect(projection.artifacts.length).toBe(1);
        expect(projection.artifacts[0]?.kind).toBe('test-artifact');
        expect(projection.artifacts[0]?.path).toBe('.spur/run/out.json');

        const precheckState = projection.states.find((s) => s.state === 'precheck');
        expect(precheckState?.status).toBe('passed');
        expect(precheckState?.actions[0]?.status).toBe('passed');
        expect(precheckState?.actions[0]?.attempts.length).toBe(1);
        expect(precheckState?.actions[0]?.attempts[0]?.ok).toBe(true);

        const implementState = projection.states.find((s) => s.state === 'implement');
        expect(implementState?.status).toBe('passed');
        expect(implementState?.actions[0]?.kind).toBe('agent.run');
        expect(implementState?.actions[0]?.status).toBe('passed');
        expect(implementState?.actions[1]?.kind).toBe('shell');
        expect(implementState?.actions[1]?.status).toBe('passed');

        db.close();
    });

    test('detects ambiguous action mappings and emits diagnostic', async () => {
        const db = await setupDb();
        const now = Date.now();
        const ambiguousWf: WorkflowDef = {
            kind: 'state-machine',
            name: 'ambiguous-wf',
            initialState: 's1',
            terminalStates: ['done'],
            states: [
                {
                    id: 's1',
                    onEnter: [
                        { kind: 'shell', options: { command: 'echo 1' } },
                        { kind: 'shell', options: { command: 'echo 2' } },
                    ],
                },
                { id: 'done' },
            ],
            transitions: [{ from: 's1', to: 'done' }],
        };

        const digest = computeDefinitionDigest(ambiguousWf);
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r1', 'ambiguous-wf', 'running', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: digest }),
            now,
            now,
        );

        // Insert 3 action rows when 2 were declared (ambiguous count)
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a1', 'r1', 's1', 'shell', 'success', 1, 10, '2026-08-19T00:00:01Z', '2026-08-19T00:00:02Z', ?)",
            now + 1,
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a2', 'r1', 's1', 'shell', 'failed', 0, 10, '2026-08-19T00:00:02Z', '2026-08-19T00:00:03Z', ?)",
            now + 2,
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a3', 'r1', 's1', 'shell', 'success', 1, 10, '2026-08-19T00:00:03Z', '2026-08-19T00:00:04Z', ?)",
            now + 3,
        );

        const projection = await projectWorkflowProgress('r1', {
            db,
            workflowDef: ambiguousWf,
        });

        expect(projection.diagnostics.some((d) => d.code === 'ambiguous-action')).toBe(true);
        const s1 = projection.states.find((s) => s.state === 's1');
        expect(s1?.actions.some((a) => a.status === 'ambiguous')).toBe(true);
        db.close();
    });

    test('covers pending, failed, cancelled statuses and candidatePath resolution', async () => {
        const db = await setupDb();
        const now = Date.now();

        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-cancel', 'nonexistent', 'cancelled', '2026-08-19T00:00:00Z', 'invalid-json', ?, ?)",
            now,
            now,
        );

        const cancelProj = await projectWorkflowProgress('r-cancel', {
            db,
            projectRoot: PROJECT_ROOT,
        });
        expect(cancelProj.status).toBe('cancelled');
        expect(cancelProj.definitionDigest).toBeNull();
        expect(cancelProj.diagnostics.some((d) => d.code === 'definition-unavailable')).toBe(true);

        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-fail', 'task-pipeline', 'failed', '2026-08-19T00:00:00Z', '{}', ?, ?)",
            now,
            now,
        );
        const failProj = await projectWorkflowProgress('r-fail', {
            db,
            projectRoot: PROJECT_ROOT,
        });
        expect(failProj.status).toBe('failed');
        expect(failProj.workflow).toBe('task-pipeline');

        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-pend', 'task-pipeline', 'pending', '2026-08-19T00:00:00Z', '{}', ?, ?)",
            now,
            now,
        );
        const pendProj = await projectWorkflowProgress('r-pend', {
            db,
            projectRoot: PROJECT_ROOT,
        });
        expect(pendProj.status).toBe('pending');

        db.close();
    });
});
