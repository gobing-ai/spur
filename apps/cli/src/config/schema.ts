/**
 * Zod schema for the Spur app-specific config section of `.spur/config.yaml`.
 *
 * The YAML file has two top-level concerns:
 * - **`bootstrap:`** — portable block consumed by `@gobing-ai/ts-infra` `runNodeApplication`.
 * - **Everything else** — the Spur app section validated here.
 *
 * Keys are preserved verbatim from the pre-existing `.spur/config.yaml` to avoid drift (R3).
 */
import { z } from 'zod';

/** Schema for the `agent` section. */
export const AgentConfigSchema = z.object({
    default: z.string().optional(),
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

/**
 * Full Spur app config schema (the non-bootstrap section of `.spur/config.yaml`).
 *
 * All fields are optional — a missing key means "use the default" rather than "error".
 * This allows partial config files and forward-compatible additions.
 */
export const SpurAppConfigSchema = z.object({
    version: z.string().optional(),
    name: z.string().optional(),
    agent: AgentConfigSchema.optional(),
    rules: RulesConfigSchema.optional(),
    workflows: WorkflowsConfigSchema.optional(),
    redaction: RedactionConfigSchema.optional(),
});

/** Inferred TypeScript type for the Spur app config section. */
export type SpurAppConfig = z.infer<typeof SpurAppConfigSchema>;
