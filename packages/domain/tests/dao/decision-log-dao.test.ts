import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { CreateDecisionLogInput } from '../../src/index';
import { applyCliMigrations, createId, DECISION_LOG_RETENTION_ROWS, DecisionLogDao } from '../../src/index';

function row(overrides: Partial<CreateDecisionLogInput> = {}): CreateDecisionLogInput {
    return {
        id: createId('dcl'),
        decision_id: 'publish.pr',
        decision_type: 'choice',
        caller: 'cli',
        run_id: null,
        workflow_name: null,
        node_id: null,
        wbs: null,
        maker_name: 'heuristic-maker',
        maker_source: 'registered',
        catalog_layer: 'bundled',
        catalog_source: '/catalog/decisions',
        min_confidence: 0.8,
        question: null,
        input_json: '{"pr":"1"}',
        input_keys_json: '[]',
        evidence_digest: null,
        outcome: 'accepted',
        value: '"ship"',
        fallback_value: null,
        source: 'model',
        reason: 'confidence',
        confidence: 0.9,
        error: null,
        started_at: '2026-07-04T01:00:00.000Z',
        ended_at: '2026-07-04T01:00:01.000Z',
        duration_ms: 1000,
        phases_json: '[]',
        schema_version: 1,
        ...overrides,
    };
}

