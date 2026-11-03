import { oc } from '@orpc/contract';
import { z } from 'zod';
import { apiSuccessSchema } from './shared';

// ─── Search DTO Schemas (task 1285, hybrid-search.md §4) ────────────────────

/** Search ranking mode. */
export const searchModeEnum = z.enum(['exact', 'fuzzy', 'auto']);
/** Inferred type for SearchMode. */
export type SearchMode = z.infer<typeof searchModeEnum>;

/** Search scope controlling the default glob set. */
export const searchScopeEnum = z.enum(['docs', 'code', 'all']);
/** Inferred type for SearchScope. */
export type SearchScope = z.infer<typeof searchScopeEnum>;

/** Probe result for one external search binary. */
const searchToolStatusSchema = z.object({
    available: z.boolean(),
    version: z.string().optional(),
});

/** Environment/readiness status for the search backends. */
export const searchStatusSchema = z.object({
    rg: searchToolStatusSchema,
    zg: z.object({
        available: z.boolean(),
        version: z.string().optional(),
        index: z.enum(['ready', 'stale', 'missing', 'unknown']),
        /** Exact hint string, printed for the operator and never executed. */
        hint: z.string().optional(),
    }),
});
/** Inferred type for SearchStatus. */
export type SearchStatus = z.infer<typeof searchStatusSchema>;

/** Input for a hybrid search request. */
export const searchRequestSchema = z
    .object({
        query: z.string().trim().min(1),
        mode: searchModeEnum.optional(),
        scope: searchScopeEnum.optional(),
        limit: z.number().int().min(1).max(100).optional(),
        globs: z.array(z.string()).optional(),
        regex: z.boolean().optional(),
    })
    .strict();
/** Inferred type for SearchRequest. */
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/** One ranked result row. */
export const searchHitSchema = z.object({
    rank: z.number().int().min(1),
    path: z.string(),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    snippet: z.string().max(300),
    route: z.enum(['exact', 'fuzzy']),
    matchedBy: z.array(z.enum(['exact', 'fuzzy'])).min(1),
    heading: z.string().optional(),
    symbol: z.string().optional(),
});
/** Inferred type for SearchHit. */
export type SearchHit = z.infer<typeof searchHitSchema>;

/** Degraded search route: why it was skipped and what the operator should run. */
export const searchSkipSchema = z.object({
    route: z.enum(['exact', 'fuzzy']),
    reason: z.enum([
        'rg-not-installed',
        'zg-not-installed',
        'zg-index-missing',
        'zg-timeout',
        'zg-failed',
        'zg-output-error',
    ]),
    hint: z.string().optional(),
});
/** Inferred type for SearchSkip. */
export type SearchSkip = z.infer<typeof searchSkipSchema>;

/** Result groups keyed by backend; null means that route did not run. */
export const searchGroupsSchema = z.object({
    exact: z.array(searchHitSchema).nullable(),
    fuzzy: z.array(searchHitSchema).nullable(),
});
/** Inferred type for SearchGroups. */
export type SearchGroups = z.infer<typeof searchGroupsSchema>;

/** Hybrid search response payload data. */
export const searchResponseDataSchema = z.object({
    query: z.string(),
    mode: searchModeEnum,
    scope: searchScopeEnum,
    groups: searchGroupsSchema,
    skipped: z.array(searchSkipSchema),
    status: searchStatusSchema,
});
/** Inferred type for SearchResponse. */
export type SearchResponse = z.infer<typeof searchResponseDataSchema>;

/** Hybrid search API response envelope schema. */
export const searchResponseSchema = apiSuccessSchema(searchResponseDataSchema);

/** Environment/readiness status response payload data. */
export const searchStatusResponseDataSchema = searchStatusSchema;
/** Inferred type for SearchStatusResponse. */
export type SearchStatusResponse = z.infer<typeof searchStatusResponseDataSchema>;

/** Environment/readiness status API response envelope schema. */
export const searchStatusResponseSchema = apiSuccessSchema(searchStatusResponseDataSchema);

// ─── Contract Definition ─────────────────────────────────────────────────────

/**
 * oRPC hybrid search API contract definition.
 *
 * Task 1285 defines the transport contract only — handlers and mounting into
 * the public `contract` belong to downstream tasks (1286/1287).
 */
export const searchContract = {
    search: oc
        .route({
            method: 'POST',
            path: '/search',
            summary: 'Hybrid search over project docs and code (ripgrep exact + zg indexed)',
            tags: ['search'],
        })
        .input(searchRequestSchema)
        .output(searchResponseSchema),

    searchStatus: oc
        .route({
            method: 'POST',
            path: '/search/status',
            summary: 'Probe search backend availability and zg index readiness',
            tags: ['search'],
        })
        .input(z.void().optional())
        .output(searchStatusResponseSchema),
};
