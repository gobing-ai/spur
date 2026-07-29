/** Event payload retention policy before persistence or streaming. */
import { redactAndBound } from '../observability/agent-execution';

/** Persistence/streaming policy applied to one cataloged system-event payload. */
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
    | 'team'
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
    event('queue.job.enqueued', 'queue', 'queue', 'metadata-only', 'diagnostic'),
    event('queue.job.completed', 'queue', 'queue', 'metadata-only', 'diagnostic'),
    event('queue.job.failed', 'queue', 'queue'),
    event('queue.job.retrying', 'queue', 'queue'),
    event('queue.stats', 'queue', 'queue'),
    event('scheduler.job.executed', 'scheduler', 'scheduler', 'metadata-only', 'diagnostic'),

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

    // ── team.* (task 0371 R1) ─────────────────────────────────────────────
    // Team lifecycle + member attribution for the Teams Activity / Supervisor
    // surfaces (J3 R15–R17). Default tier, metadata-only: team id, member set
    // size / memberId, agentType, outcome — never message bodies or argv.
    event('team.up', 'team', 'team'),
    event('team.down', 'team', 'team'),
    event('team.member.assigned', 'team', 'team'),
    event('team.member.started', 'team', 'team'),
    event('team.member.stopped', 'team', 'team'),

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
    // ── workflow.agent / workflow.steering (task 0367 R1/R2) ────────────────
    // The unified AgentExecutionEvent lifecycle (started, output, heartbeat,
    // dropped, finished) is emitted on the bus as a single `workflow.agent`
    // name, discriminated by the payload `kind` field. The whole lifecycle
    // sits on the `diagnostic` tier: `output` and `heartbeat` are high-volume
    // (one per chunk / per interval) and would dominate the default ledger
    // if promoted, drowning low-volume signal (planning, steering, process).
    // `started`/`dropped`/`finished` are low-volume but share the entry
    // because the bus emits one name — splitting would require either five
    // bus names (R6 forbids changing the producer) or a kind-dispatched tap
    // (out of scope for this task). The diagnostic toggle surfaces the full
    // lifecycle when operators need it; the default ledger stays clean (R5).
    event('workflow.agent', 'workflow', 'workflow-agent', 'redacted', 'diagnostic'),
    // Steering acknowledgements are low-volume, semantically important, and
    // carry operation/target/outcome — `default` tier so they surface without
    // the diagnostic toggle. `redacted` policy: the `note` field may carry
    // operator context that should not persist verbatim (R2).
    event('workflow.steering', 'workflow', 'workflow-steering', 'redacted'),
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

/** Apply the catalog payload policy before persistence or streaming.
 *
 * Preserves the 0365 observability envelope's correlation and metadata fields
 * (schemaVersion, eventId, sequence, runId, executionId, actionId, node, kind,
 * metadata, durationMs, usage, outcome, reason) under every payload policy (R3).
 * Redaction runs strictly ahead of persistence: the 0365 SECRET_PATTERN is
 * applied to every string value as defense-in-depth, and high-volume text fields
 * are bounded so truncation can never expose redacted material (R4). */
export function normalizeSystemEventPayload(
    entry: SystemEventCatalogEntry,
    eventPayload: unknown,
    secretValues: readonly string[] = [],
): Record<string, unknown> | null {
    if (eventPayload === null || eventPayload === undefined) return null;
    if (typeof eventPayload !== 'object') {
        return { value: redactSecretValue(eventPayload, secretValues) };
    }
    const source = eventPayload as Record<string, unknown>;
    if (entry.payloadPolicy === 'raw-safe') return redactSecretValues({ ...source }, secretValues);

    const redacted = { ...source };
    for (const key of ['body', 'content', 'message', 'prompt', 'query', 'response', 'value']) {
        if (key in redacted) {
            redacted[key] = '[redacted]';
        }
    }
    return redactSecretValues(redacted, secretValues);
}

/** Defense-in-depth: scan every string value, including values nested in arrays,
 * for the 0365 secret pattern and configured secrets before bounding (R4). */
const MAX_FIELD_LENGTH = 256;

function redactSecretValue(value: unknown, secretValues: readonly string[]): unknown {
    if (typeof value === 'string') return redactAndBound(value, secretValues, MAX_FIELD_LENGTH);
    if (Array.isArray(value)) return value.map((item) => redactSecretValue(item, secretValues));
    if (value !== null && typeof value === 'object') {
        return redactSecretValues({ ...(value as Record<string, unknown>) }, secretValues);
    }
    return value;
}

function redactSecretValues(
    payload: Record<string, unknown>,
    secretValues: readonly string[],
): Record<string, unknown> {
    for (const key of Object.keys(payload)) {
        payload[key] = redactSecretValue(payload[key], secretValues);
    }
    return payload;
}
