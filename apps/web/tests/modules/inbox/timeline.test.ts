import { describe, expect, test } from 'bun:test';
import type { Frame } from '../../../src/lib/process-stream';
import type { MsgRow } from '../../../src/modules/inbox/AllTab';
import { mergeTimeline, type TimelineEntry } from '../../../src/modules/inbox/timeline';

function msg(over: Partial<MsgRow> & { id: string }): MsgRow {
    return {
        fromId: null,
        toId: 'agent-a',
        body: 'hi',
        status: 'sent',
        createdAt: '2026-01-01T00:00:00.000Z',
        inReplyTo: null,
        hasReply: false,
        replyCount: 0,
        to: { agentId: 'agent-a' },
        ...over,
    };
}

function frame(over: Partial<Frame> & { seq: number; ts: string }): Frame {
    return { stream: 'stdout', line: 'line', ...over };
}

function kinds(entries: TimelineEntry[]): TimelineEntry['kind'][] {
    return entries.map((e) => e.kind);
}

describe('mergeTimeline', () => {
    test('interleaves messages and frames ordered by ascending timestamp', () => {
        const messages = [
            msg({ id: 'm1', createdAt: '2026-01-01T00:00:01Z', toId: 'agent-a', fromId: null }),
            msg({ id: 'm2', createdAt: '2026-01-01T00:00:03Z', toId: 'agent-a', fromId: null }),
        ];
        const frames = [frame({ seq: 1, ts: '2026-01-01T00:00:02Z' })];
        const entries = mergeTimeline(messages, frames, 'agent-a');
        const ts = entries.map((e) => e.ts);
        expect(ts).toEqual([
            '2026-01-01T00:00:01Z',
            '2026-01-01T00:00:02Z',
            '2026-01-01T00:00:02Z',
            '2026-01-01T00:00:03Z',
        ]);
    });

    test('ties put messages before frames (R5 ordering)', () => {
        const messages = [msg({ id: 'm1', createdAt: '2026-01-01T00:00:00Z' })];
        const frames = [frame({ seq: 1, ts: '2026-01-01T00:00:00Z' })];
        const entries = mergeTimeline(messages, frames, 'agent-a');
        // boundary + message + frame at the same ts → message before frame.
        const body = entries.map((e) => e.kind);
        expect(body).toEqual(['message', 'boundary', 'frame']);
    });

    test('frames at the same ts are ordered by seq', () => {
        const frames = [frame({ seq: 2, ts: '2026-01-01T00:00:00Z' }), frame({ seq: 1, ts: '2026-01-01T00:00:00Z' })];
        const entries = mergeTimeline([], frames, 'agent-a');
        const frameSeqs = entries.filter((e) => e.kind === 'frame').map((e) => (e as { frame: Frame }).frame.seq);
        expect(frameSeqs).toEqual([1, 2]);
    });

    test('message direction: inbound when toId === agentId, outbound when fromId === agentId (R5)', () => {
        const inbound = msg({ id: 'in', toId: 'agent-a', fromId: 'other' });
        const outbound = msg({ id: 'out', toId: 'other', fromId: 'agent-a' });
        const entries = mergeTimeline([outbound, inbound], [], 'agent-a');
        const dirs = entries
            .filter((e) => e.kind === 'message')
            .map((e) => (e as { kind: 'message'; direction: 'in' | 'out' }).direction);
        expect(dirs.sort()).toEqual(['in', 'out']);
    });

    test('frames are always inbound (agent talking back) (R5)', () => {
        const entries = mergeTimeline([], [frame({ seq: 1, ts: '2026-01-01T00:00:00Z' })], 'agent-a');
        const f = entries.find((e) => e.kind === 'frame') as { kind: 'frame'; direction: 'in' };
        expect(f.direction).toBe('in');
    });

    test('meta frames are excluded from the timeline (R5)', () => {
        const meta = frame({ seq: 1, ts: '2026-01-01T00:00:00Z' });
        meta.stream = 'meta';
        const entries = mergeTimeline([], [meta], 'agent-a');
        expect(entries.filter((e) => e.kind === 'frame')).toHaveLength(0);
    });

    test('renders a boundary at the oldest frame; messages older than it survive (R6)', () => {
        const older = msg({ id: 'older', createdAt: '2026-01-01T00:00:00Z' });
        const frameAt = frame({ seq: 1, ts: '2026-01-01T00:00:05Z' });
        const newer = msg({ id: 'newer', createdAt: '2026-01-01T00:00:06Z' });
        const entries = mergeTimeline([newer, older], [frameAt], 'agent-a');
        // boundary ts equals the oldest frame ts.
        const boundary = entries.find((e) => e.kind === 'boundary') as { kind: 'boundary'; ts: string };
        expect(boundary.ts).toBe('2026-01-01T00:00:05Z');
        // Older message still present before the boundary.
        const olderEntry = entries.find((e) => e.kind === 'message' && (e as { row: MsgRow }).row.id === 'older');
        expect(olderEntry).toBeDefined();
        // boundary sits immediately before the frame.
        const idx = entries.indexOf(boundary);
        expect(entries[idx + 1]?.kind).toBe('frame');
    });

    test('no frames → message-only timeline with no boundary (R6)', () => {
        const entries = mergeTimeline([msg({ id: 'm1' })], [], 'agent-a');
        expect(kinds(entries)).toEqual(['message']);
        expect(entries.some((e) => e.kind === 'boundary')).toBe(false);
    });
});
