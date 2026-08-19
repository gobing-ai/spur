import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

type SystemEventSeverity = 'info' | 'warning' | 'error';

interface SystemEventDisplayField {
    label: string;
    value: string;
}

interface SystemEventDisplayAction {
    label: string;
    kind: 'command' | 'filter' | 'path';
    value: string;
}

/** Bounded semantic projection consumed by the table and event tooltip. */
export interface SystemEventView {
    severity: SystemEventSeverity;
    summary: string;
    description: string;
    fields: SystemEventDisplayField[];
    projectName: string;
    projectRoot: string;
    producer: string;
    correlation: string;
    correlationFields: SystemEventDisplayField[];
    outcome: string;
    action: SystemEventDisplayAction | null;
}

/** Wire shape of a single system event row from the history endpoint. */
export interface SystemEventRow {
    id: string;
    eventName: string;
    occurredAt: string;
    actor: string | null;
    prefix?: string;
    renderer?: string;
    payload: Record<string, unknown> | null;
    /** Canonical envelope retained for expanded forensic detail. */
    envelope?: Record<string, unknown>;
    /** Parsed once at the network boundary; optional for local/test callers. */
    view?: SystemEventView;
    /** Indexed correlation columns (task 0369). Nullable - pre-migration rows are null. */
    runId?: string | null;
    entityKind?: string | null;
    entityId?: string | null;
    sequence?: number | null;
}

interface EventCatalogEntry {
    name: string;
    prefix: string;
    source: string;
    /** Optional tier - only present when the server ships it (task 0221 R5). */
    tier?: string;
    renderer: string;
}

/** Wire shape of the `/api/events/history` JSON envelope. */
export interface HistoryResponse {
    events: SystemEventRow[];
    count: number;
    catalog?: EventCatalogEntry[];
    /** Opaque keyset cursor for the next older page (null when no more). */
    nextCursor: string | null;
    /** Whether older rows exist beyond this page. */
    hasMore: boolean;
}

/** Wire shape of one SSE envelope pushed by the planning stream. */
interface SseEnvelope {
    eventName: string;
    occurredAt: string;
    actor: string | null;
    prefix?: string;
    renderer?: string;
    payload: Record<string, unknown> | null;
    envelope?: Record<string, unknown>;
    view: SystemEventView;
    runId?: string | null;
    entityKind?: string | null;
    entityId?: string | null;
    sequence?: number | null;
}

const sseUrl = () => `${resolveApiUrl()}/events/planning`;
const HISTORY_LIMIT = 100;

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

/**
 * Stable prefix -> tailwind text-color mapping (task 0223 R4). Hand-curated so
 * the color is deterministic across renders (not a hash of the event name) -
 * every operator reading the same prefix sees the same color, and the prefix
 * label is still rendered alongside so color is never the only signal (R5).
 * Unknown prefixes fall back to the neutral `text-spur-text-muted` (R6).
 */
const PREFIX_COLOR_MAP: Record<string, string> = {
    workflow: 'text-cyan-400',
    task: 'text-emerald-400',
    feature: 'text-emerald-400',
    agent: 'text-amber-400',
    rule: 'text-rose-400',
    message: 'text-sky-400',
    process: 'text-violet-400',
    queue: 'text-orange-400',
    bus: 'text-pink-400',
    api: 'text-teal-400',
};
const FALLBACK_COLOR = 'text-spur-text-muted';

function getPrefixColor(prefix: string | undefined): string {
    if (!prefix) return FALLBACK_COLOR;
    return PREFIX_COLOR_MAP[prefix] ?? FALLBACK_COLOR;
}
/**
 * Tri-state SSE connection status surfaced by the liveness strip (task 0222 R1).
 * `connecting` covers both initial mount before the first frame and any
 * reconnect window; `errored` is reserved for explicit source failures; `live`
 * is the steady state after at least one frame has been delivered.
 */
type SseStatus = 'connecting' | 'live' | 'errored';

/**
 * Query state machine (task 0375 R1). Replaces the client-side `filteredEvents`
 * `useMemo` over a fixed 100-row window. The server filters in SQL; the client
 * drives pagination via the opaque keyset cursor.
 */
type QueryStatus = 'idle' | 'loading' | 'loaded' | 'error';

/** Active filter params sent to the server on each page fetch. */
interface ActiveFilter {
    prefix?: string;
    names?: string;
    actor?: string;
    runId?: string;
    since?: string;
}

/** UI filter state - the raw controls before debounce/serialization. */
interface FilterState {
    selectedPrefixes: Set<string>;
    searchQuery: string;
    searchScope: 'all' | 'name' | 'actor' | 'payload';
    tierFilter: 'all' | 'default' | 'diagnostic';
    timeWindow: 'all' | '30s' | '5m';
    runId: string;
}

const DEFAULT_FILTER: FilterState = {
    selectedPrefixes: new Set(),
    searchQuery: '',
    searchScope: 'all',
    tierFilter: 'all',
    timeWindow: 'all',
    runId: '',
};

/**
 * Trail of recent event timestamps used to compute the rolling
 * "N events / 60s" rate. We keep absolute epoch ms so the rate stays correct
 * across tab clock drift and is trivially sliceable for the trailing window.
 */
function useRollingEventRate(): { rate: number; recordEvent: () => void } {
    const trailRef = useRef<number[]>([]);
    const [rate, setRate] = useState(0);

    // Re-tick every second so the rate reflects the *trailing* 60-second window
    // (R2). The interval is a coarse timer; the actual rate may lag a frame
    // behind the wall clock, which is fine - this is a human-facing indicator.
    useEffect(() => {
        const id = window.setInterval(() => {
            const cutoff = Date.now() - 60_000;
            const trail = trailRef.current.filter((ts) => ts >= cutoff);
            trailRef.current = trail;
            setRate(trail.length);
        }, 1000);
        return () => window.clearInterval(id);
    }, []);

    const recordEvent = useCallback(() => {
        const now = Date.now();
        const cutoff = now - 60_000;
        const trail = trailRef.current.filter((ts) => ts >= cutoff);
        trail.push(now);
        trailRef.current = trail;
        setRate(trail.length);
    }, []);

    return { rate, recordEvent };
}

/**
 * Runtime-narrow an unknown network payload into a `HistoryResponse`, or
 * return `null` when the shape is wrong. Network input is untrusted - a
 * single bad row from the server must not crash the tab.
 */
export function parseHistoryResponse(value: unknown): HistoryResponse | null {
    if (value === null || typeof value !== 'object') return null;
    if (!('events' in value) || !('count' in value)) return null;
    const rawEvents = (value as { events: unknown }).events;
    if (!Array.isArray(rawEvents)) return null;
    const count = (value as { count: unknown }).count;
    if (typeof count !== 'number') return null;
    // nextCursor/hasMore are additive - back-compat: absent => no more pages.
    const rawNextCursor = (value as { nextCursor?: unknown }).nextCursor;
    const nextCursor = typeof rawNextCursor === 'string' ? rawNextCursor : rawNextCursor === null ? null : null;
    const rawHasMore = (value as { hasMore?: unknown }).hasMore;
    const hasMore = typeof rawHasMore === 'boolean' ? rawHasMore : false;
    const events: SystemEventRow[] = [];
    for (const raw of rawEvents) {
        const row = parseHistoryRow(raw);
        if (!row) continue; // R6: drop malformed rows without aborting the page
        events.push(row);
    }
    const rawCatalog = (value as { catalog?: unknown }).catalog;
    const catalog = Array.isArray(rawCatalog) ? parseCatalog(rawCatalog) : undefined;
    return { events, count, nextCursor, hasMore, ...(catalog ? { catalog } : {}) };
}

