import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionRunContext } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import {
    NodeProcessExecutor,
    type PipeProcess,
    type PipeProcessOptions,
    type ProcessExecutor,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
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

        // Bare command → runs via `/bin/sh -c` (mirrors the engine's shell runner).
        expect(capturedOptions?.command).toBe('/bin/sh');
        expect(capturedOptions?.args).toEqual(['-c', 'bun build']);
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

    test('runs command as a program when args are provided (no /bin/sh -c)', async () => {
        let capturedOptions: PipeProcessOptions | undefined;
        const fakeExecutor: ProcessExecutor = {
            run: async () => ({ exitCode: 0 }) as ProcessResult,
            runStreaming: (options) => {
                capturedOptions = options;
                return {
                    pid: 5,
                    stdout: streamOf(['built ok\n']),
                    stderr: null,
                    exited: Promise.resolve(0),
                    writeStdin: () => undefined,
                    endStdin: () => undefined,
                    kill: () => undefined,
                };
            },
        };
        const runner = new StreamingShellActionRunner(fakeExecutor);
        const result = await runner.execute({ command: 'bun', args: ['build', 'src/index.ts'] }, makeCtx());

        // Explicit args → command is the program itself, not /bin/sh -c.
        expect(capturedOptions?.command).toBe('bun');
        expect(capturedOptions?.args).toEqual(['build', 'src/index.ts']);
        expect(result.ok).toBe(true);
        expect(result.data?.exitCode).toBe(0);
        expect(result.data?.stdout).toContain('built ok');
    });

    test('throws when command option is missing', async () => {
        const runner = new StreamingShellActionRunner({
            run: async () => ({}) as ProcessResult,
            runStreaming: () => ({}) as PipeProcess,
        });
        await expect(runner.execute({}, makeCtx())).rejects.toThrow('Action option "command" must be a string');
    });

    test('throws when command option is not a string', async () => {
        const runner = new StreamingShellActionRunner({
            run: async () => ({}) as ProcessResult,
            runStreaming: () => ({}) as PipeProcess,
        });
        await expect(runner.execute({ command: 42 }, makeCtx())).rejects.toThrow(
            'Action option "command" must be a string',
        );
    });

    test('throws when args option is not a string array', async () => {
        const runner = new StreamingShellActionRunner({
            run: async () => ({}) as ProcessResult,
            runStreaming: () => ({}) as PipeProcess,
        });
        await expect(runner.execute({ command: 'bun', args: 'build' }, makeCtx())).rejects.toThrow(
            'Action option "args" must be a string array',
        );
    });

    test('flushes a partial trailing multibyte sequence as a tail chunk', async () => {
        const bus: WorkflowObservabilityBus = new EventBus();
        const output: WorkflowActionOutputEvent[] = [];
        bus.on('workflow.action.output', (e) => output.push(e));
        const fakeExecutor: ProcessExecutor = {
            run: async () => ({ exitCode: 0 }) as ProcessResult,
            runStreaming: () => ({
                pid: 3,
                // 'c' + a dangling 2-byte lead (0xc3); the stream closes without the continuation byte.
                stdout: new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array([0x63, 0xc3]));
                        controller.close();
                    },
                }),
                stderr: null,
                exited: Promise.resolve(0),
                writeStdin: () => undefined,
                endStdin: () => undefined,
                kill: () => undefined,
            }),
        };
        const runner = new StreamingShellActionRunner(fakeExecutor, bus);
        const result = await runner.execute({ command: 'echo partial' }, makeCtx());

        // The final decode() flush surfaces the buffered lead byte as U+FFFD.
        expect(result.data?.stdout).toContain('\ufffd');
        const chunks = output
            .filter((e) => e.stream === 'stdout')
            .map((e) => e.chunk)
            .join('');
        expect(chunks).toContain('\ufffd');
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

    test('exports workflow vars as process env (env-var handoff)', async () => {
        let capturedOptions: PipeProcessOptions | undefined;
        const fakeExecutor: ProcessExecutor = {
            run: async () => ({ exitCode: 0 }) as ProcessResult,
            runStreaming: (options) => {
                capturedOptions = options;
                return {
                    pid: 9,
                    stdout: null,
                    stderr: null,
                    exited: Promise.resolve(0),
                    writeStdin: () => undefined,
                    endStdin: () => undefined,
                    kill: () => undefined,
                };
            },
        };
        const runner = new StreamingShellActionRunner(fakeExecutor);
        await runner.execute({ command: 'echo hi' }, makeCtx({ vars: { idea: 'free text', __runId: 'r1' } }));

        // Resolved vars are handed to the subprocess as env, referenced by name in the command.
        expect(capturedOptions?.env?.idea).toBe('free text');
        expect(capturedOptions?.env?.__runId).toBe('r1');
        // The ambient process environment is inherited so the shell can still resolve tools.
        expect(capturedOptions?.env?.PATH).toBe(process.env.PATH);
    });

    test('treats a var carrying shell metacharacters as data — no injection (R3)', async () => {
        const value = '`printf INJECTED` $(printf INJECTED) "dq" \\bs';
        const runner = new StreamingShellActionRunner(new NodeProcessExecutor());
        const result = await runner.execute({ command: 'printf \'%s\' "$idea"' }, makeCtx({ vars: { idea: value } }));

        expect(result.ok).toBe(true);
        expect(result.data?.exitCode).toBe(0);
        // Observed literally: had backticks / $() executed, stdout would hold the command
        // outputs, not the inert text — and a second process would have been spawned.
        expect(result.data?.stdout).toBe(value);
    });

    test('doctor-status write survives a backtick idea and does not hang (R4)', async () => {
        const tmp = mkdtempSync(join(tmpdir(), 'spur-shell-'));
        const runId = 'run-0432';
        const idea = 'Use `cat .spur/run/x` and $(ls) and "q" and \\path in prose';
        const runner = new StreamingShellActionRunner(new NodeProcessExecutor());
        const command = [
            'mkdir -p .spur/run',
            'DOCTOR_FILE=".spur/run/$__runId-idea-precheck-doctor.status"',
            'if test -n "$idea"; then printf "PASS\\n" > "$DOCTOR_FILE"; else printf "FAIL\\n" > "$DOCTOR_FILE"; fi',
            'exit 0',
        ].join(' && ');
        const result = await runner.execute({ command, cwd: tmp }, makeCtx({ vars: { __runId: runId, idea } }));

        expect(result.ok).toBe(true);
        expect(result.data?.exitCode).toBe(0);
        const statusFile = join(tmp, '.spur/run', `${runId}-idea-precheck-doctor.status`);
        expect(readFileSync(statusFile, 'utf8')).toBe('PASS\n');
    });
});
