import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { useState } from 'react';
import { Badge, Button, Card, CardBody } from '../../components/module-kit';
import {
    clientSnippet,
    clusterRange,
    discoverProbe,
    filterTools,
    formatLatency,
    formatWhen,
    gatewayMcpCommand,
    type ProtocolEventRow,
    projectMcpCommand,
    unmeasuredLabel,
} from './helpers';

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
 */
export function McpTab({
    status,
    events,
    usage,
}: {
    status: IntegrationsStatus;
    events: ProtocolEventRow[];
    usage: IntegrationsUsage | null;
}) {
    const [query, setQuery] = useState('');
    const snippet = clientSnippet(status);
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
                    <div className="flex items-center justify-between gap-2 mb-2">
                        <h2 className="text-sm font-semibold">Client config</h2>
                        <Button size="sm" variant="ghost" onClick={() => copy(snippet)}>
                            Copy
                        </Button>
                    </div>
                    <pre
                        className="overflow-auto rounded bg-base-200 p-2 text-xs"
                        data-testid="integrations-mcp-snippet"
                    >
                        {snippet}
                    </pre>
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
