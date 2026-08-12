import { describe, expect, test } from 'bun:test';
import type { SystemEventQuery, SystemEventRow } from '@gobing-ai/spur-domain';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import {
    decodeHistoryCursor,
    encodeHistoryCursor,
    eventsModule,
    parseHistoryNamesParam,
} from '../../../src/modules/events';

/** Build a stub ServerContext whose systemEventDao returns the given rows. */
function ctxWithRows(rows: SystemEventRow[]): ServerContext {
    return {
        cwd: '/workspace/acme',
        systemEventProjectContext: () => ({ name: 'acme', root: '/workspace/acme' }),
        systemEventSecretValues: () => [],
        systemEventDao: async () => ({
            query: async () => rows,
        }),
    } as unknown as ServerContext;
}

/** Stub that captures the DAO query and returns a fixed page. */
function ctxCapturingQuery(
    onQuery: (spec: SystemEventQuery) => SystemEventRow[] | Promise<SystemEventRow[]>,
): ServerContext {
    return {
        cwd: '/workspace/acme',
        systemEventProjectContext: () => ({ name: 'acme', root: '/workspace/acme' }),
        systemEventSecretValues: () => [],
        systemEventDao: async () => ({
            query: async (spec: SystemEventQuery) => onQuery(spec),
        }),
    } as unknown as ServerContext;
}

describe('history cursor helpers', () => {
    test('encode/decode round-trips id and occurredAt', () => {
        const encoded = encodeHistoryCursor('sev-1', '2026-07-04T10:00:00.000Z');
        const decoded = decodeHistoryCursor(encoded);
        expect(decoded).toEqual({
            ok: true,
            value: { id: 'sev-1', occurredAt: '2026-07-04T10:00:00.000Z' },
        });
    });

    test('decode rejects garbage base64, non-JSON, and incomplete payloads', () => {
        expect(decodeHistoryCursor('!!!not-b64!!!').ok).toBe(false);
        expect(decodeHistoryCursor(btoa('not-json')).ok).toBe(false);
        expect(decodeHistoryCursor(btoa(JSON.stringify({ id: 'x' }))).ok).toBe(false);
        expect(decodeHistoryCursor(btoa(JSON.stringify({ occurredAt: '2026-01-01T00:00:00.000Z' }))).ok).toBe(false);
        expect(decodeHistoryCursor(btoa(JSON.stringify({ id: 'x', occurredAt: 'not-a-date' }))).ok).toBe(false);
    });

    test('decode rejects empty, oversized, and non-object JSON payloads (R3)', () => {
        expect(decodeHistoryCursor('')).toEqual({
            ok: false,
            reason: 'malformed cursor: empty or exceeds maximum length',
        });
        expect(decodeHistoryCursor('a'.repeat(1025))).toEqual({
            ok: false,
            reason: 'malformed cursor: empty or exceeds maximum length',
        });
        // Valid base64 of a non-object JSON value must not fall through as page 1.
        expect(decodeHistoryCursor(btoa('null')).ok).toBe(false);
        expect(decodeHistoryCursor(btoa('42')).ok).toBe(false);
        expect(decodeHistoryCursor(btoa('"string"')).ok).toBe(false);
    });

    test('parseHistoryNamesParam accepts comma-separated and repeated values', () => {
        expect(parseHistoryNamesParam('a,b')).toEqual(['a', 'b']);
        expect(parseHistoryNamesParam(['a', 'b,c'])).toEqual(['a', 'b', 'c']);
        expect(parseHistoryNamesParam('')).toBeUndefined();
        expect(parseHistoryNamesParam(undefined)).toBeUndefined();
    });
});