/** Runtime-narrow one history row. Returns null on any shape failure (R6). */
export function parseHistoryRow(value: unknown): SystemEventRow | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.id !== 'string') return null;
    if (typeof obj.eventName !== 'string') return null;
    if (typeof obj.occurredAt !== 'string') return null;
    const prefix = typeof obj.prefix === 'string' ? obj.prefix : undefined;
    const renderer = typeof obj.renderer === 'string' ? obj.renderer : undefined;
    const actor = obj.actor;
    if (actor !== null && typeof actor !== 'string') return null;
    const payload = obj.payload;
    // Correlation columns - optional, nullable, never required (R6: pre-0369 rows).
    const runId = typeof obj.runId === 'string' ? obj.runId : obj.runId === null ? null : undefined;
    const entityKind = typeof obj.entityKind === 'string' ? obj.entityKind : obj.entityKind === null ? null : undefined;
    const entityId = typeof obj.entityId === 'string' ? obj.entityId : obj.entityId === null ? null : undefined;
    const sequence =
        typeof obj.sequence === 'number' && Number.isFinite(obj.sequence)
            ? obj.sequence
            : obj.sequence === null
              ? null
              : undefined;
    const base = {
        id: obj.id,
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        ...(prefix ? { prefix } : {}),
        ...(renderer ? { renderer } : {}),
    };
    if (payload === null) {
        return {
            ...base,
            payload: null,
            view: parseSystemEventView(obj.eventName, null),
            ...optionalCorrelation(runId, entityKind, entityId, sequence),
        };
    }
    if (typeof payload !== 'object') return null;
    const rawPayload = payload as Record<string, unknown>;
    const envelope = rawPayload.schemaVersion === 2 ? rawPayload : undefined;
    return {
        ...base,
        payload: systemEventData(rawPayload),
        ...(envelope ? { envelope } : {}),
        view: parseSystemEventView(obj.eventName, rawPayload),
        ...optionalCorrelation(runId, entityKind, entityId, sequence),
    };
}

/** Spread correlation fields only when they were present on the wire. */
function optionalCorrelation(
    runId: string | null | undefined,
    entityKind: string | null | undefined,
    entityId: string | null | undefined,
    sequence: number | null | undefined,
): Partial<SystemEventRow> {
    const out: Partial<SystemEventRow> = {};
    if (runId !== undefined) out.runId = runId;
    if (entityKind !== undefined) out.entityKind = entityKind;
    if (entityId !== undefined) out.entityId = entityId;
    if (sequence !== undefined) out.sequence = sequence;
    return out;
}

function parseCatalog(values: unknown[]): EventCatalogEntry[] | undefined {
    const entries: EventCatalogEntry[] = [];
    for (const raw of values) {
        if (raw === null || typeof raw !== 'object') return undefined;
        const obj = raw as Record<string, unknown>;
        if (
            typeof obj.name !== 'string' ||
            typeof obj.prefix !== 'string' ||
            typeof obj.source !== 'string' ||
            typeof obj.renderer !== 'string'
        ) {
            return undefined;
        }
        const tier = typeof obj.tier === 'string' ? obj.tier : undefined;
        const entry: EventCatalogEntry = {
            name: obj.name,
            prefix: obj.prefix,
            source: obj.source,
            renderer: obj.renderer,
            ...(tier !== undefined ? { tier } : {}),
        };
        entries.push(entry);
    }
    return entries;
}

/**
 * Runtime-narrow an unknown SSE frame into an {@link SseEnvelope}, or return
 * `null` when the frame is malformed. Network input is untrusted - the server
 * may push a keepalive comment (`: keepalive\n\n`) that we silently drop at
 * the EventSource layer, but a hand-rolled frame must still be checked
 * before being read into the row shape.
 */
function parseSseEnvelope(value: unknown): SseEnvelope | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.eventName !== 'string' || obj.eventName.length === 0) return null;
    if (typeof obj.occurredAt !== 'string') return null;
    const prefix = typeof obj.prefix === 'string' ? obj.prefix : undefined;
    const renderer = typeof obj.renderer === 'string' ? obj.renderer : undefined;
    const actor = obj.actor;
    if (actor !== null && typeof actor !== 'string') return null;
    const payload = obj.payload;
    if (payload !== null && typeof payload !== 'object') return null;
    const rawPayload = payload as Record<string, unknown> | null;
    const envelope = rawPayload?.schemaVersion === 2 ? rawPayload : undefined;
    const payloadRecord = systemEventData(rawPayload);
    const runIdValue = obj.runId ?? payloadRecord?.runId;
    const entityKindValue = obj.entityKind ?? payloadRecord?.entityKind;
    const entityIdValue = obj.entityId ?? payloadRecord?.entityId;
    const sequenceValue = obj.sequence ?? payloadRecord?.sequence;
    const runId = typeof runIdValue === 'string' ? runIdValue : runIdValue === null ? null : undefined;
    const entityKind =
        typeof entityKindValue === 'string' ? entityKindValue : entityKindValue === null ? null : undefined;
    const entityId = typeof entityIdValue === 'string' ? entityIdValue : entityIdValue === null ? null : undefined;
    const sequence =
        typeof sequenceValue === 'number' && Number.isFinite(sequenceValue)
            ? sequenceValue
            : sequenceValue === null
              ? null
              : undefined;
    return {
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        ...(prefix ? { prefix } : {}),
        ...(renderer ? { renderer } : {}),
        payload: payloadRecord,
        ...(envelope ? { envelope } : {}),
        view: parseSystemEventView(obj.eventName, rawPayload),
        ...optionalCorrelation(runId, entityKind, entityId, sequence),
    };
}

/** Narrow a canonical v2 envelope into bounded display semantics. */
export function parseSystemEventView(eventName: string, payload: Record<string, unknown> | null): SystemEventView {
    const fallback = unavailableSystemEventView(eventName);
    if (payload?.schemaVersion !== 2) return fallback;
    const context = asRecord(payload.context);
    const presentation = asRecord(payload.presentation);
    const project = asRecord(context?.project);
    const producer = asRecord(context?.producer);
    const correlation = asRecord(context?.correlation);
    if (!context || !presentation || !project || !producer || !correlation) return fallback;

    const severity =
        presentation.severity === 'info' || presentation.severity === 'warning' || presentation.severity === 'error'
            ? presentation.severity
            : 'warning';
    const fields = Array.isArray(presentation.fields)
        ? presentation.fields
              .flatMap((field) => {
                  const record = asRecord(field);
                  const label = boundedDisplayText(record?.label, 64);
                  const fieldValue = boundedDisplayText(record?.value, 256);
                  return label && fieldValue ? [{ label, value: fieldValue }] : [];
              })
              .slice(0, 8)
        : [];
    const correlationFields: SystemEventDisplayField[] = [];
    const addCorrelation = (label: string, value: unknown): void => {
        const text = boundedDisplayText(value, 128);
        if (text) correlationFields.push({ label, value: text });
    };
    addCorrelation('Run', correlation.runId);
    addCorrelation('Execution', correlation.executionId);
    addCorrelation('Action', correlation.actionId);
    addCorrelation('Entity', joinEntity(correlation.entityKind, correlation.entityId));
    addCorrelation('Job', correlation.jobId);
    if (typeof correlation.sequence === 'number' && Number.isFinite(correlation.sequence)) {
        correlationFields.push({ label: 'Sequence', value: String(correlation.sequence) });
    }

    const packageName = boundedDisplayText(producer.package, 128) ?? 'unavailable';
    const subsystem = boundedDisplayText(producer.subsystem, 128);
    return {
        severity,
        summary: boundedDisplayText(presentation.summary, 512) ?? 'unavailable',
        description: boundedDisplayText(presentation.description, 512) ?? 'Description unavailable.',
        fields,
        projectName: boundedDisplayText(project.name, 128) ?? 'unavailable',
        projectRoot: boundedDisplayText(project.root, 256) ?? 'unavailable',
        producer: subsystem ? `${packageName} / ${subsystem}` : packageName,
        correlation:
            correlationFields.map(({ label, value }) => `${label.toLowerCase()} ${value}`).join(' · ') || 'unavailable',
        correlationFields,
        outcome: boundedDisplayText(presentation.outcome, 128) ?? 'unavailable',
        action: parseDisplayAction(presentation.action),
    };
}

