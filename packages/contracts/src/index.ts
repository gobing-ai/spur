import { oc } from '@orpc/contract';
import { z } from 'zod';
import { featureContract } from './feature';
import { historyContract } from './history';
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
    history: { ...historyContract },
    ...planningEventContract,
};

/** Type-level alias for the public Spur oRPC contract. */
export type SpurContract = typeof contract;
export { featureCreateInputSchema, featureListResponseSchema, featureShowResponseSchema } from './feature';
export * from './history';
export * from './observability';
// Shared transport envelope schemas (apiSuccessSchema / apiErrorSchema / pagination) —
// public so the CLI can adopt them as its `--json-envelope` standard (ADR-091, task 0693).
export * from './shared';
// ─── Re-exported DTO schemas for handler return-type inference ───
export {
    taskActionInputSchema,
    taskActionResponseSchema,
    taskBodyUpdateInputSchema,
    taskBodyUpdateResponseSchema,
    taskCreateInputSchema,
    taskFoldersResponseSchema,
    taskListInputSchema,
    taskListResponseSchema,
    taskShowResponseSchema,
} from './task';
