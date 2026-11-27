import type { IntegrationsRemoteDialog, IntegrationsStatus } from '@gobing-ai/spur-contracts';
import { CheckCircle2, Clock, LoaderCircle, XCircle } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withBase } from '../../components/base-path';
import { Button, Diagnostic, EmptyState, Loading, PinnableTooltip } from '../../components/module-kit';
import { subscribePlanningEvents } from '../../lib/planning-events';
import { type ApiClient, api, fetchWithTimeout } from '../../lib/rpc-client';
import {
    type A2aFilters,
    type A2aTimelineInput,
    a2aTimelineInput,
    assignLanes,
    decodeA2aFilters,
    type InboxRow,
    mergeTimelinePages,
    OVERFLOW_LANE,
    type SequenceArrow,
    sortTimeline,
    traceLink,
    type UsageWindow,
    withA2aFilters,
} from './helpers';

/**
 * Integrations › A2A — the cooperation sequence (A821 R1–R4, R6, R8).
 *
 * The A2A tab's primary content: one lifeline per participating inbox address, one arrow per message
 * in `(createdAt, id)` order, replies indented under their thread and self-messages drawn as loops.
 * A CSS grid, never a chart dependency. `inbox.timeline` is the only source, read through the typed
 * client so `members` serializes as the deepObject the contract declares; filters are pushed into
 * that read and mirrored into the URL under `a2a.`-prefixed keys.
 *
 * Detail lives in `PinnableTooltip`s (1453): a lifeline header opens the member's card summary or its
 * credential state, an arrow opens the message's delivery timeline. This view observes cooperation and
 * never acts on it — Projects › Inbox owns composing, replying and marking read.
 */

/**
 * The procedures the sequence reads: two `inbox` reads plus the remote dialog (1469 R3).
 *
 * An explicit interface, not a `Pick` over `api.inbox`: `integrations.remoteDialog` lives on another
 * noun, and spreading the oRPC proxy would hand the effects a new identity every render.
 */
export interface SequenceClient {
    timeline: ApiClient['inbox']['timeline'];
    requests: ApiClient['inbox']['requests'];
    remoteDialog: ApiClient['integrations']['remoteDialog'];
}

/**
 * The production client, bound ONCE. `api.inbox` is a proxy rebuilt per property access, so reading
 * it inline would hand the data effects a new identity every render — an unbounded refetch loop.
 */
const SEQUENCE_CLIENT: SequenceClient = {
    timeline: api.inbox.timeline,
    requests: api.inbox.requests,
    remoteDialog: api.integrations.remoteDialog,
};

/** The public Agent Card, fetched only when a lifeline tooltip first opens (1440 R1). */
type CardState =
    | { status: 'loading' }
    | { status: 'ready'; card: Record<string, unknown>; json: string }
    | { status: 'error'; error: string };

/** The receipt fields the arrow tooltip renders; an `inbox.requests` row satisfies this shape. */
interface SequenceReceipt {
    runId: string | null;
    attempts: number;
    error: string | null;
    remoteTaskId?: string | null;
    remoteContextId?: string | null;
    remoteBranch?: string | null;
}

/** An arrow's receipt, read on first open and then cached (1440 R2). */
type ReceiptState = { status: 'loading' } | { status: 'ready'; row: SequenceReceipt } | { status: 'error' };

/** The remote dialog read's state for one outbound receipt (1469 R1/R2): loading, or the 1468 union. */
type RemoteDialogState = { status: 'loading' } | { status: 'done'; result: IntegrationsRemoteDialog };

/** One delivery status's icon and tone; the text is always rendered beside it. */
const STATUS_META: Record<
    InboxRow['status'],
    { label: string; tone: string; Icon: (props: { className?: string }) => ReactNode }
> = {
    queued: { label: 'queued', tone: 'text-base-content/60', Icon: Clock },
    claimed: { label: 'claimed', tone: 'text-warning', Icon: LoaderCircle },
    delivered: { label: 'delivered', tone: 'text-success', Icon: CheckCircle2 },
    failed: { label: 'failed', tone: 'text-error', Icon: XCircle },
};

/** One status as icon plus text (DESIGN.md: status color is always paired with text or an icon). */
function StatusMark({ status, testId }: { status: InboxRow['status']; testId?: string }) {
    const meta = STATUS_META[status] ?? STATUS_META.queued;
    return (
        <span
            className={`inline-flex items-center gap-1 ${meta.tone}`}
            data-testid={testId ?? `integrations-a2a-status-${status}`}
        >
            <meta.Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{meta.label}</span>
        </span>
    );
}

/** A millisecond stamp as a compact local time; an absent stamp reads `—`, never an invented time. */
function stamp(at: number | null): string {
    return at === null ? '—' : new Date(at).toLocaleTimeString();
}

/** The member's public card URL, resolved against the Board's own mount (1440 R1). */
function cardUrlFor(member: string): string {
    return withBase(`/a2a/members/${encodeURIComponent(member)}/.well-known/agent-card.json`);
}

/**
 * The A2A endpoint the card advertises. A current card names it in `supportedInterfaces`; an older one
 * carries a top-level `url`; a card that names neither is read through its own public route.
 */