function unavailableSystemEventView(eventName: string): SystemEventView {
    const safeName = boundedDisplayText(eventName, 128) ?? 'unknown';
    return {
        severity: 'warning',
        summary: 'unavailable',
        description: `Canonical context unavailable for ${safeName}.`,
        fields: [],
        projectName: 'unavailable',
        projectRoot: 'unavailable',
        producer: 'unavailable',
        correlation: 'unavailable',
        correlationFields: [],
        outcome: 'unavailable',
        action: null,
    };
}

function parseDisplayAction(value: unknown): SystemEventDisplayAction | null {
    const action = asRecord(value);
    if (!action || (action.kind !== 'command' && action.kind !== 'filter' && action.kind !== 'path')) return null;
    const label = boundedDisplayText(action.label, 128);
    const actionValue = boundedDisplayText(action.value, 256);
    return label && actionValue ? { label, kind: action.kind, value: actionValue } : null;
}

function boundedDisplayText(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string' || value.length === 0) return null;
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function joinEntity(kind: unknown, id: unknown): string | null {
    const safeKind = boundedDisplayText(kind, 64);
    const safeId = boundedDisplayText(id, 128);
    if (safeKind && safeId) return `${safeKind}:${safeId}`;
    return safeKind ?? safeId;
}

/**
 * Correlator precedence for the tooltip title (R5, 0601): entity, run,
 * execution, action, then job identity. The persisted history-row ID is used
 * only when no semantic correlator exists — and never for a synthetic live
 * SSE row (`live-` prefix), which renders the event name alone.
 */
const CORRELATOR_PRECEDENCE = ['Entity', 'Run', 'Execution', 'Action', 'Job'] as const;

export function tooltipTitle(event: SystemEventRow, view: SystemEventView): string {
    for (const label of CORRELATOR_PRECEDENCE) {
        const field = view.correlationFields.find((f) => f.label === label);
        if (field !== undefined && field.value !== '') return `${event.eventName} · ${field.value}`;
    }
    if (event.id !== '' && !event.id.startsWith('live-')) return `${event.eventName} · ${event.id}`;
    return event.eventName;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function systemEventData(payload: Record<string, unknown> | null): Record<string, unknown> | null {
    if (payload?.schemaVersion !== 2) return payload;
    return asRecord(payload.data);
}

/** Format ISO timestamp to local "MMM D HH:mm:ss" (no year). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatLocalTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso; // fallback for unparseable
    const mo = MONTHS[d.getMonth()];
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${mo} ${day} ${hh}:${mm}:${ss}`;
}

/**
 * Format milliseconds into a compact human-readable duration string.
 * Returns null for non-numeric / non-finite values so callers can drop the pair.
 */
export function formatDuration(ms: unknown): string | null {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Board glyph for a missing or unusable projected field.
 * Parsers keep the `unavailable` sentinel; the table, tooltip, and detail render `-`.
 */
export function displayValue(value: string | null | undefined): string {
    return value && value !== 'unavailable' ? value : '-';
}

/** Serialize UI filter state into the server-side query params. */
export function serializeFilter(filter: FilterState): ActiveFilter {
    const out: ActiveFilter = {};
    // Prefix: when exactly one prefix is selected, send it as a server param.
    // Multiple selected prefixes cannot be expressed as a single `prefix=` param,
    // so they fall back to client-side post-filter on the returned page.
    if (filter.selectedPrefixes.size === 1) {
        out.prefix = [...filter.selectedPrefixes][0];
    }
    // The history endpoint's name and actor filters are exact-match. Preserve the
    // broader client-side substring behavior for "all"/"payload", but route the
    // exact field scopes through SQL so older matching rows remain pageable.
    const query = filter.searchQuery.trim();
    if (query !== '' && filter.searchScope === 'name') out.names = query;
    if (query !== '' && filter.searchScope === 'actor') out.actor = query;
    if (filter.runId.trim() !== '') out.runId = filter.runId.trim();
    if (filter.timeWindow !== 'all') {
        const ms = filter.timeWindow === '30s' ? 30_000 : 5 * 60_000;
        out.since = new Date(Date.now() - ms).toISOString();
    }
    return out;
}

/**
 * Client-side post-filter predicate applied to the current page for immediate
 * UX. Also gates SSE prepend so a non-matching frame is silently dropped (R5).
 *
 * All filter dimensions are applied client-side so the UI responds instantly
 * to control changes. The debounced `serializeFilter` drives the server query
 * in parallel, which narrows the paginated result set.
 */
function matchesClientFilter(
    evt: {
        eventName: string;
        occurredAt: string;
        actor: string | null;
        prefix?: string;
        payload?: Record<string, unknown> | null;
        runId?: string | null;
    },
    filter: FilterState,
    tierByName: Map<string, string>,
): boolean {
    // Prefix: when any prefixes are selected, filter client-side for immediate
    // UX. Single prefix also goes to the server; multi-prefix is client-only.
    if (filter.selectedPrefixes.size >= 1) {
        const prefix = evt.prefix ?? evt.eventName.split('.')[0] ?? evt.eventName;
        if (!filter.selectedPrefixes.has(prefix)) return false;
    }
    if (filter.tierFilter !== 'all') {
        const entryTier = tierByName.get(evt.eventName);
        if (entryTier !== filter.tierFilter) {
            if (!(filter.tierFilter === 'default' && entryTier === undefined)) return false;
        }
    }
    // Search: client-side substring match, scoped to the selected field(s).
    if (filter.searchQuery.trim() !== '') {
        const query = filter.searchQuery.toLowerCase();
        let matches = false;
        if (filter.searchScope === 'name' || filter.searchScope === 'all') {
            matches = matches || evt.eventName.toLowerCase().includes(query);
        }
        if (filter.searchScope === 'actor' || filter.searchScope === 'all') {
            matches = matches || (evt.actor?.toLowerCase().includes(query) ?? false);
        }
        if (filter.searchScope === 'payload' && evt.payload) {
            matches = matches || JSON.stringify(evt.payload).toLowerCase().includes(query);
        }
        if (!matches) return false;
    }
    // Time-window: client-side filter for immediate UX (also sent to server).
    if (filter.timeWindow !== 'all') {
        const ms = filter.timeWindow === '30s' ? 30_000 : 5 * 60_000;
        const cutoff = Date.now() - ms;
        const eventTime = new Date(evt.occurredAt).getTime();
        if (Number.isNaN(eventTime) || eventTime < cutoff) return false;
    }
    // Run ID: client-side filter for immediate UX (also sent to server).
    if (filter.runId.trim() !== '') {
        if (evt.runId !== filter.runId.trim()) return false;
    }
    return true;
}

/**
 * System Events tab (task 0189 R5, rebuilt on server-side queries in 0375).
 *
 * Initial fetch loads the most recent `HISTORY_LIMIT` rows from
 * `/api/events/history` newest-first, with server-side filter params. After
 * mount, an `EventSource` against `/api/events/planning` prepends each fired
 * event to the top of the list - but only if it passes the active filter (R5).
 * A "Load older" affordance advances the opaque keyset cursor to page backward.
 *
 * The cap-and-prune contract is server-side: this tab never assumes the
 * ledger will fit in memory. Filter changes are debounced (≥250ms) so the
 * input does not fire a request per keystroke.
 */
export default function SystemEventsTab() {
    const [page, setPage] = useState<SystemEventRow[]>([]);
    const [catalog, setCatalog] = useState<EventCatalogEntry[]>([]);
    const [queryStatus, setQueryStatus] = useState<QueryStatus>('idle');
    const [queryError, setQueryError] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);

    const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
    // Debounced filter - the actual server query driver.
    const [debouncedFilter, setDebouncedFilter] = useState<FilterState>(DEFAULT_FILTER);

    // Liveness strip state (task 0222). `sseStatus` is tri-state so the
    // indicator can render connecting/live/errored distinctly.
    const [sseStatus, setSseStatus] = useState<SseStatus>('connecting');
    const { rate, recordEvent } = useRollingEventRate();

    // Tier lookup map for client-side tier post-filter + SSE gate.
    const tierByName = useMemo(() => {
        const map = new Map<string, string>();
        for (const entry of catalog) {
            if (entry.tier) map.set(entry.name, entry.tier);
        }
        return map;
    }, [catalog]);

    // Debounce filter mutations (≥250ms) so the input fires one request per
    // settled change, not per keystroke.
    useEffect(() => {
        const handle = window.setTimeout(() => {
            setDebouncedFilter(filter);
        }, 250);
        return () => window.clearTimeout(handle);
    }, [filter]);

    const activeFilter = useMemo(() => serializeFilter(debouncedFilter), [debouncedFilter]);

    // Initial + filter-change fetch (resets the page to the newest page).
    const fetchIdRef = useRef(0);
    useEffect(() => {
        const myId = ++fetchIdRef.current;
        const controller = new AbortController();
        setQueryStatus('loading');
        setQueryError(null);
        (async () => {
            try {
                const res = await fetchWithTimeout(
                    new Request(historyUrl({ ...activeFilter, limit: HISTORY_LIMIT }), {
                        signal: controller.signal,
                    }),
                );
                if (!res.ok) {
                    const body: unknown = await res.json().catch(() => null);
                    const code = (body as { code?: string } | null)?.code;
                    if (code === 'UNKNOWN_PREFIX' || code === 'MALFORMED_CURSOR') {
                        throw new Error(`${code}: ${(body as { error?: string }).error ?? res.status}`);
                    }
                    throw new Error(`history fetch failed: ${res.status}`);
                }
                const raw: unknown = await res.json();
                const body = parseHistoryResponse(raw);
                if (!body) throw new Error('history response failed schema validation');
                if (myId !== fetchIdRef.current) return; // stale - a newer fetch superseded us
                setPage(body.events);
                if (body.catalog) setCatalog(body.catalog);
                setNextCursor(body.nextCursor);
                setHasMore(body.hasMore);
                setQueryStatus('loaded');
            } catch (err) {
                if (controller.signal.aborted) return;
                if (myId !== fetchIdRef.current) return;
                setQueryError(err instanceof Error ? err.message : String(err));
                setQueryStatus('error');
            }
        })();
        return () => controller.abort();
    }, [activeFilter]);

    // Load older: append the next page via the opaque cursor.
    const loadMore = useCallback(async () => {
        if (!hasMore || loadingMore || nextCursor === null) return;
        setLoadingMore(true);
        try {
            const res = await fetchWithTimeout(
                new Request(historyUrl({ ...activeFilter, limit: HISTORY_LIMIT, cursor: nextCursor })),
            );
            if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
            const raw: unknown = await res.json();
            const body = parseHistoryResponse(raw);
            if (!body) throw new Error('history response failed schema validation');
            // Append older rows; dedup by id to guard against cursor edge cases.
            setPage((prev) => {
                const seen = new Set(prev.map((e) => e.id));
                const older = body.events.filter((e) => !seen.has(e.id));
                return [...prev, ...older];
            });
            if (body.catalog) setCatalog(body.catalog);
            setNextCursor(body.nextCursor);
            setHasMore(body.hasMore);
        } catch (err) {
            setQueryError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoadingMore(false);
        }
    }, [hasMore, loadingMore, nextCursor, activeFilter]);

    // Live tail via SSE - prepends each new event to the top of the list,
    // but only if it passes the active filter (R5).
    const filterRef = useRef(filter);
    filterRef.current = filter;
    const tierRef = useRef(tierByName);
    tierRef.current = tierByName;
    useEffect(() => {
        if (typeof EventSource === 'undefined') return;
        const es = new EventSource(sseUrl());
        es.onopen = () => {
            setSseStatus('live');
        };
        es.onerror = () => {
            // EventSource auto-reconnects after transient errors, so an
            // errored state is shown briefly while the browser retries.
            setSseStatus('errored');
        };
        es.onmessage = (msg) => {
            try {
                const raw: unknown = JSON.parse(msg.data);
                const envelope = parseSseEnvelope(raw);
                if (!envelope) return; // malformed frame - drop silently
                if (envelope.eventName === 'connected') return;
                // R5: gate SSE prepend by the active filter so a non-matching
                // frame does not pollute the filtered view.
                const currentFilter = filterRef.current;
                const currentTier = tierRef.current;
                if (
                    !matchesClientFilter(
                        {
                            eventName: envelope.eventName,
                            occurredAt: envelope.occurredAt,
                            actor: envelope.actor,
                            ...(envelope.prefix ? { prefix: envelope.prefix } : {}),
                            payload: envelope.payload,
                            ...(envelope.runId !== undefined ? { runId: envelope.runId } : {}),
                        },
                        currentFilter,
                        currentTier,
                    )
                ) {
                    return;
                }
                const row: SystemEventRow = {
                    id: `live-${envelope.occurredAt}-${envelope.eventName}`,
                    eventName: envelope.eventName,
                    occurredAt: envelope.occurredAt,
                    actor: envelope.actor,
                    ...(envelope.prefix ? { prefix: envelope.prefix } : {}),
                    ...(envelope.renderer ? { renderer: envelope.renderer } : {}),
                    payload: envelope.payload,
                    ...(envelope.envelope ? { envelope: envelope.envelope } : {}),
                    view: envelope.view,
                    ...optionalCorrelation(envelope.runId, envelope.entityKind, envelope.entityId, envelope.sequence),
                };
                setPage((prev) => [row, ...prev]);
                recordEvent();
            } catch {
                // Drop malformed frames silently - a bad row must not break the live tail.
            }
        };
        return () => es.close();
    }, [recordEvent]);

    const prefixOptions = useMemo(
        () =>
            Array.from(
                new Set([
                    ...catalog.map((entry) => entry.prefix),
                    ...page.map((evt) => evt.prefix ?? evt.eventName.split('.')[0] ?? evt.eventName),
                ]),
            ).sort(),
        [catalog, page],
    );

    // R6: clear-filters is visible iff at least one filter deviates from default.
    const filtersActive =
        filter.selectedPrefixes.size > 0 ||
        filter.searchQuery.trim() !== '' ||
        filter.searchScope !== 'all' ||
        filter.tierFilter !== 'all' ||
        filter.timeWindow !== 'all' ||
        filter.runId.trim() !== '';

    const clearFilters = useCallback(() => {
        setFilter(DEFAULT_FILTER);
    }, []);

    const togglePrefix = useCallback((prefix: string) => {
        setFilter((prev) => {
            const next = new Set(prev.selectedPrefixes);
            if (next.has(prefix)) next.delete(prefix);
            else next.add(prefix);
            return { ...prev, selectedPrefixes: next };
        });
    }, []);

    if (queryStatus === 'error') {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load event history: {queryError}
            </div>
        );
    }
    if (queryStatus === 'idle' || queryStatus === 'loading') {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading event history…
            </div>
        );
    }

    // Client-side post-filter for immediate UX. The debounced filter drives
    // the server query; the immediate filter drives the visible rows.
    const visiblePage = page.filter((evt) => matchesClientFilter(evt, filter, tierByName));

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">System Events</span>
                    <span className="text-xs text-spur-text-muted">newest first · live tail</span>
                </div>
                {/* Liveness status strip (task 0222). Stays on the same header row so the
                    existing layout is not pushed below the fold (R4). R1: tri-state indicator
                    with color + text label (R6). R7: the rolling rate + count live in a polite
                    aria-live region so screen readers announce updates without interrupting. */}
                <LivenessStrip
                    status={sseStatus}
                    rate={rate}
                    shown={visiblePage.length}
                    total={page.length}
                    hasMore={hasMore}
                />
            </div>

            {/* Filter bar (task 0224). Three rows: prefix pill chips (R1/R2),
                tier segmented toggle + time-window segmented toggle (R3/R5),
                search input + scope toggle + runId input + clear + inline count (R4/R6/R7). */}
            <div className="px-4 py-2 border-b border-spur-border bg-base-100 shrink-0 flex flex-col gap-2">
                {/* R1/R2: prefix pill chips - multi-select, colored to match the table. */}
                <fieldset
                    className="flex flex-wrap items-center gap-1.5 border-0 p-0 m-0"
                    aria-label="Filter by prefix"
                >
                    <legend className="sr-only">Filter by prefix</legend>
                    {prefixOptions.map((prefix) => {
                        const active = filter.selectedPrefixes.has(prefix);
                        const colorClass = getPrefixColor(prefix);
                        return (
                            <button
                                key={prefix}
                                type="button"
                                role="switch"
                                aria-checked={active}
                                aria-label={`Prefix ${prefix}${active ? ' (selected)' : ''}`}
                                onClick={() => togglePrefix(prefix)}
                                className={`px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-spur-text/40 ${
                                    active
                                        ? `${colorClass} border-current bg-base-200`
                                        : 'text-spur-text-muted border-spur-border/40 hover:bg-base-200/60'
                                }`}
                            >
                                {prefix}.*
                            </button>
                        );
                    })}
                </fieldset>
                <div className="flex flex-wrap items-center gap-2">
                    {/* R3: tier segmented toggle. */}
                    <SegmentedToggle
                        label="Tier"
                        value={filter.tierFilter}
                        onChange={(v) => setFilter((prev) => ({ ...prev, tierFilter: v }))}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: 'default', label: 'Default' },
                            { value: 'diagnostic', label: 'Diagnostic' },
                        ]}
                    />
                    {/* R5: time-window quick filter. */}
                    <SegmentedToggle
                        label="Window"
                        value={filter.timeWindow}
                        onChange={(v) => setFilter((prev) => ({ ...prev, timeWindow: v }))}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: '30s', label: '30s' },
                            { value: '5m', label: '5m' },
                        ]}
                    />
                    {/* R4: search input with inline scope selector. */}
                    <div className="flex items-center gap-1 flex-1 min-w-[220px]">
                        <select
                            value={filter.searchScope}
                            onChange={(e) =>
                                setFilter((prev) => ({
                                    ...prev,
                                    searchScope: e.target.value as FilterState['searchScope'],
                                }))
                            }
                            className="bg-base-200 border border-spur-border rounded px-1.5 py-0.5 text-[11px] text-spur-text focus:outline-none focus:ring-2 focus:ring-spur-text/40 cursor-pointer"
                            aria-label="Search scope"
                        >
                            <option value="all">all</option>
                            <option value="name">name</option>
                            <option value="actor">actor</option>
                            <option value="payload">payload</option>
                        </select>
                        <Input
                            size="sm"
                            variant="bordered"
                            placeholder="Search…"
                            value={filter.searchQuery}
                            onChange={(e) => setFilter((prev) => ({ ...prev, searchQuery: e.target.value }))}
                            className="flex-1 min-w-[120px] input-sm"
                            aria-label={`Search ${filter.searchScope}`}
                        />
                    </div>
                    {/* Run ID filter - server-side param (task 0375 R1). */}
                    <Input
                        size="sm"
                        variant="bordered"
                        placeholder="run id…"
                        value={filter.runId}
                        onChange={(e) => setFilter((prev) => ({ ...prev, runId: e.target.value }))}
                        className="w-32 input-sm"
                        aria-label="Filter by run id"
                    />
                    {/* R6: clear-filters button (visible iff filters active). */}
                    {filtersActive && (
                        <button
                            type="button"
                            onClick={clearFilters}
                            className="text-[11px] text-spur-text-muted hover:text-error px-2 py-0.5 rounded border border-spur-border/40 hover:border-error/40 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-spur-text/40"
                            aria-label="Clear all filters"
                        >
                            Clear
                        </button>
                    )}
                    {/* R7: inline result count. */}
                    <span aria-live="polite" className="text-[11px] font-mono text-spur-text-muted whitespace-nowrap">
                        {visiblePage.length} of {page.length}
                    </span>
                </div>
            </div>
            {visiblePage.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic flex-1 overflow-y-auto">
                    {page.length === 0
                        ? 'No system events yet. New events from the planning bus will appear here in real time.'
                        : 'No events match the active filters.'}
                </div>
            ) : (
                <SystemEventsTable rows={visiblePage} catalog={catalog} />
            )}
            {/* Load older affordance - advances the opaque keyset cursor (R1). */}
            {hasMore && (
                <div className="px-4 py-2 border-t border-spur-border bg-base-100 shrink-0 flex justify-center">
                    <button
                        type="button"
                        onClick={loadMore}
                        disabled={loadingMore}
                        data-load-older
                        className="text-[11px] text-spur-text-muted hover:text-spur-text px-3 py-1 rounded border border-spur-border/40 hover:border-spur-text/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait focus:outline-none focus:ring-2 focus:ring-spur-text/40"
                    >
                        {loadingMore ? 'Loading…' : 'Load older'}
                    </button>
                </div>
            )}
        </div>
    );
}

