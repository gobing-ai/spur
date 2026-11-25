import type { IntegrationsStatus } from '@gobing-ai/spur-contracts';
import { withBase } from '../../lib/base-path';

/**
 * The Integrations module's pure projections (feature A82, task 1424).
 *
 * Kept out of the components so the rules the task pins — the state-chip vocabulary, the copyable
 * snippet, which inbox rows are A2A work — are testable without mounting a tree.
 */

/** The usage windows the shell offers, mapped to the `since` it sends. */
export const USAGE_WINDOWS = ['1h', '24h', '7d', 'all'] as const;
/** One selectable usage window. */
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

/** The `since` timestamp for a window, or undefined for `all` (the procedure's unbounded read). */
export function sinceForWindow(window: UsageWindow, now = Date.now()): string | undefined {
    const hours: Record<Exclude<UsageWindow, 'all'>, number> = { '1h': 1, '24h': 24, '7d': 24 * 7 };
    if (window === 'all') return undefined;
    return new Date(now - hours[window] * 60 * 60 * 1000).toISOString();
}

/** One surface's health state, in the vocabulary the Summary renders. */
export type SurfaceState = 'off' | 'on' | 'on · token unset';

/**
 * `off` when the surface is disabled; `on · token unset` when it is enabled but neither a bearer
 * token nor the unauthenticated policy is in force (an error the operator must see); otherwise `on`.
 */
export function surfaceState(surface: {
    enabled: boolean;
    auth: { tokenPresent: boolean; allowUnauthenticated?: boolean };
}): SurfaceState {
    if (!surface.enabled) return 'off';
    return surface.auth.tokenPresent || surface.auth.allowUnauthenticated === true ? 'on' : 'on · token unset';
}

/** How a state chip is toned: an enabled surface with no token is the module's only error. */
export function stateTone(state: SurfaceState): 'error' | 'success' | 'neutral' {
    if (state === 'on · token unset') return 'error';
    return state === 'on' ? 'success' : 'neutral';
}

/**
 * The copyable client config for the MCP surface. It names the endpoint and the variable holding
 * the token — never a value, because the Board cannot read one.
 */
export function clientSnippet(status: IntegrationsStatus, fallbackOrigin?: string): string {
    return renderClientConfig(status, 'generic', 'http', fallbackOrigin).snippet;
}

/** The coding agents the Client config tabs cover, in the Board's display order. */
export const MCP_CLIENT_AGENTS = [
    'claude',
    'codex',
    'gemini',
    'pi',
    'omp',
    'opencode',
    'grok',
    'openclaw',
    'generic',
] as const;
/** One agent with a verified native MCP config format (1449 R3). */
export type McpClientAgent = (typeof MCP_CLIENT_AGENTS)[number];

/** How a client reaches the endpoint: a stdio bridge, or MCP over HTTP directly. */
export type McpClientTransport = 'gateway-stdio' | 'project-stdio' | 'http';

/** The display names and the native config file each agent reads. */
const CLIENT_AGENT_LABELS: Record<McpClientAgent, { label: string; path: string }> = {
    claude: { label: 'Claude Code', path: '~/.claude.json (or .mcp.json)' },
    codex: { label: 'Codex', path: '~/.codex/config.toml' },
    gemini: { label: 'Gemini CLI', path: '~/.gemini/settings.json' },
    pi: { label: 'pi', path: '.pi/mcp.json' },
    omp: { label: 'omp', path: '~/.omp/agent/config.yml' },
    opencode: { label: 'OpenCode', path: 'opencode.json' },
    grok: { label: 'Grok CLI', path: '.grok/config.toml' },
    openclaw: { label: 'OpenClaw', path: '~/.openclaw/config.json' },
    generic: { label: 'Generic HTTP', path: 'any MCP 2026-07-28 client' },
};

/**
 * The clients whose MCP revision predates 2026-07-28: they reach a server through `spur mcp` over
 * stdio, and a direct HTTP entry is refused (`docs/design/mcp-agent-adoption.md`).
 */
const LEGACY_REVISION_AGENTS: readonly McpClientAgent[] = ['claude', 'codex', 'pi'];

/** One rendered client config: the snippet plus the guidance that makes it actionable. */
export interface McpClientConfigView {
    agent: McpClientAgent;
    label: string;
    format: 'json' | 'toml' | 'yaml';
    configPath: string;
    snippet: string;
    transportNote: string;
    authNote: string;
    /** The `export` line to run first when a required token is unset; null when nothing is missing. */
    exportCommand: string | null;
}

