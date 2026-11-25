import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import type { ReactNode } from 'react';
import { Badge, Card, CardBody, Diagnostic } from '../../components/module-kit';
import {
    clusterRange,
    formatLatency,
    formatWhen,
    gatewayWithoutProjectMcp,
    outboundMembers,
    type ProtocolEventRow,
    stateTone,
    surfaceState,
    unmeasuredLabel,
} from './helpers';

/**
 * Integrations › Summary (task 1424 R3).
 *
 * One row per surface — MCP at the project endpoint and at the gateway root, A2A received and sent
 * (one config per protocol, K44) — with the state chip, the endpoint, the auth variable NAME and the
 * window's activity. The gateway strip renders only
 * when the project is served under a gateway, and says so when its counters are unreadable.
 */

/** One Summary row. */
export interface SummaryRow {
    /** Stable id the E2E asserts on (`integrations-row-<surface>`). */
    surface: 'project-mcp' | 'gateway-mcp' | 'a2a-inbound' | 'a2a-outbound';
    label: string;
    state: ReturnType<typeof surfaceState>;
    endpoint: string;
    envName: string;
    calls: number | null;
    errorRate: number | null;
    lastCall: string | null;
    authDenials: number | null;
}

/** Sum the MCP tool statistics. */
function mcpTotals(usage: IntegrationsUsage | null): { calls: number; errors: number } {
    const totals = (usage?.tools ?? []).reduce(
        (sum, tool) => ({ calls: sum.calls + tool.calls, errors: sum.errors + tool.failures }),
        { calls: 0, errors: 0 },
    );
    return totals;
}

/** The A2A intake totals: received + replayed + conflict are all deliveries; conflicts are errors. */
function a2aTotals(usage: IntegrationsUsage | null): { calls: number; errors: number } {
    return (usage?.a2a ?? []).reduce(
        (sum, member) => ({
            calls: sum.calls + member.received + member.replayed + member.conflict,
            errors: sum.errors + member.conflict,
        }),
        { calls: 0, errors: 0 },
    );
}

/** Auth denials for one surface in the window. */
function denialsFor(usage: IntegrationsUsage | null, surface: string): number {
    return (usage?.authDenied ?? [])
        .filter((entry) => entry.surface === surface)
        .reduce((sum, entry) => sum + entry.count, 0);
}

/** Build the four rows from the status, the usage window and the newest event rows. */
export function summaryRows(
    status: IntegrationsStatus,
    usage: IntegrationsUsage | null,
    mcpEvents: ProtocolEventRow[],
    a2aEvents: ProtocolEventRow[],
): SummaryRow[] {
    const mcp = mcpTotals(usage);
    const a2a = a2aTotals(usage);
    const outbound = outboundMembers(status);
    const gateway = status.gateway.served ? status.gateway : null;
    const gatewayActivity = usage?.gatewayMcpActivity;
    const outboundActivity = usage?.outboundActivity;
    // Error rate is failures over total attempts, so a tool with 3 successes and 1 failure reads 25%.
    const rate = (errors: number, calls: number): number | null =>
        calls + errors === 0 ? null : errors / (calls + errors);
    return [
        {
            surface: 'project-mcp',
            label: 'MCP · project endpoint',
            state: surfaceState(status.mcp),
            endpoint: status.mcp.url ?? status.mcp.path,
            envName: status.mcp.auth.envName,
            calls: mcp.calls,
            errorRate: rate(mcp.errors, mcp.calls),
            lastCall: mcpEvents[0]?.occurredAt ?? null,
            authDenials: denialsFor(usage, 'mcp'),
        },
        {
            surface: 'gateway-mcp',
            label: 'MCP · gateway root',
            state: gateway?.mcp === undefined ? 'off' : surfaceState(gateway.mcp),
            endpoint: gateway === null ? 'not served under a gateway' : gateway.rootMcpUrl,
            envName: gateway?.mcp?.auth.envName ?? '',
            calls: gatewayActivity?.calls ?? null,
            errorRate: gatewayActivity?.calls ? gatewayActivity.failures / gatewayActivity.calls : null,
            lastCall: gatewayActivity?.lastCall ?? null,
            authDenials: gatewayActivity?.authDenials ?? null,
        },
        {
            surface: 'a2a-inbound',
            label: 'A2A · received',
            state: surfaceState(status.a2a),
            endpoint: status.a2a.url ?? status.a2a.basePath,
            envName: status.a2a.auth.envName,
            calls: a2a.calls,
            errorRate: a2a.calls === 0 ? null : a2a.errors / a2a.calls,
            lastCall: a2aEvents.find((event) => event.eventName === 'a2a.message.received')?.occurredAt ?? null,
            authDenials: denialsFor(usage, 'a2a'),
        },
        {
            surface: 'a2a-outbound',
            label: 'A2A · sent',
            state: outbound.length === 0 ? 'off' : 'on',
            endpoint: outbound.map((member) => member.target).join(', '),
            envName: '',
            calls: outboundActivity?.calls ?? null,
            errorRate: outboundActivity?.calls ? outboundActivity.failures / outboundActivity.calls : null,
            lastCall: outboundActivity?.lastCall ?? null,
            authDenials: outboundActivity?.authDenials ?? null,
        },
    ];
}

