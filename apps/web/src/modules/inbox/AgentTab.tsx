import { MessageFeedList, type MsgRow, useMessageFeed } from './AllTab';

/** Messages involving `agentId` — the durable half of the per-agent view (R2). */
function agentMessages(messages: MsgRow[], agentId: string): MsgRow[] {
    return messages.filter((m) => m.fromId === agentId || m.toId === agentId);
}

/**
 * Per-agent tab — durable message history for one agent (0422 R5, G3/ADR-052).
 *
 * Task 0197 removed the process-frame merge: this tab is a durable-message
 * filter only. It reuses the shared `useMessageFeed` and narrows to rows whose
 * sender or recipient is `agentId`. It opens no process `EventSource` and
 * renders no stdout/stderr rows — Teams exclusively owns the process plane.
 */
export default function AgentTab({ agentId }: { agentId: string }) {
    const { messages, error } = useMessageFeed();

    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load messages: {error}
            </div>
        );
    if (messages === null) return <div className="p-4 text-sm text-spur-text-muted">Loading messages…</div>;

    const filtered = agentMessages(messages, agentId);
    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-agent-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-spur-surface shrink-0 flex items-center gap-2">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">Messages</span>
                <span className="font-mono text-xs text-spur-text-muted">{agentId}</span>
            </div>
            <MessageFeedList messages={filtered} />
        </div>
    );
}
