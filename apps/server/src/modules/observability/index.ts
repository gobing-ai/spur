import type { ToolUseEvent } from '@gobing-ai/spur-app';
import type { Context, Hono } from 'hono';
import type { ServerContext } from '../../context';
import { enqueueSseFrame, sendSseKeepalive } from '../sse/stream-helpers';
import type { ServerModule } from '../types';

/** Process-local ledger watcher (lazy, shared across SSE clients). */
interface LedgerWatcher {
    stop(): void;
    start(): void;
    subscribe(listener: (event: Omit<ToolUseEvent, 'seq'>) => void): () => void;
    pollNewBytes(): void;
}

let ledgerWatcher: LedgerWatcher | undefined;
let ledgerWatcherLoad: Promise<LedgerWatcher> | undefined;
let watcherPath: string | undefined;

/**
 * Lazy shared watcher for the ledger path (tests may call
 * {@link TokenLedgerWatcher.pollNewBytes} on the returned instance).
 */
export async function getLedgerWatcher(path: string): Promise<LedgerWatcher> {
    if (watcherPath === path) {
        if (ledgerWatcher) return ledgerWatcher;
        if (ledgerWatcherLoad) return ledgerWatcherLoad;
    }

    ledgerWatcher?.stop();
    ledgerWatcher = undefined;
    watcherPath = path;

    // Node-only implementation: defer loading node:fs until a local server
    // actually opens the ledger SSE route. Worker bootstrap never loads it.
    const load = import('@gobing-ai/spur-app').then(({ TokenLedgerWatcher }) => {
        const watcher = new TokenLedgerWatcher({ ledgerPath: path });
        watcher.start();
        return watcher;
    });
    ledgerWatcherLoad = load;

    const watcher = await load;
    if (watcherPath === path && ledgerWatcherLoad === load) {
        ledgerWatcher = watcher;
        ledgerWatcherLoad = undefined;
    } else {
        watcher.stop();
    }
    return watcher;
}

/** Test helper: drop the process-local watcher so the next stream bind is clean. */
export function resetLedgerWatcherForTests(): void {
    try {
        ledgerWatcher?.stop();
    } catch {
        /* ignore */
    }
    ledgerWatcher = undefined;
    ledgerWatcherLoad = undefined;
    watcherPath = undefined;
}

/** SSE payload for one ledger append (pure — unit-testable). */
export function toolUseSsePayload(event: Omit<ToolUseEvent, 'seq'>): {
    type: 'tool-use';
    occurredAt: string;
    event: Omit<ToolUseEvent, 'seq'>;
} {
    return {
        type: 'tool-use',
        occurredAt: event.ts,
        event,
    };
}

function handleProcesses(ctx: ServerContext) {
    return async (c: Context) => {
        try {
            const snapshot = await ctx.processInventory().snapshot();
            return c.json(snapshot);
        } catch (err) {
            if (err instanceof Error && 'code' in err && err.code === 'UNSUPPORTED_PLATFORM') {
                return c.json({ error: err.message, code: err.code }, 501);
            }
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

function handleToolUseGet(ctx: ServerContext) {
    return (c: Context) => {
        try {
            const limitParam = c.req.query('limit');
            let limitRaw: number | undefined;
            if (limitParam !== undefined) {
                const parsed = Number.parseInt(limitParam, 10);
                if (!Number.isNaN(parsed)) limitRaw = parsed;
            }
            const before = c.req.query('before') ?? undefined;
            const limit =
                limitRaw === undefined || !Number.isFinite(limitRaw) || limitRaw <= 0 ? 200 : Math.min(limitRaw, 1000);
            const snapshot = ctx.tokenLedger().snapshot({ limit, before });
            return c.json(snapshot);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

function handleToolUseStream(ctx: ServerContext) {
    return (c: Context) => {
        const closed = { current: false };
        let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
        let unsubscribe: (() => void) | undefined;
        const signal = c.req.raw.signal;
        let closeController = () => {
            /* set in start */
        };

        const teardown = () => {
            if (closed.current) return;
            closed.current = true;
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            try {
                unsubscribe?.();
            } catch {
                /* ignore */
            }
            signal.removeEventListener('abort', teardown);
            closeController();
        };

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                closeController = () => {
                    try {
                        controller.close();
                    } catch {
                        /* already closed */
                    }
                };

                if (signal.aborted) {
                    teardown();
                    return;
                }
                signal.addEventListener('abort', teardown);

                heartbeatInterval = setInterval(sendSseKeepalive, 15_000, closed, controller, encoder);

                try {
                    const path = ctx.tokenLedger().path;
                    const watcher = await getLedgerWatcher(path);
                    unsubscribe = watcher.subscribe((event) => {
                        // On backpressure / closed controller, enqueue returns false — tear down.
                        if (!enqueueSseFrame(closed, controller, encoder, toolUseSsePayload(event))) teardown();
                    });
                    enqueueSseFrame(closed, controller, encoder, {
                        type: 'connected',
                        occurredAt: new Date().toISOString(),
                    });
                } catch {
                    enqueueSseFrame(closed, controller, encoder, {
                        type: 'error',
                        error: 'ledger watch unavailable',
                        occurredAt: new Date().toISOString(),
                    });
                }
            },
            cancel() {
                teardown();
            },
        });

        return c.newResponse(stream, 200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
        });
    };
}

/**
 * Observability HTTP surfaces (tasks 0243, 0245–0247).
 *
 * - GET /api/observability/processes — serve-rooted process inventory
 * - GET /api/observability/tool-use — token-ledger tail (+ cursor `before`)
 * - GET /api/observability/tool-use/stream — SSE live appends (fs.watch)
 */
export const observabilityModule: ServerModule = {
    name: 'observability',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        app.get('/api/observability/processes', handleProcesses(ctx));
        app.get('/api/observability/tool-use', handleToolUseGet(ctx));
        app.get('/api/observability/tool-use/stream', handleToolUseStream(ctx));
    },
};
