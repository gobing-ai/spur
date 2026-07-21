import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

/**
 * Wire shape of a tool-use event from GET /api/observability/tool-use (tasks 0245–0248).
 */
interface ToolUseEvent {
    seq: number;
    ts: string;
    session: string;
    type: string;
    file?: string;
    /** Bash/Grep/Glob short redacted summary (task 0248). */
    summary?: string;
    tokens?: number;
    action?: string;
    totals?: { reads: number; writes: number; tokens: number };
    sessionId?: string;
    agent?: string;
    model?: string;
    /** Client-stable key (page prefix + seq or live id). */
    _key?: string;
}

const TOOL_ACTIVITY_TYPES = new Set(['read', 'write', 'bash', 'grep', 'glob']);

interface ToolUseSnapshot {
    events: ToolUseEvent[];
    count: number;
    limit: number;
    truncated: boolean;
    path: string;
    capturedAt: string;
    sparseToolActivity?: boolean;
    nextBefore?: string | null;
}

type SseStatus = 'connecting' | 'live' | 'errored' | 'polling' | 'off';

const POLL_MS = 3_000;
const PAGE_LIMIT = 200;
const apiUrl = (limit = PAGE_LIMIT, before?: string | null) => {
    const base = `${resolveApiUrl()}/observability/tool-use?limit=${limit}`;
    return before ? `${base}&before=${encodeURIComponent(before)}` : base;
};
const streamUrl = () => `${resolveApiUrl()}/observability/tool-use/stream`;

/**
 * Tool Using tab (tasks 0245–0248).
 *
 * Initial GET page; Live uses SSE when EventSource is available (poll fallback otherwise).
 * Load more uses cursor `before=nextBefore`. Target column: file basename or summary.
 */
