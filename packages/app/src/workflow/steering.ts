import { redactAndBound } from '../observability/agent-execution';

const MAX_STEERING_TIMEOUT_MS = 300_000;
const MAX_STEERING_ATTEMPTS = 10;

/** Operations accepted by the synchronous safe-boundary controller. */
export type SteeringOperation = 'continue' | 'note' | 'retry' | 'abort';
/** Observable state of the currently targeted steering action. */
export type SteeringState = 'running' | 'boundary' | 'completed';

/** Fully targeted, version-checked steering request. */
export interface SteeringCommand {
    readonly commandId: string;
    readonly runId: string;
    readonly actionId: string;
    readonly expectedState: SteeringState;
    readonly expectedVersion: number;
    readonly operation: SteeringOperation;
    readonly note?: string;
    readonly actor: string;
    readonly deadlineAt: string;
}

/** Durable-safe acknowledgement or rejection projection for a steering request. */
export interface SteeringAck {
    readonly schemaVersion: 1;
    readonly commandId: string;
    readonly runId: string;
    readonly actionId: string;
    readonly operation: SteeringOperation;
    readonly actor: string;
    readonly accepted: boolean;
    readonly state: SteeringState;
    readonly version: number;
    readonly reason?: string;
    readonly note?: string;
    readonly at: string;
}

/** Explicit declaration required before a failed action may be retried. */
export interface SteeringRetryPolicy {
    readonly idempotent: true;
    readonly maxAttempts: number;
}

/** Safe-boundary timeout and optional retry policy resolved from action options. */
export interface SteeringActionPolicy {
    readonly boundary: boolean;
    readonly timeoutMs: number;
    readonly retry?: SteeringRetryPolicy;
}

/** Read-only identity and version snapshot exposed to local command construction. */
export interface SteeringSnapshot {
    readonly runId: string;
    readonly actionId: string;
    readonly state: SteeringState;
    readonly version: number;
}

/** Effective operation returned to the action runner after a boundary settles. */
export interface SteeringDecision {
    readonly operation: SteeringOperation;
    readonly note?: string;
}

interface ActiveAction {
    runId: string;
    actionId: string;
    state: SteeringState;
    version: number;
    attempts: number;
    lastOk: boolean;
    policy: SteeringActionPolicy;
    controller: AbortController;
    resolve?: (decision: SteeringDecision) => void;
}

/**
 * In-process steering controller. It deliberately has no persistence or remote
 * transport: cross-process control requires a separately approved durable,
 * authenticated protocol.
 */
export class WorkflowSteeringController {
    private active: ActiveAction | undefined;
    private readonly seen = new Set<string>();

    constructor(
        private readonly onAck?: (ack: SteeringAck) => void,
        private readonly secrets: readonly string[] = [],
        private readonly allowedActors: ReadonlySet<string> = new Set(['operator']),
        private readonly onState?: (snapshot: SteeringSnapshot) => void,
    ) {}

    get snapshot(): SteeringSnapshot | undefined {
        const active = this.active;
        return active === undefined
            ? undefined
            : {
                  runId: active.runId,
                  actionId: active.actionId,
                  state: active.state,
                  version: active.version,
              };
    }

    begin(runId: string, actionId: string, policy: SteeringActionPolicy): AbortSignal {
        this.active = {
            runId,
            actionId,
            state: 'running',
            version: 1,
            attempts: 1,
            lastOk: false,
            policy,
            controller: new AbortController(),
        };
        this.publishState(this.active);
        return this.active.controller.signal;
    }

    async boundary(ok: boolean): Promise<SteeringDecision> {
        const active = this.requireActive();
        active.lastOk = ok;
        if (active.controller.signal.aborted) return { operation: 'abort' };
        if (!active.policy.boundary) return { operation: 'continue' };
        active.state = 'boundary';
        active.version += 1;
        this.publishState(active);
        return await new Promise<SteeringDecision>((resolve) => {
            const settle = (decision: SteeringDecision): void => {
                clearTimeout(timer);
                resolve(decision);
            };
            const timer = setTimeout(() => {
                if (active.resolve !== settle) return;
                active.resolve = undefined;
                this.acceptDefault(active, resolve);
            }, active.policy.timeoutMs);
            timer.unref?.();
            active.resolve = settle;
        });
    }

    nextAttempt(): AbortSignal {
        const active = this.requireActive();
        active.attempts += 1;
        active.state = 'running';
        active.version += 1;
        active.controller = new AbortController();
        this.publishState(active);
        return active.controller.signal;
    }

    complete(): void {
        const active = this.active;
        if (active === undefined) return;
        active.state = 'completed';
        active.version += 1;
        active.resolve = undefined;
        this.publishState(active);
    }

