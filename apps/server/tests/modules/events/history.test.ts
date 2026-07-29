import { describe, expect, test } from 'bun:test';
import type { SystemEventRow } from '@gobing-ai/spur-domain';
import { Hono } from 'hono';
import type { ServerContext } from '../../../src/context';
import { eventsModule } from '../../../src/modules/events';

/** Build a stub ServerContext whose systemEventDao returns the given rows. */
function ctxWithRows(rows: SystemEventRow[]): ServerContext {
    return {
        systemEventDao: async () => ({
            query: async () => rows,
        }),
    } as unknown as ServerContext;
}

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
        };
        expect(body.count).toBe(2);
        expect(body.events[0]).toEqual({
            id: 'sev-2',
            eventName: 'task.updated',
            occurredAt: '2026-07-04T10:00:01.000Z',
            actor: 'operator',
            prefix: 'task',
            renderer: 'planning',
            payload: { field: 'status' },
            runId: null,
            entityKind: 'task',
            entityId: '0369',
            sequence: null,
        });
        expect(body.events[1]?.payload).toBeNull();
        expect(body.catalog.some((entry) => entry.name === 'task.updated' && entry.prefix === 'task')).toBe(true);
    });

    test('returns empty array when ledger is empty', async () => {
        const app = new Hono();
        eventsModule.mount(app, ctxWithRows([]));

        const res = await app.fetch(new Request('http://localhost/api/events/history'));
        const body = (await res.json()) as { count: number; events: unknown[] };
        expect(body.count).toBe(0);
        expect(body.events).toEqual([]);
    });

    test('default limit is 100, clamped to max 500', async () => {
        let captured: { name?: string; since?: string; limit?: number } = {};
        const ctx = {
            systemEventDao: async () => ({
                query: async (spec: { name?: string; since?: string; limit?: number }) => {
                    captured = spec;
                    return [];
                },
            }),
        } as unknown as ServerContext;
        const app = new Hono();
        eventsModule.mount(app, ctx);

        // No limit → default 100
        await app.fetch(new Request('http://localhost/api/events/history'));
        expect(captured.limit).toBe(100);

        // limit=999 → clamped to 500
        await app.fetch(new Request('http://localhost/api/events/history?limit=999'));
        expect(captured.limit).toBe(500);

        // limit=abc → ignored, falls back to default
        await app.fetch(new Request('http://localhost/api/events/history?limit=abc'));
        expect(captured.limit).toBe(100);
    });

    test('forwards name and since query params to the DAO', async () => {
        let captured: { name?: string; since?: string; limit?: number } = {};
        const ctx = {
            systemEventDao: async () => ({
                query: async (spec: { name?: string; since?: string; limit?: number }) => {
                    captured = spec;
                    return [];
                },
            }),
        } as unknown as ServerContext;
        const app = new Hono();
        eventsModule.mount(app, ctx);

        await app.fetch(
            new Request(
                'http://localhost/api/events/history?name=task.created&since=2026-07-04T00:00:00.000Z&limit=50',
            ),
        );
        expect(captured.name).toBe('task.created');
        expect(captured.since).toBe('2026-07-04T00:00:00.000Z');
        expect(captured.limit).toBe(50);
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
        expect(event?.payload).toEqual({ phase: 'implement' });
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

    test('empty name string is treated as undefined (no filter)', async () => {
        let captured: { name?: string; since?: string; limit?: number } = {};
        const ctx = {
            systemEventDao: async () => ({
                query: async (spec: { name?: string; since?: string; limit?: number }) => {
                    captured = spec;
                    return [];
                },
            }),
        } as unknown as ServerContext;
        const app = new Hono();
        eventsModule.mount(app, ctx);

        await app.fetch(new Request('http://localhost/api/events/history?name='));
        expect(captured.name).toBeUndefined();
    });
});
