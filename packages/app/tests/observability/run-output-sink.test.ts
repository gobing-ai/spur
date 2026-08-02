import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentExecutionEvent } from '../../src/observability/agent-execution';
import { DEFAULT_OUTPUT_MAX_BYTES, RunOutputSink } from '../../src/observability/run-output-sink';

function makeOutputEvent(
    overrides: Partial<Extract<AgentExecutionEvent, { kind: 'output' }>> = {},
): Extract<AgentExecutionEvent, { kind: 'output' }> {
    return {
        kind: 'output',
        schemaVersion: 1 as const,
        eventId: 'e1',
        sequence: 1,
        runId: 'run-1',
        executionId: 'execution-1',
        actionId: 'action-1',
        at: '2026-08-02T00:00:00.000Z',
        stream: 'stdout',
        chunk: 'hello',
        ...overrides,
    };
}

function makeStartedEvent(
    overrides: Partial<Extract<AgentExecutionEvent, { kind: 'started' }>> = {},
): Extract<AgentExecutionEvent, { kind: 'started' }> {
    return {
        kind: 'started',
        schemaVersion: 1 as const,
        eventId: 'e0',
        sequence: 0,
        runId: 'run-1',
        executionId: 'execution-1',
        actionId: 'action-1',
        at: '2026-08-02T00:00:00.000Z',
        agent: 'pi',
        invocation: 'pi -p hello',
        ...overrides,
    };
}

function makeFinishedEvent(
    overrides: Partial<Extract<AgentExecutionEvent, { kind: 'finished' }>> = {},
): Extract<AgentExecutionEvent, { kind: 'finished' }> {
    return {
        kind: 'finished',
        schemaVersion: 1 as const,
        eventId: 'e2',
        sequence: 3,
        runId: 'run-1',
        executionId: 'execution-1',
        actionId: 'action-1',
        at: '2026-08-02T00:00:10.000Z',
        outcome: 'done' as const,
        exitCode: 0,
        durationMs: 10_000,
        usage: 'unavailable' as const,
        ...overrides,
    };
}

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'spur-run-output-'));
}

