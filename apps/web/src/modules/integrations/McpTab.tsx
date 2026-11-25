import type { IntegrationsAgentReadiness, IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { useState } from 'react';
import { Badge, Button, Card, CardBody, ModuleTabs } from '../../components/module-kit';
import {
    clusterRange,
    discoverProbe,
    filterTools,
    formatLatency,
    formatWhen,
    gatewayMcpCommand,
    gatewayWithoutProjectMcp,
    MCP_CLIENT_AGENTS,
    type McpClientAgent,
    type McpClientTransport,
    type ProtocolEventRow,
    projectMcpCommand,
    renderClientConfig,
    unmeasuredLabel,
} from './helpers';

/** The transport choices the Client config card offers, in recommendation order. */
const MCP_TRANSPORTS: ReadonlyArray<{ id: McpClientTransport; label: string }> = [
    { id: 'gateway-stdio', label: 'Gateway stdio bridge' },
    { id: 'project-stdio', label: 'Project stdio bridge' },
    { id: 'http', label: 'Direct HTTP (MCP 2026-07-28+)' },
];

/** How a readiness state reads as a badge tone. */
const READINESS_TONE: Record<
    IntegrationsAgentReadiness['agents'][number]['state'],
    'success' | 'primary' | 'warning' | 'ghost' | 'error'
> = {
    active: 'success',
    configured: 'primary',
    misconfigured: 'warning',
    'not-configured': 'ghost',
    'not-installed': 'error',
};

/**
 * Integrations › MCP (task 1424 R4; namespace and exposure diagnostics 1438 R2).
 *
 * The advertised catalog (origin + read/write badges, the window's call counters and latency, a
 * schema drawer), the workflow namespace and the exposures the resolver refused with their
 * remedies, the `spur://` resource templates, the window's recent calls, and the copyable client
 * config, command and probe — each naming the variable holding the token, never the token itself.
 *
 * The call columns join `usage.tools` by name (1446 R5); an uncalled tool reads `0`/`0`/`—`/`—`, and
 * the separate latency table keeps only the usage rows the catalog does not advertise.
 *
 * 1449 R3/R4: the Client config card is a per-agent TabView in each agent's OWN native format, and
 * the readiness pins report what the read-only probe found — a config the Board never writes.
 */
export function McpTab({
    status,
    events,
    usage,
    readiness = null,
    fallbackOrigin,
}: {
    status: IntegrationsStatus;
    events: ProtocolEventRow[];
    usage: IntegrationsUsage | null;
    readiness?: IntegrationsAgentReadiness | null;
    fallbackOrigin?: string;
}) {
    const [query, setQuery] = useState('');
    const [clientAgent, setClientAgent] = useState<McpClientAgent>('claude');
    const [transport, setTransport] = useState<McpClientTransport>('gateway-stdio');
    const view = renderClientConfig(status, clientAgent, transport, fallbackOrigin);
    const needsProjectMcp = gatewayWithoutProjectMcp(status);
    const tools = filterTools(status.mcp.tools, query);
    const issues = status.mcp.exposureIssues ?? [];
    const toolUsage = usage?.tools ?? [];
    const usageByName = new Map(toolUsage.map((row) => [row.tool, row]));
    const advertised = new Set(status.mcp.tools.map((tool) => tool.name));
    const unadvertisedUsage = toolUsage.filter((row) => !advertised.has(row.tool));
    // Attempts in the window, so a failing tool still reads as traffic (1446 R5).
    const totalCalls = toolUsage.reduce((sum, row) => sum + row.calls + row.failures, 0);
    const resourceUsage = usage?.resources ?? [];
    const clusters = usage?.failureClusters ?? [];
    const command = projectMcpCommand(status);
    const gatewayCommand = gatewayMcpCommand(status);
    const probe = discoverProbe(status);
    const copy = (text: string) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
            void navigator.clipboard.writeText(text);
        }
    };
    return (
        <div className="flex flex-col gap-4">
            {needsProjectMcp ? (
                <div
                    role="status"
                    className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-base-content/80"
                    data-testid="integrations-mcp-gateway-warning"
                >
                    The gateway's <span className="font-mono">/mcp</span> entry is on while this project's
                    <span className="font-mono"> server.mcp.enabled</span> is off: gateway{' '}
                    <span className="font-mono">tools/call</span> forwards to the project's loopback{' '}
                    <span className="font-mono">/mcp</span>, so set{' '}
                    <span className="font-mono">server.mcp.enabled: true</span> on every target project.
                </div>
            ) : null}
            <Card>
                <CardBody>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-semibold">Tools</h2>
                                <Badge variant="ghost" size="sm" data-testid="integrations-mcp-total-calls">
                                    {totalCalls} calls
                                </Badge>
                            </div>
                            {status.mcp.namespace === undefined ? null : (
                                <p className="text-xs text-base-content/70" data-testid="integrations-mcp-namespace">
                                    namespace {status.mcp.namespace ?? 'none'} · from{' '}
                                    {status.mcp.namespaceSource ?? 'none'}
                                </p>
                            )}
                        </div>
                        <input
                            type="search"
                            className="input input-sm"
                            placeholder="Filter tools"
                            aria-label="Filter tools"
                            data-testid="integrations-mcp-filter"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </div>
                    {tools.length === 0 ? (
                        <p className="text-sm text-base-content/70" data-testid="integrations-mcp-no-match">
                            No advertised tool matches “{query}”.
                        </p>
                    ) : (
                        <table className="table table-sm w-full" data-testid="integrations-mcp-tools">
                            <thead>
                                <tr>
                                    <th scope="col">Tool</th>
                                    <th scope="col">Origin</th>
                                    <th scope="col">Access</th>
                                    <th scope="col">Calls</th>
                                    <th scope="col">Failures</th>
                                    <th scope="col">p50 / p95</th>
                                    <th scope="col">Last call</th>
                                    <th scope="col">Schema</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tools.map((tool) => {
                                    const row = usageByName.get(tool.name);
                                    return (
                                        <tr key={tool.name} data-testid={`integrations-tool-${tool.name}`}>
                                            <td className="font-mono text-xs">{tool.name}</td>
                                            <td>
                                                <Badge
                                                    variant={
                                                        tool.origin === 'built-in'
                                                            ? 'primary'
                                                            : tool.origin === 'manifest'
                                                              ? 'info'
                                                              : 'secondary'
                                                    }
                                                    size="sm"
                                                >
                                                    {tool.origin}
                                                </Badge>
                                            </td>
                                            <td>
                                                <Badge
                                                    variant={tool.annotations.readOnlyHint ? 'success' : 'warning'}
                                                    size="sm"
                                                >
                                                    {tool.annotations.readOnlyHint ? 'read' : 'write'}
                                                </Badge>
                                            </td>
                                            <td>{row?.calls ?? 0}</td>
                                            <td>{row?.failures ?? 0}</td>
                                            <td>
                                                {row === undefined
                                                    ? '—'
                                                    : `${formatLatency(row.p50Ms)} / ${formatLatency(row.p95Ms)}`}
                                            </td>
                                            <td>{formatWhen(row?.lastCalledAt ?? null)}</td>
                                            <td>
                                                <details>
                                                    <summary className="cursor-pointer text-xs">input schema</summary>
                                                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-base-200 p-2 text-xs">
                                                        {JSON.stringify(tool.inputSchema, null, 2)}
                                                    </pre>
                                                </details>
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
                    <h2 className="text-sm font-semibold mb-2">Exposure findings</h2>
                    {issues.length === 0 ? (
                        <p className="text-sm text-base-content/70" data-testid="integrations-mcp-exposure-clear">
                            Every workflow that opted into MCP exposure is advertised.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2 text-xs" data-testid="integrations-mcp-exposure">
                            {issues.map((issue) => (
                                <li key={`${issue.tool}:${issue.file}:${issue.reason}`}>
                                    <span className="font-mono">{issue.tool}</span>{' '}
                                    <Badge variant="error" size="sm">
                                        {issue.reason}
                                    </Badge>
                                    <div className="text-base-content/70">
                                        {issue.file} — {issue.remedy}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Resource templates</h2>
                    {status.mcp.resources.length === 0 ? (
                        <p className="text-sm text-base-content/70">No resource templates advertised.</p>
                    ) : (
                        <ul className="text-xs font-mono flex flex-col gap-1" data-testid="integrations-mcp-resources">
                            {status.mcp.resources.map((resource) => (
                                <li key={resource.uriTemplate}>
                                    {resource.uriTemplate}
                                    {resource.description === '' ? null : (
                                        <span className="ml-2 font-sans text-base-content/60">
                                            {resource.description}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Unadvertised tool usage</h2>
                    {unadvertisedUsage.length === 0 ? (
                        <p className="text-sm text-base-content/70" data-testid="integrations-mcp-usage-tools-empty">
                            No calls to a tool outside the advertised catalog in this window.
                        </p>
                    ) : (
                        <table className="table table-sm w-full" data-testid="integrations-mcp-usage-tools">
                            <thead>
                                <tr>
                                    <th scope="col">Tool</th>
                                    <th scope="col">Calls</th>
                                    <th scope="col">Failures</th>
                                    <th scope="col">p50</th>
                                    <th scope="col">p95</th>
                                    <th scope="col">Measured</th>
                                </tr>
                            </thead>
                            <tbody>
                                {unadvertisedUsage.map((tool) => (
                                    <tr key={tool.tool}>
                                        <td className="font-mono text-xs">{tool.tool}</td>
                                        <td>{tool.calls}</td>
                                        <td>{tool.failures}</td>
                                        <td>{formatLatency(tool.p50Ms)}</td>
                                        <td>{formatLatency(tool.p95Ms)}</td>
                                        <td className="text-xs">{unmeasuredLabel(tool.durationUnmeasured)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Resource reads</h2>
                    {resourceUsage.length === 0 ? (
                        <p
                            className="text-sm text-base-content/70"
                            data-testid="integrations-mcp-usage-resources-empty"
                        >
                            No resource reads in this window.
                        </p>
                    ) : (
                        <ul className="text-xs flex flex-col gap-1" data-testid="integrations-mcp-usage-resources">
                            {resourceUsage.map((resource) => (
                                <li key={resource.uri} className="font-mono break-all">
                                    {resource.uri}
                                    <span className="ml-2 font-sans text-base-content/60">
                                        {resource.reads} reads · {resource.failures} failures
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Repeated failures</h2>
                    {clusters.length === 0 ? (
                        <p className="text-sm text-base-content/70" data-testid="integrations-mcp-usage-clusters-empty">
                            No repeated failure pair in this window.
                        </p>
                    ) : (
                        <ul className="text-xs flex flex-col gap-1" data-testid="integrations-mcp-usage-clusters">
                            {clusters.map((cluster) => (
                                <li key={`${cluster.tool}:${cluster.errorCode}`}>
                                    <span className="font-mono">{cluster.tool}</span> ·{' '}
                                    <span className="font-mono">{cluster.errorCode}</span> · {cluster.count}× ·{' '}
                                    {clusterRange(cluster)}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Recent calls</h2>
                    {events.length === 0 ? (
                        <p className="text-sm text-base-content/70">No MCP calls in this window.</p>
                    ) : (
                        <table className="table table-sm w-full" data-testid="integrations-mcp-calls">
                            <thead>
                                <tr>
                                    <th scope="col">Tool</th>
                                    <th scope="col">Duration</th>
                                    <th scope="col">Outcome</th>
                                    <th scope="col">Error code</th>
                                </tr>
                            </thead>
                            <tbody>
                                {events.map((event) => (
                                    <tr key={event.id}>
                                        <td className="font-mono text-xs">{event.tool ?? event.eventName}</td>
                                        <td>
                                            {event.durationMs === null || event.durationMs === undefined
                                                ? '—'
                                                : `${event.durationMs}ms`}
                                        </td>
                                        <td>{event.outcome ?? '—'}</td>
                                        <td className="font-mono text-xs">{event.errorCode ?? '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h2 className="text-sm font-semibold">Client config</h2>
                        <div className="flex flex-wrap items-center gap-1" data-testid="integrations-mcp-transport">
                            {MCP_TRANSPORTS.map((option) => (
                                <Button
                                    key={option.id}
                                    size="sm"
                                    variant={option.id === transport ? 'primary' : 'ghost'}
                                    data-testid={`integrations-mcp-transport-${option.id}`}
                                    onClick={() => setTransport(option.id)}
                                >
                                    {option.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <ModuleTabs
                        tabs={MCP_CLIENT_AGENTS.map((agent) => ({
                            id: agent,
                            label: renderClientConfig(status, agent, transport, fallbackOrigin).label,
                        }))}
                        value={clientAgent}
                        onChange={(id) => setClientAgent(id as McpClientAgent)}
                        label="MCP client agents"
                        idPrefix="integrations-mcp-client"
                        className="mb-2 flex-wrap"
                    />
                    <div
                        id={`integrations-mcp-client-panel-${clientAgent}`}
                        role="tabpanel"
                        aria-labelledby={`integrations-mcp-client-${clientAgent}`}
                    >
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <p
                                className="font-mono text-xs text-base-content/70"
                                data-testid="integrations-mcp-client-path"
                            >
                                {view.configPath} · {view.format}
                            </p>
                            <Button size="sm" variant="ghost" onClick={() => copy(view.snippet)}>
                                Copy
                            </Button>
                        </div>
                        <pre
                            className="overflow-auto rounded bg-base-200 p-2 text-xs"
                            data-testid="integrations-mcp-snippet"
                        >
                            {view.snippet}
                        </pre>
                        <p
                            className="mt-2 text-xs text-base-content/70"
                            data-testid="integrations-mcp-client-transport"
                        >
                            {view.transportNote}
                        </p>
                        <p className="mt-1 text-xs text-base-content/70" data-testid="integrations-mcp-client-auth">
                            {view.authNote}
                        </p>
                        {view.exportCommand === null ? null : (
                            <div className="mt-2">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <h3 className="text-xs font-semibold">Set the token first</h3>
                                    <Button size="sm" variant="ghost" onClick={() => copy(view.exportCommand ?? '')}>
                                        Copy
                                    </Button>
                                </div>
                                <pre
                                    className="overflow-auto rounded bg-base-200 p-2 text-xs"
                                    data-testid="integrations-mcp-client-export"
                                >
                                    {view.exportCommand}
                                </pre>
                            </div>
                        )}
                    </div>
                </CardBody>
            </Card>

            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Agent readiness</h2>
                    {readiness === null || !readiness.available ? (
                        <p
                            className="text-sm text-base-content/70"
                            data-testid="integrations-mcp-readiness-unavailable"
                        >
                            {readiness?.reason ?? 'This server does not report per-agent readiness.'}
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-2 text-xs" data-testid="integrations-mcp-readiness">
                            {readiness.agents.map((entry) => (
                                <li key={entry.agent} data-testid={`integrations-readiness-${entry.agent}`}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold">{entry.label}</span>
                                        <Badge variant={READINESS_TONE[entry.state]} size="sm">
                                            {entry.state}
                                        </Badge>
                                        <span className="font-mono text-[11px] text-base-content/60">
                                            {entry.transport ?? 'no entry'} · {entry.observedCalls} calls
                                        </span>
                                    </div>
                                    <div className="text-base-content/70">{entry.detail}</div>
                                    {entry.remedy === null ? null : (
                                        <div className="text-base-content/60">→ {entry.remedy}</div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardBody>
            </Card>

            {command === null ? null : (
                <Card>
                    <CardBody>
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <h2 className="text-sm font-semibold">Project command</h2>
                            <Button size="sm" variant="ghost" onClick={() => copy(command)}>
                                Copy
                            </Button>
                        </div>
                        <pre
                            className="overflow-auto rounded bg-base-200 p-2 text-xs"
                            data-testid="integrations-mcp-project-command"
                        >
                            {command}
                        </pre>
                        {gatewayCommand === null ? null : (
                            <>
                                <h3 className="text-xs font-semibold mt-3 mb-1">Gateway command</h3>
                                <pre
                                    className="overflow-auto rounded bg-base-200 p-2 text-xs"
                                    data-testid="integrations-mcp-gateway-command"
                                >
                                    {gatewayCommand}
                                </pre>
                            </>
                        )}
                        {probe === null ? null : (
                            <>
                                <div className="flex items-center justify-between gap-2 mt-3 mb-1">
                                    <h3 className="text-xs font-semibold">Discovery probe</h3>
                                    <Button size="sm" variant="ghost" onClick={() => copy(probe)}>
                                        Copy
                                    </Button>
                                </div>
                                <pre
                                    className="overflow-auto rounded bg-base-200 p-2 text-xs"
                                    data-testid="integrations-mcp-probe"
                                >
                                    {probe}
                                </pre>
                            </>
                        )}
                    </CardBody>
                </Card>
            )}
        </div>
    );
}
