/**
 * Behavioral eval judge (task 0215, R2).
 *
 * A deterministic keyword judge: given a transcript and a scenario's expectation, decide whether the
 * expected discipline fired. This is the first-slice judge — the paid tier may swap in an LLM-judge,
 * but the keyword judge keeps the free/deterministic tier fast and reproducible. Pure and side-effect
 * free so it is unit-testable against recorded fixtures.
 */

import type { EvalExpectation } from './scenarios';

export interface JudgeResult {
    /** The discipline fired: at least one required marker present and no forbidden marker present. */
    passed: boolean;
    /** Which required markers were found. */
    fired: string[];
    /** Which forbidden markers were found (each is a discipline violation). */
    violated: string[];
}

/** Judge a transcript against a scenario's expectation. */
export function judgeTranscript(transcript: string, expectation: EvalExpectation): JudgeResult {
    const haystack = transcript.toLowerCase();
    const fired = expectation.requiredAny.filter((marker) => haystack.includes(marker.toLowerCase()));
    const violated = expectation.forbidden.filter((marker) => haystack.includes(marker.toLowerCase()));
    return { passed: fired.length > 0 && violated.length === 0, fired, violated };
}
