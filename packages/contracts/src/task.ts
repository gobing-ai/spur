import { PRIORITIES, TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import { oc } from '@orpc/contract';
import { z } from 'zod';
import { apiSuccessSchema } from './shared';

// ─── DTOs ───────────────────────────────────────────────────────────────────

/** Summary row returned in task lists. */
export const taskSummarySchema = z.object({
    wbs: z.string().regex(/^\d{4}$/),
    name: z.string().min(1),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(PRIORITIES).optional(),
    featureId: z.string().nullable().optional(),
    parentWbs: z
        .string()
        .regex(/^\d{4}$/)
        .nullable()
        .optional(),
    filePath: z.string(),
});

/** Task list response: `{ ok: true, data: TaskSummary[] }`. */
export const taskListResponseSchema = apiSuccessSchema(z.array(taskSummarySchema));

/** Task detail response. */
export const taskShowResponseSchema = apiSuccessSchema(
    z.object({
        wbs: z.string(),
        name: z.string(),
        status: z.enum(TASK_STATUSES),
        frontmatter: z.record(z.string(), z.unknown()),
        content: z.string(),
        filePath: z.string(),
    }),
);

/** Show-task path-param input (required for oRPC OpenAPI compact mode). */
export const taskShowInputSchema = z.object({
    wbs: z.string().regex(/^\d{4}$/),
});

/** Create-task input. */
export const taskCreateInputSchema = z.object({
    title: z.string().min(1),
    featureId: z.string().optional(),
    parentWbs: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
    folder: z.string().optional(),
});

/** Create-task response: `{ ok: true, data: { wbs, filePath } }`. */
export const taskCreateResponseSchema = apiSuccessSchema(
    z.object({
        wbs: z.string(),
        filePath: z.string(),
    }),
);

/** Transition-task input. */
export const taskTransitionInputSchema = z.object({
    wbs: z.string().regex(/^\d{4}$/),
    toStatus: z.enum(TASK_STATUSES),
    actor: z.string().optional(),
});

/** Transition-task response. */
export const taskTransitionResponseSchema = apiSuccessSchema(
    z.object({
        wbs: z.string(),
        status: z.enum(TASK_STATUSES),
    }),
);

/** oRPC contract for the task domain — list, show, create, transition. */
export const taskContract = {
    list: oc
        .route({
            method: 'GET',
            path: '/tasks',
            summary: 'List tasks',
            tags: ['task'],
        })
        .output(taskListResponseSchema),

    show: oc
        .route({
            method: 'GET',
            path: '/tasks/{wbs}',
            summary: 'Show task detail',
            tags: ['task'],
        })
        .input(taskShowInputSchema)
        .output(taskShowResponseSchema),

    create: oc
        .route({
            method: 'POST',
            path: '/tasks',
            summary: 'Create a task',
            tags: ['task'],
        })
        .input(taskCreateInputSchema)
        .output(taskCreateResponseSchema),

    transition: oc
        .route({
            method: 'PATCH',
            path: '/tasks/{wbs}/status',
            summary: 'Transition task status',
            tags: ['task'],
        })
        .input(taskTransitionInputSchema)
        .output(taskTransitionResponseSchema),
};
