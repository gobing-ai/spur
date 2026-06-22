import type { PlanningEventName } from '@gobing-ai/spur-app';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import type { ServerModule } from '../types';

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

        app.get('/api/events/planning', (c) => {
            const bus: EventBus<Record<PlanningEventName, (event: unknown) => void>> = ctx.eventBus();
            const closed = { current: false };
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
            const handlers = new Map<PlanningEventName, (event: unknown) => void>();

            const stream = new ReadableStream({
                start(controller) {
                    const encoder = new TextEncoder();

                    heartbeatInterval = setInterval(sendKeepalive, 15_000, closed, controller, encoder);

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
                            if (closed.current) return;
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
                    closed.current = true;
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
