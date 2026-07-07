import { type ReactNode, useEffect, useState } from 'react';
import { Badge, Card, CardBody, Input, Loading, Select } from '@/ui';
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

const HISTORY_URL = `${resolveApiUrl()}/events/history`;
const SSE_URL = `${resolveApiUrl()}/events/planning`;
const HISTORY_LIMIT = 100;

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

interface DetailContext {
    eventName: string;
    payload: Record<string, unknown>;
}

type DetailRenderer = (ctx: DetailContext) => ReactNode;

function DetailRow({ label, value }: { label: string; value: unknown }) {
    if (value === undefined || value === null || value === '') return null;
    return (
        <div>
            <span className="font-semibold text-spur-text">{label}:</span>{' '}
            <span className="font-mono text-[11px] text-spur-text">{formatVal(value)}</span>
        </div>
    );
}

function renderGenericDetails({ payload }: DetailContext) {
    const entries = Object.entries(payload).filter(([key]) => key !== 'entity' && key !== 'event' && key !== 'at');
    if (entries.length === 0) return null;
    return (
        <div className="text-[11px] mt-1 space-y-0.5 text-spur-text-muted">
            {entries.map(([key, value]) => (
                <div key={key} className="flex gap-1.5">
                    <span className="font-mono font-semibold text-spur-text w-24 shrink-0">{key}:</span>
                    <span className="font-mono break-all">{formatVal(value)}</span>
                </div>
            ))}
        </div>
    );
}

function renderPlanningDetails({ payload }: DetailContext) {
    const entity = payload.entity as Record<string, unknown> | undefined;
    const metadata = payload.data as Record<string, unknown> | undefined;
    const entityLabel = entity ? `${formatVal(entity.kind)}:${formatVal(entity.id)}` : payload.entityId || payload.wbs;
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Entity" value={entityLabel} />
            {(payload.from !== undefined || payload.to !== undefined) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-spur-text">Transition:</span>
                    <span className="font-mono bg-base-300 px-1 rounded text-spur-text">
                        {formatVal(payload.from ?? 'none')}
                    </span>
                    <span className="text-spur-text-muted">-&gt;</span>
                    <span className="font-mono bg-base-300 px-1 rounded text-spur-text">
                        {formatVal(payload.to ?? 'none')}
                    </span>
                </div>
            )}
            {metadata && Object.keys(metadata).length > 0 && <DetailRow label="Metadata" value={metadata} />}
        </div>
    );
}

function renderWorkflowDetails({ payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Workflow" value={payload.workflowName} />
            <DetailRow label="Run ID" value={payload.runId} />
            <DetailRow label="Phase" value={payload.phase} />
            <DetailRow label="Status" value={payload.status} />
            <DetailRow label="Action" value={payload.actionId} />
            <DetailRow label="Node" value={payload.node} />
            <DetailRow label="Kind" value={payload.kind} />
            <DetailRow
                label="Duration"
                value={payload.durationMs !== undefined ? `${payload.durationMs}ms` : undefined}
            />
            {(payload.from !== undefined || payload.to !== undefined) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-spur-text">Transition:</span>
                    <span className="font-mono bg-base-300 px-1 rounded text-spur-text">
                        {formatVal(payload.from ?? 'none')}
                    </span>
                    <span className="text-spur-text-muted">-&gt;</span>
                    <span className="font-mono bg-base-300 px-1 rounded text-spur-text">
                        {formatVal(payload.to ?? 'none')}
                    </span>
                </div>
            )}
        </div>
    );
}

function renderQueueDetails({ eventName, payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Job Kind" value={payload.kind ?? payload.type ?? payload.name} />
            <DetailRow label="Job ID" value={payload.jobId ?? payload.id} />
            <DetailRow
                label="Duration"
                value={payload.durationMs !== undefined ? `${payload.durationMs}ms` : undefined}
            />
            {eventName.endsWith('.failed') && payload.error !== undefined && (
                <div className="text-error mt-1 bg-error/5 p-1.5 rounded border border-error/20 font-mono text-[10px] break-all">
                    {formatVal(payload.error)}
                </div>
            )}
        </div>
    );
}

function renderMessageDetails({ payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Message ID" value={payload.msgId} />
            <DetailRow label="Sender" value={payload.fromId ?? payload.from ?? payload.senderId} />
            <DetailRow label="Recipient" value={payload.toId ?? payload.to ?? payload.recipientId} />
            <DetailRow label="Thread" value={payload.threadId} />
        </div>
    );
}

