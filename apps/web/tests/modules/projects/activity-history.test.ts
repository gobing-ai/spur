import { describe, expect, test } from 'bun:test';
import {
    type ActivityRow,
    historyUrl,
    MAX_ACTIVITY_ROWS,
    parseHistory,
    toRow,
} from '../../../src/modules/projects/activity-history';

/** Moved here by task 0849 (G64): the Teams Activity tab shell was retired, and the
 * history fetch/parse helpers survive because Projects' MemberDetail consumes them. */

describe('toRow (0254 R7, 0269 R9/P4)', () => {
    test('maps a process payload teamId/agentId/agentType (0269 P4 residual)', () => {
        const row = toRow({
            id: 'e1',
            eventName: 'process.spawned',
            occurredAt: '2026-07-16T00:00:00.000Z',
            actor: null,
            payload: { agentId: 'alpha-planner', teamId: 'alpha', agentType: 'claude', pid: 9 },
        });
        expect(row).not.toBeNull();
        expect(row?.actor).toBe('alpha-planner');
        expect(row?.teamId).toBe('alpha');
        expect(row?.memberLabel).toBe('alpha-planner');
        expect(row?.agentType).toBe('claude');
    });

    test('rejects malformed events and out-of-scope telemetry without crashing', () => {
        for (const bad of [
            null,
            'not-an-object',
            42,
            { id: 123, eventName: 'team.member.started' }, // no occurredAt
            { id: 'x', occurredAt: 't' }, // no eventName
            { id: 'x', eventName: 'queue.completed', occurredAt: 't' }, // out of scope
        ]) {
            expect(toRow(bad)).toBeNull();
        }
        expect(
            toRow({ id: 'good', eventName: 'agent.started', occurredAt: '2026-07-20T10:00:00Z', actor: 'planner' }),
        ).toEqual({
            id: 'good',
            eventName: 'agent.started',
            occurredAt: '2026-07-20T10:00:00Z',
            actor: 'planner',
        });
    });
});

describe('parseHistory', () => {
    test('keeps well-formed rows from a mixed events array and drops the rest', () => {
        const rows = parseHistory({
            events: [
                null,
                'not-an-object',
                { id: 123, eventName: 'team.member.started' },
                { id: 'good', eventName: 'agent.started', occurredAt: '2026-07-20T10:00:00Z', actor: 'planner' },
            ],
        });
        expect(rows).toHaveLength(1);
        expect(rows?.[0]?.id).toBe('good');
    });

    test('returns null when the envelope itself is the wrong shape', () => {
        expect(parseHistory(null)).toBeNull();
        expect(parseHistory({})).toBeNull();
        expect(parseHistory({ events: 'nope' })).toBeNull();
    });
});

describe('historyUrl', () => {
    test('caps the fetch at MAX_ACTIVITY_ROWS', () => {
        expect(historyUrl()).toContain('/events/history?limit=100');
        expect(historyUrl()).toContain(`limit=${MAX_ACTIVITY_ROWS}`);
    });
});

/** Compile-time guard: the exported row shape stays usable by MemberDetail's filter. */
const _shapeCheck: ActivityRow['eventName'] = 'agent.started';
void _shapeCheck;
