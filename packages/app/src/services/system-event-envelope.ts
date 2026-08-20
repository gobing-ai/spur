import type { EventSeverity } from '@gobing-ai/ts-utils';
import { redactAndBound } from '../observability/agent-execution';
import {
    looksLikeOpaqueId,
    SYSTEM_EVENT_PRESENTERS,
    type SystemEventCatalogEntry,
    type SystemEventName,
    type SystemEventPresentationInput,
    type SystemEventPresenterSpec,
} from './event-names';

/** Schema version emitted by the canonical System Event envelope builder. */
export const SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION = 2 as const;

/** Package identifiers allowed to attribute a System Event producer. */
export type SystemEventProducerPackage =
    | 'spur'
    | '@gobing-ai/ts-infra'
    | '@gobing-ai/ts-runtime'
    | '@gobing-ai/ts-ai-runner'
    | '@gobing-ai/ts-rule-engine'
    | '@gobing-ai/ts-dual-workflow-engine';

/** Presentation severity exposed to System Event consumers. Same union as ts-libs producers. */
export type SystemEventSeverity = EventSeverity;
/** Supported action targets attached to a System Event presentation. */
export type SystemEventActionKind = 'command' | 'filter' | 'path';
/** Catalog strategies for deriving remediation actions from event context. */
export type SystemEventRemediationKind = 'none' | 'prefix-filter' | 'workflow-trace' | 'rule-trace';

/** Stable project identity attached to every persisted and streamed event. */
export interface SystemEventProjectContext {
    name: string;
    root: string;
}

/** Cross-system identifiers used to correlate an event with its originating work. */
export interface SystemEventCorrelationContext {
    runId?: string;
    executionId?: string;
    actionId?: string;
    entityKind?: string;
    entityId?: string;
    jobId?: string;
    sequence?: number;
}

/** Human-readable metadata rendered alongside a System Event summary. */
export interface SystemEventPresentationField {
    label: string;
    value: string;
}

/** Operator action derived from a System Event and its correlation context. */
export interface SystemEventAction {
    label: string;
    kind: SystemEventActionKind;
    value: string;
}

/** Canonical bounded payload persisted and streamed for a System Event. */
export interface SystemEventEnvelopeV2 {
    schemaVersion: typeof SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION;
    data: Record<string, unknown> | null;
    context: {
        project: SystemEventProjectContext;
        producer: {
            package: SystemEventProducerPackage;
            subsystem: string;
        };
        correlation: SystemEventCorrelationContext;
    };
    presentation: {
        severity: SystemEventSeverity;
        summary: string;
        description: string;
        fields: SystemEventPresentationField[];
        outcome?: string;
        action?: SystemEventAction;
        correlators?: string;
        actionLabel?: string;
        agent?: string;
    };
}

const MAX_STRING_LENGTH = 256;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 16;
const MAX_OBJECT_FIELDS = 32;
const MAX_TOTAL_NODES = 128;
const MAX_FIELD_KEY_LENGTH = 64;

const CORE_METADATA_PATHS = [
    'schemaVersion',
    'eventId',
    'event',
    'at',
    'timestamp',
    'actor',
    'runId',
    'executionId',
    'actionId',
    'commandId',
    'sequence',
    'correlation.runId',
    'correlation.executionId',
    'correlation.actionId',
    'entity.kind',
    'entity.id',
    'entityKind',
    'entityId',
    'jobId',
    'kind',
    'status',
    'outcome',
    'severity',
    'reason',
    'durationMs',
    'usage',
    'metadata.correlationId',
] as const;

const OMITTED_KEY =
    /^(?:args?|argv|body|command|commandline|content|details|env|environment|message|output|payload|prompt|query|response|stderr|stdin|stdout)$/;