export default function ToolUsingTab() {
    const [events, setEvents] = useState<ToolUseEvent[] | null>(null);
    const [meta, setMeta] = useState<{
        path: string;
        truncated: boolean;
        sparseToolActivity: boolean;
        nextBefore: string | null;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [live, setLive] = useState(true);
    const [sseStatus, setSseStatus] = useState<SseStatus>('off');
    const [loadingMore, setLoadingMore] = useState(false);
    const liveSeqRef = useRef(0);

    const applyPage = useCallback((body: ToolUseSnapshot, mode: 'replace' | 'append') => {
        const page = (body.events ?? []).map((e, i) => ({
            ...e,
            seq: typeof e.seq === 'number' ? e.seq : i,
            _key: `${mode === 'append' ? (body.nextBefore ?? 'p') : 'head'}:${e.ts}:${e.session}:${e.type}:${e.file ?? ''}:${e.summary ?? ''}:${e.seq ?? i}`,
        }));
        setEvents((prev) => {
            if (mode === 'replace' || !prev) return page;
            // Append older page; de-dupe by ts+session+type+file+summary+action+tokens
            const seen = new Set(prev.map(rowIdentity));
            const extra = page.filter((e) => !seen.has(rowIdentity(e)));
            return [...prev, ...extra];
        });
        setMeta({
            path: body.path ?? '',
            truncated: body.truncated ?? false,
            sparseToolActivity:
                body.sparseToolActivity ?? (page.length === 0 || !page.some((ev) => TOOL_ACTIVITY_TYPES.has(ev.type))),
            nextBefore: body.nextBefore ?? null,
        });
    }, []);

    const loadInitial = useCallback(
        async (signal: AbortSignal) => {
            try {
                const res = await fetchWithTimeout(new Request(apiUrl(), { signal }));
                if (!res.ok) {
                    let detail = `tool-use fetch failed: ${res.status}`;
                    try {
                        const body: unknown = await res.json();
                        const msg = (body as { error?: string }).error;
                        if (msg) detail = msg;
                    } catch {
                        /* ignore */
                    }
                    throw new Error(detail);
                }
                const body = (await res.json()) as ToolUseSnapshot;
                applyPage(body, 'replace');
                setError(null);
            } catch (err) {
                if (signal.aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        },
        [applyPage],
    );

    // Initial load (always once on mount / when remounting).
    useEffect(() => {
        const controller = new AbortController();
        void loadInitial(controller.signal);
        return () => controller.abort();
    }, [loadInitial]);

    // Live: SSE primary, poll fallback when EventSource missing.
    useEffect(() => {
        if (!live) {
            setSseStatus('off');
            return;
        }

        if (typeof EventSource === 'undefined') {
            setSseStatus('polling');
            const timer = setInterval(() => {
                void loadInitial(new AbortController().signal);
            }, POLL_MS);
            return () => clearInterval(timer);
        }

        setSseStatus('connecting');
        const es = new EventSource(streamUrl());
        es.onopen = () => setSseStatus('live');
        es.onerror = () => setSseStatus('errored');
        es.onmessage = (msg) => {
            try {
                const raw: unknown = JSON.parse(msg.data);
                const frame = raw as { type?: string; event?: Omit<ToolUseEvent, 'seq' | '_key'> };
                if (frame.type === 'connected') {
                    setSseStatus('live');
                    return;
                }
                if (frame.type !== 'tool-use' || !frame.event) return;
                const e = frame.event;
                liveSeqRef.current -= 1;
                const row: ToolUseEvent = {
                    ...e,
                    seq: liveSeqRef.current,
                    _key: `live:${liveSeqRef.current}:${e.ts}:${e.session}:${e.type}:${e.file ?? ''}:${e.summary ?? ''}`,
                };
                setEvents((prev) => {
                    const list = prev ?? [];
                    // Drop exact duplicates at head.
                    if (list[0] && rowIdentity(list[0]) === rowIdentity(row)) return list;
                    return [row, ...list];
                });
                setMeta((m) =>
                    m
                        ? {
                              ...m,
                              sparseToolActivity: TOOL_ACTIVITY_TYPES.has(row.type) ? false : m.sparseToolActivity,
                          }
                        : m,
                );
            } catch {
                /* drop malformed */
            }
        };
        return () => {
            es.close();
            setSseStatus('off');
        };
    }, [live, loadInitial]);

    const loadMore = useCallback(async () => {
        if (!meta?.nextBefore || loadingMore) return;
        setLoadingMore(true);
        try {
            const res = await fetchWithTimeout(new Request(apiUrl(PAGE_LIMIT, meta.nextBefore)));
            if (!res.ok) throw new Error(`load more failed: ${res.status}`);
            const body = (await res.json()) as ToolUseSnapshot;
            applyPage(body, 'append');
            // nextBefore from the older page; if not truncated, clear.
            setMeta((m) =>
                m
                    ? {
                          ...m,
                          nextBefore: body.nextBefore ?? null,
                          truncated: body.truncated ?? false,
                      }
                    : m,
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoadingMore(false);
        }
    }, [meta?.nextBefore, loadingMore, applyPage]);

    if (error && !events) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load tool use: {error}
            </div>
        );
    }
    if (events === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading tool use…
            </div>
        );
    }

    const showAgentCol = events.some((e) => e.agent);
    const showModelCol = events.some((e) => e.model);
    const sparse =
        meta?.sparseToolActivity ?? (events.length === 0 || !events.some((ev) => TOOL_ACTIVITY_TYPES.has(ev.type)));

    return (
        <div className="flex flex-col h-full overflow-hidden" data-tool-using-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">Tool Using</span>
                <span className="text-xs text-spur-text-muted" data-event-count>
                    {events.length} event(s)
                    {meta?.nextBefore ? ' · more available' : ''}
                </span>
                <label
                    htmlFor="live-toggle"
                    className="flex items-center gap-1.5 text-xs text-spur-text ml-2 cursor-pointer"
                >
                    <Checkbox
                        id="live-toggle"
                        size="xs"
                        checked={live}
                        onChange={(e) => setLive(e.target.checked)}
                        data-live-toggle
                        aria-label="Live refresh"
                    />
                    Live
                </label>
                <span className="text-[10px] text-spur-text-muted font-mono" data-sse-status>
                    {liveLabel(sseStatus)}
                </span>
                <span
                    className="text-[10px] text-spur-text-muted ml-auto font-mono truncate max-w-[40%]"
                    title={meta?.path ?? ''}
                    data-ledger-path
                >
                    {meta?.path ? basename(meta.path) : ''}
                </span>
            </div>
            {error ? (
                <div className="px-4 py-1 text-xs text-warning" role="status">
                    Refresh warning: {error}
                </div>
            ) : null}
            {events.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic" data-empty-state>
                    No tool-use events yet. File tools are logged when agent hooks write token-ledger.jsonl (requires
                    SessionStart + supported agent PostToolUse for Read/Write/Edit).
                </div>
            ) : (
                <>
                    {sparse ? (
                        <div
                            className="px-4 py-2 text-xs text-spur-text-muted bg-base-200/60 border-b border-spur-border"
                            role="status"
                            data-sparse-banner
                        >
                            Limited recent tool activity in this window (session markers only, or no read/write rows).
                            Hooks record tools only for supported agents after SessionStart. Ledger: {meta?.path || '—'}
                        </div>
                    ) : null}
                    <div className="flex-1 overflow-auto">
                        <table className="table table-xs table-pin-rows w-full">
                            <thead>
                                <tr className="text-[10px] uppercase text-spur-text-muted">
                                    <th>Time</th>
                                    <th>Type</th>
                                    <th title="File path or Bash/Grep/Glob summary">Target</th>
                                    <th>Action</th>
                                    <th className="text-right">Tokens</th>
                                    <th>Session</th>
                                    {showAgentCol ? <th>Agent</th> : null}
                                    {showModelCol ? <th>Model</th> : null}
                                </tr>
                            </thead>
                            <tbody>
                                {events.map((e) => (
                                    <tr
                                        key={e._key ?? `${e.seq}-${e.ts}`}
                                        className="border-spur-border"
                                        data-event-seq={e.seq}
                                    >
                                        <td className="font-mono text-[10px] text-spur-text-muted whitespace-nowrap">
                                            {formatTime(e.ts)}
                                        </td>
                                        <td>
                                            <TypeBadge type={e.type} />
                                        </td>
                                        <td
                                            className="font-mono text-[10px] text-spur-text max-w-[16rem] truncate"
                                            title={targetTitle(e)}
                                        >
                                            {formatTarget(e)}
                                        </td>
                                        <td className="text-xs text-spur-text-muted">{e.action ?? '—'}</td>
                                        <td className="font-mono text-xs whitespace-nowrap text-right">
                                            {formatTokens(e)}
                                        </td>
                                        <td
                                            className="font-mono text-[10px] text-spur-text-muted max-w-[8rem] truncate"
                                            title={e.sessionId ?? e.session}
                                        >
                                            {e.session}
                                        </td>
                                        {showAgentCol ? (
                                            <td className="text-[10px] text-spur-text-muted max-w-[6rem] truncate">
                                                {e.agent ?? '—'}
                                            </td>
                                        ) : null}
                                        {showModelCol ? (
                                            <td className="text-[10px] text-spur-text-muted max-w-[8rem] truncate">
                                                {e.model ?? '—'}
                                            </td>
                                        ) : null}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {meta?.nextBefore ? (
                        <div className="px-4 py-2 border-t border-spur-border shrink-0 flex justify-center">
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={() => void loadMore()}
                                disabled={loadingMore}
                                data-load-more
                            >
                                {loadingMore ? 'Loading…' : 'Load older events'}
                            </Button>
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}

function rowIdentity(e: ToolUseEvent): string {
    return [e.ts, e.session, e.type, e.file ?? '', e.summary ?? '', e.action ?? '', String(e.tokens ?? '')].join('|');
}

/** Prefer short summary (bash/grep/glob); else basename of file. */
function formatTarget(e: ToolUseEvent): string {
    if (e.summary) return e.summary;
    if (e.file) return basename(e.file);
    return '—';
}

function targetTitle(e: ToolUseEvent): string {
    if (e.summary && e.file) return `${e.summary}\n${e.file}`;
    return e.summary ?? e.file ?? '';
}

function liveLabel(status: SseStatus): string {
    switch (status) {
        case 'live':
            return 'sse:live';
        case 'connecting':
            return 'sse:connecting';
        case 'errored':
            return 'sse:retry';
        case 'polling':
            return 'poll';
        default:
            return '';
    }
}

function TypeBadge({ type }: { type: string }) {
    const variant =
        type === 'session_start'
            ? 'secondary'
            : type === 'session_end'
              ? 'ghost'
              : type === 'write'
                ? 'warning'
                : type === 'read'
                  ? 'primary'
                  : type === 'bash'
                    ? 'accent'
                    : type === 'grep' || type === 'glob'
                      ? 'info'
                      : 'ghost';
    return (
        <Badge variant={variant} size="xs">
            {type}
        </Badge>
    );
}

function formatTime(iso: string): string {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleString(undefined, {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    } catch {
        return iso;
    }
}

function formatTokens(e: ToolUseEvent): string {
    if (e.type === 'session_end' && e.totals) {
        return `r${e.totals.reads}/w${e.totals.writes}/t${formatNumber(e.totals.tokens)}`;
    }
    if (e.tokens != null && Number.isFinite(e.tokens)) return formatNumber(e.tokens);
    return '—';
}

function formatNumber(n: number): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function basename(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
}
