import { FEATURE_ID_PATTERN, FEATURE_STATUSES, PRIORITIES } from '@gobing-ai/spur-domain/schema';
import { oc } from '@orpc/contract';
import { z } from 'zod';
import { apiSuccessSchema } from './shared';

// ─── DTOs ───────────────────────────────────────────────────────────────────

const featureIdSchema = z.string().regex(FEATURE_ID_PATTERN, {
    message: 'feature id must match ^[A-Z][1-9]*$ (DD-14)',
});

/** Summary row returned in feature lists. */
export const featureSummarySchema = z.object({
    id: featureIdSchema,
    name: z.string().min(1),
    status: z.enum(FEATURE_STATUSES),
    priority: z.enum(PRIORITIES).optional(),
    parentId: featureIdSchema.nullable().optional(),
    // Optional: FeatureService.list does not yet compute a per-feature task
    // count (no cheap corpus source). Populated once an aggregation provides it.
    wbsCount: z.number().int().nonnegative().optional(),
});

/** Feature list response: `{ ok: true, data: FeatureSummary[] }`. */
export const featureListResponseSchema = apiSuccessSchema(z.array(featureSummarySchema));

/** Feature detail response. */
export const featureShowResponseSchema = apiSuccessSchema(
    z.object({
        id: featureIdSchema,
        name: z.string(),
        status: z.enum(FEATURE_STATUSES),
        frontmatter: z.record(z.string(), z.unknown()),
        content: z.string(),
        filePath: z.string(),
    }),
);

/** Show-feature path-param input (required for oRPC OpenAPI compact mode). */
export const featureShowInputSchema = z.object({
    id: featureIdSchema,
});

/** Create-feature input. */
export const featureCreateInputSchema = z.object({
    name: z.string().min(1),
    parentId: featureIdSchema.optional(),
});

/** Create-feature response: `{ ok: true, data: { id, filePath } }`. */
export const featureCreateResponseSchema = apiSuccessSchema(
    z.object({
        id: z.string(),
        filePath: z.string(),
    }),
);

/** Transition-feature input (id from path param is required for oRPC OpenAPI compact mode). */
export const featureTransitionInputSchema = z.object({
    id: featureIdSchema,
    toStatus: z.enum(FEATURE_STATUSES),
    actor: z.string().optional(),
});

/** Transition-feature response. */
export const featureTransitionResponseSchema = apiSuccessSchema(
    z.object({
        id: z.string(),
        status: z.enum(FEATURE_STATUSES),
    }),
);

// ─── New endpoints (0218) ───────────────────────────────────────────────────

/** Body-update input (PATCH /features/{id}/body). */
export const featureBodyUpdateInputSchema = z.object({
    id: featureIdSchema,
    body: z.string(),
    actor: z.string().optional(),
});

/** Body-update response: `{ ok: true }`. */
export const featureBodyUpdateResponseSchema = apiSuccessSchema(z.object({}));

/** Supported feature workflow action names. */
export const featureActionNameSchema = z.enum(['brainstorm', 'plan']);

/** Agent channels accepted by feature workflow actions. */
export const featureActionChannelSchema = z.enum([
    'claude',
    'codex',
    'gemini',
    'pi',
    'opencode',
    'antigravity',
    'openclaw',
]);

/** Action input (POST /features/{id}/action). */
export const featureActionInputSchema = z.object({
    id: featureIdSchema,
    action: featureActionNameSchema,
    channel: featureActionChannelSchema.optional(),
    skipDeps: z.boolean().optional(),
});

/** Action response: `{ ok: true }`. */
export const featureActionResponseSchema = apiSuccessSchema(z.object({}));

/** Create-child input (POST /features/{id}/children). */
export const featureCreateChildInputSchema = z.object({
    id: featureIdSchema,
    name: z.string().min(1),
});

/** Create-child response: `{ ok: true, data: { id, filePath } }`. */
export const featureCreateChildResponseSchema = apiSuccessSchema(
    z.object({
        id: z.string(),
        filePath: z.string(),
    }),
);

/** Create-task input (POST /features/{id}/tasks). */
export const featureCreateTaskInputSchema = z.object({
    id: featureIdSchema,
    title: z.string().min(1),
});

/** Create-task response: `{ ok: true, data: { wbs, filePath } }`. */
export const featureCreateTaskResponseSchema = apiSuccessSchema(
    z.object({
        wbs: z.string(),
        filePath: z.string(),
    }),
);

