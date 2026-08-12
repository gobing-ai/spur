import type { SystemEventQuery } from '@gobing-ai/spur-domain';
import type { EventBus } from '@gobing-ai/ts-infra';
import type { Hono } from 'hono';
import type { ServerContext } from '../../context';
import { sendSseKeepalive } from '../sse/stream-helpers';
import type { ServerModule } from '../types';
import {
    buildSystemEventEnvelope,
    projectStoredSystemEventEnvelope,
    SYSTEM_EVENT_CATALOG,
    SYSTEM_EVENT_CATALOG_METADATA,
    SYSTEM_EVENT_PREFIXES,
    SYSTEM_EVENT_STREAMED_NAMES,
    systemEventCatalogEntry,
    systemEventProjectContext,
} from './event-names';

/**
 * Opaque history-page cursor payload (task 0372). Encoded as base64url JSON so
 * the client treats it as opaque; the server alone knows the keyset fields.
 */
interface HistoryCursorPayload {
    id: string;
    occurredAt: string;
}

/** Default and ceiling for GET /api/events/history `limit` (unchanged from v1). */
const HISTORY_LIMIT_DEFAULT = 100;
const HISTORY_LIMIT_MAX = 500;

/** Encode a keyset cursor from the last returned row. */
export function encodeHistoryCursor(id: string, occurredAt: string): string {
    const payload: HistoryCursorPayload = { id, occurredAt };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Decode and validate a history cursor. Returns `{ ok: false, reason }` on any
 * malformation — callers must 400, never fall back to an unfiltered page (R3).
 */
export function decodeHistoryCursor(
    encoded: string,
): { ok: true; value: HistoryCursorPayload } | { ok: false; reason: string } {
    if (encoded.length === 0 || encoded.length > 1024) {
        return { ok: false, reason: 'malformed cursor: empty or exceeds maximum length' };
    }
    let json: string;
    try {
        const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
        const binary = atob(base64);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        json = new TextDecoder().decode(bytes);
    } catch {
        return { ok: false, reason: 'malformed cursor: not valid base64url' };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return { ok: false, reason: 'malformed cursor: payload is not JSON' };
    }
    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, reason: 'malformed cursor: payload must be an object' };
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
        return { ok: false, reason: 'malformed cursor: missing or invalid id' };
    }
    if (typeof obj.occurredAt !== 'string' || obj.occurredAt.length === 0) {
        return { ok: false, reason: 'malformed cursor: missing or invalid occurredAt' };
    }
    // Reject non-ISO timestamps so a garbage cursor cannot silently widen the page.
    if (Number.isNaN(Date.parse(obj.occurredAt))) {
        return { ok: false, reason: 'malformed cursor: occurredAt is not a valid timestamp' };
    }
    return { ok: true, value: { id: obj.id, occurredAt: obj.occurredAt } };
}

/**
 * Parse the multi-value `names` query param. Accepts repeated keys
 * (`?names=a&names=b`) and comma-separated values (`?names=a,b`).
 */
export function parseHistoryNamesParam(raw: string | string[] | undefined): string[] | undefined {
    if (raw === undefined) return undefined;
    const parts = (Array.isArray(raw) ? raw : [raw])
        .flatMap((chunk) => chunk.split(','))
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return parts.length > 0 ? parts : undefined;
}

/**
 * Extract the actor for SSE envelopes. Mirrors `packages/app` system-event-tap
 * (task 0226 F5 + 0269 agentId fallback + 0371 memberId). Inlined — not
 * imported from `@gobing-ai/spur-app` — to keep the Cloudflare Worker bundle
 * free of the heavy spur-app runtime dependency.
 */
function extractSystemEventActor(event: unknown): string | null {
    if (event && typeof event === 'object') {
        const obj = event as Record<string, unknown>;
        if (typeof obj.actor === 'string' && obj.actor.length > 0) return obj.actor;
        if (typeof obj.agentId === 'string' && obj.agentId.length > 0) return obj.agentId;
        if (typeof obj.memberId === 'string' && obj.memberId.length > 0) return obj.memberId;
    }
    return null;
}