function cardEndpoint(card: Record<string, unknown>, address: string): string {
    const interfaces = card.supportedInterfaces;
    if (Array.isArray(interfaces)) {
        for (const entry of interfaces) {
            if (entry === null || typeof entry !== 'object') continue;
            const url = (entry as Record<string, unknown>).url;
            if (typeof url === 'string' && url !== '') return url;
        }
    }
    if (typeof card.url === 'string' && card.url !== '') return card.url;
    return cardUrlFor(address);
}

/** The security schemes an Agent Card advertises, on one line. */
function authScheme(card: Record<string, unknown>): string {
    const schemes = card.securitySchemes;
    if (schemes === null || typeof schemes !== 'object') return 'none advertised';
    const entries = Object.entries(schemes as Record<string, unknown>);
    if (entries.length === 0) return 'none advertised';
    return entries
        .map(([name, value]) => {
            const scheme = (value ?? {}) as Record<string, unknown>;
            const inner = Object.values(scheme).find(
                (candidate) => candidate !== null && typeof candidate === 'object',
            ) as Record<string, unknown> | undefined;
            const kind =
                typeof inner?.scheme === 'string' ? inner.scheme : typeof inner?.type === 'string' ? inner.type : '';
            return kind === '' ? name : `${name} · ${kind}`;
        })
        .join(', ');
}

/** The card's skills as `id` (or `name`) with their description when the card declares them. */
function cardSkills(card: Record<string, unknown>): Array<{ id: string; description: string }> {
    const skills = card.skills;
    if (!Array.isArray(skills)) return [];
    return skills.flatMap((entry) => {
        if (entry === null || typeof entry !== 'object') return [];
        const skill = entry as Record<string, unknown>;
        const id = typeof skill.id === 'string' ? skill.id : typeof skill.name === 'string' ? skill.name : undefined;
        if (id === undefined) return [];
        return [{ id, description: typeof skill.description === 'string' ? skill.description : '' }];
    });
}

/**
 * The live timeline read: a filter, window or retry change replaces the page; paging appends; a
 * `message.*` frame refetches from the oldest loaded row through the current bounds.
 */
function useA2aTimeline(input: A2aTimelineInput, client: SequenceClient) {
    const [state, setState] = useState<{
        rows: InboxRow[];
        nextCursor: string | null;
        loading: boolean;
        loadingMore: boolean;
        error: Error | null;
    }>({ rows: [], nextCursor: null, loading: true, loadingMore: false, error: null });
    // Read by the frame handler, which must not resubscribe when a page lands.
    const rowsRef = useRef<InboxRow[]>(state.rows);
    rowsRef.current = state.rows;
    const inputRef = useRef(input);
    inputRef.current = input;
    const version = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    /**
     * The one page read. A filter, window or retry change replaces the page (the old rows would answer
     * a question the operator no longer asked); a superseded answer is dropped rather than rendered.
     */
    const load = useCallback(() => {
        const current = ++version.current;
        setState((previous) => ({ ...previous, rows: [], nextCursor: null, loading: true, error: null }));
        void client.timeline(input).then(
            (page) => {
                if (version.current !== current) return;
                setState({
                    rows: sortTimeline(page.messages as InboxRow[]),
                    nextCursor: page.nextCursor,
                    loading: false,
                    loadingMore: false,
                    error: null,
                });
            },
            (error: unknown) => {
                if (version.current !== current) return;
                setState((previous) => ({
                    ...previous,
                    rows: [],
                    loading: false,
                    error: error instanceof Error ? error : new Error(String(error)),
                }));
            },
        );
    }, [client, input]);

    useEffect(() => {
        load();
    }, [load]);

    // Live: every `message.*` frame refetches the range from the oldest loaded row, so a message an
    // agent wrote appears without re-reading — or losing — the history already on screen.
    useEffect(
        () =>
            subscribePlanningEvents((event) => {
                if (!event.eventName.startsWith('message.')) return;
                const loaded = rowsRef.current;
                const oldest = loaded[0];
                const request: A2aTimelineInput =
                    oldest === undefined
                        ? inputRef.current
                        : {
                              ...inputRef.current,
                              limit: Math.min(500, loaded.length + 1),
                              since: Math.max(inputRef.current.since ?? 0, oldest.createdAt),
                          };
                // Page forward to the end: the first page is capped at 500, so once more rows than that
                // are loaded, a single read would stop short of the message this frame announced.
                const readAll = async (): Promise<InboxRow[]> => {
                    const out: InboxRow[] = [];
                    let cursor: string | undefined;
                    do {
                        const page = await client.timeline(cursor === undefined ? request : { ...request, cursor });
                        out.push(...(page.messages as InboxRow[]));
                        cursor = page.nextCursor ?? undefined;
                    } while (cursor !== undefined && mounted.current);
                    return out;
                };
                void readAll().then(
                    (fresh) => {
                        if (!mounted.current) return;
                        setState((previous) => ({
                            ...previous,
                            rows: oldest === undefined ? sortTimeline(fresh) : mergeTimelinePages(fresh, previous.rows),
                        }));
                    },
                    // A failed live refresh keeps what is on screen; the next frame retries. One
                    // background read failing must never blank the view.
                    () => undefined,
                );
            }),
        [client],
    );

    const loadMore = useCallback(() => {
        const cursor = state.nextCursor;
        if (cursor === null || state.loadingMore) return;
        setState((previous) => ({ ...previous, loadingMore: true }));
        void client.timeline({ ...inputRef.current, cursor }).then(
            (page) => {
                if (!mounted.current) return;
                setState((previous) => ({
                    ...previous,
                    rows: mergeTimelinePages(page.messages as InboxRow[], previous.rows),
                    nextCursor: page.nextCursor,
                    loadingMore: false,
                }));
            },
            () => {
                if (!mounted.current) return;
                setState((previous) => ({ ...previous, loadingMore: false }));
            },
        );
    }, [client, state.nextCursor, state.loadingMore]);

    return { ...state, retry: load, loadMore };
}

