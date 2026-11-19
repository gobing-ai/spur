/**
 * Cross-project view for the daily summary (task 1402).
 *
 * The registry knows which projects are running, so it is read FIRST: a stopped project is reported
 * as stopped and never requested, because a gateway request to its prefix would start it
 * (`ensureUpstream`) and then "stopped" could never be observed. Only running local projects are read,
 * through their stable gateway paths, with bounded health and history reads.
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
    /** Budget for the health probe or for reading the full event history (default 3 s, R1). */
    timeoutMs?: number;
}

/** Default budget for each health read and each project's full history read. */
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
    const gateway = entries.some((entry) => isLocalHost(entry.host) && entry.port > 0)
        ? await probeGateway(input)
        : null;
    const rows: ProjectViewRow[] = [];

    for (const entry of entries) {
        const prefix = resolveProjectPrefix(entry);
        if (!isLocalHost(entry.host)) {
            rows.push({ name: entry.name, prefix: null, state: 'remote-not-proxied' });
        } else if (entry.port <= 0) {
            rows.push({ name: entry.name, prefix, state: 'stopped' });
        } else if (gateway !== null) {
            rows.push({ name: entry.name, prefix, state: 'gateway-down', message: gateway });
        } else if (prefix !== null) {
            rows.push(await readProject(input, entry.name, prefix));
        }
    }
    return rows;
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
async function readProject(input: ProjectsViewInput, name: string, prefix: string): Promise<ProjectViewRow> {
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
                name,
                prefix,
                state: 'unreachable',
                message: `health answered ${health.status}`,
            };
        }
        const signal = AbortSignal.timeout(timeoutMs);
        const url = new URL(`${base}/api/events/history`);
        url.searchParams.set('since', input.since);
        url.searchParams.set('limit', '50');
        const counts = new Map<string, number>();
        const latest: ProjectEventSummary[] = [];
        let cursor: string | null = null;
        do {
            if (cursor !== null) url.searchParams.set('cursor', cursor);
            signal.throwIfAborted();
            const history = await fetchImpl(url, { redirect: 'error', signal });
            if (!history.ok) throw new Error(`event history answered ${history.status}`);
            const body = (await history.json()) as { events?: unknown; nextCursor?: unknown } | null;
            if (!Array.isArray(body?.events)) throw new Error('event history response is missing events');
            const events = body.events as HistoryEvent[];
            for (const event of events) {
                const eventName = typeof event.eventName === 'string' ? event.eventName : '';
                const eventPrefix =
                    typeof event.prefix === 'string' && event.prefix !== '' ? event.prefix : eventName.split('.')[0];
                if (eventPrefix) counts.set(eventPrefix, (counts.get(eventPrefix) ?? 0) + 1);
                if (latest.length < 5) latest.push(toSummary(event));
            }
            if (typeof body.nextCursor === 'string' && body.nextCursor !== '') {
                if (cursor === body.nextCursor) throw new Error('event history returned the same cursor twice');
                cursor = body.nextCursor;
            } else {
                cursor = null;
            }
        } while (cursor !== null);
        return {
            name,
            prefix,
            state: 'ok',
            eventCounts: Array.from(counts, ([prefix, count]) => ({ prefix, count })).sort((a, b) => b.count - a.count),
            latest,
        };
    } catch (error) {
        return { name, prefix, state: 'unreachable', message: reasonOf(error) };
    }
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
