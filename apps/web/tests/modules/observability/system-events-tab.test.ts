import { describe, expect, test } from 'bun:test';
import {
    displayValue,
    formatDuration,
    historyUrl,
    parseHistoryResponse,
    parseHistoryRow,
    parseSystemEventView,
} from '../../../src/modules/observability/SystemEventsTab';

describe('formatDuration', () => {
    test('returns null for non-numeric, NaN, Infinity, and non-finite values', () => {
        expect(formatDuration(undefined)).toBeNull();
        expect(formatDuration(null)).toBeNull();
        expect(formatDuration('100')).toBeNull();
        expect(formatDuration(Number.NaN)).toBeNull();
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
        expect(formatDuration(Number.NEGATIVE_INFINITY)).toBeNull();
    });

    test('renders sub-second durations as "<ms>ms"', () => {
        expect(formatDuration(0)).toBe('0ms');
        expect(formatDuration(42)).toBe('42ms');
        expect(formatDuration(999)).toBe('999ms');
    });

    test('renders >=1s durations as "<s>s" with one decimal', () => {
        expect(formatDuration(1000)).toBe('1.0s');
        expect(formatDuration(1500)).toBe('1.5s');
        expect(formatDuration(65_000)).toBe('65.0s');
    });
});

describe('parseSystemEventView', () => {
    const envelope = {
        schemaVersion: 2,
        data: { runId: 'run-42' },
        context: {
            project: { name: 'spur-new', root: '/workspace/spur-new' },
            producer: { package: '@gobing-ai/ts-dual-workflow-engine', subsystem: 'workflow' },
            correlation: { runId: 'run-42', actionId: 'action-7' },
        },
        presentation: {
            severity: 'error',
            summary: 'Workflow action failed',
            description: 'The workflow action failed and needs inspection.',
            fields: [{ label: 'Node', value: 'verify' }],
            outcome: 'failed',
            action: { label: 'Trace workflow run', kind: 'command', value: 'spur workflow trace run-42' },
        },
    };

    test('projects canonical semantics without event-family branches', () => {
        for (const eventName of [
            'task.updated',
            'queue.job.failed',
            'workflow.action.done',
            'rule.eval.error',
            'agent.invoke.exit',
            'process.exited',
        ]) {
            const view = parseSystemEventView(eventName, envelope);
            expect(view.severity).toBe('error');
            expect(view.summary).toBe('Workflow action failed');
            expect(view.projectName).toBe('spur-new');
            expect(view.producer).toBe('@gobing-ai/ts-dual-workflow-engine / workflow');
            expect(view.correlation).toBe('unavailable');
            expect(view.correlation).not.toContain('run-42');
            expect(view.actionLabel).toBe('unavailable');
            expect(view.actionLabel).not.toContain('run-42');
            expect(view.fields).toEqual([{ label: 'Node', value: 'verify' }]);
            expect(view.action?.value).toBe('spur workflow trace run-42');
            expect(view.correlationFields.some((field) => field.value === 'run-42')).toBe(true);
        }
    });

    test('bounds display strings and rejects malformed actions', () => {
        const view = parseSystemEventView('workflow.action.done', {
            ...envelope,
            presentation: {
                ...envelope.presentation,
                summary: 'x'.repeat(900),
                action: { label: 'unsafe', kind: 'command', value: 42 },
            },
        });
        expect(view.summary.length).toBe(512);
        expect(view.summary.endsWith('…')).toBe(true);
        expect(view.action).toBeNull();
    });

    test('maps server-projected table presentation fields (correlators, actionLabel, agent)', () => {
        const view = parseSystemEventView('workflow.action.done', {
            ...envelope,
            presentation: {
                ...envelope.presentation,
                correlators: 'task-pipeline · Implement · task:0605 · #1',
                actionLabel: 'agent.run',
                agent: 'sp:super-coder',
            },
        });
        expect(view.correlation).toBe('task-pipeline · Implement · task:0605 · #1');
        expect(view.actionLabel).toBe('agent.run');
        expect(view.agent).toBe('sp:super-coder');
        expect(view.correlation).not.toContain('run-42');
        expect(view.actionLabel).not.toBe('Trace workflow run');
    });

    test('returns an explicit unavailable fallback for legacy and malformed envelopes', () => {
        for (const payload of [null, {}, { schemaVersion: 2, context: null, presentation: {} }]) {
            const view = parseSystemEventView('unknown.event', payload);
            expect(view.summary).toBe('unavailable');
            expect(view.projectName).toBe('unavailable');
            expect(view.correlation).toBe('unavailable');
            expect(view.outcome).toBe('unavailable');
            expect(view.action).toBeNull();
            expect(view.actionLabel).toBe('unavailable');
            expect(view.agent).toBeNull();
        }
    });
});

describe('displayValue', () => {
    test('renders the Board glyph for missing and unavailable sentinels', () => {
        expect(displayValue('unavailable')).toBe('-');
        expect(displayValue(null)).toBe('-');
        expect(displayValue(undefined)).toBe('-');
        expect(displayValue('')).toBe('-');
        expect(displayValue('spur / test')).toBe('spur / test');
    });
});

