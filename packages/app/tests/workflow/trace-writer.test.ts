import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@gobing-ai/ts-infra';
import type { WorkflowObservabilityEventMap } from '../../src/workflow/observability';
import { WorkflowTraceWriter } from '../../src/workflow/trace-writer';

describe('WorkflowTraceWriter', () => {
    test('writes ordered schema-versioned events only under .spur/runs/workflow', async () => {
        const cwd = await mkdtemp(join(tmpdir(), 'spur-trace-writer-'));
        const bus = new EventBus<WorkflowObservabilityEventMap>();
        const writer = new WorkflowTraceWriter(cwd, 'run/unsafe');
        writer.attach(bus);

        await bus.emit('workflow.run.started', {
            schemaVersion: 1,
            eventId: 'event-1',
            sequence: 1,
            runId: 'run/unsafe',
            workflowName: 'fixture',
            at: '2026-07-28T00:00:00.000Z',
        });
        await bus.emit('workflow.agent', {
            schemaVersion: 1,
            eventId: 'event-2',
            sequence: 1,
            runId: 'run/unsafe',
            executionId: 'execution-1',
            kind: 'output',
            stream: 'stdout',
            chunk: '[REDACTED]',
            at: '2026-07-28T00:00:01.000Z',
        });
        await bus.emit('workflow.phase', {
            schemaVersion: 1,
            eventId: 'event-3',
            sequence: 2,
            runId: 'run/unsafe',
            workflowName: 'fixture',
            phase: 'start',
            status: 'running',
            at: '2026-07-28T00:00:02.000Z',
        });
        await bus.emit('workflow.transition', {
            schemaVersion: 1,
            eventId: 'event-4',
            sequence: 3,
            runId: 'run/unsafe',
            workflowName: 'fixture',
            from: 'start',
            to: 'done',
            trigger: null,
            at: '2026-07-28T00:00:03.000Z',
        });
        await bus.emit('workflow.action.started', {
            schemaVersion: 1,
            eventId: 'event-5',
            sequence: 4,
            runId: 'run/unsafe',
            workflowName: 'fixture',
            actionId: 'action-1',
            node: 'start',
            kind: 'agent.run',
            at: '2026-07-28T00:00:04.000Z',
        });
        await bus.emit('workflow.action.finished', {
            schemaVersion: 1,
            eventId: 'event-6',
            sequence: 5,
            runId: 'run/unsafe',
            workflowName: 'fixture',
            actionId: 'action-1',
            node: 'start',
            kind: 'agent.run',
            status: 'done',
            durationMs: 10,
            ok: true,
            at: '2026-07-28T00:00:05.000Z',
        });
        await bus.emit('workflow.steering', {
            schemaVersion: 1,
            commandId: 'command-1',
            runId: 'run/unsafe',
            actionId: 'action-1',
            operation: 'abort',
            actor: 'operator',
            accepted: true,
            state: 'running',
            version: 1,
            at: '2026-07-28T00:00:06.000Z',
        });
        await bus.emit('workflow.run.finalized', {
            schemaVersion: 1,
            eventId: 'event-7',
            sequence: 6,
            runId: 'run/unsafe',
            workflowName: 'fixture',
            status: 'done',
            at: '2026-07-28T00:00:07.000Z',
        });
        await writer.flush();

        expect(writer.path).toBe(join(cwd, '.spur', 'runs', 'workflow', 'run_unsafe.jsonl'));
        const lines = (await readFile(writer.path, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines.map((line) => line.traceSequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(lines.every((line) => line.traceSchemaVersion === 1)).toBe(true);
        expect(lines.map((line) => line.type)).toEqual([
            'workflow.run.started',
            'workflow.agent',
            'workflow.phase',
            'workflow.transition',
            'workflow.action.started',
            'workflow.action.finished',
            'workflow.steering',
            'workflow.run.finalized',
        ]);
        expect(lines.at(-2)?.event).toMatchObject({ operation: 'abort', actor: 'operator' });
    });
});
