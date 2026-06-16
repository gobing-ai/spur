import { z } from 'zod';

/**
 * Canonical transport error-code vocabulary surfaced in the error envelope.
 * Aligned with the R7 domain-error → HTTP mapping table (design §2.6); the
 * runtime mapping to HTTP status lives in the server error handler, not here.
 */
export const API_ERROR_CODES = [
    'NOT_FOUND',
    'VALIDATION_FAILED',
    'GUARD_DENIED',
    'LOCK_TIMEOUT',
    'CONFLICT',
    'INTERNAL_ERROR',
] as const;

/** Union of all values in {@link API_ERROR_CODES}. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Generic success envelope factory.
 * Usage: `apiSuccessSchema(taskShowDataSchema)` → `{ ok: true, data: T }`.
 */
export function apiSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
    return z.object({
        ok: z.literal(true),
        data: dataSchema,
    });
}

/** Standard error envelope: `{ ok: false, error: { code, message, details? } }`. */
export const apiErrorSchema = z.object({
    ok: z.literal(false),
    error: z.object({
        code: z.enum(API_ERROR_CODES),
        message: z.string(),
        details: z.unknown().optional(),
    }),
});

/** Pagination metadata matching the ts-utils cursor `buildCursorMeta` shape. */
export const paginationMetaSchema = z.object({
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
    limit: z.number().int().positive(),
});

/**
 * Paginated list response factory.
 * Usage: `paginatedResponseSchema(taskSummarySchema)` → `{ ok: true, data: T[], meta: PaginationMeta }`.
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
    return z.object({
        ok: z.literal(true),
        data: z.array(itemSchema),
        meta: paginationMetaSchema,
    });
}

/** Inferred shape of a single pagination-meta payload. */
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;