function renderProcessDetails({ payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Agent ID" value={payload.agentId} />
            <DetailRow label="PID" value={payload.pid} />
            <DetailRow label="Exit Code" value={payload.exitCode} />
        </div>
    );
}

function renderAgentDetails({ payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Agent" value={payload.agent ?? payload.agentId ?? payload.agentType} />
            <DetailRow label="Operation" value={payload.operation} />
            <DetailRow label="Label" value={payload.label} />
            <DetailRow label="PID" value={payload.pid} />
            <DetailRow label="Exit" value={payload.exitCode} />
            <DetailRow
                label="Duration"
                value={payload.durationMs !== undefined ? `${payload.durationMs}ms` : undefined}
            />
            <DetailRow label="OK" value={payload.ok} />
            {payload.error !== undefined && (
                <div className="text-error mt-1 bg-error/5 p-1.5 rounded border border-error/20 font-mono text-[10px] break-all">
                    {formatVal(payload.error)}
                </div>
            )}
        </div>
    );
}

function renderRuleDetails({ payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Rule ID" value={payload.ruleId} />
            <DetailRow label="Findings" value={payload.findings} />
            <DetailRow
                label="Duration"
                value={payload.durationMs !== undefined ? `${payload.durationMs}ms` : undefined}
            />
            <DetailRow
                label="Index"
                value={payload.index !== undefined ? `${payload.index}/${payload.total}` : undefined}
            />
            {payload.error !== undefined && (
                <div className="text-error mt-1 bg-error/5 p-1.5 rounded border border-error/20 font-mono text-[10px] break-all">
                    {formatVal(payload.error)}
                </div>
            )}
        </div>
    );
}

function renderBusDetails({ payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Event" value={payload.event ?? payload.kind} />
            <DetailRow label="Handlers" value={payload.handlerCount} />
            <DetailRow
                label="Duration"
                value={payload.durationMs !== undefined ? `${payload.durationMs}ms` : undefined}
            />
        </div>
    );
}

function renderApiDetails({ payload }: DetailContext) {
    return (
        <div className="text-xs space-y-1 mt-1 text-spur-text-muted">
            <DetailRow label="Method" value={payload.method} />
            <DetailRow label="URL" value={payload.url} />
            <DetailRow label="Status" value={payload.status} />
            <DetailRow label="Error" value={payload.error} />
        </div>
    );
}

const DETAIL_RENDERERS: Record<string, DetailRenderer> = {
    planning: renderPlanningDetails,
    queue: renderQueueDetails,
    scheduler: renderQueueDetails,
    message: renderMessageDetails,
    process: renderProcessDetails,
    agent: renderAgentDetails,
    rule: renderRuleDetails,
    bus: renderBusDetails,
    api: renderApiDetails,
    'workflow-run': renderWorkflowDetails,
    'workflow-phase': renderWorkflowDetails,
    'workflow-transition': renderWorkflowDetails,
    'workflow-action': renderWorkflowDetails,
    'workflow-hitl': renderWorkflowDetails,
    'workflow-guard': renderWorkflowDetails,
    'workflow-custom': renderWorkflowDetails,
};

