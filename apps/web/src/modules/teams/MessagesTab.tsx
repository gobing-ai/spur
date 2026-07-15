import { useCallback, useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

interface MsgRow {
    id: string;
    fromId: string | null;
    toId: string;
    body: string;
    status: string;
    createdAt: string;
    inReplyTo: string | null;
}

const feedUrl = (limit = 50) => `${resolveApiUrl()}/messages?limit=${limit}`;
const sseUrl = () => `${resolveApiUrl()}/events/planning`;

/** SSE event names that signal a new message (metadata-only payloads). */
const MESSAGE_EVENT_NAMES = new Set(['message.sent', 'message.replied']);

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

    const load = useCallback(async () => {
        try {
            const res = await fetchWithTimeout(new Request(feedUrl()));
            if (!res.ok) throw new Error(`messages fetch failed: ${res.status}`);
            const body: unknown = await res.json();
            if (body && typeof body === 'object' && 'messages' in body) {
                setMessages((body as { messages: MsgRow[] }).messages);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        void load();
        const interval = setInterval(() => void load(), 10_000);
        return () => clearInterval(interval);
    }, [load]);

    // Live tail (0254 R6/AC5 pattern, retained): refetch the feed on a `message.*`
    // SSE event. Payloads are metadata-only (no body), so a matching event triggers
    // a refetch rather than an in-place append. The 10 s poll above remains the
    // safety net when SSE is unavailable.
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(sseUrl());
        es.onmessage = (frame) => {
            try {
                const raw: unknown = JSON.parse(frame.data);
                if (raw === null || typeof raw !== 'object') return;
                const name = (raw as { eventName?: unknown }).eventName;
                if (typeof name === 'string' && MESSAGE_EVENT_NAMES.has(name)) {
                    void load();
                }
            } catch {
                // Malformed frame — drop silently.
            }
        };
        return () => es.close();
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
                    Messages · all members
                </span>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                {messages.length === 0 ? (
                    <li className="text-sm text-spur-text-muted italic">No messages yet.</li>
                ) : (
                    messages.map((m) => (
                        <li key={m.id} className="p-2 bg-base-200 rounded text-xs">
                            <div className="flex gap-2 text-spur-text-muted">
                                <span data-message-route>
                                    {m.fromId ?? 'system'} → {m.toId}
                                </span>
                                <span className="ml-auto font-mono">{m.createdAt}</span>
                            </div>
                            <p className="text-spur-text mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                        </li>
                    ))
                )}
            </ul>
        </div>
    );
}
