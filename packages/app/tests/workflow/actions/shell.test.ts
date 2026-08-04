import { describe, expect, test } from 'bun:test';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import type { PipeProcess, PipeProcessOptions, ProcessExecutor, ProcessResult } from '@gobing-ai/ts-runtime';
import { StreamingShellActionRunner } from '../../../src/workflow/actions/shell';
import type { WorkflowActionOutputEvent, WorkflowObservabilityBus } from '../../../src/workflow/observability';

function makeCtx(overrides: Partial<ActionRunContext> = {}): ActionRunContext {
    return { runId: 'run-1', stateOrNodeId: 's1', workdir: '/tmp', vars: {}, env: {}, ...overrides };
}

/** Build a ReadableStream of the given lines, then close. */
function streamOf(lines: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (const line of lines) {
                controller.enqueue(new TextEncoder().encode(line));
            }
            controller.close();
        },
    });
}

describe('StreamingShellActionRunner', () => {
    test('kind is shell', () => {
        const runner = new StreamingShellActionRunner({
            run: async () => ({}) as ProcessResult,
            runStreaming: () => ({}) as PipeProcess,
        });
        expect(runner.kind).toBe('shell');
    });

    test('relays stdout/stderr chunks to the observability bus during execution', async () => {
        const bus: WorkflowObservabilityBus = new EventBus();
        const output: WorkflowActionOutputEvent[] = [];
        bus.on('workflow.action.output', (e) => output.push(e));

        let capturedOptions: PipeProcessOptions | undefined;
        const fakeExecutor: ProcessExecutor = {
            run: async () => ({ exitCode: 0 }) as ProcessResult,
            runStreaming: (options) => {
                capturedOptions = options;
                return {
                    pid: 49281,
                    stdout: streamOf(['compiling 42 modules\n', 'done\n']),
                    stderr: streamOf(['warning: unused var\n']),
                    exited: Promise.resolve(0),
                    writeStdin: () => undefined,
                    endStdin: () => undefined,
                    kill: () => undefined,
                };
            },
        };
        const runner = new StreamingShellActionRunner(fakeExecutor, bus);
        const result = await runner.execute({ command: 'bun build' }, makeCtx());

        expect(capturedOptions?.command).toBe('bun build');
        expect(result.ok).toBe(true);
        expect(result.data?.exitCode).toBe(0);
        const stdoutChunks = output.filter((e) => e.stream === 'stdout').map((e) => e.chunk);
        const stderrChunks = output.filter((e) => e.stream === 'stderr').map((e) => e.chunk);
        expect(stdoutChunks.join('')).toContain('compiling 42 modules');
        expect(stdoutChunks.join('')).toContain('done');
        expect(stderrChunks.join('')).toContain('warning: unused var');
        // every chunk carries run/node correlation for the reporter.
        for (const e of output) {
            expect(e.runId).toBe('run-1');
            expect(e.node).toBe('s1');
            expect(e.kind).toBe('shell');
        }
    });

    test('emits a failure result with exit code and error on non-zero exit', async () => {
        const fakeExecutor: ProcessExecutor = {
            run: async () => ({ exitCode: 1 }) as ProcessResult,
            runStreaming: () => ({
                pid: 7,
                stdout: null,
                stderr: streamOf(['command not found: spurr\n']),
                exited: Promise.resolve(1),
                writeStdin: () => undefined,
                endStdin: () => undefined,
                kill: () => undefined,
            }),
        };
        const runner = new StreamingShellActionRunner(fakeExecutor);
        const result = await runner.execute({ command: 'spurr nope' }, makeCtx());
        expect(result.ok).toBe(false);
        expect(result.data?.exitCode).toBe(1);
        expect(result.error).toContain('exited with 1');
        // stderr accumulated for the R10 failure snippet.
        expect(result.data?.stderr).toContain('command not found');
    });

    test('redacts secrets from streamed chunks', async () => {
        const bus: WorkflowObservabilityBus = new EventBus();
        const output: WorkflowActionOutputEvent[] = [];
        bus.on('workflow.action.output', (e) => output.push(e));
        const fakeExecutor: ProcessExecutor = {
            run: async () => ({ exitCode: 0 }) as ProcessResult,
            runStreaming: () => ({
                pid: 1,
                stdout: streamOf(['token=sk-abcd1234efgh5678ijkl\n']),
                stderr: null,
                exited: Promise.resolve(0),
                writeStdin: () => undefined,
                endStdin: () => undefined,
                kill: () => undefined,
            }),
        };
        const runner = new StreamingShellActionRunner(fakeExecutor, bus);
        await runner.execute({ command: 'print-secret' }, makeCtx());
        const first = output[0];
        expect(first).toBeDefined();
        const chunk = first?.chunk ?? '';
        expect(chunk).toContain('[REDACTED]');
        expect(chunk).not.toContain('sk-abcd1234efgh5678ijkl');
    });
});
