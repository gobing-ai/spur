import { UnsupportedProcessPlatformError } from '@gobing-ai/spur-app';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Observability HTTP surfaces beyond SSE/history (task 0243).
 *
 * GET /api/observability/processes — serve-rooted process inventory with
 * supervisor overlay. Read-only; team control stays on /api/team/*.
 */
export const observabilityModule: ServerModule = {
    name: 'observability',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        app.get('/api/observability/processes', async (c) => {
            try {
                const snapshot = await ctx.processInventory().snapshot();
                return c.json(snapshot);
            } catch (err) {
                if (err instanceof UnsupportedProcessPlatformError) {
                    return c.json({ error: err.message, code: err.code }, 501);
                }
                const message = err instanceof Error ? err.message : String(err);
                return c.json({ error: message }, 500);
            }
        });
    },
};
