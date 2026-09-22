import { oc } from '@orpc/contract';
import { z } from 'zod';

// ─── Fleet snapshot (GET /project/fleet) + supervised process list (GET /processes) ───
// CONTRACT ONLY — both routes are served by raw Hono modules (server modules
// `health` and `processes`); these entries document their wire shapes so the
// generated OpenAPI covers them. Same pattern as the planning-event SSE stream.

/**
 * A fleet member's agent session (G66 / task 0897). `id` is the resume id and
 * is only present in `resume` mode — a `persistent` member's session IS its
 * live process, and `one-shot` has no continuity at all.
 */
export const memberSessionSchema = z.object({
    mode: z.enum(['persistent', 'resume', 'one-shot']),
    id: z.string().optional(),
});

/** Member session DTO inferred from the public schema. */
export type MemberSession = z.infer<typeof memberSessionSchema>;

/** One fleet member row in the project fleet snapshot. */
export const fleetMemberSchema = z.object({
    instanceId: z.string(),
    role: z.string().optional(),
    executor: z.string(),
    model: z.string().optional(),
    enabled: z.boolean(),
    writeCapable: z.boolean(),
    capabilityState: z.string(),
    session: memberSessionSchema.optional(),
});

/** Project fleet snapshot (the wire shape of GET /project/fleet, 0840 + 0897). */
export const fleetSnapshotSchema = z.object({
    path: z.string().nullable(),
    enabled: z.boolean(),
    strategy: z
        .object({
            name: z.string(),
            version: z.number(),
        })
        .nullable(),
    orchestrator: z.object({
        state: z.enum(['bound-online', 'bound-offline', 'missing', 'unresolvable']),
        instanceId: z.string().optional(),
        holderId: z.string().optional(),
        reason: z.string().optional(),
    }),
    members: z.array(fleetMemberSchema),
    capacity: z.object({
        total: z.number(),
        enabled: z.number(),
        writeCapable: z.number(),
        missing: z.array(z.string()),
    }),
});

/** Fleet snapshot response DTO. */
export type FleetSnapshot = z.infer<typeof fleetSnapshotSchema>;

/** One supervised process row of GET /processes. */
export const processEntrySchema = z.object({
    agentId: z.string(),
    pid: z.number().nullable(),
    status: z.enum(['running', 'stopped', 'exited', 'errored']),
    startedAt: z.string(),
    exitCode: z.number().nullable(),
    /** Retired grouping id — always null on the wire since 0860. */
    teamId: z.null(),
    session: memberSessionSchema.optional(),
});

/** One ProcessRegistry execution row of GET /processes. */
export const processExecutionSchema = z.object({
    id: z.string(),
    label: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    pid: z.number().nullable(),
    status: z.string(),
    startedAt: z.string(),
    exitedAt: z.string().nullable(),
    exitCode: z.number().nullable(),
    source: z.string(),
    teamId: z.string().nullable(),
    agentId: z.string().nullable(),
});

/** Supervised process list (the wire shape of GET /processes). */
export const processListResponseSchema = z.object({
    processes: z.array(processEntrySchema),
    count: z.number(),
    executions: z.array(processExecutionSchema),
    executionsCount: z.number(),
});

/** Process list response DTO. */
export type ProcessListResponse = z.infer<typeof processListResponseSchema>;

/** One configured executor row in the fleet snapshot. */
export const configuredAgentExecutorSchema = z.object({
    name: z.string(),
    agent: z.string(),
    model: z.string().optional(),
    tier: z.string(),
    disabled: z.boolean(),
    disabledOwner: z.string().optional(),
    disabledReason: z.string().optional(),
    disabledSince: z.string().optional(),
    installed: z.boolean().optional(),
    usable: z.boolean().optional(),
    version: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    elected: z.array(z.string()).optional(),
    executionCapabilities: z.record(z.string(), z.unknown()).optional(),
    sourceLayer: z.enum(['project', 'global']).optional(),
    sourcePath: z.string().optional(),
});

/** A single executor as reported in the project fleet snapshot. */
export type ConfiguredAgentExecutorDto = z.infer<typeof configuredAgentExecutorSchema>;

/** One pipeline stage row from the perspective of agent executors. */
export const configuredStageInfoSchema = z.object({
    id: z.string(),
    alias: z.string().optional(),
    description: z.string(),
    role: z.string(),
    tier: z.string(),
    skill: z.string().optional(),
    electedExecutor: z.string().nullable().optional(),
    candidateExecutors: z.array(z.string()).optional(),
});

/** Pipeline stage DTO from the perspective of agent executors. */
export type ConfiguredStageInfoDto = z.infer<typeof configuredStageInfoSchema>;

/** Request shape for toggling an executor's availability (ready / disabled). */
export const executorAvailabilityInputSchema = z.object({
    name: z.string(),
    disabled: z.boolean(),
    layer: z.enum(['project', 'global']).optional(),
});

/** Input for toggling an executor's availability; layer falls back to where the executor is declared (project when the request targets a project, else global). */
export type ExecutorAvailabilityInput = z.infer<typeof executorAvailabilityInputSchema>;

/** Response shape for updating an executor's availability. */
export const executorAvailabilityResponseSchema = z.object({
    ok: z.boolean(),
    status: z.enum(['updated', 'unchanged']),
    reason: z.string().optional(),
    targetLayer: z.enum(['project', 'global']).optional(),
    targetPath: z.string().optional(),
});

/** Result of toggling an executor's availability (ready/disabled) for a project. */
export type ExecutorAvailabilityResponse = z.infer<typeof executorAvailabilityResponseSchema>;

/** Fleet snapshot contract — CONTRACT ONLY, served by the Hono health module. */
export const fleetContract = {
    snapshot: oc
        .route({
            method: 'GET',
            path: '/project/fleet',
            summary: 'Read the project fleet snapshot (declared roster + runtime session state)',
            tags: ['fleet'],
        })
        .output(fleetSnapshotSchema),
    setExecutorAvailability: oc
        .route({
            method: 'POST',
            path: '/project/executors/availability',
            summary: 'Toggle an executor availability state (Ready / Disabled) in project or global config',
            tags: ['fleet'],
        })
        .input(executorAvailabilityInputSchema)
        .output(executorAvailabilityResponseSchema),
};

/** Supervised process list contract — CONTRACT ONLY, served by the Hono processes module. */
export const processesContract = {
    list: oc
        .route({
            method: 'GET',
            path: '/processes',
            summary: 'List supervised agent processes and registry executions',
            tags: ['processes'],
        })
        .output(processListResponseSchema),
};
