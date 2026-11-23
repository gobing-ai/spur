/**
 * 1440 R3 — the exact-run lineage the Trace tab opens from a receipt's Run link.
 *
 * The failure modes: a response that keeps the trace layer's internal fields (log paths, session
 * ids), a malformed node rendered as a run, and an absent `parentRunId` invented as a string.
 */
import { describe, expect, test } from 'bun:test';
import { parseAgentTrace } from '../../../src/modules/observability/TraceTab';

const ROOT = '11111111-1111-4111-8111-111111111111';
const CHILD = '22222222-2222-4222-8222-222222222222';

describe('1440 — parseAgentTrace', () => {
    test('keeps identity and shape, and drops every internal field', () => {
        const parsed = parseAgentTrace({
            rootRunId: ROOT,
            requestedRunId: CHILD,
            nodes: [
                {
                    runId: ROOT,
                    kind: 'workflow',
                    status: 'done',
                    parentRunId: null,
                    logPath: '/tmp/x.log',
                    sessionIds: ['s1'],
                },
                { runId: CHILD, kind: 'agent', status: 'exited', parentRunId: ROOT, logPath: null },
            ],
        });
        expect(parsed?.rootRunId).toBe(ROOT);
        expect(parsed?.nodes).toEqual([
            { runId: ROOT, kind: 'workflow', status: 'done', parentRunId: null },
            { runId: CHILD, kind: 'agent', status: 'exited', parentRunId: ROOT },
        ]);
        expect(JSON.stringify(parsed)).not.toContain('logPath');
        expect(JSON.stringify(parsed)).not.toContain('sessionIds');
    });

    test('a malformed node is skipped and a malformed body yields null', () => {
        expect(
            parseAgentTrace({
                rootRunId: ROOT,
                nodes: [
                    { runId: ROOT, kind: 'workflow', status: 'done' },
                    { runId: 42, kind: 'agent', status: 'x' },
                ],
            })?.nodes,
        ).toHaveLength(1);
        expect(parseAgentTrace({ nodes: [] })).toBeNull();
        expect(parseAgentTrace(null)).toBeNull();
    });
});
