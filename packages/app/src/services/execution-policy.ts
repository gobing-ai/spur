import { CHILD_KILL_GRACE_MS, resolveKillGraceMs } from './bounded-child-run';

/**
 * One resolved native execution policy owner (task 0813 R1, feature A21, ADR-112).
 *
 * This module is the single place that translates old Spur inputs (legacy env
 * controls, CLI strings, persisted queue-payload policy) into the native
 * `ts-runtime` options — `timeout: number | null` plus the SIGTERM→SIGKILL
 * termination grace. The released `@gobing-ai/ts-runtime` facade (0.4.59, task
 * 0810) owns the actual deadline, owned process-group containment and
 * escalation; Spur owns only application defaults and compatibility
 * translation. No caller arms a competing watchdog.
 *
 * Value grammar (`timeoutMs?: number | null`, docs/design/execution-deadlines.md):
 * - missing / `undefined` — inherit the parent or application default;
 * - positive finite integer within platform timer range — millisecond deadline;
 * - explicit `null` (CLI/env `none`) — no deadline imposed by this scope;
 * - zero, negative, fractional, NaN, infinity, beyond timer range — rejected
 *   for explicit inputs; legacy env values keep their documented safe fallback.
 *
 * Canonical explicit options (persisted queue-payload policy, CLI flags) beat
 * legacy environment controls; canonical absence falls through to the legacy
 * chain; Spur keeps its ten-minute application default.
 */

/** Explicit (canonical/CLI) deadline in ms, or `null` for explicit unlimited. */
export type TimeoutPolicyMs = number | null;

/**
 * Upper bound of a single `setTimeout` delay on supported platforms. Values
 * beyond it would overflow to an immediate timer — an execution deadline must
 * never collapse into a no-op, so explicit inputs at or beyond this bound are
 * rejected before execution.
 */
export const MAX_TIMEOUT_INPUT_MS = 2_147_483_647;

/**
 * Strict parser for explicit timeout inputs (CLI `--source-timeout`, canonical
 * configuration). Accepts `'none'` (any case, trimmed) as explicit unlimited
 * and a decimal integer string within the platform timer range. Anything else —
 * partial numbers (`'12x'`), signs, zero, negatives, fractions, empty, or
 * timer overflow — is a usage/configuration error, rejected BEFORE any work is
 * launched. Never returns a fallback: explicit malformed input must fail loud.
 */
export function parseTimeoutInput(raw: string): TimeoutPolicyMs {
    const normalized = raw.trim();
    if (normalized.toLowerCase() === 'none') return null;
    if (!/^[0-9]+$/.test(normalized)) {
        throw new Error(`invalid timeout "${raw}": expected a positive integer number of milliseconds or 'none'`);
    }
    const value = Number(normalized);
    if (value === 0 || value > MAX_TIMEOUT_INPUT_MS) {
        throw new Error(`invalid timeout "${raw}": expected a positive integer number of milliseconds or 'none'`);
    }
    return value;
}

/**
 * Normalize one legacy environment value against a fallback. Absent or blank
 * keeps the fallback; `'none'` maps to explicit unlimited (`null`); a valid
 * positive integer passes through; any other invalid value retains the
 * documented safe fallback — a bad legacy override must never disable the
 * deadline by accident (only explicit `none` does that).
 */
export function normalizeLegacyTimeoutMs(raw: string | undefined, fallbackMs: TimeoutPolicyMs): TimeoutPolicyMs {
    if (raw === undefined || raw.trim() === '') return fallbackMs;
    if (raw.trim().toLowerCase() === 'none') return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackMs;
}

/**
 * Validate a canonical (explicit) policy value arriving from trusted structured
 * data — a persisted queue payload field or resolved configuration. `undefined`
 * means absent (legacy chain applies); `null` is explicit unlimited; anything
 * else must be a valid positive integer within timer range, because a malformed
 * canonical value is configuration drift and must fail loudly rather than fall
 * back silently.
 */
export function assertCanonicalTimeoutMs(value: undefined): undefined;
/**
 * Non-undefined overload: validates the canonical value in place and returns a
 * narrowed `TimeoutPolicyMs` (or explicit `null` = unlimited) for callers whose
 * policy field is known to be present.
 */
export function assertCanonicalTimeoutMs(value: unknown): TimeoutPolicyMs;
/**
 * Implementation shared by both overloads; see the overload docs above for the
 * accepted domain (absent / explicit unlimited / positive integer within timer range).
 */
export function assertCanonicalTimeoutMs(value: unknown): TimeoutPolicyMs | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_INPUT_MS) {
        return value;
    }
    throw new Error(
        `invalid canonical timeout ${JSON.stringify(value)}: expected undefined, null, or a positive integer ≤ ${MAX_TIMEOUT_INPUT_MS}`,
    );
}

export { CHILD_KILL_GRACE_MS, resolveKillGraceMs };
