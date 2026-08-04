import { resolveApiUrl } from './rpc-client';

/**
 * Wire shape of one frame from `GET /api/team/processes/:id/stream` (SSE).
 *
 * `stream: 'meta'` is used by the server for the `--replay-done--` sync marker
 * and any future out-of-band metadata; `stdout`/`stderr` carry process output.
 * The `seq` is a monotonic cursor stamped at push time. Ring-buffer overflow
 * splices old frames from the front, so array indices shift under a live
 * cursor — the client MUST track `seq`, never index (supervisor-service.ts:14).
 *
 * Shared by the Teams member terminal and the Inbox agent timeline (0422 R9).
 */
export interface Frame {
    stream: 'stdout' | 'stderr' | 'meta';
    ts: string;
    line: string;
    seq?: number;
}

/** Bounded frame buffer — the UI keeps at most this many lines visible. */
const MAX_FRAMES = 1000;

/** Reconnect backoff schedule (ms). Caps at 15 s after the 4th retry. */
const BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 15_000];
const MAX_BACKOFF = 15_000;

/**
 * Runtime-narrow an unknown SSE payload into a `Frame`, or return `null` when
 * the shape is wrong. Network input is untrusted — a malformed frame must not
 * crash the terminal (R1, R6).
 */
export function parseFrame(value: unknown): Frame | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.stream !== 'string') return null;
    if (typeof obj.ts !== 'string') return null;
    if (typeof obj.line !== 'string') return null;
    // `seq` is optional on meta frames, required on stdout/stderr.
    const stream = obj.stream as Frame['stream'];
    if (stream !== 'stdout' && stream !== 'stderr' && stream !== 'meta') return null;
    const seqRaw = obj.seq;
    if (seqRaw !== undefined && typeof seqRaw !== 'number') return null;
    return { stream, ts: obj.ts, line: obj.line, ...(seqRaw !== undefined ? { seq: seqRaw } : {}) };
}

/** Compute the next backoff delay for reconnect attempt `attempt` (0-indexed). */
export function nextBackoff(attempt: number): number {
    if (attempt < 0) return BACKOFF_SCHEDULE[0] as number;
    if (attempt >= BACKOFF_SCHEDULE.length) return MAX_BACKOFF;
    return BACKOFF_SCHEDULE[attempt] as number;
}

/**
 * Append a frame to the buffer, deduping by seq and capping at `MAX_FRAMES`.
 * Returns the new buffer and the updated last-seq watermark. A frame whose
 * `seq` is `<= lastSeq` is dropped (R6 — no duplicate lines). Frames without
 * `seq` (meta) are always appended.
 */
export function appendFrame(frames: Frame[], frame: Frame, lastSeq: number): { frames: Frame[]; lastSeq: number } {
    // Meta frames (no seq) always pass through.
    if (frame.seq === undefined) {
        const next = [...frames, frame];
        if (next.length > MAX_FRAMES) next.splice(0, next.length - MAX_FRAMES);
        return { frames: next, lastSeq };
    }
    // Seq-cursor dedup: drop anything at or below the watermark (R6).
    if (frame.seq <= lastSeq) return { frames, lastSeq };
    const next = [...frames, frame];
    if (next.length > MAX_FRAMES) next.splice(0, next.length - MAX_FRAMES);
    return { frames: next, lastSeq: frame.seq };
}

/** SSE stream endpoint for a member's process, optionally resuming from `sinceSeq`. */
export const streamUrl = (agentId: string, sinceSeq?: number) =>
    sinceSeq !== undefined
        ? `${resolveApiUrl()}/team/processes/${encodeURIComponent(agentId)}/stream?sinceSeq=${sinceSeq}`
        : `${resolveApiUrl()}/team/processes/${encodeURIComponent(agentId)}/stream`;
