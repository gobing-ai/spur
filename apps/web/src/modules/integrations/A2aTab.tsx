import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { useState } from 'react';
import { Badge, Button, Card, CardBody } from '../../components/module-kit';
import { fetchWithTimeout } from '../../lib/rpc-client';
import {
    a2aExamples,
    type InboxRequestRow,
    inboxLink,
    type ProtocolEventRow,
    requestState,
    systemEventLink,
    traceLink,
} from './helpers';

/**
 * Integrations › A2A (task 1424 R5; inspection, credential state and trace links 1440).
 *
 * Inbound member cards (public card URL, write-fenced badge) with an on-demand card inspector and the
 * copyable `a2a` CLI examples, the A2A tasks the listener created (the `a2a:` request-key family)
 * linking to Projects › Inbox and to the exact run in Observability › Trace, the outbound receipts
 * per declared member with their credential state and own remote refs, and recent A2A/auth events.
 */

/** The inspector's one-shot state: nothing fetched yet, in flight, the JSON text, or the failure. */
type CardState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; json: string }
    | { status: 'error'; error: string };

/**
 * The public Agent Card JSON, fetched only when the operator asks for it (1440 R1). The read is
 * unauthenticated — the card is the one public A2A route — and an error stays inside the inspector
 * so a refused card never blanks the tab.
 */
function CardInspector({ cardUrl, fetchCard }: { cardUrl: string; fetchCard?: (url: string) => Promise<Response> }) {
    const [state, setState] = useState<CardState>({ status: 'idle' });
    const load = () => {
        setState({ status: 'loading' });
        void (async () => {
            try {
                const read = fetchCard ?? ((url: string) => fetchWithTimeout(new Request(url)));
                const res = await read(cardUrl);
                if (!res.ok) throw new Error(`card fetch answered ${res.status}`);
                setState({ status: 'ready', json: JSON.stringify(await res.json(), null, 2) });
            } catch (error) {
                setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
            }
        })();
    };
    return (
        <div className="mt-2">
            <Button size="sm" variant="ghost" onClick={load} data-testid="integrations-a2a-card-load">
                {state.status === 'ready' ? 'Reload card JSON' : 'Card JSON'}
            </Button>
            {state.status === 'loading' ? <span className="ml-2 text-xs text-base-content/60">loading…</span> : null}
            {state.status === 'error' ? (
                <div className="mt-1 flex items-center gap-2" data-testid="integrations-a2a-card-error">
                    <span className="text-xs text-error">{state.error}</span>
                    <Button size="sm" variant="ghost" onClick={load}>
                        Retry
                    </Button>
                </div>
            ) : null}
            {state.status === 'ready' ? (
                <pre
                    className="mt-1 max-h-64 overflow-auto rounded bg-base-200 p-2 text-xs"
                    data-testid="integrations-a2a-card-json"
                >
                    {state.json}
                </pre>
            ) : null}
        </div>
    );
}

/** One receipt's remote refs, each rendered only when its own run persisted it (1440 R2). */
function RemoteRefs({ row }: { row: InboxRequestRow }) {
    const refs: Array<[string, string | null | undefined]> = [
        ['task', row.remoteTaskId],
        ['context', row.remoteContextId],
        ['branch', row.remoteBranch],
    ];
    const present = refs.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '');
    if (present.length === 0) return <span className="text-base-content/50"> no remote refs</span>;
    return (
        <span className="text-base-content/60">
            {present.map(([label, value]) => (
                <span key={label} className="ml-2">
                    {label} <span className="font-mono">{value}</span>
                </span>
            ))}
        </span>
    );
}

