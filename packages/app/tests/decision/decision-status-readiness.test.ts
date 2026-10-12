import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, SystemEventDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import type { DecisionProbeOutcome, DecisionStatus } from '../../src/decision/decision-service';
import {
    decisionStatusReadiness,
    LIVENESS_DECISION_ID,
    LIVENESS_PROBE_QUESTION,
    probeDecisionMakers,
    readDecisionStatusReadiness,
} from '../../src/decision/decision-status-readiness';

/**
 * App-service tests for the readiness overlay (feature P11, tasks 1170/1171).
 *
 * Failure modes this file enumerates before trusting the probe (task 1171 R6), because a
 * readiness report is only useful if each one lands as DATA, never as a raised error:
 *
 * | Mode | Expected |
 * | --- | --- |
 * | answered above the floor | `ok: true`, value = the served label |
 * | fallback reason (`no-backend` / `low-confidence` / `error`) | `ok: false`, reason preserved |
 * | deadline expires | `ok: false`, `reason: 'timeout'`, `value: null` |
 * | caller mistake at the seam (unknown id / maker / input) | propagates — an environment fault |
 * | maker not registered | never probed (filtered before the loop) |
 * | duplicate effective maker across decisions | probed once |
 */

/** `decision.end` payload as the emitter + tap persist it (facts under `$.data`). */
function decisionEndPayload(fields: { decisionId: string; maker: string; source: string; reason?: string }): string {
    return JSON.stringify({
        schemaVersion: 2,
        data: {
            caller: 'cli',
            decisionId: fields.decisionId,
            maker: fields.maker,
            source: fields.source,
            ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
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
        await dao.insert({ id: row.id, event_name: 'decision.end', occurred_at: row.at, payload_json: row.payload });
    }
    return dao;
}

/** The report facts a `DecisionStatus` carries, with the two decisions under test. */
function statusOf(overrides: Partial<DecisionStatus> = {}): DecisionStatus {
    return {
        ok: true,
        layers: { project: 0, registered: 0, shared: 2 },
        loadErrors: [],
        duplicateIds: [],
        registeredMakers: ['typesafe', 'fm-local'],
        configDefaultMaker: 'typesafe',
        configDecisionMakers: {},
        perDecision: [
            {
                id: 'task-triage',
                type: 'choice',
                maker: 'typesafe',
                source: 'config-default',
                registered: true,
                layer: 'shared',
                minConfidence: 0.8,
            },
            {
                id: 'failure-class',
                type: 'choice',
                maker: 'fm-local',
                source: 'catalog-default',
                registered: true,
                layer: 'shared',
                minConfidence: 0.7,
            },
        ],
        errors: [],
        ...overrides,
    };
}

const probe = (maker: string, overrides: Partial<DecisionProbeOutcome> = {}): DecisionProbeOutcome => ({
    maker,
    ok: true,
    value: 'ok',
    reason: 'accepted',
    durationMs: 12,
    ...overrides,
});

describe('decisionStatusReadiness (task 1170)', () => {
    test('R2: an unregistered default maker stays visible even with an empty catalog', () => {
        const readiness = decisionStatusReadiness(statusOf({ configDefaultMaker: 'gone', perDecision: [] }));
        expect(readiness.makers.find((maker) => maker.name === 'gone')).toEqual({
            name: 'gone',
            registered: false,
            configuredBy: ['decisions.maker'],
            serves: [],
            evidence: { recorded: 0, accepted: 0, lastSeen: null },
        });
    });

    test('R2: makers carry registration, the config keys naming them and what they serve', () => {
        const status = statusOf({ configDecisionMakers: { 'task-triage': 'fm-local' } });
        const { makers } = decisionStatusReadiness(status);
        const typesafe = makers.find((m) => m.name === 'typesafe');
        const fm = makers.find((m) => m.name === 'fm-local');
        expect(typesafe).toMatchObject({ registered: true, configuredBy: ['decisions.maker'] });
        expect(fm).toMatchObject({ registered: true, configuredBy: ['decisions.makers.task-triage'] });
        expect(typesafe?.serves).toEqual(['task-triage']);
        expect(fm?.serves).toEqual(['failure-class']);
    });

    test('R2: a configured maker the registry does not hold stays visible as a failing row', () => {
        const base = statusOf();
        const status = statusOf({
            configDefaultMaker: 'gone',
            configDecisionMakers: { 'failure-class': 'gone' },
            // A config naming an unregistered maker is what makes every decision unregistered.
            perDecision: base.perDecision.map((row) => ({ ...row, maker: 'gone', registered: false })),
        });
        const gone = decisionStatusReadiness(status).makers.find((m) => m.name === 'gone');
        expect(gone).toMatchObject({ registered: false });
        expect(gone?.configuredBy).toEqual(['decisions.maker', 'decisions.makers.failure-class']);
        // Still listed, with what it would serve: the config error must not disappear.
        expect(gone?.serves).toEqual(['task-triage', 'failure-class']);
    });

    test('R4: evidence folds per maker across decisions and matches per decision on (id, maker)', () => {
        const status = statusOf();
        const readiness = decisionStatusReadiness(status, [
            {
                decisionId: 'task-triage',
                maker: 'typesafe',
                evidence: 'recorded',
                samples: 3,
                accepted: 2,
                acceptedRate: 2 / 3,
                fallbacks: { 'no-backend': 1 },
                medianConfidence: 0.9,
                p50DurationMs: 10,
                p95DurationMs: 20,
                firstSeen: '2026-10-06T01:00:00.000Z',
                lastSeen: '2026-10-06T02:00:00.000Z',
            },
            {
                decisionId: 'failure-class',
                maker: 'typesafe',
                evidence: 'recorded',
                samples: 1,
                accepted: 0,
                acceptedRate: 0,
                fallbacks: { timeout: 1 },
                medianConfidence: null,
                p50DurationMs: 5,
                p95DurationMs: 5,
                firstSeen: '2026-10-03T01:00:00.000Z',
                lastSeen: '2026-10-07T09:00:00.000Z',
            },
        ]);
        const typesafe = readiness.makers.find((m) => m.name === 'typesafe');
        // 3 + 1 recorded, 2 + 0 accepted, latest of the two windows.
        expect(typesafe?.evidence).toEqual({ recorded: 4, accepted: 2, lastSeen: '2026-10-07T09:00:00.000Z' });
        expect(readiness.perDecision[0]?.evidence).toEqual({
            recorded: 3,
            accepted: 2,
            lastSeen: '2026-10-06T02:00:00.000Z',
        });
        // fm-local serves failure-class but has recorded nothing for it.
        expect(readiness.perDecision[1]?.evidence).toEqual({ recorded: 0, accepted: 0, lastSeen: null });
    });

    test('R4: a decision whose maker changed has no evidence for the new maker', () => {
        const readiness = decisionStatusReadiness(statusOf(), [
            {
                decisionId: 'task-triage',
                maker: 'fm-local',
                evidence: 'recorded',
                samples: 9,
                accepted: 9,
                acceptedRate: 1,
                fallbacks: {},
                medianConfidence: 0.9,
                p50DurationMs: 1,
                p95DurationMs: 2,
                firstSeen: '2026-10-06T01:00:00.000Z',
                lastSeen: '2026-10-06T01:00:00.000Z',
            },
        ]);
        // The rows belong to fm-local for task-triage; task-triage now resolves to typesafe.
        expect(readiness.perDecision[0]?.evidence).toEqual({ recorded: 0, accepted: 0, lastSeen: null });
    });

    test('R4: an empty ledger reports zero evidence everywhere and builds no maker', () => {
        const readiness = decisionStatusReadiness(statusOf());
        expect(readiness.perDecision.every((row) => row.evidence.recorded === 0)).toBe(true);
        expect(readiness.makers.every((maker) => maker.evidence.accepted === 0)).toBe(true);
        expect(readiness.probes).toBeUndefined();
    });

    test('R4: readDecisionStatusReadiness reports the recorded ledger through the same mapping', async () => {
        const dao = await recordedDao([
            {
                id: 'e1',
                at: '2026-10-06T01:00:00.000Z',
                payload: decisionEndPayload({ decisionId: 'task-triage', maker: 'typesafe', source: 'model' }),
            },
            {
                id: 'e2',
                at: '2026-10-06T02:00:00.000Z',
                payload: decisionEndPayload({
                    decisionId: 'task-triage',
                    maker: 'typesafe',
                    source: 'default',
                    reason: 'no-backend',
                }),
            },
        ]);
        const readiness = await readDecisionStatusReadiness(dao, statusOf());
        expect(readiness.perDecision[0]?.evidence).toEqual({
            recorded: 2,
            accepted: 1,
            lastSeen: '2026-10-06T02:00:00.000Z',
        });
        expect(readiness.makers.find((m) => m.name === 'typesafe')?.evidence.recorded).toBe(2);
    });
});

describe('probeDecisionMakers (task 1171)', () => {
    const calls: Array<{ decisionId: string; maker: string; input: Record<string, unknown>; backstopMs: number }> = [];
    function stubProbe(outcomes: Record<string, Partial<DecisionProbeOutcome>>): {
        probeMaker: (
            decisionId: string,
            maker: string,
            input: Record<string, unknown>,
            backstopMs: number,
        ) => Promise<DecisionProbeOutcome>;
    } {
        calls.length = 0;
        return {
            probeMaker: async (decisionId, maker, input, backstopMs) => {
                calls.push({ decisionId, maker, input, backstopMs });
                return probe(maker, outcomes[maker] ?? {});
            },
        };
    }

    test('R5: each distinct registered effective maker is asked the liveness decision once', async () => {
        const base = statusOf();
        const status = statusOf({ perDecision: base.perDecision.map((row) => ({ ...row, maker: 'typesafe' })) });
        const seam = stubProbe({});
        const results = await probeDecisionMakers(seam, status);
        expect(calls.map((call) => call.maker)).toEqual(['typesafe']); // two decisions, one maker
        expect(calls[0]?.decisionId).toBe(LIVENESS_DECISION_ID);
        expect(calls[0]?.input).toEqual({ instructions: LIVENESS_PROBE_QUESTION });
        expect(results).toEqual([probe('typesafe')]);
    });

    test('R5: an unregistered maker is never probed', async () => {
        const status = statusOf({
            registeredMakers: ['typesafe'],
            perDecision: statusOf().perDecision.map((row) => ({ ...row, registered: row.maker === 'typesafe' })),
        });
        await probeDecisionMakers(stubProbe({}), status);
        expect(calls.map((call) => call.maker)).toEqual(['typesafe']);
    });

    test('R6: a fallback outcome is data, and the caller sees each result as it lands', async () => {
        const status = statusOf();
        const seen: string[] = [];
        const results = await probeDecisionMakers(
            stubProbe({ 'fm-local': { ok: false, value: 'unclear', reason: 'no-backend' } }),
            status,
            { onResult: (result) => seen.push(result.maker) },
        );
        expect(results).toEqual([
            probe('typesafe'),
            probe('fm-local', { ok: false, value: 'unclear', reason: 'no-backend' }),
        ]);
        expect(seen).toEqual(['typesafe', 'fm-local']); // report order, streamed
    });

    test('R6: a seam that rejects (unknown id) propagates instead of reporting a dead maker', async () => {
        const failing = {
            probeMaker: async (): Promise<DecisionProbeOutcome> => {
                throw new Error('Unknown decision "maker-liveness"');
            },
        };
        await expect(probeDecisionMakers(failing, statusOf())).rejects.toThrow(/Unknown decision/);
    });

    test('R5: the caller can pass its own backstop budget', async () => {
        await probeDecisionMakers(stubProbe({}), statusOf(), { backstopMs: 1 });
        expect(calls.every((call) => call.backstopMs === 1)).toBe(true);
    });
});