/** The endpoint a snippet should name: the project's, the gateway's, or this Board's own origin. */
function clientUrl(status: IntegrationsStatus, fallbackOrigin?: string): string {
    if (status.mcp.url !== null) return status.mcp.url;
    if (status.gateway?.served === true && status.gateway.mcp?.enabled === true) return status.gateway.rootMcpUrl;
    const origin = (fallbackOrigin ?? '').replace(/\/+$/, '');
    return origin === '' ? '<server>/mcp' : `${origin}/mcp`;
}

/** True when this surface admits local callers with no bearer token at all. */
function unauthenticated(status: IntegrationsStatus): boolean {
    return status.mcp.auth.allowUnauthenticated === true && !status.mcp.auth.tokenPresent;
}

/** The `Authorization` header value, or null when this surface needs no header. */
function authorization(status: IntegrationsStatus): string | null {
    if (unauthenticated(status)) return null;
    return `Bearer ${envRef(status.mcp.auth.envName)}`;
}

/** The inline auth guidance: what the variable is, and the one command that sets it. */
function authGuidance(status: IntegrationsStatus): { note: string; exportCommand: string | null } {
    const envName = status.mcp.auth.envName;
    if (unauthenticated(status))
        return {
            note: 'No Authorization header: server.mcp.allowUnauthenticated admits local callers without a token.',
            exportCommand: null,
        };
    if (envName === '')
        return {
            note: 'No credential is configured: set server.mcp.authEnv to the NAME of an environment variable holding the token.',
            exportCommand: null,
        };
    const note = `${envName} names an environment variable — the token value is never stored in the config or shown here.`;
    return {
        note: status.mcp.auth.tokenPresent ? note : `${note} It is not set in this server's environment yet.`,
        exportCommand: status.mcp.auth.tokenPresent ? null : `export ${envName}="$(openssl rand -hex 32)"`,
    };
}

/** The `command`/`args` a stdio client runs for one transport. */
function stdioCommand(transport: McpClientTransport, url: string): string[] {
    return transport === 'gateway-stdio' ? ['spur', 'mcp', '--gateway'] : ['spur', 'mcp', '--url', url];
}

/** `key = "value"` with the JSON escaping TOML accepts for a basic string. */
const tomlString = (value: string): string => JSON.stringify(value);

/** A JSON `headers` block at one indentation pad, or nothing when there is no header. */
function jsonHeaders(header: Record<string, string> | null, pad: string): string[] {
    return header === null
        ? []
        : [`${pad}"headers": {`, `${pad}  "Authorization": ${JSON.stringify(header.Authorization)}`, `${pad}},`];
}

