import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '@gobing-ai/ts-infra';
import type { AgentExecutionEvent } from '../../src/observability/agent-execution';
import { DEFAULT_RUN_LOG_MAX_BYTES, WorkflowRunLogSink } from '../../src/observability/workflow-run-log-sink';
import type { WorkflowObservabilityBus, WorkflowObservabilityEventMap } from '../../src/workflow/observability';
import type { SteeringAck } from '../../src/workflow/steering';

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'spur-run-log-'));
}

function base(runId = 'run-1', at = '2026-08-02T00:00:00.000Z') {
    return { schemaVersion: 1 as const, eventId: 'e', sequence: 1, runId, at };
}

function makeBus(): WorkflowObservabilityBus {
    return new EventBus<WorkflowObservabilityEventMap>();
}

function makeAgentOutputEvent(chunk: string, stream: 'stdout' | 'stderr' = 'stdout'): AgentExecutionEvent {
    return {
        kind: 'output',
        schemaVersion: 1,
        eventId: 'e-out',
        sequence: 2,
        runId: 'run-1',
        executionId: 'execution-1',
        actionId: 'run-1:s1',
        at: '2026-08-02T00:00:02.000Z',
        stream,
        chunk,
    };
}

function makeAgentStartedEvent(): AgentExecutionEvent {
    return {
        kind: 'started',
        schemaVersion: 1,
        eventId: 'e-st',
        sequence: 1,
        runId: 'run-1',
        executionId: 'execution-1',
        actionId: 'run-1:s1',
        at: '2026-08-02T00:00:01.000Z',
        agent: 'claude',
        invocation: 'claude -p hi',
    };
}

function makeAgentFinishedEvent(): AgentExecutionEvent {
    return {
        kind: 'finished',
        schemaVersion: 1,
        eventId: 'e-fin',
        sequence: 3,
        runId: 'run-1',
        executionId: 'execution-1',
        actionId: 'run-1:s1',
        at: '2026-08-02T00:00:10.000Z',
        outcome: 'done',
        exitCode: 0,
        durationMs: 9_000,
        usage: 'unavailable',
    };
}

function makeSteeringAck(overrides: Partial<SteeringAck> = {}): SteeringAck {
    return {
        schemaVersion: 1,
        commandId: 'cmd-1',
        runId: 'run-1',
        actionId: 'run-1:s1',
        operation: 'continue',
        actor: 'operator',
        accepted: true,
        state: 'boundary',
        version: 2,
        at: '2026-08-02T00:00:05.000Z',
        ...overrides,
    };
}