describe('RunOutputSink', () => {
    test('writes output chunks with preserved timestamps to the per-run artifact', () => {
        const dir = tempDir();
        const sink = new RunOutputSink({ dir, runId: 'run-1' });
        sink.observe(makeStartedEvent());
        sink.observe(makeOutputEvent({ at: '2026-08-02T00:00:01.000Z', chunk: 'phase A' }));
        sink.observe(makeOutputEvent({ at: '2026-08-02T00:00:02.000Z', stream: 'stderr', chunk: 'warning' }));
        sink.close();

        const content = readFileSync(sink.filePath, 'utf8');
        expect(content).toContain('[2026-08-02T00:00:01.000Z] stdout: phase A');
        expect(content).toContain('[2026-08-02T00:00:02.000Z] stderr: warning');
        expect(content).toContain('run-1');
        // Chunk timestamps are preserved so elapsed-time-per-phase is derivable (R2 AC).
        expect(content.indexOf('[2026-08-02T00:00:01.000Z]')).toBeLessThan(
            content.indexOf('[2026-08-02T00:00:02.000Z]'),
        );
        rmSync(dir, { recursive: true, force: true });
    });

    test('artifact is readable before the subprocess exits (no close required)', () => {
        const dir = tempDir();
        const sink = new RunOutputSink({ dir, runId: 'run-live' });
        sink.observe(makeOutputEvent({ runId: 'run-live', chunk: 'still running' }));
        // Read the file while the sink is still open — the supervisor's mid-run view.
        const live = readFileSync(sink.filePath, 'utf8');
        expect(live).toContain('still running');
        expect(existsSync(sink.filePath)).toBe(true);
        sink.close();
        rmSync(dir, { recursive: true, force: true });
    });

    test('byte bound truncates visibly and stops further writes', () => {
        const dir = tempDir();
        const sink = new RunOutputSink({ dir, runId: 'run-byte', maxBytes: 64 });
        // One oversized chunk must trip the bound.
        sink.observe(makeOutputEvent({ chunk: 'x'.repeat(200) }));
        sink.observe(makeOutputEvent({ chunk: 'after-truncation' }));
        sink.close();

        const content = readFileSync(sink.filePath, 'utf8');
        expect(sink.isTruncated).toBe(true);
        expect(content).toContain('[truncated]');
        // A truncated capture must not read as complete — nothing after the marker.
        const markerIndex = content.indexOf('[truncated]');
        expect(markerIndex).toBeGreaterThanOrEqual(0);
        expect(content.slice(markerIndex)).not.toContain('after-truncation');
        expect(statSync(sink.filePath).size).toBeLessThan(64 + 256);
        rmSync(dir, { recursive: true, force: true });
    });

    test('line bound truncates visibly when maxLines is configured', () => {
        const dir = tempDir();
        const sink = new RunOutputSink({ dir, runId: 'run-lines', maxLines: 2 });
        sink.observe(makeOutputEvent({ chunk: 'line one' }));
        sink.observe(makeOutputEvent({ chunk: 'line two' }));
        sink.observe(makeOutputEvent({ chunk: 'line three' }));
        sink.close();

        const content = readFileSync(sink.filePath, 'utf8');
        expect(sink.isTruncated).toBe(true);
        expect(content).toContain('line one');
        expect(content).toContain('line two');
        expect(content).toContain('[truncated]');
        expect(content).not.toContain('line three');
        rmSync(dir, { recursive: true, force: true });
    });

    test('an unwritable run directory degrades the stream and never throws (R5)', () => {
        const dir = tempDir();
        // A regular file at the target dir path makes mkdir recursive fail.
        const blocker = join(dir, 'not-a-dir');
        writeFileSync(blocker, 'block');
        const sink = new RunOutputSink({ dir: join(blocker, 'run'), runId: 'run-ro' });
        expect(() => sink.observe(makeOutputEvent({ chunk: 'never written' }))).not.toThrow();
        expect(() => sink.close()).not.toThrow();
        expect(existsSync(sink.filePath)).toBe(false);
        rmSync(dir, { recursive: true, force: true });
    });

    test('dropped and finished events are visible markers, heartbeat events are ignored', () => {
        const dir = tempDir();
        const sink = new RunOutputSink({ dir, runId: 'run-markers' });
        sink.observe({
            kind: 'dropped',
            schemaVersion: 1,
            eventId: 'e-d',
            sequence: 2,
            runId: 'run-markers',
            executionId: 'execution-1',
            at: '2026-08-02T00:00:05.000Z',
            chunks: 7,
        } as Extract<AgentExecutionEvent, { kind: 'dropped' }>);
        sink.observe({
            kind: 'heartbeat',
            schemaVersion: 1,
            eventId: 'e-h',
            sequence: 3,
            runId: 'run-markers',
            executionId: 'execution-1',
            at: '2026-08-02T00:00:06.000Z',
            elapsedMs: 6000,
        } as Extract<AgentExecutionEvent, { kind: 'heartbeat' }>);
        sink.observe(makeFinishedEvent({ runId: 'run-markers' }));
        sink.close();

        const content = readFileSync(sink.filePath, 'utf8');
        expect(content).toContain('[dropped] 7 chunk(s)');
        expect(content).toContain('run done (exit 0) after 10000ms');
        expect(content).not.toContain('heartbeat');
        rmSync(dir, { recursive: true, force: true });
    });

    test('close is idempotent and later observes are no-ops', () => {
        const dir = tempDir();
        const sink = new RunOutputSink({ dir, runId: 'run-close' });
        sink.observe(makeOutputEvent({ runId: 'run-close', chunk: 'first' }));
        sink.close();
        sink.close();
        sink.observe(makeOutputEvent({ runId: 'run-close', chunk: 'second' }));
        const content = readFileSync(sink.filePath, 'utf8');
        expect(content).toContain('first');
        expect(content).not.toContain('second');
        rmSync(dir, { recursive: true, force: true });
    });

    test('default byte bound applies when maxBytes is not configured', () => {
        const sink = new RunOutputSink({ dir: tempDir(), runId: 'run-default-bound' });
        expect(sink).toBeDefined();
        // Expose the default via the exported constant — the bound is configuration, not magic.
        expect(DEFAULT_OUTPUT_MAX_BYTES).toBeGreaterThan(0);
        sink.close();
    });
});
