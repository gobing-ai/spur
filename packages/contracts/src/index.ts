import { oc } from '@orpc/contract';
import { z } from 'zod';
import { featureContract } from './feature';
import { planningEventContract } from './planning-event';
import { taskContract } from './task';

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
    task: { ...taskContract },
    feature: { ...featureContract },
    ...planningEventContract,
};

/** Type-level alias for the public Spur oRPC contract. */
export type SpurContract = typeof contract;
export { featureCreateInputSchema, featureListResponseSchema, featureShowResponseSchema } from './feature';
// ─── Re-exported DTO schemas for handler return-type inference ───
export { taskCreateInputSchema, taskListResponseSchema, taskShowResponseSchema } from './task';
