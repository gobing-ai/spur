import {
    closeSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type {
    WorkflowAgentBudgetEvent,
    WorkflowAgentContractViolationEvent,
    WorkflowObservabilityBus,
    WorkflowObservabilityEventMap,
    WorkflowRunFinalizedEvent,
    WorkflowRunStartedEvent,
    WorkflowTripwireFiredEvent,
} from '../workflow/observability';
import { bounded } from '../workflow/observability';
import type { SteeringAck } from '../workflow/steering';
import { renderStepLine, type StepEvent } from '../workflow/step-reporter';
import { type AgentExecutionEvent, redactAndBound } from './agent-execution';

/** Configurable bounds for the per-run all-in-one log (feature D2 / ADR-045). */
export interface WorkflowRunLogConfig {
    /** Hard cap on captured bytes; when exceeded the sink stops and marks truncation. Default 1 MiB. */
    maxBytes?: number;
    /** Hard cap on captured lines; when exceeded the sink stops and marks truncation. Default unbounded. */
    maxLines?: number;
}

/** Default byte bound for a per-run run log. */
export const DEFAULT_RUN_LOG_MAX_BYTES = 1024 * 1024;

/** Steering note text is redacted and bounded before this char bound (R4). */
const MAX_STEERING_NOTE_CHARS = 1024;

const TRUNCATION_MARKER =
    '\n=== [truncated] consolidated run log reached its configured bound; further lines were not written ===\n';

/**
 * Two-file workflow run record for logging-enabled runs (E7 / task 0925, on the
 * feature D2 / 0426 sink): a read-only subscriber on the
 * {@link WorkflowObservabilityBus} that appends the human run log to
 * `.spur/run/<RUNID>.md` and atomically replaces the machine state at
 * `.spur/run/<RUNID>.state.json`, from run creation to terminal status.
 *
 * Privacy is enforced at this persistence boundary (0925 R3): upstream event
 * redaction is best-effort, so every appended line and the state projection are
 * scrubbed against the configured secrets again before either file is written.
 * Both files are keyed to the authoritative run ID and never replace the DB
 * trace, `run.artifact` metadata, task/feature verdicts, or explicit
 * `--trace-file` output — the markdown log is evidence, never a completion
 * proof. Like the run itself, writes are best-effort: an unwritable
 * `.spur/run/` dir or failing disk degrades the record, never the run.
 */
export class WorkflowRunLogSink {
    /** Absolute path of the append-only human run log. */
    readonly filePath: string;

    /** Absolute path of the atomically replaced machine state projection. */
    readonly statePath: string;

    private readonly maxBytes: number;
    private readonly maxLines: number | undefined;
    private readonly planPreview?: string;
    private readonly secrets: readonly string[];
    private readonly runId: string;
    private workflowName: string | undefined;
    private startedAt: string | undefined;
    private fd: number | undefined;
    private bytes = 0;
    private lines = 0;
    private truncated = false;
    private closed = false;
    private headerWritten = false;
    private readonly bus: WorkflowObservabilityBus;
    private readonly handlers: Partial<WorkflowObservabilityEventMap>;

    constructor(
        options: {
            bus: WorkflowObservabilityBus;
            dir: string;
            runId: string;
            planPreview?: string;
            /** Configured secret values scrubbed at this persistence boundary (0925 R3). */
            secrets?: readonly string[];
        } & WorkflowRunLogConfig,
    ) {
        this.filePath = join(options.dir, `${options.runId}.md`);
        this.statePath = join(options.dir, `${options.runId}.state.json`);
        this.maxBytes = options.maxBytes ?? DEFAULT_RUN_LOG_MAX_BYTES;
        this.maxLines = options.maxLines;
        this.planPreview = options.planPreview;
        this.secrets = options.secrets ?? [];
        this.runId = options.runId;
        try {
            mkdirSync(options.dir, { recursive: true });
            this.fd = openSync(this.filePath, 'a');
        } catch {
            // Unwritable run dir → inert sink; the run must not be affected (R8).
            this.fd = undefined;
        }
        this.bus = options.bus;
        this.handlers = {
            'workflow.run.started': (event) => this.onRunStarted(event),
            'workflow.phase': (event) => this.onProgress(event),
            'workflow.transition': (event) => this.onProgress(event),
            'workflow.action.started': (event) => this.onProgress(event),
            'workflow.action.finished': (event) => this.onProgress(event),
            'workflow.action.output': (event) => this.onProgress(event),
            'workflow.agent': (event) => this.onAgent(event),
            'workflow.agent.budget': (event) => this.onBudget(event),
            'workflow.agent.contract-violation': (event) => this.onContractViolation(event),
            'workflow.tripwire.fired': (event) => this.onTripwire(event),
            'workflow.steering': (event) => this.onSteering(event),
            'workflow.run.finalized': (event) => this.onRunFinalized(event),
        };
        this.register(true);
    }

    /** True once the volume bound has been hit and the truncation marker written. */
    get isTruncated(): boolean {
        return this.truncated;
    }

    /** Unsubscribe from the bus and release the file handle. Idempotent. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.register(false);
        if (this.fd !== undefined) {
            try {
                closeSync(this.fd);
            } catch {
                // Best-effort (R8).
            }
            this.fd = undefined;
        }
    }

    private register(attach: boolean): void {
        for (const name of RUN_LOG_EVENT_NAMES) {
            const handler = this.handlers[name];
            if (handler === undefined) continue;
            if (attach) this.bus.on(name, handler);
            else this.bus.off(name, handler);
        }
    }

    private onRunStarted(event: WorkflowRunStartedEvent): void {
        // The bus can carry more than one `workflow.run.started` projection (adapter
        // verb-form + engine-native bridge). The header + plan preview belong exactly
        // once, at run creation.
        if (this.headerWritten) return;
        this.headerWritten = true;
        this.workflowName = event.workflowName;
        this.startedAt = event.at;
        this.append(`# spur workflow run ${event.runId} — ${event.workflowName} — started ${event.at}\n`);
        if (this.planPreview !== undefined) this.append(`# ${this.planPreview}\n`);
        this.writeState('running', event.at);
    }

    private onProgress(event: StepEvent): void {
        const line = renderStepLine(event, { detail: 'full', showRunId: true });
        if (line === null) return;
        this.append(`[${event.at}] ${line}\n`);
    }

    private onRunFinalized(event: WorkflowRunFinalizedEvent): void {
        this.append(`\n=== workflow run ${event.runId} finished — status ${event.status} — ${event.at} ===\n`);
        // State copies the terminal status verbatim from the trace event: the DB
        // trace stays the lifecycle authority, state only summarizes it (0925 R2).
        this.writeState(event.status, event.at);
    }

    /**
     * Atomically replace `.spur/run/<RUNID>.state.json` (0925 R1). Minimal
     * private projection: schema version, authoritative run identity, and the
     * run status (`running` until the trace event settles a terminal value).
     * Same-directory temp file + rename, so readers never see a partial JSON;
     * the append-only `.md` log is NOT atomic by design. Best-effort (R8).
     */
    private writeState(status: 'running' | WorkflowRunFinalizedEvent['status'], at: string): void {
        // A resumed run never re-emits `workflow.run.started` (resume creates no
        // run row), so this sink instance lacks the original `workflowName` and
        // `startedAt`. Carry those two forward from the prior VALID state file —
        // never from the markdown (0926 R3: no synthesis from the log). A missing
        // or invalid prior state stays an explicit gap: fall back to this event's
        // timestamp rather than inventing an identity.
        if (this.startedAt === undefined || this.workflowName === undefined) {
            try {
                const prior: unknown = JSON.parse(readFileSync(this.statePath, 'utf8'));
                if (prior !== null && typeof prior === 'object' && !Array.isArray(prior)) {
                    const record = prior as Record<string, unknown>;
                    if (this.startedAt === undefined && typeof record.startedAt === 'string') {
                        this.startedAt = record.startedAt;
                    }
                    if (this.workflowName === undefined && typeof record.workflowName === 'string') {
                        this.workflowName = record.workflowName;
                    }
                }
            } catch {
                // No prior state (legacy run) or unreadable file — proceed with event-derived fields.
            }
        }
        const state = {
            schemaVersion: 1 as const,
            runId: this.runId,
            ...(this.workflowName !== undefined
                ? { workflowName: redactAndBound(this.workflowName, this.secrets, Number.MAX_SAFE_INTEGER) }
                : {}),
            status,
            startedAt: this.startedAt ?? at,
            updatedAt: at,
            ...(status !== 'running' ? { finalizedAt: at } : {}),
        };
        const temp = `${this.statePath}.tmp`;
        try {
            writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
            renameSync(temp, this.statePath);
        } catch {
            // Best-effort (R8): a failing state write degrades the record, never the
            // run — and never leaves `.tmp` residue behind (0926 R1).
            try {
                unlinkSync(temp);
            } catch {
                // Nothing to clean (temp was never created).
            }
        }
    }

    private onSteering(ack: SteeringAck): void {
        const note = ack.note === undefined ? '' : ` · ${bounded(ack.note, MAX_STEERING_NOTE_CHARS)}`;
        this.append(`[${ack.at}] [steer] ${ack.accepted ? 'ack' : 'nack'} ${ack.operation}${note}\n`);
    }

    /** Child-agent lifecycle events — the current `RunOutputSink` chunk contract (R3). */
    private onAgent(event: AgentExecutionEvent): void {
        if (this.fd === undefined || this.closed) return;
        switch (event.kind) {
            case 'output':
                this.append(`[${event.at}] ${event.stream}: ${event.chunk}\n`);
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
            case 'heartbeat': {
                // R3 (0454): mid-hop liveness for `spur workflow trace --follow --output`
                const timeout = event.timeoutMs !== undefined ? ` timeoutMs=${event.timeoutMs}` : '';
                this.append(`[${event.at}] agent.run progress: elapsed=${event.elapsedMs}ms${timeout}\n`);
                break;
            }
            default:
                break;
        }
    }

    /** One bounded line per hard-budget verdict (0707 R6). */
    private onBudget(event: WorkflowAgentBudgetEvent): void {
        if (this.fd === undefined || this.closed) return;
        const caps = [
            event.budget.maxTokens !== undefined ? `maxTokens=${event.budget.maxTokens}` : undefined,
            event.budget.maxCostUsd !== undefined ? `maxCostUsd=${event.budget.maxCostUsd}` : undefined,
        ]
            .filter((cap) => cap !== undefined)
            .join(' ');
        this.append(
            `[${event.at}] budget ${event.verdict} node=${event.node} agent=${event.agent} ${caps}: ${event.violations.join('; ')}\n`,
        );
    }

    private onTripwire(event: WorkflowTripwireFiredEvent): void {
        if (this.fd === undefined || this.closed) return;
        this.append(
            `[${event.at}] tripwire ${event.policy.id} (v${event.policy.version}) ${event.response} node=${event.node}: ${event.observed} — next: ${event.nextDecision}\n`,
        );
    }

    /** One line naming the violated contract and observed value (ADR-118). */
    private onContractViolation(event: WorkflowAgentContractViolationEvent): void {
        if (this.fd === undefined || this.closed) return;
        const task = event.task !== undefined ? ` task=${event.task}` : '';
        this.append(
            `[${event.at}] contract-violation ${event.contract} observed=${event.observed} node=${event.node} agent=${event.agent}${task}\n`,
        );
    }

    private append(text: string): void {
        if (this.fd === undefined || this.closed || this.truncated) return;
        // Persistence-boundary redaction (0925 R3): upstream `bounded()` is
        // best-effort, so every line is scrubbed against the configured secrets
        // again before it can reach disk. MAX_SAFE_INTEGER → no extra bound; the
        // sink's own byte/line accounting below stays the truncation authority.
        const redacted = redactAndBound(text, this.secrets, Number.MAX_SAFE_INTEGER);
        const textBytes = Buffer.byteLength(redacted);
        const textLines = countNewlines(redacted);
        if (
            this.bytes + textBytes > this.maxBytes ||
            (this.maxLines !== undefined && this.lines + textLines > this.maxLines)
        ) {
            // Truncation must be visible — a silent cut reads as a complete log (R7/R11).
            this.truncated = true;
            try {
                writeSync(this.fd, TRUNCATION_MARKER);
            } catch {
                // Best-effort (R8).
            }
            return;
        }
        try {
            writeSync(this.fd, redacted);
            this.bytes += textBytes;
            this.lines += textLines;
        } catch {
            // Best-effort: a failing disk must degrade the stream, not the run (R8).
        }
    }
}

/** Every observability event the consolidated sink subscribes to. */
const RUN_LOG_EVENT_NAMES: Array<keyof WorkflowObservabilityEventMap> = [
    'workflow.run.started',
    'workflow.phase',
    'workflow.transition',
    'workflow.action.started',
    'workflow.action.finished',
    'workflow.action.output',
    'workflow.agent',
    'workflow.agent.budget',
    'workflow.agent.contract-violation',
    'workflow.tripwire.fired',
    'workflow.steering',
    'workflow.run.finalized',
];

function countNewlines(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) === 10) count += 1;
    }
    return count;
}
