import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, DecisionLogDao } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import type { DecisionLogRecord } from '../../src/decision/decision-log';
import { buildDecisionLogRow } from '../../src/decision/decision-log';
import { DecisionLogQueryService, decisionLogP95 } from '../../src/decision/decision-log-query';

const BASE_MS = Date.parse('2026-07-04T01:00:00.000Z');

function record(overrides: Partial<DecisionLogRecord> = {}): DecisionLogRecord {
    return {
        id: 'dcl_1',
        decisionId: 'publish.pr',
        caller: 'cli',
        outcome: 'accepted',
        value: 'ship',
        startedAtMs: BASE_MS,
        endedAtMs: BASE_MS + 1,
        phases: [],
        ...overrides,
    };
}

async function seededService(rowCount: number): Promise<{ service: DecisionLogQueryService; adapter: DbAdapter }> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    const dao = new DecisionLogDao(adapter);
    for (let i = 1; i <= rowCount; i++) {
        await dao.insert(
            buildDecisionLogRow(
                { dao, secrets: [], mode: 'full' },
                record({
                    id: `dcl_${i}`,
                    outcome: i % 2 === 0 ? 'fallback' : 'accepted',
                    startedAtMs: BASE_MS + i,
                    endedAtMs: BASE_MS + i + i,
                }),
            ),
        );
    }
    return { service: new DecisionLogQueryService(dao), adapter };
}

describe('decisionLogP95 (nearest-rank)', () => {
    test('empty set is null; rank is ceil(0.95n) over sorted durations', () => {
        expect(decisionLogP95([])).toBeNull();
        expect(decisionLogP95([5])).toBe(5);
        expect(decisionLogP95([1, 2, 3, 4])).toBe(4); // ceil(3.8) = 4
        expect(decisionLogP95([10, 1, 7, 3, 9, 2, 8, 6, 4, 5])).toBe(10); // ceil(9.5) = 10
    });
});

describe('DecisionLogQueryService.list', () => {
    test('maps snake_case rows to camelCase summaries with rates, p95 and facets', async () => {
        const { service, adapter } = await seededService(10);
        const page = await service.list({ limit: 3 });
        expect(page.rows.map((r) => r.id)).toEqual(['dcl_10', 'dcl_9', 'dcl_8']); // newest first
        expect(page.rows[0]).toMatchObject({
            decisionId: 'publish.pr',
            caller: 'cli',
            outcome: 'fallback',
            value: 'ship',
            inputKeys: [],
            durationMs: 10,
            schemaVersion: 1,
            confidenceLevel: 'LOW', // seeded fallback rows carry null confidence → fail-conservative LOW
        });
        expect(page.summary.count).toBe(10);
        expect(page.summary.acceptedRate).toBeCloseTo(0.5, 5);
        expect(page.summary.fallbackRate).toBeCloseTo(0.5, 5);
        // Durations 1..10ms; nearest-rank p95 over 10 samples is the 10th → 10.
        expect(page.summary.p95DurationMs).toBe(10);
        expect(page.facets.decisionIds).toEqual(['publish.pr']);
        adapter.close();
    });

    test('cursor resumes the next older page; malformed cursors fall back to the newest page', async () => {
        const { service, adapter } = await seededService(10);
        const page1 = await service.list({ limit: 4 });
        expect(page1.nextCursor).not.toBeNull();
        const page2 = await service.list({ limit: 4, before: page1.nextCursor ?? undefined });
        expect(page2.rows.map((r) => r.id)).toEqual(['dcl_6', 'dcl_5', 'dcl_4', 'dcl_3']);

        for (const bad of ['garbage', '|no-id', 'ts-only|']) {
            const fallback = await service.list({ limit: 4, before: bad });
            expect(fallback.rows.map((r) => r.id)).toEqual(['dcl_10', 'dcl_9', 'dcl_8', 'dcl_7']);
        }
        adapter.close();
    });

    test('empty set returns zeroed summary, empty facets and no cursor', async () => {
        const { service, adapter } = await seededService(0);
        const page = await service.list({});
        expect(page.rows).toEqual([]);
        expect(page.summary).toEqual({ count: 0, acceptedRate: 0, fallbackRate: 0, p95DurationMs: null });
        expect(page.facets).toEqual({ decisionIds: [], makers: [] });
        expect(page.nextCursor).toBeNull();
        adapter.close();
    });
});

describe('DecisionLogQueryService.get', () => {
    test('detail adds question, input JSON and parsed phase timings', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        await dao.insert(
            buildDecisionLogRow(
                { dao, secrets: [], mode: 'full' },
                record({
                    question: 'ship it?',
                    input: { pr: '1' },
                    phases: [
                        { phase: 'evidence', startedAt: 0, durationMs: 10 },
                        { phase: 'maker', startedAt: 10, durationMs: 90 },
                    ],
                }),
            ),
        );
        const service = new DecisionLogQueryService(dao);
        const detail = await service.get('dcl_1');
        expect(detail?.question).toBe('ship it?');
        expect(JSON.parse(detail?.inputJson ?? '{}')).toEqual({ pr: '1' });
        expect(detail?.phases).toEqual([
            { phase: 'evidence', startedAt: 0, durationMs: 10 },
            { phase: 'maker', startedAt: 10, durationMs: 90 },
        ]);
        expect(await service.get('dcl_missing')).toBeNull();
        adapter.close();
    });

    test('malformed phases/input-keys JSON degrades to empty values instead of throwing', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        await dao.insert(buildDecisionLogRow({ dao, secrets: [], mode: 'full' }, record()));
        await adapter.run(
            "UPDATE decision_logs SET phases_json = '{bad', input_keys_json = '[broken' WHERE id = 'dcl_1'",
        );
        const detail = await new DecisionLogQueryService(dao).get('dcl_1');
        expect(detail?.phases).toEqual([]);
        expect(detail?.inputKeys).toEqual([]);
        adapter.close();
    });
});
