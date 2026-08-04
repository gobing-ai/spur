import type { Frame } from '../../lib/process-stream';
import type { MsgRow } from './AllTab';

/**
 * One row of the unified per-agent timeline (0422 R5/R6).
 *
 * A discriminated union so the renderer branches on `kind` and never on the
 * presence of optional fields. `boundary` marks the oldest available process
 * frame: the ring buffer is bounded and ephemeral while messages are durable,
 * so rows older than the boundary are messages only (R6).
 */
export type TimelineEntry =
    | { kind: 'message'; direction: 'in' | 'out'; ts: string; row: MsgRow }
    | { kind: 'frame'; direction: 'in'; ts: string; frame: Frame }
    | { kind: 'boundary'; ts: string };

/**
 * Pure merge of durable queue messages and ephemeral process frames into one
 * timeline for `agentId` (0422 R5/R6).
 *
 * Ordering — ascending on the ISO timestamp (`createdAt` for messages, `ts` for
 * frames). Ties are broken by placing messages before frames, then by `seq`
 * among frames. Clock skew between the server process and a spawned agent
 * process is a known limitation recorded under M4 *Not yet specified*.
 *
 * Direction — a message is inbound when `toId === agentId`, outbound when
 * `fromId === agentId`. A frame is inbound when `stream === 'stdout' | 'stderr'`
 * (the agent talking back). Operator-typed stdin lines are not in the ring
 * buffer and so do not appear — this is expected, not a gap.
 *
 * Boundary — the oldest frame's `ts` becomes a `boundary` entry at the point
 * where process-frame history begins; rows before it are messages only. When
 * there are no frames at all (agent stopped) the returned array is
 * message-only and carries no boundary — the caller renders a note.
 */
export function mergeTimeline(messages: MsgRow[], frames: Frame[], agentId: string): TimelineEntry[] {
    const messageEntries: TimelineEntry[] = messages.map((row) => ({
        kind: 'message',
        direction: row.toId === agentId ? 'in' : 'out',
        ts: row.createdAt,
        row,
    }));
    // Only stdout/stderr frames appear — meta sync markers and operator echo are
    // not user-meaningful in the timeline. Frames are always inbound (agent talk).
    const frameEntries: TimelineEntry[] = frames
        .filter((frame) => frame.stream === 'stdout' || frame.stream === 'stderr')
        .map((frame) => ({ kind: 'frame', direction: 'in', ts: frame.ts, frame }));

    const merged = [...messageEntries, ...frameEntries].sort(compareEntries);

    const firstFrameIndex = merged.findIndex((entry) => entry.kind === 'frame');
    if (firstFrameIndex === -1) return merged;
    const boundary: TimelineEntry = { kind: 'boundary', ts: merged[firstFrameIndex]?.ts ?? '' };
    merged.splice(firstFrameIndex, 0, boundary);
    return merged;
}

/** Sort entries ascending by ts; ties: messages before frames, then seq. */
function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
    if (a.ts < b.ts) return -1;
    if (a.ts > b.ts) return 1;
    const aKind = a.kind === 'message' ? 0 : 1;
    const bKind = b.kind === 'message' ? 0 : 1;
    if (aKind !== bKind) return aKind - bKind;
    if (a.kind === 'frame' && b.kind === 'frame') {
        const aSeq = a.frame.seq ?? 0;
        const bSeq = b.frame.seq ?? 0;
        return aSeq - bSeq;
    }
    // Equal-ts messages keep input order (stable sort).
    return 0;
}
