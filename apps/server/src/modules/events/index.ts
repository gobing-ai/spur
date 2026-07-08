import type { EventBus } from '@gobing-ai/ts-infra';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';
import {
    normalizeSystemEventPayload,
    SYSTEM_EVENT_CATALOG,
    SYSTEM_EVENT_CATALOG_METADATA,
    SYSTEM_EVENT_STREAMED_NAMES,
    systemEventCatalogEntry,
} from './event-names';

/**
 * Extract the `actor` field from a system event payload. Mirrors the shared
 * helper in `packages/app/src/services/system-event-tap.ts` so the SSE envelope
 * and the persistence tap agree on actor extraction (task 0226 F5). Inlined
 * here — not imported from `@gobing-ai/spur-app` — to keep the Cloudflare
 * Worker bundle free of the heavy `spur-app` runtime dependency.
 */
function extractSystemEventActor(event: unknown): string | null {
    if (event && typeof event === 'object') {
        const candidate = (event as Record<string, unknown>).actor;
        if (typeof candidate === 'string') return candidate;
    }
    return null;
}

/** SSE heartbeat keepalive — enqueues a comment frame unless the stream is closed. */
export function sendKeepalive(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
): void {
    if (closed.current) return;
    try {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
    } catch {
        // Controller already closed.
    }
}

/**
 * Server module that mounts the SSE `/api/events/planning` stream.
 *
 * Gated by ServerContext: on Bun the stream is active; on Cloudflare Workers
 * (ctx undefined) the module is a no-op and the board falls back to polling.
 */
export const eventsModule: ServerModule = {
    name: 'events',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        // Build the SSE stream name list once per server boot, honoring the
        // diagnostic tier toggle from bootConfig (R5). `STREAMED_NAMES` alone
        // only covers `default`; diagnostic entries are appended when enabled.
        // Defensive: tests and CF Workers may pass a partial `ctx` cast
        // without `bootConfig`; fall back to "diagnostic disabled" when absent.
        const baseNames: readonly string[] = SYSTEM_EVENT_STREAMED_NAMES;
        const diagnosticEnabled =
            typeof (ctx as { bootConfig?: () => unknown }).bootConfig === 'function' &&
            (ctx as unknown as { bootConfig: () => { events: { diagnostic: boolean } } }).bootConfig().events
                .diagnostic === true;
        const diagnosticNames = diagnosticEnabled
            ? SYSTEM_EVENT_CATALOG.filter((entry) => entry.tier === 'diagnostic' && entry.streamed).map(
                  (entry) => entry.name,
              )
            : [];
        const streamNames = [...baseNames, ...diagnosticNames];
        app.get('/api/events/planning', (c) => {
            const bus: EventBus<Record<string, (event: unknown) => void>> = ctx.eventBus();
            const closed = { current: false };
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
            const handlers = new Map<string, (event: unknown) => void>();
            // Fires when the client disconnects (tab close, navigation, EventSource recycle).
            const signal = c.req.raw.signal;

            // Idempotent teardown shared by every exit path (client abort, consumer cancel).
            // Detaches bus subscriptions, stops the heartbeat, and removes the abort listener.
            // `closeController` is wired in start() since the controller only exists there.
            let closeController: () => void = () => {};
            const teardown = () => {
                if (closed.current) return;
                closed.current = true;
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                for (const [name, handler] of handlers) {
                    bus.off(name, handler);
                }
                signal.removeEventListener('abort', teardown);
                closeController();
            };

            const stream = new ReadableStream({
                start(controller) {
                    const encoder = new TextEncoder();

                    // Close the stream cleanly so the chunked response is terminated properly —
                    // this is what fixes ERR_INCOMPLETE_CHUNKED_ENCODING when the client goes away.
                    closeController = () => {
                        try {
                            controller.close();
                        } catch {
                            // Already closed.
                        }
                    };

                    // Client already gone before we started — tear down immediately.
                    if (signal.aborted) {
                        teardown();
                        return;
                    }
                    signal.addEventListener('abort', teardown);

                    heartbeatInterval = setInterval(sendKeepalive, 15_000, closed, controller, encoder);
                    for (const name of streamNames) {
                        const handler = (event: unknown) => {
                            if (closed.current) return;
                            const entry = systemEventCatalogEntry(name);
                            // task 0226 F5: share the actor extractor with the
                            // persistence tap so the live SSE envelope matches
                            // the persisted history row.
                            const envelope = {
                                eventName: name,
                                occurredAt: new Date().toISOString(),
                                actor: extractSystemEventActor(event),
                                prefix: entry?.prefix ?? name.split('.')[0],
                                renderer: entry?.renderer ?? 'generic',
                                payload: entry ? normalizeSystemEventPayload(entry, event) : null,
                            };
                            try {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
                            } catch {
                                // Controller closed.
                            }
                        };
                        handlers.set(name, handler);
                        bus.on(name, handler);
                    }

                    // Send initial connected event
                    controller.enqueue(
                        encoder.encode(
                            `data: ${JSON.stringify({ eventName: 'connected', occurredAt: new Date().toISOString(), actor: null, payload: {} })}\n\n`,
                        ),
                    );
                },

                cancel() {
                    // Consumer-initiated cancel (e.g. reader.cancel()). The controller is already
                    // closing, so teardown only needs to detach subscriptions and the heartbeat.
                    closeController = () => {};
                    teardown();
                },
            });

            // No explicit `Connection` header — it is a hop-by-hop header the runtime
            // controls; setting it on a Bun chunked stream interferes with clean
            // finalization and surfaces as ERR_INCOMPLETE_CHUNKED_ENCODING on reconnect.
            return c.newResponse(stream, 200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
            });
        });

        // GET /api/events/history — recent system_events ledger rows (newest-first).
        // Query params: ?name=<event name> &since=<ISO timestamp> &limit=<int, default 100, max 500>.
        app.get('/api/events/history', async (c) => {
            const nameParam = c.req.query('name');
            const sinceParam = c.req.query('since');
            const limitParam = c.req.query('limit');
            let limit = 100;
            if (limitParam !== undefined) {
                const parsed = Number.parseInt(limitParam, 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    limit = Math.min(parsed, 500);
                }
            }
            const dao = await ctx.systemEventDao();
            const rows = await dao.query({
                name: nameParam || undefined,
                since: sinceParam || undefined,
                limit,
            });
            const events = rows.map((row) => ({
                id: row.id,
                eventName: row.event_name,
                occurredAt: row.occurred_at,
                actor: row.actor,
                prefix: systemEventCatalogEntry(row.event_name)?.prefix ?? row.event_name.split('.')[0],
                renderer: systemEventCatalogEntry(row.event_name)?.renderer ?? 'generic',
                payload: row.payload_json ? JSON.parse(row.payload_json) : null,
            }));
            return c.json({ events, count: events.length, catalog: SYSTEM_EVENT_CATALOG_METADATA });
        });
    },
};
