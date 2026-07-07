/** Event payload retention policy before persistence or streaming. */
export type SystemEventPayloadPolicy = 'metadata-only' | 'redacted' | 'raw-safe';

/** Registered source family for a board-observable system event. */
export type SystemEventSource = 'planning' | 'queue' | 'scheduler' | 'message' | 'process' | 'workflow' | 'rule';

/** Public catalog entry consumed by the tap, SSE stream, and Board filters. */
export interface SystemEventCatalogEntry {
    /** Full event name emitted on the canonical server SystemEventBus. */
    name: string;
    /** Namespace used for filters; normally the segment before the first dot. */
    prefix: string;
    /** Producer family, used for audit/readability. */
    source: SystemEventSource;
    /** Whether the event is written to `system_events`. */
    persisted: boolean;
    /** Whether the event is pushed over `/api/events/planning`. */
    streamed: boolean;
    /** Payload safety policy applied before persistence/streaming. */
    payloadPolicy: SystemEventPayloadPolicy;
    /** UI renderer key for the System Events detail registry. */
    renderer: string;
}

function event(
    name: string,
    source: SystemEventSource,
    renderer: string,
    payloadPolicy: SystemEventPayloadPolicy = 'metadata-only',
): SystemEventCatalogEntry {
    return {
        name,
        prefix: name.split('.')[0] ?? name,
        source,
        persisted: true,
        streamed: true,
        payloadPolicy,
        renderer,
    };
}

/**
 * Board-observable system-event catalog.
 *
 * This is the single source for events persisted by the `system_events` tap and
 * streamed over `/api/events/planning`. Generic EventBus instances remain local
 * primitives; only events registered here are part of the Board contract.
 */
export const SYSTEM_EVENT_CATALOG = [
    event('task.created', 'planning', 'planning'),
    event('task.updated', 'planning', 'planning'),
    event('task.transitioned', 'planning', 'planning'),
    event('feature.created', 'planning', 'planning'),
    event('feature.updated', 'planning', 'planning'),
    event('feature.transitioned', 'planning', 'planning'),

    event('queue.consumer.started', 'queue', 'queue'),
    event('queue.consumer.stopped', 'queue', 'queue'),
    event('queue.job.enqueued', 'queue', 'queue'),
    event('queue.job.completed', 'queue', 'queue'),
    event('queue.job.failed', 'queue', 'queue'),
    event('queue.job.retrying', 'queue', 'queue'),
    event('queue.stats', 'queue', 'queue'),
    event('scheduler.job.executed', 'scheduler', 'scheduler'),

    // Message events are metadata-only. Message bodies stay in inbox storage.
    event('message.sent', 'message', 'message'),
    event('message.replied', 'message', 'message'),

    event('process.spawned', 'process', 'process'),
    event('process.exited', 'process', 'process'),
    event('process.stopped', 'process', 'process'),

    event('workflow.run.started', 'workflow', 'workflow-run'),
    event('workflow.run.finalized', 'workflow', 'workflow-run'),
    event('workflow.phase', 'workflow', 'workflow-phase'),
    event('workflow.transition', 'workflow', 'workflow-transition'),
    event('workflow.action.started', 'workflow', 'workflow-action'),
    event('workflow.action.finished', 'workflow', 'workflow-action'),
    event('workflow.hitl.ask', 'workflow', 'workflow-hitl', 'redacted'),
    event('workflow.hitl.response', 'workflow', 'workflow-hitl', 'redacted'),
] as const satisfies readonly SystemEventCatalogEntry[];

/** Union of all system event names registered in {@link SYSTEM_EVENT_CATALOG}. */
export type SystemEventName = (typeof SYSTEM_EVENT_CATALOG)[number]['name'];

/** Flat list of every event name in {@link SYSTEM_EVENT_CATALOG}, in declaration order. */
export const SYSTEM_EVENT_NAMES: string[] = SYSTEM_EVENT_CATALOG.map((entry) => entry.name);
/** Subset of {@link SYSTEM_EVENT_NAMES} whose entries are flagged `persisted`. */
export const SYSTEM_EVENT_PERSISTED_NAMES: string[] = SYSTEM_EVENT_CATALOG.filter((entry) => entry.persisted).map(
    (entry) => entry.name,
);
/** Subset of {@link SYSTEM_EVENT_NAMES} whose entries are flagged `streamed`. */
export const SYSTEM_EVENT_STREAMED_NAMES: string[] = SYSTEM_EVENT_CATALOG.filter((entry) => entry.streamed).map(
    (entry) => entry.name,
);
/** Unique event-name prefixes used to bucket events in {@link SYSTEM_EVENT_CATALOG}. */
export const SYSTEM_EVENT_PREFIXES: string[] = Array.from(new Set(SYSTEM_EVENT_CATALOG.map((entry) => entry.prefix)));

/** Compatibility alias while older imports migrate to SYSTEM_EVENT_NAMES. */
export const PLANNING_EVENT_NAMES = SYSTEM_EVENT_NAMES;

/** Public metadata safe to return from API responses. */
export interface SystemEventCatalogMetadata {
    name: string;
    prefix: string;
    source: SystemEventSource;
    renderer: string;
}

/** Public-facing projection of {@link SYSTEM_EVENT_CATALOG} with payload fields stripped for API responses. */
export const SYSTEM_EVENT_CATALOG_METADATA: SystemEventCatalogMetadata[] = SYSTEM_EVENT_CATALOG.map(
    ({ name, prefix, source, renderer }) => ({ name, prefix, source, renderer }),
);

/** Look up the catalog entry for a given event name; returns `undefined` when the name is unregistered. */
export function systemEventCatalogEntry(name: string): SystemEventCatalogEntry | undefined {
    return SYSTEM_EVENT_CATALOG.find((entry) => entry.name === name);
}

/** Apply the catalog payload policy before persistence or streaming. */
export function normalizeSystemEventPayload(
    entry: SystemEventCatalogEntry,
    eventPayload: unknown,
): Record<string, unknown> | null {
    if (eventPayload === null || eventPayload === undefined) return null;
    if (typeof eventPayload !== 'object') return { value: eventPayload };
    const source = eventPayload as Record<string, unknown>;
    if (entry.payloadPolicy === 'raw-safe') return { ...source };

    const redacted = { ...source };
    for (const key of ['body', 'content', 'message', 'prompt', 'query', 'response', 'value']) {
        if (key in redacted) {
            redacted[key] = '[redacted]';
        }
    }
    return redacted;
}
