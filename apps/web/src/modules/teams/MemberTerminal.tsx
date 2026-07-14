import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

/**
 * Wire shape of one frame from `GET /api/team/processes/:id/stream` (SSE).
 *
 * `stream: 'meta'` is used by the server for the `--replay-done--` sync marker
 * and any future out-of-band metadata; `stdout`/`stderr` carry process output.
 * The `seq` is a monotonic cursor stamped at push time. Ring-buffer overflow
 * splices old frames from the front, so array indices shift under a live
 * cursor — the client MUST track `seq`, never index (supervisor-service.ts:14).
 */
export interface Frame {
    stream: 'stdout' | 'stderr' | 'meta';
    ts: string;
    line: string;
    seq?: number;
}

/** Member process status row from `GET /api/team/processes`. */
export interface ProcessStatus {
    agentId: string;
    pid: number;
    status: string;
    startedAt: string;
    exitCode: number | null;
}

/** Bounded frame buffer — the UI keeps at most this many lines visible. */
const MAX_FRAMES = 1000;

/** Reconnect backoff schedule (ms). Caps at 15 s after the 4th retry. */
const BACKOFF_SCHEDULE = [1000, 2000, 4000, 8000, 15_000];
const MAX_BACKOFF = 15_000;

/** Status poll interval (ms). */
const STATUS_POLL_MS = 3000;

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

/**
 * Runtime-narrow the `/api/team/processes` response into a status map.
 * Returns `null` on malformed input so the caller can skip a bad poll.
 */
export function parseProcessList(value: unknown): ProcessStatus[] | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (!Array.isArray(obj.processes)) return null;
    const out: ProcessStatus[] = [];
    for (const raw of obj.processes) {
        if (raw === null || typeof raw !== 'object') return null;
        const r = raw as Record<string, unknown>;
        if (typeof r.agentId !== 'string') return null;
        if (typeof r.status !== 'string') return null;
        if (typeof r.startedAt !== 'string') return null;
        if (typeof r.pid !== 'number') return null;
        const exitCode = r.exitCode;
        if (exitCode !== null && typeof exitCode !== 'number') return null;
        out.push({
            agentId: r.agentId,
            pid: r.pid,
            status: r.status,
            startedAt: r.startedAt,
            exitCode: exitCode as number | null,
        });
    }
    return out;
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

export const streamUrl = (agentId: string, sinceSeq?: number) =>
    sinceSeq !== undefined
        ? `${resolveApiUrl()}/team/processes/${encodeURIComponent(agentId)}/stream?sinceSeq=${sinceSeq}`
        : `${resolveApiUrl()}/team/processes/${encodeURIComponent(agentId)}/stream`;

export const stdinUrl = (agentId: string) => `${resolveApiUrl()}/team/processes/${encodeURIComponent(agentId)}/stdin`;

const processesUrl = () => `${resolveApiUrl()}/team/processes`;

/**
 * Member terminal — a minimal, no-dependency terminal view rendering ring-buffer
 * frames from the existing SSE stream, plus an input line POSTing to stdin.
 *
 * No xterm.js (attach is line-framed per DD-3, not a raw TTY; a real PTY terminal
 * is deferred). Reuses the observability EventSource pattern (InboxTab listens
 * to `/api/events/planning`).
 *
 * The `seq` is the stable cursor — array index is NOT (ring-buffer overflow
 * splices from the front). The terminal reconnects the SSE across a respawn
 * and resumes from the last `seq` (R4).
 */