describe('DecisionLogDao', () => {
    test('insert and list returns summary rows newest-first', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        await dao.insert(row({ started_at: '2026-07-04T01:00:00.000Z', id: 'dcl_a' }));
        await dao.insert(row({ started_at: '2026-07-04T02:00:00.000Z', id: 'dcl_b' }));

        const page = await dao.list({ limit: 10 });
        expect(page.rows).toHaveLength(2);
        expect(page.nextCursor).toBeNull();
        expect(page.rows[0]?.id).toBe('dcl_b');
        // Summary rows omit the mode-gated payload columns.
        expect(page.rows[0]).not.toHaveProperty('input_json');
        expect(page.rows[0]).not.toHaveProperty('question');
        expect(page.rows[0]).not.toHaveProperty('phases_json');
        adapter.close();
    });

    test('list filters by decision, maker, outcome, caller, run and since', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        await dao.insert(row({ id: 'dcl_a', decision_id: 'publish.pr', outcome: 'accepted' }));
        await dao.insert(
            row({
                id: 'dcl_b',
                decision_id: 'publish.changelog',
                outcome: 'fallback',
                started_at: '2026-07-04T03:00:00.000Z',
            }),
        );
        await dao.insert(
            row({
                id: 'dcl_c',
                decision_id: 'other.decision',
                caller: 'workflow',
                run_id: 'run_x',
                started_at: '2026-07-04T04:00:00.000Z',
            }),
        );

        expect((await dao.list({ decision_id: 'publish.pr' })).rows.map((r) => r.id)).toEqual(['dcl_a']);
        expect((await dao.list({ outcome: 'fallback' })).rows.map((r) => r.id)).toEqual(['dcl_b']);
        expect((await dao.list({ caller: 'workflow' })).rows.map((r) => r.id)).toEqual(['dcl_c']);
        expect((await dao.list({ run_id: 'run_x' })).rows).toHaveLength(1);
        expect((await dao.list({ since: '2026-07-04T02:00:00.000Z' })).rows.map((r) => r.id)).toEqual([
            'dcl_c',
            'dcl_b',
        ]);
        adapter.close();
    });

    test('keyset pagination cursor excludes the boundary and later pages are stable', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        for (let i = 0; i < 5; i++) {
            await dao.insert(row({ id: `dcl_${i}`, started_at: `2026-07-04T0${i + 1}:00:00.000Z` }));
        }
        const page1 = await dao.list({ limit: 2 });
        expect(page1.rows.map((r) => r.id)).toEqual(['dcl_4', 'dcl_3']);
        expect(page1.nextCursor).toEqual({ started_at: '2026-07-04T04:00:00.000Z', id: 'dcl_3' });

        const page2 = await dao.list({ limit: 2, before: page1.nextCursor ?? undefined });
        expect(page2.rows.map((r) => r.id)).toEqual(['dcl_2', 'dcl_1']);
        expect(page2.nextCursor).toEqual({ started_at: '2026-07-04T02:00:00.000Z', id: 'dcl_1' });

        const page3 = await dao.list({ limit: 2, before: page2.nextCursor ?? undefined });
        expect(page3.rows.map((r) => r.id)).toEqual(['dcl_0']);
        expect(page3.nextCursor).toBeNull();
        adapter.close();
    });

    test('summary counts outcomes and collects durations over the whole filtered set', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        await dao.insert(row({ id: 'dcl_a', outcome: 'accepted', duration_ms: 100 }));
        await dao.insert(
            row({ id: 'dcl_b', outcome: 'accepted', duration_ms: 200, started_at: '2026-07-04T02:00:00.000Z' }),
        );
        await dao.insert(
            row({ id: 'dcl_c', outcome: 'fallback', duration_ms: 300, started_at: '2026-07-04T03:00:00.000Z' }),
        );
        await dao.insert(
            row({ id: 'dcl_d', outcome: 'rejected', duration_ms: 5, started_at: '2026-07-04T04:00:00.000Z' }),
        );

        const counts = await dao.summary({});
        expect(counts).toEqual({ count: 4, accepted: 2, fallback: 1, rejected: 1, durations: [100, 200, 300, 5] });

        // Summary ignores the paging cursor/limit — it aggregates the full filtered set.
        const limited = await dao.summary({ limit: 2 });
        expect(limited.count).toBe(4);
        adapter.close();
    });

    test('facets returns distinct decision ids and non-null makers', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        await dao.insert(row({ id: 'dcl_a', decision_id: 'publish.pr', maker_name: 'm1' }));
        await dao.insert(
            row({
                id: 'dcl_b',
                decision_id: 'publish.changelog',
                maker_name: 'm2',
                started_at: '2026-07-04T02:00:00.000Z',
            }),
        );
        await dao.insert(
            row({ id: 'dcl_c', decision_id: 'publish.pr', maker_name: null, started_at: '2026-07-04T03:00:00.000Z' }),
        );

        const facets = await dao.facets({});
        expect(facets.decisionIds).toEqual(['publish.changelog', 'publish.pr']);
        expect(facets.makers).toEqual(['m1', 'm2']);
        adapter.close();
    });

    test('get returns the full row by id and null when absent', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        await dao.insert(
            row({
                id: 'dcl_a',
                question: 'ship it?',
                input_json: '{"a":1}',
                phases_json: '[{"phase":"maker","startedAt":1,"durationMs":2}]',
            }),
        );

        const full = await dao.get('dcl_a');
        expect(full?.question).toBe('ship it?');
        expect(full?.input_json).toBe('{"a":1}');
        expect(full?.phases_json).toContain('maker');
        expect(await dao.get('dcl_missing')).toBeNull();
        adapter.close();
    });

    test('reads tolerate a missing decision_logs table', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const dao = new DecisionLogDao(adapter);
        expect((await dao.list({})).rows).toEqual([]);
        expect((await dao.summary({})).count).toBe(0);
        expect(await dao.facets({})).toEqual({ decisionIds: [], makers: [] });
        expect(await dao.get('dcl_x')).toBeNull();
        adapter.close();
    });

    test('insert prunes beyond the retention bound', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        const dao = new DecisionLogDao(adapter);
        const base = Date.parse('2026-07-04T00:00:00.000Z');
        const total = DECISION_LOG_RETENTION_ROWS + 5;
        for (let i = 0; i < total; i++) {
            await dao.insert(
                row({
                    id: `dcl_${String(i).padStart(4, '0')}`,
                    started_at: new Date(base + i).toISOString(),
                    ended_at: new Date(base + i).toISOString(),
                }),
            );
        }
        const counts = await dao.summary({});
        expect(counts.count).toBe(DECISION_LOG_RETENTION_ROWS);
        // The five oldest rows are gone; the newest survive.
        expect(await dao.get('dcl_0000')).toBeNull();
        expect(await dao.get(`dcl_${String(total - 1).padStart(4, '0')}`)).not.toBeNull();
        adapter.close();
    });
});