/** The chip class for one row's state — the error tone is the token-unset case only. */
function chipClass(state: SummaryRow['state']): string {
    const tone = stateTone(state);
    if (tone === 'error') return 'badge-error';
    return tone === 'success' ? 'badge-success' : 'badge-ghost';
}

/** One usage slice: a titled table, or its empty state when the window holds no rows. */
function Slice({
    title,
    testId,
    isEmpty,
    empty,
    head,
    children,
}: {
    title: string;
    testId: string;
    isEmpty: boolean;
    empty: string;
    head: string[];
    children: ReactNode;
}) {
    return (
        <Card>
            <CardBody>
                <h2 className="text-sm font-semibold mb-2">{title}</h2>
                {isEmpty ? (
                    <p className="text-sm text-base-content/70" data-testid={`${testId}-empty`}>
                        {empty}
                    </p>
                ) : (
                    <table className="table table-sm w-full" data-testid={testId}>
                        <thead>
                            <tr>
                                {head.map((column) => (
                                    <th key={column} scope="col">
                                        {column}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>{children}</tbody>
                    </table>
                )}
            </CardBody>
        </Card>
    );
}

/** Render the Summary tab. */
export function SummaryTab({
    status,
    usage,
    mcpEvents,
    a2aEvents,
}: {
    status: IntegrationsStatus;
    usage: IntegrationsUsage | null;
    mcpEvents: ProtocolEventRow[];
    a2aEvents: ProtocolEventRow[];
}) {
    const rows = summaryRows(status, usage, mcpEvents, a2aEvents);
    const tools = usage?.tools ?? [];
    const resources = usage?.resources ?? [];
    const actors = usage?.byActor ?? [];
    const members = usage?.a2a ?? [];
    const denials = usage?.authDenied ?? [];
    const clusters = usage?.failureClusters ?? [];
    return (
        <div className="flex flex-col gap-4">
            {status.configDiagnostic === undefined ? null : (
                <Diagnostic
                    tone="warning"
                    testId="integrations-config-diagnostic"
                    title="The project config could not be loaded at startup"
                    detail="Every surface below is reporting its env-only default, so a surface you configured in .spur/config.yaml may show as off."
                    code={status.configDiagnostic}
                    hint="Fix the file it names, then restart `spur self serve`."
                />
            )}
            {gatewayWithoutProjectMcp(status) ? (
                <div
                    role="status"
                    className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-base-content/80"
                    data-testid="integrations-gateway-mcp-warning"
                >
                    The gateway root MCP is on but this project's <span className="font-mono">server.mcp.enabled</span>{' '}
                    is off: the gateway's <span className="font-mono">tools/call</span> forwards to the project's
                    loopback <span className="font-mono">/mcp</span>, so enable it on every target project.
                </div>
            ) : null}
            <Card>
                <CardBody>
                    <table className="table table-sm w-full" data-testid="integrations-summary-table">
                        <thead>
                            <tr>
                                <th scope="col">Surface</th>
                                <th scope="col">State</th>
                                <th scope="col">Endpoint</th>
                                <th scope="col">Auth</th>
                                <th scope="col">Calls</th>
                                <th scope="col">Error rate</th>
                                <th scope="col">Last call</th>
                                <th scope="col">Auth denials</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.surface} data-testid={`integrations-row-${row.surface}`}>
                                    <td className="font-semibold">{row.label}</td>
                                    <td>
                                        <Badge className={chipClass(row.state)} size="sm">
                                            {row.state}
                                        </Badge>
                                    </td>
                                    <td className="font-mono text-xs break-all">{row.endpoint}</td>
                                    <td className="font-mono text-xs">{row.envName === '' ? '—' : row.envName}</td>
                                    <td>{row.calls ?? '—'}</td>
                                    <td>{row.errorRate === null ? '—' : `${Math.round(row.errorRate * 100)}%`}</td>
                                    <td>{formatWhen(row.lastCall)}</td>
                                    <td>{row.authDenials ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardBody>
            </Card>
            <Slice
                title="Tool latency"
                testId="integrations-usage-tools"
                isEmpty={tools.length === 0}
                empty="No MCP tool calls in this window."
                head={['Tool', 'Calls', 'Failures', 'p50', 'p95', 'Measured']}
            >
                {tools.map((tool) => (
                    <tr key={tool.tool} data-testid={`integrations-usage-tool-${tool.tool}`}>
                        <td className="font-mono text-xs">{tool.tool}</td>
                        <td>{tool.calls}</td>
                        <td>{tool.failures}</td>
                        <td>{formatLatency(tool.p50Ms)}</td>
                        <td>{formatLatency(tool.p95Ms)}</td>
                        <td className="text-xs">{unmeasuredLabel(tool.durationUnmeasured)}</td>
                    </tr>
                ))}
            </Slice>

            <Slice
                title="Resource reads"
                testId="integrations-usage-resources"
                isEmpty={resources.length === 0}
                empty="No resource reads in this window."
                head={['Resource', 'Reads', 'Failures']}
            >
                {resources.map((resource) => (
                    <tr key={resource.uri}>
                        <td className="font-mono text-xs break-all">{resource.uri}</td>
                        <td>{resource.reads}</td>
                        <td>{resource.failures}</td>
                    </tr>
                ))}
            </Slice>

            <Slice
                title="Actor attribution"
                testId="integrations-usage-actors"
                isEmpty={actors.length === 0}
                empty="No actor attribution in this window."
                head={['Actor', 'Calls', 'Failures']}
            >
                {actors.map((actor) => (
                    <tr key={actor.actor}>
                        <td className="font-mono text-xs">{actor.actor}</td>
                        <td>{actor.calls}</td>
                        <td>{actor.failures}</td>
                    </tr>
                ))}
            </Slice>

            <Slice
                title="A2A intake"
                testId="integrations-usage-a2a"
                isEmpty={members.length === 0}
                empty="No A2A intake in this window."
                head={['Member', 'Received', 'Replayed', 'Conflict', 'Cancelled']}
            >
                {members.map((member) => (
                    <tr key={member.member}>
                        <td className="font-mono text-xs">{member.member}</td>
                        <td>{member.received}</td>
                        <td>{member.replayed}</td>
                        <td>{member.conflict}</td>
                        <td>{member.cancelled}</td>
                    </tr>
                ))}
            </Slice>

            <Slice
                title="Auth refusals"
                testId="integrations-usage-denials"
                isEmpty={denials.length === 0}
                empty="No refused credentials in this window."
                head={['Surface', 'Reason', 'Count']}
            >
                {denials.map((denial) => (
                    <tr key={`${denial.surface}:${denial.reason}`}>
                        <td>{denial.surface}</td>
                        <td>{denial.reason}</td>
                        <td>{denial.count}</td>
                    </tr>
                ))}
            </Slice>

            <Slice
                title="Repeated failures"
                testId="integrations-usage-clusters"
                isEmpty={clusters.length === 0}
                empty="No repeated failure pair in this window."
                head={['Tool', 'Error code', 'Count', 'Window']}
            >
                {clusters.map((cluster) => (
                    <tr key={`${cluster.tool}:${cluster.errorCode}`}>
                        <td className="font-mono text-xs">{cluster.tool}</td>
                        <td className="font-mono text-xs">{cluster.errorCode}</td>
                        <td>{cluster.count}</td>
                        <td className="text-xs">{clusterRange(cluster)}</td>
                    </tr>
                ))}
            </Slice>

            {status.gateway.served ? (
                <Card>
                    <CardBody>
                        <h2 className="text-sm font-semibold mb-2">Gateway</h2>
                        {status.gateway.counters === null ? (
                            <p className="text-sm text-base-content/70" data-testid="gateway-counters-unavailable">
                                Counters unavailable{status.gateway.diagnostic ? `: ${status.gateway.diagnostic}` : ''}
                            </p>
                        ) : (
                            <dl
                                className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"
                                data-testid="gateway-counters"
                            >
                                <div>
                                    <dt className="text-base-content/60">Since</dt>
                                    <dd>{formatWhen(status.gateway.counters.since)}</dd>
                                </div>
                                <div>
                                    <dt className="text-base-content/60">Requests</dt>
                                    <dd>{status.gateway.counters.requests}</dd>
                                </div>
                                <div>
                                    <dt className="text-base-content/60">4xx</dt>
                                    <dd>{status.gateway.counters.status4xx}</dd>
                                </div>
                                <div>
                                    <dt className="text-base-content/60">5xx</dt>
                                    <dd>{status.gateway.counters.status5xx}</dd>
                                </div>
                            </dl>
                        )}
                    </CardBody>
                </Card>
            ) : null}
        </div>
    );
}
