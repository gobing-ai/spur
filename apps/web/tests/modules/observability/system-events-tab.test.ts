import { describe, expect, test } from 'bun:test';
import {
    buildTooltipSummary,
    formatAvailability,
    formatDuration,
    historyUrl,
    parseHistoryResponse,
    parseHistoryRow,
} from '../../../src/modules/observability/SystemEventsTab';

/**
 * Task 0234 — tooltip enrichment. `buildTooltipSummary` projects a row payload
 * into 0–4 (label, value) pairs for the hover/focus tooltip. Each renderer
 * branch has its own priority budget so the tooltip surfaces the fields a user
 * scanning the System Events table actually cares about (entity + transition
 * for planning rows; job/duration/status for queue rows; HTTP verb + status for
 * API rows, etc.). These tests pin the per-renderer contract so a regression
 * that drops a field — or surfaces the wrong one — fails loudly.
 */
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

describe('buildTooltipSummary', () => {
    test('returns null for null/empty payloads (nothing to summarize)', () => {
        expect(buildTooltipSummary('task.updated', null, 'planning')).toBeNull();
        expect(buildTooltipSummary('task.updated', {}, 'planning')).toBeNull();
    });

    test('surfaces all priority fields (no cap - detail panel needs full envelope)', () => {
        const summary = buildTooltipSummary(
            'queue.job.completed',
            {
                kind: 'import',
                jobId: 'job_1',
                durationMs: 500,
                status: 'completed',
                error: 'boom',
                extra: 'dropped',
            },
            'queue',
        );
        expect(summary).not.toBeNull();
        // R4 (task 0375): no 4-pair cap - all 5 priority fields surface.
        expect(summary?.length).toBe(5);
        const labels = (summary ?? []).map((p) => p.label);
        expect(labels).toEqual(['Job', 'ID', 'Duration', 'Status', 'Error']);
        // `extra` is never surfaced - it's not a known queue field.
        expect(labels).not.toContain('Extra');
    });

    test('drops pairs whose value is missing (null/undefined/empty)', () => {
        const summary = buildTooltipSummary(
            'queue.job.completed',
            { kind: 'import', jobId: '', durationMs: undefined, status: null },
            'queue',
        );
        expect(summary).not.toBeNull();
        const labels = (summary ?? []).map((p) => p.label);
        expect(labels).toEqual(['Job']);
    });

    describe('planning renderer (task.* / feature.*)', () => {
        test('surfaces entity label and status transition', () => {
            const summary = buildTooltipSummary(
                'task.updated',
                { entity: { kind: 'task', id: '0001' }, from: 'todo', to: 'wip' },
                'planning',
            );
            expect(summary).toEqual([
                { label: 'Entity', value: 'task:0001' },
                { label: 'Transition', value: 'todo → wip' },
            ]);
        });

        test('falls back to flat entityId when entity object absent', () => {
            const summary = buildTooltipSummary('task.updated', { entityId: 'task-9', to: 'done' }, 'planning');
            expect(summary).toEqual([
                { label: 'Entity', value: 'task-9' },
                { label: 'Transition', value: 'none → done' },
            ]);
        });
    });

    describe('queue renderer', () => {
        test('surfaces job kind, id, formatted duration, status, error', () => {
            const summary = buildTooltipSummary(
                'queue.job.completed',
                { kind: 'import', jobId: 'job_42', durationMs: 1500, status: 'failed', error: 'timeout' },
                'queue',
            );
            expect(summary).toEqual([
                { label: 'Job', value: 'import' },
                { label: 'ID', value: 'job_42' },
                { label: 'Duration', value: '1.5s' },
                { label: 'Status', value: 'failed' },
                { label: 'Error', value: 'timeout' },
            ]);
        });

        // AC: Queue renderer surfaces status, duration, and error (type key, 150ms)
        test('AC fixture: type+jobId+status+durationMs (4 pairs, no error)', () => {
            const summary = buildTooltipSummary(
                'queue.job.completed',
                { jobId: 'j1', type: 'smoke', status: 'completed', durationMs: 150 },
                'queue',
            );
            expect(summary).toEqual([
                { label: 'Job', value: 'smoke' },
                { label: 'ID', value: 'j1' },
                { label: 'Duration', value: '150ms' },
                { label: 'Status', value: 'completed' },
            ]);
            expect(summary?.length).toBe(4);
        });

        // AC: Queue renderer surfaces error on a failed job (no duration → Error fits)
        test('AC fixture: failed job surfaces Status and Error', () => {
            const summary = buildTooltipSummary(
                'queue.job.failed',
                { jobId: 'j2', type: 'smoke', status: 'failed', error: 'boom', attempt: 3 },
                'queue',
            );
            expect(summary).toContainEqual({ label: 'Error', value: 'boom' });
            expect(summary).toContainEqual({ label: 'Status', value: 'failed' });
        });
    });

    describe('scheduler renderer', () => {
        test('surfaces job name and duration; drops kind (task 0233 contract)', () => {
            const summary = buildTooltipSummary(
                'scheduler.job.executed',
                { name: 'system-events-prune', durationMs: 250 },
                'scheduler',
            );
            expect(summary).toEqual([
                { label: 'Job', value: 'system-events-prune' },
                { label: 'Duration', value: '250ms' },
            ]);
        });

        test('includes error when present', () => {
            const summary = buildTooltipSummary(
                'scheduler.job.executed',
                { name: 'smoke', durationMs: 10, error: 'boom' },
                'scheduler',
            );
            expect(summary).toContainEqual({ label: 'Error', value: 'boom' });
        });

        // AC: Scheduler renderer surfaces duration and error, not cron
        test('AC fixture: name + 3.2s duration + error; no cron pair', () => {
            const summary = buildTooltipSummary(
                'scheduler.job.executed',
                { name: 'system-events-prune', durationMs: 3200, error: 'timeout', cron: '*/5 * * * *' },
                'scheduler',
            );
            expect(summary).toEqual([
                { label: 'Job', value: 'system-events-prune' },
                { label: 'Duration', value: '3.2s' },
                { label: 'Error', value: 'timeout' },
            ]);
            expect((summary ?? []).map((p) => p.label)).not.toContain('Cron');
        });
    });

    describe('message renderer', () => {
        test('surfaces route as "from → to" when both present', () => {
            const summary = buildTooltipSummary(
                'agent.message.sent',
                { fromId: 'alpha', toId: 'beta', ok: true },
                'message',
            );
            expect(summary).toContainEqual({ label: 'Route', value: 'alpha → beta' });
            expect(summary).toContainEqual({ label: 'OK', value: 'true' });
        });

        test('falls back to route/direction/type when from/to absent', () => {
            const summary = buildTooltipSummary('message.sent', { direction: 'outbound', subject: 'hello' }, 'message');
            expect(summary).toContainEqual({ label: 'Route', value: 'outbound' });
            expect(summary).toContainEqual({ label: 'Subject', value: 'hello' });
        });

        // AC: Message renderer surfaces route, ok flag, and subject
        test('AC fixture: route + ok + subject', () => {
            const summary = buildTooltipSummary(
                'message.sent',
                { route: 'inbox', ok: true, subject: 're: plan' },
                'message',
            );
            expect(summary).toEqual([
                { label: 'Route', value: 'inbox' },
                { label: 'OK', value: 'true' },
                { label: 'Subject', value: 're: plan' },
            ]);
        });
    });

    describe('process / agent renderer', () => {
        test('surfaces command, exit code, formatted duration', () => {
            const summary = buildTooltipSummary(
                'process.exited',
                { command: 'bun run test', exitCode: 0, durationMs: 12_000 },
                'process',
            );
            expect(summary).toEqual([
                { label: 'Command', value: 'bun run test' },
                { label: 'Exit', value: '0' },
                { label: 'Duration', value: '12.0s' },
            ]);
        });

        // AC: Process/agent surfaces command, exit, duration, and pid
        test('AC fixture: command + exit + 42.0s + pid (4 pairs)', () => {
            const summary = buildTooltipSummary(
                'process.exited',
                { command: 'spur agent run', exitCode: 0, durationMs: 42_000, pid: 12_345 },
                'process',
            );
            expect(summary).toEqual([
                { label: 'Command', value: 'spur agent run' },
                { label: 'Exit', value: '0' },
                { label: 'Duration', value: '42.0s' },
                { label: 'PID', value: '12345' },
            ]);
        });
    });

    describe('rule renderer', () => {
        test('surfaces rule id, severity, finding count', () => {
            const summary = buildTooltipSummary(
                'rule.run.completed',
                { ruleId: 'no-console', severity: 'warn', count: '3' },
                'rule',
            );
            expect(summary).toEqual([
                { label: 'Rule', value: 'no-console' },
                { label: 'Severity', value: 'warn' },
                { label: 'Findings', value: '3' },
            ]);
        });

        // AC: Rule renderer surfaces severity and findings count
        test('AC fixture: rule + severity + numeric findings count', () => {
            const summary = buildTooltipSummary(
                'rule.run.completed',
                { rule: 'no-any', severity: 'error', count: 7 },
                'rule',
            );
            expect(summary).toEqual([
                { label: 'Rule', value: 'no-any' },
                { label: 'Severity', value: 'error' },
                { label: 'Findings', value: '7' },
            ]);
        });
    });

    describe('api renderer', () => {
        test('combines method + status into a single "HTTP" pair', () => {
            const summary = buildTooltipSummary(
                'api.request',
                { method: 'POST', status: '201', path: '/v1/tasks', durationMs: 42 },
                'api',
            );
            expect(summary).toContainEqual({ label: 'HTTP', value: 'POST 201' });
            expect(summary).toContainEqual({ label: 'Path', value: '/v1/tasks' });
        });

        test('falls back to separate pairs when only method or only status', () => {
            const onlyMethod = buildTooltipSummary('api.request', { method: 'GET' }, 'api');
            expect(onlyMethod).toContainEqual({ label: 'HTTP', value: 'GET' });

            const onlyStatus = buildTooltipSummary('api.request', { status: '500' }, 'api');
            expect(onlyStatus).toContainEqual({ label: 'HTTP', value: '500' });
        });

        // AC: Api renderer surfaces method+status, path, and error
        test('AC fixture: combined HTTP + path + error (numeric status)', () => {
            const summary = buildTooltipSummary(
                'api.request.error',
                { method: 'POST', status: 500, path: '/api/tasks', error: 'db locked' },
                'api',
            );
            expect(summary).toEqual([
                { label: 'HTTP', value: 'POST 500' },
                { label: 'Path', value: '/api/tasks' },
                { label: 'Error', value: 'db locked' },
            ]);
        });
    });

    describe('workflow renderer', () => {
        test('surfaces workflow name, run id, and phase', () => {
            const summary = buildTooltipSummary(
                'workflow.phase.entered',
                { workflow: 'deploy', runId: 'run_7', phase: 'implement' },
                'workflow-phase',
            );
            expect(summary).toEqual([
                { label: 'Workflow', value: 'deploy' },
                { label: 'Run', value: 'run_7' },
                { label: 'Phase', value: 'implement' },
            ]);
        });

        test('surfaces transition for workflow-transition renderer', () => {
            const summary = buildTooltipSummary(
                'workflow.transition',
                { workflow: 'deploy', runId: 'run_7', transition: 'implement→test' },
                'workflow-transition',
            );
            expect(summary).toContainEqual({ label: 'Transition', value: 'implement→test' });
        });

        // AC + R10: first non-null of phase/transition/action only
        test('AC fixture: first non-null phase wins over co-present action', () => {
            const summary = buildTooltipSummary(
                'workflow.phase.entered',
                {
                    workflow: 'idea-pipeline',
                    runId: 'r9',
                    phase: 'ac-generate',
                    action: 'agent.run',
                },
                'workflow-phase',
            );
            expect(summary).toEqual([
                { label: 'Workflow', value: 'idea-pipeline' },
                { label: 'Run', value: 'r9' },
                { label: 'Phase', value: 'ac-generate' },
            ]);
            expect((summary ?? []).map((p) => p.label)).not.toContain('Action');
        });

        test('falls through to Action when phase and transition absent', () => {
            const summary = buildTooltipSummary(
                'workflow.action',
                { workflow: 'idea-pipeline', runId: 'r9', action: 'agent.run' },
                'workflow-action',
            );
            expect(summary).toContainEqual({ label: 'Action', value: 'agent.run' });
        });
    });

    describe('bus renderer', () => {
        test('surfaces the nested bus event name', () => {
            const summary = buildTooltipSummary('bus.subscribe', { event: 'task.updated', count: 3 }, 'bus');
            expect(summary).toEqual([{ label: 'Bus event', value: 'task.updated' }]);
        });
    });

    describe('default / unknown renderer', () => {
        test('surfaces first 3 scalar fields for uncategorized events', () => {
            const summary = buildTooltipSummary(
                'mystery.event',
                { alpha: 'a', beta: 2, gamma: true, delta: 'dropped' },
                'unknown-renderer',
            );
            expect(summary).not.toBeNull();
            expect(summary?.length).toBe(3);
            const labels = (summary ?? []).map((p) => p.label);
            expect(labels).toEqual(['alpha', 'beta', 'gamma']);
        });

        test('skips object/array field values in generic fallback', () => {
            const summary = buildTooltipSummary(
                'mystery.event',
                { nested: { a: 1 }, scalar: 'ok' },
                'unknown-renderer',
            );
            expect(summary).toEqual([{ label: 'scalar', value: 'ok' }]);
        });
    });

    test('infers planning renderer for task.* events when no renderer passed', () => {
        const summary = buildTooltipSummary('task.updated', { entityId: 't1', to: 'wip' });
        expect(summary).toContainEqual({ label: 'Entity', value: 't1' });
    });
});

