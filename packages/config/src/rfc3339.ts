/**
 * RFC 3339 timestamp check shared by the zod `disabled.since` refine (B6 0890)
 * and the executor updater's argument validation. One spelling per concept:
 * both surfaces must accept exactly the same timestamp shape.
 */

/** RFC 3339 date-time: `YYYY-MM-DDTHH:MM:SS[.frac](Z|±HH:MM)`. */
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** True when `value` is shaped like (and parses as) an RFC 3339 timestamp. */
export function isRfc3339Timestamp(value: string): boolean {
    return RFC3339_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}