function EventDetails({
    eventName,
    payload,
    renderer,
}: {
    eventName: string;
    payload: Record<string, unknown> | null;
    renderer?: string;
}) {
    if (!payload || Object.keys(payload).length === 0) return null;
    const fallbackRenderer = eventName.startsWith('task.') || eventName.startsWith('feature.') ? 'planning' : 'generic';
    const render = DETAIL_RENDERERS[renderer ?? fallbackRenderer] ?? renderGenericDetails;
    return render({ eventName, payload });
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
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [tierFilter, setTierFilter] = useState<string>('all');

    // Initial history fetch.
    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetch(`${HISTORY_URL}?limit=${HISTORY_LIMIT}`, { signal: controller.signal });
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
        const es = new EventSource(SSE_URL);
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
            } catch {
                // Drop malformed frames silently — a bad row must not break the live tail.
            }
        };
        return () => es.close();
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

    const prefixOptions = Array.from(
        new Set([
            ...catalog.map((entry) => entry.prefix),
            ...events.map((evt) => evt.prefix ?? evt.eventName.split('.')[0] ?? evt.eventName),
        ]),
    ).sort();

    const filteredEvents = events.filter((evt) => {
        if (categoryFilter !== 'all') {
            const prefix = evt.prefix ?? evt.eventName.split('.')[0] ?? evt.eventName;
            if (prefix !== categoryFilter) {
                return false;
            }
        }
        if (tierFilter !== 'all') {
            const entryTier = catalog.find((entry) => entry.name === evt.eventName)?.tier;
            if (entryTier !== tierFilter) {
                // Unknown tier (e.g. legacy event) is treated as 'default' so
                // the diagnostic filter is opt-in only — default events stay
                // visible even when the catalog lacks the tier field.
                if (!(tierFilter === 'default' && entryTier === undefined)) {
                    return false;
                }
            }
        }
        if (searchQuery.trim() !== '') {
            const query = searchQuery.toLowerCase();
            const matchesName = evt.eventName.toLowerCase().includes(query);
            const matchesActor = evt.actor?.toLowerCase().includes(query);
            const matchesPayload = evt.payload && JSON.stringify(evt.payload).toLowerCase().includes(query);
            if (!matchesName && !matchesActor && !matchesPayload) {
                return false;
            }
        }
        return true;
    });

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0 flex items-center justify-between">
                <div>
                    <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">System Events</span>
                    <span className="ml-2 text-xs text-spur-text-muted">newest first · live tail</span>
                </div>
            </div>

            {/* Filtering toolbar */}
            <div className="px-4 py-2 border-b border-spur-border bg-base-100 shrink-0 flex flex-wrap gap-2 items-center">
                <Select
                    size="sm"
                    variant="bordered"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-44"
                >
                    <option value="all">All Prefixes</option>
                    {prefixOptions.map((prefix) => (
                        <option key={prefix} value={prefix}>
                            {prefix}.*
                        </option>
                    ))}
                </Select>
                <Select
                    size="sm"
                    variant="bordered"
                    value={tierFilter}
                    onChange={(e) => setTierFilter(e.target.value)}
                    className="w-44"
                    title="Filter by visibility tier; diagnostic events require SPUR_DIAGNOSTIC_EVENTS on the server."
                >
                    <option value="all">All Tiers</option>
                    <option value="default">Default only</option>
                    <option value="diagnostic">Diagnostic only</option>
                </Select>
                <Input
                    size="sm"
                    variant="bordered"
                    placeholder="Search by event name, actor, or payload..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="flex-1 min-w-[200px] input-sm"
                />
            </div>
            {filteredEvents.length === 0 ? (
                <div className="p-4 text-sm text-spur-text-muted italic flex-1 overflow-y-auto">
                    {events.length === 0
                        ? 'No system events yet. New events from the planning bus will appear here in real time.'
                        : 'No events match the active filters.'}
                </div>
            ) : (
                <ul className="flex-1 overflow-y-auto p-2 space-y-2" data-system-events-tab>
                    {filteredEvents.map((evt) => (
                        <li key={evt.id}>
                            <Card variant="compact" className="bg-base-200 border border-spur-border">
                                <CardBody className="p-3 gap-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant="outline" size="xs">
                                            {evt.eventName}
                                        </Badge>
                                        {evt.actor && (
                                            <span className="text-xs text-spur-text-muted">by {evt.actor}</span>
                                        )}
                                        <span
                                            className="text-[10px] text-spur-text-muted ml-auto font-mono"
                                            title={evt.occurredAt}
                                        >
                                            {evt.occurredAt}
                                        </span>
                                    </div>

                                    {/* Human-readable formatted details */}
                                    <EventDetails
                                        eventName={evt.eventName}
                                        payload={evt.payload}
                                        renderer={evt.renderer}
                                    />

                                    {/* Collapsible raw JSON */}
                                    {evt.payload !== null && Object.keys(evt.payload).length > 0 && (
                                        <RawPayloadView payload={evt.payload} />
                                    )}
                                </CardBody>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function RawPayloadView({ payload }: { payload: Record<string, unknown> }) {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="mt-1.5 border border-spur-border/40 rounded overflow-hidden">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full text-left text-[10px] text-spur-text-muted font-semibold py-1 px-3 bg-base-300/40 flex items-center justify-between cursor-pointer border-none hover:bg-base-300/60 transition-colors"
                style={{ userSelect: 'none' }}
            >
                <span>Raw JSON Payload</span>
                <span className="font-mono text-[8px]">{isOpen ? '▼' : '▶'}</span>
            </button>
            {isOpen && (
                <pre className="text-[10px] text-spur-text-muted bg-base-300/80 p-2 overflow-x-auto m-0 leading-tight border-t border-spur-border/40">
                    {JSON.stringify(payload, null, 2)}
                </pre>
            )}
        </div>
    );
}
