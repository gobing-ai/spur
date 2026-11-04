import { describe, expect, spyOn, test } from 'bun:test';
import { applyCliMigrations, SystemEventDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { followWorkflowProgress, getLatestSystemEventSequence } from '../../src/workflow/progress-follow';

describe('followWorkflowProgress', () => {
    async function setupDb() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return adapter;
    }

    const testWorkflowDef: WorkflowDef = {
        kind: 'state-machine',
        name: 'test-stream-wf',
        initialState: 's1',
        terminalStates: ['done'],
        states: [{ id: 's1' }, { id: 'done' }],
        transitions: [{ from: 's1', to: 'done' }],
    };

    test('getLatestSystemEventSequence returns 0 when empty or max sequence', async () => {
        const db = await setupDb();
        expect(await getLatestSystemEventSequence(db)).toBe(0);

        const dao = new SystemEventDao(db);
        await dao.insert({
            id: 'evt-1',
            event_name: 'test.event',
            occurred_at: new Date().toISOString(),
            sequence: 42,
        });

        expect(await getLatestSystemEventSequence(db)).toBe(42);
        db.close();
    });

    test('yields initial completed projection immediately without waiting for events', async () => {
        const db = await setupDb();
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-done', 'test-stream-wf', 'done', '2026-08-19T00:00:00Z', '{}', ?, ?)",
            now,
            now,
        );

        const projections = [];
        for await (const proj of followWorkflowProgress('r-done', { db, workflowDef: testWorkflowDef })) {
            projections.push(proj);
        }

        expect(projections.length).toBe(1);
        expect(projections[0]?.status).toBe('completed');
        db.close();
    });

    test('yields updated projection on system event wakeups and terminates upon completion', async () => {
        const db = await setupDb();
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-live', 'test-stream-wf', 'running', '2026-08-19T00:00:00Z', '{}', ?, ?)",
            now,
            now,
        );

        const dao = new SystemEventDao(db);
        const projections = [];

        // Spawn async updates: an unrelated event, then a payload-matched event
        setTimeout(async () => {
            await dao.insert({
                id: 'evt-unrelated',
                event_name: 'other.event',
                run_id: 'other-run',
                occurred_at: new Date().toISOString(),
            });
            await db.run("UPDATE runs SET status = 'done' WHERE id = 'r-live'");
            await dao.insert({
                id: 'evt-live-1',
                event_name: 'workflow.completed',
                run_id: null,
                payload_json: JSON.stringify({ runId: 'r-live' }),
                occurred_at: new Date().toISOString(),
            });
        }, 150);

        for await (const proj of followWorkflowProgress('r-live', {
            db,
            workflowDef: testWorkflowDef,
            timeoutMs: 3000,
        })) {
            projections.push(proj);
        }

        expect(projections.length).toBeGreaterThanOrEqual(2);
        expect(projections[0]?.status).toBe('running');
        expect(projections[projections.length - 1]?.status).toBe('completed');
        db.close();
    });

    test('supports db as async factory and abort signal', async () => {
        const db = await setupDb();
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('r-abort', 'test-stream-wf', 'running', '2026-08-19T00:00:00Z', '{}', ?, ?)",
            now,
            now,
        );

        const controller = new AbortController();
        const projections = [];

        // Abort after 50ms to trigger event listener
        setTimeout(() => {
            controller.abort();
        }, 80);

        for await (const proj of followWorkflowProgress('r-abort', {
            db: async () => db,
            workflowDef: testWorkflowDef,
            signal: controller.signal,
            pollIntervalMs: 50,
        })) {
            projections.push(proj);
        }

        expect(projections.length).toBe(1);
        expect(projections[0]?.status).toBe('running');

        // Test immediate termination on failed and cancelled run status
        await db.run("UPDATE runs SET status = 'failed' WHERE id = 'r-abort'");
        const failedProjections = [];
        for await (const proj of followWorkflowProgress('r-abort', { db, workflowDef: testWorkflowDef })) {
            failedProjections.push(proj);
        }
        expect(failedProjections.length).toBe(1);
        expect(failedProjections[0]?.status).toBe('failed');

        await db.run("UPDATE runs SET status = 'cancelled' WHERE id = 'r-abort'");
        const cancelledProjections = [];
        for await (const proj of followWorkflowProgress('r-abort', { db, workflowDef: testWorkflowDef })) {
            cancelledProjections.push(proj);
        }
        expect(cancelledProjections.length).toBe(1);
        expect(cancelledProjections[0]?.status).toBe('cancelled');

        // Test timeoutMs expiration
        await db.run("UPDATE runs SET status = 'running' WHERE id = 'r-abort'");
        const timeoutProjections = [];
        for await (const proj of followWorkflowProgress('r-abort', {
            db,
            workflowDef: testWorkflowDef,
            timeoutMs: 25,
            pollIntervalMs: 10,
        })) {
            timeoutProjections.push(proj);
        }
        expect(timeoutProjections.length).toBe(1);

        // Test pre-aborted signal
        const preAborted = new AbortController();
        preAborted.abort();
        const preAbortedProjections = [];
        for await (const proj of followWorkflowProgress('r-abort', {
            db,
            workflowDef: testWorkflowDef,
            signal: preAborted.signal,
        })) {
            preAbortedProjections.push(proj);
        }
        expect(preAbortedProjections.length).toBe(1);

        db.close();
    });

    test('completion and consumer return clear the deadline and detach the external abort listener (1272)', async () => {
        const db = await setupDb();
        const timers = spyOn(globalThis, 'setTimeout');
        const clears = spyOn(globalThis, 'clearTimeout');
        try {
            for (const completed of [true, false]) {
                const id = `cleanup-${completed}`;
                await db.run(
                    "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES (?, 'test-stream-wf', 'running', '2026-08-19T00:00:00Z', '{}', 1, 1)",
                    id,
                );
                const controller = new AbortController();
                const add = spyOn(controller.signal, 'addEventListener');
                const remove = spyOn(controller.signal, 'removeEventListener');
                try {
                    const stream = followWorkflowProgress(id, {
                        db,
                        workflowDef: testWorkflowDef,
                        signal: controller.signal,
                        timeoutMs: 12345,
                    });
                    await stream.next();
                    if (completed) await db.run("UPDATE runs SET status = 'done' WHERE id = ?", id);
                    await new SystemEventDao(db).insert({
                        id: `event-${id}`,
                        event_name: 'workflow.completed',
                        run_id: id,
                        occurred_at: new Date().toISOString(),
                    });
                    await stream.next();
                    if (completed) expect((await stream.next()).done).toBe(true);
                    else await stream.return(undefined);
                    const timerIndex = timers.mock.calls.findLastIndex((call) => call[1] === 12345);
                    expect(timerIndex).toBeGreaterThanOrEqual(0);
                    expect(clears).toHaveBeenCalledWith(timers.mock.results[timerIndex]?.value);
                    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
                } finally {
                    add.mockRestore();
                    remove.mockRestore();
                }
            }
        } finally {
            timers.mockRestore();
            clears.mockRestore();
            db.close();
        }
    });

    test('honors the custom event polling cadence (1272)', async () => {
        const db = await setupDb();
        const timers = spyOn(globalThis, 'setTimeout');
        try {
            await db.run(
                "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('custom-poll', 'test-stream-wf', 'running', '2026-08-19T00:00:00Z', '{}', 1, 1)",
            );
            const controller = new AbortController();
            const abort = setTimeout(() => controller.abort(), 5);
            try {
                for await (const _projection of followWorkflowProgress('custom-poll', {
                    db,
                    workflowDef: testWorkflowDef,
                    signal: controller.signal,
                    pollIntervalMs: 37,
                })) {
                    // The empty ledger must poll before observing cancellation.
                }
                expect(timers.mock.calls.some((call) => call[1] === 37)).toBe(true);
            } finally {
                clearTimeout(abort);
            }
        } finally {
            timers.mockRestore();
            db.close();
        }
    });

    test('deadline and external abort interrupt a poll much longer than their budget (1272)', async () => {
        const db = await setupDb();
        try {
            await db.run(
                "INSERT INTO runs (id, workflow_name, status, started_at, metadata_json, created_at, updated_at) VALUES ('long-poll', 'test-stream-wf', 'running', '2026-08-19T00:00:00Z', '{}', 1, 1)",
            );
            for (const external of [false, true]) {
                const controller = new AbortController();
                const stream = followWorkflowProgress('long-poll', {
                    db,
                    workflowDef: testWorkflowDef,
                    signal: controller.signal,
                    pollIntervalMs: 60_000,
                    ...(external ? {} : { timeoutMs: 10 }),
                });
                await stream.next();
                const started = Date.now();
                const abort = external ? setTimeout(() => controller.abort(), 10) : undefined;
                try {
                    expect((await stream.next()).done).toBe(true);
                    expect(Date.now() - started).toBeLessThan(1000);
                } finally {
                    if (abort !== undefined) clearTimeout(abort);
                    controller.abort();
                    await stream.return(undefined);
                }
            }
        } finally {
            db.close();
        }
    });
});
