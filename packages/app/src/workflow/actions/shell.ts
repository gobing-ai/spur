import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import { bounded, type WorkflowActionOutputEvent, type WorkflowObservabilityBus } from '../observability';

const KIND = 'shell';

function stringOption(options: Record<string, unknown>, key: string, fallback?: string): string {
    const value = options[key];
    if (typeof value === 'string') return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`Action option "${key}" must be a string`);
}

function arrayOption(options: Record<string, unknown>, key: string): string[] {
    const value = options[key];
    if (value === undefined) return [];
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value as string[];
    throw new Error(`Action option "${key}" must be a string array`);
}

/**
 * Streaming shell action — spur's replacement for the engine's buffered
 * `ShellActionRunner` (task 0421 R9). The engine's runner forces `all: true`
 * buffered capture, so a long-running shell command shows no live output. This
 * runner uses `ProcessExecutor.runStreaming` (Bun.spawn) so stdout/stderr chunks
 * stream to the observability bus (`workflow.action.output`) as they arrive,
 * while decoded output is still accumulated for the action-finished summary
 * (R10). The buffered result stays authoritative for the finish event.
 *
 * Registered in `registerSpurBuiltins` after `createDefaultWorkflowEngineHost`,
 * which replaces the engine's `shell` runner by kind (registerAction uses a Map).
 */
export class StreamingShellActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly processExecutor: ProcessExecutor,
        private readonly observabilityBus?: WorkflowObservabilityBus,
    ) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const command = stringOption(options, 'command');
        const explicitArgs = arrayOption(options, 'args');
        // Mirror the engine's ShellActionRunner semantics (ts-dual-workflow-engine
        // host.ts): with explicit args, run `command` as a program; with a bare
        // command line, run it via `/bin/sh -c` so shell features (`&&`, `|`,
        // quoting, globs) work as in `bun run autofix && bun run spur-check`.
        const usesShell = explicitArgs.length === 0;
        const spawn = usesShell ? { command: '/bin/sh', args: ['-c', command] } : { command, args: explicitArgs };
        const cwd = stringOption(options, 'cwd', context.workdir);
        const pipe = this.processExecutor.runStreaming({
            command: spawn.command,
            args: spawn.args,
            ...(cwd !== undefined ? { cwd } : {}),
        });
        let stdout = '';
        let stderr = '';
        const readers: Promise<void>[] = [];
        const consume = (stream: 'stdout' | 'stderr', readable: ReadableStream<Uint8Array> | null): void => {
            if (readable === null) return;
            const reader = readable.getReader();
            const decoder = new TextDecoder();
            readers.push(
                (async () => {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        if (chunk === '') continue;
                        if (stream === 'stdout') stdout += chunk;
                        else stderr += chunk;
                        if (this.observabilityBus !== undefined) {
                            const event: WorkflowActionOutputEvent = {
                                schemaVersion: 1,
                                eventId: crypto.randomUUID(),
                                sequence: 0,
                                runId: context.runId,
                                at: new Date().toISOString(),
                                kind: KIND,
                                node: context.stateOrNodeId,
                                stream,
                                chunk: bounded(chunk),
                            };
                            // Sequence is a per-run monotonic counter; the CLI
                            // reporter only reads stream/chunk, so a fresh counter
                            // here is acceptable for the live progress view.
                            this.observabilityBus.emit('workflow.action.output', event);
                        }
                    }
                    // Flush decoder tail on stream end.
                    const tail = decoder.decode();
                    if (tail !== '') {
                        if (stream === 'stdout') stdout += tail;
                        else stderr += tail;
                        if (this.observabilityBus !== undefined) {
                            this.observabilityBus.emit('workflow.action.output', {
                                schemaVersion: 1,
                                eventId: crypto.randomUUID(),
                                sequence: 0,
                                runId: context.runId,
                                at: new Date().toISOString(),
                                kind: KIND,
                                node: context.stateOrNodeId,
                                stream,
                                chunk: bounded(tail),
                            });
                        }
                    }
                })(),
            );
        };
        consume('stdout', pipe.stdout);
        consume('stderr', pipe.stderr);
        const exitCode = await pipe.exited;
        await Promise.allSettled(readers);
        return {
            ok: exitCode === 0,
            data: { stdout, stderr, exitCode },
            ...(exitCode === 0 ? {} : { error: `Command "${command}" exited with ${exitCode}` }),
        };
    }
}
