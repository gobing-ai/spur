import type { SystemEventRetentionQuotas } from '@gobing-ai/spur-domain';
import { SYSTEM_EVENT_PREFIXES } from './event-names';

/**
 * Documented per-prefix default retention quota (task 0368 R3). Applied to
 * every catalog prefix that has no explicit override in
 * {@link SystemEventRetentionConfig.prefixes}. This is a fallback, not the
 * only knob — operators override per-prefix via server boot configuration
 * (`ServerBootConfig.events.retention`) or the CLI emitter factory.
 */
export const DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA = 10_000;

/**
 * Operator-facing retention configuration. Lives on
 * `ServerBootConfig.events.retention` (server path) and is passed to the CLI
 * planning emitter factory resolved against defaults.
 */
export interface SystemEventRetentionConfig {
    /** Default quota for any prefix without an explicit override. */
    default?: number;
    /** Per-prefix overrides; keys are prefixes (e.g. `task`, `queue`). */
    prefixes?: Record<string, number>;
}

/**
 * Resolve per-prefix retention quotas by merging {@link SystemEventRetentionConfig}
 * over {@link DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA} for every catalog prefix
 * (task 0368 R3). One quota per known prefix — no prefix is left unbounded, and
 * an override for one prefix never silently changes another.
 *
 * Unknown override keys (prefixes not in the catalog) are ignored: retention
 * scopes to registered events only, so a typo cannot create an unbounded bucket.
 */
export function resolveRetentionQuotas(
    config: SystemEventRetentionConfig = {},
    prefixes: readonly string[] = SYSTEM_EVENT_PREFIXES,
): SystemEventRetentionQuotas {
    const defaultQuota = config.default ?? DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA;
    const overrides = config.prefixes ?? {};
    return prefixes.map((prefix) => ({
        prefix,
        quota: overrides[prefix] ?? defaultQuota,
    }));
}