/** Link-task input (PATCH /features/{id}/link). */
export const featureLinkTaskInputSchema = z.object({
    id: featureIdSchema,
    wbs: z.string().regex(/^\d{4}$/),
});

/** Link-task response: `{ ok: true }`. */
export const featureLinkTaskResponseSchema = apiSuccessSchema(z.object({}));

/** Sync-directions for POST /features/{id}/sync. */
export const featureSyncDirectionSchema = z.enum(['pull', 'push']);

/** Sync input (POST /features/{id}/sync). */
export const featureSyncInputSchema = z.object({
    id: featureIdSchema,
    direction: featureSyncDirectionSchema,
});

/** Sync response: `{ ok: true, data: { direction, affectedTasks, newStatus? } }`. */
export const featureSyncResponseSchema = apiSuccessSchema(
    z.object({
        direction: featureSyncDirectionSchema,
        affectedTasks: z.number().int().nonnegative(),
        newStatus: z.string().optional(),
    }),
);

// ─── Contract ───────────────────────────────────────────────────────────────
/** oRPC contract for the feature domain — list, show, create, transition, refresh. */
export const featureContract = {
    list: oc
        .route({
            method: 'GET',
            path: '/features',
            summary: 'List features',
            tags: ['feature'],
        })
        .output(featureListResponseSchema),

    show: oc
        .route({
            method: 'GET',
            path: '/features/{id}',
            summary: 'Show feature detail',
            tags: ['feature'],
        })
        .input(featureShowInputSchema)
        .output(featureShowResponseSchema),

    create: oc
        .route({
            method: 'POST',
            path: '/features',
            summary: 'Create a feature',
            tags: ['feature'],
        })
        .input(featureCreateInputSchema)
        .output(featureCreateResponseSchema),

    transition: oc
        .route({
            method: 'PATCH',
            path: '/features/{id}/status',
            summary: 'Transition feature status',
            tags: ['feature'],
        })
        .input(featureTransitionInputSchema)
        .output(featureTransitionResponseSchema),

    refresh: oc
        .route({
            method: 'POST',
            path: '/features/refresh',
            summary: 'Refresh feature index and kanban',
            tags: ['feature'],
        })
        .output(
            apiSuccessSchema(
                z.object({
                    rebuilt: z.number().int().nonnegative(),
                }),
            ),
        ),

    check: oc
        .route({
            method: 'POST',
            path: '/features/{id}/check',
            summary: 'Run the four-layer feature check',
            tags: ['feature'],
        })
        .input(z.object({ id: featureIdSchema }))
        .output(
            apiSuccessSchema(
                z.object({
                    id: z.string(),
                    status: z.string(),
                    pass: z.boolean(),
                    findings: z.array(
                        z.object({
                            layer: z.enum(['L1', 'L2', 'L3', 'L4']),
                            severity: z.enum(['error', 'warning', 'info']),
                            section: z.string(),
                            message: z.string(),
                        }),
                    ),
                    requiredSections: z.array(z.string()),
                    missingSections: z.array(z.string()),
                }),
            ),
        ),

    body: oc
        .route({
            method: 'PATCH',
            path: '/features/{id}/body',
            summary: 'Update feature body',
            tags: ['feature'],
        })
        .input(featureBodyUpdateInputSchema)
        .output(featureBodyUpdateResponseSchema),

    action: oc
        .route({
            method: 'POST',
            path: '/features/{id}/action',
            summary: 'Run a feature workflow action',
            tags: ['feature'],
        })
        .input(featureActionInputSchema)
        .output(featureActionResponseSchema),

    children: oc
        .route({
            method: 'POST',
            path: '/features/{id}/children',
            summary: 'Create a child feature',
            tags: ['feature'],
        })
        .input(featureCreateChildInputSchema)
        .output(featureCreateChildResponseSchema),

    tasks: oc
        .route({
            method: 'POST',
            path: '/features/{id}/tasks',
            summary: 'Create a task linked to feature',
            tags: ['feature'],
        })
        .input(featureCreateTaskInputSchema)
        .output(featureCreateTaskResponseSchema),

    link: oc
        .route({
            method: 'PATCH',
            path: '/features/{id}/link',
            summary: 'Link an existing task to feature',
            tags: ['feature'],
        })
        .input(featureLinkTaskInputSchema)
        .output(featureLinkTaskResponseSchema),

    sync: oc
        .route({
            method: 'POST',
            path: '/features/{id}/sync',
            summary: 'Sync feature status with linked tasks',
            tags: ['feature'],
        })
        .input(featureSyncInputSchema)
        .output(featureSyncResponseSchema),
};
