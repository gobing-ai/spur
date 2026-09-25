import { type DecisionMaker, DecisionTimeoutError } from '@gobing-ai/ts-ai-runner';
import { redactAndBound } from '../observability/agent-execution';
import { evidencePayloadDigest } from './decision-evidence';
import { defaultDecisionMaker } from './decision-hitl-responder';

/**
 * Non-pausing `decide` action core (task 0941, ADR-125). Pure decision logic shared by the
 * workflow runner (`actions/decide.ts`) and the inline driver (`--decide`); both write the
 * same resultFile row and trace boundary around this function.
 *
 * Contract (0941 R3): never pauses, never throws for model problems. Every degraded branch
 * resolves to `value = default` with `degraded: true` and a closed-vocabulary reason, so the
 * run always continues. Only an invalid options schema fails the action, and that check lives
 * in the runner's zod schema, not here.
 */

/** v1 decision methods. `ask`/`score` are deferred until a candidate needs them (0941 Q&A). */
export type DecideMethod = 'choice' | 'noul';

/** Closed degraded-reason vocabulary (0941 R3, frozen). */
export type DecideDegradedReason = 'disabled' | 'no-backend' | 'error' | 'timeout' | 'low-confidence';

/** `minConfidence` when the options omit it (0941 R1). */
export const DEFAULT_MIN_CONFIDENCE = 0.8;

/**
 * `noul` returns a bare yes-probability (no `confidence` field — the wire never fabricates
 * calibration data). The probability is the only honest gate number, so it doubles as the
 * `minConfidence` input and the recorded `confidence`; `>= 0.5` maps to the `yes` label.
 */
export const NOUL_YES_THRESHOLD = 0.5;

/** Per-evidence-file redaction/bound limit; matches the responder's default text bound. */
export const DECIDE_EVIDENCE_MAX_CHARS = 2000;

/** Validated decide options (0941 R1). Structural validity is enforced by `DecideOptionsSchema`. */
export interface DecideOptions {
    id: string;
    method: DecideMethod;
    question: string;
    /** Required for `choice` (>= 2 labels); `noul` uses the engine yes/no outcomes. */
    choices?: string[];
    /** Evidence file paths; each is read, then redacted and bounded before leaving the process. */
    evidence?: string[];
    /** Degraded-row value; the runner schema pins it to `choices` (choice) / yes|no (noul). */
    default: string;
    minConfidence?: number;
    resultFile: string;
}

/** resultFile JSON row (0941 R2, schemaVersion 1, frozen shape). */
export interface DecideResult {
    schemaVersion: 1;
    id: string;
    value: string;
    method: DecideMethod;
    backend: string | null;
    confidence: number | null;
    degraded: boolean;
    reason: 'accepted' | DecideDegradedReason;
    evidenceDigest: string | null;
    durationMs: number;
}

/**
 * Core dependencies (frozen shape, 0941 Design): a fake maker makes every branch testable
 * without network or real time. `readFile`/`now` keep the core free of runtime imports.
 * `secrets` are deliberately not threaded — evidence is redacted with the built-in
 * SECRET_PATTERN via `redactAndBound(text, [], …)`.
 */
export interface DecideDeps {
    enabled: boolean;
    decisionMaker?: () => Promise<DecisionMaker>;
    readFile: (path: string) => Promise<string>;
    now: () => number;
}

/** Run one decide decision. Never throws for model problems (0941 R3). */
export async function runDecide(options: DecideOptions, deps: DecideDeps): Promise<DecideResult> {
    const started = deps.now();
    const base = { schemaVersion: 1 as const, id: options.id, method: options.method };
    const degraded = (
        reason: DecideDegradedReason,
        backend: string | null = null,
        confidence: number | null = null,
        evidenceDigest: string | null = null,
    ): DecideResult => ({
        ...base,
        value: options.default,
        backend,
        confidence,
        degraded: true,
        reason,
        evidenceDigest,
        durationMs: deps.now() - started,
    });

    // Feature switch off (0941 R4): the traditional path — no evidence reads, no provider.
    if (!deps.enabled) return degraded('disabled');

    let maker: DecisionMaker;
    try {
        maker = deps.decisionMaker ? await deps.decisionMaker() : await defaultDecisionMaker();
    } catch {
        return degraded('no-backend');
    }

    // Evidence is redacted and bounded BEFORE anything leaves the process (0941 invariant).
    // A missing/unreadable declared evidence file degrades instead of asking the model to
    // guess: the declared fact is absent, so any answer would fabricate certainty.
    let evidence: string[] = [];
    let evidenceDigest: string | null = null;
    if (options.evidence !== undefined && options.evidence.length > 0) {
        try {
            evidence = await Promise.all(
                options.evidence.map(async (path) =>
                    redactAndBound(await deps.readFile(path), [], DECIDE_EVIDENCE_MAX_CHARS),
                ),
            );
            evidenceDigest = evidencePayloadDigest(evidence);
        } catch {
            return degraded('error');
        }
    }

    const state = { id: options.id, evidence };
    const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    try {
        if (options.method === 'choice') {
            const labels: Record<string, string> = Object.fromEntries((options.choices ?? []).map((c) => [c, c]));
            const answer = await maker.choice(state, options.question, labels);
            if (!(answer.label in labels)) {
                // Out-of-vocabulary label: the backend ignored the declared choice set.
                return degraded('error', maker.driver, answer.confidence, evidenceDigest);
            }
            if (answer.confidence < minConfidence) {
                return degraded('low-confidence', maker.driver, answer.confidence, evidenceDigest);
            }
            return {
                ...base,
                value: answer.label,
                backend: maker.driver,
                confidence: answer.confidence,
                degraded: false,
                reason: 'accepted',
                evidenceDigest,
                durationMs: deps.now() - started,
            };
        }
        const answer = await maker.noul(state, options.question);
        const confidence = answer.probability;
        if (confidence < minConfidence) {
            return degraded('low-confidence', maker.driver, confidence, evidenceDigest);
        }
        return {
            ...base,
            value: confidence >= NOUL_YES_THRESHOLD ? 'yes' : 'no',
            backend: maker.driver,
            confidence,
            degraded: false,
            reason: 'accepted',
            evidenceDigest,
            durationMs: deps.now() - started,
        };
    } catch (error) {
        // The 15s timeout lives in the default maker factory (`timeoutMs: 15000`); its
        // rejection is the named DecisionTimeoutError, classified here — no second timer.
        return degraded(
            error instanceof DecisionTimeoutError ? 'timeout' : 'error',
            maker.driver,
            null,
            evidenceDigest,
        );
    }
}
