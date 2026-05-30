import { oc } from '@orpc/contract';
import { z } from 'zod';

/** Application health payload returned by the public health procedure. */
export const healthResponseSchema = z.object({
    status: z.literal('ok'),
    timestamp: z.string(),
    service: z.literal('spur'),
    version: z.string(),
});

/** Application health response DTO inferred from the public schema. */
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Public API contract shared by server handlers and web clients. */
export const contract = {
    health: oc
        .route({
            method: 'GET',
            path: '/health',
            summary: 'Read application health',
            tags: ['system'],
        })
        .output(healthResponseSchema),
};

/** Type-level alias for the public Spur oRPC contract. */
export type SpurContract = typeof contract;
