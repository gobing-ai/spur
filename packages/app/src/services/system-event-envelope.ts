import { redactAndBound } from '../observability/agent-execution';
import type { SystemEventCatalogEntry } from './event-names';

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

/** Presentation severity exposed to System Event consumers. */
export type SystemEventSeverity = 'info' | 'warning' | 'error';
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
const PRESENTATION_KEYS = new Set(['severity', 'summary', 'description', 'fields', 'outcome', 'action']);
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
): SystemEventEnvelopeV2 {
    try {
        const data = projectSystemEventData(entry, eventPayload, secretValues);
        const correlation = extractEnvelopeCorrelation(eventPayload, secretValues);
        const severity = extractSeverity(eventPayload) ?? entry?.severity ?? 'warning';
        const outcome = firstBoundedString(eventPayload, ['outcome', 'status', 'reason'], secretValues);
        const presentation = {
            severity,
            summary: buildSummary(entry, correlation, outcome),
            description: entry?.description ?? 'Unknown system event with bounded metadata.',
            fields: buildPresentationFields(entry, data),
            ...(outcome !== undefined ? { outcome } : {}),
            ...buildAction(entry, correlation),
        };

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
): SystemEventEnvelopeV2 {
    try {
        if (isSystemEventEnvelopeV2(storedPayload)) return storedPayload;
        if (!isRecord(storedPayload) || storedPayload.schemaVersion !== SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION) {
            return buildSystemEventEnvelope(entry, storedPayload, project, secretValues);
        }
        return genericEnvelope(project, secretValues);
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

function buildPresentationFields(
    entry: SystemEventCatalogEntry | undefined,
    data: Record<string, unknown> | null,
): SystemEventPresentationField[] {
    if (!entry || !data) return [];
    const fields: SystemEventPresentationField[] = [];
    for (const field of entry.metadataFields.slice(0, 8)) {
        const value = getPath(data, field.path);
        const rendered = renderFieldValue(value);
        if (rendered !== undefined) fields.push({ label: field.label, value: rendered });
    }
    return fields;
}

function buildSummary(
    entry: SystemEventCatalogEntry | undefined,
    correlation: SystemEventCorrelationContext,
    outcome: string | undefined,
): string {
    const label = entry ? humanizeEventName(entry.name) : 'Unknown system event';
    const identity = correlation.entityId ?? correlation.runId ?? correlation.jobId;
    return [label, identity, outcome].filter((part): part is string => Boolean(part)).join(' · ');
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

function firstBoundedString(
    eventPayload: unknown,
    keys: readonly string[],
    secretValues: readonly string[],
): string | undefined {
    if (!isRecord(eventPayload)) return undefined;
    for (const key of keys) {
        const value = eventPayload[key];
        if (typeof value === 'string' && value.length > 0) return redactAndBound(value, secretValues, 128);
        if (typeof value === 'boolean' || typeof value === 'number') return String(value);
    }
    return undefined;
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

function humanizeEventName(name: string): string {
    const words = name.replaceAll('.', ' ').replaceAll('_', ' ');
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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
