import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, SystemEventDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { type DecisionReliabilityCatalogEntry, decisionReliability } from '../../src/decision/decision-reliability';

/**
 * App-service tests for the reliability report (task 1096 R2/R3). Rows are
 * inserted through `SystemEventDao` exactly as the tap persists them (v2
 * envelope, decision facts under `$.data.*`); percentiles and the
 * evidence-none fill are asserted against known datasets.
 */

/** decision.end payload as the 1095 emitter + tap persist it (facts under $.data). */
function decisionEndPayload(fields: {
    decisionId: string;
    maker: string;
    source?: string;
    reason?: string;
    durationMs?: number;
    confidence?: number | null;
}): string {
    return JSON.stringify({
        schemaVersion: 2,
        data: {
            caller: 'cli',
            decisionId: fields.decisionId,
            maker: fields.maker,
            ...(fields.source !== undefined ? { source: fields.source } : {}),
            ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
            ...(fields.durationMs !== undefined ? { durationMs: fields.durationMs } : {}),
            ...(fields.confidence !== undefined ? { confidence: fields.confidence } : {}),
        },
        context: {},
        presentation: {},
    });
}

async function recordedDao(rows: Array<{ id: string; at: string; payload: string }>): Promise<SystemEventDao> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    const dao = new SystemEventDao(adapter);
    for (const row of rows) {
        await dao.insert({
            id: row.id,
            event_name: 'decision.end',
            occurred_at: row.at,
            payload_json: row.payload,
        });
    }
    return dao;
}

const CATALOG: DecisionReliabilityCatalogEntry[] = [
    { decisionId: 'task-triage', maker: 'typesafe' },
    { decisionId: 'failure-class', maker: 'typesafe' },
    { decisionId: 'review-failure-class', maker: 'typesafe' },
];

describe('decisionReliability (task 1096)', () => {
    test('R2: acceptedRate, nearest-rank percentiles and median over a known dataset', async () => {
        const dao = await recordedDao([
            {
                id: 'r1',
                at: '2026-10-06T01:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'model',
                    durationMs: 30,
                    confidence: 0.9,
                }),
            },
            {
                id: 'r2',
                at: '2026-10-06T02:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'default',
                    reason: 'no-backend',
                    durationMs: 10,
                    confidence: null,
                }),
            },
            {
                id: 'r3',
                at: '2026-10-06T03:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'default',
                    reason: 'no-backend',
                    durationMs: 20,
                    confidence: 0.7,
                }),
            },
            {
                id: 'r4',
                at: '2026-10-06T04:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'default',
                    reason: 'timeout',
                    durationMs: 40,
                    confidence: 0.8,
                }),
            },
        ]);

        const report = await decisionReliability(dao, { catalog: CATALOG });
        expect(report.generatedAt).toBeDefined();
        expect(report.groups.map((g) => g.decisionId)).toEqual([
            'task-triage',
            'failure-class',
            'review-failure-class',
        ]); // recorded first; the two zero-row catalog ids fill as evidence none
        const group = report.groups[0];
        expect(group).toMatchObject({
            decisionId: 'task-triage',
            maker: 'typesafe',
            evidence: 'recorded',
            samples: 4,
            accepted: 1,
            acceptedRate: 0.25,
            fallbacks: { 'no-backend': 2, timeout: 1 },
            firstSeen: '2026-10-06T01:00:00.000Z',
            lastSeen: '2026-10-06T04:00:00.000Z',
        });
        // Nearest-rank over [10,20,30,40]: p50 = rank 2 = 20, p95 = rank 4 = 40.
        expect(group?.p50DurationMs).toBe(20);
        expect(group?.p95DurationMs).toBe(40);
        // Median confidence over [0.7, 0.8, 0.9] (null excluded): rank 2 = 0.8.
        expect(group?.medianConfidence).toBe(0.8);
    });

    test('R2: a single sample reports itself for every percentile (failure list)', async () => {
        const dao = await recordedDao([
            {
                id: 's1',
                at: '2026-10-06T01:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'failure-class',
                    maker: 'inline',
                    source: 'default',
                    reason: 'no-backend',
                    durationMs: 12,
                }),
            },
        ]);
        const report = await decisionReliability(dao);
        const group = report.groups[0];
        expect(group).toMatchObject({
            samples: 1,
            accepted: 0,
            acceptedRate: 0,
            p50DurationMs: 12,
            p95DurationMs: 12,
            medianConfidence: null, // no numeric confidence at all
            fallbacks: { 'no-backend': 1 },
        });
    });

    test('R2: medianConfidence excludes nulls and is null when none are numeric', async () => {
        const dao = await recordedDao([
            {
                id: 'c1',
                at: '2026-10-06T01:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'd',
                    maker: 'm',
                    source: 'model',
                    durationMs: 1,
                    confidence: 0.9,
                }),
            },
            {
                id: 'c2',
                at: '2026-10-06T02:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'd',
                    maker: 'm',
                    source: 'model',
                    durationMs: 2,
                    confidence: null,
                }),
            },
        ]);
        const report = await decisionReliability(dao);
        // Median over [0.9] alone — the null never enters the math.
        expect(report.groups[0]?.medianConfidence).toBe(0.9);
    });

    test('R2: catalog ids with zero rows report evidence none; recorded ids are not duplicated', async () => {
        const dao = await recordedDao([
            {
                id: 'e1',
                at: '2026-10-06T01:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'model',
                    durationMs: 5,
                    confidence: 0.9,
                }),
            },
        ]);
        const report = await decisionReliability(dao, { catalog: CATALOG });
        expect(report.groups.map((g) => [g.decisionId, g.evidence])).toEqual([
            ['task-triage', 'recorded'],
            ['failure-class', 'none'],
            ['review-failure-class', 'none'],
        ]);
        const none = report.groups[1];
        expect(none).toMatchObject({
            decisionId: 'failure-class',
            maker: 'typesafe',
            samples: 0,
            accepted: 0,
            acceptedRate: 0,
            fallbacks: {},
            medianConfidence: null,
            p50DurationMs: null,
            p95DurationMs: null,
            firstSeen: null,
            lastSeen: null,
        });
    });

    test('R2: spec.decisionId narrows recorded groups and the fill together', async () => {
        const dao = await recordedDao([
            {
                id: 'w1',
                at: '2026-10-06T01:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'model',
                    durationMs: 5,
                }),
            },
        ]);
        const report = await decisionReliability(dao, { decisionId: 'review-failure-class', catalog: CATALOG });
        expect(report.groups).toHaveLength(1);
        expect(report.groups[0]).toMatchObject({ decisionId: 'review-failure-class', evidence: 'none' });
    });

    test('R2: spec.since narrows the window (older rows stop counting)', async () => {
        const dao = await recordedDao([
            {
                id: 't1',
                at: '2026-10-01T00:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'default',
                    reason: 'no-backend',
                    durationMs: 1,
                }),
            },
            {
                id: 't2',
                at: '2026-10-06T00:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'model',
                    durationMs: 2,
                    confidence: 0.9,
                }),
            },
        ]);
        const report = await decisionReliability(dao, { since: '2026-10-05T00:00:00.000Z' });
        expect(report.groups[0]).toMatchObject({ samples: 1, accepted: 1, acceptedRate: 1, fallbacks: {} });
    });

    test('R3: an empty ledger with no catalog reports zero groups and never throws', async () => {
        const dao = await recordedDao([]);
        const report = await decisionReliability(dao);
        expect(report.groups).toEqual([]);
    });
});
