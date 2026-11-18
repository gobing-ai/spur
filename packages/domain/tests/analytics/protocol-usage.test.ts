import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { protocolUsageSummary } from '../../src/analytics/protocol-usage';
import { applyCliMigrations, SystemEventDao } from '../../src/index';

/**
 * Task 1398 — protocol usage across the MCP / A2A / auth surfaces (feature I61).
 *
 * Rows are the v2 envelopes the 1376/1377 emitters persist, seeded through `SystemEventDao`, so
 * the assertions cover the real reader/writer payload shape (`$.data.*`) rather than a fixture.
 */

function envelope(data: Record<string, unknown>): string {
    return JSON.stringify({ schemaVersion: 2, data, context: {}, presentation: {} });
}

async function setupDb(): Promise<DbAdapter> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    return adapter;
}

async function emit(
    db: DbAdapter,
    id: string,
    name: string,
    at: string,
    data: Record<string, unknown>,
    actor: string | null = null,
): Promise<void> {
    await new SystemEventDao(db).insert({
        id,
        event_name: name,
        occurred_at: at,
        actor,
        payload_json: envelope(data),
        run_id: null,
        entity_kind: null,
        entity_id: null,
        sequence: null,
    });
}

const T0 = '2026-11-17T10:00:00.000Z';
const T1 = '2026-11-17T10:05:00.000Z';
const T2 = '2026-11-17T10:10:00.000Z';
const T3 = '2026-11-17T10:15:00.000Z';
const OUTSIDE = '2026-11-16T10:00:00.000Z';

