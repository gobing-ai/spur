/**
 * Task 1076 — the ADR-132 execution record: the durable per-run stream (`AgentRunLog`),
 * the lineage edge on `coordination_runs`, and the trace reader that joins them.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationRunDao, createMigratedDb, RunSessionDao } from '@gobing-ai/spur-domain';
import { AgentTraceService } from '../../src/services/agent-trace-service';

const tempDirs: string[] = [];
function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'agent-run-log-'));
    tempDirs.push(dir);
    return dir;
}
function cleanup(): void {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

describe('coordination_runs lineage (1076 R3)', () => {
    test('parentRunId round-trips and listByParentRunId returns the children oldest-first', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const dao = new CoordinationRunDao(db);
        await dao.insertStart({
            specId: 'proj-coder',
            agentKind: 'pi',
            processId: null,
            runId: 'root-run',
            generation: 1,
            startedAt: '2026-10-04T00:00:00.000Z',
        });
        for (const [i, startedAt] of ['2026-10-04T00:00:02.000Z', '2026-10-04T00:00:01.000Z'].entries()) {
            await dao.insertStart({
                specId: 'proj-coder',
                agentKind: 'pi',
                processId: null,
                runId: `child-${i}`,
                generation: 2 + i,
                startedAt,
                parentRunId: 'root-run',
            });
        }
        const root = await dao.getByRunId('root-run');
        expect(root?.parent_run_id).toBeNull();
        const children = await dao.listByParentRunId('root-run');
        expect(children.map((row) => row.run_id)).toEqual(['child-1', 'child-0']); // by started_at
        expect((await dao.getByRunId('child-0'))?.parent_run_id).toBe('root-run');
        await db.close();
    });
});

describe('AgentTraceService (1076 R4)', () => {
    async function seeded() {
        const dir = tempDir();
        const db = await createMigratedDb({ url: ':memory:' });
        const dao = new CoordinationRunDao(db);
        await dao.insertStart({
            specId: 'proj-lead',
            agentKind: 'grok',
            processId: null,
            runId: 'dispatch-1',
            generation: 1,
            startedAt: '2026-10-04T00:00:00.000Z',
        });
        await dao.updateExit('dispatch-1', 'exited', '2026-10-04T00:00:05.000Z', '[]', {
            messageIds: [],
            outcome: 'run-exit-only',
        });
        await dao.insertStart({
            specId: 'proj-coder',
            agentKind: 'pi',
            processId: null,
            runId: 'turn-1',
            generation: 1,
            startedAt: '2026-10-04T00:00:01.000Z',
            parentRunId: 'dispatch-1',
        });
        await dao.updateExit('turn-1', 'exited', '2026-10-04T00:00:04.000Z', '[]', {
            messageIds: [],
            outcome: 'run-exit-only',
        });
        await new RunSessionDao(db).insert({
            runId: 'turn-1',
            source: 'pi',
            sessionId: 'sess-abc',
            exactness: 'exact',
            mechanism: 'observed',
            resolvedAt: '2026-10-04T00:00:04.000Z',
        });
        // The turn's durable stream (the record a restart must not lose).
        writeFileSync(join(dir, 'turn-1.md'), '[2026-10-04T00:00:02.000Z] stdout| built the thing\n');
        const service = new AgentTraceService({ projectPath: dir, openDb: async () => db, logDir: dir });
        return { dir, db, service };
    }

    test('traces from the ROOT down: dispatch → turn, with sessions and the stream', async () => {
        const { db, service, dir } = await seeded();
        try {
            const tree = await service.trace('dispatch-1');
            expect(tree.rootRunId).toBe('dispatch-1');
            expect(tree.nodes.map((n) => [n.runId, n.kind, n.status, n.parentRunId])).toEqual([
                ['dispatch-1', 'agent', 'exited', null],
                ['turn-1', 'agent', 'exited', 'dispatch-1'],
            ]);
            const turn = tree.nodes[1];
            expect(turn?.sessionIds).toEqual(['sess-abc']);
            expect(turn?.logPath).toBe(join(dir, 'turn-1.md'));
            expect(readFileSync(turn?.logPath ?? '', 'utf8')).toContain('built the thing');
        } finally {
            cleanup();
            await db.close();
        }
    });

    test('traces from a CHILD id — the root is resolved by walking the parent edge up', async () => {
        const { db, service } = await seeded();
        try {
            const tree = await service.trace('turn-1');
            expect(tree.rootRunId).toBe('dispatch-1');
            expect(tree.nodes.map((n) => n.runId)).toEqual(['dispatch-1', 'turn-1']);
        } finally {
            cleanup();
            await db.close();
        }
    });

    test('an unknown run is a single unknown node, never a throw', async () => {
        const { db, service } = await seeded();
        try {
            const tree = await service.trace('nope');
            expect(tree.nodes).toEqual([
                {
                    runId: 'nope',
                    kind: 'workflow',
                    status: 'unknown',
                    parentRunId: null,
                    sessionIds: [],
                    logPath: null,
                },
            ]);
        } finally {
            cleanup();
            await db.close();
        }
    });

    test('follow returns immediately when every node is terminal, and times out on a live one', async () => {
        const { db, service } = await seeded();
        try {
            const done = await service.follow('dispatch-1', { timeoutMs: 1000, sleep: async () => {} });
            expect(done.timedOut).toBe(false);
            expect(done.tree.nodes).toHaveLength(2);
            // A running child keeps the lineage live: the follow budget is honoured, not ignored.
            await new CoordinationRunDao(db).insertStart({
                specId: 'proj-coder',
                agentKind: 'pi',
                processId: null,
                runId: 'turn-live',
                generation: 9,
                startedAt: '2026-10-04T00:00:06.000Z',
                parentRunId: 'dispatch-1',
            });
            let clock = 0;
            const timedOut = await service.follow('dispatch-1', {
                timeoutMs: 1000,
                now: () => (clock += 600),
                sleep: async () => {},
            });
            expect(timedOut.timedOut).toBe(true);
            expect(timedOut.tree.nodes.map((n) => n.runId)).toContain('turn-live');
        } finally {
            cleanup();
            await db.close();
        }
    });
});
