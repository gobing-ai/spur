import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, CardBody, Loading } from '@/ui';
import { resolveApiUrl } from '../../lib/rpc-client';

/**
 * Wire shape of one inbox message from the `/api/messages/inbox` and
 * `/api/messages` endpoints. Both return the same envelope with a
 * `messages: InboxMessage[]` array (server/messages module).
 */
export interface InboxMessageRow {
    id: string;
    fromId: string | null;
    toId?: string;
    body: string;
    status: string;
    createdAt: string;
    inReplyTo: string | null;
}

/** Wire shape of the messages endpoints' JSON envelope. */
interface MessagesResponse {
    messages: InboxMessageRow[];
    count: number;
}

const INBOX_URL = `${resolveApiUrl()}/messages/inbox`;
const DEFAULT_AGENT = 'operator';
const DEFAULT_LIMIT = 50;

/**
 * Runtime-narrow an unknown network payload into a `MessagesResponse`, or
 * return `null` when the shape is wrong. Network input is untrusted — a
 * single bad row from the server must not crash the tab.
 */
function parseMessagesResponse(value: unknown): MessagesResponse | null {
    if (value === null || typeof value !== 'object') return null;
    if (!('messages' in value) || !('count' in value)) return null;
    const rawMessages = (value as { messages: unknown }).messages;
    if (!Array.isArray(rawMessages)) return null;
    const count = (value as { count: unknown }).count;
    if (typeof count !== 'number') return null;
    const messages: InboxMessageRow[] = [];
    for (const raw of rawMessages) {
        const msg = parseInboxMessage(raw);
        if (!msg) return null;
        messages.push(msg);
    }
    return { messages, count };
}

/** Runtime-narrow one inbox message row. */
function parseInboxMessage(value: unknown): InboxMessageRow | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== 'string') return null;
    if (typeof obj.body !== 'string') return null;
    if (typeof obj.status !== 'string') return null;
    if (typeof obj.createdAt !== 'string') return null;
    const fromId = obj.fromId;
    if (fromId !== null && typeof fromId !== 'string') return null;
    const toId = obj.toId;
    if (toId !== undefined && typeof toId !== 'string') return null;
    const inReplyTo = obj.inReplyTo;
    if (inReplyTo !== null && typeof inReplyTo !== 'string') return null;
    return {
        id: obj.id,
        body: obj.body,
        status: obj.status,
        createdAt: obj.createdAt,
        fromId,
        ...(toId !== undefined ? { toId } : {}),
        inReplyTo,
    };
}

/**
 * Inbox Messages tab (task 0189 R5).
 *
 * Loads the agent's inbox queue from `/api/messages/inbox?agent=` and groups
 * messages by `inReplyTo` so threads surface as a single cluster with
 * sender/recipient/timestamp context per row.
 *
 * Live tail for new messages lands with task 0193 (messages module +
 * send/reply APIs); v1 polls on focus and on a 15 s interval as a safety net
 * so the operator sees new rows without re-opening the tab.
 */
export default function InboxTab() {
    const [messages, setMessages] = useState<InboxMessageRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (signal: AbortSignal): Promise<void> => {
        try {
            const url = `${INBOX_URL}?agent=${encodeURIComponent(DEFAULT_AGENT)}&limit=${DEFAULT_LIMIT}`;
            const res = await fetch(url, { signal });
            if (!res.ok) throw new Error(`inbox fetch failed: ${res.status}`);
            const raw: unknown = await res.json();
            const body = parseMessagesResponse(raw);
            if (!body) throw new Error('inbox response failed schema validation');
            setMessages(body.messages);
        } catch (err) {
            if (signal.aborted) return;
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        const interval = setInterval(() => void load(new AbortController().signal), 15_000);
        const onFocus = () => void load(new AbortController().signal);
        globalThis.addEventListener?.('focus', onFocus);
        return () => {
            controller.abort();
            clearInterval(interval);
            globalThis.removeEventListener?.('focus', onFocus);
        };
    }, [load]);

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load inbox: {error}
            </div>
        );
    }
    if (messages === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading inbox…
            </div>
        );
    }
    if (messages.length === 0) {
        return (
            <div className="p-4 text-sm text-spur-text-muted italic">
                No messages yet. New messages will appear here as they arrive.
            </div>
        );
    }

    // Group by inReplyTo so threads cluster visually. Top-level messages (no
    // inReplyTo) form their own groups keyed by their own id so the flat list
    // is partitionable for any future "expand thread" affordance.
    const groups = new Map<string, InboxMessageRow[]>();
    for (const msg of messages) {
        const key = msg.inReplyTo ?? msg.id;
        const list = groups.get(key) ?? [];
        list.push(msg);
        groups.set(key, list);
    }
    // Render order is the iteration order of the Map (insertion order = the
    // order of first appearance in the newest-first feed). Preserve that order
    // by keying on the thread key itself, not the array index.
    const grouped = Array.from(groups.entries());

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">Inbox Messages</span>
                <span className="ml-2 text-xs text-spur-text-muted">{messages.length} message(s)</span>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-2" data-inbox-tab>
                {grouped.map(([key, thread]) => (
                    <li key={key}>
                        <Card variant="compact" className="bg-base-200 border border-spur-border">
                            <CardBody className="p-3 gap-2">
                                {thread.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className="border-b border-spur-border last:border-b-0 pb-2 last:pb-0"
                                    >
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <Badge variant="outline" size="xs">
                                                {msg.status}
                                            </Badge>
                                            <span className="text-xs text-spur-text">
                                                {msg.fromId ?? 'system'} → {msg.toId ?? '?'}
                                            </span>
                                            {msg.inReplyTo && (
                                                <span className="text-[10px] text-spur-text-muted">
                                                    reply to {msg.inReplyTo.slice(0, 8)}
                                                </span>
                                            )}
                                            <span
                                                className="text-[10px] text-spur-text-muted ml-auto font-mono"
                                                title={msg.createdAt}
                                            >
                                                {msg.createdAt}
                                            </span>
                                        </div>
                                        <p className="text-sm text-spur-text leading-snug whitespace-pre-wrap break-words">
                                            {msg.body}
                                        </p>
                                    </div>
                                ))}
                            </CardBody>
                        </Card>
                    </li>
                ))}
            </ul>
        </div>
    );
}
