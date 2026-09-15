import { useEffect, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { type ActivityRow, historyUrl, parseHistory } from './activity-history';
import { type InboxMessage, parseInboxMessages } from './conversation';
import MemberTerminal from './MemberTerminal';
import type { RosterEntry } from './roster';
import { useProjectContext } from './useProjectContext';

const inboxUrl = (agent: string) => `${resolveApiUrl()}/messages/inbox?agent=${encodeURIComponent(agent)}`;
const lifecycleUrl = (id: string, verb: 'start' | 'stop') =>
    `${resolveApiUrl()}/agents/${encodeURIComponent(id)}/${verb}`;

/**
 * Member detail pane (0842 R3/R4/R6): mounts the EXISTING transports only —
 * terminal (MemberTerminal over the process stream), messages (non-consuming
 * `GET /api/messages/inbox`), activity (`GET /api/events/history`) — and the
 * lifecycle verbs those transports already expose (start / stop / stdin via
 * the terminal input; R6 forbids inventing more). A pane, not a route, and
 * never a focus trap: Escape and the explicit close both route through
 * `onClose`, which restores focus to the opener card (AgentsView owns the
 * opener element).
 */
export default function MemberDetail({ entry, onClose }: { entry: RosterEntry; onClose: () => void }) {
    // 0857: the retired teams feed is gone (its only reader was this pane). The work
    // dir is now the fleet snapshot's project `path` (0835/0840) and the model is the
    // declared member's resolved model from that same snapshot — a member whose
    // executor profile declares none, and an undeclared live process, have nothing
    // to name (the latter reads `Unavailable`).
    const project = useProjectContext();
    const workDir = project.fleet?.path ?? project.path ?? 'Unavailable';
    const model = entry.declared === null ? 'Unavailable' : (entry.declared.model ?? 'Executor default');
    const [messages, setMessages] = useState<InboxMessage[] | null>(null);
    const [activity, setActivity] = useState<ActivityRow[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // R4: Escape closes the pane (focus restore lives in onClose).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Messages: one non-consuming read of the member's inbox on open.
    useEffect(() => {
        let cancelled = false;
        setMessages(null);
        fetchWithTimeout(new Request(inboxUrl(entry.instanceId)))
            .then(async (res) => (res.ok ? parseInboxMessages(await res.json()) : []))
            .then((rows) => {
                if (!cancelled) setMessages(rows);
            })
            .catch(() => {
                if (!cancelled) setMessages([]);
            });
        return () => {
            cancelled = true;
        };
    }, [entry.instanceId]);

    // Activity: the existing events-history surface, scoped to this member.
    // ponytail: read-on-open snapshot, no live SSE tail — add sseUrl tailing if the pane becomes a dwell surface.
    useEffect(() => {
        let cancelled = false;
        setActivity(null);
        fetchWithTimeout(new Request(historyUrl()))
            .then(async (res) => (res.ok ? parseHistory(await res.json()) : []))
            .then((rows) => {
                if (cancelled) return;
                setActivity(
                    (rows ?? []).filter((r) => r.memberLabel === entry.instanceId || r.actor === entry.instanceId),
                );
            })
            .catch(() => {
                if (!cancelled) setActivity([]);
            });
        return () => {
            cancelled = true;
        };
    }, [entry.instanceId]);

    // R6: start / stop — the verbs POST /api/agents/:id/{start,stop} expose,
    // disabled with the reason NAMED while the entry carries executor-unavailable
    // or unresolved. stdin rides the terminal's own input line.
    const blocked = entry.issues.includes('executor-unavailable') || entry.issues.includes('unresolved');
    const blockReason = entry.issues.includes('executor-unavailable')
        ? 'controls disabled — executor unavailable'
        : entry.issues.includes('unresolved')
          ? 'controls disabled — member unresolved'
          : null;

    const runLifecycle = async (verb: 'start' | 'stop') => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetchWithTimeout(new Request(lifecycleUrl(entry.instanceId, verb), { method: 'POST' }));
            if (!res.ok) setError(`${verb} failed: ${res.status}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    };

    const running = entry.observed.status === 'running';

    return (
        <div className="shrink-0 h-[55%] flex flex-col border-t border-spur-border bg-spur-surface" data-member-detail>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-spur-border shrink-0">
                <span className="text-sm font-semibold text-spur-text">{entry.declared?.role ?? 'member'}</span>
                <button
                    type="button"
                    className="ml-auto px-2 py-0.5 rounded-lg text-xs text-spur-text-muted hover:text-spur-text"
                    aria-label="Close member detail"
                    onClick={onClose}
                    data-member-detail-close
                >
                    close ✕
                </button>
            </div>
            <div className="px-3 py-2 border-b border-spur-border shrink-0 flex flex-col gap-1 text-xs">
                <span className="text-spur-text-muted">
                    declared:{' '}
                    <span className="text-spur-text">
                        {entry.declared === null
                            ? 'none'
                            : `${entry.declared.enabled ? 'enabled' : 'disabled'} · capability ${entry.declared.capabilityState}`}
                    </span>
                </span>
                <span className="text-spur-text-muted">
                    observed:{' '}
                    <span className="text-spur-text">
                        {entry.observed.status}
                        {entry.observed.pid !== null ? ` — pid ${entry.observed.pid}` : ''}
                        {entry.observed.exitCode !== null ? ` — exit ${entry.observed.exitCode}` : ''}
                    </span>
                </span>
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                    <dt className="text-spur-text-muted">Working directory</dt>
                    <dd className="font-mono text-spur-text break-all" data-member-workdir>
                        {workDir}
                    </dd>
                    <dt className="text-spur-text-muted">Model</dt>
                    <dd className="font-mono text-spur-text break-all" data-member-model>
                        {model}
                    </dd>
                </dl>
            </div>
            <div className="px-3 py-2 border-b border-spur-border shrink-0 flex items-center gap-2 flex-wrap">
                <button
                    type="button"
                    className="px-2 py-0.5 rounded-lg text-xs bg-spur-accent text-white disabled:opacity-40"
                    disabled={busy || blocked || running}
                    onClick={() => void runLifecycle('start')}
                    data-member-start
                >
                    start
                </button>
                <button
                    type="button"
                    className="px-2 py-0.5 rounded-lg text-xs bg-spur-surface-3 text-spur-text disabled:opacity-40"
                    disabled={busy || blocked || !running}
                    onClick={() => void runLifecycle('stop')}
                    data-member-stop
                >
                    stop
                </button>
                {blockReason !== null && (
                    <span className="text-xs text-spur-text-muted" data-lifecycle-reason>
                        {blockReason}
                    </span>
                )}
                {error !== null && (
                    <span className="text-xs text-error" role="alert" data-lifecycle-error>
                        {error}
                    </span>
                )}
            </div>
            <div className="flex-1 min-h-0 border-b border-spur-border">
                <MemberTerminal agentId={entry.instanceId} />
            </div>
            <div className="shrink-0 h-[35%] flex overflow-hidden">
                <div className="flex-1 overflow-y-auto p-2 border-r border-spur-border" data-member-messages>
                    <div className="text-xs font-semibold text-spur-text uppercase tracking-wide mb-1">Messages</div>
                    {(messages ?? []).length === 0 && (
                        <div className="text-xs text-spur-text-muted italic">
                            {messages === null ? 'Loading…' : 'No inbox messages.'}
                        </div>
                    )}
                    {(messages ?? []).slice(0, 20).map((m) => (
                        <div key={m.id} className="text-xs border-t border-spur-border py-1" data-member-message={m.id}>
                            <span className="font-mono text-spur-text-muted">
                                {m.fromId ?? 'system'} → {m.toId}
                            </span>
                            <span className="ml-1 px-1 rounded bg-spur-surface-3 text-spur-text">{m.status}</span>
                            <span className="ml-1 font-mono text-spur-text-muted">{m.createdAt}</span>
                            <p className="text-spur-text mt-0.5 whitespace-pre-wrap break-words">{m.body}</p>
                        </div>
                    ))}
                </div>
                <div className="flex-1 overflow-y-auto p-2" data-member-activity>
                    <div className="text-xs font-semibold text-spur-text uppercase tracking-wide mb-1">Activity</div>
                    {(activity ?? []).length === 0 && (
                        <div className="text-xs text-spur-text-muted italic">
                            {activity === null ? 'Loading…' : 'No activity for this member.'}
                        </div>
                    )}
                    {(activity ?? []).slice(0, 20).map((row) => (
                        <div
                            key={row.id}
                            className="text-xs border-t border-spur-border py-1"
                            data-member-activity-row={row.eventName}
                        >
                            <span className="font-mono text-spur-text-muted">{row.occurredAt}</span>{' '}
                            <span className="text-spur-text">{row.eventName}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
