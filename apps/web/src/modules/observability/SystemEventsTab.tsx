import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input, Loading } from '@/ui';
import { resolveApiUrl } from '../../lib/rpc-client';

/** Wire shape of a single system event row from the history endpoint. */
export interface SystemEventRow {
    id: string;
    eventName: string;
    occurredAt: string;
    actor: string | null;
    prefix?: string;
    renderer?: string;
    payload: Record<string, unknown> | null;
}

interface EventCatalogEntry {
    name: string;
    prefix: string;
    source: string;
    /** Optional tier — only present when the server ships it (task 0221 R5). */
    tier?: string;
    renderer: string;
}

/** Wire shape of the `/api/events/history` JSON envelope. */
interface HistoryResponse {
    events: SystemEventRow[];
    count: number;
    catalog?: EventCatalogEntry[];
}

/** Wire shape of one SSE envelope pushed by the planning stream. */
interface SseEnvelope {
    eventName: string;
    occurredAt: string;
    actor: string | null;
    prefix?: string;
    renderer?: string;
    payload: Record<string, unknown> | null;
}

const sseUrl = () => `${resolveApiUrl()}/events/planning`;
const historyUrl = (limit: number) => `${resolveApiUrl()}/events/history?limit=${limit}`;
const HISTORY_LIMIT = 100;

/**
 * Stable prefix → tailwind text-color mapping (task 0223 R4). Hand-curated so
 * the color is deterministic across renders (not a hash of the event name) —
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
 * Trail of recent event timestamps used to compute the rolling
 * "N events / 60s" rate. We keep absolute epoch ms so the rate stays correct
 * across tab clock drift and is trivially sliceable for the trailing window.
 */