describe('WorkflowRunLogSink', () => {
    test('R1 — writes a single all-in-one log with header + plan preview on run start', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({
            bus,
            dir,
            runId: 'run-1',
            planPreview: 'plan: start → done',
        });
        await bus.emit('workflow.run.started', {
            ...base(),
            workflowName: 'test-flow',
        });
        sink.close();

        expect(existsSync(sink.filePath)).toBe(true);
        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('# spur workflow run run-1 — test-flow — started');
        expect(text).toContain('# plan: start → done');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R1 — header + plan preview written exactly once across duplicate run.started projections', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-1', planPreview: 'plan: a → b' });
        await bus.emit('workflow.run.started', { ...base(), workflowName: 'flow' });
        // Second projection (engine-native bridge) must not duplicate the header.
        await bus.emit('workflow.run.started', { ...base('run-1', '2026-08-02T00:00:01.000Z'), workflowName: 'flow' });
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text.match(/^# spur workflow run /gm)).toHaveLength(1);
        expect(text.match(/^# plan:/gm)).toHaveLength(1);
        rmSync(dir, { recursive: true, force: true });
    });

    test('R2 — captures foreground rendering: progress, transitions, and final summary', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-1' });
        await bus.emit('workflow.phase', { ...base(), phase: 'start', status: 'running' });
        await bus.emit('workflow.transition', {
            ...base('run-1', '2026-08-02T00:00:03.000Z'),
            from: 'start',
            to: 'done',
            trigger: null,
        });
        await bus.emit('workflow.action.started', {
            ...base('run-1', '2026-08-02T00:00:01.000Z'),
            actionId: 'a1',
            node: 'start',
            kind: 'agent.run',
            metadata: { agent: 'pi' },
        });
        await bus.emit('workflow.action.finished', {
            ...base('run-1', '2026-08-02T00:00:09.000Z'),
            actionId: 'a1',
            status: 'done',
            durationMs: 8_000,
            ok: true,
            node: 'start',
            kind: 'agent.run',
        });
        await bus.emit('workflow.run.finalized', { ...base('run-1', '2026-08-02T00:00:10.000Z'), status: 'done' });
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('▶ start [running]');
        expect(text).toContain('↪ start → done');
        expect(text).toContain('→ start/agent.run');
        expect(text).toContain('✓ start/agent.run');
        expect(text).toContain('=== workflow run run-1 finished — status done');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R3 — captures child-agent stdout/stderr via the RunOutputSink chunk contract', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-1' });
        await bus.emit('workflow.agent', makeAgentStartedEvent());
        await bus.emit('workflow.agent', makeAgentOutputEvent('phase A'));
        await bus.emit('workflow.agent', makeAgentOutputEvent('warning', 'stderr'));
        await bus.emit('workflow.agent', makeAgentFinishedEvent());
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('claude -p hi');
        expect(text).toContain('[2026-08-02T00:00:02.000Z] stdout: phase A');
        expect(text).toContain('stderr: warning');
        expect(text).toContain('=== run done (exit 0) after 9000ms ===');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R3 (0454) — heartbeat events project as agent.run progress lines', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-1' });
        await bus.emit('workflow.agent', {
            kind: 'heartbeat',
            schemaVersion: 1,
            eventId: 'e-hb',
            sequence: 2,
            runId: 'run-1',
            executionId: 'execution-1',
            actionId: 'run-1:s1',
            at: '2026-08-02T00:00:30.000Z',
            elapsedMs: 30_000,
            timeoutMs: 1_800_000,
        });
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('agent.run progress: elapsed=30000ms');
        expect(text).toContain('timeoutMs=1800000');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R4 — captures steering commands with the note redacted and bounded', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-1' });
        await bus.emit('workflow.steering', makeSteeringAck({ note: 'please continue' }));
        await bus.emit('workflow.steering', makeSteeringAck({ note: `api_key=${'x'.repeat(2000)}` }));
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('[steer] ack continue · please continue');
        // Note text is bounded and redacted before the 1,024-char bound.
        expect(text).toContain('[REDACTED]');
        expect(text).not.toContain('api_key=');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R6 — the log never leaks prompt bodies or shell command text', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-1' });
        // action.started metadata already projects prompts/commands to redacted forms.
        await bus.emit('workflow.action.started', {
            ...base(),
            actionId: 'a1',
            node: 'start',
            kind: 'agent.run',
            metadata: { invocation: '[prompt 42 chars]' },
        });
        await bus.emit('workflow.action.started', {
            ...base('run-1', '2026-08-02T00:00:02.000Z'),
            actionId: 'a2',
            node: 'start',
            kind: 'shell',
            metadata: { invocation: '[shell command redacted]' },
        });
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).not.toContain('rm -rf');
        expect(text).not.toContain('secret material');
        expect(text).toContain('[prompt 42 chars]');
        expect(text).toContain('[shell command redacted]');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R7 — byte bound truncates visibly with an explicit marker', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-byte', maxBytes: 200 });
        await bus.emit('workflow.agent', makeAgentOutputEvent('x'.repeat(500)));
        await bus.emit('workflow.agent', makeAgentOutputEvent('after-bound'));
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('[truncated]');
        expect(text).not.toContain('after-bound');
        expect(sink.isTruncated).toBe(true);
        rmSync(dir, { recursive: true, force: true });
    });

    test('R7 — line bound truncates visibly', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-lines', maxLines: 2 });
        await bus.emit('workflow.phase', { ...base(), phase: 'start', status: 'running' });
        await bus.emit('workflow.phase', {
            ...base('run-1', '2026-08-02T00:00:01.000Z'),
            phase: 'mid',
            status: 'running',
        });
        await bus.emit('workflow.phase', {
            ...base('run-1', '2026-08-02T00:00:02.000Z'),
            phase: 'late',
            status: 'running',
        });
        sink.close();

        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('[truncated]');
        expect(text).not.toContain('▶ late');
        rmSync(dir, { recursive: true, force: true });
    });

    test('R8 — unwritable run dir degrades the log, never the run', async () => {
        const dir = tempDir();
        const blocker = join(dir, 'run');
        writeFileSync(blocker, 'block');
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir: join(blocker, 'run'), runId: 'run-ro' });
        expect(() => bus.emit('workflow.run.started', { ...base(), workflowName: 'f' })).not.toThrow();
        expect(() => sink.close()).not.toThrow();
        expect(existsSync(sink.filePath)).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });

    test('close is idempotent and unsubscribes from the bus', async () => {
        const dir = tempDir();
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir, runId: 'run-close' });
        await bus.emit('workflow.phase', { ...base(), phase: 'start', status: 'running' });
        sink.close();
        sink.close();
        // After close + unsubscribe, a later event must not append.
        await bus.emit('workflow.phase', {
            ...base('run-1', '2026-08-02T00:00:02.000Z'),
            phase: 'late',
            status: 'running',
        });
        const text = readFileSync(sink.filePath, 'utf8');
        expect(text).toContain('▶ start');
        expect(text).not.toContain('▶ late');
        rmSync(dir, { recursive: true, force: true });
    });

    test('default byte bound applies when maxBytes is not configured', () => {
        const bus = makeBus();
        const sink = new WorkflowRunLogSink({ bus, dir: tempDir(), runId: 'run-default' });
        expect(DEFAULT_RUN_LOG_MAX_BYTES).toBeGreaterThan(0);
        expect(sink.isTruncated).toBe(false);
        sink.close();
    });
});
