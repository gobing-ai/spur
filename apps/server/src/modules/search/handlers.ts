import { SearchError, searchProject, searchStatus } from '@gobing-ai/spur-app/search';
import { contract } from '@gobing-ai/spur-contracts';
import { implement, ORPCError } from '@orpc/server';
import type { ServerContext } from '../../context';

const os = implement(contract);

/**
 * Map a SearchError to the module's oRPC error convention (pattern: inbox handlers):
 * invalid requests are client errors, backend/environment failures are server errors
 * carrying the actionable message (install hint) verbatim.
 */
function toSearchORPCError(error: SearchError) {
    if (error.code === 'invalid-request') return new ORPCError('BAD_REQUEST', { message: error.message });
    return new ORPCError('INTERNAL_SERVER_ERROR', { message: error.message });
}

/**
 * Create search domain oRPC handlers (feature A34 R9, design `docs/design/hybrid-search.md` §4).
 *
 * Thin transport over `packages/app` SearchService (ADR-021): handlers only bind `ctx.cwd`
 * (never a client-supplied root — prevents path traversal) and translate SearchError.
 */
export function createSearchHandlers(ctx: ServerContext) {
    return {
        query: os.search.query.handler(async ({ input }) => {
            try {
                const data = await searchProject(input, ctx.cwd);
                return { ok: true as const, data };
            } catch (error) {
                if (error instanceof SearchError) throw toSearchORPCError(error);
                throw error;
            }
        }),

        status: os.search.status.handler(async () => {
            try {
                const data = await searchStatus(ctx.cwd);
                return { ok: true as const, data };
            } catch (error) {
                if (error instanceof SearchError) throw toSearchORPCError(error);
                throw error;
            }
        }),
    };
}