describe('protocolUsageSummary (1398 R1/R2)', () => {
    test('folds tool calls, failures and nearest-rank percentiles', async () => {
        const db = await setupDb();
        try {
            // task_show: two successes (10ms, 30ms) and one failure with no duration.
            await emit(db, 's1', 'mcp.tool.called', T0, { tool: 'task_show', durationMs: 10, outcome: 'ok' });
            await emit(db, 's2', 'mcp.tool.called', T1, { tool: 'task_show', durationMs: 30, outcome: 'ok' });
            await emit(db, 's3', 'mcp.tool.failed', T2, { tool: 'task_show', errorCode: 'invalid_arguments' });
            // backlog_list: one success outside the window — must not be counted.
            await emit(db, 's4', 'mcp.tool.called', OUTSIDE, { tool: 'backlog_list', durationMs: 99, outcome: 'ok' });

            const usage = await protocolUsageSummary(db, { since: '2026-11-17T00:00:00.000Z', until: T3 });
            const taskShow = usage.tools.find((tool) => tool.tool === 'task_show');
            if (taskShow === undefined) throw new Error('expected a task_show row');
            expect(taskShow.calls).toBe(2);
            expect(taskShow.failures).toBe(1);
            expect(taskShow.failureRate).toBeCloseTo(1 / 3, 5);
            // Nearest-rank over [10, 30]: p50 → 10, p95 → 30.
            expect(taskShow.p50Ms).toBe(10);
            expect(taskShow.p95Ms).toBe(30);
            expect(taskShow.durationUnmeasured).toBe(1);
            expect(usage.tools.some((tool) => tool.tool === 'backlog_list')).toBe(false);
        } finally {
            await db.close();
        }
    });

    test('counts resources, actors (null → unknown), a2a outcomes and auth denials', async () => {
        const db = await setupDb();
        try {
            await emit(db, 'r1', 'mcp.resource.read', T0, { uri: 'spur://tasks/1', durationMs: 2, outcome: 'ok' });
            await emit(db, 'r2', 'mcp.resource.read', T1, {
                uri: 'spur://tasks/1',
                outcome: 'error',
                errorCode: 'resource_error',
            });
            await emit(db, 'r3', 'mcp.resource.read', T2, { uri: 'spur://context/x', durationMs: 5, outcome: 'ok' });
            await emit(db, 'a1', 'mcp.tool.called', T0, { tool: 't', durationMs: 1, outcome: 'ok' }, 'agent-a');
            await emit(db, 'a2', 'mcp.tool.failed', T1, { tool: 't', errorCode: 'tool_error' });
            await emit(db, 'x1', 'a2a.message.received', T0, { member: 'coder', messageId: 'm1', outcome: 'accepted' });
            await emit(db, 'x2', 'a2a.message.received', T1, { member: 'coder', messageId: 'm1', outcome: 'replayed' });
            await emit(db, 'x3', 'a2a.message.received', T2, { member: 'coder', messageId: 'm2', outcome: 'conflict' });
            await emit(db, 'x4', 'a2a.task.cancelled', T2, { member: 'coder', taskId: 'msg_1', runStopped: true });
            await emit(db, 'd1', 'auth.denied', T0, { surface: 'mcp', reason: 'missing', path: '/mcp' });
            await emit(db, 'd2', 'auth.denied', T1, { surface: 'a2a', reason: 'mismatch', path: '/a2a/x' });

            const usage = await protocolUsageSummary(db, { since: '2026-11-17T00:00:00.000Z', until: T3 });

            const shared = usage.resources.find((resource) => resource.uri === 'spur://tasks/1');
            expect(shared).toEqual({ uri: 'spur://tasks/1', reads: 2, failures: 1 });

            // `calls` = successful calls, `failures` = failed calls — the same split as `tools[]`.
            expect(usage.byActor).toEqual([
                { actor: 'agent-a', calls: 1, failures: 0 },
                { actor: 'unknown', calls: 0, failures: 1 },
            ]);

            expect(usage.a2a).toEqual([{ member: 'coder', received: 1, replayed: 1, conflict: 1, cancelled: 1 }]);

            expect(usage.authDenied).toEqual([
                { surface: 'a2a', reason: 'mismatch', count: 1 },
                { surface: 'mcp', reason: 'missing', count: 1 },
            ]);
        } finally {
            await db.close();
        }
    });

    test('several tools and members sort by volume then name (stable output)', async () => {
        const db = await setupDb();
        try {
            await emit(db, 'o1', 'mcp.tool.called', T0, { tool: 'zeta', durationMs: 5, outcome: 'ok' });
            await emit(db, 'o2', 'mcp.tool.called', T1, { tool: 'alpha', durationMs: 7, outcome: 'ok' });
            await emit(db, 'o3', 'mcp.tool.called', T2, { tool: 'alpha', durationMs: 9, outcome: 'ok' });
            await emit(db, 'o4', 'a2a.message.received', T0, { member: 'zeta', messageId: 'm1', outcome: 'accepted' });
            await emit(db, 'o5', 'a2a.message.received', T1, { member: 'alpha', messageId: 'm2', outcome: 'accepted' });
            await emit(db, 'o6', 'auth.denied', T0, { surface: 'mcp', reason: 'missing', path: '/mcp' });
            await emit(db, 'o7', 'auth.denied', T1, { surface: 'mcp', reason: 'unset', path: '/mcp' });

            const usage = await protocolUsageSummary(db, { since: '2026-11-17T00:00:00.000Z', until: T3 });
            // Busiest first; a tie breaks on the name so the same window always renders the same order.
            expect(usage.tools.map((tool) => tool.tool)).toEqual(['alpha', 'zeta']);
            expect(usage.a2a.map((member) => member.member)).toEqual(['alpha', 'zeta']);
            expect(usage.authDenied.map((denial) => denial.reason)).toEqual(['missing', 'unset']);
        } finally {
            await db.close();
        }
    });

    test('an unreadable plane reads as empty arrays instead of throwing', async () => {
        // The ledger is best-effort on the trace path: a missing/broken plane must not fail the report.
        const broken = {
            queryAll: async () => {
                throw new Error('no such table: system_events');
            },
        } as unknown as DbAdapter;
        const usage = await protocolUsageSummary(broken, { since: '2026-11-17T00:00:00.000Z', until: T3 });
        expect(usage).toEqual({ tools: [], resources: [], byActor: [], a2a: [], authDenied: [] });
    });

    test('an empty window reads as empty arrays, never fabricated zeros', async () => {
        const db = await setupDb();
        try {
            const usage = await protocolUsageSummary(db, { since: '2026-11-17T00:00:00.000Z', until: T3 });
            expect(usage).toEqual({ tools: [], resources: [], byActor: [], a2a: [], authDenied: [] });
        } finally {
            await db.close();
        }
    });
});