/** Render one agent's config, in its own native format, for one transport (1449 R3). */
export function renderClientConfig(
    status: IntegrationsStatus,
    agent: McpClientAgent,
    transport: McpClientTransport,
    fallbackOrigin?: string,
): McpClientConfigView {
    const url = clientUrl(status, fallbackOrigin);
    const auth = authorization(status);
    const header = auth === null ? null : { Authorization: auth };
    const guidance = authGuidance(status);
    const command = stdioCommand(transport, url);
    const isHttp = transport === 'http';
    const legacy = LEGACY_REVISION_AGENTS.includes(agent);
    const format: McpClientConfigView['format'] =
        agent === 'codex' || agent === 'grok' ? 'toml' : agent === 'omp' ? 'yaml' : 'json';
    const args = command.slice(1);
    const jsonArgs = `[${args.map((part) => JSON.stringify(part)).join(', ')}]`;
    const snippet = ((): string => {
        if (format === 'toml') {
            const lines = ['[mcp_servers.spur]', 'enabled = true'];
            if (isHttp) {
                lines.push(`url = ${tomlString(url)}`);
                if (header !== null)
                    lines.push('[mcp_servers.spur.headers]', `Authorization = ${tomlString(header.Authorization)}`);
            } else {
                lines.push(`command = ${tomlString(command[0] ?? 'spur')}`);
                lines.push(`args = [${args.map((part) => tomlString(part)).join(', ')}]`);
                if (agent === 'codex') lines.push('env_vars = ["SPUR_MCP_AUTH_ENV", "SPUR_MCP_TOKEN"]');
            }
            return lines.join('\n');
        }
        if (format === 'yaml') {
            const lines = ['mcp_servers:', '  spur:'];
            if (isHttp) {
                lines.push(`    url: ${url}`);
                if (header !== null)
                    lines.push('    headers:', `      Authorization: ${tomlString(header.Authorization)}`);
            } else {
                lines.push(
                    `    command: ${command[0] ?? 'spur'}`,
                    '    args:',
                    ...args.map((part) => `      - ${part}`),
                );
            }
            return lines.join('\n');
        }
        if (agent === 'generic') {
            const entry = isHttp
                ? [
                      '    "spur": {',
                      '      "type": "http",',
                      `      "url": ${JSON.stringify(url)},`,
                      ...jsonHeaders(header, '      '),
                      '    }',
                  ]
                : [
                      '    "spur": {',
                      `      "command": ${JSON.stringify(command[0] ?? 'spur')},`,
                      `      "args": ${jsonArgs}`,
                      '    }',
                  ];
            return ['{', '  "mcpServers": {', ...entry, '  }', '}'].join('\n');
        }
        if (agent === 'opencode') {
            const entry = isHttp
                ? [
                      '    "spur": {',
                      '      "type": "remote",',
                      `      "url": ${JSON.stringify(url)},`,
                      ...jsonHeaders(header, '      '),
                      '    }',
                  ]
                : [
                      '    "spur": {',
                      '      "type": "local",',
                      `      "command": [${command.map((part) => JSON.stringify(part)).join(', ')}]`,
                      '    }',
                  ];
            return ['{', '  "$schema": "https://opencode.ai/config.json",', '  "mcp": {', ...entry, '  }', '}'].join(
                '\n',
            );
        }
        if (agent === 'openclaw') {
            const entry = isHttp
                ? [
                      '        "spur": {',
                      `          "url": ${JSON.stringify(url)},`,
                      ...jsonHeaders(header, '          '),
                      '        }',
                  ]
                : [
                      '        "spur": {',
                      `          "command": ${JSON.stringify(command[0] ?? 'spur')},`,
                      `          "args": ${jsonArgs}`,
                      '        }',
                  ];
            return ['{', '  "mcp": {', '    "servers": {', ...entry, '    }', '  }', '}'].join('\n');
        }
        if (agent === 'gemini' && isHttp) {
            return [
                '{',
                '  "mcpServers": {',
                '    "spur": {',
                `      "httpUrl": ${JSON.stringify(url)},`,
                ...jsonHeaders(header, '      '),
                '    }',
                '  }',
                '}',
            ].join('\n');
        }
        const entry = isHttp
            ? [
                  '    "spur": {',
                  '      "type": "http",',
                  `      "url": ${JSON.stringify(url)},`,
                  ...jsonHeaders(header, '      '),
                  '    }',
              ]
            : [
                  '    "spur": {',
                  `      "command": ${JSON.stringify(command[0] ?? 'spur')},`,
                  `      "args": ${jsonArgs}`,
                  '    }',
              ];
        return ['{', '  "mcpServers": {', ...entry, '  }', '}'].join('\n');
    })();
    const transportNote = ((): string => {
        if (transport === 'gateway-stdio')
            return status.gateway?.served === true && status.gateway.mcp?.enabled === true
                ? 'Runs `spur mcp --gateway`, the shared stdio bridge in front of the gateway root.'
                : 'The gateway MCP entry is off — enable server.gateway.mcp for this bridge to resolve.';
        if (transport === 'project-stdio')
            return `Runs \`spur mcp --url ${url}\`, a stdio bridge in front of this project's own /mcp endpoint.`;
        return legacy
            ? `${CLIENT_AGENT_LABELS[agent].label} speaks MCP before 2026-07-28, so it cannot use a direct HTTP entry (docs/design/mcp-agent-adoption.md) — pick a stdio bridge.`
            : 'Speaks MCP over HTTP directly; the client must support protocol 2026-07-28 or newer.';
    })();
    return {
        agent,
        label: CLIENT_AGENT_LABELS[agent].label,
        format,
        configPath: CLIENT_AGENT_LABELS[agent].path,
        snippet,
        transportNote,
        authNote: guidance.note,
        exportCommand: guidance.exportCommand,
    };
}

/**
 * A credential reference as both a shell and an MCP client read it: `${VAR}` for a valid identifier,
 * `${<ENV_NAME>}` when no variable is named — a visible placeholder, never an empty header.
 */