describe('GET /api/events/history', () => {
    test('returns events newest-first with parsed payload', async () => {
        const rows: SystemEventRow[] = [
            {
                id: 'sev-2',
                event_name: 'task.updated',
                occurred_at: '2026-07-04T10:00:01.000Z',
                actor: 'operator',
                payload_json: '{"field":"status"}',
                run_id: null,
                entity_kind: 'task',
                entity_id: '0369',
                sequence: null,
            },
            {
                id: 'sev-1',
                event_name: 'task.created',
                occurred_at: '2026-07-04T10:00:00.000Z',
                actor: null,
                payload_json: null,
                run_id: null,
                entity_kind: null,
                entity_id: null,
                sequence: null,
            },
        ];
        const app = new Hono();
        eventsModule.mount(app, ctxWithRows(rows));

        const res = await app.fetch(new Request('http://localhost/api/events/history'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            count: number;
            events: Array<Record<string, unknown>>;
            catalog: Array<Record<string, unknown>>;
            nextCursor: string | null;
            hasMore: boolean;
        };
        expect(body.count).toBe(2);
        expect(body.hasMore).toBe(false);
        expect(body.nextCursor).toBeNull();
        expect(body.events[0]).toEqual({
            id: 'sev-2',
            eventName: 'task.updated',
            occurredAt: '2026-07-04T10:00:01.000Z',
            actor: 'operator',
            prefix: 'task',
            renderer: 'planning',
            payload: expect.objectContaining({
                schemaVersion: 2,
                data: { field: 'status' },
                context: expect.objectContaining({
                    producer: { package: 'spur', subsystem: 'planning' },
                }),
            }),
            runId: null,
            entityKind: 'task',
            entityId: '0369',
            sequence: null,
        });
        expect(body.events[1]?.payload).toEqual(expect.objectContaining({ schemaVersion: 2, data: null }));
        const firstPayload = body.events[0]?.payload as Record<string, unknown>;
        const firstContext = firstPayload.context as Record<string, unknown>;
        expect(firstContext.project).toEqual({ name: 'acme', root: '/workspace/acme' });
        expect(body.catalog.some((entry) => entry.name === 'task.updated' && entry.prefix === 'task')).toBe(true);
    });

    test('returns empty array when ledger is empty', async () => {
        const app = new Hono();
        eventsModule.mount(app, ctxWithRows([]));

        const res = await app.fetch(new Request('http://localhost/api/events/history'));
        const body = (await res.json()) as { count: number; events: unknown[]; hasMore: boolean };
        expect(body.count).toBe(0);
        expect(body.events).toEqual([]);
        expect(body.hasMore).toBe(false);
    });

    test('default limit is 100, clamped to max 500 (DAO sees limit+1 for hasMore)', async () => {
        let captured: SystemEventQuery = {};
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery((spec) => {
                captured = spec;
                return [];
            }),
        );

        // No limit → default 100 → DAO asked for 101
        await app.fetch(new Request('http://localhost/api/events/history'));
        expect(captured.limit).toBe(101);

        // limit=999 → clamped to 500 → DAO asked for 501
        await app.fetch(new Request('http://localhost/api/events/history?limit=999'));
        expect(captured.limit).toBe(501);

        // limit=abc → ignored, falls back to default
        await app.fetch(new Request('http://localhost/api/events/history?limit=abc'));
        expect(captured.limit).toBe(101);
    });

    test('forwards name and since query params to the DAO', async () => {
        let captured: SystemEventQuery = {};
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery((spec) => {
                captured = spec;
                return [];
            }),
        );

        await app.fetch(
            new Request(
                'http://localhost/api/events/history?name=task.created&since=2026-07-04T00:00:00.000Z&limit=50',
            ),
        );
        expect(captured.name).toBe('task.created');
        expect(captured.since).toBe('2026-07-04T00:00:00.000Z');
        expect(captured.limit).toBe(51);
    });

    test('forwards prefix, names, runId, and actor filters to the DAO (R18/R19)', async () => {
        let captured: SystemEventQuery = {};
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery((spec) => {
                captured = spec;
                return [];
            }),
        );

        await app.fetch(
            new Request(
                'http://localhost/api/events/history?prefix=task&names=task.created,task.updated&runId=run_abc&actor=operator',
            ),
        );
        expect(captured.prefix).toBe('task');
        expect(captured.names).toEqual(['task.created', 'task.updated']);
        expect(captured.run_id).toBe('run_abc');
        expect(captured.actor).toBe('operator');
    });

    test('rejects an uncataloged prefix with 400 and a reason (R21)', async () => {
        let queried = false;
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery(() => {
                queried = true;
                return [];
            }),
        );

        const res = await app.fetch(new Request('http://localhost/api/events/history?prefix=not-a-family'));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.code).toBe('UNKNOWN_PREFIX');
        expect(body.error).toContain('not-a-family');
        // Must not fall back to an unfiltered query.
        expect(queried).toBe(false);
    });

    test('rejects a malformed cursor with 400 and a reason (R21)', async () => {
        let queried = false;
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery(() => {
                queried = true;
                return [];
            }),
        );

        const res = await app.fetch(new Request('http://localhost/api/events/history?cursor=not-valid'));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string; code: string };
        expect(body.code).toBe('MALFORMED_CURSOR');
        expect(body.error.length).toBeGreaterThan(0);
        expect(queried).toBe(false);
    });

    test('decodes a valid cursor into the DAO before keyset (R20)', async () => {
        let captured: SystemEventQuery = {};
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery((spec) => {
                captured = spec;
                return [];
            }),
        );

        const cursor = encodeHistoryCursor('sev-last', '2026-07-04T09:00:00.000Z');
        await app.fetch(new Request(`http://localhost/api/events/history?cursor=${encodeURIComponent(cursor)}`));
        expect(captured.before).toEqual({
            occurred_at: '2026-07-04T09:00:00.000Z',
            id: 'sev-last',
        });
    });

    test('sets nextCursor and hasMore when more rows exist than the limit (R20)', async () => {
        // Stub returns limit+1 rows so the endpoint can detect hasMore.
        const makeRow = (i: number): SystemEventRow => ({
            id: `sev-${i}`,
            event_name: 'task.updated',
            occurred_at: `2026-07-04T10:00:${String(i).padStart(2, '0')}.000Z`,
            actor: null,
            payload_json: null,
            run_id: null,
            entity_kind: null,
            entity_id: null,
            sequence: null,
        });
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery((spec) => {
                const n = spec.limit ?? 0;
                return Array.from({ length: n }, (_, i) => makeRow(n - i));
            }),
        );

        const res = await app.fetch(new Request('http://localhost/api/events/history?limit=2'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            count: number;
            events: Array<{ id: string; occurredAt: string }>;
            nextCursor: string | null;
            hasMore: boolean;
        };
        expect(body.count).toBe(2);
        expect(body.hasMore).toBe(true);
        expect(body.nextCursor).not.toBeNull();
        const decoded = decodeHistoryCursor(body.nextCursor as string);
        expect(decoded.ok).toBe(true);
        if (decoded.ok) {
            // nextCursor anchors on the last *returned* row (page end), not the extra probe row.
            const last = body.events[1];
            expect(last).toBeDefined();
            if (!last) throw new Error('expected second event in page');
            expect(decoded.value.id).toBe(last.id);
            expect(decoded.value.occurredAt).toBe(last.occurredAt);
        }
    });

    test('surfaces run correlation additively — existing fields keep their shape', async () => {
        const rows: SystemEventRow[] = [
            {
                id: 'sev-3',
                event_name: 'workflow.phase',
                occurred_at: '2026-07-04T10:00:02.000Z',
                actor: null,
                payload_json: '{"phase":"implement"}',
                run_id: 'run_abc',
                entity_kind: null,
                entity_id: null,
                sequence: 7,
            },
        ];
        const app = new Hono();
        eventsModule.mount(app, ctxWithRows(rows));

        const res = await app.fetch(new Request('http://localhost/api/events/history'));
        const body = (await res.json()) as { events: Array<Record<string, unknown>> };
        const event = body.events[0];
        expect(event?.runId).toBe('run_abc');
        expect(event?.sequence).toBe(7);
        // R6: no existing consumer field is renamed, dropped, or re-typed.
        expect(event?.id).toBe('sev-3');
        expect(event?.eventName).toBe('workflow.phase');
        expect(event?.occurredAt).toBe('2026-07-04T10:00:02.000Z');
        expect(event?.prefix).toBe('workflow');
        expect(event?.payload).toEqual(expect.objectContaining({ schemaVersion: 2, data: { phase: 'implement' } }));
    });

    test('pre-migration rows project the correlation fields as null', async () => {
        // R4/R6: a row written before 0008 has nulls in every correlation
        // column and must still render, not be filtered out or 500.
        const rows: SystemEventRow[] = [
            {
                id: 'sev-legacy',
                event_name: 'task.created',
                occurred_at: '2026-07-04T09:00:00.000Z',
                actor: null,
                payload_json: null,
                run_id: null,
                entity_kind: null,
                entity_id: null,
                sequence: null,
            },
        ];
        const app = new Hono();
        eventsModule.mount(app, ctxWithRows(rows));

        const res = await app.fetch(new Request('http://localhost/api/events/history'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { count: number; events: Array<Record<string, unknown>> };
        expect(body.count).toBe(1);
        expect(body.events[0]?.runId).toBeNull();
        expect(body.events[0]?.entityKind).toBeNull();
        expect(body.events[0]?.entityId).toBeNull();
        expect(body.events[0]?.sequence).toBeNull();
    });

    test('malformed unknown legacy payload projects a bounded generic envelope instead of failing history', async () => {
        const rows: SystemEventRow[] = [
            {
                id: 'sev-malformed',
                event_name: 'future.unknown',
                occurred_at: '2026-07-04T09:00:00.000Z',
                actor: null,
                payload_json: '{not-json',
                run_id: null,
                entity_kind: null,
                entity_id: null,
                sequence: null,
            },
        ];
        const app = new Hono();
        eventsModule.mount(app, ctxWithRows(rows));

        const res = await app.fetch(new Request('http://localhost/api/events/history'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { events: Array<{ payload: Record<string, unknown> }> };
        expect(body.events[0]?.payload).toEqual(
            expect.objectContaining({
                schemaVersion: 2,
                data: null,
                presentation: expect.objectContaining({ summary: 'Unknown system event' }),
            }),
        );
    });

    test('empty name string is treated as undefined (no filter)', async () => {
        let captured: SystemEventQuery = {};
        const app = new Hono();
        eventsModule.mount(
            app,
            ctxCapturingQuery((spec) => {
                captured = spec;
                return [];
            }),
        );

        await app.fetch(new Request('http://localhost/api/events/history?name='));
        expect(captured.name).toBeUndefined();
    });
});