const SECRET_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i;
const PRODUCER_PACKAGES = new Set<SystemEventProducerPackage>([
    'spur',
    '@gobing-ai/ts-infra',
    '@gobing-ai/ts-runtime',
    '@gobing-ai/ts-ai-runner',
    '@gobing-ai/ts-rule-engine',
    '@gobing-ai/ts-dual-workflow-engine',
]);
const CORRELATION_KEYS = new Set(['runId', 'executionId', 'actionId', 'entityKind', 'entityId', 'jobId', 'sequence']);
const PRESENTATION_KEYS = new Set([
    'severity',
    'summary',
    'description',
    'fields',
    'outcome',
    'action',
    'correlators',
    'actionLabel',
    'agent',
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;

interface ProjectionState {
    nodes: number;
    seen: WeakSet<object>;
    secretValues: readonly string[];
}

/** Derive the current project identity once at a composition root. */
export function systemEventProjectContext(root: string, name?: string): SystemEventProjectContext {
    const safeRoot = typeof root === 'string' ? root : '';
    const normalized = safeRoot.replace(/[\\/]+$/, '');
    const inferredName = normalized.split(/[\\/]/).at(-1) || 'unknown';
    return { name: name && name.length > 0 ? name : inferredName, root: safeRoot };
}

/** True only for the complete v2 shape written by the canonical builder. */
export function isSystemEventEnvelopeV2(value: unknown): value is SystemEventEnvelopeV2 {
    try {
        return validateSystemEventEnvelopeV2(value);
    } catch {
        return false;
    }
}

function validateSystemEventEnvelopeV2(value: unknown): value is SystemEventEnvelopeV2 {
    if (!isRecord(value) || value.schemaVersion !== SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION) return false;
    if (!hasOnlyKeys(value, new Set(['schemaVersion', 'data', 'context', 'presentation']))) return false;
    if (!isRecord(value.context) || !isRecord(value.presentation)) return false;
    if (!isRecord(value.context.project) || !isRecord(value.context.producer) || !isRecord(value.context.correlation)) {
        return false;
    }
    if (!hasOnlyKeys(value.context, new Set(['project', 'producer', 'correlation']))) return false;
    if (!hasOnlyKeys(value.context.project, new Set(['name', 'root']))) return false;
    if (!hasOnlyKeys(value.context.producer, new Set(['package', 'subsystem']))) return false;
    if (!hasOnlyKeys(value.context.correlation, CORRELATION_KEYS)) return false;
    if (!hasOnlyKeys(value.presentation, PRESENTATION_KEYS)) return false;
    if (!isBoundedString(value.context.project.name, 129) || !isBoundedString(value.context.project.root)) return false;
    if (!PRODUCER_PACKAGES.has(value.context.producer.package as SystemEventProducerPackage)) return false;
    if (!isBoundedString(value.context.producer.subsystem, 128)) return false;
    if (!isValidCorrelation(value.context.correlation)) return false;
    if (!isValidPresentation(value.presentation)) return false;
    return value.data === null || (isRecord(value.data) && isBoundedProjectedValue(value.data));
}

/**
 * Build the one persisted/streamed System Event envelope. This function never
 * throws: malformed payloads and hostile getters degrade to a bounded generic
 * envelope so observability cannot fail the product operation.
 */
export function buildSystemEventEnvelope(
    entry: SystemEventCatalogEntry | undefined,
    eventPayload: unknown,
    project: SystemEventProjectContext,
    secretValues: readonly string[] = [],
    actor?: string | null,
): SystemEventEnvelopeV2 {
    try {
        const data = projectSystemEventData(entry, eventPayload, secretValues);
        const correlation = extractEnvelopeCorrelation(eventPayload, secretValues);
        const severity = extractSeverity(eventPayload) ?? entry?.severity ?? 'warning';
        const presentation = buildPresentation(entry, data, correlation, severity, actor);

        return {
            schemaVersion: SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION,
            data,
            context: {
                project: boundedProjectContext(project, secretValues),
                producer: {
                    package: entry?.producerPackage ?? 'spur',
                    subsystem: entry?.subsystem ?? 'unknown',
                },
                correlation,
            },
            presentation,
        };
    } catch {
        return genericEnvelope(project, secretValues);
    }
}

/** Preserve canonical persisted rows; adapt every legacy/raw row through the builder. */
export function projectStoredSystemEventEnvelope(
    entry: SystemEventCatalogEntry | undefined,
    storedPayload: unknown,
    project: SystemEventProjectContext,
    secretValues: readonly string[] = [],
    actor?: string | null,
): SystemEventEnvelopeV2 {
    try {
        if (!isRecord(storedPayload) || storedPayload.schemaVersion !== SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION) {
            return buildSystemEventEnvelope(entry, storedPayload, project, secretValues, actor);
        }
        if (!isSystemEventEnvelopeV2(storedPayload)) return genericEnvelope(project, secretValues);
        const stored = storedPayload as SystemEventEnvelopeV2;
        // Valid v2 rows keep their stored schemaVersion, data, and context
        // byte-for-byte; only the derived presentation is recomputed from the
        // current exhaustive presenter over the stored bounded data (R1/R9).
        // The DAO is never written here.
        const presentation = buildPresentation(
            entry,
            stored.data,
            stored.context.correlation,
            stored.presentation.severity,
            actor,
        );
        return { ...stored, presentation };
    } catch {
        return genericEnvelope(project, secretValues);
    }
}

/** Project a domain payload according to the catalog's bounded field policy. */
export function projectSystemEventData(
    entry: SystemEventCatalogEntry | undefined,
    eventPayload: unknown,
    secretValues: readonly string[] = [],
): Record<string, unknown> | null {
    if (eventPayload === null || eventPayload === undefined) return null;
    const state: ProjectionState = { nodes: 0, seen: new WeakSet(), secretValues };
    if (!isRecord(eventPayload)) {
        const value = projectValue(eventPayload, state, 0);
        return value === undefined ? null : { value };
    }

    if (!entry) return null;
    if (entry.payloadPolicy !== 'raw-safe') return projectAllowedMetadata(entry, eventPayload, state);

    const result: Record<string, unknown> = {};
    for (const [key, value] of safeEntries(eventPayload).slice(0, MAX_OBJECT_FIELDS)) {
        const projected = projectKeyValue(key, value, state, 0);
        if (projected !== undefined) result[boundedKey(key)] = projected;
    }
    return result;
}

function projectAllowedMetadata(
    entry: SystemEventCatalogEntry,
    eventPayload: Record<string, unknown>,
    state: ProjectionState,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const paths = new Set<string>([...CORE_METADATA_PATHS, ...entry.metadataFields.map((field) => field.path)]);
    for (const path of paths) {
        const value = getPath(eventPayload, path);
        if (value === undefined) continue;
        const key = path.split('.').at(-1) ?? path;
        const projected = projectKeyValue(key, value, state, path.split('.').length - 1);
        if (projected !== undefined) setPath(result, path, projected);
    }
    return result;
}

function projectKeyValue(key: string, value: unknown, state: ProjectionState, depth: number): unknown {
    if (isOmittedKey(key)) return undefined;
    if ((key === 'findings' || key === 'finding') && typeof value === 'object') return undefined;
    if (SECRET_KEY.test(key)) return '[REDACTED]';
    return projectValue(value, state, depth);
}

function projectValue(value: unknown, state: ProjectionState, depth: number): unknown {
    if (state.nodes >= MAX_TOTAL_NODES || depth > MAX_DEPTH) return '[truncated]';
    state.nodes += 1;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') return redactAndBound(value, state.secretValues, MAX_STRING_LENGTH);
    if (typeof value === 'bigint') return redactAndBound(String(value), state.secretValues, MAX_STRING_LENGTH);
    if (typeof value !== 'object') return undefined;
    if (state.seen.has(value)) return '[circular]';
    state.seen.add(value);

    if (Array.isArray(value)) {
        const result: unknown[] = [];
        for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
            const projected = projectValue(item, state, depth + 1);
            if (projected !== undefined) result.push(projected);
        }
        if (value.length > MAX_ARRAY_ITEMS) result.push('[truncated]');
        return result;
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of safeEntries(value).slice(0, MAX_OBJECT_FIELDS)) {
        const projected = projectKeyValue(key, item, state, depth + 1);
        if (projected !== undefined) result[boundedKey(key)] = projected;
    }
    return result;
}

function extractEnvelopeCorrelation(
    eventPayload: unknown,
    secretValues: readonly string[],
): SystemEventCorrelationContext {
    if (!isRecord(eventPayload)) return {};
    const nested = isRecord(eventPayload.correlation) ? eventPayload.correlation : {};
    const entity = isRecord(eventPayload.entity) ? eventPayload.entity : {};
    const result: SystemEventCorrelationContext = {};
    assignString(result, 'runId', eventPayload.runId ?? eventPayload.run_id ?? nested.runId, secretValues);
    assignString(result, 'executionId', eventPayload.executionId ?? nested.executionId, secretValues);
    assignString(result, 'actionId', eventPayload.actionId ?? nested.actionId, secretValues);
    assignString(result, 'entityKind', eventPayload.entityKind ?? entity.kind, secretValues);
    assignString(result, 'entityId', eventPayload.entityId ?? entity.id, secretValues);
    assignString(result, 'jobId', eventPayload.jobId, secretValues);
    const sequence = eventPayload.sequence;
    if (typeof sequence === 'number' && Number.isFinite(sequence)) result.sequence = sequence;
    return result;
}

function assignString(
    target: SystemEventCorrelationContext,
    key: keyof Omit<SystemEventCorrelationContext, 'sequence'>,
    value: unknown,
    secretValues: readonly string[],
): void {
    if (typeof value !== 'string' || value.length === 0) return;
    target[key] = redactAndBound(value, secretValues, 128);
}

/** Inputs to the server-owned table presentation projector (ADR-073/074). */
export interface SystemEventTablePresentationInput {
    entry?: SystemEventCatalogEntry;
    data: Record<string, unknown> | null;
    correlation: SystemEventCorrelationContext;
    presentation: {
        severity: SystemEventSeverity;
        summary: string;
        description: string;
        fields: SystemEventPresentationField[];
        outcome?: string;
        action?: SystemEventAction;
    };
    actor?: string | null;
}

/**
 * Projects human-readable table presentation strings (correlators, actionLabel, agent)
 * without opaque identifiers (ADR-073 / ADR-074).
 */
export function projectTablePresentation(input: SystemEventTablePresentationInput): {
    correlators?: string;
    actionLabel?: string;
    agent?: string;
} {
    const { entry, data, correlation, presentation, actor } = input;
    const name = entry?.name ?? '';

    // Pure engine rows omit Agent even when producer is @gobing-ai/ts-dual-workflow-engine (ADR-074)
    const isPureEngineRow =
        name === 'workflow.node.enter' ||
        name === 'workflow.transition' ||
        name === 'workflow.node.transition' ||
        name === 'workflow.transition.requested' ||
        name === 'workflow.transition.denied' ||
        name === 'workflow.run.started' ||
        name === 'workflow.run.done' ||
        name === 'workflow.run.failed' ||
        name === 'workflow.run.finalized' ||
        name === 'workflow.run.paused' ||
        name === 'workflow.run.resumed' ||
        name === 'workflow.run.reseeded';

    // Agent projection precedence:
    // 1. data.routing.executor
    // 2. data.agent
    // 3. data.metadata.agent
    // 4. persistence-row actor (when matching ^[A-Za-z][A-Za-z0-9._-]*$, not opaque, and not a producer package)
    let agent: string | undefined;
    if (!isPureEngineRow && data !== null) {
        const executor = getPath(data, 'routing.executor');
        const agentField = getPath(data, 'agent');
        const metadataAgent = getPath(data, 'metadata.agent');
        if (typeof executor === 'string' && executor.length > 0 && !looksLikeOpaqueId(executor)) {
            agent = executor;
        } else if (typeof agentField === 'string' && agentField.length > 0 && !looksLikeOpaqueId(agentField)) {
            agent = agentField;
        } else if (typeof metadataAgent === 'string' && metadataAgent.length > 0 && !looksLikeOpaqueId(metadataAgent)) {
            agent = metadataAgent;
        }
    }
    if (!isPureEngineRow && agent === undefined && typeof actor === 'string' && actor.length > 0) {
        if (
            /^[A-Za-z][A-Za-z0-9._:-]*$/.test(actor) &&
            !PRODUCER_PACKAGES.has(actor as SystemEventProducerPackage) &&
            !looksLikeOpaqueId(actor)
        ) {
            agent = actor;
        }
    }

    // Correlators: join human facts already in bounded data
    // (workflowName, nodeLabel, action kind, entity kind:id, numeric sequence)
    // Forbidden: runId, executionId, actionId, eventId, UUID node, live- tokens, context.correlation UUIDs
    const corrParts: string[] = [];
    if (data !== null) {
        const wfName = getPath(data, 'workflowName');
        if (typeof wfName === 'string' && wfName.length > 0 && !looksLikeOpaqueId(wfName)) {
            corrParts.push(wfName);
        }
        const nodeLabel = getPath(data, 'nodeLabel');
        if (typeof nodeLabel === 'string' && nodeLabel.length > 0 && !looksLikeOpaqueId(nodeLabel)) {
            corrParts.push(nodeLabel);
        }
        const kind = getPath(data, 'kind');
        if (
            typeof kind === 'string' &&
            kind.length > 0 &&
            !looksLikeOpaqueId(kind) &&
            kind !== wfName &&
            kind !== nodeLabel
        ) {
            corrParts.push(kind);
        }
        const entityKind = getPath(data, 'entity.kind') ?? getPath(data, 'entityKind') ?? correlation.entityKind;
        const entityId = getPath(data, 'entity.id') ?? getPath(data, 'entityId') ?? correlation.entityId;
        if (typeof entityId === 'string' && entityId.length > 0 && !looksLikeOpaqueId(entityId)) {
            if (typeof entityKind === 'string' && entityKind.length > 0 && !looksLikeOpaqueId(entityKind)) {
                corrParts.push(`${entityKind}:${entityId}`);
            } else {
                corrParts.push(entityId);
            }
        }
    } else {
        const entityKind = correlation.entityKind;
        const entityId = correlation.entityId;
        if (typeof entityId === 'string' && entityId.length > 0 && !looksLikeOpaqueId(entityId)) {
            if (typeof entityKind === 'string' && entityKind.length > 0 && !looksLikeOpaqueId(entityKind)) {
                corrParts.push(`${entityKind}:${entityId}`);
            } else {
                corrParts.push(entityId);
            }
        }
    }
    if (typeof correlation.sequence === 'number' && Number.isFinite(correlation.sequence)) {
        corrParts.push(`#${correlation.sequence}`);
    }
    const correlators = corrParts.length > 0 ? corrParts.join(' · ') : undefined;

    // ActionLabel: action kind, entity, or short human verb
    // Never a remediation command that embeds a UUID
    let actionLabel: string | undefined;
    if (data !== null) {
        const kind = getPath(data, 'kind');
        const op = getPath(data, 'operation') ?? getPath(data, 'action');
        if (typeof kind === 'string' && kind.length > 0 && !looksLikeOpaqueId(kind)) {
            actionLabel = kind;
        } else if (typeof op === 'string' && op.length > 0 && !looksLikeOpaqueId(op)) {
            actionLabel = op;
        }
    }
    if (actionLabel === undefined && presentation.action?.kind === 'filter' && presentation.action.label) {
        actionLabel = presentation.action.label;
    }

    return {
        ...(correlators !== undefined ? { correlators: boundPresentationString(correlators, 512) } : {}),
        ...(actionLabel !== undefined ? { actionLabel: boundPresentationString(actionLabel, 128) } : {}),
        ...(agent !== undefined ? { agent: boundPresentationString(agent, 128) } : {}),
    };
}

/**
 * Build the presentation block for a system event from its exhaustive presenter.
 *
 * Every cataloged name resolves to one presenter; unknown names and presenter
 * exceptions fall back to the bounded generic presentation (failure isolation).
 * Presenter outputs (summary/description/outcome) are bounded again here before
 * they enter the envelope so hostile or oversized output can never escape the
 * persisted/streamed bounds (R1).
 */
function buildPresentation(
    entry: SystemEventCatalogEntry | undefined,
    data: Record<string, unknown> | null,
    correlation: SystemEventCorrelationContext,
    severity: SystemEventSeverity,
    actor?: string | null,
): SystemEventEnvelopeV2['presentation'] {
    const presenter = entry === undefined ? undefined : SYSTEM_EVENT_PRESENTERS[entry.name as SystemEventName];
    if (entry === undefined || presenter === undefined) {
        return genericPresentation(severity);
    }
    const input: SystemEventPresentationInput = { data, correlation };
    let summary: string;
    let description: string;
    let outcome: string | undefined;
    let fields: SystemEventPresentationField[];
    try {
        summary = presenter.summary(input);
        description = presenter.description;
        fields = buildPresenterFields(presenter, data);
        if (presenter.outcome.support === 'derived') {
            outcome = presenter.outcome.derive(input);
        }
    } catch {
        return genericPresentation(severity);
    }
    const basePresentation = {
        severity,
        summary: boundPresentationString(summary, 512) ?? 'System event',
        description: boundPresentationString(description, 512) ?? 'System event.',
        fields,
        ...(outcome !== undefined ? { outcome: boundPresentationString(outcome, 128) } : {}),
        ...buildAction(entry, correlation),
    };
    const tablePresentation = projectTablePresentation({
        entry,
        data,
        correlation,
        presentation: basePresentation,
        actor,
    });
    return {
        ...basePresentation,
        ...tablePresentation,
    };
}

/** Render the presenter's ordered field allow-list against the bounded data. */
function buildPresenterFields(
    presenter: SystemEventPresenterSpec,
    data: Record<string, unknown> | null,
): SystemEventPresentationField[] {
    if (!data) return [];
    const fields: SystemEventPresentationField[] = [];
    for (const field of presenter.fields.slice(0, 8)) {
        const value = getPath(data, field.path);
        const rendered = renderFieldValue(value);
        if (rendered !== undefined) fields.push({ label: field.label, value: rendered });
    }
    return fields;
}

/** Bound a presenter-produced string, truncating to the given maximum length. */
function boundPresentationString(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

/** The generic presentation fallback for unknown/malformed events (R1). */
function genericPresentation(severity: SystemEventSeverity): SystemEventEnvelopeV2['presentation'] {
    return {
        severity,
        summary: 'Unknown system event',
        description: 'Unknown system event with bounded metadata.',
        fields: [],
    };
}

function buildAction(
    entry: SystemEventCatalogEntry | undefined,
    correlation: SystemEventCorrelationContext,
): { action?: SystemEventAction } {
    if (!entry) return {};
    if (entry.remediationKind === 'workflow-trace' && isSafeIdentifier(correlation.runId)) {
        return {
            action: {
                label: 'Trace workflow run',
                kind: 'command',
                value: `spur workflow trace ${correlation.runId}`,
            },
        };
    }
    if (entry.remediationKind === 'rule-trace' && isSafeIdentifier(correlation.runId)) {
        return {
            action: {
                label: 'Trace rule run',
                kind: 'command',
                value: `spur rule trace ${correlation.runId}`,
            },
        };
    }
    if (entry.remediationKind === 'prefix-filter') {
        return {
            action: { label: `Filter ${entry.prefix} events`, kind: 'filter', value: `prefix=${entry.prefix}` },
        };
    }
    return {};
}

function extractSeverity(eventPayload: unknown): SystemEventSeverity | undefined {
    if (!isRecord(eventPayload)) return undefined;
    return eventPayload.severity === 'info' || eventPayload.severity === 'warning' || eventPayload.severity === 'error'
        ? eventPayload.severity
        : undefined;
}

function boundedProjectContext(
    project: SystemEventProjectContext,
    secretValues: readonly string[],
): SystemEventProjectContext {
    return {
        name: redactAndBound(project.name || 'unknown', secretValues, 128),
        root: redactAndBound(project.root || '', secretValues, MAX_STRING_LENGTH),
    };
}

function genericEnvelope(project: SystemEventProjectContext, secretValues: readonly string[]): SystemEventEnvelopeV2 {
    return {
        schemaVersion: SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION,
        data: null,
        context: {
            project: boundedProjectContext(project, secretValues),
            producer: { package: 'spur', subsystem: 'unknown' },
            correlation: {},
        },
        presentation: {
            severity: 'warning',
            summary: 'Unknown system event',
            description: 'Unknown system event with bounded metadata.',
            fields: [],
        },
    };
}

function getPath(value: Record<string, unknown>, path: string): unknown {
    let current: unknown = value;
    for (const segment of path.split('.')) {
        if (!isRecord(current)) return undefined;
        current = current[segment];
    }
    return current;
}

function renderFieldValue(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
    return undefined;
}

function isSafeIdentifier(value: string | undefined): value is string {
    return typeof value === 'string' && SAFE_IDENTIFIER.test(value);
}

function isOmittedKey(key: string): boolean {
    const normalized = key.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase();
    return OMITTED_KEY.test(normalized);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const segments = path.split('.');
    let current = target;
    for (const segment of segments.slice(0, -1)) {
        const existing = current[segment];
        if (isRecord(existing)) {
            current = existing;
            continue;
        }
        const nested: Record<string, unknown> = {};
        current[segment] = nested;
        current = nested;
    }
    const finalSegment = segments.at(-1);
    if (finalSegment) current[finalSegment] = value;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
    return safeEntries(value).every(([key]) => allowed.has(key));
}

function isBoundedString(value: unknown, maxLength = MAX_STRING_LENGTH + 1): value is string {
    return typeof value === 'string' && value.length <= maxLength;
}

function isValidCorrelation(value: Record<string, unknown>): boolean {
    for (const [key, item] of safeEntries(value)) {
        if (key === 'sequence') {
            if (typeof item !== 'number' || !Number.isFinite(item)) return false;
        } else if (!isBoundedString(item, 129)) {
            return false;
        }
    }
    return true;
}

function isValidPresentation(value: Record<string, unknown>): boolean {
    if (value.severity !== 'info' && value.severity !== 'warning' && value.severity !== 'error') return false;
    if (!isBoundedString(value.summary, 512) || !isBoundedString(value.description, 512)) return false;
    if (!Array.isArray(value.fields) || value.fields.length > 8) return false;
    for (const field of value.fields) {
        if (!isRecord(field) || !hasOnlyKeys(field, new Set(['label', 'value']))) return false;
        if (!isBoundedString(field.label, 128) || !isBoundedString(field.value)) return false;
    }
    if (value.outcome !== undefined && !isBoundedString(value.outcome, 129)) return false;
    if (value.action !== undefined && !isValidAction(value.action)) return false;
    if (value.correlators !== undefined && !isBoundedString(value.correlators, 513)) return false;
    if (value.actionLabel !== undefined && !isBoundedString(value.actionLabel, 129)) return false;
    if (value.agent !== undefined && !isBoundedString(value.agent, 129)) return false;
    return true;
}

function isValidAction(value: unknown): value is SystemEventAction {
    if (!isRecord(value) || !hasOnlyKeys(value, new Set(['label', 'kind', 'value']))) return false;
    if (!isBoundedString(value.label, 128) || !isBoundedString(value.value)) return false;
    if (value.kind !== 'command' && value.kind !== 'filter' && value.kind !== 'path') return false;
    if (value.kind === 'command') return /^spur (?:rule|workflow) trace [A-Za-z0-9._:-]+$/.test(value.value);
    if (value.kind === 'filter') return /^prefix=[A-Za-z0-9._:-]+$/.test(value.value);
    return !/[\r\n\0]/.test(value.value);
}

function isBoundedProjectedValue(value: unknown): boolean {
    const state = { nodes: 0, seen: new WeakSet<object>() };
    return validateProjectedValue(value, state, 0);
}

function validateProjectedValue(
    value: unknown,
    state: { nodes: number; seen: WeakSet<object> },
    depth: number,
): boolean {
    if (depth > MAX_DEPTH && value !== '[truncated]') return false;
    if (state.nodes >= MAX_TOTAL_NODES + MAX_OBJECT_FIELDS * MAX_DEPTH) return false;
    state.nodes += 1;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.length <= MAX_STRING_LENGTH + 1;
    if (typeof value !== 'object' || state.seen.has(value)) return false;
    state.seen.add(value);
    if (Array.isArray(value)) {
        return (
            value.length <= MAX_ARRAY_ITEMS + 1 && value.every((item) => validateProjectedValue(item, state, depth + 1))
        );
    }
    const entries = safeEntries(value);
    if (entries.length > MAX_OBJECT_FIELDS) return false;
    return entries.every(
        ([key, item]) =>
            key.length <= MAX_FIELD_KEY_LENGTH &&
            (!isOmittedKey(key) || (key === 'value' && typeof item !== 'object')) &&
            !SECRET_KEY.test(key) &&
            validateProjectedValue(item, state, depth + 1),
    );
}

function boundedKey(key: string): string {
    return key.length <= MAX_FIELD_KEY_LENGTH ? key : `${key.slice(0, MAX_FIELD_KEY_LENGTH - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeEntries(value: object): Array<[string, unknown]> {
    try {
        return Object.entries(value);
    } catch {
        return [];
    }
}
