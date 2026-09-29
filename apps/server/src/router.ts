import type { BoardCatalog } from '@gobing-ai/spur-contracts';
import { contract } from '@gobing-ai/spur-contracts';
import { implement } from '@orpc/server';
import type { ServerContext } from './context';
import { createFeatureHandlers } from './modules/feature';
import { createHistoryHandlers } from './modules/history';
import { createTaskHandlers } from './modules/task';

const version = '0.0.0';

const os = implement(contract);
/**
 * Catalog answered by a server with no prepared module snapshot (stand-alone/test contexts):
 * a valid empty catalog, so the read-only procedure exists everywhere the contract does (R4/R6).
 */
export const EMPTY_BOARD_CATALOG: BoardCatalog = { catalogVersion: 1, host: null, modules: [] };

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

        history: createHistoryHandlers(ctx ?? stubCtx),

        // Read-only project module catalog: the frozen startup snapshot, never a live re-read (AC5).
        board: {
            modules: os.board.modules.handler(() => ctx?.boardModules?.catalog ?? EMPTY_BOARD_CATALOG),
        },

        stream: os.stream.handler(async () => {
            throw new Error('SSE stream served by raw Hono route (modules/events)');
        }),
    };
}

/** Inferred oRPC router shape for type-safe handler consumption. */
export type AppRouter = ReturnType<typeof createRouter>;
