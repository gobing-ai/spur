import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ArtifactDao, applyCliMigrations, TransitionRunDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { computeDefinitionDigest } from '../../src/workflow/composition-baseline';
import { projectWorkflowProgress, type WorkflowProgressProjection } from '../../src/workflow/progress-projection';

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

    // 0879 R2: an action row matching no declared state action surfaces as a
    // diagnostic instead of persisting invisibly (invisible-orphan failure mode).
    test('returns orphan-action-row diagnostic for an unmatched action row', async () => {
        const db = await setupDb();
        const now = Date.now();
        const digest = computeDefinitionDigest(testWorkflowDef);
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r1', 'test-pipeline', 'done', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: digest }),
            now,
            now,
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a1', 'r1', 'precheck', 'shell', 'success', 1, 100, '2026-08-19T00:00:01Z', '2026-08-19T00:00:02Z', ?)",
            now + 10,
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('a2', 'r1', 'ghost', 'shell', 'success', 1, 10, '2026-08-19T00:00:03Z', '2026-08-19T00:00:04Z', ?)",
            now + 20,
        );

        const projection = await projectWorkflowProgress('r1', { db, workflowDef: testWorkflowDef });
        // One diagnostic per unclaimed row — never a silent drop, never a duplicate (1085 R4).
        const orphans = projection.diagnostics.filter((d) => d.code === 'orphan-action-row');
        expect(orphans).toHaveLength(1);
        const orphan = orphans[0];
        expect(orphan?.message).toContain('a2');
        expect(orphan?.message).toContain('ghost');
        // The matched row is not flagged.
        expect(projection.diagnostics.some((d) => d.code === 'orphan-action-row' && d.message.includes('a1'))).toBe(
            false,
        );
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

    // 1070 R4/AC1/AC2: per-attempt provenance and `estimated` come from the row's
    // `result_json` stamp. Legacy/engine blobs (and unparseable ones) read unlabelled
    // without adding a diagnostic.
    test('labels host-reported attempts and reads legacy/engine rows as unlabelled (1070 R4)', async () => {
        const db = await setupDb();
        const now = Date.now();
        const provenanceWf: WorkflowDef = {
            kind: 'state-machine',
            name: 'provenance-wf',
            initialState: 's1',
            terminalStates: ['done'],
            states: [
                {
                    id: 's1',
                    onEnter: [
                        { kind: 'shell', options: { command: 'echo measured' } },
                        { kind: 'agent.run', options: { input: 'estimated' } },
                        { kind: 'note', options: { message: 'engine row' } },
                        { kind: 'doctor.probe', options: {} },
                        { kind: 'command.gate', options: {} },
                    ],
                },
                { id: 'done' },
            ],
            transitions: [{ from: 's1', to: 'done' }],
        };
        const digest = computeDefinitionDigest(provenanceWf);
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r1', 'provenance-wf', 'done', '2026-08-19T00:00:00Z', ?, ?, ?)",
            JSON.stringify({ definitionDigest: digest }),
            now,
            now,
        );
        const seeded: Array<{ id: string; kind: string; result: string | null }> = [
            { id: 'a1', kind: 'shell', result: JSON.stringify({ provenance: 'host-reported', estimated: false }) },
            { id: 'a2', kind: 'agent.run', result: JSON.stringify({ provenance: 'host-reported', estimated: true }) },
            { id: 'a3', kind: 'note', result: JSON.stringify({ ok: true, data: {} }) },
            { id: 'a4', kind: 'doctor.probe', result: '{"' },
            { id: 'a5', kind: 'command.gate', result: null },
        ];
        for (const [index, row] of seeded.entries()) {
            await db.run(
                "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, result_json, created_at) VALUES (?, 'r1', 's1', ?, 'success', 1, 10, ?, ?)",
                row.id,
                row.kind,
                row.result,
                now + index,
            );
        }

        const projection = await projectWorkflowProgress('r1', { db, workflowDef: provenanceWf });

        // A malformed blob is labelled, never a diagnostic.
        expect(projection.diagnostics).toEqual([]);
        const actions = projection.states.find((s) => s.state === 's1')?.actions ?? [];
        const attemptOf = (kind: string) => actions.find((action) => action.kind === kind)?.attempts[0];
        // Inline measured → host-reported, not estimated.
        expect(attemptOf('shell')).toMatchObject({ provenance: 'host-reported', estimated: false });
        // Inline estimated → host-reported and estimated.
        expect(attemptOf('agent.run')).toMatchObject({ provenance: 'host-reported', estimated: true });
        // Engine-style result blob → unlabelled.
        expect(attemptOf('note')).toMatchObject({ provenance: 'unknown', estimated: false });
        // Unparseable and NULL result_json → unlabelled.
        expect(attemptOf('doctor.probe')).toMatchObject({ provenance: 'unknown', estimated: false });
        expect(attemptOf('command.gate')).toMatchObject({ provenance: 'unknown', estimated: false });
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

    // ── 1085: an inline run writes `action_runs` rows and no state/transition rows, so
    // with an empty transition history the recorded rows ARE the visit evidence (R1-R4). ──

    /** Inline-pipeline fixture: one declared action per state, two on `implement` (a loopBack state). */
    const inlinePipelineDef: WorkflowDef = {
        kind: 'state-machine',
        name: 'inline-pipeline',
        initialState: 'precheck',
        terminalStates: ['done'],
        states: [
            { id: 'precheck', onEnter: [{ kind: 'shell', options: { command: 'echo precheck' } }] },
            {
                id: 'implement',
                onEnter: [
                    { kind: 'agent.run', options: { input: 'do work' } },
                    { kind: 'shell', options: { command: 'echo format' } },
                ],
            },
            { id: 'test', onEnter: [{ kind: 'shell', options: { command: 'echo test' } }] },
            { id: 'done', onEnter: [{ kind: 'note', options: { message: 'done' } }] },
        ],
        transitions: [
            { from: 'precheck', to: 'implement', description: 'precheck passed' },
            { from: 'implement', to: 'test', description: 'implement passed' },
            { from: 'test', to: 'implement', description: 'test failed — loop back' },
            { from: 'test', to: 'done', description: 'test passed' },
        ],
    };

    type TestDb = Awaited<ReturnType<typeof createDbAdapter>>;

    /** Seed a run row whose metadata carries the fixture digest, so the projection reads no drift. */
    async function seedInlineRun(db: TestDb, runId: string, status: string, def: WorkflowDef): Promise<void> {
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            runId,
            def.name,
            status,
            '2026-08-19T00:00:00Z',
            JSON.stringify({ definitionDigest: computeDefinitionDigest(def) }),
            now,
            now,
        );
    }

    /** Seed one action row: `createdAt` is the recorded order the projection derives visits from. */
    async function seedInlineActionRow(
        db: TestDb,
        runId: string,
        row: { id: string; node: string; kind: string; durationMs: number; createdAt: number },
    ): Promise<void> {
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES (?, ?, ?, ?, 'done', 1, ?, '2026-08-19T00:00:01Z', '2026-08-19T00:00:02Z', ?)",
            row.id,
            runId,
            row.node,
            row.kind,
            row.durationMs,
            row.createdAt,
        );
    }

    /** `state@visit:status` per projected state, in projection order. */
    function stateShape(projection: WorkflowProgressProjection): string[] {
        return projection.states.map((state) => `${state.state}@${state.visit}:${state.status}`);
    }

    /** Attempt row ids of one state visit, in declared-action order. */
    function attemptIds(projection: WorkflowProgressProjection, state: string, visit = 1): string[] {
        return projection.states
            .filter((entry) => entry.state === state && entry.visit === visit)
            .flatMap((entry) =>
                entry.actions.flatMap((action) => action.attempts.map((attempt) => attempt.actionRunId)),
            );
    }

    test('marks every state with a recorded row visited, in row order, with its attempts (1085 R1/R2/AC1)', async () => {
        const db = await setupDb();
        await seedInlineRun(db, 'r-inline', 'running', inlinePipelineDef);
        const base = Date.now();
        await seedInlineActionRow(db, 'r-inline', {
            id: 'ar-pre',
            node: 'precheck',
            kind: 'shell',
            durationMs: 400,
            createdAt: base + 1,
        });
        await seedInlineActionRow(db, 'r-inline', {
            id: 'ar-impl-agent',
            node: 'implement',
            kind: 'agent.run',
            durationMs: 500,
            createdAt: base + 2,
        });
        await seedInlineActionRow(db, 'r-inline', {
            id: 'ar-impl-shell',
            node: 'implement',
            kind: 'shell',
            durationMs: 50,
            createdAt: base + 3,
        });
        await seedInlineActionRow(db, 'r-inline', {
            id: 'ar-test',
            node: 'test',
            kind: 'shell',
            durationMs: 2500,
            createdAt: base + 4,
        });

        const projection = await projectWorkflowProgress('r-inline', { db, workflowDef: inlinePipelineDef });

        expect(projection.transitions).toEqual([]);
        // R2: currentState is the last recorded state, not the definition's initial state.
        expect(projection.currentState).toBe('test');
        // Row order first; a declared state with no recorded row stays pending, appended after.
        expect(stateShape(projection)).toEqual([
            'precheck@1:passed',
            'implement@1:passed',
            'test@1:running',
            'done@1:pending',
        ]);
        expect(attemptIds(projection, 'precheck')).toEqual(['ar-pre']);
        expect(attemptIds(projection, 'implement')).toEqual(['ar-impl-agent', 'ar-impl-shell']);
        expect(attemptIds(projection, 'test')).toEqual(['ar-test']);
        expect(projection.diagnostics).toEqual([]);
        db.close();
    });

    // 1085 R4 residual (review-finding 857e62b5): same-kind rows beyond the first match inside
    // one visit are retries — they must surface as attempts, not vanish claimed-but-unsurfaced.
    test('surfaces same-kind retry rows of a visited state as attempts in recorded order (1085 residual)', async () => {
        const db = await setupDb();
        await seedInlineRun(db, 'r-inline-retry', 'running', inlinePipelineDef);
        const base = Date.now();
        // precheck declares one shell action; three same-kind rows = first run plus two retries.
        await seedInlineActionRow(db, 'r-inline-retry', {
            id: 'ar-p1',
            node: 'precheck',
            kind: 'shell',
            durationMs: 100,
            createdAt: base + 1,
        });
        await seedInlineActionRow(db, 'r-inline-retry', {
            id: 'ar-p2',
            node: 'precheck',
            kind: 'shell',
            durationMs: 120,
            createdAt: base + 2,
        });
        await seedInlineActionRow(db, 'r-inline-retry', {
            id: 'ar-p3',
            node: 'precheck',
            kind: 'shell',
            durationMs: 90,
            createdAt: base + 3,
        });
        // implement declares agent.run + shell; a retried shell keeps the kinds apart.
        await seedInlineActionRow(db, 'r-inline-retry', {
            id: 'ar-i-agent',
            node: 'implement',
            kind: 'agent.run',
            durationMs: 500,
            createdAt: base + 4,
        });
        await seedInlineActionRow(db, 'r-inline-retry', {
            id: 'ar-i-sh1',
            node: 'implement',
            kind: 'shell',
            durationMs: 50,
            createdAt: base + 5,
        });
        await seedInlineActionRow(db, 'r-inline-retry', {
            id: 'ar-i-sh2',
            node: 'implement',
            kind: 'shell',
            durationMs: 60,
            createdAt: base + 6,
        });

        const projection = await projectWorkflowProgress('r-inline-retry', { db, workflowDef: inlinePipelineDef });

        // Every recorded row of a visited state is an attempt, in recorded order; none is
        // dropped and none needs a diagnostic.
        expect(attemptIds(projection, 'precheck')).toEqual(['ar-p1', 'ar-p2', 'ar-p3']);
        expect(attemptIds(projection, 'implement')).toEqual(['ar-i-agent', 'ar-i-sh1', 'ar-i-sh2']);
        expect(projection.diagnostics).toEqual([]);
        db.close();
    });

    test('leaves no state with recorded work pending on a terminal inline run (1085 R1/AC1)', async () => {
        const db = await setupDb();
        await seedInlineRun(db, 'r-inline-done', 'done', inlinePipelineDef);
        const base = Date.now();
        await seedInlineActionRow(db, 'r-inline-done', {
            id: 'ar-pre',
            node: 'precheck',
            kind: 'shell',
            durationMs: 400,
            createdAt: base + 1,
        });
        await seedInlineActionRow(db, 'r-inline-done', {
            id: 'ar-impl',
            node: 'implement',
            kind: 'agent.run',
            durationMs: 500,
            createdAt: base + 2,
        });
        await seedInlineActionRow(db, 'r-inline-done', {
            id: 'ar-test',
            node: 'test',
            kind: 'shell',
            durationMs: 2500,
            createdAt: base + 3,
        });
        await seedInlineActionRow(db, 'r-inline-done', {
            id: 'ar-done',
            node: 'done',
            kind: 'note',
            durationMs: 10,
            createdAt: base + 4,
        });

        const projection = await projectWorkflowProgress('r-inline-done', { db, workflowDef: inlinePipelineDef });

        expect(projection.status).toBe('completed');
        // Terminal runs carry no current state today (transition-less terminal shape kept).
        expect(projection.currentState).toBeNull();
        expect(projection.states.filter((state) => state.status === 'pending')).toEqual([]);
        expect(stateShape(projection)).toEqual([
            'precheck@1:passed',
            'implement@1:passed',
            'test@1:passed',
            'done@1:passed',
        ]);
        expect(attemptIds(projection, 'done')).toEqual(['ar-done']);
        expect(projection.diagnostics).toEqual([]);
        db.close();
    });

    test('gives a re-entered state one visit per contiguous row group, each with its own attempts (1085 R3)', async () => {
        const db = await setupDb();
        await seedInlineRun(db, 'r-inline-loop', 'running', inlinePipelineDef);
        const base = Date.now();
        await seedInlineActionRow(db, 'r-inline-loop', {
            id: 'ar-pre',
            node: 'precheck',
            kind: 'shell',
            durationMs: 400,
            createdAt: base + 1,
        });
        await seedInlineActionRow(db, 'r-inline-loop', {
            id: 'ar-i1-agent',
            node: 'implement',
            kind: 'agent.run',
            durationMs: 500,
            createdAt: base + 2,
        });
        await seedInlineActionRow(db, 'r-inline-loop', {
            id: 'ar-i1-shell',
            node: 'implement',
            kind: 'shell',
            durationMs: 50,
            createdAt: base + 3,
        });
        await seedInlineActionRow(db, 'r-inline-loop', {
            id: 'ar-test',
            node: 'test',
            kind: 'shell',
            durationMs: 2500,
            createdAt: base + 4,
        });
        await seedInlineActionRow(db, 'r-inline-loop', {
            id: 'ar-i2-agent',
            node: 'implement',
            kind: 'agent.run',
            durationMs: 700,
            createdAt: base + 5,
        });
        await seedInlineActionRow(db, 'r-inline-loop', {
            id: 'ar-i2-shell',
            node: 'implement',
            kind: 'shell',
            durationMs: 60,
            createdAt: base + 6,
        });

        const projection = await projectWorkflowProgress('r-inline-loop', { db, workflowDef: inlinePipelineDef });

        // Statuses are not pinned here: `isCurrent` compares state ids, so both visits of the current
        // state read with the current status — today's rule, unchanged by this task (1085 R5).
        expect(projection.states.map((state) => `${state.state}@${state.visit}`)).toEqual([
            'precheck@1',
            'implement@1',
            'test@1',
            'implement@2',
            'done@1',
        ]);
        expect(projection.currentState).toBe('implement');
        // Each visit owns the rows recorded for it — the second visit is not a replay of the first.
        expect(attemptIds(projection, 'implement', 1)).toEqual(['ar-i1-agent', 'ar-i1-shell']);
        expect(attemptIds(projection, 'implement', 2)).toEqual(['ar-i2-agent', 'ar-i2-shell']);
        expect(projection.diagnostics).toEqual([]);
        db.close();
    });

    test('diagnoses a row for a declared state the run did not visit (1085 R4)', async () => {
        const db = await setupDb();
        await seedInlineRun(db, 'r-unvisited', 'running', testWorkflowDef);
        const now = Date.now();
        const transitionDao = new TransitionRunDao(db);
        await transitionDao.open({ runId: 'r-unvisited', fromState: 'precheck', toState: 'done', status: 'completed' });
        await seedInlineActionRow(db, 'r-unvisited', {
            id: 'a1',
            node: 'precheck',
            kind: 'shell',
            durationMs: 100,
            createdAt: now + 1,
        });
        await seedInlineActionRow(db, 'r-unvisited', {
            id: 'a2',
            node: 'implement',
            kind: 'agent.run',
            durationMs: 500,
            createdAt: now + 2,
        });

        const projection = await projectWorkflowProgress('r-unvisited', { db, workflowDef: testWorkflowDef });

        // Implementation is declared but was never entered: its row is named, never silently consumed.
        expect(projection.diagnostics).toHaveLength(1);
        expect(projection.diagnostics[0]?.code).toBe('unvisited-state-row');
        expect(projection.diagnostics[0]?.message).toContain('a2');
        expect(projection.diagnostics[0]?.message).toContain('implement');
        expect(attemptIds(projection, 'implement')).toEqual([]);
        expect(attemptIds(projection, 'precheck')).toEqual(['a1']);
        db.close();
    });

    test('keeps transition history as the visit source for engine runs (1085 R5/R6)', async () => {
        const db = await setupDb();
        await seedInlineRun(db, 'r-engine', 'done', testWorkflowDef);
        const now = Date.now();
        const transitionDao = new TransitionRunDao(db);
        await transitionDao.open({
            runId: 'r-engine',
            fromState: 'precheck',
            toState: 'implement',
            status: 'completed',
        });
        await transitionDao.open({ runId: 'r-engine', fromState: 'implement', toState: 'done', status: 'completed' });
        // Row order deliberately disagrees with the transition order: rows must not drive visits.
        await seedInlineActionRow(db, 'r-engine', {
            id: 'a1',
            node: 'implement',
            kind: 'shell',
            durationMs: 50,
            createdAt: now + 1,
        });
        await seedInlineActionRow(db, 'r-engine', {
            id: 'a2',
            node: 'implement',
            kind: 'agent.run',
            durationMs: 500,
            createdAt: now + 2,
        });
        await seedInlineActionRow(db, 'r-engine', {
            id: 'a3',
            node: 'precheck',
            kind: 'shell',
            durationMs: 100,
            createdAt: now + 3,
        });

        const projection = await projectWorkflowProgress('r-engine', { db, workflowDef: testWorkflowDef });

        expect(projection.currentState).toBe('done');
        expect(stateShape(projection)).toEqual([
            'precheck@1:passed',
            'implement@1:passed',
            'done@1:passed',
            'failed@1:pending',
        ]);
        expect(projection.transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
            'precheck->implement',
            'implement->done',
        ]);
        expect(attemptIds(projection, 'precheck')).toEqual(['a3']);
        expect(attemptIds(projection, 'implement')).toEqual(['a2', 'a1']);
        expect(projection.diagnostics).toEqual([]);
        db.close();
    });
});