describe('parseHistoryRow', () => {
    test('parses canonical semantics once and preserves the data projection for sibling tabs', () => {
        const row = parseHistoryRow({
            id: 'evt-v2',
            eventName: 'queue.job.completed',
            occurredAt: '2026-08-12T00:00:00Z',
            actor: null,
            payload: {
                schemaVersion: 2,
                data: { jobId: 'job-1', type: 'cleanup' },
                context: {
                    project: { name: 'spur-new', root: '/workspace/spur-new' },
                    producer: { package: '@gobing-ai/ts-infra', subsystem: 'queue' },
                    correlation: { jobId: 'job-1' },
                },
                presentation: {
                    severity: 'info',
                    summary: 'Queue job completed',
                    description: 'The queue job completed.',
                    fields: [{ label: 'Job', value: 'job-1' }],
                    outcome: 'completed',
                },
            },
        });
        expect(row?.payload).toEqual({ jobId: 'job-1', type: 'cleanup' });
        expect(row?.envelope?.schemaVersion).toBe(2);
        expect(row?.view?.summary).toBe('Queue job completed');
        expect(row?.view?.correlation).toBe('unavailable');
        expect(row?.view?.correlationFields.some((field) => field.value === 'job-1')).toBe(true);
    });

    test('parses a well-formed row with all fields', () => {
        const row = parseHistoryRow({
            id: 'evt_1',
            eventName: 'task.updated',
            occurredAt: '2025-01-01T00:00:00Z',
            actor: 'agent-alpha',
            prefix: 'task',
            renderer: 'planning',
            payload: { entityId: 't1', to: 'wip' },
            runId: 'run_42',
            entityKind: 'task',
            entityId: '0001',
            sequence: 7,
        });
        expect(row).not.toBeNull();
        expect(row?.id).toBe('evt_1');
        expect(row?.eventName).toBe('task.updated');
        expect(row?.occurredAt).toBe('2025-01-01T00:00:00Z');
        expect(row?.actor).toBe('agent-alpha');
        expect(row?.prefix).toBe('task');
        expect(row?.renderer).toBe('planning');
        expect(row?.payload).toEqual({ entityId: 't1', to: 'wip' });
        expect(row?.runId).toBe('run_42');
        expect(row?.entityKind).toBe('task');
        expect(row?.entityId).toBe('0001');
        expect(row?.sequence).toBe(7);
    });

    test('parses a minimal row without optional fields', () => {
        const row = parseHistoryRow({
            id: 'evt_2',
            eventName: 'bus.subscribe',
            occurredAt: '2025-01-01T00:00:00Z',
            actor: null,
            payload: null,
        });
        expect(row).not.toBeNull();
        expect(row?.actor).toBeNull();
        expect(row?.payload).toBeNull();
        expect(row?.runId).toBeUndefined();
        expect(row?.entityKind).toBeUndefined();
        expect(row?.entityId).toBeUndefined();
        expect(row?.sequence).toBeUndefined();
    });

    test('handles nullable correlation columns (pre-0369 rows)', () => {
        const row = parseHistoryRow({
            id: 'evt_3',
            eventName: 'task.updated',
            occurredAt: '2025-01-01T00:00:00Z',
            actor: null,
            payload: {},
            runId: null,
            entityKind: null,
            entityId: null,
            sequence: null,
        });
        expect(row).not.toBeNull();
        expect(row?.runId).toBeNull();
        expect(row?.entityKind).toBeNull();
        expect(row?.entityId).toBeNull();
        expect(row?.sequence).toBeNull();
    });

    test('returns null for missing required fields', () => {
        expect(parseHistoryRow(null)).toBeNull();
        expect(parseHistoryRow(undefined)).toBeNull();
        expect(parseHistoryRow({})).toBeNull();
        expect(parseHistoryRow({ id: 'x' })).toBeNull();
        expect(parseHistoryRow({ id: 'x', eventName: 'e' })).toBeNull();
        expect(parseHistoryRow({ id: 123, eventName: 'e', occurredAt: 't' })).toBeNull();
        expect(parseHistoryRow({ id: 'x', eventName: 123, occurredAt: 't' })).toBeNull();
        expect(parseHistoryRow({ id: 'x', eventName: 'e', occurredAt: 123 })).toBeNull();
    });

    test('returns null for non-object payload that is not null', () => {
        const row = parseHistoryRow({
            id: 'x',
            eventName: 'e',
            occurredAt: 't',
            actor: null,
            payload: 'not-an-object',
        });
        expect(row).toBeNull();
    });

    test('returns null for non-string/non-null actor', () => {
        const row = parseHistoryRow({
            id: 'x',
            eventName: 'e',
            occurredAt: 't',
            actor: 42,
            payload: null,
        });
        expect(row).toBeNull();
    });
});

