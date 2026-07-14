import { useCallback, useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { useTeamsSelection } from './TeamsContext';

interface MsgRow {
    id: string;
    fromId: string | null;
    body: string;
    status: string;
    createdAt: string;
    inReplyTo: string | null;
}

const inboxUrl = (agent: string) => `${resolveApiUrl()}/messages/inbox?agent=${encodeURIComponent(agent)}`;
const sendUrl = () => `${resolveApiUrl()}/messages`;

/** Messages tab — selected member's inbox + dispatch composer (R6). */
export default function MessagesTab() {
    const { selectedMemberId } = useTeamsSelection();
    const [messages, setMessages] = useState<MsgRow[] | null>(null);
    const [compose, setCompose] = useState('');
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (agent: string) => {
        try {
            const res = await fetchWithTimeout(new Request(inboxUrl(agent)));
            if (!res.ok) throw new Error(`inbox fetch failed: ${res.status}`);
            const body: unknown = await res.json();
            if (body && typeof body === 'object' && 'messages' in body) {
                setMessages((body as { messages: MsgRow[] }).messages);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        if (!selectedMemberId) return;
        setMessages(null);
        void load(selectedMemberId);
        const interval = setInterval(() => void load(selectedMemberId), 10_000);
        return () => clearInterval(interval);
    }, [selectedMemberId, load]);

    const send = useCallback(async () => {
        if (!selectedMemberId || compose.length === 0) return;
        try {
            await fetchWithTimeout(
                new Request(sendUrl(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fromId: null, toId: selectedMemberId, body: compose }),
                }),
            );
            setCompose('');
            void load(selectedMemberId);
        } catch {
            // Non-fatal.
        }
    }, [selectedMemberId, compose, load]);

    if (!selectedMemberId) {
        return (
            <div className="p-4 text-sm text-spur-text-muted italic">
                Select a member from the Roster to view messages.
            </div>
        );
    }
    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load inbox: {error}
            </div>
        );
    if (messages === null) return <div className="p-4 text-sm text-spur-text-muted">Loading inbox…</div>;

    return (
        <div className="flex flex-col h-full overflow-hidden" data-messages-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                    Messages · {selectedMemberId}
                </span>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
                {messages.length === 0 ? (
                    <li className="text-sm text-spur-text-muted italic">No messages yet.</li>
                ) : (
                    messages.map((m) => (
                        <li key={m.id} className="p-2 bg-base-200 rounded text-xs">
                            <div className="flex gap-2 text-spur-text-muted">
                                <span>{m.fromId ?? 'system'}</span>
                                <span className="ml-auto font-mono">{m.createdAt}</span>
                            </div>
                            <p className="text-spur-text mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                        </li>
                    ))
                )}
            </ul>
            <div className="flex gap-2 px-2 py-2 border-t border-spur-border bg-base-200 shrink-0">
                <input
                    type="text"
                    value={compose}
                    onChange={(e) => setCompose(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void send();
                    }}
                    placeholder="Type a message and press Enter…"
                    className="flex-1 input input-sm"
                    data-messages-composer
                />
            </div>
        </div>
    );
}
