import { MessageFeedList, type MsgRow, useMessageFeed } from './AllTab';

/**
 * The supervisor endpoint in the message plane (0422 R3).
 *
 * There is no supervisor agent id in the message plane today — this single
 * exported constant is the one place to change when the M4 identity question
 * resolves. Do not invent a backend identity here.
 */
export const SUPERVISOR_ENDPOINT_ID = 'supervisor';

/** A row concerns the supervisor when it names the supervisor as sender or recipient. */
function isSupervisorTraffic(row: MsgRow): boolean {
    return row.fromId === SUPERVISOR_ENDPOINT_ID || row.toId === SUPERVISOR_ENDPOINT_ID;
}

/**
 * Supervisor tab — the All feed filtered to supervisor traffic (0422 R3).
 *
 * Read-only filtering: reuses the shared `useMessageFeed` and narrows to rows
 * whose sender or recipient is the supervisor endpoint. No routing change, no
 * new backend identity, no extra call.
 */
export default function SupervisorTab() {
    const { messages, error } = useMessageFeed();

    if (error)
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load messages: {error}
            </div>
        );
    if (messages === null) return <div className="p-4 text-sm text-spur-text-muted">Loading messages…</div>;

    const filtered = messages.filter(isSupervisorTraffic);
    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-supervisor-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-spur-surface shrink-0">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">
                    Message · supervisor
                </span>
            </div>
            <MessageFeedList messages={filtered} />
        </div>
    );
}
