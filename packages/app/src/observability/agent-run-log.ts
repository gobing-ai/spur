import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { redactAndBound } from './agent-execution';

/**
 * The bound an agent run's record may reach before it is truncated with a marker
 * (mirrors the workflow sink's `DEFAULT_RUN_LOG_MAX_BYTES`, ADR-131).
 */
export const DEFAULT_AGENT_RUN_LOG_MAX_BYTES = 1024 * 1024;

/** Visible cut marker — a silent stop would read as a complete record (G71 R1). */
const TRUNCATION_MARKER =
    '\n=== [truncated] consolidated run log reached its configured bound; further lines were not written ===\n';

/** Which stream a frame came from; the record keeps them distinguishable. */
export type AgentRunLogStream = 'stdout' | 'stderr';

/** Construction options for {@link AgentRunLog}: where the record lives and what to redact. */
export interface AgentRunLogOptions {
    /** `.spur/memory/runs` — the same durable plane the workflow record pair lives in. */
    dir: string;
    runId: string;
    /** Configured secret values scrubbed at this persistence boundary (0925 R3). */
    secrets?: readonly string[];
    maxBytes?: number;
}

/**
 * The durable half of ADR-132's "every execution is a run": a redacted, byte-capped
 * `stdout`/`stderr` record at `.spur/memory/runs/<runId>.md`, written beside the workflow
 * run records so one trace command can read both.
 *
 * Sibling of {@link WorkflowRunLogSink}, not a subclass: the sink subscribes to the
 * `workflow.*` observability bus, while an agent run is fed from the agent service's own
 * `onOutput` hook (see R1's refine correction). The two share the persistence contract —
 * `redactAndBound` with no extra bound, the same byte cap, one truncation marker, and a
 * best-effort failure rule — which is what makes the records interchangeable to a reader.
 *
 * Deliberately no `.state.json`: the `coordination_runs` row IS this run's state.
 */
export class AgentRunLog {
    private readonly filePath: string;
    private readonly secrets: readonly string[];
    private readonly maxBytes: number;
    private fd: number | undefined;
    private closed = false;
    private openFailed = false;
    private bytes = 0;
    private truncated = false;

    constructor(options: AgentRunLogOptions) {
        this.filePath = join(options.dir, `${options.runId}.md`);
        this.secrets = options.secrets ?? [];
        this.maxBytes = options.maxBytes ?? DEFAULT_AGENT_RUN_LOG_MAX_BYTES;
    }

    /** The record this log writes, for a trace node's `logPath`. */
    get path(): string {
        return this.filePath;
    }

    /** True once the volume bound was hit and the marker written. */
    get isTruncated(): boolean {
        return this.truncated;
    }

    /**
     * Open on first use and latch an unwritable dir as inert (R8): a record that cannot
     * be written must never fail, slow, or retry the run it describes.
     */
    private ensureOpen(): boolean {
        if (this.fd !== undefined) return true;
        if (this.closed || this.openFailed) return false;
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            this.fd = openSync(this.filePath, 'a');
        } catch {
            this.openFailed = true;
            return false;
        }
        return true;
    }

    /** Write the run's opening line once, before the first frame. */
    writeHeader(line: string): void {
        this.appendRaw(`# ${line}\n`);
    }

    /** Append one output frame, redacted and `[ISO] stream| …`-formatted. */
    append(stream: AgentRunLogStream, line: string, at: string = new Date().toISOString()): void {
        this.appendRaw(`[${at}] ${stream}| ${line}\n`);
    }

    /** Close the record. Idempotent; a failing close is best-effort (R8). */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        if (this.fd === undefined) return;
        try {
            closeSync(this.fd);
        } catch {
            // Best-effort (R8).
        }
        this.fd = undefined;
    }

    private appendRaw(text: string): void {
        if (this.closed || this.truncated || !this.ensureOpen()) return;
        const fd = this.fd;
        if (fd === undefined) return; // Latched inert above; narrows for the write below.
        // Persistence-boundary redaction (0925 R3): a secret must not reach disk even when
        // an upstream bound was best-effort. MAX_SAFE_INTEGER keeps the byte accounting
        // below as the only truncation authority.
        const redacted = redactAndBound(text, this.secrets, Number.MAX_SAFE_INTEGER);
        const textBytes = Buffer.byteLength(redacted);
        if (this.bytes + textBytes > this.maxBytes) {
            this.truncated = true;
            try {
                writeSync(fd, TRUNCATION_MARKER);
            } catch {
                // Best-effort (R8).
            }
            return;
        }
        try {
            writeSync(fd, redacted);
            this.bytes += textBytes;
        } catch {
            // Best-effort (R8): a failing disk degrades the record, never the run.
        }
    }
}
