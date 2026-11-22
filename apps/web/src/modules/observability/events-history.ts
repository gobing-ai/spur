import { resolveApiUrl } from '../../lib/rpc-client';

/**
 * The `/api/events/history` URL builder (task 0372; extracted by A82 1424).
 *
 * Lives beside the System Events tab but outside it, because more than one module reads the same
 * activity rows: the Integrations module's Recent calls list must use THIS builder rather than a
 * copied URL string, and importing the whole tab module for one pure function would pull React,
 * portals and the column customizer into every consumer.
 */

/** Default page size when the caller names none. */
export const HISTORY_LIMIT = 100;

/**
 * Build a history URL with server-side filter params + opaque cursor.
 *
 * `prefix` (single selected prefix or omitted), `names` (search-when-scope=name,
 * comma-joined), `actor` (search-when-scope=actor), `runId`, `since` (time-window),
 * `limit` (page size), and `cursor` (opaque, from `nextCursor`).
 *
 * Tier has no direct server param - it is a client-side post-filter on the returned
 * page only, since the catalog tier is metadata, not a SQL column.
 */
export function historyUrl(params: {
    prefix?: string;
    names?: string;
    actor?: string;
    runId?: string;
    since?: string;
    limit?: number;
    cursor?: string;
}): string {
    const base = `${resolveApiUrl()}/events/history`;
    const qs: string[] = [];
    const limit = params.limit ?? HISTORY_LIMIT;
    qs.push(`limit=${limit}`);
    if (params.prefix) qs.push(`prefix=${encodeURIComponent(params.prefix)}`);
    if (params.names) qs.push(`names=${encodeURIComponent(params.names)}`);
    if (params.actor) qs.push(`actor=${encodeURIComponent(params.actor)}`);
    if (params.runId) qs.push(`runId=${encodeURIComponent(params.runId)}`);
    if (params.since) qs.push(`since=${encodeURIComponent(params.since)}`);
    if (params.cursor) qs.push(`cursor=${encodeURIComponent(params.cursor)}`);
    return `${base}?${qs.join('&')}`;
}

/** The module-facing name for {@link historyUrl}: another module reads the same activity rows. */
export const eventsHistoryUrl = historyUrl;