describe('parseHistoryResponse', () => {
    test('parses a complete response with pagination fields', () => {
        const body = parseHistoryResponse({
            events: [{ id: 'e1', eventName: 'task.updated', occurredAt: 't1', actor: null, payload: null }],
            count: 1,
            nextCursor: 'opaque-cursor',
            hasMore: true,
            catalog: [
                { name: 'task.updated', prefix: 'task', source: 'planning', renderer: 'planning', tier: 'default' },
            ],
        });
        expect(body).not.toBeNull();
        expect(body?.events.length).toBe(1);
        expect(body?.count).toBe(1);
        expect(body?.nextCursor).toBe('opaque-cursor');
        expect(body?.hasMore).toBe(true);
        expect(body?.catalog?.length).toBe(1);
    });

    test('handles null nextCursor (no more pages)', () => {
        const body = parseHistoryResponse({
            events: [],
            count: 0,
            nextCursor: null,
            hasMore: false,
        });
        expect(body).not.toBeNull();
        expect(body?.nextCursor).toBeNull();
        expect(body?.hasMore).toBe(false);
    });

    test('defaults nextCursor to null and hasMore to false when absent (back-compat)', () => {
        const body = parseHistoryResponse({
            events: [],
            count: 0,
        });
        expect(body).not.toBeNull();
        expect(body?.nextCursor).toBeNull();
        expect(body?.hasMore).toBe(false);
    });

    test('drops malformed rows without aborting the page (R6)', () => {
        const body = parseHistoryResponse({
            events: [
                { id: 'good', eventName: 'task.updated', occurredAt: 't', actor: null, payload: null },
                { id: 123 }, // malformed - missing fields
                null, // malformed
                'not-an-object', // malformed
                { id: 'also-good', eventName: 'bus.subscribe', occurredAt: 't2', actor: 'x', payload: {} },
            ],
            count: 4,
            nextCursor: null,
            hasMore: false,
        });
        expect(body).not.toBeNull();
        expect(body?.events.length).toBe(2);
        expect(body?.events[0]?.id).toBe('good');
        expect(body?.events[1]?.id).toBe('also-good');
    });

    test('returns null for non-object input', () => {
        expect(parseHistoryResponse(null)).toBeNull();
        expect(parseHistoryResponse(undefined)).toBeNull();
        expect(parseHistoryResponse('string')).toBeNull();
        expect(parseHistoryResponse(42)).toBeNull();
    });

    test('returns null when events is not an array', () => {
        expect(parseHistoryResponse({ events: 'not-array', count: 0 })).toBeNull();
        expect(parseHistoryResponse({ events: null, count: 0 })).toBeNull();
    });

    test('returns null when count is not a number', () => {
        expect(parseHistoryResponse({ events: [], count: 'zero' })).toBeNull();
        expect(parseHistoryResponse({ events: [], count: null })).toBeNull();
    });
});

describe('historyUrl', () => {
    test('builds a URL with limit only when no filters', () => {
        const url = historyUrl({});
        expect(url).toContain('/events/history?');
        expect(url).toContain('limit=100');
    });

    test('serializes prefix param', () => {
        const url = historyUrl({ prefix: 'task' });
        expect(url).toContain('prefix=task');
    });

    test('serializes names param', () => {
        const url = historyUrl({ names: 'task.updated,task.created' });
        expect(url).toContain('names=task.updated%2Ctask.created');
    });

    test('serializes actor param', () => {
        const url = historyUrl({ actor: 'agent-alpha' });
        expect(url).toContain('actor=agent-alpha');
    });

    test('serializes runId param', () => {
        const url = historyUrl({ runId: 'run_42' });
        expect(url).toContain('runId=run_42');
    });

    test('serializes since param', () => {
        const url = historyUrl({ since: '2025-01-01T00:00:00Z' });
        expect(url).toContain('since=2025-01-01T00%3A00%3A00Z');
    });

    test('serializes cursor param', () => {
        const url = historyUrl({ cursor: 'opaque-keyset-token' });
        expect(url).toContain('cursor=opaque-keyset-token');
    });

    test('combines all params', () => {
        const url = historyUrl({
            prefix: 'task',
            names: 'task.updated',
            actor: 'alpha',
            runId: 'r1',
            since: '2025-01-01T00:00:00Z',
            cursor: 'cur',
            limit: 50,
        });
        expect(url).toContain('limit=50');
        expect(url).toContain('prefix=task');
        expect(url).toContain('names=task.updated');
        expect(url).toContain('actor=alpha');
        expect(url).toContain('runId=r1');
        expect(url).toContain('since=');
        expect(url).toContain('cursor=cur');
    });

    test('encodes special characters in params', () => {
        const url = historyUrl({ actor: 'user@example.com' });
        expect(url).toContain('actor=user%40example.com');
    });

    test('omits empty/undefined params', () => {
        const url = historyUrl({ prefix: '', names: undefined, actor: '' });
        expect(url).not.toContain('prefix=');
        expect(url).not.toContain('names=');
        expect(url).not.toContain('actor=');
    });
});
