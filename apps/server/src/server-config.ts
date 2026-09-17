import { buildConfigFromEnv, getAppOptions, type SpurConfig } from '@gobing-ai/spur-config';
import type { LoggingOptions } from '@gobing-ai/ts-infra/application';

/**
 * Resolved server boot configuration shared by the Bun and Worker composition roots.
 */
export interface ServerBootConfig {
    logging: LoggingOptions;
    telemetry: { enabled: boolean };
    events: {
        enabled: boolean;
        diagnostic: boolean;
        retention?: { default?: number; prefixes?: Record<string, number> };
    };
    jobqueue: { enabled: boolean };
    scheduler: { enabled: boolean };
}

/**
 * Build the portable application configuration from environment bindings plus the
 * `bootstrap.options` runtime-option bag from `.spur/config.yaml` (task 0902).
 *
 * Option keys (all optional, under `bootstrap.options`):
 * - `diagnosticEvents: boolean` — persist diagnostic-tier system events (was `SPUR_DIAGNOSTIC_EVENTS`)
 * - `eventRetentionDefault: number` — default ledger quota (was `SPUR_EVENT_RETENTION_DEFAULT`)
 * - `eventRetentionPrefixes: Record<string, number>` — per-prefix quotas (was `SPUR_EVENT_RETENTION_<NS>`)
 *
 * Log level comes from the config schema's own `logging.level` (gateway env
 * `SPUR_LOG_LEVEL`, zod-validated with default `info`) — not a bootstrap option.
 */
export function serverBootstrapConfig(
    env: Record<string, string | undefined>,
    spurConfig: Pick<SpurConfig, 'bootstrap'> | null | undefined = null,
): ServerBootConfig {
    const isTest = env.NODE_ENV === 'test';
    const retentionDefault = readNonNegativeIntOption(spurConfig, 'eventRetentionDefault');
    const retentionPrefixes = readRetentionPrefixes(spurConfig);

    return {
        logging: { enabled: !isTest, level: buildConfigFromEnv(env).logging.level, console: false },
        telemetry: { enabled: false },
        events: {
            enabled: true,
            diagnostic: readBooleanOption(spurConfig, 'diagnosticEvents', false),
            retention: {
                ...(retentionDefault !== undefined ? { default: retentionDefault } : {}),
                ...(retentionPrefixes !== undefined ? { prefixes: retentionPrefixes } : {}),
            },
        },
        jobqueue: { enabled: !isTest },
        scheduler: { enabled: !isTest },
    };
}

function readBooleanOption(
    spurConfig: Pick<SpurConfig, 'bootstrap'> | null | undefined,
    key: string,
    fallback: boolean,
): boolean {
    const raw = getAppOptions(spurConfig, key, undefined);
    if (raw === undefined) return fallback;
    if (typeof raw === 'boolean') return raw;
    throw new Error(`bootstrap.options.${key} must be a boolean; received ${JSON.stringify(raw)}`);
}

function readNonNegativeIntOption(
    spurConfig: Pick<SpurConfig, 'bootstrap'> | null | undefined,
    key: string,
): number | undefined {
    const raw = getAppOptions(spurConfig, key, undefined);
    if (raw === undefined) return undefined;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
    throw new Error(`bootstrap.options.${key} must be a non-negative integer; received ${JSON.stringify(raw)}`);
}

function readRetentionPrefixes(
    spurConfig: Pick<SpurConfig, 'bootstrap'> | null | undefined,
): Record<string, number> | undefined {
    const raw = getAppOptions<Record<string, unknown> | undefined>(spurConfig, 'eventRetentionPrefixes', undefined);
    if (raw === undefined) return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`bootstrap.options.eventRetentionPrefixes must be an object; received ${JSON.stringify(raw)}`);
    }
    const prefixes: Record<string, number> = {};
    for (const [prefix, quota] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof quota !== 'number' || !Number.isInteger(quota) || quota < 0) {
            throw new Error(
                `bootstrap.options.eventRetentionPrefixes.${prefix} must be a non-negative integer; received ${JSON.stringify(quota)}`,
            );
        }
        prefixes[prefix.toLowerCase()] = quota;
    }
    return prefixes;
}
