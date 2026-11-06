import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * Planning-document read contracts (task 1300).
 *
 * Plans and designs were the last Board reads served by ad-hoc raw Hono handlers with
 * handwritten envelopes. These contracts give the same paths and the same success payloads
 * a validated transport owner, so the web helpers use the same typed client, cancellation
 * and error surfaces as every other Board read.
 */

/** One listed plan document (`docs/02_ROADMAP.md` or `docs/plans/*.md`). */
export const planFileSummarySchema = z.object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    title: z.string(),
    category: z.enum(['roadmap', 'plan']),
});

/** One listed design document (`DESIGN.md`, `docs/04_DESIGN.md` or `docs/design/*.md`). */
export const designFileSummarySchema = z.object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    title: z.string(),
    category: z.enum(['root', 'architecture', 'satellite']),
});

/** List payload for plans. `total` is retained from the pre-contract wire shape. */
export const planListResponseSchema = z.object({
    files: z.array(planFileSummarySchema),
    total: z.number(),
});

/** List payload for designs. `total` is retained from the pre-contract wire shape. */
export const designListResponseSchema = z.object({
    files: z.array(designFileSummarySchema),
    total: z.number(),
});

/** Detail payload shared by both document kinds — the pre-contract success shape. */
export const planningDocumentSchema = z.object({
    ok: z.literal(true),
    path: z.string(),
    title: z.string(),
    content: z.string(),
});

/** Request for one document: the corpus-relative path the operator selected. */
export const planningDocumentInputSchema = z.object({ path: z.string().min(1) });

/** Plan/design read routes. Paths match the surfaces the Board already called. */
export const planningDocumentsContract = {
    planList: oc
        .route({ method: 'GET', path: '/project/plans', summary: 'List plan documents', tags: ['planning'] })
        .output(planListResponseSchema),
    planShow: oc
        .route({ method: 'GET', path: '/project/plans/file', summary: 'Read one plan document', tags: ['planning'] })
        .input(planningDocumentInputSchema)
        .output(planningDocumentSchema),
    designList: oc
        .route({ method: 'GET', path: '/project/designs', summary: 'List design documents', tags: ['planning'] })
        .output(designListResponseSchema),
    designShow: oc
        .route({
            method: 'GET',
            path: '/project/designs/file',
            summary: 'Read one design document',
            tags: ['planning'],
        })
        .input(planningDocumentInputSchema)
        .output(planningDocumentSchema),
};

/** One listed plan document. */
export type PlanFileSummary = z.infer<typeof planFileSummarySchema>;
/** One listed design document. */
export type DesignFileSummary = z.infer<typeof designFileSummarySchema>;
/** Plan list payload. */
export type PlanListResponse = z.infer<typeof planListResponseSchema>;
/** Design list payload. */
export type DesignListResponse = z.infer<typeof designListResponseSchema>;
/** One read plan or design document. */
export type PlanningDocument = z.infer<typeof planningDocumentSchema>;
