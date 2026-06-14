import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, PlanningEventDao } from '../../src/index';
import { extractHistoryEvents, historyEntryToEvent, parseHistoryLine } from '../../src/planning/rebuild-events';

describe('PlanningEvents rebuild from corpus', () => {
    test('parseHistoryLine parses the canonical bullet line written by the write-service', () => {
        // Matches PlanningWriteService.appendHistoryLine output exactly.
        const line = '- 2026-06-13T01:00:00.000Z backlog → todo (system)';
        const entry = parseHistoryLine(line, 'task', '0053');
        expect(entry).not.toBeNull();
        if (!entry) return;
        expect(entry.timestamp).toBe('2026-06-13T01:00:00.000Z');
        expect(entry.from).toBe('backlog');
        expect(entry.to).toBe('todo');
        expect(entry.entityKind).toBe('task');
        expect(entry.entityId).toBe('0053');
    });

    test('parseHistoryLine returns null for non-transition lines (incl. migration seed)', () => {
        expect(parseHistoryLine('some random text', 'task', '0053')).toBeNull();
        expect(parseHistoryLine('', 'task', '0053')).toBeNull();
        // The corpus-migrator (M8) seeds this bullet; it is NOT a transition and must be skipped.
        expect(parseHistoryLine('- Migrated from legacy format (2026-06-13)', 'task', '0053')).toBeNull();
    });

    test('historyEntryToEvent converts to CreatePlanningEventInput', () => {
        const entry = {
            timestamp: '2026-06-13T01:00:00.000Z',
            entityKind: 'task' as const,
            entityId: '0053',
            from: 'backlog',
            to: 'todo',
        };
        const event = historyEntryToEvent(entry);
        expect(event.entity_kind).toBe('task');
        expect(event.entity_id).toBe('0053');
        expect(event.event).toBe('task.transitioned');
        expect(event.from_status).toBe('backlog');
        expect(event.to_status).toBe('todo');
        expect(event.created_at).toBe('2026-06-13T01:00:00.000Z');
        expect(event.payload).toBeNull();
        expect(event.id).toMatch(/^pev_/);
    });

    test('extractHistoryEvents extracts entries from History section', () => {
        const markdown = `# Some doc

## Background
Some context.

## History

- 2026-06-13T01:00:00.000Z backlog → todo (system)
- 2026-06-13T02:00:00.000Z todo → wip (system)
- 2026-06-13T03:00:00.000Z wip → done (system)

## Notes
After history.
`;
        const events = extractHistoryEvents(markdown, 'task', '0053');
        expect(events).toHaveLength(3);

        expect(events[0]?.event).toBe('task.transitioned');
        expect(events[0]?.from_status).toBe('backlog');
        expect(events[0]?.to_status).toBe('todo');

        expect(events[1]?.from_status).toBe('todo');
        expect(events[1]?.to_status).toBe('wip');

        expect(events[2]?.from_status).toBe('wip');
        expect(events[2]?.to_status).toBe('done');
    });

    test('extractHistoryEvents handles feature entities', () => {
        const markdown = `## History

- 2026-06-13T01:00:00.000Z backlog → active (system)
`;
        const events = extractHistoryEvents(markdown, 'feature', 'F1');
        expect(events).toHaveLength(1);
        expect(events[0]?.entity_kind).toBe('feature');
        expect(events[0]?.event).toBe('feature.transitioned');
    });

    test('extractHistoryEvents returns empty for no History section', () => {
        const markdown = `# Just a title
No history here.
`;
        const events = extractHistoryEvents(markdown, 'task', '0053');
        expect(events).toHaveLength(0);
    });

    test('rebuild from corpus: drop DB, rebuild, compare — proves derived-only', async () => {
        // Phase 1: create DB, insert some events
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new PlanningEventDao(adapter);

        // Corpus history in the canonical format the write-service actually emits,
        // plus a migration-seed bullet that must be ignored (not a transition).
        const corpus = `# Task 0053

## History

- Migrated from legacy format (2026-06-13)
- 2026-06-13T01:00:00.000Z backlog → todo (system)
- 2026-06-13T02:00:00.000Z todo → wip (system)
- 2026-06-13T03:00:00.000Z wip → done (robot)
`;

        // Insert original events directly
        const originalEvents = extractHistoryEvents(corpus, 'task', '0053');
        for (const event of originalEvents) {
            await dao.insert(event);
        }

        // Read original rows for comparison
        const originalRows = await dao.listByEntity('task', '0053', 10);
        expect(originalRows).toHaveLength(3);

        // Phase 2: drop the table and rebuild
        await dao.deleteAll();

        // Rebuild from corpus
        const rebuiltEvents = extractHistoryEvents(corpus, 'task', '0053');
        for (const event of rebuiltEvents) {
            await dao.insert(event);
        }

        // Phase 3: compare — same count, same entity/event/status transitions
        const rebuiltRows = await dao.listByEntity('task', '0053', 10);
        expect(rebuiltRows).toHaveLength(3);

        // Compare semantic fields (not IDs, which are regenerated)
        for (let i = 0; i < 3; i++) {
            const orig = originalRows[i];
            const reb = rebuiltRows[i];
            if (!orig || !reb) throw new Error('missing row');
            expect(reb.entity_kind).toBe(orig.entity_kind);
            expect(reb.entity_id).toBe(orig.entity_id);
            expect(reb.event).toBe(orig.event);
            expect(reb.from_status).toBe(orig.from_status);
            expect(reb.to_status).toBe(orig.to_status);
            expect(reb.created_at).toBe(orig.created_at);
        }

        adapter.close();
    });

    test('planning_events table gets created by migration 0003', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);

        // Verify the table exists by inserting and reading back
        const dao = new PlanningEventDao(adapter);
        await dao.insert({
            id: 'pev_test1',
            entity_kind: 'task',
            entity_id: '0001',
            event: 'task.created',
            from_status: null,
            to_status: null,
            payload: null,
            created_at: new Date().toISOString(),
        });

        const events = await dao.listByEntity('task', '0001', 10);
        expect(events).toHaveLength(1);
        expect(events[0]?.event).toBe('task.created');

        adapter.close();
    });
});