/** True when the viewport is at or below the compact breakpoint (≤639 px). SSR renders the grid. */
function useCompactLayout(): boolean {
    const query = '(max-width: 639px)';
    const [compact, setCompact] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia(query).matches;
    });
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const list = window.matchMedia(query);
        const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
        list.addEventListener('change', onChange);
        setCompact(list.matches);
        return () => list.removeEventListener('change', onChange);
    }, []);
    return compact;
}

/** One filter patch merged into the current filters, with emptied values removed rather than stored. */
function patchFilters(current: A2aFilters, patch: Partial<A2aFilters>): A2aFilters {
    const next: Record<string, unknown> = { ...current, ...patch };
    for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) delete next[key];
    }
    return next as A2aFilters;
}

/** The filters one load starts with: the URL's, so a shared link restores the view. */
function initialFilters(): A2aFilters {
    if (typeof window === 'undefined') return {};
    return decodeA2aFilters(window.location.search);
}

/**
 * Mirror the filters into the URL under the `a2a.` prefix, leaving every other query param alone so
 * another tab's state — or the host's — survives. `replaceState`, not `pushState`: a filter is a view
 * setting, not a navigation the Back button should replay.
 */
function writeFilters(filters: A2aFilters): void {
    if (typeof window === 'undefined') return;
    const search = withA2aFilters(window.location.search, filters);
    const url = `${window.location.pathname}${search === '' ? '' : `?${search}`}${window.location.hash}`;
    try {
        window.history.replaceState(null, '', url);
    } catch {
        // A document that cannot rewrite its URL keeps the filters in memory for this session.
    }
}

/**
 * The inbound lifeline's card summary. It mounts only while the tooltip panel is open, and reads the
 * card exactly once: the parent caches by member, so a second open is free.
 */