function envRef(envName: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(envName) ? `\${${envName}}` : `\${<ENV_NAME>}`;
}

/** A URL quoted only when it carries shell-significant characters. */
function shellQuote(value: string): string {
    return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The project's own stdio example: `spur mcp --url <project endpoint>` (1438 R2). Null when the
 * surface is off — there is no endpoint to point a client at.
 */
export function projectMcpCommand(status: IntegrationsStatus): string | null {
    if (status.mcp.url === null) return null;
    return `spur mcp --url ${shellQuote(status.mcp.url)}`;
}

/**
 * The gateway's stdio example. Offered only when the project is served under a gateway whose own MCP
 * entry is on: a standalone server has no gateway surface to reach (1438 R2).
 */
export function gatewayMcpCommand(status: IntegrationsStatus): string | null {
    if (!status.gateway.served || status.gateway.mcp?.enabled !== true) return null;
    return 'spur mcp --gateway';
}

/**
 * A JSON-RPC `server/discover` probe against the project endpoint, expanding only the auth
 * VARIABLE NAME — the Board never holds the token, so it cannot print one (1438 R2).
 */
export function discoverProbe(status: IntegrationsStatus): string | null {
    if (status.mcp.url === null) return null;
    return [
        `curl -s -X POST ${shellQuote(status.mcp.url)} \\`,
        `  -H "Authorization: Bearer ${envRef(status.mcp.auth.envName)}" \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '{"jsonrpc":"2.0","id":1,"method":"server/discover"}'`,
    ].join('\n');
}

/** The tools whose name contains `query`, case-insensitive; an empty query keeps every tool. */
export function filterTools<T extends { name: string }>(tools: T[], query: string): T[] {
    const needle = query.trim().toLowerCase();
    return needle === '' ? tools : tools.filter((tool) => tool.name.toLowerCase().includes(needle));
}

/** A windowed latency in milliseconds; `null` is unavailable and reads as an em dash, never `0ms`. */
export function formatLatency(ms: number | null): string {
    return ms === null ? '—' : `${Math.round(ms)}ms`;
}

/** A timestamp rendered compactly; an absent one reads `—` rather than an empty cell. */
export function formatWhen(value: string | null): string {
    if (value === null || value === '') return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
}

/** How many calls in a slice carried no measurable duration (1439 R1). */
export function unmeasuredLabel(count: number): string {
    return count === 0 ? 'all measured' : `${count} unmeasured`;
}

/** A failure cluster's first and last sighting, both rendered by the locale. */
export function clusterRange(cluster: { firstAt: string; lastAt: string }): string {
    const at = (value: string): string => {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
    };
    return `${at(cluster.firstAt)} → ${at(cluster.lastAt)}`;
}

/** One inbox request row as the A2A tab lists it. */
export interface InboxRequestRow {
    messageId: string;
    requestKey: string | null;
    status: string;
    runId: string | null;
    runStatus?: string | null;
    taskId: string | null;
    outcome: string | null;
    /** The remote refs this receipt's own run persisted (1440 R2); absent when it has none. */
    remoteTaskId?: string | null;
    remoteContextId?: string | null;
    remoteBranch?: string | null;
}

/**
 * The Observability › Trace deep link for one exact local run (1440 R3). Only a UUID can be a run id
 * here, so a receipt without one gets no link instead of a dead end.
 */
export function traceLink(runId: string | null | undefined): string | null {
    if (runId === null || runId === undefined) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) return null;
    return withBase(`/board/observability?${new URLSearchParams({ tab: 'trace', runId }).toString()}`);
}

/**
 * The copyable `a2a` CLI examples for one inbound member (1440 R1). Both name the card and, when the
 * member declares a credential, the credential-helper option — never a token value.
 */
export function a2aExamples(cardUrl: string, authEnv: string): { card: string; send: string } {
    const quoted = /^[A-Za-z0-9_@%+=:,./~-]+$/.test(cardUrl) ? cardUrl : `'${cardUrl.replace(/'/g, `'\\''`)}'`;
    const credential = authEnv === '' ? '' : ' --credential-helper .spur/run/a2a-credential-helper';
    const payload =
        `'{"message":{"messageId":"<uuid>","role":"user","parts":[{"text":"<text>"}]},` +
        `"configuration":{"returnImmediately":true}}'`;
    return {
        card: `a2a card get -o json -a ${quoted}${credential}`,
        send: `a2a send -o json --request-payload ${payload} -a ${quoted}${credential}`,
    };
}

