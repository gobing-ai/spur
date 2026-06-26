import { TASK_STATUSES, TASK_TYPES, TASK_VARIANTS } from '@gobing-ai/spur-domain/schema';
import { oc } from '@orpc/contract';
import { z } from 'zod';
import { apiSuccessSchema } from './shared';

// ─── DTOs ───────────────────────────────────────────────────────────────────

/** Summary row returned in task lists. */
export const taskSummarySchema = z.object({
    wbs: z.string().regex(/^\d{4}$/),
    name: z.string().min(1),
    status: z.enum(TASK_STATUSES),
    // Free-form: the corpus mixes P0–P3 with high/medium/low; pass the raw value through.
    priority: z.string().optional(),
    featureId: z.string().nullable().optional(),
    parentWbs: z
        .string()
        .regex(/^\d{4}$/)
        .nullable()
        .optional(),
    type: z.enum(TASK_TYPES).optional(),
    filePath: z.string(),
    updatedAt: z.string().optional(),
});

/** Task list response: `{ ok: true, data: TaskSummary[] }`. */
export const taskListResponseSchema = apiSuccessSchema(z.array(taskSummarySchema));

/** Task list query input. */
export const taskListInputSchema = z.object({
    folder: z.string().optional(),
    status: z.string().optional(),
    parent: z.string().optional(),
});

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
    template: z.enum(TASK_VARIANTS).optional(),
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

/** Body-update input (PATCH /tasks/{wbs}/body). */
export const taskBodyUpdateInputSchema = z.object({
    wbs: z.string().regex(/^\d{4}$/),
    body: z.string(),
    actor: z.string().optional(),
});

/** Body-update response: `{ ok: true, data: { wbs, filePath } }`. */
export const taskBodyUpdateResponseSchema = apiSuccessSchema(
    z.object({
        wbs: z.string(),
        filePath: z.string(),
    }),
);

/** Action input (POST /tasks/{wbs}/actions). */
export const taskActionInputSchema = z.object({
    wbs: z.string().regex(/^\d{4}$/),
    action: z.enum(['refine', 'plan', 'run', 'verify', 'decompose', 'evaluate']),
    channel: z.string().optional(),
    skipDeps: z.boolean().optional(),
});

/** Action response: `{ ok: true, data: { runId, action, status } }`. */
export const taskActionResponseSchema = apiSuccessSchema(
    z.object({
        runId: z.string(),
        action: z.string(),
        status: z.literal('queued'),
    }),
);

/** Task folder entry — a configured task folder from .spur/config.yaml (tasks.folders). */
export const taskFolderSchema = z.object({
    path: z.string(),
    label: z.string().optional(),
});

/** Folders response: `{ ok: true, data: TaskFolder[] }`. */
export const taskFoldersResponseSchema = apiSuccessSchema(z.array(taskFolderSchema));

/** oRPC contract for the task domain — list, show, create, transition, body. */
export const taskContract = {
    list: oc
        .route({
            method: 'GET',
            path: '/tasks',
            summary: 'List tasks',
            tags: ['task'],
        })
        .input(taskListInputSchema)
        .output(taskListResponseSchema),

    folders: oc
        .route({
            method: 'GET',
            path: '/tasks/folders',
            summary: 'List configured task folders',
            tags: ['task'],
        })
        .output(taskFoldersResponseSchema),
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

    body: oc
        .route({
            method: 'PATCH',
            path: '/tasks/{wbs}/body',
            summary: 'Update task body',
            tags: ['task'],
        })
        .input(taskBodyUpdateInputSchema)
        .output(taskBodyUpdateResponseSchema),

    action: oc
        .route({
            method: 'POST',
            path: '/tasks/{wbs}/actions',
            summary: 'Run a task action',
            tags: ['task'],
        })
        .input(taskActionInputSchema)
        .output(taskActionResponseSchema),
};