function CardBody({
    address,
    state,
    onOpen,
    onRetry,
}: {
    address: string;
    state: CardState | undefined;
    onOpen: () => void;
    onRetry: () => void;
}) {
    const opened = useRef(false);
    useEffect(() => {
        if (opened.current) return;
        opened.current = true;
        onOpen();
    }, [onOpen]);
    if (state === undefined || state.status === 'loading') {
        return (
            <p className="text-base-content/60" data-testid={`integrations-a2a-lane-card-loading-${address}`}>
                reading the Agent Card…
            </p>
        );
    }
    if (state.status === 'error') {
        return (
            <div data-testid={`integrations-a2a-lane-card-error-${address}`}>
                <Diagnostic
                    tone="warning"
                    testId={`integrations-a2a-lane-card-diagnostic-${address}`}
                    title="The Agent Card could not be read"
                    detail={state.error}
                    code={cardUrlFor(address)}
                />
                <Button size="sm" variant="ghost" onClick={onRetry}>
                    Retry card
                </Button>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-1 text-[11px]" data-testid={`integrations-a2a-lane-card-${address}`}>
            <p className="font-semibold">{String(state.card.name ?? address)}</p>
            {typeof state.card.description === 'string' && state.card.description !== '' ? (
                <p className="text-base-content/70">{state.card.description}</p>
            ) : null}
            <p className="text-base-content/60">skills</p>
            {cardSkills(state.card).length === 0 ? (
                <p className="text-base-content/50">none advertised</p>
            ) : (
                <ul className="list-disc pl-4">
                    {cardSkills(state.card).map((skill) => (
                        <li key={skill.id}>
                            <span className="font-mono">{skill.id}</span>
                            {skill.description === '' ? null : (
                                <span className="text-base-content/60"> — {skill.description}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <p className="text-base-content/60">endpoint</p>
            <p className="font-mono break-all">{cardEndpoint(state.card, address)}</p>
            <p className="text-base-content/60">auth</p>
            <p>{authScheme(state.card)}</p>
        </div>
    );
}

/** The outbound peer's detail: its target and its credential variable's name and presence only. */
function OutboundBody({
    member,
}: {
    member: Extract<IntegrationsStatus['a2a']['members'][number], { direction: 'outbound' }>;
}) {
    const auth = member.auth;
    return (
        <div
            className="flex flex-col gap-1 text-[11px]"
            data-testid={`integrations-a2a-lane-outbound-${member.member}`}
        >
            <p className="text-base-content/60">target</p>
            <p className="font-mono break-all">{member.target}</p>
            {auth === undefined || auth.envName === '' ? (
                <p className="text-base-content/60">no credential declared</p>
            ) : (
                <p>
                    credential <span className="font-mono">{auth.envName}</span>{' '}
                    <span className={auth.tokenPresent ? 'text-success' : 'text-warning'}>
                        {auth.tokenPresent ? 'set' : 'unset'}
                    </span>
                </p>
            )}
            <p className="text-base-content/50">
                The token value never crosses the port: only the variable's name and whether it resolved.
            </p>
        </div>
    );
}

/** The lifeline header: a declared member opens a tooltip, an undeclared address stays a plain label. */
function LifelineHeader({
    address,
    member,
    cardState,
    onOpenCard,
    onRetryCard,
}: {
    address: string;
    member: IntegrationsStatus['a2a']['members'][number] | undefined;
    cardState: CardState | undefined;
    onOpenCard: () => void;
    onRetryCard: () => void;
}) {
    if (member === undefined) {
        // An address the fleet does not declare (operator, spur, a task id) is a plain label: there is
        // no card and no credential to open.
        return (
            <span className="font-mono text-[11px] truncate" data-testid={`integrations-a2a-lane-${address}`}>
                {address}
            </span>
        );
    }
    const trigger = <span className="font-mono text-[11px] truncate">{address}</span>;
    if (member.direction === 'outbound') {
        return (
            <PinnableTooltip
                trigger={trigger}
                triggerLabel={`Peer detail for ${address}`}
                triggerTestId={`integrations-a2a-lane-trigger-${address}`}
                triggerClassName="min-w-0 max-w-full text-left"
                title={`${address} · outbound`}
                testId={`integrations-a2a-lane-detail-${address}`}
                minWidth={360}
                footer={({ pinned }) => (pinned ? 'Select to copy' : 'Click to pin')}
            >
                <OutboundBody member={member} />
            </PinnableTooltip>
        );
    }
    return (
        <PinnableTooltip
            trigger={trigger}
            triggerLabel={`Agent Card for ${address}`}
            triggerTestId={`integrations-a2a-lane-trigger-${address}`}
            triggerClassName="min-w-0 max-w-full text-left"
            title={`${address} · inbound`}
            testId={`integrations-a2a-lane-detail-${address}`}
            minWidth={420}
            footer={({ pinned }) =>
                pinned ? (
                    cardState?.status === 'ready' ? (
                        <pre
                            className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono"
                            data-testid={`integrations-a2a-lane-card-json-${address}`}
                        >
                            {cardState.json}
                        </pre>
                    ) : null
                ) : (
                    'Click to pin and copy the raw card JSON'
                )
            }
        >
            <CardBody address={address} state={cardState} onOpen={onOpenCard} onRetry={onRetryCard} />
        </PinnableTooltip>
    );
}

/** One arrow's detail: excerpt, kind, delivery timeline, request key, Trace link and remote refs. */
function ArrowDetail({
    row,
    receipt,
    remote,
    onOpen,
    onOpenRemote,
    onRetryRemote,
}: {
    row: InboxRow;
    receipt: ReceiptState | undefined;
    remote: RemoteDialogState | undefined;
    onOpen: () => void;
    onOpenRemote: () => void;
    onRetryRemote: () => void;
}) {
    const opened = useRef(false);
    useEffect(() => {
        if (opened.current) return;
        opened.current = true;
        onOpen();
    }, [onOpen]);
    const refs = receipt?.status === 'ready' ? receipt.row : undefined;
    const link = traceLink(refs?.runId ?? null);
    return (
        <div className="flex flex-col gap-1" data-testid={`integrations-a2a-arrow-detail-${row.id}`}>
            <p className="whitespace-pre-wrap break-words" data-testid={`integrations-a2a-arrow-excerpt-${row.id}`}>
                {row.body === '' ? '(empty body)' : row.body}
            </p>
            <p className="text-base-content/70">
                {row.fromId} → {row.toId} · {row.kind} · <StatusMark status={row.status} />
            </p>
            {row.inReplyTo === null ? null : (
                <p className="text-base-content/60">
                    in reply to <span className="font-mono">{row.inReplyTo}</span>
                </p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 font-mono">
                <dt className="text-base-content/60">queued</dt>
                <dd>{stamp(row.createdAt)}</dd>
                <dt className="text-base-content/60">claimed</dt>
                <dd>{stamp(row.claimedAt)}</dd>
                <dt className="text-base-content/60">delivered</dt>
                <dd>{stamp(row.deliveredAt)}</dd>
                <dt className="text-base-content/60">read</dt>
                <dd>{stamp(row.readAt)}</dd>
                <dt className="text-base-content/60">attempts</dt>
                <dd>{refs?.attempts ?? row.attempts}</dd>
                <dt className="text-base-content/60">request</dt>
                <dd className="break-all">{row.requestKey ?? '—'}</dd>
            </dl>
            {row.error === null ? null : (
                <p className="text-error" data-testid={`integrations-a2a-arrow-error-${row.id}`}>
                    {row.error}
                </p>
            )}
            {receipt?.status === 'loading' ? <p className="text-base-content/60">reading the receipt…</p> : null}
            {receipt?.status === 'error' ? (
                <p className="text-base-content/60" data-testid={`integrations-a2a-arrow-receipt-error-${row.id}`}>
                    The receipt for this message could not be read.
                </p>
            ) : null}
            {link === null ? null : (
                <a
                    className="link font-mono"
                    href={link}
                    data-testid={`integrations-a2a-arrow-run-${row.id}`}
                    onClick={(event) => event.stopPropagation()}
                >
                    run {refs?.runId}
                </a>
            )}
            {refs === undefined ? null : (
                <p className="text-base-content/60" data-testid={`integrations-a2a-arrow-refs-${row.id}`}>
                    {[
                        ['task', refs.remoteTaskId],
                        ['context', refs.remoteContextId],
                        ['branch', refs.remoteBranch],
                    ]
                        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
                        .map(([label, value]) => `${label} ${value}`)
                        .join(' · ') || 'no remote refs'}
                </p>
            )}
            <RemoteDialog
                remoteContextId={refs?.remoteContextId ?? null}
                state={remote}
                onOpen={onOpenRemote}
                onRetry={onRetryRemote}
            />
        </div>
    );
}

/** The frozen copy for a peer this gateway cannot read (1469 R2). */
const REMOTE_OUTSIDE_COPY = 'Remote peer outside this gateway — dialog not available';

/**
 * The stitched remote dialog for one outbound receipt (1469 R1/R2/R4).
 *
 * A disclosure, never an automatic read: it mounts on every tooltip open, so it fetches only when the
 * operator opens it, and the parent caches the answer. A `remote` answer lists the peer's messages
 * oldest first; the two markers explain why there is no transcript, and only the retryable one offers
 * a Retry. Nothing here can break the local sequence — every branch is text beside the arrow.
 */
function RemoteDialog({
    remoteContextId,
    state,
    onOpen,
    onRetry,
}: {
    remoteContextId: string | null;
    state: RemoteDialogState | undefined;
    onOpen: () => void;
    onRetry: () => void;
}) {
    const [open, setOpen] = useState(false);
    // No remote context id means this receipt never left for a peer that could answer.
    if (remoteContextId === null || remoteContextId === '') return null;
    return (
        <div className="flex flex-col gap-1" data-testid="a2a-remote-section">
            <Button
                type="button"
                variant="ghost"
                size="xs"
                className="self-start"
                aria-expanded={open}
                data-testid="a2a-remote-toggle"
                onClick={(event) => {
                    event.stopPropagation();
                    const next = !open;
                    setOpen(next);
                    if (next) onOpen();
                }}
            >
                {open ? 'Hide remote dialog' : 'Remote dialog'}
            </Button>
            {!open ? null : state === undefined || state.status === 'loading' ? (
                <p className="text-base-content/60">reading the remote dialog…</p>
            ) : state.result.status === 'remote' ? (
                <ol className="flex flex-col gap-1" data-testid="a2a-remote-dialog">
                    {[...state.result.messages]
                        .sort((left, right) => left.createdAt - right.createdAt)
                        .map((message) => (
                            <li
                                key={message.id}
                                className="flex flex-col gap-0.5"
                                data-testid={`a2a-remote-message-${message.id}`}
                            >
                                <p className="text-base-content/70">
                                    {message.fromId} → {message.toId} · <StatusMark status={message.status} /> ·{' '}
                                    {stamp(message.createdAt)}
                                </p>
                                <p className="whitespace-pre-wrap break-words">
                                    {message.body === '' ? '(empty body)' : message.body}
                                </p>
                            </li>
                        ))}
                </ol>
            ) : state.result.status === 'outside-gateway' ? (
                <p className="text-base-content/60" data-testid="a2a-remote-marker">
                    {REMOTE_OUTSIDE_COPY}
                </p>
            ) : (
                <div className="flex flex-col gap-1">
                    <p className="text-error" data-testid="a2a-remote-marker">
                        {state.result.reason}
                    </p>
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="self-start"
                        data-testid="a2a-remote-retry"
                        onClick={(event) => {
                            event.stopPropagation();
                            onRetry();
                        }}
                    >
                        Retry
                    </Button>
                </div>
            )}
        </div>
    );
}

/** One arrow's label: the two addresses, the kind, the status (icon + text) and the time. */
function ArrowTrigger({ arrow, row }: { arrow: SequenceArrow; row: InboxRow }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <span className="font-mono truncate">{arrow.self ? `${row.fromId} ↺` : `${row.fromId} → ${row.toId}`}</span>
            <span className="text-base-content/60">{row.kind}</span>
            <StatusMark status={row.status} testId={`integrations-a2a-arrow-status-${row.id}`} />
            <span className="text-base-content/50">{new Date(row.createdAt).toLocaleTimeString()}</span>
        </span>
    );
}

/**
 * The thread filter. It commits on Enter or blur rather than per keystroke: every commit is a server
 * read, and a thread id is typed one character at a time.
 */
function ThreadFilter({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
    const [draft, setDraft] = useState(value);
    // A restored URL (or a Clear) sets the field, while ordinary render passes leave the draft alone.
    useEffect(() => setDraft(value), [value]);
    // The committed value is read from the field itself, never from state: a keystroke and the Enter
    // that follows it are two events, and only the DOM is guaranteed to carry the first one's value.
    const commit = (next: string) => {
        if (next !== value) onCommit(next);
    };
    return (
        <input
            id="integrations-a2a-filter-thread"
            type="search"
            className="input input-xs w-40"
            data-testid="integrations-a2a-filter-thread"
            placeholder="thread id"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
                if (event.key === 'Enter') commit(event.currentTarget.value);
            }}
            onBlur={(event) => commit(event.currentTarget.value)}
        />
    );
}

/** One labelled control in the filter row; the label names the control by id. */
function FilterField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
    return (
        <div className="flex items-center gap-1 text-[11px] text-base-content/70">
            <label htmlFor={id}>{label}</label>
            {children}
        </div>
    );
}

/** The sequence view. */
export function A2aSequence({
    status,
    window: range,
    client = SEQUENCE_CLIENT,
    fetchCard,
}: {
    status: IntegrationsStatus;
    /** The module header's window: the sequence's lower time bound. */
    window?: UsageWindow;
    client?: SequenceClient;
    /** The Agent Card read; defaults to the production fetch (1440 R1). */
    fetchCard?: (url: string) => Promise<Response>;
}) {
    const [filters, setFilters] = useState<A2aFilters>(initialFilters);
    const [expandLanes, setExpandLanes] = useState(false);
    const input = useMemo(() => a2aTimelineInput(filters, range), [filters, range]);
    const { rows, nextCursor, loading, loadingMore, error, retry, loadMore } = useA2aTimeline(input, client);
    const compact = useCompactLayout();

    // Reads are cached per address/message: a tooltip body mounts on every open, and re-reading a card
    // the operator has already seen is wasted work.
    const cards = useRef(new Map<string, CardState>());
    const receipts = useRef(new Map<string, ReceiptState>());
    const remoteDialogs = useRef(new Map<string, RemoteDialogState>());
    const [, bump] = useState(0);
    const rerender = useCallback(() => bump((value) => value + 1), []);
    const readCard =
        fetchCard ?? ((url: string) => fetchWithTimeout(new Request(url, { credentials: 'omit', redirect: 'error' })));

    const loadCard = useCallback(
        (member: string, force = false) => {
            const current = cards.current.get(member);
            if (!force && current !== undefined && current.status !== 'error') return;
            if (cards.current.get(member)?.status === 'loading') return;
            cards.current.set(member, { status: 'loading' });
            rerender();
            void (async () => {
                try {
                    // The card is the one public A2A route, and it is read under the Board's own mount.
                    const response = await readCard(cardUrlFor(member));
                    if (!response.ok) throw new Error(`card fetch answered ${response.status}`);
                    const card = (await response.json()) as Record<string, unknown>;
                    cards.current.set(member, { status: 'ready', card, json: JSON.stringify(card, null, 2) });
                } catch (failure) {
                    cards.current.set(member, {
                        status: 'error',
                        error: failure instanceof Error ? failure.message : String(failure),
                    });
                }
                rerender();
            })();
        },
        [readCard, rerender],
    );

    const loadReceipt = useCallback(
        (messageId: string) => {
            if (receipts.current.has(messageId)) return;
            receipts.current.set(messageId, { status: 'loading' });
            rerender();
            void client.requests({ messageId }).then(
                (page) => {
                    const receipt = page[0];
                    receipts.current.set(
                        messageId,
                        receipt === undefined ? { status: 'error' } : { status: 'ready', row: receipt },
                    );
                    rerender();
                },
                () => {
                    receipts.current.set(messageId, { status: 'error' });
                    rerender();
                },
            );
        },
        [client, rerender],
    );

    /**
     * Read one receipt's remote dialog (1469 R1): only when the disclosure opens, cached per message,
     * so an unopened arrow costs nothing and reopening is free. `force` is the Retry path.
     */
    const loadRemoteDialog = useCallback(
        (messageId: string, member: string, remoteContextId: string, force = false) => {
            if (!force && remoteDialogs.current.has(messageId)) return;
            if (remoteDialogs.current.get(messageId)?.status === 'loading') return;
            remoteDialogs.current.set(messageId, { status: 'loading' });
            rerender();
            void client.remoteDialog({ member, remoteContextId }).then(
                (result) => {
                    remoteDialogs.current.set(messageId, { status: 'done', result });
                    rerender();
                },
                (failure: unknown) => {
                    // A transport failure is the third marker state, never a broken sequence.
                    remoteDialogs.current.set(messageId, {
                        status: 'done',
                        result: {
                            status: 'unavailable',
                            reason: failure instanceof Error ? failure.message : String(failure),
                        },
                    });
                    rerender();
                },
            );
        },
        [client, rerender],
    );

    const update = useCallback((patch: Partial<A2aFilters>) => {
        setFilters((current) => {
            const next = patchFilters(current, patch);
            writeFilters(next);
            return next;
        });
    }, []);
    const clearFilters = useCallback(() => {
        setFilters(() => {
            writeFilters({});
            return {};
        });
    }, []);

    // R1: past eight lifelines the tail collapses into one `+N` column the operator can expand. The
    // compact list has no columns at all, so it always uses the full assignment.
    const collapsed = useMemo(() => assignLanes(rows), [rows]);
    const full = useMemo(() => assignLanes(rows, Number.POSITIVE_INFINITY), [rows]);
    const assignment = compact || expandLanes ? full : collapsed;
    const hiddenLanes = full.lanes.length - collapsed.lanes.length;
    const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
    const columns = assignment.overflow.length > 0 ? [...assignment.lanes, OVERFLOW_LANE] : assignment.lanes;
    const columnOf = (address: string): number => {
        const index = assignment.lanes.indexOf(address);
        return index === -1 ? columns.indexOf(OVERFLOW_LANE) : index;
    };
    const members = useMemo(
        () => new Map(status.a2a.members.map((member) => [member.member, member])),
        [status.a2a.members],
    );
    const agents = useMemo(() => {
        const addresses = new Set<string>();
        for (const member of status.a2a.members) addresses.add(member.member);
        for (const row of rows) {
            addresses.add(row.fromId);
            addresses.add(row.toId);
        }
        return [...addresses].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }, [rows, status.a2a.members]);
    const filtered = Object.keys(filters).length > 0;

    const arrowTooltip = (arrow: SequenceArrow, row: InboxRow) => (
        <PinnableTooltip
            trigger={<ArrowTrigger arrow={arrow} row={row} />}
            triggerLabel={`Message detail for ${row.id}`}
            triggerTestId={`integrations-a2a-arrow-trigger-${row.id}`}
            triggerClassName="min-w-0 max-w-full text-left"
            title={`${row.fromId} → ${row.toId}`}
            testId={`integrations-a2a-arrow-detail-panel-${row.id}`}
            minWidth={420}
            footer={({ pinned }) => (pinned ? 'Select to copy' : 'Click to pin')}
        >
            <ArrowDetail
                row={row}
                receipt={receipts.current.get(row.id)}
                remote={remoteDialogs.current.get(row.id)}
                onOpen={() => loadReceipt(row.id)}
                onOpenRemote={() => {
                    const refs = receipts.current.get(row.id);
                    // A receipt belongs to the peer at either end of the arrow: the outbound member is
                    // the address we called (toId), and a reply is addressed back from it (fromId).
                    const member = [row.toId, row.fromId]
                        .map((address) =>
                            status.a2a.members.find(
                                (entry) => entry.direction === 'outbound' && entry.member === address,
                            ),
                        )
                        .find((entry) => entry !== undefined);
                    const remoteContextId = refs?.status === 'ready' ? (refs.row.remoteContextId ?? '') : '';
                    if (member === undefined || member.direction !== 'outbound' || remoteContextId === '') return;
                    loadRemoteDialog(row.id, member.member, remoteContextId);
                }}
                onRetryRemote={() => {
                    const refs = receipts.current.get(row.id);
                    const member = [row.toId, row.fromId]
                        .map((address) =>
                            status.a2a.members.find(
                                (entry) => entry.direction === 'outbound' && entry.member === address,
                            ),
                        )
                        .find((entry) => entry !== undefined);
                    const remoteContextId = refs?.status === 'ready' ? (refs.row.remoteContextId ?? '') : '';
                    if (member === undefined || member.direction !== 'outbound' || remoteContextId === '') return;
                    loadRemoteDialog(row.id, member.member, remoteContextId, true);
                }}
            />
        </PinnableTooltip>
    );

    return (
        <div className="flex flex-col gap-3" data-testid="integrations-a2a-sequence">
            <div className="flex flex-wrap items-end gap-3" data-testid="integrations-a2a-filters">
                <FilterField id="integrations-a2a-filter-member" label="Agent">
                    <select
                        id="integrations-a2a-filter-member"
                        className="bg-base-100 border border-base-content/20 rounded px-2 py-1 text-xs cursor-pointer"
                        data-testid="integrations-a2a-filter-member"
                        value={filters.members?.[0] ?? ''}
                        onChange={(event) =>
                            update({ members: event.currentTarget.value === '' ? [] : [event.currentTarget.value] })
                        }
                    >
                        <option value="">any agent</option>
                        {agents.map((agent) => (
                            <option key={agent} value={agent}>
                                {agent}
                            </option>
                        ))}
                    </select>
                </FilterField>
                <FilterField id="integrations-a2a-filter-direction" label="Direction">
                    <select
                        id="integrations-a2a-filter-direction"
                        className="bg-base-100 border border-base-content/20 rounded px-2 py-1 text-xs cursor-pointer"
                        data-testid="integrations-a2a-filter-direction"
                        value={filters.direction ?? ''}
                        onChange={(event) =>
                            update({ direction: event.currentTarget.value as A2aFilters['direction'] })
                        }
                    >
                        <option value="">both</option>
                        <option value="in">in</option>
                        <option value="out">out</option>
                    </select>
                </FilterField>
                <FilterField id="integrations-a2a-filter-kind" label="Kind">
                    <select
                        id="integrations-a2a-filter-kind"
                        className="bg-base-100 border border-base-content/20 rounded px-2 py-1 text-xs cursor-pointer"
                        data-testid="integrations-a2a-filter-kind"
                        value={filters.kind ?? ''}
                        onChange={(event) => update({ kind: event.currentTarget.value as A2aFilters['kind'] })}
                    >
                        <option value="">any kind</option>
                        <option value="chat">chat</option>
                        <option value="request">request</option>
                    </select>
                </FilterField>
                <FilterField id="integrations-a2a-filter-status" label="Status">
                    <select
                        id="integrations-a2a-filter-status"
                        className="bg-base-100 border border-base-content/20 rounded px-2 py-1 text-xs cursor-pointer"
                        data-testid="integrations-a2a-filter-status"
                        value={filters.status ?? ''}
                        onChange={(event) => update({ status: event.currentTarget.value as A2aFilters['status'] })}
                    >
                        <option value="">any status</option>
                        <option value="queued">queued</option>
                        <option value="claimed">claimed</option>
                        <option value="delivered">delivered</option>
                        <option value="failed">failed</option>
                    </select>
                </FilterField>
                <FilterField id="integrations-a2a-filter-thread" label="Thread">
                    <ThreadFilter value={filters.threadId ?? ''} onCommit={(threadId) => update({ threadId })} />
                </FilterField>
                {filtered ? (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={clearFilters}
                        data-testid="integrations-a2a-filter-clear"
                    >
                        Clear filters
                    </Button>
                ) : null}
                {compact || hiddenLanes === 0 ? null : (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandLanes((current) => !current)}
                        data-testid="integrations-a2a-lane-toggle"
                    >
                        {expandLanes ? 'Show fewer lifelines' : `Show ${hiddenLanes} more lifelines`}
                    </Button>
                )}
            </div>

            {error !== null ? (
                <div>
                    <Diagnostic
                        testId="integrations-a2a-sequence-diagnostic"
                        title="The A2A timeline could not be read"
                        detail={error.message}
                        hint="Check that the server is running, then retry. The configuration detail below still renders."
                    />
                    <div className="px-4">
                        <Button size="sm" variant="primary" onClick={retry}>
                            Retry
                        </Button>
                    </div>
                </div>
            ) : loading ? (
                <div
                    className="p-6 flex justify-center"
                    aria-busy="true"
                    data-testid="integrations-a2a-sequence-loading"
                >
                    <Loading />
                </div>
            ) : rows.length === 0 ? (
                <EmptyState testId="integrations-a2a-sequence-empty">
                    No agent-to-agent traffic in this window. Send the first message with{' '}
                    <code className="font-mono">spur message send</code> or <code className="font-mono">a2a send</code>.
                </EmptyState>
            ) : compact ? (
                <div className="flex flex-col gap-1">
                    {/*
                     * The stacked list has no columns, so the lifelines it would have headed are listed
                     * once above it: their card and credential tooltips stay reachable at 639 px.
                     */}
                    <ul
                        className="flex flex-wrap gap-x-3 gap-y-1 border-b border-base-content/10 pb-1"
                        data-testid="integrations-a2a-compact-lifelines"
                    >
                        {full.lanes.map((address) => (
                            <li key={address} className="min-w-0">
                                <LifelineHeader
                                    address={address}
                                    member={members.get(address)}
                                    cardState={cards.current.get(address)}
                                    onOpenCard={() => loadCard(address)}
                                    onRetryCard={() => loadCard(address, true)}
                                />
                            </li>
                        ))}
                    </ul>
                    <ol className="flex flex-col gap-1" data-testid="integrations-a2a-sequence-stacked">
                        {assignment.arrows.flatMap((arrow) => {
                            const row = rowsById.get(arrow.id);
                            if (row === undefined) return [];
                            return [
                                <li
                                    key={arrow.id}
                                    className="border-b border-base-content/10 pb-1"
                                    style={{ paddingLeft: `${arrow.depth * 12}px` }}
                                    data-testid={`integrations-a2a-stacked-${arrow.id}`}
                                >
                                    {arrowTooltip(arrow, row)}
                                </li>,
                            ];
                        })}
                    </ol>
                </div>
            ) : (
                <div className="flex flex-col gap-1" data-testid="integrations-a2a-sequence-grid">
                    <div
                        className="grid items-center gap-x-2 border-b border-base-content/20 pb-1"
                        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
                        data-testid="integrations-a2a-lanes"
                    >
                        {columns.map((lane) => (
                            <div key={lane} className="min-w-0">
                                {lane === OVERFLOW_LANE ? (
                                    <button
                                        type="button"
                                        className="font-mono text-[11px] text-base-content/60 hover:text-base-content"
                                        data-testid="integrations-a2a-lane-overflow"
                                        aria-expanded={false}
                                        title={`${assignment.overflow.join(', ')} — expand these lifelines`}
                                        onClick={() => setExpandLanes(true)}
                                    >
                                        +{assignment.overflow.length}
                                    </button>
                                ) : (
                                    <LifelineHeader
                                        address={lane}
                                        member={members.get(lane)}
                                        cardState={cards.current.get(lane)}
                                        onOpenCard={() => loadCard(lane)}
                                        onRetryCard={() => loadCard(lane, true)}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                    {assignment.arrows.map((arrow) => {
                        const row = rowsById.get(arrow.id);
                        if (row === undefined) return null;
                        const first = Math.min(columnOf(row.fromId), columnOf(row.toId));
                        const last = Math.max(columnOf(row.fromId), columnOf(row.toId));
                        return (
                            <div
                                key={arrow.id}
                                className="grid items-center gap-x-2"
                                style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
                                data-testid={`integrations-a2a-arrow-row-${arrow.id}`}
                            >
                                <div
                                    className="min-w-0"
                                    style={{
                                        gridColumn: `${first + 1} / ${last + 2}`,
                                        paddingLeft: `${arrow.depth * 12}px`,
                                    }}
                                >
                                    {arrowTooltip(arrow, row)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {nextCursor === null || error !== null ? null : (
                <div>
                    <Button size="sm" variant="ghost" onClick={loadMore} disabled={loadingMore}>
                        {loadingMore ? 'Loading…' : 'Load more'}
                    </Button>
                </div>
            )}
        </div>
    );
}
