import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, PlanningEventDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { EventBus } from '@gobing-ai/ts-infra';
import { BusPlanningEventEmitter, type PlanningEventMap } from '../../src/services/planning-events';
import type { PlanningEvent } from '../../src/services/planning-write-service';

describe('BusPlanningEventEmitter', () => {
    test('emit persists event via DAO and publishes to bus', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);
        const bus = new EventBus<PlanningEventMap>();

        const received: PlanningEvent[] = [];
        bus.on('task.created', (event) => {
            received.push(event);
        });

        const emitter = new BusPlanningEventEmitter(bus, dao);

        const event: PlanningEvent = {
            event: 'task.created',
            entity: { kind: 'task', id: '0001' },
            at: '2026-06-13T01:00:00.000Z',
        };

        await emitter.emit(event);

        // Verify persisted to DAO
        const rows = await dao.listByEntity('task', '0001', 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.event).toBe('task.created');

        // Verify published to bus
        expect(received).toHaveLength(1);
        expect(received[0]?.event).toBe('task.created');
        expect(received[0]?.entity.id).toBe('0001');

        adapter.close();
    });

    test('emit handles transition events with from/to status', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);
        const bus = new EventBus<PlanningEventMap>();

        const received: PlanningEvent[] = [];
        bus.on('task.transitioned', (event) => {
            received.push(event);
        });

        const emitter = new BusPlanningEventEmitter(bus, dao);

        const event: PlanningEvent = {
            event: 'task.transitioned',
            entity: { kind: 'task', id: '0001' },
            at: '2026-06-13T01:00:00.000Z',
            from: 'todo',
            to: 'wip',
        };

        await emitter.emit(event);

        const rows = await dao.listByEntity('task', '0001', 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.from_status).toBe('todo');
        expect(rows[0]?.to_status).toBe('wip');

        adapter.close();
    });

    test('emit handles feature events', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);
        const bus = new EventBus<PlanningEventMap>();

        const received: PlanningEvent[] = [];
        bus.on('feature.created', (event) => {
            received.push(event);
        });

        const emitter = new BusPlanningEventEmitter(bus, dao);

        const event: PlanningEvent = {
            event: 'feature.created',
            entity: { kind: 'feature', id: 'F1' },
            at: '2026-06-13T01:00:00.000Z',
        };

        await emitter.emit(event);

        const rows = await dao.listByEntity('feature', 'F1', 10);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.entity_kind).toBe('feature');
        expect(received).toHaveLength(1);
        expect(received[0]?.event).toBe('feature.created');

        adapter.close();
    });
});
