/**
 * Projects → Inbox (G11 R1, ADR-143 §13).
 *
 * Three panes over the typed inbox contract: the member list, the selected member's two-direction
 * thread, and a composer. Everything reads and writes through `api.inbox.*`; the browser holds no
 * message store of its own. Live updates ride the SSE `message.*` frames the server relays from the
 * ledger, so a reply written by an agent CLI process shows up here without a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, resolveApiUrl } from '../../lib/rpc-client';
import { useProjectContext } from './useProjectContext';

/** One inbox row as the contract returns it. */
type InboxRow = Awaited<ReturnType<typeof api.inbox.list>>['messages'][number];
/** One address with its counts. */
type MemberRow = Awaited<ReturnType<typeof api.inbox.members>>[number];

/** Operator identity: the human, in both the CLI and this global input. */
const OPERATOR_ID = 'operator';
const SSE_URL = () => `${resolveApiUrl()}/events/planning`;

/** A member whose address belongs to the declared fleet sorts above ad-hoc/generated addresses. */
export function memberRank(member: MemberRow, fleetIds: readonly string[]): number {
    return fleetIds.includes(member.id) ? 0 : 1;
}

/** Group rows into threads by their root id, oldest thread first. */
export function groupThreads(rows: readonly InboxRow[]): InboxRow[][] {
    const byThread = new Map<string, InboxRow[]>();
    for (const row of rows) {
        const key = row.threadId || row.id;
        const bucket = byThread.get(key);
        if (bucket === undefined) byThread.set(key, [row]);
        else bucket.push(row);
    }
    const threads = [...byThread.values()].map((thread) => thread.sort((a, b) => a.createdAt - b.createdAt));
    return threads.sort((a, b) => (a[0]?.createdAt ?? 0) - (b[0]?.createdAt ?? 0));
}

/**
 * Which panes one SSE frame invalidates. Every `message.*` frame can change a member's counts, so
 * the member list always refetches; the thread refetches only when the frame names the selected
 * member as sender or recipient (R1). A frame that carries neither id fails open: refetching an
 * idempotent read is cheaper than a thread that silently stops updating.
 */
export function frameTargets(frame: unknown, selected: string | null): { members: boolean; thread: boolean } {
    if (frame === null || typeof frame !== 'object') return { members: false, thread: false };
    const { eventName, payload } = frame as { eventName?: unknown; payload?: { data?: unknown } };
    if (typeof eventName !== 'string' || !eventName.startsWith('message.')) return { members: false, thread: false };
    const data = (payload?.data ?? null) as { fromId?: unknown; toId?: unknown } | null;
    const ids = [data?.fromId, data?.toId].filter((id): id is string => typeof id === 'string');
    return { members: true, thread: ids.length === 0 || (selected !== null && ids.includes(selected)) };
}

/** A refreshed newest page merged over older pages already loaded; the fresh copy of a row wins. */
export function mergePages(fresh: readonly InboxRow[], loaded: readonly InboxRow[]): InboxRow[] {
    const ids = new Set(fresh.map((row) => row.id));
    return [...fresh, ...loaded.filter((row) => !ids.has(row.id))];
}

/** The status label the operator reads for one row. */
export function statusLabel(row: InboxRow): string {
    if (row.status === 'failed') return `failed${row.error ? ` — ${row.error}` : ''}`;
    return row.status;
}

/** The inbox procedures this tab uses. `api` is the default; tests inject a stub. */
export interface InboxClient {
    members: typeof api.inbox.members;
    list: typeof api.inbox.list;
    send: typeof api.inbox.send;
    reply: typeof api.inbox.reply;
    read: typeof api.inbox.read;
}

/**
 * The production client, bound ONCE.
 *
 * `api.inbox` is a proxy whose property access returns a fresh client, so using it directly as a
 * default prop handed the data effects a new identity on every render — and their `setState`
 * re-rendered again: an unbounded refetch loop. A module constant is the stable identity the
 * effects need.
 */
const INBOX_CLIENT: InboxClient = api.inbox;

