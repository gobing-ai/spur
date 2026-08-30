/** Event payload retention policy before persistence or streaming. */
import {
    projectSystemEventData,
    type SystemEventCorrelationContext,
    type SystemEventProducerPackage,
    type SystemEventRemediationKind,
    type SystemEventSeverity,
} from './system-event-envelope';

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
    | 'history'
    | 'bus'
    | 'api';
/** Visibility tier for board consumers. Diagnostic entries only persist/stream when the runtime toggle is on. */
export type SystemEventTier = 'default' | 'diagnostic';

/** One catalog-owned scalar field retained for metadata-only payloads and presentation. */
export interface SystemEventMetadataField {
    path: string;
    label: string;
}

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
    /** Concrete package that owns the emitted event contract. */
    producerPackage: SystemEventProducerPackage;
    /** Producer-local subsystem that emits the event. */
    subsystem: string;
    /** Default presentation severity; a valid payload severity may override it. */
    severity: SystemEventSeverity;
    /** Human-readable catalog explanation for Board/tooltips. */
    description: string;
    /** Bounded allow-list and high-value presentation fields. */
    metadataFields: readonly SystemEventMetadataField[];
    /** Deterministic safe action policy for the envelope presenter. */
    remediationKind: SystemEventRemediationKind;
}

/** Source-family defaults for producer attribution and remediation. */
interface SourceProfile {
    producerPackage: SystemEventProducerPackage;
    subsystem: string;
    remediationKind: SystemEventRemediationKind;
}

const field = (path: string, label: string): SystemEventMetadataField => ({ path, label });

const SOURCE_PROFILES: Record<SystemEventSource, SourceProfile> = {
    planning: { producerPackage: 'spur', subsystem: 'planning', remediationKind: 'prefix-filter' },
    queue: { producerPackage: '@gobing-ai/ts-infra', subsystem: 'job-queue', remediationKind: 'prefix-filter' },
    scheduler: { producerPackage: '@gobing-ai/ts-infra', subsystem: 'scheduler', remediationKind: 'prefix-filter' },
    message: { producerPackage: 'spur', subsystem: 'team-messaging', remediationKind: 'prefix-filter' },
    process: {
        producerPackage: '@gobing-ai/ts-runtime',
        subsystem: 'process-executor',
        remediationKind: 'prefix-filter',
    },
    workflow: {
        producerPackage: '@gobing-ai/ts-dual-workflow-engine',
        subsystem: 'workflow',
        remediationKind: 'workflow-trace',
    },
    rule: { producerPackage: '@gobing-ai/ts-rule-engine', subsystem: 'rule-engine', remediationKind: 'rule-trace' },
    agent: { producerPackage: '@gobing-ai/ts-ai-runner', subsystem: 'agent-runner', remediationKind: 'prefix-filter' },
    team: { producerPackage: 'spur', subsystem: 'team', remediationKind: 'prefix-filter' },
    history: { producerPackage: 'spur', subsystem: 'history', remediationKind: 'prefix-filter' },
    bus: { producerPackage: '@gobing-ai/ts-infra', subsystem: 'event-bus', remediationKind: 'prefix-filter' },
    api: { producerPackage: 'spur', subsystem: 'http-api', remediationKind: 'prefix-filter' },
};

// ─── Presenter contract (R1) ────────────────────────────────────────────

/** Bounded facts a presenter may derive from: projected `data` plus normalized correlation. */
export interface SystemEventPresentationInput {
    data: Readonly<Record<string, unknown>> | null;
    correlation: Readonly<SystemEventCorrelationContext>;
}

/** Exactly one of these branches per event: a derived Outcome or an explicit unsupported. */
export type SystemEventOutcomeSpec =
    | { support: 'derived'; derive(input: SystemEventPresentationInput): string | undefined }
    | { support: 'unsupported' };

/** One authored, event-specific presenter bound to a catalog name. */
export interface SystemEventPresenterSpec {
    description: string;
    fields: readonly SystemEventMetadataField[];
    /** Additional metadata paths to retain in the projection without promoting to tooltip fields. */
    retain?: readonly SystemEventMetadataField[];
    summary(input: SystemEventPresentationInput): string;
    outcome: SystemEventOutcomeSpec;
}

// ─── Presenter helpers (shared; never source-inherited presentation) ────

