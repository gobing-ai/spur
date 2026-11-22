import type { IntegrationsStatus } from '@gobing-ai/spur-contracts';

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
 * `off` when the surface is disabled; `on · token unset` when it is enabled but its bearer
 * variable is empty (an error the operator must see); otherwise `on`.
 */
export function surfaceState(surface: { enabled: boolean; auth: { tokenPresent: boolean } }): SurfaceState {
    if (!surface.enabled) return 'off';
    return surface.auth.tokenPresent ? 'on' : 'on · token unset';
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
export function clientSnippet(status: IntegrationsStatus): string {
    const url = status.mcp.url ?? '<server>/mcp';
    const envName = status.mcp.auth.envName === '' ? '<ENV_NAME>' : status.mcp.auth.envName;
    return [
        '{',
        '  "mcpServers": {',
        '    "spur": {',
        '      "type": "http",',
        `      "url": "${url}",`,
        '      "headers": {',
        `        "Authorization": "Bearer \${${envName.replace(/[{}]/g, '')}}"`,
        '      }',
        '    }',
        '  }',
        '}',
    ].join('\n');
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
    return '/board/projects/inbox';
}

/** The Observability › System Events deep link for one event row. */
export function systemEventLink(eventName: string, runId?: string | null): string {
    const params = new URLSearchParams({ tab: 'system-events', eventName });
    if (runId !== undefined && runId !== null && runId !== '') params.set('runId', runId);
    return `/board/observability?${params.toString()}`;
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

/** True when every surface is off — the one case that renders the empty state. */
export function allSurfacesOff(status: IntegrationsStatus): boolean {
    return !status.mcp.enabled && !status.a2a.enabled;
}

/** The config keys an operator sets to enable each surface, named for the empty state. */
export function enablementKeys(): string[] {
    return ['server.mcp.enabled + server.mcp.authEnv', 'server.a2a.enabled + server.a2a.authEnv'];
}
