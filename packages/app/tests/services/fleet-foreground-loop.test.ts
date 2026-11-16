/**
 * G76 1343 — the thin parallel client, its fleet-less refusal and its ledger-backed report.
 * Failure modes: a tick after the fence moved, an endless idle spin, a missing fleet silently
 * reported as running, and a report that claims progress the ledger does not carry.
 */
import { describe, expect, test } from 'bun:test';
import type { SystemEventRow } from '@gobing-ai/spur-domain';
import {
    type ForegroundIteration,
    fleetReportRows,
    parallelRefusal,
    renderFleetBatchReport,
    runForegroundTicks,
} from '../../src/index';
import type { TickReport } from '../../src/services/strategy-runtime';

/** A runtime double: each tick returns the scripted report; observe records its calls. */
function fakeRuntime(reports: TickReport[]) {
    let index = 0;
    const observed: string[] = [];
    return {
        observed,
        tick: async () => reports[Math.min(index++, reports.length - 1)] ?? { dispatched: [], holds: [] },
        observe: async () => {
            observed.push('observe');
            return { released: [] };
        },
    };
}

const dispatch = (taskId: string): TickReport => ({
    dispatched: [{ taskId, instanceId: 'coder1', ownerEpoch: 1, strategyVersion: 1 } as never],
    holds: [],
});

async function collect(iterable: AsyncIterable<ForegroundIteration>): Promise<ForegroundIteration[]> {
    const seen: ForegroundIteration[] = [];
    for await (const tick of iterable) seen.push(tick);
    return seen;
}

describe('runForegroundTicks (G76 1343 R1)', () => {
    test('ticks, observes each dispatch, and stops on the idle budget', async () => {
        const runtime = fakeRuntime([dispatch('0601'), dispatch('0602'), { dispatched: [], holds: [] }]);
        const ticks = await collect(
            runForegroundTicks('/tmp/project', runtime, { ownerEpoch: 1, orchestratorId: 'orch', maxIdleTicks: 1 }),
        );
        expect(ticks).toHaveLength(3);
        expect(ticks[2]?.end).toBe('idle');
        expect(ticks[2]?.dispatched).toEqual(['0601', '0602']);
        expect(runtime.observed).toHaveLength(3);
    });

    test('a tick interval paces the loop through the real timer', async () => {
        const runtime = fakeRuntime([dispatch('0601'), { dispatched: [], holds: [] }]);
        const started = Date.now();
        const ticks = await collect(
            runForegroundTicks('/tmp/project', runtime, {
                ownerEpoch: 1,
                orchestratorId: 'orch',
                maxIdleTicks: 1,
                tickIntervalMs: 5,
            }),
        );
        // Two ticks yield, and the interval only waits between them (never after the last).
        expect(ticks).toHaveLength(2);
        expect(Date.now() - started).toBeGreaterThanOrEqual(4);
    });

    test('a dispatchless tick with work in flight is not idleness', async () => {
        // A busy member and a lane at the cap keep the batch alive; only settled holds count as idle.
        const busy: TickReport = {
            dispatched: [],
            holds: [
                { wbs: '0601', reason: 'dispatch-in-flight' },
                { wbs: '0602', reason: 'writer-cap', detail: '2/2' },
            ],
        };
        const runtime = fakeRuntime([busy, busy, { dispatched: [], holds: [{ wbs: '0603', reason: 'unauthorized' }] }]);
        const ticks = await collect(
            runForegroundTicks('/tmp/project', runtime, { ownerEpoch: 1, orchestratorId: 'orch', maxIdleTicks: 1 }),
        );
        expect(ticks.length).toBe(3);
        expect(ticks[1]?.end).toBeUndefined();
        expect(ticks[2]?.end).toBe('idle');
    });

    test('maxTicks bounds a project that never settles', async () => {
        const busy: TickReport = { dispatched: [], holds: [{ wbs: '0601', reason: 'dispatch-in-flight' }] };
        const runtime = fakeRuntime([busy]);
        const ticks = await collect(
            runForegroundTicks('/tmp/project', runtime, {
                ownerEpoch: 1,
                orchestratorId: 'orch',
                maxIdleTicks: 3,
                maxTicks: 3,
            }),
        );
        expect(ticks.at(-1)?.end).toBe('bounded');
        expect(ticks).toHaveLength(3);
    });

    test('a moved fence ends the loop before the next dispatch', async () => {
        const runtime = fakeRuntime([dispatch('0601')]);
        let healthy = true;
        const ticks: ForegroundIteration[] = [];
        for await (const tick of runForegroundTicks('/tmp/project', runtime, {
            ownerEpoch: 1,
            orchestratorId: 'orch',
            healthy: async () => healthy,
        })) {
            ticks.push(tick);
            healthy = false;
        }
        expect(ticks).toHaveLength(2);
        expect(ticks[1]?.end).toBe('fence-lost');
        expect(ticks[1]?.report.dispatched).toHaveLength(0);
    });

    test('an abort stops the loop and dispatches nothing further', async () => {
        const runtime = fakeRuntime([dispatch('0601')]);
        const controller = new AbortController();
        const ticks: ForegroundIteration[] = [];
        for await (const tick of runForegroundTicks('/tmp/project', runtime, {
            ownerEpoch: 1,
            orchestratorId: 'orch',
            signal: controller.signal,
        })) {
            ticks.push(tick);
            controller.abort();
        }
        expect(ticks.at(-1)?.end).toBe('aborted');
        expect(ticks).toHaveLength(2);
    });
});

describe('parallelRefusal (G76 1343 R3)', () => {
    test('names the missing fleet, coder member and maxWriters, never a silent fallback', () => {
        expect(parallelRefusal(null)).toContain('agent.fleet.enabled');
        expect(parallelRefusal({ enabled: false, maxWriters: 2, members: [{ role: 'coder' }] })).toContain(
            'agent.fleet.enabled',
        );
        expect(parallelRefusal({ enabled: true, maxWriters: 2, members: [{ role: 'planner' }] })).toContain(
            'coder member',
        );
        expect(parallelRefusal({ enabled: true, members: [{ role: 'coder' }] })).toContain('maxWriters');
        expect(parallelRefusal({ enabled: true, maxWriters: 2, members: [{ role: 'coder' }] })).toBeNull();
    });
});

describe('fleetReportRows (G76 1343 R2)', () => {
    function event(name: string, payload: Record<string, unknown>, at: string): SystemEventRow {
        return {
            id: `${name}-${at}`,
            event_name: name,
            occurred_at: at,
            actor: 'fleet',
            payload_json: JSON.stringify(payload),
            entity_kind: 'task',
            entity_id: typeof payload.wbs === 'string' ? payload.wbs : null,
        } as unknown as SystemEventRow;
    }

    test('renders landings and retentions in ledger order, as text', () => {
        const rows = fleetReportRows([
            event('fleet.task.integrated', { wbs: '0602', attempt: 1, baseAfter: 'abc1234' }, '2026-11-15T02:00:02Z'),
            event(
                'fleet.lane.retained',
                { wbs: '0601', attempt: 1, reason: 'integration-conflict' },
                '2026-11-15T02:00:01Z',
            ),
        ]);
        expect(rows.map((row) => `${row.wbs} ${row.event} ${row.detail}`)).toEqual([
            '0601 #1 fleet.lane.retained integration-conflict',
            '0602 #1 fleet.task.integrated landed at abc1234',
        ]);
        expect(renderFleetBatchReport(rows)).toContain('fleet.task.integrated 0602 #1 — landed at abc1234');
        expect(renderFleetBatchReport([])).toContain('No fleet events');
    });
});
