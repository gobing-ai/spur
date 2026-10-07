/**
 * Decision lifecycle event emitter — design/decision-observability-and-adoption.md §3.2
 * (task 1095, slice S1/S2).
 *
 * Exactly one lifecycle shape per decision invocation: `decision.start` →
 * (`decision.success` | `decision.failure`) → `decision.end`, or `decision.rejected`
 * alone for a caller mistake refused before any maker call. All five names are
 * cataloged with source `decision` and payload policy `metadata-only`
 * (services/event-names.ts); this module owns payload construction, shared
 * `invocationId`, fixed ordering, and producer-stamped `severity` (§4).
 *
 * Every `bus.emit` is best-effort (§5): a listener throw or tap failure must
 * never change the returned decision or a caller's thrown error.
 */

import { DecisionCatalogError, UnknownDecisionError, UnknownDecisionMakerError } from '@gobing-ai/ts-ai-decision';
import { redactAndBound } from '../observability/agent-execution';
import type { SystemEventBus } from '../services/system-event-tap';
import type { DecisionMakerSource } from './decision-service';

/** Upper bound for the redacted `message` carried by `decision.rejected` (§3.2). */
const DECISION_MESSAGE_MAX_CHARS = 512;

/** Who asked for the decision. The workflow inline-question path is caller `workflow`. */
export type DecisionCaller = 'cli' | 'workflow' | 'gate';

/** Run/node correlation carried by every decision event for report joins. */
export interface DecisionCorrelation {
    readonly runId?: string;
    readonly workflowName?: string;
    readonly nodeId?: string;
    readonly wbs?: string;
}

/** Caller attribution passed by each producer; absent `correlation` is allowed. */
export interface DecisionCallContext {
    readonly caller: DecisionCaller;
    readonly correlation?: DecisionCorrelation;
}

/** One decision invocation: a decision id plus its caller context. */
export interface DecisionInvocationContext extends DecisionCallContext {
    readonly decisionId: string;
}

/** Maker attribution: the effective `DecisionMakerSource`, or `inline` for the workflow inline-question path. */
export type DecisionEventMakerSource = DecisionMakerSource | 'inline';

/** Start payload facts: the maker being asked and how it was resolved. */
export interface DecisionStartFields {
    readonly type: string;
    readonly maker: string;
    readonly makerSource: DecisionEventMakerSource;
    readonly catalogLayer: string;
    readonly inputKeys: readonly string[];
    readonly evidenceDigest?: string;
    readonly minConfidence: number;
}

/** Accepted model answer (no fallback). */
export interface DecisionTerminalFields {
    readonly value: string | number | boolean;
    readonly confidence: number | null;
    readonly maker: string;
}

/** Served fallback answer instead of a model answer. */
export interface DecisionFailureFields {
    readonly reason: string;
    readonly fallbackValue: string | number | boolean;
    readonly confidence: number | null;
    readonly maker: string;
    readonly error?: string;
}

/** Always-emitted close of the invocation, from a finally block. */
export interface DecisionEndFields {
    readonly durationMs: number;
    readonly value?: string | number | boolean;
    readonly source?: string;
    readonly reason?: string;
    readonly maker?: string;
    readonly confidence?: number | null;
}

/** The one lifecycle opened by {@link beginDecisionInvocation}. */
export interface DecisionInvocation {
    /** Emit `decision.success` — an accepted model answer. */
    succeed(fields: DecisionTerminalFields): void;
    /** Emit `decision.failure` — the fallback was served. */
    fail(fields: DecisionFailureFields): void;
    /** Emit `decision.end` — call once, from a finally block, after the terminal event. */
    end(fields: DecisionEndFields): void;
}

/** Closed error-kind vocabulary for `decision.rejected` (§3.2). */
export function decisionErrorKind(error: unknown): 'catalog' | 'error' | 'unknown-decision' | 'unknown-decision-maker' {
    if (error instanceof UnknownDecisionError) return 'unknown-decision';
    if (error instanceof UnknownDecisionMakerError) return 'unknown-decision-maker';
    if (error instanceof DecisionCatalogError) return 'catalog';
    return 'error';
}

/**
 * Emit `decision.rejected` for a caller mistake refused before any maker call.
 * Single-event lifecycle: no start/end pair accompanies it. `maker` is included
 * only when the producer already knows the effective maker name.
 */
export function emitDecisionRejected(
    bus: SystemEventBus | undefined,
    ctx: DecisionInvocationContext,
    error: unknown,
    maker?: string,
): void {
    const message = error instanceof Error ? error.message : String(error);
    emitDecisionEvent(bus, 'decision.rejected', {
        invocationId: crypto.randomUUID(),
        decisionId: ctx.decisionId,
        caller: ctx.caller,
        ...(ctx.correlation !== undefined ? { correlation: { ...ctx.correlation } } : {}),
        severity: 'error',
        errorKind: decisionErrorKind(error),
        message: redactAndBound(message, [], DECISION_MESSAGE_MAX_CHARS),
        ...(maker !== undefined ? { maker } : {}),
    });
}

/**
 * Open a decision lifecycle: emit `decision.start` and return the terminal pair.
 * Order is fixed — start first, then exactly one of succeed/fail, then end — so
 * callers keep the service `try { … terminal } finally { end }` shape. A maker
 * throw between start and end still closes with `end` via that finally.
 */
export function beginDecisionInvocation(
    bus: SystemEventBus | undefined,
    ctx: DecisionInvocationContext,
    start: DecisionStartFields,
): DecisionInvocation {
    const invocationId = crypto.randomUUID();
    const base = (): Record<string, unknown> => ({
        invocationId,
        decisionId: ctx.decisionId,
        caller: ctx.caller,
        ...(ctx.correlation !== undefined ? { correlation: { ...ctx.correlation } } : {}),
    });
    emitDecisionEvent(bus, 'decision.start', {
        ...base(),
        severity: 'info',
        type: start.type,
        maker: start.maker,
        makerSource: start.makerSource,
        catalogLayer: start.catalogLayer,
        inputKeys: [...start.inputKeys],
        ...(start.evidenceDigest !== undefined ? { evidenceDigest: start.evidenceDigest } : {}),
        minConfidence: start.minConfidence,
    });
    return {
        succeed(fields: DecisionTerminalFields): void {
            emitDecisionEvent(bus, 'decision.success', { ...base(), severity: 'info', ...fields });
        },
        fail(fields: DecisionFailureFields): void {
            // Reason `error` is a backend fault (error severity); the other
            // fallback reasons are expected degradation (warning).
            emitDecisionEvent(bus, 'decision.failure', {
                ...base(),
                severity: fields.reason === 'error' ? 'error' : 'warning',
                ...fields,
            });
        },
        end(fields: DecisionEndFields): void {
            emitDecisionEvent(bus, 'decision.end', { ...base(), severity: 'info', ...fields });
        },
    };
}

/** Best-effort emit: an undefined bus is a no-op, and listener/tap failures are swallowed (§5). */
function emitDecisionEvent(bus: SystemEventBus | undefined, name: string, payload: Record<string, unknown>): void {
    if (bus === undefined) return;
    try {
        void bus.emit(name, payload).catch(() => {
            // The bus already logs handler errors; never surface them to the decision caller.
        });
    } catch {
        // Listener or bus failure must not change the decision result (design §5 R5).
    }
}
