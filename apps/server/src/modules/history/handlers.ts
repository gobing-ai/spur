import { contract } from '@gobing-ai/spur-contracts';
import { implement } from '@orpc/server';
import type { ServerContext } from '../../context';

const os = implement(contract);

/**
 * Create history domain oRPC handlers delegating to ctx.historyBoardService().
 */
export function createHistoryHandlers(ctx: ServerContext) {
    return {
        getSummary: os.history.getSummary.handler(async ({ input }) => {
            const data = await ctx.historyBoardService().getSummary(input);
            return { ok: true as const, data };
        }),

        getTimeline: os.history.getTimeline.handler(async ({ input }) => {
            const data = await ctx.historyBoardService().getTimeline(input);
            return { ok: true as const, data };
        }),

        getSessions: os.history.getSessions.handler(async ({ input }) => {
            const data = await ctx.historyBoardService().getSessions(input);
            return { ok: true as const, data };
        }),

        getInsights: os.history.getInsights.handler(async ({ input }) => {
            const data = await ctx.historyBoardService().getInsights(input);
            return { ok: true as const, data };
        }),

        getSources: os.history.getSources.handler(async () => {
            const data = await ctx.historyBoardService().getSources();
            return { ok: true as const, data };
        }),

        triggerImport: os.history.triggerImport.handler(async ({ input }) => {
            const data = await ctx.historyBoardService().triggerImport(input.mode);
            return { ok: true as const, data };
        }),
    };
}
