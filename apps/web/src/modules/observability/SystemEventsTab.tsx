import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

/** Wire shape of a single system event row from the history endpoint. */
export interface SystemEventRow {
    id: string;
    eventName: string;
    occurredAt: string;
    actor: string | null;
    prefix?: string;
    renderer?: string;
    payload: Record<string, unknown> | null;
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
        return { ...base, payload: null, ...optionalCorrelation(runId, entityKind, entityId, sequence) };
    }
    if (typeof payload !== 'object') return null;
    return {
        ...base,
        payload: payload as Record<string, unknown>,
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
    const payloadRecord = payload as Record<string, unknown> | null;
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
        ...optionalCorrelation(runId, entityKind, entityId, sequence),
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

/**
 * R3 (task 0375): render explicitly-unavailable usage as the literal token
 * `unavailable` - never `0`, never `-`, never blank. Absent/null/undefined/''/
 * non-finite numeric inputs all yield `'unavailable'`. This is the load-bearing
 * invariant for R3.
 */
export function formatAvailability(value: unknown): string {
    if (value === null || value === undefined) return 'unavailable';
    if (typeof value === 'string') {
        if (value.length === 0) return 'unavailable';
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return 'unavailable';
        return String(value);
    }
    if (typeof value === 'boolean') return String(value);
    return 'unavailable';
}

/**
 * Identity / outcome fields for the System Events table row.
 *
 * Queue and scheduler events rarely carry `runId` / `outcome` on the envelope —
 * they use `jobId` + `type` / `name` + event-name suffix instead (JobsTab already
 * understands this shape). Without these fallbacks every queue.* row shows four
 * stacked "unavailable" cells and blows the narrow Run/Outcome columns.
 */
export interface EventRowIdentity {
    /** Primary correlator: workflow runId, else queue jobId. */
    run: string;
    /** Secondary label: actionId/node, else job type / scheduler name. */
    action: string;
    /** Terminal/status label: payload outcome, else derived from event suffix. */
    outcome: string;
    /** Compact duration or null when absent. */
    duration: string | null;
}

/** Map lifecycle event-name suffixes to a short outcome label. */
function deriveOutcomeFromEventName(eventName: string): string | null {
    const suffix = eventName.split('.').pop() ?? '';
    switch (suffix) {
        case 'enqueued':
            return 'pending';
        case 'completed':
            return 'completed';
        case 'failed':
            return 'failed';
        case 'retrying':
            return 'retrying';
        case 'executed':
            return 'executed';
        case 'started':
            return 'started';
        case 'stopped':
            return 'stopped';
        case 'spawned':
            return 'spawned';
        case 'exited':
            return 'exited';
        default:
            return null;
    }
}

/** Token kinds produced by {@link tokenizeJson} for payload tooltips. */
export type JsonTokenKind = 'key' | 'string' | 'number' | 'keyword' | 'punct' | 'ws' | 'plain';

export interface JsonToken {
    id: string;
    kind: JsonTokenKind;
    text: string;
}

/**
 * Tokenize pretty-printed JSON for lightweight syntax highlighting.
 * Zero deps — keeps the tooltip free of Prism/shiki while still coloring keys,
 * strings, numbers, and keywords against the dark prettylights palette.
 */
export function tokenizeJson(json: string): JsonToken[] {
    const tokens: JsonToken[] = [];
    let i = 0;
    while (i < json.length) {
        const ch = json[i] ?? '';

        if (ch === '"') {
            let j = i + 1;
            while (j < json.length) {
                if (json[j] === '\\') {
                    j += 2;
                    continue;
                }
                if (json[j] === '"') {
                    j += 1;
                    break;
                }
                j += 1;
            }
            const text = json.slice(i, j);
            let k = j;
            while (k < json.length && /\s/.test(json[k] ?? '')) k += 1;
            const isKey = json[k] === ':';
            const kind = isKey ? 'key' : 'string';
            tokens.push({ id: `tok-${tokens.length}-${kind}`, kind, text });
            i = j;
            continue;
        }

        if (ch === '-' || (ch >= '0' && ch <= '9')) {
            let j = i + 1;
            while (j < json.length && /[0-9.eE+-]/.test(json[j] ?? '')) j += 1;
            tokens.push({ id: `tok-${tokens.length}-number`, kind: 'number', text: json.slice(i, j) });
            i = j;
            continue;
        }

        if (json.startsWith('true', i) || json.startsWith('null', i)) {
            tokens.push({ id: `tok-${tokens.length}-kw`, kind: 'keyword', text: json.slice(i, i + 4) });
            i += 4;
            continue;
        }
        if (json.startsWith('false', i)) {
            tokens.push({ id: `tok-${tokens.length}-kw`, kind: 'keyword', text: json.slice(i, i + 5) });
            i += 5;
            continue;
        }

        if ('{}[]:,'.includes(ch)) {
            tokens.push({ id: `tok-${tokens.length}-punct`, kind: 'punct', text: ch });
            i += 1;
            continue;
        }

        if (/\s/.test(ch)) {
            let j = i + 1;
            while (j < json.length && /\s/.test(json[j] ?? '')) j += 1;
            tokens.push({ id: `tok-${tokens.length}-ws`, kind: 'ws', text: json.slice(i, j) });
            i = j;
            continue;
        }

        tokens.push({ id: `tok-${tokens.length}-plain`, kind: 'plain', text: ch });
        i += 1;
    }
    return tokens;
}

const JSON_TOKEN_CLASS: Record<JsonTokenKind, string> = {
    key: 'json-tok-key',
    string: 'json-tok-string',
    number: 'json-tok-number',
    keyword: 'json-tok-keyword',
    punct: 'json-tok-punct',
    ws: '',
    plain: 'json-tok-plain',
};

/**
 * Pretty-print + tokenize a payload for the event-name hover tooltip.
 * Returns null when there is nothing useful to show.
 */
export function buildPayloadTooltip(payload: Record<string, unknown> | null): {
    text: string;
    tokens: JsonToken[];
} | null {
    if (!payload || Object.keys(payload).length === 0) return null;
    try {
        const text = JSON.stringify(payload, null, 2);
        return { text, tokens: tokenizeJson(text) };
    } catch {
        return null;
    }
}

/**
 * Extract display identity for a system-event row. Pure + exported for unit tests.
 */
export function extractEventRowIdentity(event: {
    eventName: string;
    runId?: string | null;
    payload: Record<string, unknown> | null;
}): EventRowIdentity {
    const payload = event.payload;
    const pickString = (...keys: string[]): string | undefined => {
        if (!payload) return undefined;
        for (const key of keys) {
            const value = payload[key];
            if (typeof value === 'string' && value.length > 0) return value;
        }
        return undefined;
    };

    // Run: indexed runId first; queue jobs use jobId as the durable correlator.
    const runRaw = event.runId && event.runId.length > 0 ? event.runId : pickString('jobId', 'runId');
    const run = formatAvailability(runRaw);

    // Action: workflow action identity, else job type / scheduler job name.
    const actionRaw = pickString('actionId', 'action', 'node', 'kind', 'type', 'name');
    const action = formatAvailability(actionRaw);

    // Outcome: explicit payload fields, else derive from the event-name suffix.
    const payloadOutcome = payload ? (payload.outcome ?? payload.status ?? payload.ok) : undefined;
    let outcome: string;
    if (payloadOutcome !== null && payloadOutcome !== undefined && payloadOutcome !== '') {
        outcome = formatAvailability(payloadOutcome);
    } else {
        const derived = deriveOutcomeFromEventName(event.eventName);
        outcome = derived ?? 'unavailable';
    }

    const duration = formatDuration(payload?.durationMs);
    return { run, action, outcome, duration };
}

/** Usage may be a scalar or a structured token/cost projection; absence is explicit. */
export function formatUsage(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'unavailable';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'unavailable';
    if (typeof value === 'string' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return 'unavailable';
        }
    }
    return 'unavailable';
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
            // R10 / design §2.2: first non-null of phase -> transition -> action
            // becomes a single labeled pair (not all three).
            const phase = pickString('phase');
            const transition = pickString('transition');
            const action = pickString('action', 'kind');
            if (phase) push('Phase', phase);
            else if (transition) push('Transition', transition);
            else if (action) push('Action', action);
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

    // R4 (task 0375): no 4-pair cap - the detail panel shows the full pair list.
    return summary.length > 0 ? summary : null;
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
 * Layout: 7 columns (Time | Event | Actor | Prefix | Tier | Run | Outcome) with
 * a sticky `<thead>` (R3) and compact rows (~28px) so at least 20 rows are
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

    // R1 (task 0225): under 640px the table collapses to a 2-column stacked
    // layout (Time | Event + Actor). The Prefix / Tier / Run / Outcome columns
    // are hidden and the Event cell stacks the actor + identity below the event
    // name so the row never exceeds the viewport width.
    const isCompact = useMediaQuery('(max-width: 639px)');

    return (
        <section className="flex-1 overflow-y-auto min-w-0" data-system-events-tab aria-label="System events">
            {/*
              table-fixed + min-w-0 keeps columns from shoving neighbors when a long
              jobId/runId appears. Run/Outcome are wider than the original w-28 so
              correlators truncate cleanly instead of wrapping into the next cell.
            */}
            <table className="w-full min-w-[720px] text-xs border-separate border-spacing-0 table-fixed">
                <colgroup>
                    <col className={isCompact ? 'w-24' : 'w-36'} />
                    {/* Event: fixed 20% so long names truncate instead of stealing Run/Outcome. */}
                    <col className="w-[20%]" />
                    {!isCompact && <col className="w-28" />}
                    {!isCompact && <col className="w-20" />}
                    {!isCompact && <col className="w-20" />}
                    {/* Run: doubled from w-40 → w-80 so jobId/runId correlators fit. */}
                    {!isCompact && <col className="w-80" />}
                    {!isCompact && <col className="w-32" />}
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
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Run
                            </th>
                        )}
                        {!isCompact && (
                            <th scope="col" className="font-semibold px-3 py-1.5 border-b border-spur-border">
                                Outcome
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

function EventTableRow({ event, tier, compact }: { event: SystemEventRow; tier: string; compact: boolean }) {
    const prefix = event.prefix ?? event.eventName.split('.')[0] ?? event.eventName;
    const summary = useMemo(
        () => buildTooltipSummary(event.eventName, event.payload, event.renderer),
        [event.eventName, event.payload, event.renderer],
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

    // R2/R3: identity/outcome/usage — absent => 'unavailable', never zero/blank.
    // Queue/scheduler events use jobId/type/name; extractEventRowIdentity maps those.
    const identity = useMemo(
        () => extractEventRowIdentity({ eventName: event.eventName, runId: event.runId, payload: event.payload }),
        [event.eventName, event.runId, event.payload],
    );
    const { run: runId, action: actionId, outcome, duration } = identity;
    const usage = formatUsage(event.payload?.usage);
    const entityLabel =
        event.entityKind && event.entityId
            ? `${event.entityKind}:${event.entityId}`
            : formatAvailability(event.entityKind ?? event.entityId);
    const actorLabel = event.actor && event.actor.length > 0 ? event.actor : 'unavailable';

    /** Pretty-printed + tokenized payload for the event-name hover tooltip. */
    const payloadTooltip = useMemo(() => buildPayloadTooltip(event.payload), [event.payload]);
    const tooltipOpen = Boolean(payloadTooltip && (hoveringName || pinned));

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
            if (!payloadTooltip) return;
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
        [event.id, payloadTooltip, clearHoverLeaveTimer],
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

    const tooltipNode =
        payloadTooltip && tooltipOpen ? (
            <div
                ref={tooltipRef}
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
                onPointerDown={(e) => {
                    // Keep select/copy clicks inside the bubble from unlocking.
                    if (pinned) e.stopPropagation();
                }}
            >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="text-[10px] text-[#8b949e] font-sans">
                        payload
                        {pinned
                            ? ' · select to copy · Esc / outside click to close'
                            : ' · click event name or Pin to lock for copy'}
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
                <pre
                    className="font-mono text-[10px] overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-all m-0 leading-relaxed select-text"
                    data-testid="system-event-payload-json"
                >
                    {payloadTooltip.tokens.map((tok) =>
                        tok.kind === 'ws' ? (
                            <span key={tok.id}>{tok.text}</span>
                        ) : (
                            <span key={tok.id} className={JSON_TOKEN_CLASS[tok.kind]}>
                                {tok.text}
                            </span>
                        ),
                    )}
                </pre>
            </div>
        ) : null;

    return (
        <>
            <tr className="group hover:bg-base-200/60 transition-colors" style={{ height: compact ? undefined : 28 }}>
                <td className="px-3 py-1 border-b border-spur-border/40 font-mono text-spur-text-muted whitespace-nowrap align-middle">
                    {formatLocalTime(event.occurredAt)}
                </td>
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
                                    aria-label={`Payload for ${event.eventName}. Hover to preview; click to pin for select and copy.`}
                                    onMouseEnter={() => {
                                        clearHoverLeaveTimer();
                                        setHoveringName(true);
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
                                        if (!payloadTooltip) return;
                                        if (pinned) return;
                                        pinFromNameElement(e.currentTarget, e.clientX, e.clientY);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            if (!payloadTooltip || pinned) return;
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
                                {event.actor && <span className="truncate">by {event.actor}</span>}
                                <span className="truncate" title={`run ${runId}`}>
                                    run: {runId}
                                </span>
                                {actionId !== 'unavailable' && (
                                    <span className="truncate" title={`action ${actionId}`}>
                                        action: {actionId}
                                    </span>
                                )}
                                <span className="truncate">
                                    outcome: {outcome}
                                    {duration ? ` · ${duration}` : ''}
                                </span>
                            </div>
                        )}
                    </div>
                </td>
                {!compact && (
                    <td
                        className="px-3 py-1 border-b border-spur-border/40 text-spur-text-muted whitespace-nowrap align-middle truncate"
                        title={actorLabel}
                    >
                        {actorLabel}
                    </td>
                )}
                {!compact && (
                    <td className="px-3 py-1 border-b border-spur-border/40 font-mono align-middle">
                        <span className={colorClass}>{prefix}</span>
                    </td>
                )}
                {!compact && (
                    <td className="px-3 py-1 border-b border-spur-border/40 text-spur-text-muted align-middle">
                        {tier}
                    </td>
                )}
                {!compact && (
                    <td className="px-3 py-1 border-b border-spur-border/40 font-mono text-[10px] text-spur-text-muted align-middle min-w-0">
                        {/*
                          Single truncated correlator on the row; secondary action/type
                          only when present. Avoids the double "run: unavailable /
                          action: unavailable" stack that overflowed w-28 columns.
                        */}
                        <div className="truncate" title={runId}>
                            {runId}
                        </div>
                        {actionId !== 'unavailable' && (
                            <div className="truncate text-spur-text-muted/70" title={actionId}>
                                {actionId}
                            </div>
                        )}
                    </td>
                )}
                {!compact && (
                    <td className="px-3 py-1 border-b border-spur-border/40 font-mono text-[10px] text-spur-text-muted align-middle whitespace-nowrap">
                        <span title={outcome}>{outcome}</span>
                        {duration && <span className="text-spur-text-muted/60"> · {duration}</span>}
                    </td>
                )}
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={compact ? 2 : 7} className="px-3 py-2 border-b border-spur-border/40 bg-base-300/40">
                        <section
                            id={`detail-${event.id}`}
                            aria-label={`Detail for ${event.eventName}`}
                            onKeyDown={onKeyDown}
                            tabIndex={-1}
                            className="flex flex-col gap-2 text-[11px] text-spur-text max-w-full"
                        >
                            {/* Correlation columns (R2): run, entity, sequence. */}
                            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px]">
                                <span>
                                    <span className="text-spur-text-muted">run:</span> {runId}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">action:</span> {actionId}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">entity:</span> {entityLabel}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">sequence:</span>{' '}
                                    {formatAvailability(event.sequence)}
                                </span>
                                {duration && (
                                    <span>
                                        <span className="text-spur-text-muted">duration:</span> {duration}
                                    </span>
                                )}
                                <span>
                                    <span className="text-spur-text-muted">outcome:</span> {outcome}
                                </span>
                                <span>
                                    <span className="text-spur-text-muted">usage:</span> {usage}
                                </span>
                            </div>
                            {/* Renderer-aware pair list (no 4-cap - R4). */}
                            {summary && (
                                <dl className="space-y-0.5">
                                    {summary.map((row) => (
                                        <div key={row.label} className="flex gap-2">
                                            <dt className="text-spur-text-muted shrink-0">{row.label}:</dt>
                                            <dd className="font-mono break-all">{row.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                            {/* Full redacted envelope (raw JSON). Redaction is server-side. */}
                            <div className="border-t border-spur-border/40 pt-1">
                                <div className="text-spur-text-muted text-[10px] mb-0.5">payload (redacted):</div>
                                <pre className="font-mono text-[10px] text-spur-text-muted overflow-x-auto whitespace-pre-wrap break-all">
                                    {JSON.stringify(event.payload, null, 2)}
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