/** Read the raw projected value at a dot-separated path, or `undefined`. */
function at(data: Readonly<Record<string, unknown>> | null, path: string): unknown {
    if (data === null) return undefined;
    let current: unknown = data;
    for (const segment of path.split('.')) {
        if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

/** First non-empty string value among the given paths. */
function s(data: Readonly<Record<string, unknown>> | null, ...paths: string[]): string | undefined {
    for (const path of paths) {
        const value = at(data, path);
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

/** First number or boolean rendered as a string among the given paths. */
function n(data: Readonly<Record<string, unknown>> | null, ...paths: string[]): string | undefined {
    for (const path of paths) {
        const value = at(data, path);
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value === 'boolean') return String(value);
    }
    return undefined;
}

/** The entity id from the bounded payload, falling back to correlation. */
function entityId(input: SystemEventPresentationInput): string {
    return s(input.data, 'entity.id') ?? input.correlation.entityId ?? '';
}

/**
 * Detects whether a string is an opaque machine identifier (UUID, live- token, or exact id name)
 * rather than human-meaningful text.
 */
export function looksLikeOpaqueId(value: string): boolean {
    if (typeof value !== 'string') return false;
    const v = value.trim();
    if (v === '') return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
    if (/^live[-_][a-z0-9._-]+$/i.test(v)) return true;
    if (/^(?:eventId|rowId|runId|executionId|actionId)$/i.test(v)) return true;
    return false;
}

/**
 * Workflow human identity: workflowName when present and not opaque; never correlation.runId.
 */
export function humanWorkflowTitle(input: SystemEventPresentationInput): string {
    const raw = s(input.data, 'workflowName') ?? s(input.data, 'workflow');
    if (raw !== undefined && !looksLikeOpaqueId(raw)) {
        const basename =
            raw
                .split('/')
                .pop()
                ?.replace(/\.(?:ya?ml|json)$/i, '') ?? raw;
        return basename.replace(/[._-]+$/, '');
    }
    return '';
}

/**
 * Step identity for workflow payloads: nodeLabel when present and not opaque; never kind or UUID node.
 */
export function humanStepLabel(data: Readonly<Record<string, unknown>> | null): string | undefined {
    const label = s(data, 'nodeLabel') ?? s(data, 'stepName') ?? s(data, 'step');
    if (label !== undefined && !looksLikeOpaqueId(label)) return label;
    const node = s(data, 'node');
    if (node !== undefined && !looksLikeOpaqueId(node)) return node;
    return undefined;
}

/** A derived outcome reading the first present string fact. */
function derivedFrom(...paths: string[]): SystemEventOutcomeSpec {
    return { support: 'derived', derive: ({ data }) => s(data, ...paths) };
}

/** A derived outcome reading the first present string/number/boolean fact. */
function derivedFromValue(...paths: string[]): SystemEventOutcomeSpec {
    return { support: 'derived', derive: ({ data }) => n(data, ...paths) ?? s(data, ...paths) };
}

/** Outcome support explicitly unavailable for this event. */
const unsupported: SystemEventOutcomeSpec = { support: 'unsupported' };

// ─── Base catalog policy (name/source/tier/policy/renderer/producer) ────

interface BaseCatalogEntry {
    name: string;
    source: SystemEventSource;
    tier: SystemEventTier;
    payloadPolicy: SystemEventPayloadPolicy;
    renderer: string;
    producer?: { package: SystemEventProducerPackage; subsystem: string };
}

function baseEvent<N extends string>(
    name: N,
    source: SystemEventSource,
    renderer: string,
    payloadPolicy: SystemEventPayloadPolicy = 'metadata-only',
    tier: SystemEventTier = 'default',
    producer?: { package: SystemEventProducerPackage; subsystem: string },
): BaseCatalogEntry & { name: N } {
    return {
        name,
        source,
        tier,
        payloadPolicy,
        renderer,
        ...(producer !== undefined ? { producer } : {}),
    };
}

/**
 * Board-observable system-event catalog policy — name, source, tier, payload
 * policy, renderer, and producer attribution only. Presentation (description,
 * fields, summary, outcome) is owned per-event by {@link SYSTEM_EVENT_PRESENTERS};
 * this list never supplies presentation defaults.
 */
const BASE_CATALOG = [
    baseEvent('task.created', 'planning', 'planning'),
    baseEvent('task.updated', 'planning', 'planning'),
    baseEvent('task.transitioned', 'planning', 'planning'),
    baseEvent('feature.created', 'planning', 'planning'),
    baseEvent('feature.updated', 'planning', 'planning'),
    baseEvent('feature.transitioned', 'planning', 'planning'),

    baseEvent('queue.consumer.started', 'queue', 'queue'),
    baseEvent('queue.consumer.stopped', 'queue', 'queue'),
    baseEvent('queue.job.enqueued', 'queue', 'queue', 'metadata-only', 'diagnostic'),
    baseEvent('queue.job.completed', 'queue', 'queue', 'metadata-only', 'diagnostic'),
    baseEvent('queue.job.failed', 'queue', 'queue'),
    baseEvent('queue.job.retrying', 'queue', 'queue'),
    baseEvent('queue.stats', 'queue', 'queue'),
    baseEvent('scheduler.job.executed', 'scheduler', 'scheduler', 'metadata-only', 'diagnostic'),

    // Message events are metadata-only. Message bodies stay in inbox storage.
    baseEvent('message.sent', 'message', 'message'),
    baseEvent('message.replied', 'message', 'message'),

    baseEvent('process.spawned', 'process', 'process'),
    baseEvent('process.exited', 'process', 'process'),
    baseEvent('process.stopped', 'process', 'process'),
    baseEvent('process.started', 'process', 'process'),

    // ── agent.* (task 0221 R2/R3) ─────────────────────────────────────────
    baseEvent('agent.invoke.start', 'agent', 'agent'),
    baseEvent('agent.invoke.exit', 'agent', 'agent'),
    // Escalation record (task 0545 R2): its own row, emitted by the Spur
    // agent-service bridge at the escalation point — originating tier,
    // resulting tier, and the objective trigger. Absence of this row means
    // "did not escalate"; never a null-valued field on the starting decision.
    // Attributed to spur (the emitter), not ts-ai-runner (the invoke family).
    baseEvent('agent.invoke.escalated', 'agent', 'agent', 'metadata-only', 'default', {
        package: 'spur',
        subsystem: 'agent-runner',
    }),
    // Exhaustion record (0540 review follow-up): structured twin of the
    // `Escalation chain exhausted` stderr diagnostic so --json runs are not
    // silent — stage, tiers attempted, executors tried, attempt count.
    baseEvent('agent.invoke.exhausted', 'agent', 'agent', 'metadata-only', 'default', {
        package: 'spur',
        subsystem: 'agent-runner',
    }),
    baseEvent('agent.started', 'agent', 'agent'),
    baseEvent('agent.stopped', 'agent', 'agent'),
    baseEvent('agent.message.sent', 'agent', 'agent'),

    // ── team.* (task 0371 R1) ─────────────────────────────────────────────
    baseEvent('team.up', 'team', 'team'),
    baseEvent('team.down', 'team', 'team'),
    baseEvent('team.member.assigned', 'team', 'team'),
    baseEvent('team.member.started', 'team', 'team'),
    baseEvent('team.member.stopped', 'team', 'team'),

    // ── history.* (task 0471 R1) ─────────────────────────────────────────
    baseEvent('history.import.completed', 'history', 'history-import'),
    baseEvent('history.analyze.completed', 'history', 'history-analyze'),
    baseEvent('history.daily.failed', 'history', 'history-daily'),
    baseEvent('history.refresh.enqueued', 'history', 'history-refresh'),

    // ── rule.* (task 0221 R2/R3) ──────────────────────────────────────────
    baseEvent('rule.run.start', 'rule', 'rule'),
    baseEvent('rule.eval.start', 'rule', 'rule'),
    baseEvent('rule.eval.done', 'rule', 'rule'),
    baseEvent('rule.eval.error', 'rule', 'rule'),
    baseEvent('rule.run.done', 'rule', 'rule'),

    // ── workflow.* (task 0221 R2/R3/R4) ───────────────────────────────────
    baseEvent('workflow.run.started', 'workflow', 'workflow-run'),
    baseEvent('workflow.run.done', 'workflow', 'workflow-run'),
    baseEvent('workflow.run.failed', 'workflow', 'workflow-run'),
    baseEvent('workflow.run.finalized', 'workflow', 'workflow-run'),
    baseEvent('workflow.run.paused', 'workflow', 'workflow-run'),
    baseEvent('workflow.run.resumed', 'workflow', 'workflow-run'),
    baseEvent('workflow.run.reseeded', 'workflow', 'workflow-run'),
    baseEvent('workflow.node.enter', 'workflow', 'workflow-phase'),
    baseEvent('workflow.phase', 'workflow', 'workflow-phase'),
    baseEvent('workflow.node.transition', 'workflow', 'workflow-transition'),
    baseEvent('workflow.transition', 'workflow', 'workflow-transition'),
    baseEvent('workflow.transition.requested', 'workflow', 'workflow-transition', 'metadata-only', 'diagnostic'),
    baseEvent('workflow.transition.denied', 'workflow', 'workflow-transition', 'metadata-only', 'diagnostic'),
    baseEvent('workflow.action.start', 'workflow', 'workflow-action'),
    baseEvent('workflow.action.started', 'workflow', 'workflow-action'),
    baseEvent('workflow.action.done', 'workflow', 'workflow-action'),
    baseEvent('workflow.action.finished', 'workflow', 'workflow-action'),
    baseEvent('workflow.action.failed_continue', 'workflow', 'workflow-action'),
    baseEvent('workflow.guard.evaluated', 'workflow', 'workflow-guard', 'metadata-only', 'diagnostic'),
    baseEvent('workflow.hitl.ask', 'workflow', 'workflow-hitl', 'redacted'),
    baseEvent('workflow.hitl.response', 'workflow', 'workflow-hitl', 'redacted'),
    baseEvent('workflow.hitl.note', 'workflow', 'workflow-hitl', 'redacted'),
    baseEvent('workflow.custom', 'workflow', 'workflow-custom'),
    baseEvent('workflow.agent', 'workflow', 'workflow-agent', 'redacted', 'diagnostic'),
    baseEvent('workflow.steering', 'workflow', 'workflow-steering', 'redacted'),
    baseEvent('api.request.error', 'api', 'api'),
    baseEvent('bus.emit.done', 'bus', 'bus', 'metadata-only', 'diagnostic'),
    baseEvent('bus.emit.noop', 'bus', 'bus', 'metadata-only', 'diagnostic'),
    baseEvent('bus.handler.error', 'bus', 'bus', 'metadata-only', 'diagnostic'),
    baseEvent('bus.handler.async.enqueued', 'bus', 'bus', 'metadata-only', 'diagnostic'),
] satisfies readonly BaseCatalogEntry[];

/** Union of all system event names registered in the base catalog policy. */
export type SystemEventName = (typeof BASE_CATALOG)[number]['name'];

/**
 * One exhaustive, event-specific presenter per catalog name (R1/R8). The
 * source-family profiles never supply description, fields, summary, or outcome;
 * presentation lives here and here only. Presenters read only bounded projected
 * `data` plus normalized correlation (no history lookups, no emitter access).
 * Outcome derivation returns `undefined` for legacy rows lacking the source fact.
 */
export const SYSTEM_EVENT_PRESENTERS: Record<SystemEventName, SystemEventPresenterSpec> = {
    // ── planning ──────────────────────────────────────────────────────────
    'task.created': {
        description: 'A task file was created with a new WBS id.',
        fields: [field('entity.kind', 'Entity kind'), field('entity.id', 'Entity')],
        summary: ({ data, correlation }) => `[task] ${entityId({ data, correlation })} created`,
        outcome: unsupported,
    },
    'task.updated': {
        description: 'An existing task file was updated in place, naming the section that changed.',
        fields: [
            field('entity.kind', 'Entity kind'),
            field('entity.id', 'Entity'),
            field('field', 'Field'),
            field('data.mutation.name', 'Section'),
            field('data.after', 'After'),
            field('data.diff', 'Diff'),
        ],
        summary: ({ data, correlation }) => {
            const section = s(data, 'data.mutation.name');
            const id = entityId({ data, correlation });
            return section !== undefined ? `[task] ${section}` : `[task] ${id || 'updated'}`;
        },
        outcome: unsupported,
    },
    'task.transitioned': {
        description: 'A task moved between lifecycle states, naming both the previous and new status.',
        fields: [
            field('entity.kind', 'Entity kind'),
            field('entity.id', 'Entity'),
            field('from', 'From'),
            field('to', 'To'),
        ],
        summary: ({ data, correlation }) => {
            const id = entityId({ data, correlation });
            const from = s(data, 'from');
            const to = s(data, 'to');
            return from !== undefined && to !== undefined
                ? `[task] ${id} : ${from} -> ${to}`
                : `[task] ${id} transitioned`;
        },
        outcome: { support: 'derived', derive: ({ data }) => s(data, 'to') },
    },
    'feature.created': {
        description: 'A feature file was created with a new feature id.',
        fields: [field('entity.kind', 'Entity kind'), field('entity.id', 'Entity')],
        summary: ({ data, correlation }) => `[feature] ${entityId({ data, correlation })} created`,
        outcome: unsupported,
    },
    'feature.updated': {
        description: 'An existing feature file was updated in place, naming the section that changed.',
        fields: [
            field('entity.kind', 'Entity kind'),
            field('entity.id', 'Entity'),
            field('field', 'Field'),
            field('data.mutation.name', 'Section'),
            field('data.after', 'After'),
            field('data.diff', 'Diff'),
        ],
        summary: ({ data, correlation }) => {
            const section = s(data, 'data.mutation.name');
            const id = entityId({ data, correlation });
            return section !== undefined ? `[feature] ${section}` : `[feature] ${id || 'updated'}`;
        },
        outcome: unsupported,
    },
    'feature.transitioned': {
        description: 'A feature moved between lifecycle states, naming both the previous and new status.',
        fields: [
            field('entity.kind', 'Entity kind'),
            field('entity.id', 'Entity'),
            field('from', 'From'),
            field('to', 'To'),
        ],
        summary: ({ data, correlation }) => {
            const id = entityId({ data, correlation });
            const from = s(data, 'from');
            const to = s(data, 'to');
            return from !== undefined && to !== undefined
                ? `[feature] ${id} : ${from} -> ${to}`
                : `[feature] ${id} transitioned`;
        },
        outcome: { support: 'derived', derive: ({ data }) => s(data, 'to') },
    },

    // ── queue + scheduler ─────────────────────────────────────────────────
    'queue.consumer.started': {
        description: 'The configured queue consumer began polling its named queue.',
        fields: [
            field('queueName', 'Queue'),
            field('startedAt', 'Started'),
            field('pollInterval', 'Poll interval'),
            field('batchSize', 'Batch size'),
            field('maxConcurrency', 'Max concurrency'),
            field('visibilityTimeout', 'Visibility timeout'),
        ],
        summary: ({ data }) => {
            const name = s(data, 'queueName');
            return name !== undefined ? `[queue] ${name} : consumer started` : '[queue] consumer started';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => (at(data, 'startedAt') !== undefined ? 'running' : undefined),
        },
    },
    'queue.consumer.stopped': {
        description: 'The queue consumer stopped, reporting whether it drained in-flight work.',
        fields: [
            field('queueName', 'Queue'),
            field('stoppedAt', 'Stopped'),
            field('drainTimeoutMs', 'Drain timeout'),
            field('inFlightAtStop', 'In flight'),
            field('drained', 'Drained'),
        ],
        summary: ({ data }) => {
            const name = s(data, 'queueName');
            return name !== undefined ? `[queue] ${name} : consumer stopped` : '[queue] consumer stopped';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => {
                const drained = at(data, 'drained');
                if (drained === true) return 'drained';
                if (drained === false) return 'timeout';
                return undefined;
            },
        },
    },
    'queue.job.enqueued': {
        description: 'A job was enqueued onto the job queue for later processing.',
        fields: [field('jobId', 'Job'), field('type', 'Type'), field('nextRetryAt', 'Next retry')],
        summary: ({ data }) => {
            const type = s(data, 'type');
            const jobId = s(data, 'jobId');
            return type !== undefined && jobId !== undefined
                ? `[queue] ${type} · job ${jobId} enqueued`
                : '[queue] job enqueued';
        },
        outcome: unsupported,
    },
    'queue.job.completed': {
        description: 'A queued job finished successfully with its attempt and duration.',
        fields: [
            field('jobId', 'Job'),
            field('type', 'Type'),
            field('attempt', 'Attempt'),
            field('durationMs', 'Duration (ms)'),
        ],
        summary: ({ data }) => {
            const type = s(data, 'type');
            const jobId = s(data, 'jobId');
            return type !== undefined && jobId !== undefined
                ? `[queue] ${type} · job ${jobId} completed`
                : '[queue] job completed';
        },
        outcome: unsupported,
    },
    'queue.job.failed': {
        description: 'A queued job exhausted its attempts and failed with an error.',
        fields: [
            field('jobId', 'Job'),
            field('type', 'Type'),
            field('attempt', 'Attempt'),
            field('maxRetries', 'Max retries'),
            field('durationMs', 'Duration (ms)'),
            field('error', 'Error'),
        ],
        summary: ({ data }) => {
            const type = s(data, 'type');
            const jobId = s(data, 'jobId');
            return type !== undefined && jobId !== undefined
                ? `[queue] ${type} · job ${jobId} failed`
                : '[queue] job failed';
        },
        outcome: derivedFrom('error'),
    },
    'queue.job.retrying': {
        description: 'A queued job failed once and is scheduled for another attempt.',
        fields: [
            field('jobId', 'Job'),
            field('type', 'Type'),
            field('attempt', 'Attempt'),
            field('maxRetries', 'Max retries'),
            field('nextRetryAt', 'Next retry'),
            field('error', 'Error'),
        ],
        summary: ({ data }) => {
            const type = s(data, 'type');
            const jobId = s(data, 'jobId');
            return type !== undefined && jobId !== undefined
                ? `[queue] ${type} · job ${jobId} retrying`
                : '[queue] job retrying';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => {
                const attempt = at(data, 'attempt');
                const max = at(data, 'maxRetries');
                if (
                    typeof attempt === 'number' &&
                    typeof max === 'number' &&
                    Number.isFinite(attempt) &&
                    Number.isFinite(max)
                ) {
                    return `retrying ${attempt}/${max}`;
                }
                return s(data, 'error');
            },
        },
    },
    'queue.stats': {
        description: 'Periodic job-queue statistics across ready, running, completed, and failed counts.',
        fields: [
            field('ready', 'Ready'),
            field('running', 'Running'),
            field('completed', 'Completed'),
            field('failed', 'Failed'),
        ],
        summary: () => '[queue] stats',
        outcome: unsupported,
    },
    'scheduler.job.executed': {
        description: 'A scheduler job ran to completion or failed, with its duration.',
        fields: [field('name', 'Job'), field('durationMs', 'Duration (ms)'), field('error', 'Error')],
        summary: ({ data }) => {
            const name = s(data, 'name');
            return name !== undefined ? `[scheduler] ${name}` : '[scheduler] job executed';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => s(data, 'error') ?? (at(data, 'error') === null ? 'completed' : undefined),
        },
    },

    // ── message ───────────────────────────────────────────────────────────
    'message.sent': {
        description: 'A team message was sent from one member to another.',
        fields: [field('msgId', 'Message'), field('fromId', 'From'), field('toId', 'To'), field('threadId', 'Thread')],
        summary: ({ data }) => {
            const from = s(data, 'fromId');
            const to = s(data, 'toId');
            return from !== undefined && to !== undefined ? `[message] ${from} -> ${to}` : '[message] sent';
        },
        outcome: unsupported,
    },
    'message.replied': {
        description: 'A member replied to an existing message thread.',
        fields: [field('msgId', 'Message'), field('fromId', 'From'), field('toId', 'To'), field('threadId', 'Thread')],
        summary: ({ data }) => {
            const from = s(data, 'fromId');
            const thread = s(data, 'threadId');
            return from !== undefined && thread !== undefined
                ? `[message] ${from} replied in ${thread}`
                : '[message] replied';
        },
        outcome: unsupported,
    },

    // ── process ───────────────────────────────────────────────────────────
    'process.spawned': {
        description: 'A supervised process was spawned with a new pid.',
        fields: [field('label', 'Label'), field('pid', 'PID'), field('teamId', 'Team'), field('agentId', 'Agent')],
        summary: ({ data }) => {
            const label = s(data, 'label') ?? n(data, 'pid');
            return label !== undefined ? `[process] ${label} spawned` : '[process] spawned';
        },
        outcome: unsupported,
    },
    'process.exited': {
        description: 'A supervised process exited, carrying its exit code, signal, or failure reason.',
        fields: [
            field('label', 'Label'),
            field('pid', 'PID'),
            field('exitCode', 'Exit code'),
            field('signal', 'Signal'),
            field('durationMs', 'Duration (ms)'),
            field('reason', 'Reason'),
        ],
        summary: ({ data }) => {
            const label = s(data, 'label') ?? n(data, 'pid');
            return label !== undefined ? `[process] ${label} exited` : '[process] exited';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => {
                const reason = s(data, 'reason');
                if (reason !== undefined) return reason;
                const signal = s(data, 'signal');
                if (signal !== undefined) return `signal ${signal}`;
                const code = at(data, 'exitCode');
                if (typeof code === 'number' && Number.isFinite(code)) return code === 0 ? 'ok' : `exit ${code}`;
                return undefined;
            },
        },
    },
    'process.stopped': {
        description: 'A supervised process was stopped, naming the stopping reason.',
        fields: [field('label', 'Label'), field('pid', 'PID'), field('signal', 'Signal'), field('reason', 'Reason')],
        summary: ({ data }) => {
            const label = s(data, 'label') ?? n(data, 'pid');
            return label !== undefined ? `[process] ${label} stopped` : '[process] stopped';
        },
        outcome: derivedFrom('reason'),
    },
    'process.started': {
        description: 'A process executor started a process with a new pid.',
        fields: [field('label', 'Label'), field('pid', 'PID')],
        summary: ({ data }) => {
            const label = s(data, 'label') ?? n(data, 'pid');
            return label !== undefined ? `[process] ${label} started` : '[process] started';
        },
        outcome: unsupported,
    },

    // ── agent ─────────────────────────────────────────────────────────────
    'agent.invoke.start': {
        description: 'An agent invocation began, naming the agent and its operation.',
        fields: [
            field('agent', 'Agent'),
            field('operation', 'Operation'),
            field('routing.role', 'Role'),
            field('routing.tier', 'Tier'),
            field('routing.executor', 'Executor'),
            field('routing.source', 'Selection source'),
        ],
        summary: ({ data }) => {
            const agent = s(data, 'agent');
            const operation = s(data, 'operation');
            return agent !== undefined && operation !== undefined
                ? `[agent] ${agent} · ${operation}`
                : '[agent] invocation started';
        },
        outcome: unsupported,
    },
    'agent.invoke.exit': {
        description: 'An agent invocation exited, reporting its exit code or signal.',
        fields: [
            field('agent', 'Agent'),
            field('operation', 'Operation'),
            field('exitCode', 'Exit code'),
            field('signal', 'Signal'),
            field('routing.role', 'Role'),
            field('routing.tier', 'Tier'),
            field('routing.executor', 'Executor'),
            field('routing.source', 'Selection source'),
        ],
        summary: ({ data }) => {
            const agent = s(data, 'agent');
            const operation = s(data, 'operation');
            return agent !== undefined && operation !== undefined
                ? `[agent] ${agent} · ${operation} exited`
                : '[agent] invocation exited';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => {
                const signal = s(data, 'signal');
                if (signal !== undefined) return `signal ${signal}`;
                const code = at(data, 'exitCode');
                if (typeof code === 'number' && Number.isFinite(code)) return code === 0 ? 'ok' : `exit ${code}`;
                return undefined;
            },
        },
    },
    'agent.invoke.escalated': {
        description: 'An agent invocation escalated from one executor tier to another.',
        fields: [
            field('fromExecutor', 'From executor'),
            field('fromTier', 'From tier'),
            field('toExecutor', 'To executor'),
            field('toTier', 'To tier'),
            field('trigger', 'Trigger'),
        ],
        summary: ({ data }) => {
            const from = s(data, 'fromExecutor');
            const to = s(data, 'toExecutor');
            return from !== undefined && to !== undefined ? `[agent] ${from} -> ${to}` : '[agent] escalation';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => s(data, 'toTier') ?? s(data, 'trigger'),
        },
    },
    'agent.invoke.exhausted': {
        description: 'An agent invocation exhausted every eligible executor tier without success.',
        fields: [
            field('stage', 'Stage'),
            field('attempts', 'Attempts'),
            field('fromTier', 'From tier'),
            field('toTier', 'To tier'),
            field('fromExecutor', 'From executor'),
            field('toExecutor', 'To executor'),
        ],
        summary: ({ data }) => {
            const stage = s(data, 'stage');
            return stage !== undefined ? `[agent] ${stage} escalation exhausted` : '[agent] escalation exhausted';
        },
        outcome: derivedFromValue('attempts'),
    },
    'agent.started': {
        description: 'An agent started, carrying its id and type.',
        fields: [field('agentId', 'Agent'), field('agentType', 'Agent type'), field('pid', 'PID')],
        summary: ({ data }) => {
            const id = s(data, 'agentId');
            return id !== undefined ? `[agent] ${id} started` : '[agent] started';
        },
        outcome: unsupported,
    },
    'agent.stopped': {
        description: 'An agent stopped, reporting its exit code.',
        fields: [field('agentId', 'Agent'), field('exitCode', 'Exit code')],
        summary: ({ data }) => {
            const id = s(data, 'agentId');
            return id !== undefined ? `[agent] ${id} stopped` : '[agent] stopped';
        },
        outcome: derivedFromValue('exitCode'),
    },
    'agent.message.sent': {
        description: 'A message was sent to an agent, reporting delivery success.',
        fields: [field('agentId', 'Agent'), field('ok', 'Delivered')],
        summary: ({ data }) => {
            const id = s(data, 'agentId');
            return id !== undefined ? `[agent] message -> ${id}` : '[agent] message sent';
        },
        outcome: derivedFromValue('ok'),
    },

    // ── team ──────────────────────────────────────────────────────────────
    'team.up': {
        description: 'A team came online with its member count.',
        fields: [field('teamId', 'Team'), field('memberCount', 'Members'), field('outcome', 'Outcome')],
        summary: ({ data }) => {
            const id = s(data, 'teamId');
            return id !== undefined ? `[team] ${id} up` : '[team] up';
        },
        outcome: derivedFrom('outcome'),
    },
    'team.down': {
        description: 'A team went offline with its member count.',
        fields: [field('teamId', 'Team'), field('memberCount', 'Members'), field('outcome', 'Outcome')],
        summary: ({ data }) => {
            const id = s(data, 'teamId');
            return id !== undefined ? `[team] ${id} down` : '[team] down';
        },
        outcome: derivedFrom('outcome'),
    },
    'team.member.assigned': {
        description: 'A member was assigned to a team, naming the task when present.',
        fields: [
            field('teamId', 'Team'),
            field('memberId', 'Member'),
            field('agentType', 'Agent type'),
            field('taskId', 'Task'),
            field('outcome', 'Outcome'),
        ],
        summary: ({ data }) => {
            const team = s(data, 'teamId');
            const member = s(data, 'memberId');
            return team !== undefined && member !== undefined
                ? `[team] ${team} · ${member} assigned`
                : '[team] member assigned';
        },
        outcome: derivedFrom('outcome'),
    },
    'team.member.started': {
        description: 'A team member began working on the team.',
        fields: [
            field('teamId', 'Team'),
            field('memberId', 'Member'),
            field('agentType', 'Agent type'),
            field('outcome', 'Outcome'),
        ],
        summary: ({ data }) => {
            const team = s(data, 'teamId');
            const member = s(data, 'memberId');
            return team !== undefined && member !== undefined
                ? `[team] ${team} · ${member} started`
                : '[team] member started';
        },
        outcome: derivedFrom('outcome'),
    },
    'team.member.stopped': {
        description: 'A team member stopped working on the team.',
        fields: [
            field('teamId', 'Team'),
            field('memberId', 'Member'),
            field('agentType', 'Agent type'),
            field('outcome', 'Outcome'),
        ],
        summary: ({ data }) => {
            const team = s(data, 'teamId');
            const member = s(data, 'memberId');
            return team !== undefined && member !== undefined
                ? `[team] ${team} · ${member} stopped`
                : '[team] member stopped';
        },
        outcome: derivedFrom('outcome'),
    },

    // ── history ───────────────────────────────────────────────────────────
    'history.import.completed': {
        description: 'A history import finished, reporting files, messages, and exit code.',
        fields: [
            field('source', 'Source'),
            field('sources', 'Sources'),
            field('files', 'Files'),
            field('messages', 'Messages'),
            field('durationMs', 'Duration (ms)'),
            field('exitCode', 'Exit code'),
            field('artifactPath', 'Artifact'),
            field('cwd', 'Project root'),
        ],
        summary: ({ data }) => {
            const source = s(data, 'source') ?? s(data, 'sources');
            return source !== undefined ? `[history] import · ${source}` : '[history] import completed';
        },
        outcome: derivedFromValue('exitCode'),
    },
    'history.analyze.completed': {
        description: 'A history analyze pass finished, reporting sources, duration, and exit code.',
        fields: [
            field('source', 'Source'),
            field('sources', 'Sources'),
            field('durationMs', 'Duration (ms)'),
            field('exitCode', 'Exit code'),
            field('artifactPath', 'Artifact'),
        ],
        summary: ({ data }) => {
            const source = s(data, 'source') ?? s(data, 'sources');
            return source !== undefined ? `[history] analyze · ${source}` : '[history] analyze completed';
        },
        outcome: derivedFromValue('exitCode'),
    },
    'history.daily.failed': {
        description: 'The daily history refresh failed, carrying the detail, reason, and exit code.',
        fields: [
            field('source', 'Source'),
            field('sources', 'Sources'),
            field('detail', 'Detail'),
            field('reason', 'Reason'),
            field('exitCode', 'Exit code'),
        ],
        summary: () => '[history] daily failed',
        outcome: {
            support: 'derived',
            derive: ({ data }) => s(data, 'reason') ?? s(data, 'detail') ?? n(data, 'exitCode'),
        },
    },
    'history.refresh.enqueued': {
        description: 'A completion-triggered history refresh was enqueued, naming its window.',
        fields: [
            field('trigger', 'Trigger'),
            field('triggerId', 'Trigger id'),
            field('jobId', 'Queue job'),
            field('windowStart', 'Window start'),
            field('windowEnd', 'Window end'),
            field('coalesced', 'Coalesced'),
            field('outcome', 'Outcome'),
        ],
        summary: ({ data }) => {
            const start = s(data, 'windowStart');
            const end = s(data, 'windowEnd');
            return start !== undefined && end !== undefined
                ? `[history] refresh · ${start} -> ${end}`
                : '[history] refresh enqueued';
        },
        outcome: {
            support: 'derived',
            // Single outcome: joining a pending or in-flight job is the notable
            // result; a plain fresh enqueue is the uninteresting default.
            derive: ({ data }) => {
                const status = s(data, 'outcome');
                return status !== undefined && status !== 'enqueued' ? status : undefined;
            },
        },
    },

    // ── rule ──────────────────────────────────────────────────────────────
    'rule.run.start': {
        description: 'A rule run began with the rule count it will evaluate.',
        fields: [field('runId', 'Run'), field('ruleCount', 'Rules'), field('evaluator', 'Evaluator')],
        summary: ({ data, correlation }) => {
            const run = s(data, 'runId') ?? correlation.runId;
            return run !== undefined ? `[rule] run ${run} started` : '[rule] run started';
        },
        outcome: unsupported,
    },
    'rule.eval.start': {
        description: 'A single rule began evaluating.',
        fields: [
            field('runId', 'Run'),
            field('ruleId', 'Rule'),
            field('evaluator', 'Evaluator'),
            field('index', 'Index'),
            field('total', 'Total'),
        ],
        summary: ({ data }) => {
            const id = s(data, 'ruleId');
            return id !== undefined ? `[rule] ${id} evaluating` : '[rule] evaluating';
        },
        outcome: unsupported,
    },
    'rule.eval.done': {
        description: 'A rule finished evaluating, reporting its findings count and severity.',
        fields: [
            field('runId', 'Run'),
            field('ruleId', 'Rule'),
            field('evaluator', 'Evaluator'),
            field('findings', 'Findings'),
            field('durationMs', 'Duration (ms)'),
            field('severity', 'Severity'),
        ],
        summary: ({ data }) => {
            const id = s(data, 'ruleId');
            return id !== undefined ? `[rule] ${id} evaluated` : '[rule] evaluated';
        },
        outcome: derivedFromValue('findings'),
    },
    'rule.eval.error': {
        description: 'A rule evaluation failed with an error.',
        fields: [
            field('runId', 'Run'),
            field('ruleId', 'Rule'),
            field('evaluator', 'Evaluator'),
            field('error', 'Error'),
        ],
        summary: ({ data }) => {
            const id = s(data, 'ruleId');
            return id !== undefined ? `[rule] ${id} error` : '[rule] error';
        },
        outcome: derivedFrom('error'),
    },
    'rule.run.done': {
        description: 'A rule run finished, reporting findings and whether it stopped early.',
        fields: [
            field('runId', 'Run'),
            field('findings', 'Findings'),
            field('durationMs', 'Duration (ms)'),
            field('stoppedEarly', 'Stopped early'),
            field('severity', 'Severity'),
        ],
        summary: ({ data, correlation }) => {
            const run = s(data, 'runId') ?? correlation.runId;
            return run !== undefined ? `[rule] run ${run} done` : '[rule] run done';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => n(data, 'findings') ?? s(data, 'stoppedEarly'),
        },
    },

    // ── workflow ──────────────────────────────────────────────────────────
    'workflow.run.started': {
        description: 'A workflow run started, naming the workflow definition.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('mode', 'Mode'),
            field('dryRun', 'Dry run'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            return name !== '' ? `[workflow] ${name} started` : '[workflow] started';
        },
        outcome: unsupported,
    },
    'workflow.run.done': {
        description: 'A workflow run reached a done terminal state.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('finalState', 'Final state'),
            field('transitionsTaken', 'Transitions'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            return name !== '' ? `[workflow] ${name} done` : '[workflow] done';
        },
        outcome: derivedFrom('finalState'),
    },
    'workflow.run.failed': {
        description: 'A workflow run failed with a terminal failure reason.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('finalState', 'Final state'),
            field('reason', 'Reason'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            return name !== '' ? `[workflow] ${name} failed` : '[workflow] failed';
        },
        outcome: derivedFrom('reason'),
    },
    'workflow.run.finalized': {
        description: 'A workflow run settled on a terminal status.',
        fields: [field('runId', 'Run'), field('workflowName', 'Workflow'), field('status', 'Status')],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            return name !== '' ? `[workflow] ${name} finalized` : '[workflow] finalized';
        },
        outcome: derivedFrom('status'),
    },
    'workflow.run.paused': {
        description: 'A workflow run paused at a step, naming the step when available.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('transitionsTaken', 'Transitions'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} paused` : '[workflow] paused';
        },
        outcome: unsupported,
    },
    'workflow.run.resumed': {
        description: 'A paused workflow run resumed at a step, naming the step when available.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} resumed` : '[workflow] resumed';
        },
        outcome: unsupported,
    },
    'workflow.run.reseeded': {
        description: 'A workflow run was reseeded to a new state, naming the transition.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('fromState', 'From'),
            field('toState', 'To'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const from = s(input.data, 'fromState');
            const to = s(input.data, 'toState');
            if (from !== undefined && to !== undefined) {
                return name !== '' ? `[workflow] ${name} : ${from} -> ${to}` : `[workflow] : ${from} -> ${to}`;
            }
            return name !== '' ? `[workflow] ${name} reseeded` : '[workflow] reseeded';
        },
        outcome: derivedFrom('toState'),
    },
    'workflow.node.enter': {
        description: 'The engine entered a workflow node, naming the step when available.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('transitionsTaken', 'Transitions'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')}` : '[workflow] node entered';
        },
        outcome: unsupported,
    },
    'workflow.phase': {
        description: 'A workflow phase changed status, naming the phase.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('phase', 'Phase'),
            field('status', 'Status'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const phase = s(input.data, 'phase');
            const parts = [name, phase].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')}` : '[workflow] phase';
        },
        outcome: derivedFrom('status'),
    },
    'workflow.node.transition': {
        description: 'A workflow transitioned between nodes, naming the from and to states.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('from', 'From'),
            field('to', 'To'),
            field('trigger', 'Trigger'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const from = s(input.data, 'from');
            const to = s(input.data, 'to');
            if (from !== undefined && to !== undefined) {
                return name !== '' ? `[workflow] ${name} : ${from} -> ${to}` : `[workflow] : ${from} -> ${to}`;
            }
            return name !== '' ? `[workflow] ${name} transitioned` : '[workflow] transitioned';
        },
        outcome: derivedFrom('to'),
    },
    'workflow.transition': {
        description: 'A workflow state transition was committed.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('from', 'From'),
            field('to', 'To'),
            field('trigger', 'Trigger'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const from = s(input.data, 'from');
            const to = s(input.data, 'to');
            if (from !== undefined && to !== undefined) {
                return name !== '' ? `[workflow] ${name} : ${from} -> ${to}` : `[workflow] : ${from} -> ${to}`;
            }
            return name !== '' ? `[workflow] ${name} transitioned` : '[workflow] transitioned';
        },
        outcome: derivedFrom('to'),
    },
    'workflow.transition.requested': {
        description: 'A workflow transition was requested and accepted for evaluation.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('from', 'From'),
            field('to', 'To'),
            field('trigger', 'Trigger'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const from = s(input.data, 'from');
            const to = s(input.data, 'to');
            if (from !== undefined && to !== undefined) {
                return name !== ''
                    ? `[workflow] ${name} requested ${from} -> ${to}`
                    : `[workflow] requested ${from} -> ${to}`;
            }
            return name !== '' ? `[workflow] ${name} transition requested` : '[workflow] transition requested';
        },
        outcome: unsupported,
    },
    'workflow.transition.denied': {
        description: 'A workflow transition was denied with a reason.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('from', 'From'),
            field('to', 'To'),
            field('reason', 'Reason'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const from = s(input.data, 'from');
            const to = s(input.data, 'to');
            if (from !== undefined && to !== undefined) {
                return name !== ''
                    ? `[workflow] ${name} denied ${from} -> ${to}`
                    : `[workflow] denied ${from} -> ${to}`;
            }
            return name !== '' ? `[workflow] ${name} transition denied` : '[workflow] transition denied';
        },
        outcome: derivedFrom('reason'),
    },
    'workflow.action.start': {
        description: 'A workflow action started, naming the step and kind.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('kind', 'Kind'),
        ],
        retain: [
            field('metadata.agent', 'Agent'),
            field('metadata.role', 'Role'),
            field('routing.executor', 'Executor'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} started` : '[workflow] action started';
        },
        outcome: unsupported,
    },
    'workflow.action.started': {
        description: 'A workflow action began executing, naming the step and kind.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('actionId', 'Action'),
            field('kind', 'Kind'),
        ],
        retain: [
            field('metadata.agent', 'Agent'),
            field('metadata.role', 'Role'),
            field('routing.executor', 'Executor'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} started` : '[workflow] action started';
        },
        outcome: unsupported,
    },
    'workflow.action.done': {
        description: 'A workflow action finished successfully.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('actionId', 'Action'),
            field('kind', 'Kind'),
            field('durationMs', 'Duration (ms)'),
            field('ok', 'OK'),
        ],
        retain: [
            field('metadata.agent', 'Agent'),
            field('metadata.role', 'Role'),
            field('routing.executor', 'Executor'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} done` : '[workflow] action done';
        },
        outcome: derivedFromValue('ok'),
    },
    'workflow.action.finished': {
        description: 'A workflow action finished, reporting its status and success.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('actionId', 'Action'),
            field('kind', 'Kind'),
            field('durationMs', 'Duration (ms)'),
            field('status', 'Status'),
        ],
        retain: [
            field('metadata.agent', 'Agent'),
            field('metadata.role', 'Role'),
            field('routing.executor', 'Executor'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} finished` : '[workflow] action finished';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => s(data, 'status') ?? n(data, 'ok'),
        },
    },
    'workflow.action.failed_continue': {
        description: 'A workflow action failed but the workflow continued, carrying the error.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('transitionsTaken', 'Transitions'),
            field('error', 'Error'),
        ],
        retain: [
            field('metadata.agent', 'Agent'),
            field('metadata.role', 'Role'),
            field('routing.executor', 'Executor'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0
                ? `[workflow] ${parts.join(' · ')} failed; continuing`
                : '[workflow] action failed; continuing';
        },
        outcome: derivedFrom('error'),
    },
    'workflow.guard.evaluated': {
        description: 'A workflow guard was evaluated for a transition, reporting whether it passed.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('from', 'From'),
            field('to', 'To'),
            field('kind', 'Kind'),
            field('passed', 'Passed'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const from = s(input.data, 'from');
            const to = s(input.data, 'to');
            if (from !== undefined && to !== undefined) {
                return name !== '' ? `[workflow] ${name} guard ${from} -> ${to}` : `[workflow] guard ${from} -> ${to}`;
            }
            return name !== '' ? `[workflow] ${name} guard evaluated` : '[workflow] guard evaluated';
        },
        outcome: derivedFromValue('passed'),
    },
    'workflow.hitl.ask': {
        description: 'A workflow paused for human input, naming the step and kind.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('kind', 'Kind'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} awaiting input` : '[workflow] awaiting input';
        },
        outcome: unsupported,
    },
    'workflow.hitl.response': {
        description: 'Human input was received for a paused workflow step.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
            field('ok', 'Accepted'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} input received` : '[workflow] input received';
        },
        outcome: derivedFromValue('ok'),
    },
    'workflow.hitl.note': {
        description: 'A note was recorded on a paused workflow step.',
        fields: [
            field('runId', 'Run'),
            field('workflowName', 'Workflow'),
            field('nodeLabel', 'Step'),
            field('node', 'Node'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const step = humanStepLabel(input.data);
            const parts = [name, step].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')} note` : '[workflow] note';
        },
        outcome: unsupported,
    },
    'workflow.custom': {
        description: 'A custom workflow event was emitted, naming the custom event.',
        fields: [field('runId', 'Run'), field('workflowName', 'Workflow'), field('name', 'Event')],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const custom = s(input.data, 'name');
            const parts = [name, custom].filter((part): part is string => typeof part === 'string' && part !== '');
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')}` : '[workflow] custom';
        },
        outcome: unsupported,
    },
    'workflow.agent': {
        description: 'A workflow-dispatched agent execution lifecycle event, discriminated by kind.',
        fields: [
            field('runId', 'Run'),
            field('executionId', 'Execution'),
            field('actionId', 'Action'),
            field('kind', 'Kind'),
            field('agent', 'Agent'),
            field('model', 'Model'),
        ],
        retain: [
            field('metadata.agent', 'Agent'),
            field('metadata.role', 'Role'),
            field('routing.executor', 'Executor'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const kind = s(input.data, 'kind');
            const parts = [name, kind !== undefined ? `agent ${kind}` : 'agent'].filter(
                (part): part is string => typeof part === 'string' && part !== '',
            );
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')}` : '[workflow] agent';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => (s(data, 'kind') === 'finished' ? s(data, 'outcome') : undefined),
        },
    },
    'workflow.steering': {
        description: 'A steering command was acknowledged for a workflow action boundary.',
        fields: [
            field('runId', 'Run'),
            field('actionId', 'Action'),
            field('operation', 'Operation'),
            field('actor', 'Actor'),
            field('accepted', 'Accepted'),
            field('state', 'State'),
            field('reason', 'Reason'),
        ],
        summary: (input) => {
            const name = humanWorkflowTitle(input);
            const operation = s(input.data, 'operation');
            const parts = [name, operation !== undefined ? `steering ${operation}` : 'steering'].filter(
                (part): part is string => typeof part === 'string' && part !== '',
            );
            return parts.length > 0 ? `[workflow] ${parts.join(' · ')}` : '[workflow] steering';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => {
                const reason = s(data, 'reason');
                if (reason !== undefined) return reason;
                const accepted = at(data, 'accepted');
                if (accepted === true) return 'accepted';
                if (accepted === false) return 'rejected';
                return s(data, 'state');
            },
        },
    },

    // ── api ───────────────────────────────────────────────────────────────
    'api.request.error': {
        description: 'An API request failed, naming the method, path, and status or error code.',
        fields: [
            field('method', 'Method'),
            field('path', 'Path'),
            field('status', 'Status'),
            field('code', 'Code'),
            field('requestId', 'Request'),
            field('error', 'Error'),
        ],
        summary: ({ data }) => {
            const method = s(data, 'method');
            const path = s(data, 'path');
            return method !== undefined && path !== undefined ? `[api] ${method} ${path}` : '[api] request error';
        },
        outcome: {
            support: 'derived',
            derive: ({ data }) => s(data, 'error') ?? s(data, 'code') ?? n(data, 'status'),
        },
    },

    // ── bus ───────────────────────────────────────────────────────────────
    'bus.emit.done': {
        description: 'An event was emitted to its handlers on the event bus.',
        fields: [field('event', 'Event'), field('handlers', 'Handlers'), field('durationMs', 'Duration (ms)')],
        summary: ({ data }) => {
            const event = s(data, 'event');
            return event !== undefined ? `[bus] ${event} emitted` : '[bus] event emitted';
        },
        outcome: derivedFromValue('handlers'),
    },
    'bus.emit.noop': {
        description: 'An event was emitted but had no registered handlers.',
        fields: [field('event', 'Event'), field('handlers', 'Handlers'), field('durationMs', 'Duration (ms)')],
        summary: ({ data }) => {
            const event = s(data, 'event');
            return event !== undefined ? `[bus] ${event} had no handlers` : '[bus] event had no handlers';
        },
        outcome: derivedFromValue('handlers'),
    },
    'bus.handler.error': {
        description: 'An event-bus handler threw an error while processing an event.',
        fields: [
            field('event', 'Event'),
            field('handlers', 'Handlers'),
            field('durationMs', 'Duration (ms)'),
            field('error', 'Error'),
        ],
        summary: ({ data }) => {
            const event = s(data, 'event');
            return event !== undefined ? `[bus] ${event} handler error` : '[bus] handler error';
        },
        outcome: derivedFrom('error'),
    },
    'bus.handler.async.enqueued': {
        description: 'An event-bus handler was enqueued for asynchronous processing.',
        fields: [field('event', 'Event'), field('handlers', 'Handlers')],
        summary: ({ data }) => {
            const event = s(data, 'event');
            return event !== undefined ? `[bus] ${event} handlers enqueued` : '[bus] handlers enqueued';
        },
        outcome: derivedFromValue('handlers'),
    },
} satisfies Record<SystemEventName, SystemEventPresenterSpec>;