function useRollingEventRate(): { rate: number; recordEvent: () => void } {
    const trailRef = useRef<number[]>([]);
    const [rate, setRate] = useState(0);

    // Re-tick every second so the rate reflects the *trailing* 60-second window
    // (R2). The interval is a coarse timer; the actual rate may lag a frame
    // behind the wall clock, which is fine — this is a human-facing indicator.
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
 * return `null` when the shape is wrong. Network input is untrusted — a
 * single bad row from the server must not crash the tab.
 */
function parseHistoryResponse(value: unknown): HistoryResponse | null {
    if (value === null || typeof value !== 'object') return null;
    if (!('events' in value) || !('count' in value)) return null;
    const rawEvents = (value as { events: unknown }).events;
    if (!Array.isArray(rawEvents)) return null;
    const count = (value as { count: unknown }).count;
    if (typeof count !== 'number') return null;
    const events: SystemEventRow[] = [];
    for (const raw of rawEvents) {
        const row = parseHistoryRow(raw);
        if (!row) return null;
        events.push(row);
    }
    const rawCatalog = (value as { catalog?: unknown }).catalog;
    const catalog = Array.isArray(rawCatalog) ? parseCatalog(rawCatalog) : undefined;
    return { events, count, ...(catalog ? { catalog } : {}) };
}

/** Runtime-narrow one history row. */
function parseHistoryRow(value: unknown): SystemEventRow | null {
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
    if (payload === null) {
        return {
            id: obj.id,
            eventName: obj.eventName,
            occurredAt: obj.occurredAt,
            actor,
            ...(prefix ? { prefix } : {}),
            ...(renderer ? { renderer } : {}),
            payload: null,
        };
    }
    if (typeof payload !== 'object') return null;
    return {
        id: obj.id,
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        ...(prefix ? { prefix } : {}),
        ...(renderer ? { renderer } : {}),
        payload: payload as Record<string, unknown>,
    };
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
 * `null` when the frame is malformed. Network input is untrusted — the server
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
    if (payload === null) {
        return {
            eventName: obj.eventName,
            occurredAt: obj.occurredAt,
            actor,
            ...(prefix ? { prefix } : {}),
            ...(renderer ? { renderer } : {}),
            payload: null,
        };
    }
    if (typeof payload !== 'object') return null;
    return {
        eventName: obj.eventName,
        occurredAt: obj.occurredAt,
        actor,
        ...(prefix ? { prefix } : {}),
        ...(renderer ? { renderer } : {}),
        payload: payload as Record<string, unknown>,
    };
}

function formatVal(val: unknown): string {
    if (typeof val === 'object' && val !== null) return JSON.stringify(val);
    return String(val);
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

export function buildTooltipSummary(
    eventName: string,
    payload: Record<string, unknown> | null,
    renderer?: string,
): { label: string; value: string }[] | null {
    if (!payload || Object.keys(payload).length === 0) return null;

    const pickString = (...keys: string[]): string | undefined => {
        for (const key of keys) {
            const value = payload[key];
            if (typeof value === 'string' && value.length > 0) return value;
            if (typeof value === 'number') return String(value);
        }
        return undefined;
    };
    const pickNumber = (...keys: string[]): number | null => {
        for (const key of keys) {
            const value = payload[key];
            if (typeof value === 'number' && Number.isFinite(value)) return value;
        }
        return null;
    };
    const pickBool = (...keys: string[]): string | undefined => {
        for (const key of keys) {
            const value = payload[key];
            if (typeof value === 'boolean') return String(value);
        }
        return undefined;
    };

    const entity = payload.entity as Record<string, unknown> | undefined;
    const entityLabel =
        entity && typeof entity === 'object'
            ? `${formatVal(entity.kind)}:${formatVal(entity.id)}`
            : pickString('entityId', 'wbs', 'ruleId', 'msgId', 'jobId');
    const transitionFrom = pickString('from');
    const transitionTo = pickString('to');
    const transition =
        transitionFrom || transitionTo ? `${transitionFrom ?? 'none'} → ${transitionTo ?? 'none'}` : undefined;

    // Push a candidate pair only when value is non-empty (null/undefined/'' dropped).
    const summary: { label: string; value: string }[] = [];
    const push = (label: string, value: string | null | undefined): void => {
        if (value !== null && value !== undefined && value !== '') summary.push({ label, value });
    };

    // Renderer-aware primary fields. Falls through to the generic summary if
    // the active renderer is unknown.
    const fallbackRenderer = eventName.startsWith('task.') || eventName.startsWith('feature.') ? 'planning' : 'generic';
    const activeRenderer = renderer ?? fallbackRenderer;

    switch (activeRenderer) {
        case 'planning':
            if (entityLabel) push('Entity', entityLabel);
            if (transition) push('Transition', transition);
            break;
        case 'queue':
            push('Job', pickString('kind', 'type', 'name'));
            push('ID', pickString('jobId', 'id'));
            push('Duration', formatDuration(pickNumber('durationMs')));
            push('Status', pickString('status', 'state'));
            push('Error', pickString('error'));
            break;
        case 'scheduler':
            push('Job', pickString('name', 'kind'));
            push('Duration', formatDuration(pickNumber('durationMs')));
            push('Error', pickString('error'));
            break;
        case 'message': {
            const from = pickString('fromId', 'from', 'senderId');
            const to = pickString('toId', 'to', 'recipientId');
            if (from && to) push('Route', `${from} → ${to}`);
            else push('Route', pickString('route', 'direction', 'type'));
            push('OK', pickBool('ok', 'success'));
            push('Subject', pickString('subject', 'topic'));
            break;
        }
        case 'process':
        case 'agent':
            push('Command', pickString('command', 'cmd', 'agent', 'name'));
            push('Exit', pickString('exitCode', 'code'));
            push('Duration', formatDuration(pickNumber('durationMs')));
            push('Op', pickString('op', 'action', 'event', 'type'));
            push('PID', pickString('pid'));
            break;
        case 'rule':
            push('Rule', pickString('rule', 'ruleId', 'name'));
            push('Severity', pickString('severity'));
            push('Findings', pickString('count', 'findings', 'total'));
            break;
        case 'bus': {
            const evt = pickString('event', 'kind');
            if (evt) push('Bus event', evt);
            break;
        }
        case 'api': {
            const method = pickString('method');
            const status = pickString('status');
            if (method && status) push('HTTP', `${method} ${status}`);
            else {
                push('HTTP', method);
                push('HTTP', status);
            }
            push('Path', pickString('path'));
            push('Error', pickString('error'));
            break;
        }
        case 'workflow-run':
        case 'workflow-phase':
        case 'workflow-transition':
        case 'workflow-action':
        case 'workflow-hitl':
        case 'workflow-guard':
        case 'workflow-custom': {
            push('Workflow', pickString('workflow', 'workflowName', 'name'));
            push('Run', pickString('runId', 'run', 'id'));
            // First non-null of phase/transition/action becomes a single labeled pair.
            push('Phase', pickString('phase'));
            push('Transition', pickString('transition'));
            push('Action', pickString('action', 'kind'));
            break;
        }
        default:
            // Generic: surface the first 3 non-empty scalar fields so the
            // tooltip is still informative for events without a known renderer.
            for (const [key, value] of Object.entries(payload)) {
                if (summary.length >= 3) break;
                if (value === null || value === undefined || value === '') continue;
                if (typeof value === 'object') continue;
                summary.push({ label: key, value: formatVal(value) });
            }
            break;
    }

    return summary.length > 0 ? summary.slice(0, 4) : null;
}

/**
 * System Events tab (task 0189 R5).
 *
 * Initial fetch loads the most recent `HISTORY_LIMIT` rows from
 * `/api/events/history` newest-first. After mount, an `EventSource` against
 * `/api/events/planning` appends each fired event to the top of the list so
 * the operator sees live activity without a refresh.
 *
 * The cap-and-prune contract is server-side: this tab never assumes the
 * ledger will fit in memory — the render set is bounded by `HISTORY_LIMIT`
 * (newest-first), and any SSE envelope whose `eventName === 'connected'`
 * (the stream's initial signal) is dropped to avoid a duplicate first row.
 */
export default function SystemEventsTab() {
    const [events, setEvents] = useState<SystemEventRow[] | null>(null);
    const [catalog, setCatalog] = useState<EventCatalogEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedPrefixes, setSelectedPrefixes] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [searchScope, setSearchScope] = useState<'all' | 'name' | 'actor' | 'payload'>('all');
    const [tierFilter, setTierFilter] = useState<'all' | 'default' | 'diagnostic'>('all');
    const [timeWindow, setTimeWindow] = useState<'all' | '30s' | '5m'>('all');
    // Liveness strip state (task 0222). `sseStatus` is tri-state so the
    // indicator can render connecting/live/errored distinctly.
    const [sseStatus, setSseStatus] = useState<SseStatus>('connecting');
    const { rate, recordEvent } = useRollingEventRate();

    // Initial history fetch.
    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetch(historyUrl(HISTORY_LIMIT), { signal: controller.signal });
                if (!res.ok) throw new Error(`history fetch failed: ${res.status}`);
                const raw: unknown = await res.json();
                const body = parseHistoryResponse(raw);
                if (!body) throw new Error('history response failed schema validation');
                setEvents(body.events);
                if (body.catalog) setCatalog(body.catalog);
            } catch (err) {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => controller.abort();
    }, []);

    // Live tail via SSE — appends each new event to the top of the list.
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
                if (!envelope) return; // malformed frame — drop silently
                if (envelope.eventName === 'connected') return;
                const row: SystemEventRow = {
                    id: `live-${envelope.occurredAt}-${envelope.eventName}`,
                    eventName: envelope.eventName,
                    occurredAt: envelope.occurredAt,
                    actor: envelope.actor,
                    ...(envelope.prefix ? { prefix: envelope.prefix } : {}),
                    ...(envelope.renderer ? { renderer: envelope.renderer } : {}),
                    payload: envelope.payload,
                };
                setEvents((prev) => (prev ? [row, ...prev].slice(0, HISTORY_LIMIT) : [row]));
                recordEvent();
            } catch {
                // Drop malformed frames silently — a bad row must not break the live tail.
            }
        };
        return () => es.close();
    }, [recordEvent]);

    const prefixOptions = useMemo(
        () =>
            Array.from(
                new Set([
                    ...catalog.map((entry) => entry.prefix),
                    ...(events ?? []).map((evt) => evt.prefix ?? evt.eventName.split('.')[0] ?? evt.eventName),
                ]),
            ).sort(),
        [catalog, events],
    );

    // R6: clear-filters is visible iff at least one filter deviates from default.
    const filtersActive =
        selectedPrefixes.size > 0 ||
        searchQuery.trim() !== '' ||
        searchScope !== 'all' ||
        tierFilter !== 'all' ||
        timeWindow !== 'all';

    const filteredEvents = useMemo(() => {
        const list = events ?? [];
        const windowMs = timeWindow === '30s' ? 30_000 : timeWindow === '5m' ? 5 * 60_000 : null;
        const windowCutoff = windowMs !== null ? Date.now() - windowMs : null;

        return list.filter((evt) => {
            // Multi-select prefix (R2: empty set means "all").
            if (selectedPrefixes.size > 0) {
                const prefix = evt.prefix ?? evt.eventName.split('.')[0] ?? evt.eventName;
                if (!selectedPrefixes.has(prefix)) return false;
            }
            if (tierFilter !== 'all') {
                const entryTier = catalog.find((entry) => entry.name === evt.eventName)?.tier;
                if (entryTier !== tierFilter) {
                    if (!(tierFilter === 'default' && entryTier === undefined)) return false;
                }
            }
            if (windowCutoff !== null) {
                const ts = Date.parse(evt.occurredAt);
                // Events without a parseable timestamp fall outside a strict window — drop them.
                if (!Number.isFinite(ts) || ts < windowCutoff) return false;
            }
            if (searchQuery.trim() !== '') {
                const query = searchQuery.toLowerCase();
                const matchesName = evt.eventName.toLowerCase().includes(query);
                const matchesActor = evt.actor?.toLowerCase().includes(query);
                const matchesPayload = evt.payload && JSON.stringify(evt.payload).toLowerCase().includes(query);
                if (searchScope === 'name' && !matchesName) return false;
                if (searchScope === 'actor' && !matchesActor) return false;
                if (searchScope === 'payload' && !matchesPayload) return false;
                if (searchScope === 'all' && !matchesName && !matchesActor && !matchesPayload) return false;
            }
            return true;
        });
    }, [events, selectedPrefixes, tierFilter, catalog, timeWindow, searchQuery, searchScope]);

    const clearFilters = useCallback(() => {
        setSelectedPrefixes(new Set());
        setSearchQuery('');
        setSearchScope('all');
        setTierFilter('all');
        setTimeWindow('all');
    }, []);

    const togglePrefix = useCallback((prefix: string) => {
        setSelectedPrefixes((prev) => {
            const next = new Set(prev);
            if (next.has(prefix)) next.delete(prefix);
            else next.add(prefix);
            return next;
        });
    }, []);

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load event history: {error}
            </div>
        );
    }
    if (events === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading event history…
            </div>
        );
    }

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
                <LivenessStrip status={sseStatus} rate={rate} shown={filteredEvents.length} total={events.length} />
            </div>

            {/* Filter bar (task 0224). Three rows: prefix pill chips (R1/R2),
                tier segmented toggle + time-window segmented toggle (R3/R5),
                search input + scope toggle + clear + inline count (R4/R6/R7). */}
            <div className="px-4 py-2 border-b border-spur-border bg-base-100 shrink-0 flex flex-col gap-2">
                {/* R1/R2: prefix pill chips — multi-select, colored to match the table. */}
                <fieldset
                    className="flex flex-wrap items-center gap-1.5 border-0 p-0 m-0"
                    aria-label="Filter by prefix"
                >
                    <legend className="sr-only">Filter by prefix</legend>
                    {prefixOptions.map((prefix) => {
                        const active = selectedPrefixes.has(prefix);
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
                        value={tierFilter}
                        onChange={setTierFilter}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: 'default', label: 'Default' },
                            { value: 'diagnostic', label: 'Diagnostic' },
                        ]}
                    />
                    {/* R5: time-window quick filter. */}
                    <SegmentedToggle
                        label="Window"
                        value={timeWindow}
                        onChange={setTimeWindow}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: '30s', label: '30s' },
                            { value: '5m', label: '5m' },
                        ]}
                    />
                    {/* R4: search input with inline scope selector. */}
                    <div className="flex items-center gap-1 flex-1 min-w-[220px]">
                        <select
                            value={searchScope}
                            onChange={(e) => setSearchScope(e.target.value as typeof searchScope)}
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
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="flex-1 min-w-[120px] input-sm"
                            aria-label={`Search ${searchScope}`}
                        />
                    </div>
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
                        {filteredEvents.length} of {events.length}
                    </span>
                </div>
            </div>
            {filteredEvents.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic flex-1 overflow-y-auto">
                    {events.length === 0
                        ? 'No system events yet. New events from the planning bus will appear here in real time.'
                        : 'No events match the active filters.'}
                </div>
            ) : (
                <SystemEventsTable rows={filteredEvents} catalog={catalog} />
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
 *   - Filtered count (R3): "N of M shown" where M is the loaded total.
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
}: {
    status: SseStatus;
    rate: number;
    shown: number;
    total: number;
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

    // Pulse keyframe only on the "live" dot — the connecting and errored
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
                {shown} of {total} shown
            </span>
        </div>
    );
}