    submit(command: SteeringCommand): SteeringAck {
        const active = this.active;
        if (command.commandId.trim() === '') return this.reject(command, active, 'command id is required');
        if (this.seen.has(command.commandId)) return this.reject(command, active, 'duplicate command');
        this.seen.add(command.commandId);
        if (active === undefined) return this.reject(command, active, 'no active action');
        if (!this.allowedActors.has(command.actor)) return this.reject(command, active, 'unauthorized actor');
        const deadlineMs = Date.parse(command.deadlineAt);
        if (!Number.isFinite(deadlineMs)) return this.reject(command, active, 'invalid command deadline');
        if (deadlineMs < Date.now()) return this.reject(command, active, 'command deadline elapsed');
        if (command.runId !== active.runId || command.actionId !== active.actionId) {
            return this.reject(command, active, 'target does not match the active action');
        }
        if (command.expectedState !== active.state || command.expectedVersion !== active.version) {
            return this.reject(command, active, 'stale state or version');
        }
        if (active.state === 'completed') {
            return this.reject(command, active, 'completed action history is immutable');
        }
        if (command.operation === 'abort') {
            active.controller.abort();
            active.resolve?.({ operation: 'abort' });
            active.resolve = undefined;
            return this.accept(command, active);
        }
        if (active.state !== 'boundary' || active.resolve === undefined) {
            return this.reject(command, active, 'action is not paused at a steering boundary');
        }
        if (command.operation === 'retry') {
            const retry = active.policy.retry;
            if (active.lastOk) return this.reject(command, active, 'retry requires a failed attempt');
            if (retry === undefined || retry.idempotent !== true) {
                return this.reject(command, active, 'unsafe retry: no explicit idempotent retry policy');
            }
            if (active.attempts >= retry.maxAttempts) {
                return this.reject(command, active, 'retry limit reached');
            }
        }
        if (command.operation === 'note' && (command.note === undefined || command.note.trim() === '')) {
            return this.reject(command, active, 'note text is required');
        }
        const note =
            command.operation === 'note' && command.note !== undefined
                ? redactAndBound(command.note, this.secrets, 1024)
                : undefined;
        active.resolve({ operation: command.operation, ...(note !== undefined ? { note } : {}) });
        active.resolve = undefined;
        return this.accept(command, active, note);
    }

    /** Build a fully targeted local-operator command from the active snapshot. */
    submitLine(line: string, deadlineMs = 30_000): SteeringAck | undefined {
        const active = this.active;
        if (active === undefined) return undefined;
        const trimmed = line.trim();
        const [rawOperation, ...rest] = trimmed.split(/\s+/);
        if (!['continue', 'note', 'retry', 'abort'].includes(rawOperation ?? '')) return undefined;
        const operation = rawOperation as SteeringOperation;
        return this.submit({
            commandId: crypto.randomUUID(),
            runId: active.runId,
            actionId: active.actionId,
            expectedState: active.state,
            expectedVersion: active.version,
            operation,
            ...(operation === 'note' ? { note: rest.join(' ') } : {}),
            actor: 'operator',
            deadlineAt: new Date(Date.now() + deadlineMs).toISOString(),
        });
    }

    private acceptDefault(active: ActiveAction, resolve: (decision: SteeringDecision) => void): void {
        const command: SteeringCommand = {
            commandId: crypto.randomUUID(),
            runId: active.runId,
            actionId: active.actionId,
            expectedState: active.state,
            expectedVersion: active.version,
            operation: 'continue',
            actor: 'system-timeout',
            deadlineAt: new Date().toISOString(),
        };
        const ack: SteeringAck = {
            schemaVersion: 1,
            commandId: command.commandId,
            runId: command.runId,
            actionId: command.actionId,
            operation: command.operation,
            actor: command.actor,
            accepted: true,
            state: active.state,
            version: active.version,
            reason: 'boundary timeout defaulted to continue',
            at: new Date().toISOString(),
        };
        this.onAck?.(ack);
        resolve({ operation: 'continue' });
    }

    private accept(command: SteeringCommand, active: ActiveAction, note?: string): SteeringAck {
        return this.publish({
            schemaVersion: 1,
            commandId: command.commandId,
            runId: command.runId,
            actionId: command.actionId,
            operation: command.operation,
            actor: command.actor,
            accepted: true,
            state: active.state,
            version: active.version,
            ...(note !== undefined ? { note } : {}),
            at: new Date().toISOString(),
        });
    }

    private reject(command: SteeringCommand, active: ActiveAction | undefined, reason: string): SteeringAck {
        return this.publish({
            schemaVersion: 1,
            commandId: command.commandId,
            runId: command.runId,
            actionId: command.actionId,
            operation: command.operation,
            actor: command.actor,
            accepted: false,
            state: active?.state ?? 'completed',
            version: active?.version ?? 0,
            reason,
            at: new Date().toISOString(),
        });
    }

    private publish(ack: SteeringAck): SteeringAck {
        this.onAck?.(ack);
        return ack;
    }

    private requireActive(): ActiveAction {
        if (this.active === undefined) throw new Error('no active steering action');
        return this.active;
    }

    private publishState(active: ActiveAction): void {
        this.onState?.({
            runId: active.runId,
            actionId: active.actionId,
            state: active.state,
            version: active.version,
        });
    }
}

/** Parse conservative steering controls from an action's resolved option map. */
export function parseSteeringPolicy(options: Record<string, unknown>): SteeringActionPolicy {
    const boundary = options.steeringBoundary === true;
    const timeoutMs =
        typeof options.steeringTimeoutMs === 'number' &&
        Number.isFinite(options.steeringTimeoutMs) &&
        Number.isInteger(options.steeringTimeoutMs) &&
        options.steeringTimeoutMs > 0
            ? Math.min(options.steeringTimeoutMs, MAX_STEERING_TIMEOUT_MS)
            : 30_000;
    const rawRetry = options.retryPolicy;
    const retry =
        typeof rawRetry === 'object' &&
        rawRetry !== null &&
        'idempotent' in rawRetry &&
        rawRetry.idempotent === true &&
        'maxAttempts' in rawRetry &&
        typeof rawRetry.maxAttempts === 'number' &&
        Number.isFinite(rawRetry.maxAttempts) &&
        Number.isInteger(rawRetry.maxAttempts) &&
        rawRetry.maxAttempts > 1
            ? { idempotent: true as const, maxAttempts: Math.min(rawRetry.maxAttempts, MAX_STEERING_ATTEMPTS) }
            : undefined;
    return { boundary, timeoutMs, ...(retry !== undefined ? { retry } : {}) };
}
