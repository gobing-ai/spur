import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentExecutionEvent } from './agent-execution';

/**
 * Configurable bounds for the per-run agent-output artifact (task 0414 R4).
 * Populated from the `agent.output` block in `.spur/config.yaml`; when a bound
 * is absent the sink applies its own default.
 */
export interface RunOutputSinkConfig {
    /** Hard cap on captured bytes; when exceeded the sink stops and marks truncation. Default 1 MiB. */
    maxBytes?: number;
    /** Hard cap on captured lines; when exceeded the sink stops and marks truncation. Default unbounded. */
    maxLines?: number;
}

/** Default byte bound for a per-run output artifact. */
export const DEFAULT_OUTPUT_MAX_BYTES = 1024 * 1024;

const TRUNCATION_MARKER =
    '\n=== [truncated] agent output capture reached its configured bound; further chunks were not written ===\n';

/**
 * Best-effort file sink for incremental agent output during a workflow
 * `agent.run` step (task 0414). Consumes the redacted, timestamped lifecycle
 * events produced by {@link AgentExecutionLifecycle} and appends them to
 * `.spur/run/<runId>-output.log` so a supervising operator or agent can tail
 * the run mid-flight.
 *
 * Contract (R3/R4/R5):
 *  - Consumes the `onOutput` relay as-is — the child's output policy stays
 *    `{ mode: 'buffered' }` and stdin stays `'ignore'`; no TTY is re-exposed.
 *  - Volume is bounded (bytes and/or lines, configurable); truncation is
 *    explicit in the artifact, never silent.
 *  - Every write is best-effort: an unwritable run dir or failing disk
 *    degrades the stream, never the agent run.
 */
export class RunOutputSink {
    /** Absolute path of the artifact file. */
    readonly filePath: string;

    private readonly maxBytes: number;
    private readonly maxLines: number | undefined;
    private fd: number | undefined;
    private bytes = 0;
    private lines = 0;
    private truncated = false;
    private closed = false;

    constructor(options: { dir: string; runId: string } & RunOutputSinkConfig) {
        this.filePath = join(options.dir, `${options.runId}-output.log`);
        this.maxBytes = options.maxBytes ?? DEFAULT_OUTPUT_MAX_BYTES;
        this.maxLines = options.maxLines;
        try {
            mkdirSync(options.dir, { recursive: true });
            this.fd = openSync(this.filePath, 'a');
        } catch {
            // Unwritable run dir → inert sink; the agent run must not be affected (R5).
            this.fd = undefined;
        }
    }

    /** True once the volume bound has been hit and the truncation marker written. */
    get isTruncated(): boolean {
        return this.truncated;
    }

    /** Deliver one lifecycle event to the artifact. Best-effort — never throws. */
    observe(event: AgentExecutionEvent): void {
        if (this.fd === undefined || this.closed) return;
        switch (event.kind) {
            case 'output':
                this.appendChunk(event.at, event.stream, event.chunk);
                break;
            case 'started':
                this.append(`# agent output — run ${event.runId} — ${event.agent} — ${event.at}\n`);
                this.append(`# invocation: ${event.invocation}\n`);
                break;
            case 'dropped':
                this.append(
                    `\n=== [dropped] ${event.chunks} chunk(s) discarded by the lifecycle relay under backpressure ===\n`,
                );
                break;
            case 'finished':
                this.append(`\n=== run ${event.outcome} (exit ${event.exitCode}) after ${event.durationMs}ms ===\n`);
                break;
            default:
                // heartbeat events carry no output — ignored.
                break;
        }
    }

    /** Flush and release the file handle. Idempotent. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        if (this.fd !== undefined) {
            try {
                closeSync(this.fd);
            } catch {
                // Best-effort (R5).
            }
            this.fd = undefined;
        }
    }

    private appendChunk(at: string, stream: 'stdout' | 'stderr', chunk: string): void {
        if (this.truncated) return;
        const text = `[${at}] ${stream}: ${chunk}\n`;
        const chunkBytes = Buffer.byteLength(text);
        const chunkLines = countNewlines(text);
        if (
            this.bytes + chunkBytes > this.maxBytes ||
            (this.maxLines !== undefined && this.lines + chunkLines > this.maxLines)
        ) {
            // Truncation must be visible — a silent cut reads as a complete log (R4).
            this.truncated = true;
            this.append(TRUNCATION_MARKER);
            return;
        }
        this.append(text);
    }

    private append(text: string): void {
        if (this.fd === undefined || this.closed) return;
        try {
            writeSync(this.fd, text);
            this.bytes += Buffer.byteLength(text);
            this.lines += countNewlines(text);
        } catch {
            // Best-effort: a failing disk must degrade the stream, not the run (R5).
        }
    }
}

function countNewlines(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) === 10) count += 1;
    }
    return count;
}