describe('formatAvailability', () => {
    test('returns "unavailable" for null, undefined, and empty string', () => {
        expect(formatAvailability(null)).toBe('unavailable');
        expect(formatAvailability(undefined)).toBe('unavailable');
        expect(formatAvailability('')).toBe('unavailable');
    });

    test('returns "unavailable" for non-finite numbers (NaN, Infinity)', () => {
        expect(formatAvailability(Number.NaN)).toBe('unavailable');
        expect(formatAvailability(Number.POSITIVE_INFINITY)).toBe('unavailable');
        expect(formatAvailability(Number.NEGATIVE_INFINITY)).toBe('unavailable');
    });

    test('returns the value as string for finite numbers', () => {
        expect(formatAvailability(0)).toBe('0');
        expect(formatAvailability(42)).toBe('42');
        expect(formatAvailability(3.14)).toBe('3.14');
    });

    test('returns the value as string for booleans', () => {
        expect(formatAvailability(true)).toBe('true');
        expect(formatAvailability(false)).toBe('false');
    });

    test('returns non-empty strings as-is', () => {
        expect(formatAvailability('run_42')).toBe('run_42');
        expect(formatAvailability('completed')).toBe('completed');
    });

    test('returns "unavailable" for objects and arrays', () => {
        expect(formatAvailability({})).toBe('unavailable');
        expect(formatAvailability([1, 2])).toBe('unavailable');
    });

    test('never substitutes zero for absent usage (R3 invariant)', () => {
        // The load-bearing invariant: absent must render as 'unavailable', NOT '0'.
        expect(formatAvailability(null)).not.toBe('0');
        expect(formatAvailability(undefined)).not.toBe('0');
        expect(formatAvailability('')).not.toBe('0');
    });
});

describe('parseHistoryRow', () => {
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
