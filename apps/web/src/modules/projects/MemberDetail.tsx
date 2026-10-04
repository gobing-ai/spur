import { useEffect, useRef, useState } from 'react';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { type ActivityRow, historyUrl, parseHistory } from './activity-history';
import { type InboxMessage, parseInboxMessages } from './conversation';
import MemberTerminal from './MemberTerminal';
import { type RosterEntry, sessionLabel } from './roster';
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
export default function MemberDetail({
    entry,
    onClose,
    execution,
    fullCommand,
    className,
}: {
    entry: RosterEntry;
    onClose: () => void;
    execution?: { command: string; args: string[]; exitCode?: number | null } | null;
    fullCommand?: string;
    className?: string;
}) {
    // 0857: the retired teams feed is gone (its only reader was this pane). The work
    // dir is now the fleet snapshot's project `path` (0835/0840) and the model is the
    // declared member's resolved model from that same snapshot — a member whose
    // executor profile declares none, and an undeclared live process, have nothing
    // to name (the latter reads `Unavailable`).
    const project = useProjectContext();
    const workDir = project.fleet?.path ?? project.path ?? 'Unavailable';
    const model = entry.declared === null ? 'Unavailable' : (entry.declared.model ?? 'Executor default');
    const roleName = entry.declared?.role;
    const roleConfig = project.fleet?.roles?.find((r) => r.name === roleName);
    const stages =
        roleConfig?.stages && roleConfig.stages.length > 0
            ? roleConfig.stages
            : (project.fleet?.stages?.filter((s) => s.role === roleName).map((s) => s.id) ?? []);
    const executorName = entry.declared?.executor ?? roleConfig?.electedExecutor ?? 'Unavailable';
    const activeSession = entry.observed.session ?? entry.declared?.session;
    const [messages, setMessages] = useState<InboxMessage[] | null>(null);
    const [activity, setActivity] = useState<ActivityRow[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showTerminal, setShowTerminal] = useState(true);
    const [showInfoPopup, setShowInfoPopup] = useState(false);
    const [copied, setCopied] = useState(false);
    const popupRef = useRef<HTMLDivElement>(null);

    // Close details popup on click outside.
    useEffect(() => {
        if (!showInfoPopup) return;
        const onDocClick = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                setShowInfoPopup(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [showInfoPopup]);

    // R4: Escape closes popup if open, otherwise closes the pane (focus restore lives in onClose).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showInfoPopup) {
                    setShowInfoPopup(false);
                } else {
                    onClose();
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose, showInfoPopup]);

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

    const titleTooltip = [
        `Role: ${entry.declared?.role ?? 'member'}`,
        `Executor: ${executorName}`,
        `Model: ${model}`,
        `Status: ${entry.observed.status}${entry.observed.pid !== null ? ` — pid ${entry.observed.pid}` : ''}`,
        'Click to toggle agent details',
    ].join('\n');

    return (
        <div
            className={`flex flex-col bg-spur-surface overflow-hidden ${className ?? 'h-full shrink-0 border-t border-spur-border'}`}
            data-member-detail
        >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-spur-border shrink-0 relative">
                {/* Title area with interactive popup window trigger */}
                <div className="relative">
                    <button
                        type="button"
                        className="flex items-center gap-1.5 text-left group cursor-pointer focus:outline-none"
                        onClick={() => setShowInfoPopup((v) => !v)}
                        title={titleTooltip}
                        aria-expanded={showInfoPopup}
                        aria-haspopup="dialog"
                    >
                        <span className="text-sm font-semibold text-spur-text group-hover:text-spur-accent transition-colors">
                            {entry.declared?.role ?? 'member'}
                        </span>
                        <span className="text-xs font-mono text-spur-text-muted">({entry.instanceId})</span>
                        {entry.isOrchestrator && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-spur-accent/20 text-spur-accent font-medium uppercase tracking-wide">
                                orchestrator
                            </span>
                        )}
                        <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
                                showInfoPopup
                                    ? 'bg-spur-accent/20 text-spur-accent border-spur-accent/40 font-medium'
                                    : 'bg-spur-surface-2 text-spur-text-muted group-hover:text-spur-text border-spur-border/70'
                            }`}
                        >
                            <span aria-hidden="true">ℹ️</span>
                            <span>info</span>
                        </span>
                    </button>

                    {/* Folded metadata popup window */}
                    <div
                        ref={popupRef}
                        role="dialog"
                        aria-label="Agent member details"
                        className={`absolute top-full left-0 mt-2 z-50 w-[420px] max-w-[90vw] p-3 rounded-xl bg-spur-surface border border-spur-border shadow-2xl text-xs flex flex-col gap-2 transition-all ${
                            showInfoPopup
                                ? 'opacity-100 visible pointer-events-auto translate-y-0'
                                : 'opacity-0 invisible pointer-events-none -translate-y-1'
                        }`}
                    >
                        <div className="flex items-center justify-between pb-1.5 border-b border-spur-border">
                            <span className="font-semibold text-spur-text">
                                {entry.declared?.role ?? 'member'} ({entry.instanceId})
                            </span>
                            <button
                                type="button"
                                className="text-spur-text-muted hover:text-spur-text p-0.5 rounded cursor-pointer"
                                onClick={() => setShowInfoPopup(false)}
                                aria-label="Close details popup"
                            >
                                ✕
                            </button>
                        </div>
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
                        <span className="text-spur-text-muted flex items-center justify-between" data-member-session>
                            <span>
                                session:{' '}
                                <span className="font-mono text-spur-text">{sessionLabel(activeSession) ?? '—'}</span>
                            </span>
                            {activeSession?.id && (
                                <button
                                    type="button"
                                    className="px-1.5 py-0.5 rounded text-[10px] bg-spur-surface-2 hover:bg-spur-surface-3 border border-spur-border text-spur-text cursor-pointer transition-colors"
                                    onClick={() => {
                                        void navigator.clipboard?.writeText(activeSession?.id ?? '');
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 1500);
                                    }}
                                    title={`Copy session id: ${activeSession.id}`}
                                    data-copy-session-id
                                >
                                    {copied ? 'copied!' : 'copy id'}
                                </button>
                            )}
                        </span>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 pt-1 border-t border-spur-border">
                            <dt className="text-spur-text-muted">Process Stream</dt>
                            <dd className="font-mono text-spur-text break-all" data-member-stream-url>
                                /api/processes/{entry.instanceId}/stream
                            </dd>
                            <dt className="text-spur-text-muted">Role</dt>
                            <dd className="font-mono text-spur-text break-all" data-member-role>
                                {entry.declared?.role ?? 'member'}
                            </dd>
                            <dt className="text-spur-text-muted">Executor</dt>
                            <dd className="font-mono text-spur-text break-all" data-member-executor>
                                {executorName}
                            </dd>
                            <dt className="text-spur-text-muted">Model</dt>
                            <dd className="font-mono text-spur-text break-all" data-member-model>
                                {model}
                            </dd>
                            {stages.length > 0 && (
                                <>
                                    <dt className="text-spur-text-muted">Stages</dt>
                                    <dd className="flex items-center gap-1 flex-wrap" data-member-stages>
                                        {stages.map((st) => (
                                            <span
                                                key={st}
                                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-base-200 text-spur-text-muted border border-spur-border/60"
                                            >
                                                {st}
                                            </span>
                                        ))}
                                    </dd>
                                </>
                            )}
                            <dt className="text-spur-text-muted">Working directory</dt>
                            <dd className="font-mono text-spur-text break-all" data-member-workdir>
                                {workDir}
                            </dd>
                        </dl>
                        {(fullCommand || execution?.command) && (
                            <div className="mt-1 pt-1 border-t border-spur-border/50 text-xs">
                                <span className="text-spur-text-muted text-[11px]">Command: </span>
                                <code className="font-mono text-[11px] text-spur-text break-all bg-spur-surface-2 p-1 rounded border border-spur-border block">
                                    {fullCommand ?? `${execution?.command} ${(execution?.args ?? []).join(' ')}`}
                                </code>
                            </div>
                        )}
                    </div>
                </div>

                {/* Toolbar on right: start, stop, >_ Terminal, close ✕ */}
                <div className="ml-auto flex items-center gap-2">
                    {blockReason !== null && (
                        <span className="text-xs text-spur-text-muted hidden sm:inline" data-lifecycle-reason>
                            {blockReason}
                        </span>
                    )}
                    {error !== null && (
                        <span className="text-xs text-error" role="alert" data-lifecycle-error>
                            {error}
                        </span>
                    )}
                    <button
                        type="button"
                        className="px-2 py-0.5 rounded-lg text-xs bg-spur-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity cursor-pointer disabled:cursor-not-allowed font-medium"
                        disabled={busy || blocked || running}
                        onClick={() => void runLifecycle('start')}
                        data-member-start
                    >
                        start
                    </button>
                    <button
                        type="button"
                        className="px-2 py-0.5 rounded-lg text-xs bg-spur-surface-3 text-spur-text disabled:opacity-40 hover:bg-spur-surface-2 transition-colors border border-spur-border cursor-pointer disabled:cursor-not-allowed font-medium"
                        disabled={busy || blocked || !running}
                        onClick={() => void runLifecycle('stop')}
                        data-member-stop
                    >
                        stop
                    </button>
                    <button
                        type="button"
                        className={`px-2 py-0.5 rounded text-xs font-mono flex items-center gap-1 transition-colors border cursor-pointer ${
                            showTerminal
                                ? 'bg-spur-accent/20 text-spur-accent border-spur-accent/40'
                                : 'bg-spur-surface-2 text-spur-text-muted hover:text-spur-text border-spur-border'
                        }`}
                        aria-label="Toggle stdout/stderr terminal"
                        data-detail-toggle-terminal
                        onClick={() => setShowTerminal((v) => !v)}
                        title="Toggle live stdout/stderr process stream"
                    >
                        <span>&gt;_</span>
                        <span>Terminal</span>
                    </button>
                    <button
                        type="button"
                        className="px-2 py-0.5 rounded-lg text-xs text-spur-text-muted hover:text-spur-text cursor-pointer"
                        aria-label="Close member detail"
                        onClick={onClose}
                        data-member-detail-close
                    >
                        close ✕
                    </button>
                </div>
            </div>
            {showTerminal && (
                <div className="flex-1 min-h-[180px] border-b border-spur-border flex flex-col">
                    <div className="px-3 py-1 bg-spur-surface-2 border-b border-spur-border text-[11px] font-mono text-spur-text-muted flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2">
                            <span>stdout / stderr live stream</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-spur-surface-3 text-spur-text-muted border border-spur-border/70 hidden sm:inline">
                                /api/processes/{entry.instanceId}/stream
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {activeSession?.id && (
                                <span
                                    className="text-[10px] text-spur-text-muted hidden md:inline"
                                    data-stream-session-id
                                >
                                    session: <code className="text-spur-accent font-mono">{activeSession.id}</code>
                                </span>
                            )}
                            <span className="text-[10px] text-spur-accent font-semibold">SSE</span>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0">
                        <MemberTerminal agentId={entry.instanceId} sessionId={activeSession?.id} />
                    </div>
                </div>
            )}
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
