import { contract, healthResponseSchema } from '@gobing-ai/spur-contracts';
import { os } from '@orpc/server';

const version = '0.0.0';

/** oRPC router implementing the public Spur contract. */
export const router = {
    health: os
        .route(contract.health['~orpc'].route)
        .output(healthResponseSchema)
        .handler(() => ({
            status: 'ok' as const,
            timestamp: new Date().toISOString(),
            service: 'spur' as const,
            version,
        })),
};

/** Type-level alias for the public server router. */
export type AppRouter = typeof router;