/** The Projects Inbox tab. */
export default function InboxView({ client = INBOX_CLIENT }: { client?: InboxClient } = {}) {
    const project = useProjectContext();
    const [members, setMembers] = useState<MemberRow[] | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [rows, setRows] = useState<InboxRow[] | null>(null);
    // The cursor of the oldest page loaded so far; null once the thread's first row is on screen.
    const [olderCursor, setOlderCursor] = useState<string | null>(null);
    const [replyTo, setReplyTo] = useState<InboxRow | null>(null);
    const [draft, setDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    // Separate refetch keys so a frame about another member refreshes the counts, not this thread.
    const [membersTick, setMembersTick] = useState(0);
    const [threadTick, setThreadTick] = useState(0);
    const refresh = useCallback(() => {
        setMembersTick((tick) => tick + 1);
        setThreadTick((tick) => tick + 1);
    }, []);
    // Read by the SSE handler, which must not reconnect on every member switch.
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    // Which member `rows` belongs to, and whether older pages were appended to it.
    const paging = useRef<{ member: string | null; pagedOlder: boolean }>({ member: null, pagedOlder: false });

    const fleetIds = useMemo(() => (project.fleet?.members ?? []).map((member) => member.instanceId), [project.fleet]);

    // ── live tail ──────────────────────────────────────────────────────────
    // `message.*` frames are metadata-only, so each one bumps the refetch keys it touches. There is deliberately
    // no polling fallback: the transport that cannot stream gets the explicit Refresh action
    // instead of a timer that keeps the tab reading forever.
    useEffect(() => {
        if (project.path === null) return;
        if (typeof EventSource === 'undefined') return;
        const stream = new EventSource(SSE_URL());
        stream.onmessage = (message) => {
            try {
                const targets = frameTargets(JSON.parse(message.data), selectedRef.current);
                if (targets.members) setMembersTick((tick) => tick + 1);
                if (targets.thread) setThreadTick((tick) => tick + 1);
            } catch {
                // A malformed frame is not worth a state update.
            }
        };
        return () => stream.close();
    }, [project.path]);

    // ── member list ────────────────────────────────────────────────────────
    useEffect(() => {
        void membersTick;
        if (project.path === null) return;
        let cancelled = false;
        void (async () => {
            try {
                const list = await client.members({});
                if (cancelled) return;
                setMembers(list);
                setSelected((current) => current ?? list[0]?.id ?? null);
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : 'could not read the member list');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [client, project.path, membersTick]);

    // ── selected member's thread ───────────────────────────────────────────
    useEffect(() => {
        void threadTick;
        if (project.path === null || selected === null) return;
        let cancelled = false;
        void (async () => {
            try {
                const page = await client.list({ member: selected, direction: 'both' });
                if (!cancelled) {
                    // Older pages the operator already loaded for THIS member stay on screen across
                    // a live refetch, and their cursor keeps pointing past them. A member switch
                    // starts over from the newest page.
                    const sameMember = paging.current.member === selected;
                    setRows((current) => (sameMember ? mergePages(page.messages, current ?? []) : page.messages));
                    if (!sameMember || !paging.current.pagedOlder) setOlderCursor(page.nextCursor);
                    if (!sameMember) paging.current = { member: selected, pagedOlder: false };
                    setError(null);
                }
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : 'could not read this thread');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [client, project.path, selected, threadTick]);

    const loadOlder = useCallback(async () => {
        if (selected === null || olderCursor === null) return;
        try {
            const page = await client.list({ member: selected, direction: 'both', cursor: olderCursor });
            setRows((current) => mergePages(current ?? [], page.messages));
            setOlderCursor(page.nextCursor);
            paging.current = { member: selected, pagedOlder: true };
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'could not read older messages');
        }
    }, [client, selected, olderCursor]);

    const send = useCallback(async () => {
        const body = draft.trim();
        if (body === '' || selected === null) return;
        try {
            if (replyTo !== null) {
                await client.reply({ id: replyTo.id, from: OPERATOR_ID, body });
            } else {
                await client.send({
                    to: selected,
                    ...(project.path !== null ? { projectPath: project.path } : {}),
                    body,
                });
            }
            setDraft('');
            setReplyTo(null);
            refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'the message was not sent');
        }
    }, [client, draft, replyTo, selected, project.path, refresh]);

    const markRead = useCallback(
        async (row: InboxRow) => {
            try {
                await client.read({ id: row.id, reader: OPERATOR_ID });
                refresh();
            } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'could not mark this message read');
            }
        },
        [client, refresh],
    );

    const ordered = useMemo(() => {
        if (members === null) return [];
        return [...members].sort(
            (a, b) => memberRank(a, fleetIds) - memberRank(b, fleetIds) || a.id.localeCompare(b.id),
        );
    }, [members, fleetIds]);
    const threads = useMemo(() => groupThreads(rows ?? []), [rows]);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr', gap: 16 }}>
            <aside aria-label="Inbox members">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <h3 style={{ margin: 0, fontSize: 13, color: 'var(--color-spur-text-muted)' }}>Members</h3>
                    {/* The explicit refresh that replaces a polling fallback. */}
                    <button type="button" onClick={refresh} title="Refetch the member list and thread">
                        Refresh
                    </button>
                </div>
                {ordered.length === 0 ? (
                    <p style={{ color: 'var(--color-spur-text-faint)' }}>No inbox addresses yet.</p>
                ) : (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {ordered.map((member) => {
                            const active = member.id === selected;
                            return (
                                <li key={member.id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelected(member.id);
                                            setReplyTo(null);
                                        }}
                                        aria-pressed={active}
                                        style={{
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '6px 8px',
                                            marginBottom: 2,
                                            borderRadius: 6,
                                            border: '1px solid var(--color-spur-border)',
                                            background: active ? 'var(--color-spur-surface-2)' : 'transparent',
                                            color: 'var(--color-spur-text)',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <span style={{ display: 'block', fontSize: 13 }}>{member.id}</span>
                                        <span style={{ fontSize: 11, color: 'var(--color-spur-text-muted)' }}>
                                            {member.queued} queued · {member.unread} unread
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </aside>

            <section aria-label="Thread">
                {error !== null ? (
                    <p role="alert" style={{ color: 'var(--color-spur-text-muted)' }}>
                        {error}
                    </p>
                ) : null}
                {selected !== null && olderCursor !== null ? (
                    <button type="button" onClick={() => void loadOlder()} style={{ marginBottom: 8 }}>
                        Load older
                    </button>
                ) : null}
                {selected === null ? (
                    <p style={{ color: 'var(--color-spur-text-faint)' }}>Select a member to read its thread.</p>
                ) : threads.length === 0 ? (
                    <p style={{ color: 'var(--color-spur-text-faint)' }}>No messages with {selected} yet.</p>
                ) : (
                    threads.map((thread) => (
                        <article key={thread[0]?.threadId ?? thread[0]?.id} style={{ marginBottom: 16 }}>
                            {thread.map((row) => {
                                const outbound = row.fromId === OPERATOR_ID;
                                const unread = row.toId === OPERATOR_ID && row.readAt === null;
                                return (
                                    <div
                                        key={row.id}
                                        style={{
                                            border: '1px solid var(--color-spur-border)',
                                            borderRadius: 8,
                                            padding: '8px 10px',
                                            marginBottom: 6,
                                            background: outbound
                                                ? 'var(--color-spur-surface-2)'
                                                : 'var(--color-spur-surface)',
                                        }}
                                    >
                                        <div style={{ fontSize: 11, color: 'var(--color-spur-text-muted)' }}>
                                            {row.fromId} → {row.toId} · {statusLabel(row)}
                                            {unread ? ' · unread' : ''}
                                        </div>
                                        <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{row.body}</p>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            {/* A reply is addressed to the row's sender, so an
                                                outbound row has no one to reply to. */}
                                            {outbound ? null : (
                                                <button type="button" onClick={() => setReplyTo(row)}>
                                                    Reply
                                                </button>
                                            )}
                                            {unread ? (
                                                <button type="button" onClick={() => void markRead(row)}>
                                                    Mark read
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </article>
                    ))
                )}

                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        void send();
                    }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}
                >
                    {replyTo !== null ? (
                        <span style={{ fontSize: 11, color: 'var(--color-spur-text-muted)' }}>
                            Replying to {replyTo.fromId} ·{' '}
                            <button type="button" onClick={() => setReplyTo(null)}>
                                cancel
                            </button>
                        </span>
                    ) : null}
                    <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={selected === null ? 'Select a member first' : `Message ${selected} as operator`}
                        disabled={selected === null}
                        rows={3}
                        style={{ width: '100%' }}
                    />
                    <button type="submit" disabled={selected === null || draft.trim() === ''}>
                        {replyTo === null ? 'Send' : 'Reply'}
                    </button>
                </form>
            </section>
        </div>
    );
}
