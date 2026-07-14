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

// ---- Team config (feature M) ----

/**
 * Agent-id format mirrored from `@gobing-ai/ts-ai-runner` `validateAgentId`
 * (`agent-spec.ts`: `^[a-z][a-z0-9_-]{1,63}$`). Mirrored — not imported — to keep this
 * CF-safe core free of a ts-ai-runner dependency (ADR-027). Keep in sync if the
 * runner's id format ever changes.
 */
const AGENT_ID_REGEX = /^[a-z][a-z0-9_-]{1,63}$/;

/**
 * Schema for a single team member reference under `agent.team.<id>.members`.
 *
 * A bare string (`- claude`) is shorthand for `{ executor: "claude" }`, normalized by
 * {@link normalizeMember}. The object form carries per-member overrides.
 */
export const TeamMemberConfigSchema = z.union([
    z.string().min(1),
    z.object({
        executor: z.string().min(1),
        id: z.string().min(1).optional(),
        purpose: z.string().optional(),
        workspace: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        autonomy: z.string().optional(),
        systemPrompt: z.string().optional(),
        command: z.array(z.string().min(1)).optional(),
        autostart: z.boolean().optional(),
    }),
]);

/** Inferred type for {@link TeamMemberConfigSchema}. */
export type TeamMemberConfig = z.infer<typeof TeamMemberConfigSchema>;

/**
 * Schema for one team under `agent.team.<teamId>`.
 *
 * `name` is the human label; `work_dir` is the default member workspace (tilde-expanded
 * at load); `members` is the roster (≥ 1). Member-id uniqueness and the composed-id
 * `<teamId>-<localId>` charset/length are validated in {@link AgentConfigSchema}'s
 * `superRefine` — the composed id needs the `teamId` map key (finalized by 0251).
 */
export const TeamConfigSchema = z.object({
    name: z.string().min(1),
    work_dir: z.string().min(1),
    autostart: z.boolean().optional(),
    members: z.array(TeamMemberConfigSchema).min(1),
});

/** Inferred type for {@link TeamConfigSchema}. */
export type TeamConfig = z.infer<typeof TeamConfigSchema>;

/** A team member in its normalized object form (shorthand string expanded). */
export interface NormalizedTeamMember {
    executor: string;
    id?: string;
    purpose?: string;
    workspace?: string;
    model?: string;
    autonomy?: string;
    systemPrompt?: string;
    command?: string[];
    autostart?: boolean;
}

/**
 * Normalize a team member reference to its object form. A bare string `"claude"`
 * becomes `{ executor: "claude" }`; an object is returned as a shallow copy. The
 * local id is `member.id ?? executor` (0251).
 */
export function normalizeMember(member: TeamMemberConfig): NormalizedTeamMember {
    return typeof member === 'string' ? { executor: member } : { ...member };
}

/** A resolved executor: a canonical agent plus an optional model override. */
export interface ResolvedExecutor {
    agent: string;
    model?: string;
}

/** Options for {@link resolveExecutor}. */
export interface ResolveExecutorOptions {
    /**
     * Predicate recognizing a raw canonical agent type (e.g. `claude`, `codex`).
     * Injected rather than hardcoded: the Spur monorepo deliberately keeps a single
     * canonical-agent list in `@gobing-ai/ts-ai-runner` and consumes it from there, so
     * the CF-safe config core stays free of any duplicate list.
     *
     * When omitted, any non-empty name is accepted as a raw agent and no "unknown
     * reference" error is raised — canonical validation is the caller's job (the
     * materialization layer in 0258 injects `isAgentName` from ts-ai-runner). Inject
     * the predicate to fail unknown references at the config boundary.
     */
    isCanonicalAgent?: (name: string) => boolean;
}

/**
 * Resolve a member's `executor` to `{ agent, model? }` (0250 R5).
 *
 * Executors-first: a name matching `agent.executors[].name` returns that entry's
 * `{ agent, model? }`. Otherwise the name is treated as a raw canonical agent type and
 * returned as `{ agent: name }` (model omitted). When `isCanonicalAgent` is provided
 * and returns `false` for an unmatched name, this throws — the name is neither a
 * configured executor nor a known agent.
 */
export function resolveExecutor(
    name: string,
    agentConfig: AgentConfig | undefined,
    opts?: ResolveExecutorOptions,
): ResolvedExecutor {
    const exec = agentConfig?.executors?.find((entry) => entry.name === name);
    if (exec !== undefined) return { agent: exec.agent, model: exec.model };
    if (opts?.isCanonicalAgent === undefined || opts.isCanonicalAgent(name)) {
        return { agent: name };
    }
    throw new Error(`Unknown executor or agent reference: "${name}"`);
}

/**
 * Schema for the `agent` section.
 *
 * - `default` — executor selector first, legacy direct agent name second.
 * - `executors` — named `{ name, agent, model? }` profiles; names must be unique.
 * - `default-by-phase` — a `Record<phase, executorSelector>` **map**.
 * - `team` — a `Record<teamId, TeamConfig>` map of declarative agent teams (feature M).
 */
export const AgentConfigSchema = z
    .object({
        default: z.string().optional(),
        executors: z.array(AgentExecutorConfigSchema).optional(),
        'default-by-phase': z.record(z.string(), z.string()).optional(),
        team: z.record(z.string(), TeamConfigSchema).optional(),
    })
    .superRefine((value, ctx) => {
        const executors = value.executors;
        if (executors !== undefined) {
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
        }

        // Team validation (feature M). The composed agent id `<teamId>-<localId>`
        // (finalized by 0251 — always prefixed) needs the `teamId` map key, so the
        // dup-localId + composed-id charset/length checks live here on the agent
        // schema rather than on TeamConfigSchema (which has no access to the key).
        const team = value.team;
        if (team === undefined) return;
        for (const [teamId, teamConfig] of Object.entries(team)) {
            const seenLocal = new Set<string>();
            teamConfig.members.forEach((member, index) => {
                const ref = normalizeMember(member);
                const localId = ref.id ?? ref.executor;
                if (seenLocal.has(localId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Duplicate team member id: ${localId} in team "${teamId}"`,
                        path: ['team', teamId, 'members', index],
                    });
                }
                seenLocal.add(localId);
                const composedId = `${teamId}-${localId}`;
                if (!AGENT_ID_REGEX.test(composedId)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: `Invalid composed agent id "${composedId}": team key "${teamId}" + member "${localId}" must match ^[a-z][a-z0-9_-]{1,63}$ (2-64 chars, lowercase).`,
                        path: ['team', teamId, 'members', index],
                    });
                }
            });
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