/**
 * Liveness strip rendered in the System Events header (task 0222).
 *
 * Shows three pieces of operational telemetry in a single horizontal strip:
 *   - SSE connection status (R1): a colored dot + text label. Color is
 *     redundant with the label so a colorblind operator or screen-reader user
 *     still gets the signal (R6).
 *   - Rolling rate (R2): "N events / 60s" reflecting the trailing window.
 *   - Filtered count (R3): "N of M shown" where M is the loaded page total,
 *     plus a "· more available" hint when the server has older pages (R1).
 *
 * The indicator dot is `role="status"` (live status, not a control), and the
 * numeric values sit in an `aria-live="polite"` region so screen readers
 * announce rate / count updates without interrupting (R7).
 */
function LivenessStrip({
    status,
    rate,
    shown,
    total,
    hasMore,
}: {
    status: SseStatus;
    rate: number;
    shown: number;
    total: number;
    hasMore: boolean;
}) {
    const dotClass = useMemo(() => {
        switch (status) {
            case 'live':
                return 'bg-success';
            case 'connecting':
                return 'bg-spur-text-muted';
            case 'errored':
                return 'bg-error';
        }
    }, [status]);

    // Pulse keyframe only on the "live" dot - the connecting and errored
    // states use a static dot to avoid implying healthy liveness.
    const dotStyle = status === 'live' ? ({ animation: 'spur-pulse 1.6s ease-in-out infinite' } as const) : undefined;

    return (
        <div className="flex items-center gap-3 text-[11px] text-spur-text-muted font-mono whitespace-nowrap">
            <span role="status" aria-label={`SSE connection ${status}`} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${dotClass}`} style={dotStyle} />
                <span className="text-spur-text uppercase tracking-wide">{status}</span>
            </span>
            <span aria-live="polite" aria-atomic="true">
                {rate} events / 60s
            </span>
            <span aria-live="polite" aria-atomic="true">
                {shown} of {total} shown{hasMore ? ' · more available' : ''}
            </span>
        </div>
    );
}

/**
 * useMediaQuery - narrow-viewport detection for the responsive table
 * collapse (task 0225 R1). SSR-safe: defaults to `false` so the server
 * render and the first client render match; updates after mount.
 */
function useMediaQuery(query: string): boolean {
    // useSyncExternalStore is not available - fall back to a state+listener
    // pair. React 18's useSyncExternalStore would be ideal, but this module
    // doesn't pull it in. Instead we use a manual subscription that updates
    // state on query changes.
    const [matches, setMatches] = useState(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia(query).matches;
    });
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, [query]);
    return matches;
}

/**
 * Dense table view (task 0223) replacing the previous card list.
 *
 * Layout: 8 columns (Time | Severity | Event | Summary | Producer |
 * Correlation | Outcome | Action)
 * with a sticky `<thead>` (R3) and compact rows (~28px) so at least 20 rows are
 * visible on a standard viewport (R2). Each row is a keyboard-toggleable
 * detail target (R4) that expands a panel below showing the full redacted
 * envelope - no duplication of detail rendering (R9).
 *
 * The container is the vertical scroll host; sticky positioning is on the
 * `<thead>` so the column labels stay visible regardless of scroll position.
 */
function SystemEventsTable({ rows, catalog }: { rows: SystemEventRow[]; catalog: EventCatalogEntry[] }) {
    const tierByName = useMemo(() => {
        const map = new Map<string, string>();
        for (const entry of catalog) {
            if (entry.tier) map.set(entry.name, entry.tier);
        }
        return map;
    }, [catalog]);

    // Under 640px the table collapses to Time + Event. The semantic fields stack
    // inside Event so the compact surface loses no diagnostic information.
    // Project is omitted from the table: it is composition-root context and is
    // constant for this Board view. It remains in the tooltip and expanded detail.
    const isCompact = useMediaQuery('(max-width: 639px)');

    return (
        <section className="flex-1 overflow-y-auto min-w-0" data-system-events-tab aria-label="System events">
            {/*
              table-fixed + min-w-0 keeps columns from shoving neighbors when a long
              jobId/runId appears. Run/Outcome are wider than the original w-28 so
              correlators truncate cleanly instead of wrapping into the next cell.
            */}
            <table
                className={`w-full ${isCompact ? 'min-w-0' : 'min-w-[1180px]'} text-xs border-separate border-spacing-0 table-fixed`}
            >
                <colgroup>
                    <col className={isCompact ? 'w-24' : 'w-36'} />
                    {!isCompact && <col className="w-24" />}
                    <col className="w-[17%]" />
                    {!isCompact && <col className="w-[22%]" />}
                    {!isCompact && <col className="w-[18%]" />}
                    {!isCompact && <col className="w-[20%]" />}
                    {!isCompact && <col className="w-28" />}
                    {!isCompact && <col className="w-[18%]" />}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-base-200">
                    <tr className="text-left text-spur-text-muted uppercase tracking-wide text-[10px]">
                        <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                            Time
                        </th>
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Severity
                            </th>
                        )}
                        <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                            Event
                        </th>
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Summary
                            </th>
                        )}
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Producer
                            </th>
                        )}
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Correlation
                            </th>
                        )}
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Outcome
                            </th>
                        )}
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Action
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((evt) => (
                        <EventTableRow
                            key={evt.id}
                            event={evt}
                            tier={tierByName.get(evt.eventName) ?? 'default'}
                            compact={isCompact}
                        />
                    ))}
                </tbody>
            </table>
        </section>
    );
}

/**
 * Event table row with a persistent, keyboard-reachable detail panel (R4).
 *
 * Payload tip interaction (pin-to-copy):
 * 1. Hover event name → ephemeral preview under the name
 * 2. Click event name (or Enter/Space) → pin fixed tip so select/copy works
 * 3. Esc / outside click / close → unlock
 *
 * Click-the-name is the pin trigger (not “click outside while hovering”), because
 * leaving the name to click elsewhere hides the hover tip first.
 */
/** Cross-row event so only one payload tooltip stays pinned at a time. */
const PAYLOAD_TOOLTIP_PIN_EVENT = 'system-events-payload-tooltip-pin';

const SEVERITY_PRESENTATION: Record<SystemEventSeverity, { icon: string; className: string }> = {
    info: { icon: '●', className: 'text-spur-text-muted' },
    warning: { icon: '▲', className: 'text-warning' },
    error: { icon: '✕', className: 'text-error' },
};

function SeverityLabel({ severity }: { severity: SystemEventSeverity }) {
    const presentation = SEVERITY_PRESENTATION[severity];
    return (
        <span className={`inline-flex items-center gap-1 whitespace-nowrap ${presentation.className}`}>
            <span aria-hidden="true">{presentation.icon}</span>
            <span>{severity}</span>
        </span>
    );
}

function EventTableRow({ event, tier, compact }: { event: SystemEventRow; tier: string; compact: boolean }) {
    const prefix = event.prefix ?? event.eventName.split('.')[0] ?? event.eventName;
    const view = useMemo(
        () => event.view ?? parseSystemEventView(event.eventName, event.payload),
        [event.eventName, event.payload, event.view],
    );
    const colorClass = getPrefixColor(prefix);
    const [expanded, setExpanded] = useState(false);
    /** Hover preview — kept briefly after leave so the pointer can reach a pin control. */
    const [hoveringName, setHoveringName] = useState(false);
    /**
     * Locked tooltip: click the event name pins a fixed, interactive bubble so the
     * user can select/copy. Esc or a later outside click unlocks.
     */
    const [pinned, setPinned] = useState(false);
    const [pinPos, setPinPos] = useState<{ x: number; y: number } | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const nameBtnRef = useRef<HTMLButtonElement>(null);
    /** Ignore unlock for a short window after pin so the pin click cannot dismiss. */
    const ignoreUnlockUntilRef = useRef(0);
    const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const actorLabel = displayValue(event.actor);
    const tooltipOpen = hoveringName || pinned;

    const clearHoverLeaveTimer = useCallback(() => {
        if (hoverLeaveTimerRef.current !== null) {
            clearTimeout(hoverLeaveTimerRef.current);
            hoverLeaveTimerRef.current = null;
        }
    }, []);

    const unlockTooltip = useCallback(() => {
        setPinned(false);
        setPinPos(null);
    }, []);

    const pinTooltipAt = useCallback(
        (clientX: number, clientY: number) => {
            // Guard against the pin click / subsequent bubble phase unlocking immediately.
            ignoreUnlockUntilRef.current = performance.now() + 400;
            setPinned(true);
            setHoveringName(false);
            clearHoverLeaveTimer();
            // Prefer stable coords under the name when cursor coords are missing (keyboard).
            const x = Number.isFinite(clientX) && clientX > 0 ? clientX : 8;
            const y = Number.isFinite(clientY) && clientY > 0 ? clientY : 8;
            setPinPos({ x, y });
            window.dispatchEvent(new CustomEvent(PAYLOAD_TOOLTIP_PIN_EVENT, { detail: { id: event.id } }));
        },
        [event.id, clearHoverLeaveTimer],
    );

    const pinFromNameElement = useCallback(
        (el: HTMLElement, clientX?: number, clientY?: number) => {
            const rect = el.getBoundingClientRect();
            const x = clientX && clientX > 0 ? clientX : rect.left;
            const y = clientY && clientY > 0 ? clientY + 4 : rect.bottom + 6;
            pinTooltipAt(x, y);
        },
        [pinTooltipAt],
    );

    // Another row pinned → release this one.
    useEffect(() => {
        const onOtherPin = (e: Event) => {
            const id = (e as CustomEvent<{ id: string }>).detail?.id;
            if (id !== event.id) unlockTooltip();
        };
        window.addEventListener(PAYLOAD_TOOLTIP_PIN_EVENT, onOtherPin);
        return () => window.removeEventListener(PAYLOAD_TOOLTIP_PIN_EVENT, onOtherPin);
    }, [event.id, unlockTooltip]);

    // While pinned: outside click or Escape unlocks. Clicks inside the tip (select/copy) keep it open.
    useEffect(() => {
        if (!pinned) return;
        const onPointerDown = (e: PointerEvent) => {
            if (performance.now() < ignoreUnlockUntilRef.current) return;
            if (tooltipRef.current?.contains(e.target as Node)) return;
            // Re-clicking this event name should keep the tip pinned (not flash off).
            if (nameBtnRef.current?.contains(e.target as Node)) return;
            unlockTooltip();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                unlockTooltip();
                e.stopPropagation();
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [pinned, unlockTooltip]);

    useEffect(
        () => () => {
            clearHoverLeaveTimer();
        },
        [clearHoverLeaveTimer],
    );

    const onToggle = useCallback(() => setExpanded((prev) => !prev), []);
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (pinned) {
                    unlockTooltip();
                    e.stopPropagation();
                    return;
                }
                setExpanded(false);
                e.stopPropagation();
            }
        },
        [pinned, unlockTooltip],
    );

    const tooltipNode = tooltipOpen ? (
        <div
            ref={tooltipRef}
            id={`system-event-tooltip-${event.id}`}
            role="tooltip"
            data-testid="system-event-payload-tooltip"
            data-pinned={pinned ? 'true' : 'false'}
            className={
                pinned
                    ? 'pointer-events-auto fixed z-50 rounded shadow-lg p-2.5 text-[11px] min-w-[min(400px,90vw)] max-w-[min(840px,95vw)] whitespace-normal border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] select-text cursor-text'
                    : // Hover preview: interactive enough to hit "Pin" without leaving the name first.
                      'pointer-events-auto absolute left-0 top-full mt-1 z-30 rounded shadow-lg p-2.5 text-[11px] min-w-[min(400px,90vw)] max-w-[min(840px,95vw)] whitespace-normal border border-[#30363d] bg-[#0d1117] text-[#c9d1d9]'
            }
            style={pinned && pinPos ? { top: pinPos.y, left: pinPos.x } : undefined}
            onMouseEnter={() => {
                // Keep hover open while the pointer is over the tip (bridge from the name).
                clearHoverLeaveTimer();
                setHoveringName(true);
            }}
            onMouseLeave={() => {
                if (pinned) return;
                clearHoverLeaveTimer();
                hoverLeaveTimerRef.current = setTimeout(() => setHoveringName(false), 150);
            }}
            onFocusCapture={() => setHoveringName(true)}
            onBlurCapture={(e) => {
                if (!pinned && !e.currentTarget.contains(e.relatedTarget as Node | null)) setHoveringName(false);
            }}
            onPointerDown={(e) => {
                // Keep select/copy clicks inside the bubble from unlocking.
                if (pinned) e.stopPropagation();
            }}
        >
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <div
                    className="text-[11px] font-sans font-semibold text-[#c9d1d9] truncate"
                    data-testid="system-event-tooltip-title"
                >
                    {tooltipTitle(event, view)}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {!pinned && (
                        <button
                            type="button"
                            data-testid="system-event-payload-tooltip-pin"
                            className="text-[10px] text-[#c9d1d9] hover:text-white px-1.5 py-0.5 rounded border border-[#30363d] bg-[#21262d] cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                const anchor = nameBtnRef.current;
                                if (anchor) {
                                    pinFromNameElement(anchor);
                                } else {
                                    pinTooltipAt(e.clientX, e.clientY);
                                }
                            }}
                        >
                            Pin
                        </button>
                    )}
                    {pinned && (
                        <button
                            type="button"
                            data-testid="system-event-payload-tooltip-close"
                            className="text-[10px] text-[#8b949e] hover:text-[#c9d1d9] px-1 rounded border border-[#30363d] cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                unlockTooltip();
                            }}
                        >
                            close
                        </button>
                    )}
                </div>
            </div>
            <p className="mb-2 text-spur-text leading-relaxed" data-testid="system-event-description">
                {view.description}
            </p>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 max-h-80 overflow-y-auto">
                <dt className="text-spur-text-muted">Summary</dt>
                <dd className="break-words">{displayValue(view.summary)}</dd>
                <dt className="text-spur-text-muted">Severity</dt>
                <dd>
                    <SeverityLabel severity={view.severity} />
                </dd>
                {view.fields.map((field) => (
                    <div className="contents" key={field.label + field.value}>
                        <dt className="text-spur-text-muted">{field.label}</dt>
                        <dd className="font-mono break-all">{displayValue(field.value)}</dd>
                    </div>
                ))}
                <dt className="text-spur-text-muted">Producer</dt>
                <dd className="font-mono break-all">{displayValue(view.producer)}</dd>
                {view.correlationFields.length > 0 ? (
                    view.correlationFields.map((field) => (
                        <div className="contents" key={`correlation-${field.label}`}>
                            <dt className="text-spur-text-muted">{field.label}</dt>
                            <dd className="font-mono break-all">{displayValue(field.value)}</dd>
                        </div>
                    ))
                ) : (
                    <>
                        <dt className="text-spur-text-muted">Correlation</dt>
                        <dd className="font-mono">-</dd>
                    </>
                )}
                <dt className="text-spur-text-muted">Outcome</dt>
                <dd className="font-mono break-all">{displayValue(view.outcome)}</dd>
            </dl>
            {view.action && (
                <div className="mt-2 border-t border-[#30363d] pt-2" data-testid="system-event-remediation">
                    <div className="text-spur-text-muted">{view.action.label}</div>
                    <code className="block mt-0.5 font-mono break-all select-text">{view.action.value}</code>
                </div>
            )}
            <div
                className="mt-2 border-t border-[#30363d] pt-1.5 text-[10px] text-[#8b949e] font-sans"
                data-testid="system-event-tooltip-footer"
            >
                {pinned ? 'Select to copy · Esc or outside click to close' : 'Click event name or Pin to lock for copy'}
            </div>
        </div>
    ) : null;

    return (
        <>
            <tr className="group hover:bg-base-200/60 transition-colors" style={{ height: compact ? undefined : 28 }}>
                <td className="px-3 py-1 border-b border-spur-border/40 font-mono text-spur-text-muted whitespace-nowrap align-middle">
                    {formatLocalTime(event.occurredAt)}
                </td>
                {!compact && (
                    <td className="px-3 py-1 border-b border-spur-border/40 align-middle text-[10px]">
                        <SeverityLabel severity={view.severity} />
                    </td>
                )}
                <td className="px-3 py-1 border-b border-spur-border/40 relative align-middle min-w-0">
                    <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                            <button
                                type="button"
                                aria-expanded={expanded}
                                aria-controls={`detail-${event.id}`}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} detail for ${event.eventName}`}
                                onClick={onToggle}
                                onKeyDown={onKeyDown}
                                className="inline-flex items-center justify-center w-4 h-4 text-spur-text-muted hover:text-spur-text text-[10px] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-spur-text/40 shrink-0"
                            >
                                {expanded ? '▾' : '▸'}
                            </button>
                            {/*
                              Hover → preview tip (with Pin control).
                              Click event name / Pin → lock tip for select & copy.
                              Esc or outside click → unlock.
                            */}
                            <div className="relative min-w-0 max-w-full">
                                <button
                                    ref={nameBtnRef}
                                    type="button"
                                    className={`font-mono font-semibold truncate block max-w-full text-left cursor-pointer bg-transparent border-0 p-0 ${colorClass}`}
                                    data-testid="system-event-name"
                                    aria-label={`Context for ${event.eventName}. Hover to preview; click to pin for select and copy.`}
                                    aria-describedby={tooltipOpen ? `system-event-tooltip-${event.id}` : undefined}
                                    onMouseEnter={() => {
                                        clearHoverLeaveTimer();
                                        setHoveringName(true);
                                    }}
                                    onFocus={() => {
                                        clearHoverLeaveTimer();
                                        setHoveringName(true);
                                    }}
                                    onBlur={(e) => {
                                        if (!pinned && !tooltipRef.current?.contains(e.relatedTarget as Node | null)) {
                                            setHoveringName(false);
                                        }
                                    }}
                                    onMouseLeave={() => {
                                        // Delay hide so the user can move into the tip / hit Pin.
                                        clearHoverLeaveTimer();
                                        hoverLeaveTimerRef.current = setTimeout(() => {
                                            if (!pinned) setHoveringName(false);
                                        }, 200);
                                    }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (pinned) return;
                                        pinFromNameElement(e.currentTarget, e.clientX, e.clientY);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            if (pinned) return;
                                            pinFromNameElement(e.currentTarget);
                                        }
                                    }}
                                >
                                    {event.eventName}
                                </button>
                                {/* Absolute under the name while hovering (not pinned). */}
                                {!pinned && tooltipNode}
                            </div>
                        </div>
                        {compact && (
                            <div className="flex flex-col gap-0.5 text-[10px] text-spur-text-muted min-w-0">
                                <SeverityLabel severity={view.severity} />
                                <span className="truncate text-spur-text" title={displayValue(view.summary)}>
                                    {displayValue(view.summary)}
                                </span>
                                <span className="truncate" title={displayValue(view.producer)}>
                                    {displayValue(view.producer)}
                                </span>
                                <span className="truncate" title={displayValue(view.correlation)}>
                                    {displayValue(view.correlation)}
                                </span>
                                <span className="truncate">outcome: {displayValue(view.outcome)}</span>
                                <span className="truncate" title={displayValue(view.action?.value)}>
                                    action: {displayValue(view.action?.value)}
                                </span>
                            </div>
                        )}
                    </div>
                </td>
                {!compact && (
                    <td
                        className="px-3 py-1 border-b border-spur-border/40 text-spur-text align-middle truncate"
                        title={displayValue(view.summary)}
                    >
                        {displayValue(view.summary)}
                    </td>
                )}
                {!compact && (
                    <td
                        className="px-3 py-1 border-b border-spur-border/40 font-mono text-[10px] text-spur-text-muted align-middle truncate"
                        title={displayValue(view.producer)}
                    >
                        {displayValue(view.producer)}
                    </td>
                )}
                {!compact && (
                    <td
                        className="px-3 py-1 border-b border-spur-border/40 font-mono text-[10px] text-spur-text-muted align-middle truncate"
                        title={displayValue(view.correlation)}
                    >
                        {displayValue(view.correlation)}
                    </td>
                )}
                {!compact && (
                    <td
                        className="px-3 py-1 border-b border-spur-border/40 font-mono text-[10px] text-spur-text-muted align-middle truncate"
                        title={displayValue(view.outcome)}
                    >
                        {displayValue(view.outcome)}
                    </td>
                )}
                {!compact && (
                    <td
                        className="px-3 py-1 border-b border-spur-border/40 font-mono text-[10px] text-spur-text-muted align-middle truncate"
                        title={displayValue(view.action?.value)}
                    >
                        {displayValue(view.action?.value)}
                    </td>
                )}
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={compact ? 2 : 8} className="px-3 py-2 border-b border-spur-border/40 bg-base-300/40">
                        <section
                            id={`detail-${event.id}`}
                            aria-label={`Detail for ${event.eventName}`}
                            onKeyDown={onKeyDown}
                            tabIndex={-1}
                            className="flex flex-col gap-2 text-[11px] text-spur-text max-w-full"
                        >
                            {/* Context and low-value catalog metadata stay in expanded detail. */}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
                                <span>
                                    <span className="text-spur-text-muted">project:</span>{' '}
                                    {displayValue(view.projectName)}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">root:</span> {displayValue(view.projectRoot)}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">producer:</span>{' '}
                                    {displayValue(view.producer)}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">correlation:</span>{' '}
                                    {displayValue(view.correlation)}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">actor:</span> {actorLabel}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">prefix:</span> {prefix}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">tier:</span> {tier}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">outcome:</span> {displayValue(view.outcome)}
                                </span>
                            </div>
                            {view.fields.length > 0 && (
                                <dl className="space-y-0.5">
                                    {view.fields.map((field) => (
                                        <div key={field.label + field.value} className="flex gap-2">
                                            <dt className="text-spur-text-muted shrink-0">{field.label}:</dt>
                                            <dd className="font-mono break-all">{displayValue(field.value)}</dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                            {/* Full redacted envelope (raw JSON). Redaction is server-side. */}
                            <div className="border-t border-spur-border/40 pt-1">
                                <div className="text-spur-text-muted text-[10px] mb-0.5">payload (redacted):</div>
                                <pre className="font-mono text-[10px] text-spur-text-muted overflow-x-auto whitespace-pre-wrap break-all">
                                    {event.envelope ? JSON.stringify(event.envelope, null, 2) : '-'}
                                </pre>
                            </div>
                            {/* Dismiss button - Escape also works via onKeyDown above. */}
                            <button
                                type="button"
                                onClick={() => setExpanded(false)}
                                className="self-start text-[10px] text-spur-text-muted hover:text-error px-2 py-0.5 rounded border border-spur-border/40 hover:border-error/40 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-spur-text/40"
                            >
                                Close (Esc)
                            </button>
                        </section>
                    </td>
                </tr>
            )}
            {/* Pinned tip is position:fixed — portal to body so <tbody> doesn't clip/invalidate markup. */}
            {pinned && tooltipNode && typeof document !== 'undefined' ? createPortal(tooltipNode, document.body) : null}
        </>
    );
}

/**
 * Three-button segmented toggle (task 0224 R3 / R5). Used twice in the
 * filter bar: tier filter (All | Default | Diagnostic) and time-window
 * filter (All | 30s | 5m).
 *
 * Built as a `role="group"` with a visually-hidden label and three
 * `<input type="radio">` children - keyboard users can tab to
 * the group and arrow between options.
 */
function SegmentedToggle<V extends string>({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: V;
    onChange: (next: V) => void;
    options: { value: V; label: string }[];
}) {
    return (
        <fieldset
            aria-label={label}
            className="inline-flex rounded border border-spur-border/40 overflow-hidden text-[11px] border-0 p-0 m-0"
        >
            <legend className="sr-only">{label}</legend>
            {options.map((opt) => {
                const active = opt.value === value;
                return (
                    <label
                        key={opt.value}
                        className={`px-2 py-0.5 font-mono cursor-pointer focus-within:ring-2 focus-within:ring-spur-text/40 transition-colors ${
                            active ? 'bg-spur-text/15 text-spur-text' : 'text-spur-text-muted hover:bg-base-200/60'
                        }`}
                    >
                        <input
                            type="radio"
                            name={label}
                            value={opt.value}
                            checked={active}
                            onChange={() => onChange(opt.value)}
                            className="sr-only"
                        />
                        {opt.label}
                    </label>
                );
            })}
        </fieldset>
    );
}
