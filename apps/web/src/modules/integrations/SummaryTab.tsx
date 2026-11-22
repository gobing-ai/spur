import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { Badge, Card, CardBody } from '../../components/module-kit';
import type { ProtocolEventRow } from './helpers';
import { stateTone, surfaceState } from './helpers';

/**
 * Integrations › Summary (task 1424 R3).
 *
 * One row per surface — project MCP, gateway MCP, A2A inbound, A2A outbound — with the state chip,
 * the endpoint, the auth variable NAME and the window's activity. The gateway strip renders only
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
    calls: number;
    errorRate: number | null;
    lastCall: string | null;
    authDenials: number;
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
    const gateway = status.gateway.served ? status.gateway : null;
    // Error rate is failures over total attempts, so a tool with 3 successes and 1 failure reads 25%.
    const rate = (errors: number, calls: number): number | null =>
        calls + errors === 0 ? null : errors / (calls + errors);
    return [
        {
            surface: 'project-mcp',
            label: 'Project MCP',
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
            label: 'Gateway MCP',
            // A gateway with unreadable counters is still ON; the strip below carries the failure.
            state: gateway === null ? 'off' : 'on',
            endpoint: gateway === null ? 'not served under a gateway' : gateway.rootMcpUrl,
            envName: 'SPUR_GATEWAY_MCP_AUTH_ENV',
            calls: gateway?.counters?.requests ?? 0,
            errorRate:
                gateway?.counters === null || gateway === null || gateway.counters === undefined
                    ? null
                    : gateway.counters.requests === 0
                      ? null
                      : (gateway.counters.status5xx + gateway.counters.status4xx) / gateway.counters.requests,
            lastCall: null,
            authDenials: denialsFor(usage, 'gateway'),
        },
        {
            surface: 'a2a-inbound',
            label: 'A2A inbound',
            state: surfaceState(status.a2a),
            endpoint: `${status.a2a.basePath} (${status.a2a.inbound.length} member${status.a2a.inbound.length === 1 ? '' : 's'})`,
            envName: status.a2a.auth.envName,
            calls: a2a.calls,
            errorRate: rate(a2a.errors, a2a.calls),
            lastCall: a2aEvents[0]?.occurredAt ?? null,
            authDenials: denialsFor(usage, 'a2a'),
        },
        {
            surface: 'a2a-outbound',
            label: 'A2A outbound',
            state: status.a2a.outbound.length === 0 ? 'off' : 'on',
            endpoint: `${status.a2a.outbound.length} outbound member${status.a2a.outbound.length === 1 ? '' : 's'}`,
            envName: '',
            calls: 0,
            errorRate: null,
            lastCall: null,
            authDenials: 0,
        },
    ];
}

/** The chip class for one row's state — the error tone is the token-unset case only. */
function chipClass(state: SummaryRow['state']): string {
    const tone = stateTone(state);
    if (tone === 'error') return 'badge-error';
    return tone === 'success' ? 'badge-success' : 'badge-ghost';
}

/** A timestamp rendered compactly; an absent one reads `—` rather than an empty cell. */
function when(value: string | null): string {
    if (value === null || value === '') return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
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
    return (
        <div className="flex flex-col gap-4">
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
                                    <td>{row.calls}</td>
                                    <td>{row.errorRate === null ? '—' : `${Math.round(row.errorRate * 100)}%`}</td>
                                    <td>{when(row.lastCall)}</td>
                                    <td>{row.authDenials}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </CardBody>
            </Card>
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
                                    <dd>{when(status.gateway.counters.since)}</dd>
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