/**
 * Last-resort catalog default when the producer payload has no `severity`.
 * Producers in ts-libs stamp severity at emit time; do not grow this heuristic.
 */
function inferSeverity(name: string): SystemEventSeverity {
    if (/(?:failed|error|denied)$/.test(name)) return 'error';
    if (/(?:retrying|paused|dropped)$/.test(name)) return 'warning';
    return 'info';
}

/** Resolve a base policy entry into a full catalog entry whose presentation
 * (description + retained fields) comes from its matching presenter. */
function resolveCatalogEntry(base: BaseCatalogEntry): SystemEventCatalogEntry {
    const profile = SOURCE_PROFILES[base.source];
    const presenter = SYSTEM_EVENT_PRESENTERS[base.name as SystemEventName];
    return {
        name: base.name,
        prefix: base.name.split('.')[0] ?? base.name,
        source: base.source,
        // The catalog flags describe *capability*. The runtime consults
        // `tier` to decide whether to actually persist/stream — the tap
        // and SSE module don't rely on these flags, only on `tier` and
        // the runtime configuration (SPUR_DIAGNOSTIC_EVENTS).
        tier: base.tier,
        persisted: true,
        streamed: true,
        payloadPolicy: base.payloadPolicy,
        renderer: base.renderer,
        ...profile,
        // Producer attribution override: entries emitted by a Spur-owned
        // bridge (e.g. agent.invoke.escalated) attribute the spur package
        // rather than the ts-lib that owns the family (0545 R2).
        ...(base.producer !== undefined
            ? { producerPackage: base.producer.package, subsystem: base.producer.subsystem }
            : {}),
        severity: inferSeverity(base.name),
        description: presenter.description,
        metadataFields: presenter.retain
            ? [...presenter.fields, ...presenter.retain.filter((r) => !presenter.fields.some((f) => f.path === r.path))]
            : presenter.fields,
        remediationKind: profile.remediationKind,
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
 *
 * Presentation (description, retained fields, summary, outcome) is per-event in
 * {@link SYSTEM_EVENT_PRESENTERS}; this resolved array only mirrors it onto the
 * catalog shape the tap/SSE/Board consume.
 */
export const SYSTEM_EVENT_CATALOG: readonly SystemEventCatalogEntry[] = BASE_CATALOG.map(resolveCatalogEntry);

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
    producerPackage: SystemEventProducerPackage;
    subsystem: string;
    severity: SystemEventSeverity;
    description: string;
    metadataFields: readonly SystemEventMetadataField[];
    remediationKind: SystemEventRemediationKind;
}

/** Public-facing projection of {@link SYSTEM_EVENT_CATALOG} with payload fields stripped for API responses. */
export const SYSTEM_EVENT_CATALOG_METADATA: SystemEventCatalogMetadata[] = SYSTEM_EVENT_CATALOG.map(
    ({
        name,
        prefix,
        source,
        tier,
        renderer,
        producerPackage,
        subsystem,
        severity,
        description,
        metadataFields,
        remediationKind,
    }) => ({
        name,
        prefix,
        source,
        tier,
        renderer,
        producerPackage,
        subsystem,
        severity,
        description,
        metadataFields,
        remediationKind,
    }),
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
    return projectSystemEventData(entry, eventPayload, secretValues);
}

export type {
    SystemEventAction,
    SystemEventActionKind,
    SystemEventCorrelationContext,
    SystemEventEnvelopeV2,
    SystemEventProducerPackage,
    SystemEventProjectContext,
    SystemEventRemediationKind,
    SystemEventSeverity,
    SystemEventTablePresentationInput,
} from './system-event-envelope';
export {
    buildSystemEventEnvelope,
    isSystemEventEnvelopeV2,
    projectStoredSystemEventEnvelope,
    projectTablePresentation,
    SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION,
    systemEventProjectContext,
} from './system-event-envelope';
