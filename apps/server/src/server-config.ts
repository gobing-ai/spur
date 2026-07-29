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
    teamAutostart: string[];
}

/**
 * Build the portable application configuration from environment bindings.
 */
export function serverBootstrapConfig(env: Record<string, string | undefined>): ServerBootConfig {
    const isTest = env.NODE_ENV === 'test';
    const raw = env.SPUR_TEAM_AUTOSTART;
    const teamAutostart = raw
        ? raw
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
        : [];
    const diagnosticEvents = env.SPUR_DIAGNOSTIC_EVENTS === '1' || env.SPUR_DIAGNOSTIC_EVENTS === 'true';
    const retentionDefault = parseRetentionNumber(env.SPUR_EVENT_RETENTION_DEFAULT);
    const retentionPrefixes = parseRetentionPrefixes(env);

    return {
        logging: { enabled: !isTest, level: (env.SPUR_LOG_LEVEL as LoggingOptions['level']) ?? 'info', console: false },
        telemetry: { enabled: false },
        events: {
            enabled: true,
            diagnostic: diagnosticEvents,
            retention: {
                ...(retentionDefault !== undefined ? { default: retentionDefault } : {}),
                ...(Object.keys(retentionPrefixes).length > 0 ? { prefixes: retentionPrefixes } : {}),
            },
        },
        jobqueue: { enabled: !isTest },
        scheduler: { enabled: !isTest },
        teamAutostart,
    };
}

function parseRetentionNumber(raw: string | undefined): number | undefined {
    if (raw === undefined || raw.trim() === '') return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return undefined;
    return value;
}

function parseRetentionPrefixes(env: Record<string, string | undefined>): Record<string, number> {
    const prefixes: Record<string, number> = {};
    for (const [key, value] of Object.entries(env)) {
        const match = /^SPUR_EVENT_RETENTION_(.+)$/.exec(key);
        if (!match || match[1] === 'DEFAULT') continue;
        const prefix = match[1];
        if (!prefix) continue;
        const quota = parseRetentionNumber(value);
        if (quota !== undefined) prefixes[prefix.toLowerCase()] = quota;
    }
    return prefixes;
}
