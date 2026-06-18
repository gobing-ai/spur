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
};
