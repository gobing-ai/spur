/**
 * Closed operational trip-wire catalog and deterministic evaluator (task 0708).
 *
 * Spur already produces the relevant reliability signals in separate owners —
 * steering retry counters, hard-budget evaluation (0707), capability
 * attestation (0706), proof-input fingerprint comparisons (0612/0711), and the
 * bounded output relay's drop telemetry. What was missing is one shared,
 * table-driven decision that maps those existing signals to a mandatory stop
 * at the workflow safe boundaries where they are observed. This module is that
 * composition layer, deliberately nothing more:
 *
 * - The catalog is closed and versioned. A signal whose policy id is not in
 *   the catalog is itself a fail-closed decision (R1/R6).
 * - Evaluation is pure and deterministic: first matching signal in the given
 *   order wins, no model call, no free-form policy DSL (R6).
 * - Thresholds come from the signal's owner (retry policy, declared budget,
 *   attestation result, fingerprint pair, relay bounds). No duplicate knobs
 *   are defined here (R5/Q&A).
 * - `output-drop` maps to `continue`: the bounded relay's dropped-chunk
 *   telemetry is evidence degradation for an otherwise completed dispatch,
 *   and failing healthy long-output runs would contradict the "healthy
 *   result is unchanged" acceptance scenario. It is still recorded as a
 *   fired trip wire so operators see the degraded evidence.
 */

/** Closed set of trip-wire policy ids (R1). Order defines evaluation precedence. */
export const TRIPWIRE_POLICY_IDS = [
    'retry-exhausted',
    'hard-budget',
    'capability-denied',
    'proof-invalidated',
    'output-drop',
] as const;

/** Closed catalog of operational trip-wire policy ids (R1/R8). */
export type TripWirePolicyId = (typeof TRIPWIRE_POLICY_IDS)[number];

/** What the workflow does when this policy fires (table-driven, R6). */
export type TripWireResponse = 'fail' | 'continue';

/** One row of the closed trip-wire policy table (R1/R6): id, version, response, exact next decision. */
export interface TripWirePolicy {
    readonly id: TripWirePolicyId;
    readonly version: number;
    readonly response: TripWireResponse;
    /** The exact next decision an operator must make (R7). */
    readonly nextDecision: string;
}

/**
 * The fixed catalog. `version` is per-policy so adding a policy never
 * rewrites another policy's history.
 */
export const TRIPWIRE_CATALOG: Readonly<Record<TripWirePolicyId, TripWirePolicy>> = Object.freeze({
    'retry-exhausted': {
        id: 'retry-exhausted',
        version: 1,
        response: 'fail',
        nextDecision:
            'Retries are exhausted; an operator must decide to escalate, extend the retry policy, or fail the stage. No further automatic retry is permitted.',
    },
    'hard-budget': {
        id: 'hard-budget',
        version: 1,
        response: 'fail',
        nextDecision:
            'An operator must raise the declared budget or trim the stage scope, then re-run the action; the run stays failed until then.',
    },
    'capability-denied': {
        id: 'capability-denied',
        version: 1,
        response: 'fail',
        nextDecision:
            'An operator must attest the executor capabilities in agent config or lower the stage requiresCapabilities, then re-run the action.',
    },
    'proof-invalidated': {
        id: 'proof-invalidated',
        version: 1,
        response: 'fail',
        nextDecision:
            'An operator must restore the proof inputs or re-establish the verdict (re-verify) before record; recording against a changed tree is blocked.',
    },
    'output-drop': {
        id: 'output-drop',
        version: 1,
        response: 'continue',
        nextDecision:
            'The dispatch completed but its captured evidence is incomplete (bounded relay dropped chunks). Inspect the session/trace for full output if the result is contested.',
    },
});

/** One already-normalized signal produced by an existing owner (R5). */
export interface TripWireSignal {
    readonly policy: TripWirePolicyId;
    /** What was observed, bounded and redacted by the emitting boundary. */
    readonly observed: string;
    /** The threshold that was crossed, expressed in the owner's terms. */
    readonly threshold?: string;
    /** Where the evidence lives (artifact path, event id, digest pair, …). */
    readonly evidenceRef?: string;
}

/** Deterministic decision returned by {@link evaluateTripWires}. */
export interface TripWireDecision {
    readonly fired: boolean;
    readonly policy?: TripWirePolicy;
    /** Bounded human-readable reason naming what crossed the line. */
    readonly reason?: string;
    readonly observed?: string;
    readonly threshold?: string;
    readonly evidenceRef?: string;
    /** Populated when evaluation itself fails closed (unknown policy id). */
    readonly evaluationError?: string;
}

/** Bound for evaluator-produced strings; the emitting boundary redacts first. */
const MAX_FIELD_CHARS = 512;

const bound = (value: string): string =>
    value.length <= MAX_FIELD_CHARS ? value : `${value.slice(0, MAX_FIELD_CHARS)}…`;

/**
 * Evaluate the given signals against the closed catalog. Deterministic:
 * the first signal (in argument order) that maps to a catalog policy wins;
 * a signal carrying an unknown policy id yields a fail-closed decision
 * naming the unknown id, so a drifted emitter can never silently pass (R8).
 */
export function evaluateTripWires(signals: readonly TripWireSignal[]): TripWireDecision {
    for (const signal of signals) {
        const policy = (TRIPWIRE_CATALOG as Record<string, TripWirePolicy | undefined>)[signal.policy];
        if (policy === undefined) {
            return {
                fired: true,
                reason: `unknown trip-wire policy id '${signal.policy}' — evaluation fails closed`,
                observed: bound(signal.observed),
                evaluationError: 'unknown-policy',
            };
        }
        return {
            fired: true,
            policy,
            reason: `trip wire '${policy.id}' fired (v${policy.version}): ${signal.observed}`,
            observed: bound(signal.observed),
            ...(signal.threshold !== undefined ? { threshold: bound(signal.threshold) } : {}),
            ...(signal.evidenceRef !== undefined ? { evidenceRef: bound(signal.evidenceRef) } : {}),
        };
    }
    return { fired: false };
}

/** Stable prefix shared by the attestation denial diagnostic and its trip-wire marker. */
export const CAPABILITY_BLOCK_PREFIX = 'agent dispatch blocked by capability attestation';
