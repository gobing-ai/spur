import { z } from 'zod';

/** Spur environment variable names consumed by app-layer packages. */
export const SPUR_ENV_VARS = {
    nodeEnv: 'NODE_ENV',
    port: 'PORT',
    publicApiUrl: 'PUBLIC_API_URL',
    databaseUrl: 'DATABASE_URL',
} as const;

/** Logging levels accepted by Spur app configuration. */
export const SPUR_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Zod schema for app-layer configuration that remains local to Spur. */
export const configSchema = z.object({
    database: z
        .object({
            url: z.string().default(':memory:'),
        })
        .default({ url: ':memory:' }),
    server: z
        .object({
            port: z.coerce.number().int().positive().default(3000),
        })
        .default({ port: 3000 }),
    telemetry: z
        .object({
            enabled: z.boolean().default(false),
            endpoint: z.string().optional(),
        })
        .default({ enabled: false }),
    logging: z
        .object({
            level: z.enum(SPUR_LOG_LEVELS).default('info'),
        })
        .default({ level: 'info' }),
});

/** App-layer configuration inferred from the validated config schema. */
export type Config = z.infer<typeof configSchema>;

/** Parse boolean-like environment values without treating "false" as truthy. */
export function parseEnvBoolean(value: string | undefined): boolean | undefined {
    if (value === undefined || value === '') return undefined;

    const normalized = value.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

    throw new Error(`Invalid boolean environment value: expected true/false, received ${value}`);
}

/** Read process-like bindings without coupling config parsing to Node globals. */
export function buildConfigFromEnv(env: Record<string, string | undefined> = process.env): Config {
    return configSchema.parse({
        database: {
            url: env[SPUR_ENV_VARS.databaseUrl],
        },
        server: {
            port: env[SPUR_ENV_VARS.port],
        },
        telemetry: {
            enabled: parseEnvBoolean(env.SPUR_TELEMETRY_ENABLED),
            endpoint: env.SPUR_TELEMETRY_ENDPOINT,
        },
        logging: {
            level: env.SPUR_LOG_LEVEL,
        },
    });
}
