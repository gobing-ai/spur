import type { PlanningEventName } from '@gobing-ai/spur-app';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

/**
 * Events module — mounts the SSE `/api/events/planning` stream on the Hono app.
 *
 * The stream is gated by ServerContext availability:
 * - Bun runtime (local dev/production): ServerContext is available → SSE active.
 * - Cloudflare Worker: ServerContext is undefined → module is a no-op,
 *   and the board falls back to 5s polling (R4 invariant).
 *
 * Design §5, ADR-019 runtime split.
 */
export const eventsModule: ServerModule = {
    name: 'events',

    mount(app: Hono, ctx: ServerContext | undefined): void {
        if (!ctx) return;

        app.get('/api/events/planning', (c) => {
            const bus: EventBus<Record<PlanningEventName, (event: unknown) => void>> = ctx.eventBus();

            let closed = false;
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
            const handlers = new Map<PlanningEventName, (event: unknown) => void>();

            const stream = new ReadableStream({
                start(controller) {
                    const encoder = new TextEncoder();

                    // Heartbeat keepalive every 15s
                    heartbeatInterval = setInterval(() => {
                        if (closed) return;
                        try {
                            controller.enqueue(encoder.encode(': keepalive\n\n'));
                        } catch {
                            // Controller already closed.
                        }
                    }, 15_000);

                    const eventNames: PlanningEventName[] = [
                        'task.created',
                        'task.updated',
                        'task.transitioned',
                        'feature.created',
                        'feature.updated',
                        'feature.transitioned',
                    ];

                    for (const name of eventNames) {
                        const handler = (event: unknown) => {
                            if (closed) return;
                            const envelope = {
                                eventName: name,
                                occurredAt: new Date().toISOString(),
                                actor: null,
                                payload: event as Record<string, unknown>,
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
                    closed = true;
                    if (heartbeatInterval) clearInterval(heartbeatInterval);
                    for (const [name, handler] of handlers) {
                        bus.off(name, handler);
                    }
                },
            });

            return c.newResponse(stream, 200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
        });
    },
};
