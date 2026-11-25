import { buildConfigFromEnv, getAppOptions, SPUR_ENV_VARS, type SpurConfig } from '@gobing-ai/spur-config';
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
    /**
     * A2A listener switch (feature G9, task 1336): off unless `SPUR_A2A_ENABLED` is set, and the
     * token variable's NAME (`SPUR_A2A_AUTH_ENV`) rather than its value — the module resolves the
     * value through the env funnel at mount and never stores it.
     */
    a2a?: { enabled: boolean; authEnv: string | null; allowUnauthenticated?: boolean };
    /**
     * Embedded MCP 2.0+ server switch (feature B9, task 1370): same contract as `a2a` — off unless
     * `SPUR_MCP_ENABLED` is set, and the token variable's NAME (`SPUR_MCP_AUTH_ENV`), never its value.
     */
    mcp?: {
        enabled: boolean;
        authEnv: string | null;
        allowUnauthenticated?: boolean;
        namespace?: string | null;
    };
    /**
     * Configured gateway listener port (`server.gateway.port` / `SPUR_GATEWAY_PORT`), whether an
     * operator actually configured it (1449 R1). The gateway root `/mcp` has no switch of its own:
     * `mcp` above drives it (K44 1450).
     * `port` alone cannot tell "configured 3000" from "unset", because the schema defaults it, so
     * `explicit` is what lets a caller prefer a loopback `x-forwarded-host` port over the default.
     */
    gateway?: {
        port: number;
        explicit?: boolean;
    };
    /**
     * Why the merged project config could not be loaded at startup, in the loader's own words
     * (1449 R1). Absent on a clean load; present means every surface reports its env-only default.
     */
    configDiagnostic?: string;
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
    spurConfig: Pick<SpurConfig, 'bootstrap' | 'server'> | null | undefined = null,
): ServerBootConfig {
    const isTest = env.NODE_ENV === 'test';
    const retentionDefault = readNonNegativeIntOption(spurConfig, 'eventRetentionDefault');
    const retentionPrefixes = readRetentionPrefixes(spurConfig);
    const appConfig = buildConfigFromEnv(env, spurConfig);

    return {
        logging: { enabled: !isTest, level: appConfig.logging.level, console: false },
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
        a2a: {
            enabled: appConfig.server.a2a.enabled,
            authEnv: appConfig.server.a2a.authEnv ?? null,
            allowUnauthenticated: appConfig.server.a2a.allowUnauthenticated,
        },
        mcp: {
            enabled: appConfig.server.mcp.enabled,
            authEnv: appConfig.server.mcp.authEnv ?? null,
            allowUnauthenticated: appConfig.server.mcp.allowUnauthenticated,
            namespace: appConfig.server.mcp.namespace ?? null,
        },
        gateway: {
            port: appConfig.server.gateway.port,
            explicit: env[SPUR_ENV_VARS.gatewayPort] !== undefined || spurConfig?.server?.gateway?.port !== undefined,
        },
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
