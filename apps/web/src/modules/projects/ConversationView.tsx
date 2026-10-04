import { useEffect, useMemo, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import {
    buildRecentMessagesThread,
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

const messagesUrl = () => `${resolveApiUrl()}/messages?limit=100`;

/**
 * Conversation tab: shows the inter-agent and operator conversation thread
 * for the served project, rehydrated on mount from the message store.
 */
export default function ConversationView() {
    const project = useProjectContext();
    const [entries, setEntries] = useState<ConversationEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [agentFilter, setAgentFilter] = useState<string>('all');
    const [searchFilter, setSearchFilter] = useState<string>('');

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

        const fetchGlobalMessages = async () => {
            const res = await fetchWithTimeout(new Request(messagesUrl(), { signal: controller.signal }));
            if (!res.ok) throw new Error(`messages fetch failed: ${res.status}`);
            return parseInboxMessages(await res.json());
        };

        const fetchInbox = async (agent: string) => {
            const res = await fetchWithTimeout(new Request(inboxUrl(agent), { signal: controller.signal }));
            if (!res.ok) throw new Error(`inbox fetch failed: ${res.status}`);
            return parseInboxMessages(await res.json());
        };

        // Orchestrator inbox only when an instance is bound; the operator read
        // always runs (an unbound project still renders its response side).
        const orchestratorSide = instanceId !== null ? fetchInbox(instanceId) : Promise.resolve([]);

        // Try global message feed first (across all agents/instances and operator)
        fetchGlobalMessages()
            .then(async (globalMsgs) => {
                if (cancelled) return;
                if (globalMsgs.length > 0) {
                    setEntries(buildRecentMessagesThread(globalMsgs));
                    setFailed(false);
                    return;
                }
                const [toOrchestrator, toOperator] = await Promise.all([
                    orchestratorSide,
                    fetchInbox(OPERATOR_AGENT_ID),
                ]);
                if (!cancelled) {
                    setEntries(buildThread(toOrchestrator, toOperator));
                    setFailed(false);
                }
            })
            .catch(async () => {
                if (cancelled) return;
                try {
                    const [toOrchestrator, toOperator] = await Promise.all([
                        orchestratorSide,
                        fetchInbox(OPERATOR_AGENT_ID),
                    ]);
                    if (!cancelled) {
                        setEntries(buildThread(toOrchestrator, toOperator));
                        setFailed(false);
                    }
                } catch {
                    if (!cancelled) setFailed(true);
                }
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [project.path, instanceId]);

    const availableAgents = useMemo(() => {
        const seen = new Set<string>();
        for (const e of entries ?? []) {
            if (e.fromId) seen.add(e.fromId);
            if (e.toId) seen.add(e.toId);
        }
        return [...seen].sort();
    }, [entries]);

    const filteredEntries = useMemo(() => {
        if (!decorated) return null;
        return decorated.filter((e) => {
            if (agentFilter !== 'all' && e.fromId !== agentFilter && e.toId !== agentFilter) {
                return false;
            }
            if (searchFilter.trim()) {
                const q = searchFilter.toLowerCase();
                const matchText = e.text.toLowerCase().includes(q);
                const matchFrom = Boolean(e.fromId?.toLowerCase().includes(q));
                const matchTo = e.toId.toLowerCase().includes(q);
                const matchRef = e.refs.some((r) =>
                    r.kind === 'task' ? r.wbs.toLowerCase().includes(q) : r.id.toLowerCase().includes(q),
                );
                if (!matchText && !matchFrom && !matchTo && !matchRef) return false;
            }
            return true;
        });
    }, [decorated, agentFilter, searchFilter]);

    return (
        <div className="flex flex-col h-full overflow-hidden bg-spur-bg" data-conversation-view>
            {/* Filter controls */}
            {entries && entries.length > 0 && (
                <div className="p-2 border-b border-spur-border bg-spur-surface flex flex-wrap items-center gap-2 text-xs shrink-0">
                    <label className="flex items-center gap-1.5 text-spur-text-muted">
                        <span>Agent:</span>
                        <select
                            value={agentFilter}
                            onChange={(e) => setAgentFilter(e.target.value)}
                            className="bg-spur-surface-2 border border-spur-border text-spur-text rounded px-2 py-0.5 font-mono text-xs"
                        >
                            <option value="all">All agents ({entries.length})</option>
                            {availableAgents.map((ag) => (
                                <option key={ag} value={ag}>
                                    {ag}
                                </option>
                            ))}
                        </select>
                    </label>

                    <input
                        type="text"
                        placeholder="Search conversation..."
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                        className="bg-spur-surface-2 border border-spur-border text-spur-text rounded px-2 py-0.5 text-xs font-mono ml-auto w-48 focus:outline-none focus:border-spur-accent"
                    />

                    {(agentFilter !== 'all' || searchFilter) && (
                        <button
                            type="button"
                            onClick={() => {
                                setAgentFilter('all');
                                setSearchFilter('');
                            }}
                            className="text-xs text-spur-accent hover:underline px-1"
                        >
                            Reset
                        </button>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1.5" data-conversation-thread>
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
                        No messages yet for this project. Messages sent between agents, terminal, or via{' '}
                        <code className="font-mono text-spur-accent">spur message send</code> will appear here.
                    </div>
                )}
                {filteredEntries?.length === 0 && entries !== null && entries.length > 0 && (
                    <div className="p-4 text-sm text-spur-text-muted italic">No messages match the current filter.</div>
                )}
                {filteredEntries?.map((entry) => (
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