/** Only rows the A2A listener created: its request keys are the `a2a:` family. */
export function a2aRequests(rows: InboxRequestRow[]): InboxRequestRow[] {
    return rows.filter((row) => (row.requestKey ?? '').startsWith('a2a:'));
}

/** The A2A task state to render: the receipt's run status when it exists, else the delivery status. */
export function requestState(row: InboxRequestRow): string {
    return row.runStatus ?? row.status;
}

/** The Projects › Inbox deep link (the tab is a path segment, not a query). */
export function inboxLink(): string {
    return withBase('/board/projects/inbox');
}

/** The Observability › System Events deep link for one event row. */
export function systemEventLink(eventName: string, runId?: string | null): string {
    const params = new URLSearchParams({ tab: 'system-events', eventName });
    if (runId !== undefined && runId !== null && runId !== '') params.set('runId', runId);
    return withBase(`/board/observability?${params.toString()}`);
}

/** One history row as the module renders it (the fields the two activity lists need). */
export interface ProtocolEventRow {
    id: string;
    eventName: string;
    occurredAt: string;
    runId?: string | null;
    durationMs?: number | null;
    outcome?: string | null;
    errorCode?: string | null;
    tool?: string | null;
}

/**
 * Project one `/api/events/history` row into the module's shape. The catalog envelope carries the
 * presentation fields; a row without them keeps its raw event name rather than inventing a label.
 */
export function projectProtocolEvent(row: unknown): ProtocolEventRow | null {
    if (row === null || typeof row !== 'object') return null;
    const value = row as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.eventName !== 'string') return null;
    const envelope = value.payload as
        | { data?: Record<string, unknown>; presentation?: { fields?: Array<{ label: string; value: string }> } }
        | undefined;
    const data = envelope?.data ?? {};
    const field = (label: string): string | null => {
        const found = envelope?.presentation?.fields?.find((entry) => entry.label.toLowerCase() === label);
        return found?.value ?? null;
    };
    const numeric = (candidate: unknown): number | null =>
        typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
    return {
        id: value.id,
        eventName: value.eventName,
        occurredAt: typeof value.occurredAt === 'string' ? value.occurredAt : '',
        runId: typeof value.runId === 'string' ? value.runId : null,
        durationMs: numeric(data.durationMs),
        outcome: typeof data.outcome === 'string' ? data.outcome : field('outcome'),
        errorCode: typeof data.errorCode === 'string' ? data.errorCode : field('error code'),
        tool: typeof data.tool === 'string' ? data.tool : field('tool'),
    };
}

/**
 * True when the gateway's own MCP entry is on while this project's is off (1449 R1). The gateway
 * forwards `tools/call` to each project's loopback `/mcp`, so this state looks configured and fails
 * on the first call — the Board says so instead of leaving the operator to find out.
 */
export function gatewayWithoutProjectMcp(status: IntegrationsStatus): boolean {
    return status.gateway?.served === true && status.gateway.mcp?.enabled === true && !status.mcp.enabled;
}

/** True when every surface (project MCP, A2A inbound, gateway MCP, and A2A outbound) is off — renders the empty state. */
export function allSurfacesOff(status: IntegrationsStatus): boolean {
    const gatewayMcpOn = status.gateway?.served === true && status.gateway.mcp?.enabled === true;
    const outboundOn = (status.a2a.outbound?.length ?? 0) > 0;
    return !status.mcp.enabled && !status.a2a.enabled && !gatewayMcpOn && !outboundOn;
}

/** The config keys an operator sets to enable each surface, named for the empty state. */
export function enablementKeys(): string[] {
    return ['server.mcp.enabled + server.mcp.authEnv', 'server.a2a.enabled + server.a2a.authEnv'];
}

/**
 * The served build's identity as `/api/health` reports it (task 1437 R6).
 *
 * The Board is served from `dist/web` while the process answering it may be an older release, so
 * the version and uptime are the only visible evidence that a stale server is behind a symptom.
 */
export interface ServerRuntime {
    version: string;
    uptimeSeconds: number;
}

/** Compact uptime: `12d 3h`, `3h 12m`, `4m`, `45s`. */
export function formatUptime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    const days = Math.floor(whole / 86_400);
    const hours = Math.floor((whole % 86_400) / 3_600);
    const minutes = Math.floor((whole % 3_600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${whole}s`;
}
