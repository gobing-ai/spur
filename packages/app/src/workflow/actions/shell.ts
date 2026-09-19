import type { ActionRedactor, ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import { redactAndBound, redactStreamingValue } from '../../observability/agent-execution';
import { bounded, type WorkflowActionOutputEvent, type WorkflowObservabilityBus } from '../observability';
import { childProcessEnv } from './child-env';

const KIND = 'shell';

/** Persisted shell-output tail bound per stream (0901 R5). */
export const SHELL_OUTPUT_TAIL_BYTES = 65_536;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Last `maxBytes` UTF-8 bytes of `value`, never splitting a multi-byte
 * character (0901 R5): the scan advances past leading continuation bytes of the
 * cut window.
 */
export function utf8SafeByteTail(value: string, maxBytes: number): { tail: string; truncated: boolean } {
    const bytes = Buffer.from(value, 'utf8');
    if (bytes.byteLength <= maxBytes) return { tail: value, truncated: false };
    let start = bytes.byteLength - maxBytes;
    while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start += 1;
    return { tail: bytes.subarray(start).toString('utf8'), truncated: true };
}

/**
 * Shell action-result redactor for persistence (0901 R5): redact configured
 * secrets + secret patterns on the FULL stdout/stderr (never slice first, which
 * can leave a partial secret), then keep only a UTF-8-safe byte tail plus
 * `stdoutTruncated`/`stderrTruncated` booleans. Non-shell results pass through.
 */
export function createShellOutputRedactor(secrets: readonly string[]): ActionRedactor {
    return (kind, payload) => {
        if (kind !== KIND) return payload;
        const data = payload.data;
        if (!isRecord(data)) return payload;
        const next: Record<string, unknown> = { ...data };
        for (const stream of ['stdout', 'stderr'] as const) {
            const value = data[stream];
            if (typeof value !== 'string') continue;
            const redacted = redactAndBound(value, secrets, Number.MAX_SAFE_INTEGER);
            const { tail, truncated } = utf8SafeByteTail(redacted, SHELL_OUTPUT_TAIL_BYTES);
            next[stream] = tail;
            next[`${stream}Truncated`] = truncated;
        }
        return { ...payload, data: next };
    };
}

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
        /** Configured secret values redacted from streamed output (0901 R5). */
        private readonly secrets: readonly string[] = [],
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
        // Env-var handoff (task 0432): workflow vars are exported as process environment so a
        // command references them by name (`$idea`, `$__runId`) instead of the engine's inline
        // `${vars.*}` templates. A shell variable-expansion result is never re-parsed for shell
        // metacharacters, so a var carrying backticks / `$()` / quotes / backslashes is observed
        // as data — it cannot become code in the action's subprocess. Embedding var values into
        // the command string (engine template pre-resolution) is the bug this replaces; the
        // engine still pre-resolves `${vars.*}` in any option, so shell commands must use `$NAME`.
        const env = childProcessEnv(context.vars);
        const pipe = this.processExecutor.runStreaming({
            command: spawn.command,
            args: spawn.args,
            ...(cwd !== undefined ? { cwd } : {}),
            env,
        });
        let stdout = '';
        let stderr = '';
        // 0901 R5: per-stream carry so a configured secret split across chunks
        // cannot leak into the bus (and from there into CLI logs / the ledger).
        const carryFor: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
        const readers: Promise<void>[] = [];
        const emitChunk = (stream: 'stdout' | 'stderr', text: string): void => {
            if (this.observabilityBus === undefined || text === '') return;
            const event: WorkflowActionOutputEvent = {
                schemaVersion: 1,
                eventId: crypto.randomUUID(),
                sequence: 0,
                runId: context.runId,
                at: new Date().toISOString(),
                kind: KIND,
                node: context.stateOrNodeId,
                stream,
                chunk: bounded(text),
                severity: 'info',
            };
            // Sequence is a per-run monotonic counter; the CLI
            // reporter only reads stream/chunk, so a fresh counter
            // here is acceptable for the live progress view.
            this.observabilityBus.emit('workflow.action.output', event);
        };
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
                        const combined = carryFor[stream] + chunk;
                        const { ready, carry } = redactStreamingValue(combined, this.secrets);
                        carryFor[stream] = carry;
                        emitChunk(stream, ready);
                    }
                    // Flush decoder tail plus any carried secret-prefix bytes on stream end.
                    const decodedTail = decoder.decode();
                    if (stream === 'stdout') stdout += decodedTail;
                    else stderr += decodedTail;
                    const tail = carryFor[stream] + decodedTail;
                    carryFor[stream] = '';
                    if (tail !== '') {
                        const { ready, carry } = redactStreamingValue(tail, this.secrets);
                        emitChunk(stream, ready);
                        // Nothing follows; the carry cannot match a longer secret.
                        emitChunk(stream, redactAndBound(carry, this.secrets, Number.MAX_SAFE_INTEGER));
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