export function A2aTab({
    status,
    requests,
    receipts,
    events,
    usage,
    fetchCard,
}: {
    status: IntegrationsStatus;
    requests: InboxRequestRow[];
    receipts: Array<{ member: string; rows: InboxRequestRow[] }>;
    events: ProtocolEventRow[];
    usage: IntegrationsUsage | null;
    fetchCard?: (url: string) => Promise<Response>;
}) {
    const members = usage?.a2a ?? [];
    // Only this surface's refusals: an mcp denial is the MCP tab's to explain (1439 R1).
    const denials = (usage?.authDenied ?? []).filter((entry) => entry.surface === 'a2a');
    return (
        <div className="flex flex-col gap-4">
            {status.a2a.enabled && status.a2a.inbound.length === 0 ? (
                <p className="text-sm text-warning" data-testid="integrations-a2a-no-inbound">
                    The A2A listener is enabled but no member declares an inbound surface, so nothing can reach this
                    project. Declare a fleet member with an executor, or turn the listener off.
                </p>
            ) : null}
            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Inbound members</h2>
                    {status.a2a.inbound.length === 0 ? (
                        <p className="text-sm text-base-content/70">No members declare an inbound A2A surface.</p>
                    ) : (
                        <ul className="grid gap-2 sm:grid-cols-2" data-testid="integrations-a2a-members">
                            {status.a2a.inbound.map((member) => (
                                <li
                                    key={member.member}
                                    className="rounded-md border border-base-content/10 p-3"
                                    data-testid={`integrations-a2a-member-${member.member}`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-sm">{member.member}</span>
                                        <Badge variant="ghost" size="sm">
                                            {member.role ?? 'general'}
                                        </Badge>
                                        <Badge variant={member.writeFenced ? 'success' : 'ghost'} size="sm">
                                            {member.writeFenced ? 'write-fenced' : 'read-only'}
                                        </Badge>
                                    </div>
                                    {status.a2a.enabled ? (
                                        <>
                                            <a
                                                className="mt-1 block break-all font-mono text-xs link"
                                                href={member.cardUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {member.cardUrl}
                                            </a>
                                            <CardInspector cardUrl={member.cardUrl} fetchCard={fetchCard} />
                                            <pre
                                                className="mt-2 overflow-auto rounded bg-base-200 p-2 text-xs"
                                                data-testid={`integrations-a2a-examples-${member.member}`}
                                            >
                                                {[
                                                    a2aExamples(member.cardUrl, status.a2a.auth.envName).card,
                                                    a2aExamples(member.cardUrl, status.a2a.auth.envName).send,
                                                ].join('\n')}
                                            </pre>
                                        </>
                                    ) : (
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            <code className="block break-all font-mono text-xs text-base-content/60">
                                                {member.cardUrl}
                                            </code>
                                            <span className="text-xs text-base-content/50">(A2A listener off)</span>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Intake</h2>
                    {members.length === 0 ? (
                        <p className="text-sm text-base-content/70" data-testid="integrations-a2a-usage-members-empty">
                            No A2A intake in this window.
                        </p>
                    ) : (
                        <table className="table table-sm w-full" data-testid="integrations-a2a-usage-members">
                            <thead>
                                <tr>
                                    <th scope="col">Member</th>
                                    <th scope="col">Received</th>
                                    <th scope="col">Replayed</th>
                                    <th scope="col">Conflict</th>
                                    <th scope="col">Cancelled</th>
                                </tr>
                            </thead>
                            <tbody>
                                {members.map((member) => (
                                    <tr key={member.member}>
                                        <td className="font-mono text-xs">{member.member}</td>
                                        <td>{member.received}</td>
                                        <td>{member.replayed}</td>
                                        <td>{member.conflict}</td>
                                        <td>{member.cancelled}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Auth refusals</h2>
                    {denials.length === 0 ? (
                        <p className="text-sm text-base-content/70" data-testid="integrations-a2a-usage-denials-empty">
                            No refused A2A credentials in this window.
                        </p>
                    ) : (
                        <ul className="text-xs flex flex-col gap-1" data-testid="integrations-a2a-usage-denials">
                            {denials.map((denial) => (
                                <li key={denial.reason}>
                                    <span className="font-mono">{denial.reason}</span> · {denial.count}×
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">A2A tasks</h2>
                    {requests.length === 0 ? (
                        <p className="text-sm text-base-content/70">No A2A tasks yet.</p>
                    ) : (
                        <table className="table table-sm w-full" data-testid="integrations-a2a-tasks">
                            <thead>
                                <tr>
                                    <th scope="col">Message</th>
                                    <th scope="col">Request key</th>
                                    <th scope="col">Run state</th>
                                    <th scope="col">Run</th>
                                </tr>
                            </thead>
                            <tbody>
                                {requests.map((request) => {
                                    const link = traceLink(request.runId);
                                    return (
                                        <tr key={request.messageId}>
                                            <td className="font-mono text-xs">
                                                <a className="link" href={inboxLink()}>
                                                    {request.messageId}
                                                </a>
                                            </td>
                                            <td className="font-mono text-xs">{request.requestKey ?? '—'}</td>
                                            <td>{requestState(request)}</td>
                                            <td className="font-mono text-xs">
                                                {link === null ? (
                                                    (request.runId ?? '—')
                                                ) : (
                                                    <a
                                                        className="link"
                                                        href={link}
                                                        data-testid={`integrations-a2a-run-${request.messageId}`}
                                                    >
                                                        {request.runId}
                                                    </a>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Outbound</h2>
                    {status.a2a.outbound.length === 0 ? (
                        <p className="text-sm text-base-content/70">No outbound members declared.</p>
                    ) : (
                        <ul className="flex flex-col gap-3" data-testid="integrations-a2a-outbound">
                            {status.a2a.outbound.map((member) => {
                                const rows = receipts.find((entry) => entry.member === member.member)?.rows ?? [];
                                return (
                                    <li key={member.member} data-testid={`integrations-a2a-outbound-${member.member}`}>
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-sm">{member.member}</span>
                                            <Badge variant="ghost" size="sm">
                                                {member.kind}
                                            </Badge>
                                            <span className="font-mono text-xs break-all">{member.target}</span>
                                        </div>
                                        <div
                                            className="mt-1 text-xs"
                                            data-testid={`integrations-a2a-auth-${member.member}`}
                                        >
                                            {member.auth === undefined || member.auth.envName === '' ? (
                                                <span className="text-base-content/60">no credential declared</span>
                                            ) : (
                                                <>
                                                    <span className="font-mono">{member.auth.envName}</span>{' '}
                                                    <Badge
                                                        variant={member.auth.tokenPresent ? 'success' : 'warning'}
                                                        size="sm"
                                                    >
                                                        {member.auth.tokenPresent ? 'set' : 'unset'}
                                                    </Badge>
                                                </>
                                            )}
                                        </div>
                                        {rows.length === 0 ? (
                                            <p className="text-xs text-base-content/60">No receipts.</p>
                                        ) : (
                                            <ul className="mt-1 flex flex-col gap-1 text-xs">
                                                {rows.map((row) => (
                                                    <li key={row.messageId} className="font-mono">
                                                        {row.messageId} · {requestState(row)}
                                                        <RemoteRefs row={row} />
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Recent events</h2>
                    {events.length === 0 ? (
                        <p className="text-sm text-base-content/70">No A2A or auth events in this window.</p>
                    ) : (
                        <ul className="flex flex-col gap-1 text-xs" data-testid="integrations-a2a-events">
                            {events.map((event) => (
                                <li key={event.id}>
                                    <a
                                        className="link font-mono"
                                        href={systemEventLink(event.eventName, event.runId ?? null)}
                                    >
                                        {event.eventName}
                                    </a>
                                    <span className="ml-2 text-base-content/60">{event.occurredAt}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>
        </div>
    );
}