/**
 * useMediaQuery — narrow-viewport detection for the responsive table
 * collapse (task 0225 R1). SSR-safe: defaults to `false` so the server
 * render and the first client render match; updates after mount.
 */
function useMediaQuery(query: string): boolean {
    // useSyncExternalStore is not available — fall back to a state+listener
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
 * Layout: 5 columns (Time | Event | Actor | Prefix | Tier) with a sticky
 * `<thead>` (R3) and compact rows (~28px) so at least 20 rows are visible
 * on a standard viewport (R2). Each row is a single click/keyboard target
 * that toggles an expanded panel below showing the typed EventDetails
 * renderer output + RawPayloadView — no duplication of detail rendering (R9).
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

    // R1 (task 0225): under 640px the table collapses to a 2-column stacked
    // layout (Time | Event + Actor). The Prefix / Tier columns are hidden
    // and the Event cell stacks the actor below the event name so the row
    // never exceeds the viewport width.
    const isCompact = useMediaQuery('(max-width: 639px)');

    return (
        <section className="flex-1 overflow-y-auto" data-system-events-tab aria-label="System events">
            <table className="w-full text-xs border-separate border-spacing-0 table-fixed">
                <colgroup>
                    <col className={isCompact ? 'w-24' : 'w-44'} />
                    <col />
                    {!isCompact && <col className="w-32" />}
                    {!isCompact && <col className="w-24" />}
                    {!isCompact && <col className="w-24" />}
                </colgroup>
                <thead className="sticky top-0 z-10 bg-base-200">
                    <tr className="text-left text-spur-text-muted uppercase tracking-wide text-[10px]">
                        <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                            Time
                        </th>
                        <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                            Event
                        </th>
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Actor
                            </th>
                        )}
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Prefix
                            </th>
                        )}
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Tier
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
 * with the typed detail summary from the EventDetails renderers (R8) —
 * replacing the former row-expand interaction. Time is shown in local
 * "MMM D HH:mm:ss" format without the year.
 */