/** Events SSE keepalive — delegates to the shared SSE helper (task 0241 R8). */
export function sendKeepalive(
    closed: { current: boolean },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
): void {
    sendSseKeepalive(closed, controller, encoder);
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

        const projectContext =
            typeof (ctx as Partial<ServerContext>).systemEventProjectContext === 'function'
                ? ctx.systemEventProjectContext()
                : systemEventProjectContext(ctx.cwd ?? '');
        const secretValues =
            typeof (ctx as Partial<ServerContext>).systemEventSecretValues === 'function'
                ? ctx.systemEventSecretValues()
                : [];

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
                                payload: buildSystemEventEnvelope(entry, event, projectContext, secretValues),
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
        // Query params (v1): name, since, limit (default 100, max 500).
        // Query params (task 0372): prefix, names, runId, actor, cursor.
        // Filters run in SQL; uncataloged prefix / malformed cursor → 400 (R3).
        app.get('/api/events/history', async (c) => {
            const nameParam = c.req.query('name');
            const sinceParam = c.req.query('since');
            const limitParam = c.req.query('limit');
            const prefixParam = c.req.query('prefix');
            const runIdParam = c.req.query('runId');
            const actorParam = c.req.query('actor');
            const cursorParam = c.req.query('cursor');
            // Hono returns the first value for query(); also accept repeated names=.
            const namesRaw = c.req.queries('names');
            const namesParam =
                namesRaw && namesRaw.length > 0
                    ? parseHistoryNamesParam(namesRaw)
                    : parseHistoryNamesParam(c.req.query('names'));

            let limit = HISTORY_LIMIT_DEFAULT;
            if (limitParam !== undefined) {
                const parsed = Number.parseInt(limitParam, 10);
                if (!Number.isNaN(parsed) && parsed > 0) {
                    limit = Math.min(parsed, HISTORY_LIMIT_MAX);
                }
            }

            // R3: reject uncataloged prefix — never silently drop the filter.
            if (prefixParam !== undefined && prefixParam.length > 0) {
                if (!SYSTEM_EVENT_PREFIXES.includes(prefixParam)) {
                    return c.json(
                        {
                            error: `unknown prefix: "${prefixParam}" is not a cataloged event family`,
                            code: 'UNKNOWN_PREFIX',
                        },
                        400,
                    );
                }
            }

            // R3: reject malformed cursor — never fall back to page 1 unfiltered.
            let before: SystemEventQuery['before'];
            if (cursorParam !== undefined && cursorParam.length > 0) {
                const decoded = decodeHistoryCursor(cursorParam);
                if (!decoded.ok) {
                    return c.json({ error: decoded.reason, code: 'MALFORMED_CURSOR' }, 400);
                }
                before = { occurred_at: decoded.value.occurredAt, id: decoded.value.id };
            }

            const query: SystemEventQuery = {
                name: nameParam || undefined,
                names: namesParam,
                prefix: prefixParam || undefined,
                since: sinceParam || undefined,
                run_id: runIdParam || undefined,
                actor: actorParam || undefined,
                before,
                // Fetch one extra row so we can set hasMore without a COUNT(*) (R2/R5).
                limit: limit + 1,
            };

            const dao = await ctx.systemEventDao();
            const rows = await dao.query(query);
            const hasMore = rows.length > limit;
            const page = hasMore ? rows.slice(0, limit) : rows;
            const last = page.at(-1);
            const nextCursor = hasMore && last ? encodeHistoryCursor(last.id, last.occurred_at) : null;

            const events = page.map((row) => ({
                id: row.id,
                eventName: row.event_name,
                occurredAt: row.occurred_at,
                actor: row.actor,
                prefix: systemEventCatalogEntry(row.event_name)?.prefix ?? row.event_name.split('.')[0],
                renderer: systemEventCatalogEntry(row.event_name)?.renderer ?? 'generic',
                payload: projectStoredSystemEventEnvelope(
                    systemEventCatalogEntry(row.event_name),
                    parseStoredPayload(row.payload_json),
                    projectContext,
                    secretValues,
                ),
                // Indexed correlation columns (task 0369). Purely additive: every
                // existing field keeps its name and meaning, and pre-migration
                // rows surface these as null rather than being dropped (R6).
                runId: row.run_id,
                entityKind: row.entity_kind,
                entityId: row.entity_id,
                sequence: row.sequence,
            }));
            // R4: preserve events/count/catalog; nextCursor/hasMore are additive.
            return c.json({
                events,
                count: events.length,
                catalog: SYSTEM_EVENT_CATALOG_METADATA,
                nextCursor,
                hasMore,
            });
        });
    },
};

/** Malformed legacy JSON is observability data, never an API-failing condition. */
function parseStoredPayload(payloadJson: string | null): unknown {
    if (payloadJson === null) return null;
    try {
        return JSON.parse(payloadJson);
    } catch {
        return null;
    }
}
