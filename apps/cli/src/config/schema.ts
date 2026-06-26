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

/**
 * Schema for a single named executor profile under `agent.executors`.
 *
 * An executor pairs a canonical coding-agent (`agent`) with an optional opaque
 * `model` override. `name` is the selector key referenced from `agent.default`
 * and `agent.default-by-phase`. `agent`/`model` are validated as non-empty
 * strings here; canonicalization (`resolveAgentName`) and usability checks happen
 * at resolution time in `AgentService`, not at schema-parse time.
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
 * - `default-by-phase` — a `Record<phase, executorSelector>` **map** (not an
 *   array of single-key maps); each value names an executor or a legacy agent.
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

/** Inferred TypeScript type for the `agent` config section. */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
