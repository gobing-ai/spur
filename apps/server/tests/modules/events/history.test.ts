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
            },
            {
                id: 'sev-1',
                event_name: 'task.created',
                occurred_at: '2026-07-04T10:00:00.000Z',
                actor: null,
                payload_json: null,
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