function EventTableRow({ event, tier, compact }: { event: SystemEventRow; tier: string; compact: boolean }) {
    const prefix = event.prefix ?? event.eventName.split('.')[0] ?? event.eventName;
    const summary = useMemo(
        () => buildTooltipSummary(event.eventName, event.payload, event.renderer),
        [event.eventName, event.payload, event.renderer],
    );
    const colorClass = getPrefixColor(prefix);

    return (
        <tr className="group hover:bg-base-200/60 transition-colors" style={{ height: compact ? undefined : 28 }}>
            <td className="px-3 py-1 border-b border-spur-border/40 font-mono text-spur-text-muted whitespace-nowrap align-top">
                {formatLocalTime(event.occurredAt)}
            </td>
            <td className="px-3 py-1 border-b border-spur-border/40 relative align-top">
                <div className="flex flex-col gap-0.5">
                    <span className={`font-mono font-semibold break-all ${colorClass}`}>{event.eventName}</span>
                    {compact && event.actor && (
                        <span className="text-[10px] text-spur-text-muted">by {event.actor}</span>
                    )}
                </div>
                {summary && (
                    <div
                        role="tooltip"
                        className="pointer-events-none absolute left-0 top-full mt-1 z-20 hidden group-hover:block bg-base-300 border border-spur-border rounded shadow-lg p-2 text-[11px] text-spur-text min-w-[180px] max-w-[min(360px,90vw)] whitespace-normal"
                    >
                        <dl className="space-y-0.5">
                            {summary.map((row) => (
                                <div key={row.label} className="flex gap-2">
                                    <dt className="text-spur-text-muted shrink-0">{row.label}:</dt>
                                    <dd className="font-mono break-all">{row.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                )}
            </td>
            {!compact && (
                <td className="px-3 py-0 border-b border-spur-border/40 text-spur-text-muted whitespace-nowrap align-top">
                    {event.actor ?? '—'}
                </td>
            )}
            {!compact && (
                <td className="px-3 py-0 border-b border-spur-border/40 font-mono align-top">
                    <span className={colorClass}>{prefix}</span>
                </td>
            )}
            {!compact && (
                <td className="px-3 py-0 border-b border-spur-border/40 text-spur-text-muted align-top">{tier}</td>
            )}
        </tr>
    );
}

/**
 * Three-button segmented toggle (task 0224 R3 / R5). Used twice in the
 * filter bar: tier filter (All | Default | Diagnostic) and time-window
 * filter (All | 30s | 5m).
 *
 * Built as a `role="group"` with a visually-hidden label and three
 * `<button role="radio" aria-checked>` children — keyboard users can tab to
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
