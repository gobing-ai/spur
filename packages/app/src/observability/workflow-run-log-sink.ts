import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type {
    WorkflowAgentBudgetEvent,
    WorkflowObservabilityBus,
    WorkflowObservabilityEventMap,
    WorkflowRunFinalizedEvent,
    WorkflowRunStartedEvent,
    WorkflowTripwireFiredEvent,
} from '../workflow/observability';
import { bounded } from '../workflow/observability';
import type { SteeringAck } from '../workflow/steering';
import { renderStepLine, type StepEvent } from '../workflow/step-reporter';
import type { AgentExecutionEvent } from './agent-execution';

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
 * Consolidated all-in-one per-run workflow run log (feature D2, task 0426).
 * A read-only subscriber on the {@link WorkflowObservabilityBus} that appends the
 * already-redacted, already-bounded event stream to `.spur/run/<RUNID>.log` from
 * run creation to terminal status, subsuming the agent-output-only `RunOutputSink`.
 *
 * The log carries the same content the foreground human renderer emits (plan
 * preview, per-step progress, transitions, final summary) plus child-agent
 * stdout/stderr and consumed steering commands. It is best-effort: an unwritable
 * `.spur/run/` dir or failing disk degrades the log, never the run.
 */
export class WorkflowRunLogSink {
    /** Absolute path of the log file. */
    readonly filePath: string;

    private readonly maxBytes: number;
    private readonly maxLines: number | undefined;
    private readonly planPreview?: string;
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
        } & WorkflowRunLogConfig,
    ) {
        this.filePath = join(options.dir, `${options.runId}.log`);
        this.maxBytes = options.maxBytes ?? DEFAULT_RUN_LOG_MAX_BYTES;
        this.maxLines = options.maxLines;
        this.planPreview = options.planPreview;
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
        this.append(`# spur workflow run ${event.runId} — ${event.workflowName} — started ${event.at}\n`);
        if (this.planPreview !== undefined) this.append(`# ${this.planPreview}\n`);
    }

    private onProgress(event: StepEvent): void {
        const line = renderStepLine(event, { detail: 'full', showRunId: true });
        if (line === null) return;
        this.append(`[${event.at}] ${line}\n`);
    }

    private onRunFinalized(event: WorkflowRunFinalizedEvent): void {
        this.append(`\n=== workflow run ${event.runId} finished — status ${event.status} — ${event.at} ===\n`);
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

    private append(text: string): void {
        if (this.fd === undefined || this.closed || this.truncated) return;
        const textBytes = Buffer.byteLength(text);
        const textLines = countNewlines(text);
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
            writeSync(this.fd, text);
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
