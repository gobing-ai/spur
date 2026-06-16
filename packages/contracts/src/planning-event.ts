import { oc } from '@orpc/contract';
import { z } from 'zod';

/**
 * SSE frame DTO — one event payload yielded by the async iterator.
 *
 * TODO(S6): Confirm the exact oRPC event-iterator output form against the
 * installed @orpc/server version when implementing the SSE handler. The
 * per-frame DTO (planningEventEnvelopeSchema) is stable either way.
 */
export const planningEventEnvelopeSchema = z.object({
    ok: z.literal(true),
    data: z.object({
        eventName: z.string(),
        occurredAt: z.string().datetime(),
        actor: z.string().nullable().optional(),
        payload: z.record(z.string(), z.unknown()),
    }),
});

/**
 * Planning event SSE contract — CONTRACT ONLY, no handler.
 *
 * The SSE handler (S6) and client hook (W6) are deferred (invariant #10).
 * This contract ships now so the polling hook is authored against the
 * eventual SSE types; the swap is a localized handler change.
 */
export const planningEventContract = {
    stream: oc
        .route({
            method: 'GET',
            path: '/events/planning',
            summary: 'Stream planning events (SSE)',
            tags: ['events'],
        })
        .output(planningEventEnvelopeSchema),
};
