import type { ToolUseEvent } from '@gobing-ai/spur-app';
import type { ObservabilitySummaryResponse } from '@gobing-ai/spur-contracts';
import { queueJobKpis, type RoutingSummaryQuery, roleTokenSummary } from '@gobing-ai/spur-domain';
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
 * Routing + token aggregates for the Board (task 0552).
 *
 * Composes the two J6 queries — `SystemEventDao.routingSummary` (0546) and
 * `roleTokenSummary` (0547) — with no query of its own. `since`/`until` are
 * forwarded as-is; the domain surfaces apply their own bounded defaults, so
 * the route holds no window logic to drift.
 *
 * ADR-005 §4 type seam (mirrors `setFetchForTesting` in the web rpc-client):
 * the indirection lets the module tests stub the domain fold instead of
 * running it against a scratch DB — the fold itself is already covered by the
 * domain package's suite.
 */
let loadRoleTokenSummary: typeof roleTokenSummary = roleTokenSummary;

/** Test seam: replace the role-token fold (ADR-005 §4). */
export function setRoleTokenSummaryForTesting(fn: typeof roleTokenSummary): void {
    loadRoleTokenSummary = fn;
}

/** Resets the seam to the production domain surface. */
export function resetRoleTokenSummaryForTesting(): void {
    loadRoleTokenSummary = roleTokenSummary;
}

function handleRoutingSummary(ctx: ServerContext) {
    return async (c: Context) => {
        try {
            const since = c.req.query('since') ?? undefined;
            const until = c.req.query('until') ?? undefined;
            const spec: RoutingSummaryQuery = { since, until };
            const dao = await ctx.systemEventDao();
            const db = await ctx.getDb();
            const [routing, tokens] = await Promise.all([dao.routingSummary(spec), loadRoleTokenSummary(db, spec)]);
            return c.json({ routing, tokens });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

function handleObservabilitySummary(ctx: ServerContext) {
    return async (c: Context) => {
        try {
            const sinceParam = c.req.query('since');
            const untilParam = c.req.query('until');
            const bucketParam = c.req.query('bucket');

            let untilMs = Date.now();
            if (untilParam !== undefined && untilParam !== '') {
                untilMs = Date.parse(untilParam);
                if (Number.isNaN(untilMs)) {
                    return c.json(
                        {
                            error: `malformed until: "${untilParam}" is not a valid ISO timestamp`,
                            code: 'MALFORMED_TIMESTAMP',
                        },
                        400,
                    );
                }
            }

            let sinceMs = untilMs - 4 * 60 * 60_000;
            if (sinceParam !== undefined && sinceParam !== '') {
                sinceMs = Date.parse(sinceParam);
                if (Number.isNaN(sinceMs)) {
                    return c.json(
                        {
                            error: `malformed since: "${sinceParam}" is not a valid ISO timestamp`,
                            code: 'MALFORMED_TIMESTAMP',
                        },
                        400,
                    );
                }
            }

            if (untilMs < sinceMs) {
                return c.json(
                    {
                        error: 'until timestamp must not precede since timestamp',
                        code: 'MALFORMED_RANGE',
                    },
                    400,
                );
            }

            let bucketMs: number | undefined;
            if (bucketParam !== undefined && bucketParam !== '') {
                const parsed = Number(bucketParam);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    bucketMs = parsed;
                }
            }

            const since = new Date(sinceMs).toISOString();
            const until = new Date(untilMs).toISOString();

            const dao = await ctx.systemEventDao();
            const db = await ctx.getDb();

            const [eventSummary, jobKpis] = await Promise.all([
                dao.eventSummary({ since, until, bucketMs }),
                queueJobKpis(db, sinceMs, untilMs),
            ]);

            const combinedErrors = [
                ...eventSummary.recentErrors.map((e) => ({
                    id: e.id,
                    source: 'event' as const,
                    name: e.name,
                    occurredAt: e.occurredAt,
                    message: e.message,
                    ...(e.refId ? { refId: e.refId } : {}),
                })),
                ...jobKpis.recentJobErrors.map((j) => ({
                    id: j.id,
                    source: 'job' as const,
                    name: j.name,
                    occurredAt: j.occurredAt,
                    message: j.message,
                })),
            ]
                .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
                .slice(0, 10);

            const payload: ObservabilitySummaryResponse = {
                window: {
                    since,
                    until,
                    range: c.req.query('range') ?? 'custom',
                },
                kpis: {
                    totalEvents: eventSummary.totalEvents,
                    activeJobs: jobKpis.activeJobs,
                    completedJobs: jobKpis.completedJobs,
                    failedJobs: jobKpis.failedJobs,
                    successRatePct: jobKpis.successRatePct,
                    errorEventCount: eventSummary.errorEventCount,
                    warningEventCount: eventSummary.warningEventCount,
                },
                eventVolumeBuckets: eventSummary.eventVolumeBuckets,
                topEventTypes: eventSummary.topEventTypes,
                recentErrors: combinedErrors,
            };

            return c.json(payload);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.json({ error: message }, 500);
        }
    };
}

/**
 * Observability HTTP surfaces (tasks 0243, 0245–0247, 0552, 0789).
 *
 * - GET /api/observability/processes — serve-rooted process inventory
 * - GET /api/observability/tool-use — token-ledger tail (+ cursor `before`)
 * - GET /api/observability/tool-use/stream — SSE live appends (fs.watch)
 * - GET /api/observability/routing-summary — routing aggregate + per-role token totals (0552)
 * - GET /api/observability/summary — summary aggregations, KPIs, volume buckets (0789)
 */
export const observabilityModule: ServerModule = {
    name: 'observability',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        app.get('/api/observability/processes', handleProcesses(ctx));
        app.get('/api/observability/tool-use', handleToolUseGet(ctx));
        app.get('/api/observability/tool-use/stream', handleToolUseStream(ctx));
        app.get('/api/observability/routing-summary', handleRoutingSummary(ctx));
        app.get('/api/observability/summary', handleObservabilitySummary(ctx));
    },
};
