import type { IntegrationsStatus } from '@gobing-ai/spur-contracts';
import { Badge, Button, Card, CardBody } from '../../components/module-kit';
import { clientSnippet, type ProtocolEventRow } from './helpers';

/**
 * Integrations › MCP (task 1424 R4).
 *
 * The advertised catalog (origin + read/write badges, a schema drawer), the `spur://` resource
 * templates, the window's recent calls, and a copyable client config that names the variable
 * holding the token — never the token itself.
 */
export function McpTab({ status, events }: { status: IntegrationsStatus; events: ProtocolEventRow[] }) {
    const snippet = clientSnippet(status);
    const copy = () => {
        if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
            void navigator.clipboard.writeText(snippet);
        }
    };
    return (
        <div className="flex flex-col gap-4">
            <Card>
                <CardBody>
                    <h2 className="text-sm font-semibold mb-2">Tools</h2>
                    <table className="table table-sm w-full" data-testid="integrations-mcp-tools">
                        <thead>
                            <tr>
                                <th scope="col">Tool</th>
                                <th scope="col">Origin</th>
                                <th scope="col">Access</th>
                                <th scope="col">Schema</th>
                            </tr>
                        </thead>
                        <tbody>
                            {status.mcp.tools.map((tool) => (
                                <tr key={tool.name} data-testid={`integrations-tool-${tool.name}`}>
                                    <td className="font-mono text-xs">{tool.name}</td>
                                    <td>
                                        <Badge variant={tool.origin === 'built-in' ? 'primary' : 'secondary'} size="sm">
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
                                    <td>
                                        <details>
                                            <summary className="cursor-pointer text-xs">input schema</summary>
                                            <pre className="mt-1 max-h-64 overflow-auto rounded bg-base-200 p-2 text-xs">
                                                {JSON.stringify(tool.inputSchema, null, 2)}
                                            </pre>
                                        </details>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
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
                        <Button size="sm" variant="ghost" onClick={copy}>
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
        </div>
    );
}
