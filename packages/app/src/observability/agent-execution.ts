import type { AgentRunCorrelation } from '@gobing-ai/ts-ai-runner';
import type { ProcessOutputChunk } from '@gobing-ai/ts-runtime';
import { type NormalizedAgentUsage, unavailableAgentUsage } from '../services/agent-usage';

const MAX_CHUNK_CHARS = 4096;
const MAX_PENDING_CHUNKS = 64;
const SECRET_PATTERN = /(?:sk-[a-z0-9_-]{8,}|(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+|bearer\s+\S+)/gi;

/** Versioned identity shared by every event in one agent execution. */
export interface AgentExecutionBase {
    readonly schemaVersion: 1;
    readonly eventId: string;
    readonly sequence: number;
    readonly runId: string;
    readonly executionId: string;
    readonly actionId?: string;
    readonly at: string;
    /** OS subprocess pid when known (may be absent for buffered/pipe runs). */
    readonly pid?: number;
    /** Producer-owned observability severity. */
    readonly severity?: 'info' | 'warning' | 'error';
}

/** Bounded capability attestation evidence entry (task 0706 R7). Mirrors the shared compare module's evaluation entry. */
export interface CapabilityEvidenceEntry {
    axis: string;
    required?: 'available' | 'enforced';
    state: 'enforced' | 'available' | 'unavailable' | 'unknown';
    provenance: 'native-known' | 'operator-configured' | 'unattested';
    satisfied: boolean;
}

/**
 * Routing decision attribution for one agent dispatch (task 0545 R1/R2).
 * Built from the resolution funnel result — role, resolved tier, resolved
 * executor, and selection source are recorded where they are decided, never
 * re-derived downstream. Carries identifiers/tiers only (R4): no prompt text,
 * command line, or configured secret value.
 */
export interface AgentRoutingAttribution {
    /** Role selector that produced this resolution (source `role`). */
    role?: string;
    /** Resolved capability tier. */
    tier: string;
    /** Resolved executor name. */
    executor: string;
    /** How the executor was selected: role resolution, explicit pin, agent.default, stage, phase, or priority. */
    source: 'role' | 'explicit' | 'default' | 'phase' | 'stage' | 'priority';
    /** Resolved model override (0679 R7). Absent when the executor pins no model —
     * recorded absent rather than a placeholder. */
    model?: string;
    /**
     * Capability attestation evidence for this dispatch (task 0706 R7): the
     * stage's declared requirements evaluated against the resolved executor's
     * attestation, closed-axis ordered. Bounded identifiers/states only.
     * Present only when the stage declared `requiresCapabilities`.
     */
    capabilities?: readonly CapabilityEvidenceEntry[];
}

/** Emitted after agent/model/invocation resolution and before process dispatch. */
export interface AgentExecutionStartedEvent extends AgentExecutionBase {
    readonly kind: 'started';
    readonly agent: string;
    readonly model?: string;
    readonly invocation: string;
    readonly timeoutMs?: number;
    /** Routing decision that produced this dispatch (task 0545 R1); absent for resolutions without a tier/executor. */
    readonly routing?: AgentRoutingAttribution;
}

/** One bounded, redacted stdout or stderr chunk observed during execution. */
export interface AgentExecutionOutputEvent extends AgentExecutionBase {
    readonly kind: 'output';
    readonly stream: 'stdout' | 'stderr';
    readonly chunk: string;
}

/** Periodic liveness projection for an active agent execution. */
export interface AgentExecutionHeartbeatEvent extends AgentExecutionBase {
    readonly kind: 'heartbeat';
    readonly elapsedMs: number;
    readonly timeoutMs?: number;
}

/** Backpressure telemetry reporting output chunks discarded by the bounded relay. */
export interface AgentExecutionDroppedEvent extends AgentExecutionBase {
    readonly kind: 'dropped';
    readonly chunks: number;
}

/** Terminal execution outcome with timing, signal, and explicit usage availability. */
export interface AgentExecutionFinishedEvent extends AgentExecutionBase {
    readonly kind: 'finished';
    readonly outcome: 'done' | 'failed' | 'cancelled';
    readonly exitCode: number | null;
    readonly durationMs: number;
    readonly signal?: string;
    /**
     * Normalized usage (task 0707 R3): `unavailable` stays `unavailable` — the
     * dispatch lifecycle has no structured usage source today, so the producer
     * emits the honest unavailable shape and never a zero.
     */
    readonly usage: NormalizedAgentUsage;
    readonly reason?: string;
}

/** Canonical lifecycle event union shared by direct and workflow agent dispatch. */
export type AgentExecutionEvent =
    | AgentExecutionStartedEvent
    | AgentExecutionOutputEvent
    | AgentExecutionHeartbeatEvent
    | AgentExecutionDroppedEvent
    | AgentExecutionFinishedEvent;

function executionSeverity(detail: {
    kind: AgentExecutionEvent['kind'];
    outcome?: string;
}): 'info' | 'warning' | 'error' {
    if (detail.kind === 'dropped') return 'warning';
    if (detail.kind === 'finished') {
        if (detail.outcome === 'failed') return 'error';
        if (detail.outcome === 'cancelled') return 'warning';
    }
    return 'info';
}

/** Best-effort synchronous observer invoked by the asynchronous lifecycle relay. */
export type AgentExecutionObserver = (event: AgentExecutionEvent) => void;

/** Optional correlation, cancellation, observation, and heartbeat controls for one dispatch. */
export interface AgentExecutionOptions {
    readonly correlation?: AgentRunCorrelation;
    readonly signal?: AbortSignal;
    readonly observer?: AgentExecutionObserver;
    readonly heartbeatMs?: number;
}

interface LifecycleStart {
    agent: string;
    model?: string;
    invocation: string;
    timeoutMs?: number;
    /** Routing decision attribution for this dispatch (task 0545 R1). */
    routing?: AgentRoutingAttribution;
}

interface LifecycleFinish {
    exitCode: number | null;
    durationMs: number;
    signal?: string;
    reason?: string;
    /** Structured usage when the dispatch layer measured one (0707 R3); else unavailable. */
    usage?: NormalizedAgentUsage;
}

/**
 * Per-dispatch lifecycle with a bounded asynchronous output relay.
 *
 * Child-stream callbacks only sanitize and enqueue. Observer work runs in
 * microtasks, so a terminal/file sink cannot apply backpressure to the child.
 */
export class AgentExecutionLifecycle {
    private sequence = 0;
    private readonly correlation: AgentRunCorrelation;
    private readonly queue: AgentExecutionOutputEvent[] = [];
    private draining = false;
    private dropped = 0;
    private heartbeat: ReturnType<typeof setInterval> | undefined;
    private startedAt = 0;
    private timeoutMs: number | undefined;
    private pid: number | undefined;
    private readonly outputCarry: Record<ProcessOutputChunk['stream'], string> = { stdout: '', stderr: '' };

    constructor(
        private readonly observer: AgentExecutionObserver | undefined,
        correlation: AgentRunCorrelation | undefined,
        private readonly secrets: readonly string[],
        private readonly heartbeatMs = 30_000,
    ) {
        this.correlation = correlation ?? {
            runId: crypto.randomUUID(),
            executionId: crypto.randomUUID(),
        };
    }

    get identity(): AgentRunCorrelation {
        return this.correlation;
    }

    /**
     * Record the OS pid of the dispatched subprocess. Every event emitted after
     * this call carries it, so progress lines can name the process while it is
     * still running. Called from the executor's spawn observer; ignored for
     * dispatches that never report one, which keeps `pid` genuinely optional.
     */
    setPid(pid: number): void {
        if (Number.isInteger(pid) && pid > 0) this.pid = pid;
    }

    start(detail: LifecycleStart): void {
        this.startedAt = Date.now();
        this.timeoutMs = detail.timeoutMs;
        this.emit({
            kind: 'started',
            agent: redactAndBound(detail.agent, this.secrets, 256),
            ...(detail.model !== undefined ? { model: redactAndBound(detail.model, this.secrets, 256) } : {}),
            invocation: redactAndBound(detail.invocation, this.secrets, 512),
            ...(detail.timeoutMs !== undefined ? { timeoutMs: detail.timeoutMs } : {}),
            ...(detail.routing !== undefined ? { routing: detail.routing } : {}),
        });
        if (!this.observer || this.heartbeatMs <= 0) return;
        this.heartbeat = setInterval(() => {
            // Output events receive their sequence when the producer enqueues them.
            // Drain them before emitting a later heartbeat so observer delivery
            // order remains consistent with the event sequence.
            this.drain();
            this.emit({
                kind: 'heartbeat',
                elapsedMs: Math.max(0, Date.now() - this.startedAt),
                ...(this.timeoutMs !== undefined ? { timeoutMs: this.timeoutMs } : {}),
            });
        }, this.heartbeatMs);
        this.heartbeat.unref?.();
    }

    observe(output: ProcessOutputChunk): void {
        if (!this.observer) return;
        const combined = this.outputCarry[output.stream] + output.chunk;
        const { ready, carry } = redactStreamingValue(combined, this.secrets);
        this.outputCarry[output.stream] = carry;
        if (ready === '') return;
        this.enqueueOutput(output.stream, ready);
    }

    finish(detail: LifecycleFinish): void {
        if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        for (const stream of ['stdout', 'stderr'] as const) {
            const carry = this.outputCarry[stream];
            this.outputCarry[stream] = '';
            if (carry !== '') this.enqueueOutput(stream, redactAndBound(carry, this.secrets, MAX_CHUNK_CHARS));
        }
        this.drain();
        if (this.dropped > 0) {
            this.emit({ kind: 'dropped', chunks: this.dropped });
            this.dropped = 0;
        }
        const cancelled = detail.signal !== undefined || detail.reason === 'cancelled';
        this.emit({
            kind: 'finished',
            outcome: cancelled ? 'cancelled' : detail.exitCode === 0 ? 'done' : 'failed',
            exitCode: detail.exitCode,
            durationMs: detail.durationMs,
            ...(detail.signal !== undefined ? { signal: detail.signal } : {}),
            usage: detail.usage ?? unavailableAgentUsage(),
            ...(detail.reason !== undefined ? { reason: redactAndBound(detail.reason, this.secrets, 512) } : {}),
        });
    }

    private enqueueOutput(stream: ProcessOutputChunk['stream'], chunk: string): void {
        if (this.queue.length >= MAX_PENDING_CHUNKS) {
            this.dropped += 1;
            return;
        }
        this.queue.push(
            this.makeEvent({
                kind: 'output',
                stream,
                chunk: redactAndBound(chunk, this.secrets, MAX_CHUNK_CHARS),
            }),
        );
        this.scheduleDrain();
    }

    private scheduleDrain(): void {
        if (this.draining) return;
        this.draining = true;
        queueMicrotask(() => this.drain());
    }

    private drain(): void {
        this.draining = false;
        while (this.queue.length > 0) {
            const event = this.queue.shift();
            if (event !== undefined) this.deliver(event);
        }
    }

    private emit(
        detail:
            | Omit<AgentExecutionStartedEvent, keyof AgentExecutionBase>
            | Omit<AgentExecutionHeartbeatEvent, keyof AgentExecutionBase>
            | Omit<AgentExecutionDroppedEvent, keyof AgentExecutionBase>
            | Omit<AgentExecutionFinishedEvent, keyof AgentExecutionBase>,
    ): void {
        this.deliver(this.makeEvent(detail) as AgentExecutionEvent);
    }

    private makeEvent<T extends { kind: AgentExecutionEvent['kind'] }>(detail: T): T & AgentExecutionBase {
        this.sequence += 1;
        return {
            ...detail,
            schemaVersion: 1,
            eventId: crypto.randomUUID(),
            sequence: this.sequence,
            runId: this.correlation.runId,
            executionId: this.correlation.executionId,
            severity: executionSeverity(detail),
            ...(this.correlation.actionId !== undefined ? { actionId: this.correlation.actionId } : {}),
            ...(this.pid !== undefined ? { pid: this.pid } : {}),
            at: new Date().toISOString(),
        };
    }

    private deliver(event: AgentExecutionEvent): void {
        try {
            this.observer?.(event);
        } catch {
            // Lifecycle observation cannot change process semantics.
        }
    }
}

/** Secret values from configured environment entries, excluding trivial values. */
export function configuredSecretValues(env: Record<string, string | undefined>): string[] {
    return Object.entries(env)
        .filter(
            ([key, value]) =>
                /(?:secret|token|password|api[_-]?key|credential)/i.test(key) && (value?.length ?? 0) >= 4,
        )
        .map(([, value]) => value as string);
}

/** Redact known values and common credential forms before applying the size bound. */
export function redactAndBound(value: string, secrets: readonly string[], maxChars: number): string {
    let redacted = value.replace(SECRET_PATTERN, '[REDACTED]');
    for (const secret of secrets) {
        if (secret !== '') redacted = redacted.split(secret).join('[REDACTED]');
    }
    return redacted.length <= maxChars ? redacted : `${redacted.slice(0, maxChars)}…`;
}

function redactStreamingValue(value: string, secrets: readonly string[]): { ready: string; carry: string } {
    const redacted = redactAndBound(value, secrets, Number.MAX_SAFE_INTEGER);
    let carryLength = 0;
    for (const secret of secrets) {
        for (let length = 1; length < secret.length && length <= redacted.length; length += 1) {
            if (redacted.endsWith(secret.slice(0, length))) carryLength = Math.max(carryLength, length);
        }
    }
    return {
        ready: carryLength === 0 ? redacted : redacted.slice(0, -carryLength),
        carry: carryLength === 0 ? '' : redacted.slice(-carryLength),
    };
}
