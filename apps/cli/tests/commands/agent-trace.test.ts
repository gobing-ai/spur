/**
 * Task 1076 R4 — `spur agent trace` as the operator surface for the execution record. The CLI is a
 * thin transport over `AgentTraceService` (ADR-130), so these tests drive the real command through
 * `main()` with a seeded lineage and assert the three output modes.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationRunDao, createMigratedDb } from '@gobing-ai/spur-domain';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';

function captureOutput(): { output: CommandOutput; messages: string[]; errors: string[] } {
    const messages: string[] = [];
    const errors: string[] = [];
    return { output: { write: (m) => messages.push(m), error: (m) => errors.push(m) }, messages, errors };
}

/** A project with one dispatch → turn lineage, the turn's stream, and both runs terminal. */
async function seededProject(): Promise<{ cwd: string; db: Awaited<ReturnType<typeof createMigratedDb>> }> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-agent-trace-'));
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
    await dao.insertStart({
        specId: 'proj-coder',
        agentKind: 'pi',
        processId: null,
        runId: 'turn-1',
        generation: 1,
        startedAt: '2026-10-04T00:00:01.000Z',
        parentRunId: 'dispatch-1',
    });
    await dao.updateExit('turn-1', 'exited', '2026-10-04T00:00:02.000Z', '[]', {
        messageIds: [],
        outcome: 'run-exit-only',
    });
    await mkdir(join(cwd, '.spur', 'memory', 'runs'), { recursive: true });
    await writeFile(join(cwd, '.spur', 'memory', 'runs', 'turn-1.md'), '[2026-10-04T00:00:01.000Z] stdout| built\n');
    return { cwd, db };
}

describe('spur agent trace (1076 R4)', () => {
    test('prints the lineage from any id in the chain, human-readable', async () => {
        const { cwd, db } = await seededProject();
        const { output, messages } = captureOutput();
        try {
            // Starting from the CHILD must still show the dispatch that caused it.
            expect(await main(['agent', 'trace', 'turn-1'], { cwd, output, db })).toBe(0);
            const text = messages.join('\n');
            expect(text).toContain('dispatch-1');
            expect(text).toContain('turn-1');
            expect(text).toContain('turn-1.md');
            expect(text).toContain('parent=dispatch-1');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('--json emits the machine contract', async () => {
        const { cwd, db } = await seededProject();
        const { output, messages } = captureOutput();
        try {
            expect(await main(['agent', 'trace', 'turn-1', '--json'], { cwd, output, db })).toBe(0);
            // The JSON is pretty-printed across lines, so parse the whole buffer.
            const parsed = JSON.parse(messages.join('\n').trim() || '{}') as {
                rootRunId?: string;
                nodes?: Array<{ runId: string; logPath: string | null }>;
            };
            expect(parsed.rootRunId).toBe('dispatch-1');
            expect(parsed.nodes?.map((node) => node.runId)).toEqual(['dispatch-1', 'turn-1']);
            expect(parsed.nodes?.[1]?.logPath).toContain('turn-1.md');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });

    test('--follow exits 1 with one checkpoint line when the lineage is still live', async () => {
        const { cwd, db } = await seededProject();
        const { output, messages, errors } = captureOutput();
        try {
            // A running child keeps the lineage non-terminal, so the (1ms) budget expires.
            await new CoordinationRunDao(db).insertStart({
                specId: 'proj-coder',
                agentKind: 'pi',
                processId: null,
                runId: 'turn-live',
                generation: 2,
                startedAt: '2026-10-04T00:00:03.000Z',
                parentRunId: 'dispatch-1',
            });
            const code = await main(['agent', 'trace', 'dispatch-1', '--follow', '--timeout', '1'], {
                cwd,
                output,
                db,
            });
            expect(code).toBe(1);
            expect(errors.join('\n')).toContain('checkpoint');
            expect(messages.join('\n')).toContain('turn-live');
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });
});
