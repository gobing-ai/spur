import { useCallback, useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

interface MsgEndpoint {
    agentId: string;
    teamName?: string;
    memberLabel?: string;
    agentType?: string;
}

interface MsgRow {
    id: string;
    fromId: string | null;
    toId: string;
    from?: MsgEndpoint;
    to: MsgEndpoint;
    body: string;
    status: string;
    createdAt: string;
    inReplyTo: string | null;
    hasReply: boolean;
    replyCount: number;
}

const feedUrl = (limit = 50) => `${resolveApiUrl()}/messages?limit=${limit}`;
const sseUrl = () => `${resolveApiUrl()}/events/planning`;

/** SSE event names that signal a new message (metadata-only payloads). */
const MESSAGE_EVENT_NAMES = new Set(['message.sent', 'message.replied']);

/** Narrow an untrusted endpoint object; requires a non-empty agentId. */
function parseEndpoint(value: unknown, fallbackId: string): MsgEndpoint {
    if (value && typeof value === 'object') {
        const o = value as Record<string, unknown>;
        const agentId = typeof o.agentId === 'string' && o.agentId.length > 0 ? o.agentId : fallbackId;
        return {
            agentId,
            ...(typeof o.teamName === 'string' && o.teamName ? { teamName: o.teamName } : {}),
            ...(typeof o.memberLabel === 'string' && o.memberLabel ? { memberLabel: o.memberLabel } : {}),
            ...(typeof o.agentType === 'string' && o.agentType ? { agentType: o.agentType } : {}),
        };
    }
    return { agentId: fallbackId };
}

/**
 * Runtime-narrow the global messages feed. Network input is untrusted — missing
 * `to` / reply fields must not crash the tab (0269 review C).
 */
export function parseMessagesFeed(body: unknown): MsgRow[] | null {
    if (!body || typeof body !== 'object' || !('messages' in body)) return null;
    const raw = (body as { messages: unknown }).messages;
    if (!Array.isArray(raw)) return null;
    const out: MsgRow[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const r = entry as Record<string, unknown>;
        if (typeof r.id !== 'string' || typeof r.toId !== 'string' || typeof r.body !== 'string') continue;
        if (typeof r.status !== 'string' || typeof r.createdAt !== 'string') continue;
        const fromId =
            r.fromId === null || r.fromId === undefined ? null : typeof r.fromId === 'string' ? r.fromId : null;
        out.push({
            id: r.id,
            fromId,
            toId: r.toId,
            body: r.body,
            status: r.status,
            createdAt: r.createdAt,
            inReplyTo: typeof r.inReplyTo === 'string' ? r.inReplyTo : null,
            hasReply: r.hasReply === true,
            replyCount: typeof r.replyCount === 'number' && Number.isFinite(r.replyCount) ? r.replyCount : 0,
            ...(fromId !== null ? { from: parseEndpoint(r.from, fromId) } : {}),
            to: parseEndpoint(r.to, r.toId),
        });
    }
    return out;
}

/**
 * Messages tab — unfiltered feed of recent traffic across every member (0260 R3).
 *
 * Until 0260 this view rendered one member's inbox, filtered by the shared
 * `TeamsContext` selection that only RosterTab wrote. With Roster removed the
 * selection had no producer, so the tab could never leave its empty state; per M1
 * the tab now reads the global `GET /api/messages` feed and per-member filtering is
 * deferred until message volume justifies it. The operator→member send path lives
 * in the Terminal input (0261), so this view is read-only.
 */
export default function MessagesTab() {
    const [messages, setMessages] = useState<MsgRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (signal?: AbortSignal) => {
        try {
            const res = await fetchWithTimeout(new Request(feedUrl(), { signal }));
            if (!res.ok) throw new Error(`messages fetch failed: ${res.status}`);
            const parsed = parseMessagesFeed(await res.json());
            if (parsed) setMessages(parsed);
        } catch (err) {
            // An aborted load is a teardown, not a failure — reporting it would flash
            // an error banner on unmount. Matches the sibling observability tabs.
            if (signal?.aborted) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        const interval = setInterval(() => void load(controller.signal), 10_000);
        return () => {
            controller.abort();
            clearInterval(interval);
        };
    }, [load]);

    // Live tail (0254 R6/AC5 pattern, retained): refetch the feed on a `message.*`
    // SSE event. Payloads are metadata-only (no body), so a matching event triggers
    // a refetch rather than an in-place append. The 10 s poll above remains the
    // safety net when SSE is unavailable.
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const controller = new AbortController();
        const es = new EventSource(sseUrl());
        es.onmessage = (frame) => {
            try {
                const raw: unknown = JSON.parse(frame.data);
                if (raw === null || typeof raw !== 'object') return;
                const name = (raw as { eventName?: unknown }).eventName;
                if (typeof name === 'string' && MESSAGE_EVENT_NAMES.has(name)) {
                    void load(controller.signal);
                }
            } catch {
                // Malformed frame — drop silently.
            }
        };
        return () => {
            controller.abort();
            es.close();
        };
    }, [load]);

    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load messages: {error}
            </div>
        );
    if (messages === null) return <div className="p-4 text-sm text-spur-text-muted">Loading messages…</div>;

    return (
        <div className="flex flex-col h-full overflow-hidden" data-messages-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                    Message · all teams
                </span>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                {messages.length === 0 ? (
                    <li className="text-sm text-spur-text-muted italic">No messages yet.</li>
                ) : (
                    messages.map((m) => {
                        const fromLabel = m.from
                            ? [m.from.memberLabel ?? m.from.agentId, m.from.agentType].filter(Boolean).join(' · ')
                            : (m.fromId ?? 'system');
                        const toLabel = [m.to.memberLabel ?? m.to.agentId, m.to.agentType].filter(Boolean).join(' · ');
                        const fromTeam = m.from?.teamName;
                        const toTeam = m.to.teamName;
                        const deliveryChip =
                            m.status === 'injected' ? 'injected' : m.status === 'queued' ? 'queued' : null;
                        return (
                            <li key={m.id} className="p-2 bg-base-200 rounded text-xs">
                                <div className="flex items-center gap-2 text-spur-text-muted">
                                    <span data-message-route className="truncate">
                                        {fromTeam && <span className="text-[10px] opacity-70">{fromTeam} / </span>}
                                        <span>{fromLabel}</span>
                                        <span className="mx-1">→</span>
                                        {toTeam && <span className="text-[10px] opacity-70">{toTeam} / </span>}
                                        <span>{toLabel}</span>
                                    </span>
                                    {deliveryChip && (
                                        <span
                                            className={`text-[10px] px-1 rounded ${
                                                deliveryChip === 'injected'
                                                    ? 'bg-success/20 text-success'
                                                    : 'bg-warning/20 text-warning'
                                            }`}
                                            data-message-delivery
                                        >
                                            {deliveryChip}
                                        </span>
                                    )}
                                    <span
                                        className={`text-[10px] ${m.hasReply ? 'text-info' : 'text-spur-text-muted'}`}
                                        data-message-reply-badge
                                        data-message-reply-state={m.hasReply ? 'replied' : 'awaiting'}
                                    >
                                        {m.hasReply
                                            ? m.replyCount > 1
                                                ? `Replied (${m.replyCount})`
                                                : 'Replied'
                                            : 'Awaiting reply'}
                                    </span>
                                    <span className="ml-auto font-mono text-[10px]">{m.createdAt}</span>
                                </div>
                                <p className="text-spur-text mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                            </li>
                        );
                    })
                )}
            </ul>
        </div>
    );
}
