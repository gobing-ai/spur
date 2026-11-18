/**
 * Cross-project view for the daily summary (task 1402).
 *
 * The registry knows which projects are running, so it is read FIRST: a stopped project is reported
 * as stopped and never requested, because a gateway request to its prefix would start it
 * (`ensureUpstream`) and then "stopped" could never be observed. Only running local projects are read,
 * through their stable gateway paths, with one bounded timeout per request.
 */
import { isLocalHost, type ProjectEntry, resolveProjectPrefix } from '@gobing-ai/spur-config';

/** One project's status in the daily view. */
export type ProjectViewState = 'ok' | 'stopped' | 'unreachable' | 'gateway-down' | 'remote-not-proxied';

/** One recent event, as the view renders it. */
export interface ProjectEventSummary {
    eventName: string;
    occurredAt: string;
    summary: string;
}

/** One row of the daily "Projects" section. */
export interface ProjectViewRow {
    name: string;
    prefix: string | null;
    state: ProjectViewState;
    /** Event counts by name prefix (`task`, `message`, …), highest first. */
    eventCounts?: Array<{ prefix: string; count: number }>;
    /** The five latest events, newest first. */
    latest?: ProjectEventSummary[];
    /** Why the row is not `ok` — the fetch error or the timeout. */
    message?: string;
}

/** What the view reads: the registry, the gateway port, the day boundary and the fetch seam. */
export interface ProjectsViewInput {
    listProjects(): Promise<ProjectEntry[]>;
    /** The one-port gateway's port; every local request goes through it. */
    gatewayPort: number;
    /** Day start ISO instant — the event read is "since today". */
    since: string;
    fetchImpl?: typeof fetch;
    /** Per-request budget (default 3 s, R1). */
    timeoutMs?: number;
}

/** Default per-request budget: two reads per project, so the whole view stays interactive. */
export const PROJECTS_VIEW_TIMEOUT_MS = 3_000;

interface HistoryEvent {
    eventName?: unknown;
    occurredAt?: unknown;
    prefix?: unknown;
    payload?: unknown;
}

/** Collect the cross-project rows: registry first, gateway reads only for running local projects. */
export async function collectProjectsView(input: ProjectsViewInput): Promise<ProjectViewRow[]> {
    const entries = await input.listProjects();
    const rows = new Map<string, ProjectViewRow>();
    const running: Array<{ entry: ProjectEntry; prefix: string }> = [];

    for (const entry of entries) {
        const prefix = resolveProjectPrefix(entry);
        if (!isLocalHost(entry.host)) {
            rows.set(entry.name, { name: entry.name, prefix: null, state: 'remote-not-proxied' });
            continue;
        }
        if (entry.port <= 0) {
            rows.set(entry.name, { name: entry.name, prefix, state: 'stopped' });
            continue;
        }
        running.push({ entry, prefix: prefix ?? `/${entry.name}` });
    }
    if (running.length === 0) return [...rows.values()];

    const gateway = await probeGateway(input);
    if (gateway !== null) {
        for (const { entry, prefix } of running) {
            rows.set(entry.name, { name: entry.name, prefix, state: 'gateway-down', message: gateway });
        }
        return sortRows([...rows.values()], entries);
    }

    for (const { entry, prefix } of running) {
        rows.set(entry.name, await readProject(input, entry, prefix));
    }
    return sortRows([...rows.values()], entries);
}

/** Is the gateway itself answering? One probe decides `gateway-down` for every running project. */
async function probeGateway(input: ProjectsViewInput): Promise<string | null> {
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
        const response = await fetchImpl(`http://localhost:${input.gatewayPort}/api/health`, {
            redirect: 'error',
            signal: AbortSignal.timeout(input.timeoutMs ?? PROJECTS_VIEW_TIMEOUT_MS),
        });
        const body = (await response.json().catch(() => null)) as { gateway?: unknown } | null;
        if (response.ok && body?.gateway === true) return null;
        return `localhost:${input.gatewayPort} answered ${response.status} but is not the gateway — start it with \`spur self serve --gateway\``;
    } catch (error) {
        return `no gateway is listening on localhost:${input.gatewayPort} — start it with \`spur self serve --gateway\` (${reasonOf(error)})`;
    }
}

/** One running project: health, then the day's events. Either failure makes the row unreachable. */
async function readProject(input: ProjectsViewInput, entry: ProjectEntry, prefix: string): Promise<ProjectViewRow> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const base = `http://localhost:${input.gatewayPort}${prefix}`;
    const timeoutMs = input.timeoutMs ?? PROJECTS_VIEW_TIMEOUT_MS;
    try {
        const health = await fetchImpl(`${base}/api/health`, {
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!health.ok) {
            return {
                name: entry.name,
                prefix,
                state: 'unreachable',
                message: `health answered ${health.status}`,
            };
        }
        const history = await fetchImpl(
            `${base}/api/events/history?since=${encodeURIComponent(input.since)}&limit=50`,
            { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) },
        );
        if (!history.ok) {
            return {
                name: entry.name,
                prefix,
                state: 'unreachable',
                message: `event history answered ${history.status}`,
            };
        }
        const body = (await history.json()) as { events?: unknown };
        const events = Array.isArray(body.events) ? (body.events as HistoryEvent[]) : [];
        return {
            name: entry.name,
            prefix,
            state: 'ok',
            eventCounts: countByPrefix(events),
            latest: events.slice(0, 5).map(toSummary),
        };
    } catch (error) {
        return { name: entry.name, prefix, state: 'unreachable', message: reasonOf(error) };
    }
}

/** Counts by name prefix, highest first; ties keep the registry order of first appearance. */
function countByPrefix(events: HistoryEvent[]): Array<{ prefix: string; count: number }> {
    const counts = new Map<string, number>();
    for (const event of events) {
        const name = typeof event.eventName === 'string' ? event.eventName : '';
        const prefix = typeof event.prefix === 'string' && event.prefix !== '' ? event.prefix : name.split('.')[0];
        if (prefix === '' || prefix === undefined) continue;
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    return [...counts.entries()].map(([prefix, count]) => ({ prefix, count })).sort((a, b) => b.count - a.count);
}

/** One event line: the name and, when the payload says it plainly, a one-line summary. */
function toSummary(event: HistoryEvent): ProjectEventSummary {
    const payload = (event.payload ?? null) as { summary?: unknown; message?: unknown } | null;
    const summary =
        typeof payload?.summary === 'string'
            ? payload.summary
            : typeof payload?.message === 'string'
              ? payload.message
              : '';
    return {
        eventName: typeof event.eventName === 'string' ? event.eventName : 'unknown',
        occurredAt: typeof event.occurredAt === 'string' ? event.occurredAt : '',
        summary,
    };
}

function reasonOf(error: unknown): string {
    if (error instanceof Error) {
        // TimeoutError has an empty message; name it rather than printing nothing.
        return error.message === '' ? error.name : error.message;
    }
    return String(error);
}

/** Registry order is the operator's order — never sort by status. */
function sortRows(rows: ProjectViewRow[], entries: ProjectEntry[]): ProjectViewRow[] {
    const order = new Map(entries.map((entry, index) => [entry.name, index]));
    return rows.sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0));
}
