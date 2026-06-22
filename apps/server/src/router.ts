import { contract } from '@gobing-ai/spur-contracts';
import { implement } from '@orpc/server';
import type { ServerContext } from './context';
import { createFeatureHandlers } from './modules/feature';
import { createTaskHandlers } from './modules/task';

const version = '0.0.0';

const os = implement(contract);
/** Proxy-based stub that throws on any property access — used when no real ServerContext is available. */
export const stubCtx: ServerContext = new Proxy({} as ServerContext, {
    get(_t, p) {
        throw new Error(
            `ServerContext not configured — cannot access ${String(p)}. Provide a real ServerContext to enable task/feature routes.`,
        );
    },
});
/**
 * Create the oRPC router with context-bound handlers. Task/feature fall back to stubCtx when no ServerContext is provided.
 */
export function createRouter(ctx?: ServerContext) {
    return {
        health: os.health.handler(() => ({
            status: 'ok' as const,
            timestamp: new Date().toISOString(),
            service: 'spur' as const,
            version,
        })),

        task: createTaskHandlers(ctx ?? stubCtx),

        feature: createFeatureHandlers(ctx ?? stubCtx),

        stream: os.stream.handler(async () => {
            throw new Error('SSE stream served by raw Hono route (modules/events)');
        }),
    };
}

/** Inferred oRPC router shape for type-safe handler consumption. */
export type AppRouter = ReturnType<typeof createRouter>;
