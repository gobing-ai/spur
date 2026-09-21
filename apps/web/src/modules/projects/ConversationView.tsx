import { useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import {
    buildThread,
    type ConversationEntry,
    type ConversationRef,
    OPERATOR_AGENT_ID,
    parseInboxMessages,
} from './conversation';
import { classifyReceipt, RECEIPT_LABELS, type RequestReceipt } from './receipt';
import { useProjectContext } from './useProjectContext';
import { useProjectRequests } from './useProjectRequests';

function inboxUrl(agent: string): string {
    return `${resolveApiUrl()}/messages/inbox?agent=${encodeURIComponent(agent)}`;
}

/**
 * Conversation tab (0841 R1/R4, feature G63): one request/response thread for
 * the served project, rehydrated on mount from the two non-consuming inbox
 * reads — never from client state. Submission is handled by GlobalAgentBar.
 */
export default function ConversationView() {
    const project = useProjectContext();
    const [entries, setEntries] = useState<ConversationEntry[] | null>(null);
    const [failed, setFailed] = useState(false);

    const instanceId = project.fleet?.orchestrator.instanceId ?? null;
    const { requests, failed: requestsFailed } = useProjectRequests(instanceId);

    // Join the thread to the durable results feed (0844): entries match
    // receipts on ConversationEntry.id === RequestReceipt.messageId.
    const decorated =
        entries?.map((entry) => {
            const receipt = requests.get(entry.id);
            return receipt === undefined ? entry : { ...entry, requestKey: receipt.requestKey ?? undefined, receipt };
        }) ?? null;

    useEffect(() => {
        if (project.path === null) return;
        const controller = new AbortController();
        let cancelled = false;

        const fetchInbox = async (agent: string) => {
            const res = await fetchWithTimeout(new Request(inboxUrl(agent), { signal: controller.signal }));
            if (!res.ok) throw new Error(`inbox fetch failed: ${res.status}`);
            return parseInboxMessages(await res.json());
        };

        // Orchestrator inbox only when an instance is bound; the operator read
        // always runs (an unbound project still renders its response side).
        const orchestratorSide = instanceId !== null ? fetchInbox(instanceId) : Promise.resolve([]);
        Promise.all([orchestratorSide, fetchInbox(OPERATOR_AGENT_ID)])
            .then(([toOrchestrator, toOperator]) => {
                if (!cancelled) {
                    setEntries(buildThread(toOrchestrator, toOperator));
                    setFailed(false);
                }
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [project.path, instanceId]);

    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-conversation-view>
            <div className="flex-1 overflow-y-auto p-2 space-y-1" data-conversation-thread>
                {entries === null && !failed && (
                    <div className="p-4 text-sm text-spur-text-muted italic" data-conversation-loading>
                        Loading conversation…
                    </div>
                )}
                {failed && (
                    <div className="p-4 text-sm text-spur-text-muted" data-conversation-fetch-failed role="alert">
                        Conversation unavailable — the message feed could not be read.
                    </div>
                )}
                {requestsFailed && !failed && (
                    <div className="p-4 text-xs text-spur-text-muted" data-conversation-requests-failed role="status">
                        Results feed unavailable — receipt states may be stale.
                    </div>
                )}
                {entries !== null && entries.length === 0 && (
                    <div className="p-4 text-sm text-spur-text-muted italic" data-conversation-empty>
                        No messages yet for this project.
                    </div>
                )}
                {decorated?.map((entry) => (
                    <ConversationRow key={entry.id} entry={entry} />
                ))}
            </div>
        </div>
    );
}

function refKey(ref: ConversationRef): string {
    return ref.kind === 'task' ? `task:${ref.wbs}` : `feature:${ref.id}`;
}

function ConversationRow({ entry }: { entry: ConversationEntry }) {
    const receipt = entry.receipt as RequestReceipt | undefined;
    const state = classifyReceipt(receipt ?? null, null, false);
    const label = RECEIPT_LABELS[state];
    return (
        <div
            className="p-2 bg-spur-surface-2 border border-spur-border rounded-xl text-sm"
            data-conversation-entry
            data-conversation-kind={entry.kind}
        >
            <div className="flex items-center gap-2 text-spur-text-muted text-xs">
                <span className="font-medium text-spur-text">{entry.kind === 'request' ? 'Request' : 'Response'}</span>
                <span className="font-mono truncate" data-conversation-route>
                    {entry.fromId ?? 'system'} → {entry.toId}
                </span>
                <span className="text-xs px-1 rounded bg-spur-surface-3 text-spur-text" data-conversation-delivery>
                    {entry.deliveryStatus}
                </span>
                {entry.kind === 'request' && (
                    <span
                        className="text-xs px-1 rounded font-medium"
                        data-conversation-receipt-state={state}
                        title={`${label.meaning} Next: ${label.action}`}
                    >
                        <span aria-hidden="true">{label.icon}</span> {label.label}
                    </span>
                )}
                {entry.inReplyTo !== null && (
                    <span className="font-mono text-xs opacity-70" data-conversation-reply-to>
                        ↩ {entry.inReplyTo}
                    </span>
                )}
                <span className="ml-auto font-mono text-xs text-spur-text-muted">{entry.createdAt}</span>
            </div>
            {entry.refs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1" data-conversation-entry-refs>
                    {entry.refs.map((ref) => (
                        <span
                            key={refKey(ref)}
                            className="text-xs px-1 rounded bg-info/20 text-info font-mono"
                            data-conversation-ref={ref.kind}
                        >
                            {ref.kind === 'task' ? `task ${ref.wbs}` : `feature ${ref.id}`}
                        </span>
                    ))}
                </div>
            )}
            <p className="text-spur-text mt-1 whitespace-pre-wrap break-words">{entry.text}</p>
        </div>
    );
}
