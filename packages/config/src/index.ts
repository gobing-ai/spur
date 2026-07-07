import { z } from 'zod';

// NOTE: this is the CF-safe CORE entry of @gobing-ai/spur-config.
// It has ZERO runtime deps beyond zod — no `yaml`, no `node:fs`, no `node:path`.
// Node-only concerns (bundled-config, template-renderer, the loader, folder resolution,
// embedded-schema resolution) live in the `./loader` subpath. The Cloudflare Workers
// bundle imports ONLY this core (ADR-027).

/** Spur environment variable names consumed by app-layer packages. */
export const SPUR_ENV_VARS = {
    nodeEnv: 'NODE_ENV',
    port: 'PORT',
    host: 'HOST',
    publicApiUrl: 'PUBLIC_API_URL',
    databaseUrl: 'DATABASE_URL',
} as const;

/** Logging levels accepted by Spur app configuration. */
export const SPUR_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * Canonical default task folder — the SINGLE source of truth for this literal.
 * Every other surface derives from `.spur/config.yaml` or falls back to this constant.
 * Duplicated only as an explicit CF-safe literal (see planning-folder-hardcode rule).
 */
export const DEFAULT_TASKS_DIR = 'docs/tasks';

/**
 * Canonical default feature folder — the SINGLE source of truth for this literal.
 * Every other surface derives from `.spur/config.yaml` or falls back to this constant.
 * Duplicated only as an explicit CF-safe literal (see planning-folder-hardcode rule).
 */
export const DEFAULT_FEATURES_DIR = 'docs/features';

/** Canonical default SQLite database path for local Spur projects. */
export const DEFAULT_DATABASE_URL = '.spur/spur.db';

/** Explicit in-memory SQLite URL. Intended for tests and caller-injected ephemeral runs only. */
export const IN_MEMORY_DATABASE_URL = ':memory:';

// ---- Shared config sub-schemas ----

/** Zod schema for a single task-folder entry: base counter + optional label. */
export const folderConfigSchema = z.object({
    baseCounter: z.number().int().nonnegative().default(0),
    label: z.string().optional(),
});

/** Inferred type for {@link folderConfigSchema}. */
export type FolderConfig = z.infer<typeof folderConfigSchema>;

/**
 * A required-with-default folder path that tolerates an explicit YAML `null`.
 * An empty YAML key (`active:` with no value) parses to `null`; treat that the same
 * as a missing key — "use the default" — rather than a type error. Without this, a
 * blank `active:`/`dir:` line would throw a ZodError and wedge config loading; the
 * contract is that a malformed/blank folder value degrades to the canonical default.
 */
function folderPathWithDefault(defaultPath: string) {
    return z.preprocess((v) => (v == null ? undefined : v), z.string().default(defaultPath));
}

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
    active: folderPathWithDefault(DEFAULT_TASKS_DIR),
});

/** Inferred type for {@link tasksConfigSchema}. */
export type TasksConfig = z.infer<typeof tasksConfigSchema>;

// ---- Features config ----

/** Zod schema for the `features:` config block (design §9). */
export const featuresConfigSchema = z.object({
    dir: folderPathWithDefault(DEFAULT_FEATURES_DIR),
});

/** Inferred type for {@link featuresConfigSchema}. */
export type FeaturesConfig = z.infer<typeof featuresConfigSchema>;

// ---- Agent config (app section) ----

/**
 * Schema for a single named executor profile under `agent.executors`.
 *
 * An executor pairs a canonical coding-agent (`agent`) with an optional opaque
 * `model` override. `name` is the selector key referenced from `agent.default`
 * and `agent.default-by-phase`. `agent`/`model` are validated as non-empty
 * strings here; canonicalization and usability checks happen at resolution time.
 */
export const AgentExecutorConfigSchema = z.object({
    name: z.string().min(1),
    agent: z.string().min(1),
    model: z.string().min(1).optional(),
});

/** A single executor profile entry. */
export type AgentExecutorConfig = z.infer<typeof AgentExecutorConfigSchema>;

/**
 * Schema for the `agent` section.
 *
 * - `default` — executor selector first, legacy direct agent name second.
 * - `executors` — named `{ name, agent, model? }` profiles; names must be unique.
 * - `default-by-phase` — a `Record<phase, executorSelector>` **map**.
 */
export const AgentConfigSchema = z
    .object({
        default: z.string().optional(),
        executors: z.array(AgentExecutorConfigSchema).optional(),
        'default-by-phase': z.record(z.string(), z.string()).optional(),
    })
    .superRefine((value, ctx) => {
        const executors = value.executors;
        if (executors === undefined) return;
        const seen = new Set<string>();
        for (const [index, executor] of executors.entries()) {
            if (seen.has(executor.name)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Duplicate executor name: ${executor.name}`,
                    path: ['executors', index, 'name'],
                });
            }
            seen.add(executor.name);
        }
    });

/** Schema for the `rules` section. */
export const RulesConfigSchema = z.object({
    paths: z.array(z.string()).optional(),
});

/** Schema for the `workflows` section. */
export const WorkflowsConfigSchema = z.object({
    paths: z.array(z.string()).optional(),
});

/** Schema for the `redaction` section. */
export const RedactionConfigSchema = z.object({
    enabled: z.boolean().optional(),
});

// ---- Unified Spur project config (top-level) ----

/**
 * Zod schema for the top-level `.spur/config.yaml` — the single project configuration
 * surface (design §9). Merges BOTH the planning section (`tasks`/`features`) and the
 * app section (`agent`/`rules`/`workflows`/`redaction`) into one validated shape.
 *
 * All fields are optional — a missing key means "use the default" rather than "error",
 * preserving partial-config tolerance and forward-compatible additions. YAML keys are
 * preserved verbatim (R3 — no drift from the existing `.spur/config.yaml`).
 */
export const spurConfigSchema = z.object({
    version: z.string().optional(),
    name: z.string().optional(),
    agent: AgentConfigSchema.optional(),
    rules: RulesConfigSchema.optional(),
    workflows: WorkflowsConfigSchema.optional(),
    redaction: RedactionConfigSchema.optional(),
    tasks: tasksConfigSchema.optional(),
    features: featuresConfigSchema.optional(),
});

/** Inferred type for the unified {@link spurConfigSchema}. */
export type SpurConfig = z.infer<typeof spurConfigSchema>;

/** Inferred type for the `agent` config section. */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Back-compat type for the app-layer (non-planning) section of the config.
 * Kept so existing consumers that operate on `SpurAppConfig` continue to type-check.
 */
export type SpurAppConfig = Pick<SpurConfig, 'version' | 'name' | 'agent' | 'rules' | 'workflows' | 'redaction'>;

// ---- App-layer (runtime) config ----

/** Zod schema for app-layer runtime configuration that remains local to Spur. */
export const configSchema = z.object({
    database: z
        .object({
            url: z.string().default(DEFAULT_DATABASE_URL),
        })
        .default({ url: DEFAULT_DATABASE_URL }),
    server: z
        .object({
            port: z.coerce.number().int().positive().default(3000),
            host: z.string().default('localhost'),
            openBrowser: z.boolean().default(true),
            webDistPath: z.string().nullable().default(null),
        })
        .default({ port: 3000, host: 'localhost', openBrowser: true, webDistPath: null }),
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
            host: env[SPUR_ENV_VARS.host],
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