export default function MemberTerminal({ agentId }: { agentId: string }) {
    const [frames, setFrames] = useState<Frame[]>([]);
    const [status, setStatus] = useState<string>('unknown');
    const [input, setInput] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);

    // Refs survive re-renders without triggering them.
    const lastSeqRef = useRef<number>(-1);
    const esRef = useRef<EventSource | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const attemptRef = useRef<number>(0);
    const mountedRef = useRef<boolean>(true);
    const preRef = useRef<HTMLPreElement | null>(null);

    // ── Status poll: fetch /api/team/processes every STATUS_POLL_MS ──
    const loadStatus = useCallback(
        async (signal: AbortSignal): Promise<void> => {
            try {
                const res = await fetchWithTimeout(new Request(processesUrl(), { signal }));
                if (!res.ok) return;
                const raw: unknown = await res.json();
                const list = parseProcessList(raw);
                if (!list) return;
                const entry = list.find((p) => p.agentId === agentId);
                if (entry && mountedRef.current) setStatus(entry.status);
            } catch {
                // Network errors are non-fatal for status — the SSE may still be live.
            }
        },
        [agentId],
    );

    useEffect(() => {
        mountedRef.current = true;
        let active: AbortController | null = null;
        const poll = () => {
            active?.abort();
            active = new AbortController();
            void loadStatus(active.signal);
        };
        poll();
        const interval = setInterval(poll, STATUS_POLL_MS);
        return () => {
            mountedRef.current = false;
            active?.abort();
            clearInterval(interval);
        };
    }, [loadStatus]);

    // ── SSE stream: open EventSource, dedup by seq, reconnect with backoff ──
    const openStream = useCallback(() => {
        if (!mountedRef.current) return;
        const es = new EventSource(streamUrl(agentId, lastSeqRef.current > -1 ? lastSeqRef.current : undefined));
        esRef.current = es;

        es.onmessage = (event) => {
            try {
                const raw: unknown = JSON.parse(event.data);
                const frame = parseFrame(raw);
                if (!frame) return;
                setFrames((prev) => {
                    const result = appendFrame(prev, frame, lastSeqRef.current);
                    lastSeqRef.current = result.lastSeq;
                    return result.frames;
                });
                // Reset backoff on a successful frame — the stream is healthy.
                attemptRef.current = 0;
                setConnected(true);
            } catch {
                // Malformed frame — drop silently (R1).
            }
        };

        es.onerror = () => {
            es.close();
            esRef.current = null;
            setConnected(false);
            if (!mountedRef.current) return;
            // Reconnect with backoff, resuming from the last seen seq (R4).
            const delay = nextBackoff(attemptRef.current);
            attemptRef.current += 1;
            reconnectTimerRef.current = setTimeout(openStream, delay);
        };
    }, [agentId]);

    useEffect(() => {
        openStream();
        return () => {
            mountedRef.current = false;
            esRef.current?.close();
            esRef.current = null;
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        };
    }, [openStream]);

    // ── Auto-scroll to bottom on new frames ──
    useEffect(() => {
        if (preRef.current && frames.length > 0) {
            preRef.current.scrollTop = preRef.current.scrollHeight;
        }
    }, [frames]);

    // ── Input: POST to stdin on Enter, clear on success, retain on failure ──
    const sendInput = useCallback(async () => {
        const line = input;
        if (line.length === 0) return;
        setInputError(null);
        try {
            const res = await fetchWithTimeout(
                new Request(stdinUrl(agentId), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ line }),
                }),
            );
            if (!res.ok) {
                const body: unknown = await res.json().catch(() => null);
                const msg = (body as { error?: string } | null)?.error ?? `stdin POST failed: ${res.status}`;
                setInputError(msg);
                return; // retain the typed text (R2)
            }
            setInput(''); // clear on success (R2)
        } catch (err) {
            setInputError(err instanceof Error ? err.message : String(err));
            // retain the typed text (R2)
        }
    }, [agentId, input]);

    const isRunning = status === 'running';
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && isRunning) {
            e.preventDefault();
            void sendInput();
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden" data-member-terminal={agentId}>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0 flex items-center gap-2">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">Terminal</span>
                <Badge variant={isRunning ? 'success' : 'ghost'} size="xs" data-terminal-status>
                    {status}
                </Badge>
                <span className="text-[10px] text-spur-text-muted" data-terminal-connected>
                    {connected ? 'connected' : 'reconnecting…'}
                </span>
            </div>

            {!isRunning && (
                <div
                    className="px-4 py-1 text-xs text-warning border-b border-spur-border"
                    role="status"
                    data-status-banner
                >
                    Member is {status} — input disabled.
                </div>
            )}

            <pre
                ref={preRef}
                className="flex-1 overflow-y-auto p-2 text-xs font-mono leading-snug bg-base-100"
                data-terminal-output
            >
                {frames.length === 0 ? (
                    <span className="text-spur-text-muted italic">No output yet.</span>
                ) : (
                    frames.map((f, i) => (
                        <div
                            key={f.seq ?? `meta-${i}`}
                            className={
                                f.stream === 'stderr'
                                    ? 'text-error'
                                    : f.stream === 'meta'
                                      ? 'text-spur-text-muted italic'
                                      : 'text-spur-text'
                            }
                            data-stream={f.stream}
                        >
                            {f.line}
                        </div>
                    ))
                )}
            </pre>

            {inputError && (
                <div className="px-4 py-1 text-xs text-error border-t border-spur-border" role="alert" data-input-error>
                    {inputError}
                </div>
            )}

            <div className="flex items-center gap-2 px-2 py-2 border-t border-spur-border bg-base-200 shrink-0">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={!isRunning}
                    placeholder={isRunning ? 'Type a line and press Enter…' : 'Input disabled (member not running)'}
                    className="flex-1 input input-sm font-mono"
                    data-terminal-input
                />
            </div>
        </div>
    );
}
