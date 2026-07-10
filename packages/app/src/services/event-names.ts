/** Event payload retention policy before persistence or streaming. */
export type SystemEventPayloadPolicy = 'metadata-only' | 'redacted' | 'raw-safe';

/** Registered source family for a board-observable system event. */
export type SystemEventSource =
    | 'planning'
    | 'queue'
    | 'scheduler'
    | 'message'
    | 'process'
    | 'workflow'
    | 'rule'
    | 'agent'
    | 'bus'
    | 'api';
/** Visibility tier for board consumers. Diagnostic entries only persist/stream when the runtime toggle is on. */
export type SystemEventTier = 'default' | 'diagnostic';

/** Public catalog entry consumed by the tap, SSE stream, and Board filters. */
export interface SystemEventCatalogEntry {
    /** Full event name emitted on the canonical server SystemEventBus. */
    name: string;
    /** Namespace used for filters; normally the segment before the first dot. */
    prefix: string;
    /** Producer family, used for audit/readability. */
    source: SystemEventSource;
    /** Visibility tier. Diagnostic entries only persist/stream when the runtime toggle is on. */
    tier: SystemEventTier;
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
    tier: SystemEventTier = 'default',
): SystemEventCatalogEntry {
    return {
        name,
        prefix: name.split('.')[0] ?? name,
        source,
        tier,
        // The catalog flags describe *capability*. The runtime consults
        // `tier` to decide whether to actually persist/stream — the tap
        // and SSE module don't rely on these flags, only on `tier` and
        // the runtime configuration (SPUR_DIAGNOSTIC_EVENTS).
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
 *
 * Tier rules:
 *
 * - `default`: shown in `System Events` without extra runtime config.
 * - `diagnostic`: only persisted/streamed when the server's diagnostic
 *   system-events toggle (`SPUR_DIAGNOSTIC_EVENTS` / `--diagnostic-events`) is on.
 *   Diagnostic entries still appear in metadata so the UI can render them
 *   when permitted.
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
    event('process.started', 'process', 'process'),

    // ── agent.* (task 0221 R2/R3) ─────────────────────────────────────────
    event('agent.invoke.start', 'agent', 'agent'),
    event('agent.invoke.exit', 'agent', 'agent'),
    event('agent.started', 'agent', 'agent'),
    event('agent.stopped', 'agent', 'agent'),
    event('agent.message.sent', 'agent', 'agent'),

    // ── rule.* (task 0221 R2/R3) ──────────────────────────────────────────
    event('rule.run.start', 'rule', 'rule'),
    event('rule.eval.start', 'rule', 'rule'),
    event('rule.eval.done', 'rule', 'rule'),
    event('rule.eval.error', 'rule', 'rule'),
    event('rule.run.done', 'rule', 'rule'),

    // ── workflow.* (task 0221 R2/R3/R4) ───────────────────────────────────
    // Engine-native names AND the ObservableWorkflowAdapter's verb-form names
    // are both wired in the server context. `workflow.run.started` fires from
    // both paths (engine bridge + adapter) — accepted as harmless v1 duplication;
    // dedup deferred to a future refinement (task 0236).
    event('workflow.run.started', 'workflow', 'workflow-run'),
    event('workflow.run.done', 'workflow', 'workflow-run'),
    event('workflow.run.failed', 'workflow', 'workflow-run'),
    event('workflow.run.finalized', 'workflow', 'workflow-run'),
    event('workflow.run.paused', 'workflow', 'workflow-run'),
    event('workflow.run.resumed', 'workflow', 'workflow-run'),
    event('workflow.run.reseeded', 'workflow', 'workflow-run'),
    event('workflow.node.enter', 'workflow', 'workflow-phase'),
    event('workflow.phase', 'workflow', 'workflow-phase'),
    event('workflow.node.transition', 'workflow', 'workflow-transition'),
    event('workflow.transition', 'workflow', 'workflow-transition'),
    event('workflow.transition.requested', 'workflow', 'workflow-transition', 'metadata-only', 'diagnostic'),
    event('workflow.transition.denied', 'workflow', 'workflow-transition', 'metadata-only', 'diagnostic'),
    event('workflow.action.start', 'workflow', 'workflow-action'),
    event('workflow.action.started', 'workflow', 'workflow-action'),
    event('workflow.action.done', 'workflow', 'workflow-action'),
    event('workflow.action.finished', 'workflow', 'workflow-action'),
    event('workflow.action.failed_continue', 'workflow', 'workflow-action'),
    event('workflow.guard.evaluated', 'workflow', 'workflow-guard', 'metadata-only', 'diagnostic'),
    event('workflow.hitl.ask', 'workflow', 'workflow-hitl', 'redacted'),
    event('workflow.hitl.response', 'workflow', 'workflow-hitl', 'redacted'),
    event('workflow.hitl.note', 'workflow', 'workflow-hitl', 'redacted'),
    event('workflow.custom', 'workflow', 'workflow-custom'),
    event('api.request.error', 'api', 'api'),
    // ── api.* (task 0221 R2) ──────────────────────────────────────────────

    // ── bus.* (task 0221 R5) ──────────────────────────────────────────────
    event('bus.emit.done', 'bus', 'bus', 'metadata-only', 'diagnostic'),
    event('bus.emit.noop', 'bus', 'bus', 'metadata-only', 'diagnostic'),
    event('bus.handler.error', 'bus', 'bus', 'metadata-only', 'diagnostic'),
    event('bus.handler.async.enqueued', 'bus', 'bus', 'metadata-only', 'diagnostic'),
] as const satisfies readonly SystemEventCatalogEntry[];

/** Union of all system event names registered in {@link SYSTEM_EVENT_CATALOG}. */
export type SystemEventName = (typeof SYSTEM_EVENT_CATALOG)[number]['name'];

/** Flat list of every event name in {@link SYSTEM_EVENT_CATALOG}, in declaration order. */
export const SYSTEM_EVENT_NAMES: string[] = SYSTEM_EVENT_CATALOG.map((entry) => entry.name);
/** Subset of {@link SYSTEM_EVENT_NAMES} persisted/streamed by default — i.e.,
 * the `default` tier only. Diagnostic entries opt in via the runtime toggle. */
export const SYSTEM_EVENT_PERSISTED_NAMES: string[] = SYSTEM_EVENT_CATALOG.filter(
    (entry) => entry.tier === 'default',
).map((entry) => entry.name);
/** Subset of {@link SYSTEM_EVENT_NAMES} streamed by default — same as
 * {@link SYSTEM_EVENT_PERSISTED_NAMES}; tap and SSE filter re-derive when the
 * diagnostic toggle is on. */
export const SYSTEM_EVENT_STREAMED_NAMES: string[] = SYSTEM_EVENT_CATALOG.filter(
    (entry) => entry.tier === 'default',
).map((entry) => entry.name);
/** Unique event-name prefixes used to bucket events in {@link SYSTEM_EVENT_CATALOG}. */
export const SYSTEM_EVENT_PREFIXES: string[] = Array.from(new Set(SYSTEM_EVENT_CATALOG.map((entry) => entry.prefix)));
/** Subset of {@link SYSTEM_EVENT_NAMES} visible without diagnostic toggle enabled. */
export const SYSTEM_EVENT_DEFAULT_NAMES: string[] = SYSTEM_EVENT_CATALOG.filter(
    (entry) => entry.tier === 'default',
).map((entry) => entry.name);
/** Subset of {@link SYSTEM_EVENT_NAMES} visible only when diagnostic toggle is on. */
export const SYSTEM_EVENT_DIAGNOSTIC_NAMES: string[] = SYSTEM_EVENT_CATALOG.filter(
    (entry) => entry.tier === 'diagnostic',
).map((entry) => entry.name);

/** Compatibility alias while older imports migrate to SYSTEM_EVENT_NAMES. */
export const PLANNING_EVENT_NAMES = SYSTEM_EVENT_NAMES;

/** Public metadata safe to return from API responses. */
export interface SystemEventCatalogMetadata {
    name: string;
    prefix: string;
    source: SystemEventSource;
    tier: SystemEventTier;
    renderer: string;
}

/** Public-facing projection of {@link SYSTEM_EVENT_CATALOG} with payload fields stripped for API responses. */
export const SYSTEM_EVENT_CATALOG_METADATA: SystemEventCatalogMetadata[] = SYSTEM_EVENT_CATALOG.map(
    ({ name, prefix, source, tier, renderer }) => ({ name, prefix, source, tier, renderer }),
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
