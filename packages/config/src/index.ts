import { z } from 'zod';

export {
    bundledConfigRoot,
    listBundledConfigFiles,
    listBundledTemplateFiles,
    resetBundledConfigCache,
} from './bundled-config';
export { renderTemplate } from './template-renderer';

/** Spur environment variable names consumed by app-layer packages. */
export const SPUR_ENV_VARS = {
    nodeEnv: 'NODE_ENV',
    port: 'PORT',
    publicApiUrl: 'PUBLIC_API_URL',
    databaseUrl: 'DATABASE_URL',
} as const;

/** Logging levels accepted by Spur app configuration. */
export const SPUR_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/** Zod schema for a single task-folder entry: base counter + optional label. */
export const folderConfigSchema = z.object({
    baseCounter: z.number().int().nonnegative().default(0),
    label: z.string().optional(),
});

/** Inferred type for {@link folderConfigSchema}. */
export type FolderConfig = z.infer<typeof folderConfigSchema>;
// ---- Tasks config ----

/**
 * Zod schema for the `tasks:` config block (design §9).
 *
 * ```yaml
 * tasks:
 *   folders:
 *     docs/tasks: { baseCounter: 0, label: Core }
 *   active: docs/tasks
 * ```
 *
 * `folders` is a map of folder path → {@link folderConfigSchema} (absorbs the
 * legacy `docs/.tasks/config.json` folders + base_counter); `active` is the
 * default folder for `create`.
 */
export const tasksConfigSchema = z.object({
    folders: z.record(z.string(), folderConfigSchema).default({}),
    active: z.string().default('docs/tasks'),
});

/** Inferred type for {@link tasksConfigSchema}. */
export type TasksConfig = z.infer<typeof tasksConfigSchema>;
// ---- Features config ----

/** Zod schema for the `features:` config block (design §9). */
export const featuresConfigSchema = z.object({
    dir: z.string().default('docs/features'),
});

/** Inferred type for {@link featuresConfigSchema}. */
export type FeaturesConfig = z.infer<typeof featuresConfigSchema>;

// ---- Spur project config (top-level) ----

/** Zod schema for the top-level Spur project config. */
export const spurConfigSchema = z.object({
    tasks: tasksConfigSchema.optional(),
    features: featuresConfigSchema.optional(),
});

/** Inferred type for {@link spurConfigSchema}. */
export type SpurConfig = z.infer<typeof spurConfigSchema>;

// ---- App-layer config (existing) ----

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
