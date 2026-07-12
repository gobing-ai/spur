/**
 * Shared SSE stream helpers used by team live-tail and events planning streams.
 * One keepalive implementation so the two modules cannot drift (task 0241 R8).
 */

/** SSE heartbeat — enqueues a keepalive comment unless the stream is already closed. */
export function sendSseKeepalive(
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

/** Enqueue a framed SSE `data:` payload; returns false when the controller is closed. */
export function enqueueSseFrame(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    frame: unknown,
): boolean {
    if (closed.current) return false;
    try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        return true;
    } catch {
        return false;
    }
}
