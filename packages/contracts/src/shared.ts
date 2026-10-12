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
    'WBS_COLLISION',
    'CONFLICT',
    'INTERNAL_ERROR',
] as const;

/** Union of all values in {@link API_ERROR_CODES}. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * The typed domain-error codes the `/api/*` transport seam re-shapes, per the R7 domain-error →
 * HTTP mapping table. One list: the server's error mapping, its response encoder and the client's
 * decoder all read it, so an emitter and a decoder cannot disagree about which codes carry the
 * envelope. Each code's HTTP status stays owned by the server's domain-error table — the client
 * reads the status off the response instead of keeping a second copy.
 */
export const DOMAIN_ERROR_CODES = ['GUARD_DENIED', 'WBS_COLLISION', 'LOCK_TIMEOUT'] as const;

/** Union of {@link DOMAIN_ERROR_CODES}. */
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

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

/**
 * Decode a transport error envelope, or `undefined` when the body is not one.
 *
 * The typed client's response decoder and any other consumer read the SAME schema the transport
 * documents, so an emitter and a decoder cannot disagree about the envelope. The HTTP status is
 * deliberately not part of this shape: it is read off the response, because the status mapping is
 * owned by the server error handler's domain-error table (see the note above), and duplicating it
 * here is how the two paths would drift.
 */
export function decodeApiErrorBody(
    body: unknown,
): { code: ApiErrorCode; message: string; details?: unknown } | undefined {
    const parsed = apiErrorSchema.safeParse(body);
    if (!parsed.success) return undefined;
    const { code, message, details } = parsed.data.error;
    return details === undefined ? { code, message } : { code, message, details };
}

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
