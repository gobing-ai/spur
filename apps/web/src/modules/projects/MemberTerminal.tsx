import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/ui';
import { appendFrame, type Frame, nextBackoff, parseFrame, streamUrl } from '../../lib/process-stream';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

/** Member process status row from `GET /api/processes`. */
export interface ProcessStatus {
    agentId: string;
    pid: number;
    status: string;
    startedAt: string;
    exitCode: number | null;
    /** Owning team id — `null` when unassigned (0852: watch-list team filter). */
    teamId: string | null;
}

/** Status poll interval (ms). */
export const STATUS_POLL_MS = 3000;

/**
 * Runtime-narrow the `/api/processes` response into a status map.
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
        // teamId is additive enrichment for the watch list (0852): a missing or
        // non-string value narrows to null instead of failing the poll, so the
        // accept/reject behavior existing callers see is untouched.
        const teamId = r.teamId;
        out.push({
            agentId: r.agentId,
            pid: r.pid,
            status: r.status,
            startedAt: r.startedAt,
            exitCode: exitCode as number | null,
            teamId: typeof teamId === 'string' ? teamId : null,
        });
    }
    return out;
}

/** ProcessRegistry execution row — the `executions` half of `GET /api/processes` (spur#0264). */
export interface RegistryExecution {
    id: string;
    label: string;
    command: string;
    args: string[];
    pid: number | null;
    status: string;
    startedAt: string;
    exitedAt: string | null;
    exitCode: number | null;
    source: string;
    teamId: string | null;
    agentId: string | null;
}

/**
 * Runtime-narrow the registry-execution half of `/api/processes` (0852 R4).
 * Same contract as `parseProcessList`: returns `null` on malformed input so the
 * caller can skip a bad poll. This is the single parse site for the wire —
 * consumers import from here; no second copy exists under apps/web/src.
 */
export function parseExecutions(value: unknown): RegistryExecution[] | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (!Array.isArray(obj.executions)) return null;
    const out: RegistryExecution[] = [];
    for (const raw of obj.executions) {
        if (raw === null || typeof raw !== 'object') return null;
        const r = raw as Record<string, unknown>;
        if (typeof r.id !== 'string') return null;
        if (typeof r.label !== 'string') return null;
        if (typeof r.command !== 'string') return null;
        if (!Array.isArray(r.args)) return null;
        if (!r.args.every((a) => typeof a === 'string')) return null;
        if (r.pid !== null && typeof r.pid !== 'number') return null;
        if (typeof r.status !== 'string') return null;
        if (typeof r.startedAt !== 'string') return null;
        if (r.exitedAt !== null && typeof r.exitedAt !== 'string') return null;
        if (r.exitCode !== null && typeof r.exitCode !== 'number') return null;
        if (typeof r.source !== 'string') return null;
        if (r.agentId !== null && typeof r.agentId !== 'string') return null;
        // teamId is additive enrichment (0852) and the producer no longer writes the
        // grouping id (0860), so any missing or non-string value narrows to null instead
        // of failing the poll — the same tolerance `parseProcessList` documents. A strict
        // check here rejected the whole response and wedged the watch list.
        const teamId = r.teamId;
        out.push({
            id: r.id,
            label: r.label,
            command: r.command,
            args: r.args as string[],
            pid: r.pid as number | null,
            status: r.status,
            startedAt: r.startedAt,
            exitedAt: r.exitedAt as string | null,
            exitCode: r.exitCode as number | null,
            source: r.source,
            teamId: typeof teamId === 'string' ? teamId : null,
            agentId: r.agentId as string | null,
        });
    }
    return out;
}

export const stdinUrl = (agentId: string) => `${resolveApiUrl()}/processes/${encodeURIComponent(agentId)}/stdin`;

/** POST /api/messages — enqueue a message for the agent loop to drain (0261 R2). */
export const messagesUrl = () => `${resolveApiUrl()}/messages`;

const processesUrl = () => `${resolveApiUrl()}/processes`;

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

    // ── Status poll: fetch /api/processes every STATUS_POLL_MS ──
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
    // R1/R3: always echo locally as 'meta' frame for instant feedback.
    const sendInput = useCallback(async () => {
        const line = input;
        if (line.length === 0) return;
        setInputError(null);

        // Local echo — appears immediately in the output buffer (R1, R3).
        const echo: Frame = {
            stream: 'meta',
            ts: new Date().toISOString(),
            line: `> ${line}`,
        };
        setFrames((prev) => appendFrame(prev, echo, lastSeqRef.current).frames);

        try {
            const res = await fetchWithTimeout(
                new Request(stdinUrl(agentId), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ line }),
                }),
            );

            // R2: for default loop-agent members, also enqueue as a message so the
            // agent drains it on the next iteration. The POST is fire-and-forget —
            // its failure must not block stdin delivery or input clearing.
            fetchWithTimeout(
                new Request(messagesUrl(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from: 'terminal', to: agentId, body: line }),
                }),
            ).catch(() => {
                // Non-blocking — stdin was already delivered.
            });

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
                <span className="font-mono text-xs text-spur-text-muted">{agentId}</span>
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
                className="flex-1 overflow-x-auto overflow-y-auto p-2 text-xs font-mono leading-snug bg-base-100"
                data-terminal-output
            >
                {frames.length === 0 ? (
                    <span className="text-spur-text-muted italic">Waiting for output from {agentId}…</span>
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
