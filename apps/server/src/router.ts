import { contract } from '@gobing-ai/spur-contracts';
import { implement } from '@orpc/server';

const version = '0.0.0';

/** Builder bound to the public Spur contract — handlers must satisfy it at compile time. */
const os = implement(contract);

/** oRPC router implementing the public Spur contract. */
export const router = {
    health: os.health.handler(() => ({
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
        service: 'spur' as const,
        version,
    })),
};

/** Type-level alias for the public server router. */
export type AppRouter = typeof router;
