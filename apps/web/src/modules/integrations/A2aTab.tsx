import type { IntegrationsStatus } from '@gobing-ai/spur-contracts';
import { Badge, Card, CardBody } from '../../components/module-kit';
import { type InboxRequestRow, inboxLink, type ProtocolEventRow, requestState, systemEventLink } from './helpers';

/**
 * Integrations › A2A (task 1424 R5).
 *
 * Inbound member cards (public card URL, write-fenced badge), the A2A tasks the listener created
 * (the `a2a:` request-key family) linking to Projects › Inbox, the outbound receipts per declared
 * member, and recent A2A/auth events linking into Observability › System Events.
 */
export function A2aTab({
    status,
    requests,
    receipts,
    events,
}: {
    status: IntegrationsStatus;
    requests: InboxRequestRow[];
    receipts: Array<{ member: string; rows: InboxRequestRow[] }>;
    events: ProtocolEventRow[];
}) {
    return (
        <div className="flex flex-col gap-4">
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
                                        <a
                                            className="mt-1 block break-all font-mono text-xs link"
                                            href={member.cardUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {member.cardUrl}
                                        </a>
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
                                {requests.map((request) => (
                                    <tr key={request.messageId}>
                                        <td className="font-mono text-xs">
                                            <a className="link" href={inboxLink()}>
                                                {request.messageId}
                                            </a>
                                        </td>
                                        <td className="font-mono text-xs">{request.requestKey ?? '—'}</td>
                                        <td>{requestState(request)}</td>
                                        <td className="font-mono text-xs">{request.runId ?? '—'}</td>
                                    </tr>
                                ))}
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
                                        {rows.length === 0 ? (
                                            <p className="text-xs text-base-content/60">No receipts.</p>
                                        ) : (
                                            <ul className="mt-1 flex flex-col gap-1 text-xs">
                                                {rows.map((row) => (
                                                    <li key={row.messageId} className="font-mono">
                                                        {row.messageId} · {requestState(row)}
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
